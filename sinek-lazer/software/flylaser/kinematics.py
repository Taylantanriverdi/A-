"""Piksel -> Pan/Tilt açı dönüşümü ve kalibrasyon.

Matematiksel temel
------------------
Pan ekseni dikey (Y), tilt ekseni pan ile birlikte dönen yatay eksen olsun.
Taret çerçevesinde lazer yönü:

    d(pan, tilt) = ( sin(pan)·cos(tilt),  sin(tilt),  cos(pan)·cos(tilt) )

Taret "sanal görüntü düzlemi" (Z=1) koordinatları:

    a = X/Z = tan(pan)
    b = Y/Z = tan(tilt) / cos(pan) = tan(tilt) · sqrt(1 + a²)

Duvar bir DÜZLEM olduğu için:
    kamera pikseli (u,v)  --H_cam-->  duvar düzlemi  --H_tur-->  taret (a,b)
iki homografinin çarpımı yine bir homografidir. Yani lens distorsiyonu
giderildikten sonra (u,v) -> (a,b) TAM OLARAK bir 3x3 homografi H ile ifade
edilir. Kamera–lazer arasındaki paralaks (eksen kayıklığı) bu homografinin
içinde kendiliğinden çözülür; ayrıca derinlik ölçmeye gerek yoktur.

Gerçek dünyadaki küçük model dışı hatalar (servo doğrusal olmama, eksenlerin
tam kesişmemesi, lens distorsiyonu artığı) 2. derece polinom artık düzeltmesi
ile, kalanı da atış öncesi kapalı çevrim (nişan noktası) düzeltmesiyle sıfırlanır.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np


# --------------------------------------------------------------------------
# Açı <-> (a, b) dönüşümleri
# --------------------------------------------------------------------------
def angles_to_ab(pan_deg: float, tilt_deg: float) -> tuple[float, float]:
    p = math.radians(pan_deg)
    t = math.radians(tilt_deg)
    a = math.tan(p)
    b = math.tan(t) * math.sqrt(1.0 + a * a)
    return a, b


def ab_to_angles(a: float, b: float) -> tuple[float, float]:
    pan = math.degrees(math.atan(a))
    tilt = math.degrees(math.atan(b / math.sqrt(1.0 + a * a)))
    return pan, tilt


def direction_from_angles(pan_deg: float, tilt_deg: float) -> np.ndarray:
    p = math.radians(pan_deg)
    t = math.radians(tilt_deg)
    return np.array([math.sin(p) * math.cos(t), math.sin(t), math.cos(p) * math.cos(t)])


def _poly2_terms(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """2. derece polinom tasarım matrisi: [1, u, v, u², uv, v²]."""
    return np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], axis=1)


# --------------------------------------------------------------------------
# Kalibrasyon modeli
# --------------------------------------------------------------------------
@dataclass
class PixelToTurret:
    H: np.ndarray = field(default_factory=lambda: np.eye(3))
    # Artık düzeltme katsayıları (derece cinsinden), normalize piksel üzerinde
    res_pan: np.ndarray | None = None
    res_tilt: np.ndarray | None = None
    img_size: tuple[int, int] = (1280, 720)
    # Nişan (kırmızı) noktası - güç (mavi) ışını isabet noktası, piksel
    pointer_offset_px: tuple[float, float] = (0.0, 0.0)
    rms_px: float = float("nan")
    offset_calibrated: bool = False

    # ---- yardımcılar -----------------------------------------------------
    def _norm(self, u, v):
        w, h = self.img_size
        return (np.asarray(u, float) - w / 2) / (w / 2), (np.asarray(v, float) - h / 2) / (h / 2)

    # ---- uydurma (fit) ----------------------------------------------------
    def fit(self, pixels: np.ndarray, angles_deg: np.ndarray, use_residual: bool = True) -> float:
        """pixels: Nx2 (u,v) gözlenen nokta pikseli, angles_deg: Nx2 (pan,tilt) komut.

        Dönen değer: ileri model ile geri izdüşüm hatasının RMS'i (derece).
        """
        pixels = np.asarray(pixels, np.float64)
        angles_deg = np.asarray(angles_deg, np.float64)
        if len(pixels) < 4:
            raise ValueError("Homografi için en az 4 nokta gerekir (önerilen >= 9)")
        ab = np.array([angles_to_ab(p, t) for p, t in angles_deg])
        H, _ = cv2.findHomography(pixels, ab, method=0)
        if H is None:
            raise RuntimeError("Homografi hesaplanamadı (noktalar dejenere olabilir)")
        self.H = H
        self.res_pan = self.res_tilt = None

        if use_residual and len(pixels) >= 12:
            pred = np.array([self._predict_h(u, v) for u, v in pixels])
            err = angles_deg - pred
            un, vn = self._norm(pixels[:, 0], pixels[:, 1])
            A = _poly2_terms(un, vn)
            self.res_pan, *_ = np.linalg.lstsq(A, err[:, 0], rcond=None)
            self.res_tilt, *_ = np.linalg.lstsq(A, err[:, 1], rcond=None)

        pred = np.array([self.predict(u, v) for u, v in pixels])
        return float(np.sqrt(np.mean(np.sum((pred - angles_deg) ** 2, axis=1))))

    # ---- tahmin ------------------------------------------------------------
    def _predict_h(self, u: float, v: float) -> tuple[float, float]:
        q = self.H @ np.array([u, v, 1.0])
        return ab_to_angles(q[0] / q[2], q[1] / q[2])

    def predict(self, u: float, v: float) -> tuple[float, float]:
        """Hedef pikseli (u,v) -> (pan_deg, tilt_deg)."""
        pan, tilt = self._predict_h(u, v)
        if self.res_pan is not None:
            un, vn = self._norm(np.array([u]), np.array([v]))
            A = _poly2_terms(un, vn)
            pan += (A @ self.res_pan).item()
            tilt += (A @ self.res_tilt).item()
        return pan, tilt

    def predict_for_beam(self, u: float, v: float) -> tuple[float, float]:
        """Güç lazerinin (u,v)'ye düşmesi için gereken açı.

        Kalibrasyon kırmızı nişan noktasıyla yapıldığından model "nokta pikseli
        -> açı" eşler. Işın (u,v)'ye düşecekse nokta (u+ox, v+oy)'de olmalıdır.
        """
        ox, oy = self.pointer_offset_px
        return self.predict(u + ox, v + oy)

    def jacobian(self, u: float, v: float, eps: float = 2.0) -> np.ndarray:
        """d(pan,tilt)/d(u,v) [derece/piksel] — hassasiyet analizi için."""
        p0 = np.array(self.predict(u, v))
        pu = np.array(self.predict(u + eps, v))
        pv = np.array(self.predict(u, v + eps))
        return np.stack([(pu - p0) / eps, (pv - p0) / eps], axis=1)

    # ---- kalıcılık -----------------------------------------------------------
    def save(self, path: str | Path) -> None:
        data = {
            "H": self.H.tolist(),
            "res_pan": None if self.res_pan is None else self.res_pan.tolist(),
            "res_tilt": None if self.res_tilt is None else self.res_tilt.tolist(),
            "img_size": list(self.img_size),
            "pointer_offset_px": list(self.pointer_offset_px),
            "rms_px": self.rms_px,
            "offset_calibrated": self.offset_calibrated,
        }
        Path(path).write_text(json.dumps(data, indent=2))

    @classmethod
    def load(cls, path: str | Path) -> "PixelToTurret":
        d = json.loads(Path(path).read_text())
        m = cls(
            H=np.array(d["H"]),
            img_size=tuple(d["img_size"]),
            pointer_offset_px=tuple(d.get("pointer_offset_px", (0.0, 0.0))),
            rms_px=d.get("rms_px", float("nan")),
            offset_calibrated=d.get("offset_calibrated", False),
        )
        m.res_pan = None if d["res_pan"] is None else np.array(d["res_pan"])
        m.res_tilt = None if d["res_tilt"] is None else np.array(d["res_tilt"])
        return m


def calibration_grid(pan_range=(-20.0, 20.0), tilt_range=(-12.0, 12.0), n_pan=5, n_tilt=4):
    """Kalibrasyon için (pan, tilt) komut ızgarası (yılan sırası -> az servo hareketi)."""
    pts = []
    pans = np.linspace(*pan_range, n_pan)
    for j, t in enumerate(np.linspace(*tilt_range, n_tilt)):
        row = pans if j % 2 == 0 else pans[::-1]
        pts.extend((float(p), float(t)) for p in row)
    return pts
