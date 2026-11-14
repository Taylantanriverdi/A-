"""Gerçek donanım çalıştırıcısı (Raspberry Pi 5 + Camera Module 3 + Arduino Nano).

    # 1) Kalibrasyon (duvara yanmaz kalibrasyon kartı bantlanmış, oda boş, gözlük takılı)
    python main.py --port /dev/ttyUSB0 --calibrate --card 300,560

    # 2) Çalışma (yalnızca kuru çalışma: lazer ateşlenmez, sadece nişan noktası)
    python main.py --port /dev/ttyUSB0 --dry-run

    # 3) Otonom çalışma
    python main.py --port /dev/ttyUSB0 --arm --mask yasak_bolge.png
"""
from __future__ import annotations

import argparse
import time

import cv2
import numpy as np

from flylaser.detector import DetectorConfig, FlyDetector
from flylaser.engage import (EngageConfig, Engagement, hull_from_model_grid,
                             measure_pointer_offset, run_calibration)
from flylaser.kinematics import PixelToTurret, calibration_grid
from flylaser.turret import SerialTurret

W, H = 1280, 720


class PiCamera:
    """Picamera2 ile SABİT pozlama/beyaz dengesi/odak. Otomatik pozlama açık kalırsa
    lazer noktası ve ışık değişimleri referans farkını bozar."""

    def __init__(self, exposure_us=8000, gain=2.0, lens_dioptre=0.6):
        from picamera2 import Picamera2
        from libcamera import controls
        self.cam = Picamera2()
        cfg = self.cam.create_video_configuration(main={"size": (W, H), "format": "BGR888"},
                                                  controls={"FrameRate": 30})
        self.cam.configure(cfg)
        self.cam.start()
        time.sleep(1.0)
        self.cam.set_controls({
            "AeEnable": False, "AwbEnable": False,
            "ExposureTime": exposure_us, "AnalogueGain": gain,
            "AfMode": controls.AfModeEnum.Manual,
            "LensPosition": lens_dioptre,       # 1/mesafe(m): 1.6 m -> ~0.6
        })
        time.sleep(0.5)

    def read(self):
        return self.cam.capture_array("main")


class UsbCamera:
    def __init__(self, index=0):
        self.cap = cv2.VideoCapture(index)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, W)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, H)
        self.cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1)   # V4L2: 1 = manuel
        self.cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)

    def read(self):
        ok, f = self.cap.read()
        if not ok:
            raise RuntimeError("Kamera karesi alınamadı")
        return f


class DryRunTurret:
    """Gerçek tareti sarar; fire() çağrısını yutar (lazer ASLA ateşlenmez)."""

    def __init__(self, inner):
        self.inner = inner

    def __getattr__(self, k):
        return getattr(self.inner, k)

    def arm(self, on):
        return True

    def fire(self, ms, pwm=255):
        print(f"[dry-run] ATEŞ ({ms} ms, pwm={pwm}) — yutuldu")
        return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--usb-cam", type=int, default=None)
    ap.add_argument("--calib", default="calib.json")
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--card", default=None, help="kalibrasyon kartının piksel konumu u,v")
    ap.add_argument("--mask", default=None, help="yasak bölge maskesi (beyaz=yasak) PNG")
    ap.add_argument("--arm", action="store_true", help="otonom angajmanı etkinleştir")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--show", action="store_true")
    a = ap.parse_args()

    cam = UsbCamera(a.usb_cam) if a.usb_cam is not None else PiCamera()
    turret = SerialTurret(a.port)
    if a.dry_run:
        turret = DryRunTurret(turret)

    try:
        grid = calibration_grid((-25, 25), (-15, 15), 7, 5)
        if a.calibrate:
            model = run_calibration(turret, cam, (W, H), grid=grid)
            if a.card:
                u, v = map(float, a.card.split(","))
                input("Kalibrasyon kartı yerinde, oda boş, gözlükler takılı mı? [Enter] ")
                measure_pointer_offset(turret, cam, model, (u, v), pulse_ms=10, pwm=60)
            model.save(a.calib)
            print(f"Kaydedildi: {a.calib}")
            return
        model = PixelToTurret.load(a.calib)
        mask = cv2.imread(a.mask, cv2.IMREAD_GRAYSCALE) if a.mask else None
        det = FlyDetector(DetectorConfig(), exclusion_mask=mask)
        det.set_reference([cam.read() for _ in range(15)])
        eng = Engagement(turret, cam, model, det, EngageConfig(),
                         calib_hull=hull_from_model_grid(model, grid))
        eng.enabled = a.arm or a.dry_run
        while True:
            frame, targets = eng.step()
            if a.show:
                vis = frame.copy()
                for t in eng.det.tracks:
                    cv2.circle(vis, (int(t.x), int(t.y)), 10, (0, 0, 255) if t.confirmed else (0, 200, 255), 1)
                cv2.putText(vis, eng.state, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                cv2.imshow("taret", vis)
                if cv2.waitKey(1) == 27:
                    break
    finally:
        turret.close()


if __name__ == "__main__":
    main()
