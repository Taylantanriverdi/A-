"""Test için sentetik alt çene All-on-4 hibrit vakası üretir."""
from __future__ import annotations

import os

import numpy as np

from .geometry import cylinder, difference, normalize, rounded_rect, sweep, sweep_frames
from .io import Implant, save_implants

UP = np.array([0.0, 0.0, 1.0])
A, B = 24.0, 26.0  # ark yarı eksenleri


def _arch(phi):
    return np.stack([A * np.sin(phi), B * np.cos(phi), np.zeros_like(phi)], -1)


def make_case(out_dir: str, lingual_offset: float = 0.3, tilt_deg: float = 30.0,
              anterior_width: float = 11.0, posterior_width: float = 11.5):
    os.makedirs(out_dir, exist_ok=True)
    phi = np.linspace(-1.75, 1.75, 320)
    pts = _arch(phi)
    _, n, b = sweep_frames(pts, UP)
    sections = []
    for f in phi:
        k = abs(f) / 1.75
        w, h = anterior_width + (posterior_width - anterior_width) * k, 13.0 - 2.0 * k   # anteriorda dar-yüksek, posteriorda geniş-alçak
        sec = rounded_rect(w, h, 2.0, 8)
        sec[:, 1] += h / 2                      # taban (intaglio) z=0
        sections.append(sec)
    resto = sweep(pts, n, b, sections)

    implants = []
    for f, ident_l, ident_r, tilt in ((0.35, "32", "42", 0.0), (1.05, "35", "45", tilt_deg)):
        for sign, ident in ((1, ident_l), (-1, ident_r)):
            ph = sign * f
            p = _arch(np.array([ph]))[0]
            outward = normalize(np.array([p[0] / A ** 2, p[1] / B ** 2, 0.0]))
            distal = normalize(np.array([A * np.cos(ph), -B * np.sin(ph), 0.0]) * sign)
            plat = p - lingual_offset * outward if tilt == 0 else p.copy()
            axis = np.cos(np.radians(tilt)) * UP + np.sin(np.radians(tilt)) * distal
            implants.append(Implant(ident, plat, normalize(axis)))

    holes = [cylinder(i.point_at(-2.0), i.point_at(40.0), 1.4) for i in implants]
    resto = difference(resto, holes)
    resto_path = os.path.join(out_dir, "restoration.stl")
    imp_path = os.path.join(out_dir, "implants.json")
    resto.export(resto_path)
    save_implants(imp_path, implants)
    return resto_path, imp_path
