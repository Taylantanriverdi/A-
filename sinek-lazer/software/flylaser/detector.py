"""Sabit hedef (duvardaki sinek) tespit modülü — Python + OpenCV.

Boru hattı (pipeline)
---------------------
1. Gri tonlama + hafif Gauss bulanıklaştırma (sensör gürültüsü)
2. Morfolojik BLACK-HAT: açık zemindeki küçük KOYU lekeleri öne çıkarır
   (blackhat = closing(img) - img). Büyük gölgeler/degradeler bastırılır.
3. Referans "temiz duvar" görüntüsüne göre fark: yalnızca SONRADAN beliren
   koyu lekeler (kalıcı lekeler, priz delikleri vb. referansta olduğu için elenir).
4. Yasak bölge maskesi (pencere, TV, perde, priz, insan bölgesi...)
5. Kontur filtresi: alan, dairesellik, en/boy oranı, kontrast
6. Durağanlık takibi: hedef N kare boyunca r piksel içinde kalmalı -> ONAY

Not: Klasik MOG2 arka plan çıkarma, duran sineği birkaç saniyede arka plana
"emer". Bu yüzden burada sabit referans + yavaş, maskeli referans güncellemesi
kullanılır.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class DetectorConfig:
    blur_ksize: int = 3
    blackhat_ksize: int = 15          # beklenen hedef çapının ~2-3 katı (piksel)
    blackhat_thresh: int = 18         # gri seviye
    diff_thresh: int = 14             # referansa göre kararma eşiği
    min_area_px: int = 4
    max_area_px: int = 400
    min_circularity: float = 0.25     # 4πA/P² (sinek ~0.4-0.8)
    max_aspect: float = 3.5
    stationary_frames: int = 12       # onay için ardışık kare sayısı
    stationary_radius_px: float = 2.5
    max_misses: int = 4
    ref_learning_rate: float = 0.02   # referansın yavaş güncellenmesi (ışık değişimi)
    global_change_thresh: float = 12.0  # ortalama parlaklık sıçraması -> sıfırla
    border_px: int = 12               # görüntü kenarı (vinyet/lens kenarı) yok sayılır


@dataclass
class Track:
    id: int
    x: float
    y: float
    area: float
    hits: int = 1
    misses: int = 0
    history: list = field(default_factory=list)
    confirmed: bool = False

    @property
    def pos(self) -> tuple[float, float]:
        return self.x, self.y


@dataclass
class Detection:
    x: float
    y: float
    area: float
    contrast: float
    bbox: tuple[int, int, int, int]


class FlyDetector:
    def __init__(self, cfg: DetectorConfig | None = None, exclusion_mask: np.ndarray | None = None):
        self.cfg = cfg or DetectorConfig()
        self.exclusion = exclusion_mask   # 255 = YASAK bölge
        self.ref: np.ndarray | None = None   # float32 gri referans
        self.tracks: list[Track] = []
        self.spent: list[tuple[float, float, float]] = []  # (x, y, r) atış yapılmış bölgeler
        self._ids = itertools.count(1)
        self._k = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (self.cfg.blackhat_ksize, self.cfg.blackhat_ksize))
        self.last_mask: np.ndarray | None = None

    # ---------------------------------------------------------------------
    def _gray(self, frame: np.ndarray) -> np.ndarray:
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        k = self.cfg.blur_ksize
        return cv2.GaussianBlur(g, (k, k), 0) if k > 1 else g

    def set_reference(self, frames: list[np.ndarray] | np.ndarray) -> None:
        """Temiz duvar referansı. Birden çok kare verilirse medyan alınır."""
        if isinstance(frames, np.ndarray):
            frames = [frames]
        stack = np.stack([self._gray(f) for f in frames])
        self.ref = np.median(stack, axis=0).astype(np.float32)
        self.tracks.clear()

    def refresh_reference_roi(self, frame: np.ndarray, x: float, y: float, r: int = 12) -> None:
        """Atıştan sonra (iz/yanık oluşabilir) hedef çevresindeki referansı yenile."""
        if self.ref is None:
            return
        g = self._gray(frame).astype(np.float32)
        h, w = g.shape
        x0, x1 = max(0, int(x) - r), min(w, int(x) + r + 1)
        y0, y1 = max(0, int(y) - r), min(h, int(y) + r + 1)
        self.ref[y0:y1, x0:x1] = g[y0:y1, x0:x1]

    def mark_spent(self, x: float, y: float, r: float = 6.0) -> None:
        self.spent.append((x, y, r))
        self.tracks = [t for t in self.tracks if (t.x - x) ** 2 + (t.y - y) ** 2 > r * r]

    # ---------------------------------------------------------------------
    def detect(self, frame: np.ndarray) -> list[Detection]:
        cfg = self.cfg
        g = self._gray(frame)
        if self.ref is None:
            self.set_reference(frame)

        # Global ışık değişimi (lamba açıldı/kapandı) -> referansı yeniden al
        if abs(float(g.mean()) - float(self.ref.mean())) > cfg.global_change_thresh:
            self.set_reference(frame)
            return []

        bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, self._k)
        m_dark = bh > cfg.blackhat_thresh
        darker = self.ref - g.astype(np.float32)          # pozitif = referanstan koyu
        m_new = darker > cfg.diff_thresh
        mask = (m_dark & m_new).astype(np.uint8) * 255
        if self.exclusion is not None:
            mask[self.exclusion > 0] = 0
        b = cfg.border_px
        if b > 0:
            mask[:b, :] = 0
            mask[-b:, :] = 0
            mask[:, :b] = 0
            mask[:, -b:] = 0
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        self.last_mask = mask

        # Referansı, tespit OLMAYAN piksellerde yavaşça güncelle (ışık kayması)
        upd = cv2.dilate(mask, np.ones((9, 9), np.uint8)) == 0
        g32 = g.astype(np.float32)
        self.ref[upd] += cfg.ref_learning_rate * (g32[upd] - self.ref[upd])

        dets: list[Detection] = []
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in contours:
            area = cv2.contourArea(c)
            npx = max(area, float(len(c)))
            if not (cfg.min_area_px <= npx <= cfg.max_area_px):
                continue
            per = cv2.arcLength(c, True)
            circ = 4 * np.pi * area / (per * per) if per > 0 and area > 0 else 1.0
            x, y, w, h = cv2.boundingRect(c)
            aspect = max(w, h) / max(1, min(w, h))
            if npx > 12 and circ < cfg.min_circularity:
                continue
            if aspect > cfg.max_aspect:
                continue
            # Kontrast ağırlıklı alt-piksel merkez
            roi = bh[y:y + h, x:x + w].astype(np.float32) * (mask[y:y + h, x:x + w] > 0)
            s = roi.sum()
            if s <= 0:
                continue
            ys, xs = np.mgrid[y:y + h, x:x + w]
            cx, cy = float((xs * roi).sum() / s), float((ys * roi).sum() / s)
            if any((cx - sx) ** 2 + (cy - sy) ** 2 < sr * sr for sx, sy, sr in self.spent):
                continue
            dets.append(Detection(cx, cy, npx, float(roi.max()), (x, y, w, h)))
        return dets

    # ---------------------------------------------------------------------
    def update(self, frame: np.ndarray) -> list[Track]:
        """Kareyi işle, durağanlığı onaylanmış hedef izlerini döndür."""
        cfg = self.cfg
        dets = self.detect(frame)
        used = set()
        for t in self.tracks:
            best, bd = None, (cfg.stationary_radius_px * 2) ** 2
            for i, d in enumerate(dets):
                if i in used:
                    continue
                dd = (d.x - t.x) ** 2 + (d.y - t.y) ** 2
                if dd < bd:
                    best, bd = i, dd
            if best is None:
                t.misses += 1
                continue
            d = dets[best]
            used.add(best)
            t.history.append((d.x, d.y))
            t.history = t.history[-cfg.stationary_frames:]
            t.x = float(np.mean([p[0] for p in t.history]))
            t.y = float(np.mean([p[1] for p in t.history]))
            t.area = d.area
            t.hits += 1
            t.misses = 0
            spread = max(np.hypot(px - t.x, py - t.y) for px, py in t.history)
            if t.hits >= cfg.stationary_frames and spread <= cfg.stationary_radius_px:
                t.confirmed = True
            elif spread > cfg.stationary_radius_px:
                t.confirmed = False   # hareket etti -> tekrar beklet
        for i, d in enumerate(dets):
            if i not in used:
                self.tracks.append(Track(next(self._ids), d.x, d.y, d.area, history=[(d.x, d.y)]))
        self.tracks = [t for t in self.tracks if t.misses <= cfg.max_misses]
        return [t for t in self.tracks if t.confirmed]


# --------------------------------------------------------------------------
# Nişan (kırmızı) lazer noktası tespiti — kapalı çevrim düzeltme için
# --------------------------------------------------------------------------
def find_laser_spot(frame_on: np.ndarray, frame_off: np.ndarray, min_peak: int = 20):
    """Nişan lazeri AÇIK ve KAPALI iki kare arasındaki farktan nokta merkezini bulur.

    Kromatik fark kullanılır: kırmızı lazer R kanalını G/B'den çok daha fazla
    artırır. Ortam ışığı, sahne içeriği ve iki kare arasında yer değiştiren
    (gri) cisimler -> dR ≈ dG ≈ dB -> birbirini götürür.
    İpucu: gerçek kamerada nokta yakalarken pozlamayı düşürün (R kanalı doymasın).
    Dönen: (u, v) alt-piksel ya da None.
    """
    on = frame_on.astype(np.int16)
    off = frame_off.astype(np.int16)
    dB, dG, dR = (on[..., i] - off[..., i] for i in range(3))
    d = dR - 0.5 * (dG + dB)
    d = np.clip(d, 0, 255).astype(np.uint8)
    d = cv2.GaussianBlur(d, (5, 5), 0)
    _, maxv, _, (mx, my) = cv2.minMaxLoc(d)
    if maxv < min_peak:
        return None
    r = 6
    h, w = d.shape
    x0, x1, y0, y1 = max(0, mx - r), min(w, mx + r + 1), max(0, my - r), min(h, my + r + 1)
    roi = d[y0:y1, x0:x1].astype(np.float32)
    roi = np.clip(roi - 0.5 * maxv, 0, None)
    s = roi.sum()
    ys, xs = np.mgrid[y0:y1, x0:x1]
    return float((xs * roi).sum() / s), float((ys * roi).sum() / s)
