import math
import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flylaser.detector import FlyDetector, find_laser_spot
from flylaser.kinematics import PixelToTurret, ab_to_angles, angles_to_ab, calibration_grid
from flylaser.turret import checksum, frame, parse


def test_ab_roundtrip():
    for p in (-40, -10, 0, 7.5, 33):
        for t in (-25, 0, 12, 30):
            pp, tt = ab_to_angles(*angles_to_ab(p, t))
            assert abs(pp - p) < 1e-9 and abs(tt - t) < 1e-9


def test_homography_recovers_parallax_geometry():
    """Kamera ve taret farklı noktalarda; düzlemsel duvar -> homografi tam olmalı."""
    K = np.array([[1000, 0, 640], [0, 1000, 360], [0, 0, 1.0]])
    T = np.array([0.08, -0.05, 0.0])            # paralaks ofseti
    n, d0 = np.array([0.1, 0, -1.0]), -1.5      # eğik duvar: n·X = d0
    n = n / np.linalg.norm(n); d0 = d0 / np.linalg.norm([0.1, 0, -1.0])
    pix, ang = [], []
    for p, t in calibration_grid((-20, 20), (-12, 12), 5, 4):
        pr, tr = math.radians(p), math.radians(t)
        d = np.array([math.sin(pr) * math.cos(tr), math.sin(tr), math.cos(pr) * math.cos(tr)])
        s = (d0 - n @ T) / (n @ d)
        X = T + s * d
        u = K @ X
        pix.append((u[0] / u[2], u[1] / u[2])); ang.append((p, t))
    m = PixelToTurret()
    rms = m.fit(np.array(pix), np.array(ang), use_residual=False)
    assert rms < 1e-6


def test_detector_finds_stationary_spot_and_ignores_stain():
    rng = np.random.default_rng(0)
    base = np.full((360, 640, 3), 190, np.uint8)
    cv2.circle(base, (100, 100), 3, (110, 110, 110), -1)      # kalıcı leke
    det = FlyDetector()
    det.set_reference([np.clip(base + rng.normal(0, 2, base.shape), 0, 255).astype(np.uint8) for _ in range(3)])
    confirmed = []
    for _ in range(20):
        f = base.copy()
        cv2.ellipse(f, (320, 180), (3, 2), 30, 0, 360, (40, 40, 40), -1)
        f = np.clip(f + rng.normal(0, 2, f.shape), 0, 255).astype(np.uint8)
        confirmed = det.update(f)
    assert len(confirmed) == 1
    assert abs(confirmed[0].x - 320) < 1 and abs(confirmed[0].y - 180) < 1


def test_laser_spot_subpixel():
    off = np.full((200, 200, 3), 150, np.uint8)
    on = off.astype(np.float32)
    yy, xx = np.mgrid[0:200, 0:200]
    g = np.exp(-((xx - 87.3) ** 2 + (yy - 120.6) ** 2) / (2 * 1.5 ** 2))
    on[..., 2] += 100 * g
    on[..., 1] += 15 * g
    u, v = find_laser_spot(np.clip(on, 0, 255).astype(np.uint8), off)
    assert abs(u - 87.3) < 0.3 and abs(v - 120.6) < 0.3


def test_protocol_checksum():
    assert parse(frame("M,-1250,830").decode()) == "M,-1250,830"
    assert parse("$M,1,2*00") is None
    assert checksum("H") == "48"


@pytest.mark.slow
def test_end_to_end_simulation():
    from sim.simulator import run_headless
    stats, world = run_headless(40, seed=3, verbose=False)
    assert world.safety_violations == 0
    assert stats.verified_kills >= 1
    assert world.scorches - 1 <= stats.shots - stats.verified_kills
