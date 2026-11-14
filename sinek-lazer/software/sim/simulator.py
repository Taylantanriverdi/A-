"""Uçtan uca simülatör: OpenCV (görüntü işleme) + Pygame (görselleştirme).

Çalıştırma (software/ klasöründen):
    python -m sim.simulator               # pencereli, etkileşimli
    python -m sim.simulator --headless --seconds 120   # CI / hızlı test

Tuşlar (pencereli mod):
    C : kalibrasyon (nişan noktası ızgarası + ofset ölçümü)
    SPACE : otomatik angajmanı aç/kapat (yazılımsal ARM)
    F : rastgele yere oturan sinek ekle
    P : kadrajdan "insan" geçir (hareket kapısı testi)
    R : temiz duvar referansını yeniden al
    M : tespit maskesini göster/gizle
    ESC : çıkış
"""
from __future__ import annotations

import argparse
import os
import sys

import cv2
import numpy as np

from flylaser.detector import DetectorConfig, FlyDetector
from flylaser.engage import (EngageConfig, Engagement, hull_from_model_grid,
                             measure_pointer_offset, run_calibration)
from flylaser.kinematics import calibration_grid
from sim.world import SimCamera, SimTurret, SimWorld


def build(seed=1):
    world = SimWorld(seed=seed)
    cam = SimCamera(world)
    tur = SimTurret(world)
    sleep = world.step
    clock = lambda: world.t
    return world, cam, tur, sleep, clock


def calibrate(world, cam, tur, sleep, log=print):
    grid = calibration_grid((-30, 30), (-17, 17), 7, 5)
    saved = world.flies
    world.flies = []                      # kalibrasyon sırasında hedef yok
    model = run_calibration(tur, cam, (world.W, world.H), grid=grid, sleep=sleep, log=log)
    # Ofset ölçümü: duvarda "kalibrasyon kartı" bölgesine (sol alt) düşük güçlü darbe
    measure_pointer_offset(tur, cam, model, card_px=(300, 560), pulse_ms=10, pwm=200, sleep=sleep, log=log)
    world.flies = saved
    hull = hull_from_model_grid(model, grid)
    return model, hull


def make_engagement(world, cam, tur, sleep, clock, model, hull, log=print):
    det = FlyDetector(DetectorConfig())
    det.set_reference([cam.read() for _ in range(5)])
    eng = Engagement(tur, cam, model, det, EngageConfig(), clock=clock, sleep=sleep,
                     calib_hull=hull, log=log)
    return eng


# --------------------------------------------------------------------------
def run_headless(seconds: float, seed: int, verbose: bool):
    world, cam, tur, sleep, clock = build(seed)
    log = print if verbose else (lambda *a, **k: None)
    model, hull = calibrate(world, cam, tur, sleep, log=print)
    eng = make_engagement(world, cam, tur, sleep, clock, model, hull, log=log)
    eng.enabled = True
    t_end = world.t + seconds
    person_at = world.t + seconds * 0.5
    while world.t < t_end:
        if person_at and world.t >= person_at:
            world.person_x = -300.0
            person_at = None
            print(f"[sim] t={world.t:.1f}s  insan kadraja girdi")
        eng.step()
    s = eng.stats
    print("\n=== SİMÜLASYON SONUCU ===")
    print(f"süre                 : {seconds:.0f} s (sim)")
    print(f"kalibrasyon RMS      : {model.rms_px:.2f} px, ofset={tuple(round(x, 1) for x in model.pointer_offset_px)} px")
    print(f"atış                 : {s.shots}")
    print(f"doğrulanmış etkisiz  : {s.verified_kills}  (dünya sayacı: {world.kills})")
    print(f"iptal edilen         : {s.aborted}")
    print(f"duvar yanık izi      : {world.scorches - 1}  (1 tanesi kalibrasyon kartı)")
    print(f"firmware reddi       : {tur.refused}")
    print(f"GÜVENLİK İHLALİ      : {world.safety_violations}  (insan varken atış — 0 olmalı)")
    return s, world


# --------------------------------------------------------------------------
def run_gui(seed: int):
    import pygame

    world, cam, tur, sleep, clock = build(seed)
    pygame.init()
    screen = pygame.display.set_mode((world.W, world.H + 110))
    pygame.display.set_caption("Lazer Sinek Tareti — Simülatör")
    font = pygame.font.SysFont("monospace", 16)
    logs: list[str] = []

    def log(msg):
        logs.append(msg)
        del logs[:-5]
        print(msg)

    state = {"eng": None, "model": None, "hull": None, "mask": False, "last": None}

    def draw(frame):
        eng = state["eng"]
        vis = frame.copy()
        if state["mask"] and eng and eng.det.last_mask is not None:
            vis[eng.det.last_mask > 0] = (0, 255, 255)
        if state["hull"] is not None:
            cv2.polylines(vis, [state["hull"].astype(np.int32)], True, (0, 160, 0), 1)
        if eng:
            for t in eng.det.tracks:
                col = (0, 0, 255) if t.confirmed else (0, 200, 255)
                cv2.circle(vis, (int(t.x), int(t.y)), 10, col, 1, cv2.LINE_AA)
                cv2.putText(vis, f"#{t.id} {t.hits}", (int(t.x) + 12, int(t.y) - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, col, 1)
        surf = pygame.image.frombuffer(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB).tobytes(),
                                       (world.W, world.H), "RGB")
        screen.fill((20, 20, 24))
        screen.blit(surf, (0, 0))
        st = eng.state if eng else "KALİBRASYONSUZ"
        armed = "AÇIK" if (eng and eng.enabled) else "KAPALI"
        line = (f"t={world.t:6.1f}s  durum={st:7s}  oto-angajman={armed}  "
                f"etkisiz={world.kills}  yanık={world.scorches}  ihlal={world.safety_violations}  "
                f"pan={world.pan.actual:+.2f} tilt={world.tilt.actual:+.2f}")
        screen.blit(font.render(line, True, (230, 230, 230)), (8, world.H + 6))
        for i, m in enumerate(logs):
            screen.blit(font.render(m[:150], True, (160, 200, 160)), (8, world.H + 28 + i * 16))
        pygame.display.flip()
        for e in pygame.event.get():
            if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE):
                pygame.quit()
                sys.exit(0)
            if e.type == pygame.KEYDOWN:
                state["last"] = e.key

    cam.on_frame = draw   # kalibrasyon/angajman sırasında da ekran güncellensin
    clk = pygame.time.Clock()
    log("C: kalibrasyon | SPACE: oto-angajman | F: sinek | P: insan | R: referans | M: maske")
    while True:
        key, state["last"] = state["last"], None
        if key == pygame.K_c:
            if state["eng"]:
                state["eng"].enabled = False
            state["model"], state["hull"] = calibrate(world, cam, tur, sleep, log=log)
            state["eng"] = make_engagement(world, cam, tur, sleep, clock, state["model"], state["hull"], log=log)
        elif key == pygame.K_SPACE and state["eng"]:
            state["eng"].enabled = not state["eng"].enabled
        elif key == pygame.K_f:
            world.spawn_fly(sitting=True)
        elif key == pygame.K_p:
            world.person_x = -300.0
        elif key == pygame.K_r and state["eng"]:
            state["eng"].det.set_reference([cam.read() for _ in range(5)])
            log("referans yenilendi")
        elif key == pygame.K_m:
            state["mask"] = not state["mask"]
        if state["eng"]:
            state["eng"].step()
        else:
            cam.read()
        clk.tick(30)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--seconds", type=float, default=90)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    if a.headless:
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
        run_headless(a.seconds, a.seed, a.verbose)
    else:
        run_gui(a.seed)
