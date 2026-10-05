"""Üretim öncesi otomatik kalite kontrol (QA) ve karar raporu."""
from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import trimesh
from scipy.spatial import cKDTree

from .builder import Connection
from .centerline import CenterlineResult, region_label
from .config import Params
from .field import DepthField
from .geometry import sweep_frames

TI_DENSITY = 4.43e-3  # g/mm³ (Ti-6Al-4V)


@dataclass
class Check:
    name: str
    status: str   # PASS | WARN | FAIL
    value: float | None
    limit: float | None
    message: str


class Locator:
    """Bar üzerindeki bir noktayı diş/implant bölgesi adıyla adlandırır."""

    def __init__(self, cl: CenterlineResult):
        self.cl = cl
        self.ids = [i.id for i in cl.ordered]
        self.tree = cKDTree(cl.points)
        self.garc = np.array([cl.guide.project(cl.frame.to2d(q)) for q in cl.points])

    def label(self, q) -> str:
        return region_label(float(self.garc[self.tree.query(q)[1]]), self.cl.support_arc, self.ids)


def _connection_zone(q: np.ndarray, cl: CenterlineResult, conns: list[Connection], p: Params) -> np.ndarray:
    """Silindirin bar altından protez tabanına inen kısmı (örtü kontrolünden muaf)."""
    _, _, b = sweep_frames(cl.points, cl.frame.up)
    zone = np.zeros(len(q), bool)
    for c in conns:
        rel = q - c.implant.platform
        t = rel @ c.implant.axis
        r = np.linalg.norm(rel - t[:, None] * c.implant.axis, axis=1)
        j = c.centerline_index
        below = (q - cl.points[j]) @ b[j] < -p.bar_height / 2 + 0.3
        zone |= (r < p.sleeve_diameter / 2 + 0.6) & below
    return zone


def _sharp_edge_distance(mesh: trimesh.Trimesh, q: np.ndarray, angle_deg: float = 30.0) -> np.ndarray:
    sharp = mesh.face_adjacency_angles > np.radians(angle_deg)
    if not sharp.any():
        return np.full(len(q), np.inf)
    e = mesh.vertices[mesh.face_adjacency_edges[sharp]]
    seg = []
    for a, b in e:
        n = max(2, int(np.linalg.norm(b - a) / 0.05) + 1)
        seg.append(a + np.linspace(0, 1, n)[:, None] * (b - a))
    return cKDTree(np.vstack(seg)).query(q)[0]


def run_qa(bar: trimesh.Trimesh, cl: CenterlineResult, conns: list[Connection],
           field_: DepthField, p: Params, n_samples: int = 40000) -> dict:
    checks: list[Check] = []
    loc = Locator(cl)

    # 1. Mesh bütünlüğü
    bodies = len(bar.split(only_watertight=False))
    ok = bar.is_watertight and bar.is_winding_consistent and bar.is_volume and bodies == 1
    checks.append(Check("mesh", "PASS" if ok else "FAIL", float(bodies), 1.0,
                        f"watertight={bar.is_watertight}, manifold/volume={bar.is_volume}, gövde sayısı={bodies}"))

    # 2. Restorasyon örtüsü (safety zone) — bağlantı silindirleri hariç
    pts, fidx = trimesh.sample.sample_surface(bar, n_samples, seed=1)
    normals = bar.face_normals[fidx]
    mask = ~_connection_zone(pts, cl, conns, p)
    q = pts[mask]
    depth = field_.depth(q)
    near = depth < p.min_cover + 0.6
    if near.any():
        depth[near] = field_.depth_exact(q[near])
    i = int(np.argmin(depth))
    dmin = float(depth[i])
    if dmin < 0:
        status, msg = "FAIL", f"Bar restorasyon dışına taşıyor ({loc.label(q[i])}, {-dmin:.2f} mm)"
    elif dmin < p.min_cover - 0.05:
        n_bad = int((depth < p.min_cover - 0.05).sum())
        regions = sorted({loc.label(x) for x in q[depth < p.min_cover - 0.05]})
        status = "FAIL"
        msg = (f"Restorasyon örtüsü {dmin:.2f} mm < {p.min_cover} mm — en ince: {loc.label(q[i])}; "
               f"sorunlu bölgeler: {', '.join(regions)} ({n_bad} örnek nokta)")
    else:
        status, msg = "PASS", f"Min. restorasyon örtüsü {dmin:.2f} mm ({loc.label(q[i])})"
    checks.append(Check("restorasyon_ortusu", status, round(dmin, 3), p.min_cover, msg))

    # 3. Ti duvar kalınlığı (yüzeyden içeri ışın). Keskin kenarlara 0.5 mm'den yakın noktalar
    #    duvar değil kenar ucudur; onlar ayrı 'keskin kenar' uyarısı olarak raporlanır.
    sel = np.random.default_rng(2).choice(len(pts), size=min(12000, len(pts)), replace=False)
    origins = pts[sel] - normals[sel] * 1e-3
    locs, ray_idx, _ = bar.ray.intersects_location(origins, -normals[sel], multiple_hits=False)
    if len(ray_idx):
        th = np.linalg.norm(locs - origins[ray_idx], axis=1)
        o = origins[ray_idx]
        near_edge = _sharp_edge_distance(bar, o) < 0.5
        wall = ~near_edge
        if wall.any():
            k = int(np.argmin(np.where(wall, th, np.inf)))
            tmin = float(th[k])
            st = "PASS" if tmin >= p.min_ti_thickness - 0.05 else "FAIL"
            checks.append(Check("ti_duvar_kalinligi", st, round(tmin, 3), p.min_ti_thickness,
                                f"Ti min. duvar kalınlığı {tmin:.2f} mm ({loc.label(o[k])})"))
        feather = near_edge & (th < 0.3)
        if feather.any():
            regions = sorted({loc.label(x) for x in o[feather]})
            checks.append(Check("keskin_kenar", "WARN", round(float(th[feather].min()), 3), 0.3,
                                f"Keskin kenar (<0.3 mm metal ucu): {', '.join(regions)} — eğik vida yuvası "
                                f"ağzı; CAM'de 0.2–0.3 mm pah/kenar kırma önerilir"))

    # 4. Vida kanalı çevresi + implant bağlantısı
    pad_w = max(p.sleeve_diameter + p.pad_extra, p.bar_width)
    for c in conns:
        wall = min(p.sleeve_diameter - p.channel_diameter, pad_w - max(p.seat_diameter, p.channel_diameter)) / 2
        st = "PASS" if wall >= p.min_ti_thickness else "FAIL"
        checks.append(Check(f"kanal_cidari_#{c.implant.id}", st, round(wall, 3), p.min_ti_thickness,
                            f"#{c.implant.id} vida kanalı/yuvası çevresi Ti cidarı {wall:.2f} mm"))
        lim = p.max_offset_at_implant + 0.3
        st = "PASS" if c.offset <= lim else "FAIL"
        checks.append(Check(f"baglanti_#{c.implant.id}", st, round(c.offset, 3), lim,
                            f"#{c.implant.id}: bar–eksen sapması {c.offset:.2f} mm, silindir yüksekliği "
                            f"{c.t_top:.1f} mm, eksen açısı {c.tilt_deg:.0f}°"))

    # 5. Kantilever
    sup = cl.support_arc
    for name, length in ((cl.ordered[0].id, sup[0] - cl.start_arc), (cl.ordered[-1].id, cl.end_arc - sup[-1])):
        length = max(0.0, float(length))
        lim = cl.cantilever_limit
        st = "PASS" if length <= lim + 0.5 else "WARN"
        checks.append(Check(f"kantilever_#{name}", st, round(length, 2), round(lim, 2),
                            f"#{name} distal kantilever {length:.1f} mm (limit {lim:.1f} mm; "
                            f"A-P {cl.ap_spread:.1f} mm × {p.cantilever_ap_ratio})"))

    # 6. Düzgünlük
    st = "PASS" if cl.min_bend_radius >= p.min_bend_radius else "WARN"
    checks.append(Check("egrilik", st, round(cl.min_bend_radius, 2), p.min_bend_radius,
                        f"Merkez hattı min. eğrilik yarıçapı {cl.min_bend_radius:.1f} mm"))

    # 7. Üretilebilirlik
    st = "PASS" if p.corner_radius >= p.tool_diameter / 2 else "FAIL"
    checks.append(Check("freze_kose", st, p.corner_radius, p.tool_diameter / 2,
                        f"Kesit köşe radyüsü {p.corner_radius} mm, takım yarıçapı {p.tool_diameter / 2} mm"))
    checks.append(Check("freze_ic_kose", "WARN", None, None,
                        "Bar–silindir birleşiminde iç köşe radyüssüz; CAM'de takım yarıçapı kadar yuvarlanacak, "
                        "restorasyon iç yüzeyi ile çakışma olmaması için siman aralığını kontrol edin"))

    for w in cl.warnings:
        checks.append(Check("uyari", "WARN", None, None, w))

    fails = [c for c in checks if c.status == "FAIL"]
    warns = [c for c in checks if c.status == "WARN"]
    status = "FAIL" if fails else "PASS"
    summary = ("PASS — üretilebilir" if not fails else
               "FAIL — " + " / ".join(c.message for c in fails))
    return {
        "status": status,
        "summary": summary,
        "volume_mm3": round(float(bar.volume), 1),
        "mass_g": round(float(bar.volume) * TI_DENSITY, 2),
        "bar_length_mm": round(float(cl.arc[-1]), 1),
        "ap_spread_mm": round(cl.ap_spread, 2),
        "checks": [asdict(c) for c in checks],
        "warnings": [c.message for c in warns],
        "decisions": cl.decisions,
    }


def format_report(rep: dict) -> str:
    lines = ["PRIMER AUTO BAR V1 — QA RAPORU", "=" * 34, "", rep["summary"], "",
             f"Bar uzunluğu: {rep['bar_length_mm']} mm   Hacim: {rep['volume_mm3']} mm³   "
             f"Ti ağırlık: {rep['mass_g']} g   A-P: {rep['ap_spread_mm']} mm", "", "Kontroller:"]
    for c in rep["checks"]:
        lines.append(f"  [{c['status']:4}] {c['message']}")
    lines += ["", "Yazılımın verdiği kararlar:"]
    lines += [f"  - {d}" for d in rep["decisions"]]
    lines += ["", "NOT: Bu çıktı tıbbi cihaz parçasıdır. Üretime göndermeden önce teknisyen/hekim onayı gerekir."]
    return "\n".join(lines)
