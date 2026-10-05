"""Bar gövdesi, implant silindirleri, vida kanalları ve restorasyon kesimi."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import trimesh
from scipy.spatial import cKDTree

from .centerline import CenterlineResult
from .config import Params
from .geometry import cylinder, difference, finalize, intersection, rounded_rect, sweep, sweep_frames, union
from .io import Implant


@dataclass
class Connection:
    implant: Implant
    t_top: float          # platformdan bar üst yüzeyine eksen boyunca mesafe
    offset: float         # bar merkezinin implant ekseninden yatay sapması
    tilt_deg: float       # eksenin bar üst düzlemi normaline göre açısı
    centerline_index: int


def _half_space_below(point: np.ndarray, normal: np.ndarray, size: float = 60.0) -> trimesh.Trimesh:
    """Üst yüzeyi `point`'ten geçen, `normal` yönünde biten büyük kutu (yarı-uzay yaklaşımı)."""
    box = trimesh.creation.box(extents=[size, size, size])
    z = normal / np.linalg.norm(normal)
    x = np.cross(z, [1.0, 0, 0])
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(z, [0, 1.0, 0])
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    tf = np.eye(4)
    tf[:3, 0], tf[:3, 1], tf[:3, 2] = x, y, z
    tf[:3, 3] = point - z * size / 2
    box.apply_transform(tf)
    return box


def connections(cl: CenterlineResult, p: Params) -> list[Connection]:
    pts = cl.points
    _, n, b = sweep_frames(pts, cl.frame.up)
    tree = cKDTree(pts)
    out = []
    for imp in cl.ordered:
        ts = np.arange(0.0, 30.0, 0.05)
        d, idx = tree.query(imp.platform[None] + ts[:, None] * imp.axis[None])
        j = int(idx[np.argmin(d)])
        c, bj = pts[j], b[j]
        denom = imp.axis @ bj
        t_top = float(((c + p.bar_height / 2 * bj - imp.platform) @ bj) / denom)
        t_mid = float(((c - imp.platform) @ bj) / denom)
        offset = float(abs((imp.point_at(t_mid) - c) @ n[j]))
        tilt = float(np.degrees(np.arccos(np.clip(denom, -1, 1))))
        out.append(Connection(imp, t_top, offset, tilt, j))
    return out


def _solid(cl: CenterlineResult, conns: list[Connection], p: Params, grow: float) -> trimesh.Trimesh:
    pts = cl.points
    _, n, b = sweep_frames(pts, cl.frame.up)
    sections = []
    for lo, hi in zip(cl.ring_lo, cl.ring_hi):
        sec = rounded_rect(hi - lo + 2 * grow, p.bar_height + 2 * grow, p.corner_radius + grow)
        sec[:, 0] += (lo + hi) / 2
        sections.append(sec)
    parts = [sweep(pts, n, b, sections)]
    # Silindir platformdan bar orta düzlemine kadar çıkar; üst yarıda vida kanalını ped sarar.
    # (Silindir üstü bar üst yüzeyine denk getirilirse eğimli yüzeyde mikron kalınlıkta sliver oluşur.)
    r = p.sleeve_diameter / 2 + grow
    for c in conns:
        j = c.centerline_index
        over = r * np.tan(np.radians(c.tilt_deg)) + 1.0
        raw = cylinder(c.implant.platform, c.implant.point_at(c.t_top + grow + over), r)
        parts.append(intersection([raw, _half_space_below(pts[j], b[j])]))
    return union(parts)


def _channels(conns: list[Connection], diameter: float, extra_top: float) -> list[trimesh.Trimesh]:
    return [cylinder(c.implant.point_at(-1.5), c.implant.point_at(c.t_top + extra_top), diameter / 2)
            for c in conns]


def seat_floor(c: Connection, cl: CenterlineResult, p: Params) -> float:
    """Vida başı oturma yüzeyinin (eksene dik) eksen üzerindeki konumu: tüm çevresi bar içinde kalır."""
    _, _, b = sweep_frames(cl.points, cl.frame.up)
    j = c.centerline_index
    a = c.implant.axis
    u = np.cross(a, [1.0, 0, 0])
    if np.linalg.norm(u) < 1e-6:
        u = np.cross(a, [0, 1.0, 0])
    u /= np.linalg.norm(u)
    v = np.cross(a, u)
    ang = np.linspace(0, 2 * np.pi, 72, endpoint=False)
    rim = p.seat_diameter / 2 * (np.cos(ang)[:, None] * u + np.sin(ang)[:, None] * v)
    top = cl.points[j] + p.bar_height / 2 * b[j]
    t = ((top - c.implant.platform - rim) @ b[j]) / (a @ b[j])
    return float(t.min())


def _seats(conns: list[Connection], cl: CenterlineResult, p: Params) -> list[trimesh.Trimesh]:
    out = []
    for c in conns:
        t0 = seat_floor(c, cl, p)
        out.append(cylinder(c.implant.point_at(t0), c.implant.point_at(t0 + 20.0), p.seat_diameter / 2))
    return out


def build_bar(cl: CenterlineResult, p: Params):
    conns = connections(cl, p)
    solid = _solid(cl, conns, p, 0.0)
    cutters = _channels(conns, p.channel_diameter, p.sleeve_diameter + 3.0)
    if p.seat_diameter > p.channel_diameter:
        cutters += _seats(conns, cl, p)
    bar = finalize(difference(solid, cutters))
    return bar, conns


def cut_restoration(restoration: trimesh.Trimesh, cl: CenterlineResult, conns: list[Connection],
                    p: Params) -> trimesh.Trimesh:
    """Hibrit (zirkonyum/kompozit) kısım: restorasyon - (bar + siman aralığı) - vida giriş delikleri."""
    grown = _solid(cl, conns, p, p.cement_gap)
    cutters = [grown]
    if p.access_hole_diameter > 0:
        cutters += _channels(conns, p.access_hole_diameter, 60.0)
    return finalize(difference(restoration, cutters))


def fill_screw_holes(restoration: trimesh.Trimesh, implants: list[Implant], p: Params) -> trimesh.Trimesh:
    """Analiz için restorasyondaki vida giriş deliklerini kapat (aksi halde bar implanttan kaçar)."""
    r = p.hole_fill_diameter / 2
    ang = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    plugs = []
    for imp in implants:
        u = np.cross(imp.axis, [1.0, 0, 0])
        if np.linalg.norm(u) < 1e-6:
            u = np.cross(imp.axis, [0, 1.0, 0])
        u /= np.linalg.norm(u)
        v = np.cross(imp.axis, u)
        ring = (r + 0.4) * (np.cos(ang)[:, None] * u + np.sin(ang)[:, None] * v)
        ts = np.arange(0.0, 40.0, 0.25)
        q = (imp.platform[None, None] + ts[:, None, None] * imp.axis + ring[None]).reshape(-1, 3)
        inside = restoration.contains(q).reshape(len(ts), len(ang)).mean(axis=1) > 0.5
        if not inside.any():
            continue
        # deliği çevreleyen materyalin bittiği yere kadar doldur (protez dışına taşma yok)
        t_exit = ts[np.nonzero(inside)[0].max()]
        plugs.append(cylinder(imp.point_at(0.0), imp.point_at(t_exit), r))
    if not plugs:
        return restoration
    return union([restoration] + plugs)
