"""Sanal dünya: duvar + sinekler + kamera + kusurlu servo modelli pan-tilt taret.

Bu modül fiziksel donanım OLMADAN tüm boru hattını (tespit -> kalibrasyon ->
kinematik -> kapalı çevrim nişan -> atış -> doğrulama) test etmek içindir.
Gerçekçi kusurlar bilinçli olarak eklenmiştir:
  * Kamera–taret paralaksı (7 cm / 5 cm ofset) ve eksen eğiklikleri
  * Duvar kameraya dik değil (8° yaw)
  * Servo: 1 µs kuantalama, ölü bant, boşluk (backlash), kazanç/sıfır hatası, hız sınırı
  * Nişan lazeri güç ışınına paralel ama 12 mm yanda
  * Sensör gürültüsü, vinyet, yavaş ışık kayması, kalıcı lekeler
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import cv2
import numpy as np


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


# --------------------------------------------------------------------------
@dataclass
class SimServo:
    us_center: float = 1500.0
    us_per_deg: float = 2000.0 / 180.0   # DS3218 180° tipi (500-2500 µs)
    deadband_us: float = 3.0
    gain: float = 1.0
    zero_deg: float = 0.0
    backlash_deg: float = 0.12
    slew_dps: float = 350.0
    jitter_deg: float = 0.01
    actual: float = 0.0
    _target: float = 0.0
    _last_us: float = 1500.0

    def command(self, deg: float):
        us = round(self.us_center + deg * self.us_per_deg)
        if abs(us - self._last_us) < self.deadband_us:
            return                      # ölü bant: küçük komutlar yok sayılır
        direction = math.copysign(1.0, us - self._last_us)
        self._last_us = us
        q = (us - self.us_center) / self.us_per_deg
        self._target = self.gain * q + self.zero_deg + direction * self.backlash_deg / 2

    def update(self, dt: float):
        d = self._target - self.actual
        step = self.slew_dps * dt
        self.actual = self._target if abs(d) <= step else self.actual + math.copysign(step, d)

    @property
    def moving(self) -> bool:
        return abs(self._target - self.actual) > 1e-3

    def read(self) -> float:
        return self.actual + random.gauss(0, self.jitter_deg)


@dataclass
class Fly:
    x: float                 # duvar koordinatı, mm
    y: float
    angle: float
    state: str = "flying"    # flying | sitting | dead | gone
    vx: float = 0.0
    vy: float = 0.0
    timer: float = 0.0
    length_mm: float = field(default_factory=lambda: random.uniform(6.5, 9.0))


class SimWorld:
    W, H = 1280, 720
    WALL_W_MM, WALL_H_MM = 3000, 2000

    def __init__(self, seed: int = 1, wall_dist_m: float = 1.6, spawn_every_s: float = 7.0,
                 max_flies: int = 3):
        random.seed(seed)
        np.random.seed(seed)
        self.rng = np.random.default_rng(seed)
        self.t = 0.0
        self.spawn_every_s = spawn_every_s
        self.max_flies = max_flies
        self._next_spawn = 1.0

        # --- kamera iç parametreleri (pinhole) ---
        self.K = np.array([[1100.0, 0, self.W / 2], [0, 1100.0, self.H / 2], [0, 0, 1]])

        # --- duvar düzlemi (kamera çerçevesi, Y aşağı) ---
        yaw = math.radians(8.0)
        self.e1 = np.array([math.cos(yaw), 0.0, math.sin(yaw)])
        self.e2 = np.array([0.0, 1.0, 0.0])
        self.n = np.cross(self.e1, self.e2)
        center = np.array([0.0, 0.0, wall_dist_m])
        self.O = center - 1.5 * self.e1 - 1.0 * self.e2

        # --- taret yerleşimi (paralaks + montaj eğikliği) ---
        self.T_pos = np.array([0.07, -0.05, 0.02])
        self.T_rot = rot_z(math.radians(0.6)) @ rot_y(math.radians(1.5)) @ rot_x(math.radians(-1.0))
        self.pointer_offset_m = 0.012
        self.pan = SimServo(gain=1.015, zero_deg=0.4)
        self.tilt = SimServo(gain=0.985, zero_deg=-0.6)
        self.pointer_on = False
        self.armed = False
        self.flash = None            # (u, v, kalan_süre)

        # --- doku ---
        self.texture = self._make_texture()
        self.flies: list[Fly] = []
        self.kills = 0
        self.scorches = 0
        self.person_x = None         # görüntüde dolaşan "insan" silueti
        self.safety_violations = 0
        self.light = 1.0
        self._vignette = self._make_vignette()

    # ------------------------------------------------------------------ doku
    def _make_texture(self):
        h, w = self.WALL_H_MM, self.WALL_W_MM
        base = np.full((h, w), 190, np.float32)
        low = cv2.resize(self.rng.normal(0, 6, (h // 100, w // 100)).astype(np.float32), (w, h),
                         interpolation=cv2.INTER_CUBIC)
        tex = base + low + self.rng.normal(0, 1.5, (h, w)).astype(np.float32)
        tex = cv2.cvtColor(np.clip(tex, 0, 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
        tex[..., 0] = np.clip(tex[..., 0].astype(int) - 6, 0, 255)   # hafif sıcak beyaz
        # kalıcı lekeler (referansta var -> hedef sayılmamalı)
        for _ in range(25):
            x, y = int(self.rng.uniform(100, w - 100)), int(self.rng.uniform(100, h - 100))
            cv2.circle(tex, (x, y), int(self.rng.uniform(2, 5)), (120, 120, 125), -1, cv2.LINE_AA)
        # tablo çerçevesi ve priz
        cv2.rectangle(tex, (1900, 450), (2500, 900), (60, 50, 45), 18)
        cv2.rectangle(tex, (700, 1400), (780, 1480), (235, 235, 235), -1)
        cv2.circle(tex, (725, 1440), 6, (40, 40, 40), -1)
        cv2.circle(tex, (755, 1440), 6, (40, 40, 40), -1)
        return tex

    def _make_vignette(self):
        yy, xx = np.mgrid[0:self.H, 0:self.W]
        r = np.hypot((xx - self.W / 2) / (self.W / 2), (yy - self.H / 2) / (self.H / 2))
        return (1.0 - 0.18 * r ** 2).astype(np.float32)[..., None]

    # --------------------------------------------------------------- geometri
    def project(self, P):
        p = self.K @ P
        return p[0] / p[2], p[1] / p[2]

    def wall_to_world(self, x_mm, y_mm):
        return self.O + self.e1 * (x_mm / 1000.0) + self.e2 * (y_mm / 1000.0)

    def wall_px(self, x_mm, y_mm):
        return self.project(self.wall_to_world(x_mm, y_mm))

    def _tex_to_img_H(self):
        src = np.float32([[0, 0], [self.WALL_W_MM, 0], [self.WALL_W_MM, self.WALL_H_MM], [0, self.WALL_H_MM]])
        dst = np.float32([self.wall_px(*p) for p in src])
        return cv2.getPerspectiveTransform(src, dst)

    def beam_ray(self, pointer: bool):
        p, t = math.radians(self.pan.read()), math.radians(self.tilt.read())
        d_local = np.array([math.sin(p) * math.cos(t), math.sin(t), math.cos(p) * math.cos(t)])
        right_local = np.array([math.cos(p), 0.0, -math.sin(p)])
        o = self.T_pos + (self.T_rot @ right_local) * (self.pointer_offset_m if pointer else 0.0)
        return o, self.T_rot @ d_local

    def hit_wall(self, pointer: bool):
        o, d = self.beam_ray(pointer)
        denom = self.n @ d
        if abs(denom) < 1e-9:
            return None
        s = self.n @ (self.O - o) / denom
        if s <= 0:
            return None
        X = o + s * d
        q = X - self.O
        return q @ self.e1 * 1000.0, q @ self.e2 * 1000.0, X

    # ------------------------------------------------------------- dinamik
    def step(self, dt: float):
        n = max(1, int(math.ceil(dt / 0.01)))
        h = dt / n
        for _ in range(n):
            self.t += h
            self.pan.update(h)
            self.tilt.update(h)
            self._update_flies(h)
            if self.person_x is not None:
                self.person_x += 300 * h
                if self.person_x > self.W + 300:
                    self.person_x = None
            if self.flash:
                self.flash = (self.flash[0], self.flash[1], self.flash[2] - h)
                if self.flash[2] <= 0:
                    self.flash = None
        self.light = 1.0 + 0.03 * math.sin(self.t / 40.0)

    def spawn_fly(self, sitting=False, x=None, y=None):
        f = Fly(x if x is not None else random.uniform(500, 2500),
                y if y is not None else random.uniform(400, 1600), random.uniform(0, 180))
        if sitting:
            f.state, f.timer = "sitting", random.uniform(8, 30)
        else:
            sp = random.uniform(300, 700)
            a = random.uniform(0, 2 * math.pi)
            f.vx, f.vy, f.timer = sp * math.cos(a), sp * math.sin(a), random.uniform(0.8, 3.0)
        self.flies.append(f)
        return f

    def _update_flies(self, h):
        if self.t >= self._next_spawn:
            self._next_spawn = self.t + random.expovariate(1.0 / self.spawn_every_s)
            if sum(f.state in ("flying", "sitting") for f in self.flies) < self.max_flies:
                self.spawn_fly()
        for f in self.flies:
            f.timer -= h
            if f.state == "flying":
                f.x += f.vx * h
                f.y += f.vy * h
                if random.random() < 2.0 * h:
                    a = math.atan2(f.vy, f.vx) + random.gauss(0, 0.8)
                    sp = math.hypot(f.vx, f.vy)
                    f.vx, f.vy = sp * math.cos(a), sp * math.sin(a)
                if not (150 < f.x < self.WALL_W_MM - 150 and 150 < f.y < self.WALL_H_MM - 150):
                    f.vx, f.vy = -f.vx, -f.vy
                    f.x = min(max(f.x, 151), self.WALL_W_MM - 151)
                    f.y = min(max(f.y, 151), self.WALL_H_MM - 151)
                if f.timer <= 0:
                    f.state, f.timer, f.angle = "sitting", random.uniform(6, 30), random.uniform(0, 180)
            elif f.state == "sitting":
                if f.timer <= 0:
                    f.state = "gone"
        self.flies = [f for f in self.flies if f.state != "gone"]

    # ------------------------------------------------------------ olaylar
    def fire(self, ms: int, pwm: int):
        hit = self.hit_wall(pointer=False)
        if hit is None:
            return
        x, y, X = hit
        if self.person_x is not None and -150 < self.person_x < self.W + 150:
            self.safety_violations += 1
        energy_mj = 2500.0 * (pwm / 255.0) * ms / 1000.0   # mW·s = mJ (2.5 W optik varsayımı)
        killed = False
        for f in self.flies:
            if f.state in ("sitting", "flying") and math.hypot(f.x - x, f.y - y) < f.length_mm * 0.5 + 0.8:
                if energy_mj >= 30:      # ~30 mJ üstü: kanat/kas hasarı (varsayım)
                    f.state = "dead"
                    f.timer = 0.3
                    self.kills += 1
                    killed = True
        if not killed and energy_mj >= 15:
            cv2.circle(self.texture, (int(round(x)), int(round(y))), 2, (105, 115, 125), -1, cv2.LINE_AA)
            self.scorches += 1
        u, v = self.project(X)
        self.flash = (u, v, 0.05)

    # ------------------------------------------------------------- render
    def render(self) -> np.ndarray:
        Himg = self._tex_to_img_H()
        img = cv2.warpPerspective(self.texture, Himg, (self.W, self.H), flags=cv2.INTER_AREA,
                                  borderValue=(90, 90, 90))
        # sinekler
        for f in self.flies:
            if f.state == "dead":
                if f.timer > 0:
                    f.timer -= 1 / 30
                    f.y += 25      # düşüyor
                else:
                    f.state = "gone"
                    continue
            u, v = self.wall_px(f.x, f.y)
            u2, _ = self.wall_px(f.x + f.length_mm, f.y)
            L = abs(u2 - u)
            S = 16
            c = (int(u * S), int(v * S))
            if f.state == "flying":
                ang = math.degrees(math.atan2(f.vy, f.vx))
                streak = math.hypot(f.vx, f.vy) / 30.0 * L / f.length_mm
                cv2.ellipse(img, c, (int((L / 2 + streak / 2) * S), int(L * 0.25 * S)), ang, 0, 360,
                            (150, 150, 155), -1, cv2.LINE_AA, 4)
            else:
                cv2.ellipse(img, c, (int(L * 0.55 * S), int(L * 0.42 * S)), f.angle, 0, 360,
                            (165, 165, 170), -1, cv2.LINE_AA, 4)       # kanatlar
                cv2.ellipse(img, c, (int(L * 0.5 * S), int(L * 0.22 * S)), f.angle, 0, 360,
                            (35, 35, 40), -1, cv2.LINE_AA, 4)          # gövde
        # insan silueti (hareket kapısını test etmek için)
        if self.person_x is not None:
            x = int(self.person_x)
            cv2.rectangle(img, (x - 120, 80), (x + 120, self.H), (70, 60, 80), -1)
            cv2.circle(img, (x, 60), 70, (90, 80, 100), -1)

        img = img.astype(np.float32) * self._vignette * self.light
        # nişan lazeri (kırmızı, 650 nm)
        if self.pointer_on:
            hit = self.hit_wall(pointer=True)
            if hit is not None:
                u, v = self.project(hit[2])
                self._add_spot(img, u, v, 1.6, np.array([10, 35, 255], np.float32), 0.7)
        if self.flash:
            self._add_spot(img, self.flash[0], self.flash[1], 3.0, np.array([255, 200, 120], np.float32), 2.0)
        noise = np.empty(img.shape, np.float32)
        cv2.randn(noise, 0.0, 2.0)          # sensör gürültüsü (hızlı)
        img += noise
        return np.clip(img, 0, 255).astype(np.uint8)

    @staticmethod
    def _add_spot(img, u, v, sigma, color, gain):
        r = int(4 * sigma) + 1
        x0, y0 = int(u) - r, int(v) - r
        if x0 < 0 or y0 < 0 or x0 + 2 * r + 1 >= img.shape[1] or y0 + 2 * r + 1 >= img.shape[0]:
            return
        yy, xx = np.mgrid[y0:y0 + 2 * r + 1, x0:x0 + 2 * r + 1]
        g = np.exp(-((xx - u) ** 2 + (yy - v) ** 2) / (2 * sigma * sigma)).astype(np.float32)
        img[y0:y0 + 2 * r + 1, x0:x0 + 2 * r + 1] += gain * g[..., None] * color


# --------------------------------------------------------------------------
# Turret/Camera protokolünü sağlayan sanal adaptörler
# --------------------------------------------------------------------------
class SimCamera:
    def __init__(self, world: SimWorld, fps: float = 30.0, on_frame=None):
        self.w, self.dt, self.on_frame = world, 1.0 / fps, on_frame

    def read(self):
        self.w.step(self.dt)
        f = self.w.render()
        if self.on_frame:
            self.on_frame(f)
        return f


class SimTurret:
    """Firmware'deki güvenlik kurallarını (MAX_FIRE_MS, cooldown, ARM şartı) taklit eder."""
    MAX_FIRE_MS = 60
    COOLDOWN_S = 1.0
    PAN_LIM = (-60.0, 60.0)
    TILT_LIM = (-35.0, 45.0)

    ARM_WARN_S = 1.5

    def __init__(self, world: SimWorld):
        self.w = world
        self._last_fire = -1e9
        self._armed_at = -1e9
        self.refused = 0

    def arm(self, on):
        if on and not self.w.armed:
            self._armed_at = self.w.t
        self.w.armed = bool(on)
        return True

    def move(self, pan, tilt):
        pan = min(max(pan, self.PAN_LIM[0]), self.PAN_LIM[1])
        tilt = min(max(tilt, self.TILT_LIM[0]), self.TILT_LIM[1])
        self.w.pan.command(pan)
        self.w.tilt.command(tilt)
        return True

    def pointer(self, on):
        self.w.pointer_on = bool(on)
        return True

    def fire(self, ms, pwm=255):
        if not self.w.armed or self.w.t - self._armed_at < self.ARM_WARN_S or ms > self.MAX_FIRE_MS or self.w.pan.moving or self.w.tilt.moving \
                or self.w.t - self._last_fire < self.COOLDOWN_S:
            self.refused += 1
            return False
        self._last_fire = self.w.t
        self.w.fire(ms, pwm)
        self.w.step(ms / 1000.0)
        return True

    def wait_settled(self, timeout=1.0):
        t0 = self.w.t
        while (self.w.pan.moving or self.w.tilt.moving) and self.w.t - t0 < timeout:
            self.w.step(0.01)
        self.w.step(0.08)   # mekanik oturma (ringing) payı
        return not (self.w.pan.moving or self.w.tilt.moving)

    def heartbeat(self):
        pass
