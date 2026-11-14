"""Kalibrasyon rutinleri ve angajman (hedefleme -> doğrulama -> atış) durum makinesi.

Kamera nesnesi: .read() -> BGR numpy kare döndürmeli.
Taret nesnesi : flylaser.turret.Turret protokolünü sağlamalı.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from .detector import FlyDetector, Track, find_laser_spot
from .kinematics import PixelToTurret, calibration_grid


# --------------------------------------------------------------------------
# Yardımcı: birkaç kare at (kamera tamponundaki bayat kareleri boşalt)
# --------------------------------------------------------------------------
def fresh_frame(camera, flush: int = 2):
    f = None
    for _ in range(flush + 1):
        f = camera.read()
    return f


def capture_spot(turret, camera, settle_s: float = 0.25, sleep=time.sleep):
    """Nişan lazeri kapalı/açık kare çifti ile nokta pikselini ölç."""
    turret.pointer(False)
    sleep(settle_s)
    off = fresh_frame(camera)
    turret.pointer(True)
    sleep(0.05)
    on = fresh_frame(camera)
    turret.pointer(False)
    return find_laser_spot(on, off)


# --------------------------------------------------------------------------
# 1) Nişan noktası ile homografi kalibrasyonu
# --------------------------------------------------------------------------
def run_calibration(turret, camera, img_size, grid=None, sleep=time.sleep, log=print,
                    approach_deg: float = 0.8) -> PixelToTurret:
    grid = grid or calibration_grid()
    pix, ang = [], []
    for i, (p, t) in enumerate(grid):
        turret.move(p - approach_deg, t - approach_deg)   # anti-boşluk yaklaşımı
        turret.wait_settled(1.5)
        turret.move(p, t)
        turret.wait_settled(1.5)
        spot = capture_spot(turret, camera, sleep=sleep)
        if spot is None:
            log(f"[kalib] {i + 1}/{len(grid)} pan={p:+.1f} tilt={t:+.1f}: nokta YOK, atlandı")
            continue
        pix.append(spot)
        ang.append((p, t))
        log(f"[kalib] {i + 1}/{len(grid)} pan={p:+.1f} tilt={t:+.1f} -> ({spot[0]:.1f}, {spot[1]:.1f})")
    model = PixelToTurret(img_size=img_size)
    rms_deg = model.fit(np.array(pix), np.array(ang))
    # piksel cinsinden geri-izdüşüm hatası (ters yön Jacobian ile yaklaşık)
    errs = []
    for (u, v), (p, t) in zip(pix, ang):
        J = model.jacobian(u, v)
        dp = np.array(model.predict(u, v)) - np.array([p, t])
        errs.append(np.linalg.norm(np.linalg.solve(J, dp)))
    model.rms_px = float(np.sqrt(np.mean(np.square(errs))))
    log(f"[kalib] {len(pix)} nokta, RMS = {rms_deg:.3f}° ≈ {model.rms_px:.2f} px")
    return model


# --------------------------------------------------------------------------
# 2) Nişan noktası <-> güç ışını ofseti (YALNIZCA yanmaz kalibrasyon kartında!)
# --------------------------------------------------------------------------
def measure_pointer_offset(turret, camera, model: PixelToTurret, card_px, pulse_ms=8, pwm=40,
                           sleep=time.sleep, log=print):
    """Kalibrasyon kartına (ör. çimento levha üzerine mat kâğıt) düşük güçlü kısa
    bir darbe atar; yanık izi ile kırmızı nokta arasındaki piksel farkını ölçer."""
    pan, tilt = model.predict(*card_px)
    turret.move(pan - 0.8, tilt - 0.8)
    turret.wait_settled(1.5)
    turret.move(pan, tilt)
    turret.wait_settled(1.5)
    dot = capture_spot(turret, camera, sleep=sleep)
    before = cv2.cvtColor(fresh_frame(camera), cv2.COLOR_BGR2GRAY).astype(np.int16)
    turret.arm(True)
    sleep(1.6)                       # firmware ARM uyarı süresi
    turret.fire(pulse_ms, pwm)
    sleep(0.2)
    turret.arm(False)
    after = cv2.cvtColor(fresh_frame(camera), cv2.COLOR_BGR2GRAY).astype(np.int16)
    d = cv2.GaussianBlur(np.clip(before - after, 0, 255).astype(np.uint8), (3, 3), 0)
    _, mv, _, (bx, by) = cv2.minMaxLoc(d)
    if dot is None or mv < 10:
        log("[ofset] ölçülemedi (nokta ya da yanık izi görünmedi)")
        return None
    off = (dot[0] - bx, dot[1] - by)
    model.pointer_offset_px = off
    model.offset_calibrated = True
    log(f"[ofset] nokta-ışın ofseti = ({off[0]:+.1f}, {off[1]:+.1f}) px")
    return off


# --------------------------------------------------------------------------
# 3) Angajman
# --------------------------------------------------------------------------
@dataclass
class EngageConfig:
    fire_ms: int = 40               # darbe süresi
    fire_pwm: int = 255
    tol_px: float = 2.0             # nişan hatası toleransı (hedef boyunun ~%35'i)
    approach_deg: float = 0.8       # anti-boşluk: hedefe hep aynı yönden yaklaş
    max_iters: int = 4              # kapalı çevrim düzeltme iterasyonu
    verify_delay_s: float = 0.5
    cooldown_s: float = 1.5
    motion_frac: float = 0.02       # karenin %2'si değiştiyse -> insan/evcil hayvan şüphesi
    motion_hold_s: float = 10.0
    arm_warn_s: float = 1.6         # firmware ARM_WARN_MS (buzzer uyarısı) + pay
    pan_limits: tuple = (-45.0, 45.0)
    tilt_limits: tuple = (-30.0, 30.0)


@dataclass
class EngageStats:
    shots: int = 0
    aborted: int = 0
    verified_kills: int = 0
    log: list = field(default_factory=list)


class Engagement:
    def __init__(self, turret, camera, model: PixelToTurret, detector: FlyDetector,
                 cfg: EngageConfig | None = None, clock=time.monotonic, sleep=time.sleep,
                 calib_hull: np.ndarray | None = None, log=print):
        self.t, self.cam, self.m, self.det = turret, camera, model, detector
        self.cfg = cfg or EngageConfig()
        self.clock, self.sleep, self.log = clock, sleep, log
        self.hull = calib_hull          # kalibre edilen piksel bölgesi (dışına ateş yok)
        self.stats = EngageStats()
        self._prev_gray = None
        self._hold_until = 0.0
        self._last_shot = -1e9
        self.enabled = False
        self.armed = False
        self.state = "IDLE"

    def set_armed(self, on: bool):
        if on and not self.armed:
            self.t.arm(True)
            self.armed = True
            self.sleep(self.cfg.arm_warn_s)     # buzzer uyarı süresi, firmware bu sürede ateşi reddeder
        elif not on and self.armed:
            self.t.arm(False)
            self.armed = False

    # ---------------- güvenlik kapıları -----------------------------------
    def motion_gate(self, frame) -> bool:
        """Büyük sahne hareketi -> belirli süre ateş yasak. True = güvenli."""
        g = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (160, 90))
        g = cv2.GaussianBlur(g, (5, 5), 0)
        now = self.clock()
        if self._prev_gray is not None:
            frac = float(np.mean(cv2.absdiff(g, self._prev_gray) > 25))
            if frac > self.cfg.motion_frac:
                if now >= self._hold_until:
                    self.log(f"[güvenlik] büyük hareket (%{frac * 100:.1f}) -> {self.cfg.motion_hold_s:.0f} s bekleme")
                self._hold_until = now + self.cfg.motion_hold_s
        self._prev_gray = g
        return now >= self._hold_until

    def in_envelope(self, u, v, pan, tilt) -> bool:
        c = self.cfg
        if not (c.pan_limits[0] <= pan <= c.pan_limits[1] and c.tilt_limits[0] <= tilt <= c.tilt_limits[1]):
            return False
        if self.hull is not None and cv2.pointPolygonTest(self.hull, (float(u), float(v)), False) < 0:
            return False
        return True

    # ---------------- ana adım ----------------------------------------------
    def step(self):
        frame = self.cam.read()
        safe = self.motion_gate(frame)
        targets = self.det.update(frame)
        if not safe:
            self.state = "HOLD"
            self.t.pointer(False)
            self.set_armed(False)
            return frame, targets
        self.state = "SCAN" if self.enabled else "IDLE"
        if not self.enabled:
            self.set_armed(False)
            return frame, targets
        if not targets:
            return frame, targets
        if self.clock() - self._last_shot < self.cfg.cooldown_s:
            return frame, targets
        tgt = max(targets, key=lambda tr: tr.hits)
        self.engage(tgt)
        return frame, targets

    def approach(self, pan, tilt):
        """Dişli boşluğu (backlash) ve servo ölü bandını yenmek için hedefe her
        zaman aynı yönden, ölü banttan büyük bir adımla yaklaş."""
        a = self.cfg.approach_deg
        self.t.move(pan - a, tilt - a)
        self.t.wait_settled(1.0)
        self.t.move(pan, tilt)
        self.t.wait_settled(1.0)

    def engage(self, tgt: Track) -> bool:
        c = self.cfg
        u, v = tgt.pos
        if not getattr(self.m, "offset_calibrated", False):
            self.log("[angaj] nokta-ışın ofseti kalibre edilmemiş -> ATIŞ YASAK")
            self.enabled = False
            return False
        ox, oy = self.m.pointer_offset_px
        want_dot = np.array([u + ox, v + oy])     # nokta buraya düşerse ışın hedefe düşer
        pan, tilt = self.m.predict(*want_dot)
        if not self.in_envelope(u, v, pan, tilt):
            self.log(f"[angaj] #{tgt.id} ({u:.0f},{v:.0f}) -> pan={pan:+.1f} tilt={tilt:+.1f} çalışma zarfı dışında, iptal")
            self.det.mark_spent(u, v, 8)
            self.stats.aborted += 1
            return False

        self.state = "AIM"
        ok = False
        for it in range(c.max_iters):
            self.approach(pan, tilt)
            spot = capture_spot(self.t, self.cam, settle_s=0.12, sleep=self.sleep)
            if spot is None:
                break
            err = np.array(spot) - want_dot
            self.log(f"[angaj] #{tgt.id} iter{it}: hata=({err[0]:+.2f},{err[1]:+.2f}) px")
            if np.hypot(*err) <= c.tol_px:
                ok = True
                break
            # Görsel servo düzeltmesi: açı += model(hedef) - model(ölçülen)
            dp = np.array(self.m.predict(*want_dot)) - np.array(self.m.predict(*spot))
            pan, tilt = pan + dp[0], tilt + dp[1]
            if not self.in_envelope(u, v, pan, tilt):
                break
        if not ok:
            self.log(f"[angaj] #{tgt.id} nişan doğrulanamadı, iptal")
            self.stats.aborted += 1
            return False

        # Son güvenlik kontrolü: tetikten hemen önce taze kare
        frame = self.cam.read()
        if not self.motion_gate(frame):
            self.stats.aborted += 1
            return False

        if not self.armed:
            self.set_armed(True)
            if not self.motion_gate(self.cam.read()):   # uyarı süresinde biri girdiyse
                self.set_armed(False)
                self.stats.aborted += 1
                return False
        self.state = "FIRE"
        fired = self.t.fire(c.fire_ms, c.fire_pwm)
        self._last_shot = self.clock()
        self.stats.shots += int(bool(fired))

        # Doğrulama: hedef yerinde mi?
        self.state = "VERIFY"
        self.sleep(c.verify_delay_s)
        after = fresh_frame(self.cam)
        still = [d for d in self.det.detect(after) if np.hypot(d.x - u, d.y - v) < 4]
        if not still:
            self.stats.verified_kills += 1
            self.log(f"[angaj] #{tgt.id} ETKİSİZ ({u:.1f},{v:.1f})")
        else:
            self.log(f"[angaj] #{tgt.id} hedef hâlâ görünüyor")
        self.det.mark_spent(u, v, 6)
        self.det.refresh_reference_roi(after, u, v)
        self.state = "SCAN"
        return True


def hull_from_model_grid(model: PixelToTurret, grid, shrink: float = 0.95) -> np.ndarray:
    """Kalibrasyon ızgarasının görüntüdeki dışbükey zarfı (hafif daraltılmış)."""
    # ızgara açılarından piksele: ters problemi sayısal çöz
    pts = []
    w, h = model.img_size
    uu, vv = np.meshgrid(np.linspace(0, w - 1, 64), np.linspace(0, h - 1, 36))
    pred = np.array([model.predict(u, v) for u, v in zip(uu.ravel(), vv.ravel())])
    ga = np.array(grid)
    inside = ((pred[:, 0] >= ga[:, 0].min()) & (pred[:, 0] <= ga[:, 0].max()) &
              (pred[:, 1] >= ga[:, 1].min()) & (pred[:, 1] <= ga[:, 1].max()))
    pts = np.stack([uu.ravel()[inside], vv.ravel()[inside]], axis=1).astype(np.float32)
    if len(pts) < 3:
        return None
    hull = cv2.convexHull(pts)
    c = hull.mean(axis=0)
    return ((hull - c) * shrink + c).astype(np.float32)
