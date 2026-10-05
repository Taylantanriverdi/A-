"""Otomatik bar merkez hattı.

Operatörün videoda fareyle yaptığı düzeltmeleri ("burada protez inceliyor, barı linguale
çek", "bar fazla yukarıda kaldı") matematiğe çevirir:

1. İmplant platformlarından geçen bir ark kılavuz eğrisi (guide) kurulur.
2. Guide boyunca her istasyonda, eğriye dik düzlemde bar kesitinin yerleşebileceği tüm
   (bukko-lingual kaydırma s, yükseklik z) konumları için restorasyon içindeki minimum
   derinlik hesaplanır  ->  "allowable volume".
3. Dinamik programlama ile tüm istasyonlar için birlikte en iyi konum seçilir:
   restorasyon örtüsünü maksimize et + ani yön/yükseklik değişimini cezalandır +
   implant istasyonlarında bar implant ekseninden uzaklaşamaz.
4. Distal uçlar: son implanttan sonra güvenli hacim bitene ya da kantilever sınırına
   kadar uzatılır.
5. Sonuç düzgünleştirilip (spline) yeniden örneklenir.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.interpolate import make_interp_spline, splev, splprep
from scipy.ndimage import minimum_filter

from .config import Params
from .field import DepthField
from .geometry import normalize, sweep_frames
from .io import Implant

BIG = 1e6


@dataclass
class ArchFrame:
    e1: np.ndarray
    e2: np.ndarray
    up: np.ndarray
    h0: float  # implant platform düzleminin ortalama yüksekliği

    def to2d(self, p):
        p = np.asarray(p, float)
        return np.stack([p @ self.e1, p @ self.e2], -1)

    def height(self, p):
        return np.asarray(p, float) @ self.up

    def to3d(self, p2, h):
        p2 = np.asarray(p2, float)
        h = np.asarray(h, float)
        return p2[..., :1] * self.e1 + p2[..., 1:2] * self.e2 + h[..., None] * self.up


def make_frame(implants: list[Implant], restoration_vertices: np.ndarray | None = None) -> ArchFrame:
    """Okluzal düzlem çerçevesi. 'up' = restorasyonun en ince ana ekseni (ark düzlemine dik).

    Eğik (ör. All-on-4 distal 30°) implantların ortalama ekseni okluzal düzleme dik değildir;
    bu yüzden yalnızca yön işareti için kullanılır."""
    mean_axis = normalize(np.sum([i.axis for i in implants], axis=0))
    if restoration_vertices is not None and len(restoration_vertices) > 10:
        v = restoration_vertices - restoration_vertices.mean(axis=0)
        _, _, vt = np.linalg.svd(v, full_matrices=False)
        up = vt[2] if vt[2] @ mean_axis > 0 else -vt[2]
    else:
        up = mean_axis
    ref = np.array([1.0, 0, 0]) if abs(up[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = normalize(ref - up * (ref @ up))
    e2 = np.cross(up, e1)
    h0 = float(np.mean([i.platform @ up for i in implants]))
    return ArchFrame(e1, e2, up, h0)


def order_implants(implants: list[Implant], frame: ArchFrame):
    """İmplantları ark boyunca sırala (bir distalden diğer distale). Ark içi (lingual) noktayı da döndür."""
    p = frame.to2d([i.platform for i in implants])
    if len(implants) == 2:
        return list(implants), p.mean(axis=0), 0.0
    d = np.linalg.norm(p[:, None] - p[None], axis=-1)
    a, b = np.unravel_index(np.argmax(d), d.shape)
    mid = (p[a] + p[b]) / 2
    ax = normalize(p[a] - mid)
    perp = np.array([-ax[1], ax[0]])
    rel = p - mid
    if (rel @ perp).sum() < 0:
        perp = -perp
    ang = np.arctan2(rel @ perp, rel @ ax)
    order = np.argsort(ang)
    # A-P mesafesi: en anterior implantın distal implantları birleştiren hatta uzaklığı
    ap = float(np.max(rel @ perp))
    return [implants[i] for i in order], mid, ap


@dataclass
class Guide:
    arc: np.ndarray       # yoğun polyline yay uzunlukları
    pts: np.ndarray       # (M,2)
    implant_arc: np.ndarray

    def at(self, s):
        s = np.atleast_1d(s)
        x = np.interp(s, self.arc, self.pts[:, 0])
        y = np.interp(s, self.arc, self.pts[:, 1])
        return np.stack([x, y], -1)

    def tangent(self, s, h=0.25):
        return normalize(self.at(np.asarray(s) + h) - self.at(np.asarray(s) - h))

    def project(self, p2):
        """2B noktanın guide üzerindeki yay konumu."""
        i = np.argmin(np.linalg.norm(self.pts - p2, axis=1))
        return float(self.arc[i])


def guide_from_polyline(core: np.ndarray, implants2d: np.ndarray, extension: float) -> Guide:
    """2B polyline + iki uçta düz uzantı. İmplant istasyonları polyline'a izdüşümle bulunur."""
    t0 = normalize(core[0] - core[min(5, len(core) - 1)])
    t1 = normalize(core[-1] - core[max(-6, -len(core))])
    ne = max(2, int(extension / 0.1))
    ext0 = core[0] + t0 * np.linspace(extension, 0, ne, endpoint=False)[:, None]
    ext1 = core[-1] + t1 * np.linspace(0, extension, ne + 1)[1:, None]
    pts = np.vstack([ext0, core, ext1])
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    g = Guide(arc, pts, np.zeros(len(implants2d)))
    g.implant_arc = np.array([g.project(q) for q in implants2d])
    return g


def build_guide(ordered: list[Implant], frame: ArchFrame, extension: float) -> Guide:
    """İlk kılavuz: implant platformlarından geçen spline."""
    p = frame.to2d([i.platform for i in ordered])
    u = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])
    k = min(3, len(p) - 1)
    spl = make_interp_spline(u, p, k=k, bc_type="natural" if k == 3 else None)
    return guide_from_polyline(spl(np.linspace(0, u[-1], 2000)), p, extension)


def _dp(unary: list[np.ndarray], sv: np.ndarray, zv: np.ndarray, coef: float):
    """Ayrılabilir karesel geçiş cezalı Viterbi. unary[i]: (S,Z) maliyet."""
    ds2 = coef * (sv[:, None] - sv[None]) ** 2
    dz2 = coef * (zv[:, None] - zv[None]) ** 2
    v = unary[0].copy()
    back = []
    for u in unary[1:]:
        tmp = v[:, None, :] + ds2[:, :, None]          # (s', s, z')
        a1 = tmp.argmin(0)
        w = tmp.min(0)                                  # (s, z')
        tmp2 = w[:, :, None] + dz2[None]                # (s, z', z)
        a2 = tmp2.argmin(1)
        v = tmp2.min(1) + u
        back.append((a1, a2))
    s, z = np.unravel_index(np.argmin(v), v.shape)
    path = [(s, z)]
    for a1, a2 in reversed(back):
        zp = a2[s, z]
        sp = a1[s, zp]
        s, z = sp, zp
        path.append((s, z))
    return path[::-1]


@dataclass
class Station:
    arc: float
    g2: np.ndarray
    n2: np.ndarray  # bukkale bakan yatay normal
    implant: Implant | None = None
    depth_grid: np.ndarray | None = None
    s: float = 0.0
    z: float = 0.0
    depth: float = 0.0
    depth_unshifted: float = 0.0
    center_depth: np.ndarray | None = None


@dataclass
class CenterlineResult:
    frame: ArchFrame
    ordered: list[Implant]
    guide: Guide
    stations: list[Station]
    points: np.ndarray            # düzgünleştirilmiş 3B merkez hattı (0.25 mm aralık)
    arc: np.ndarray
    ap_spread: float
    cantilever_limit: float
    support_arc: list[float]      # her implantın bar üzerindeki destek noktası (guide yayı)
    start_arc: float
    end_arc: float
    min_bend_radius: float
    ring_lo: np.ndarray           # her merkez hattı noktasında kesitin yanal sınırları (pedler dahil)
    ring_hi: np.ndarray
    decisions: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def region_label(a: float, support, ids) -> str:
    """Yay konumunu diş/implant bölgesi adına çevirir."""
    sup = np.asarray(support)
    if a < sup[0] - 0.5:
        return f"#{ids[0]} distali (kantilever)"
    if a > sup[-1] + 0.5:
        return f"#{ids[-1]} distali (kantilever)"
    j = int(np.argmin(np.abs(sup - a)))
    if abs(sup[j] - a) <= 3.0:
        return f"#{ids[j]} bölgesi"
    k = int(np.searchsorted(sup, a))
    return f"#{ids[k - 1]}–#{ids[k]} arası"


def pad_profile(arcs, pad_arcs, p: Params, implants=None, up=None):
    """Her yay konumu için ped ağırlığı k (1 = tam ped, 0 = normal bar) ve en yakın implant indeksi.

    Ped düz bölgesi silindir yarıçapı + eğik silindirin bar yarı yüksekliği boyunca kayması kadardır."""
    arcs = np.atleast_1d(np.asarray(arcs, float))
    d_all = np.abs(arcs[:, None] - np.asarray(pad_arcs, float)[None])
    idx = np.argmin(d_all, axis=1)
    d = d_all[np.arange(len(arcs)), idx]
    flat = np.full(len(pad_arcs), p.sleeve_diameter / 2 + 0.3)
    if implants is not None and up is not None:
        tilt = np.array([np.arccos(np.clip(i.axis @ up, -1, 1)) for i in implants])
        flat += p.bar_height / 2 * np.tan(np.minimum(tilt, np.radians(60)))
    x = np.clip((d - flat[idx]) / max(p.pad_transition, 1e-6), 0, 1)
    return 0.5 * (1 + np.cos(np.pi * x)), idx


def pad_width(k, p: Params):
    return p.bar_width + (max(p.sleeve_diameter + p.pad_extra, p.bar_width) - p.bar_width) * k


def section_bounds(k, off_min, off_max, p: Params):
    """Bar kesitinin merkez hattına göre yanal sınırları: bar dikdörtgeni ∪ implant eksenini saran ped.

    off_min/off_max: eksenin bar alt-üst düzlemleri arasındaki yanal konum aralığı (eğik implantlarda ≠)."""
    wk = pad_width(k, p)
    lo = np.minimum(-p.bar_width / 2, k * off_min - wk / 2)
    hi = np.maximum(p.bar_width / 2, k * off_max + wk / 2)
    return lo, hi


def axis_lateral(imp: Implant, frame: ArchFrame, g2, n2, z_rel):
    """İmplant ekseninin, platform düzleminden z_rel yükseklikte, istasyon normali boyunca yanal konumu."""
    tt = (frame.h0 + np.asarray(z_rel) - imp.platform @ frame.up) / (imp.axis @ frame.up)
    pts = imp.platform + np.multiply.outer(tt, imp.axis)
    return (pts - frame.to3d(g2, 0.0)) @ frame.to3d(n2, 0.0)


def _evaluate_stations(stations, field_: DepthField, frame: ArchFrame, p: Params, pads, lateral):
    """Her istasyonda (s, z) adayları için kesitin restorasyon içindeki min. derinliği."""
    st = p.grid_step
    nl = int(round(lateral / st))
    hh = int(round(p.bar_height / 2 / st))
    hw0 = int(round(p.bar_width / 2 / st))
    hwp = int(round(pad_width(1.0, p) / 2 / st))
    margin = hwp + int(round(3.0 / st))
    zlo = hh * st
    nz = int(round((p.z_max_above_platform - zlo) / st)) + 1
    sv = st * np.arange(-nl, nl + 1)
    zv = zlo + st * np.arange(nz)
    sf = st * np.arange(-(nl + margin), nl + margin + 1)
    zf = zlo + st * np.arange(-hh, nz + hh)
    S, Z = np.meshgrid(sf, zf, indexing="ij")
    pts = []
    for sta in stations:
        p2 = sta.g2 + S[..., None] * sta.n2
        pts.append(frame.to3d(p2, frame.h0 + Z).reshape(-1, 3))
    depth = field_.depth(np.vstack(pts)).reshape(len(stations), len(sf), len(zf))
    ks, idx = pad_profile([s.arc for s in stations], [a for a, _ in pads], p, [i for _, i in pads], frame.up)
    zi = np.arange(nz)
    for i, sta in enumerate(stations):
        fb = minimum_filter(depth[i], size=(2 * hw0 + 1, 2 * hh + 1), mode="nearest")
        grid = fb[margin:margin + len(sv), hh:hh + nz]
        k = ks[i]
        if k > 1e-3:
            hwk = int(round(pad_width(k, p) / 2 / st))
            fp = minimum_filter(depth[i], size=(2 * hwk + 1, 2 * hh + 1), mode="nearest")
            s_ax = axis_lateral(pads[idx[i]][1], frame, sta.g2, sta.n2, zv)
            centers = (1 - k) * sv[:, None] + k * s_ax[None, :]
            fi = np.clip(np.round((centers - sf[0]) / st).astype(int), 0, len(sf) - 1)
            grid = np.minimum(grid, fp[fi, zi[None, :] + hh])
        sta.depth_grid = grid
        # eşitlik bozucu: kesit merkezinin derinliği (yanal sınırlıyken barı dikeyde ortalar)
        sta.center_depth = depth[i][margin:margin + len(sv), hh:hh + nz]
    return sv, zv


def _unary(sta: Station, sv, zv, frame: ArchFrame, p: Params):
    d = sta.depth_grid
    u = -d - 0.05 * sta.center_depth + p.vertical_bias * zv[None, :]
    need = p.min_cover + p.design_margin
    u = np.where(d < need, u + 1000.0 + 100.0 * (need - d), u)
    if sta.implant is not None:
        s_axis = axis_lateral(sta.implant, frame, sta.g2, sta.n2, zv)
        bad = np.abs(sv[:, None] - s_axis[None, :]) > p.max_offset_at_implant
        u = np.where(bad, BIG, u)
    return u


def _solve(stations, sv, zv, frame, p):
    unary = [_unary(s, sv, zv, frame, p) for s in stations]
    coef = p.smooth_weight / p.station_step ** 2
    path = _dp(unary, sv, zv, coef)
    i0 = int(np.argmin(np.abs(sv)))
    for sta, (si, zi) in zip(stations, path):
        sta.s, sta.z = float(sv[si]), float(zv[zi])
        sta.depth = float(sta.depth_grid[si, zi])
        sta.depth_unshifted = float(sta.depth_grid[i0, zi])


def _support_arc(sta: Station, guide: Guide, frame: ArchFrame) -> float:
    imp = sta.implant
    tt = (frame.h0 + sta.z - imp.platform @ frame.up) / (imp.axis @ frame.up)
    return guide.project(frame.to2d(imp.point_at(tt)))


@dataclass
class _Pass:
    guide: Guide
    stations: list[Station]
    support: list[float]
    start_arc: float
    end_arc: float
    warnings: list[str]


def _run_pass(guide: Guide, ordered, inner, frame, field_, p: Params, lateral: float, cant_limit: float) -> _Pass:
    warnings: list[str] = []
    sleeve_r = p.sleeve_diameter / 2

    # İstasyonlar: düzenli aralık + her implantın tam konumu
    reg = np.arange(0.0, guide.arc[-1] + 1e-9, p.station_step)
    keep = np.min(np.abs(reg[:, None] - guide.implant_arc[None]), axis=1) > 0.4 * p.station_step
    arcs = np.concatenate([reg[keep], guide.implant_arc])
    tag = np.concatenate([np.full(keep.sum(), -1), np.arange(len(ordered))])
    o = np.argsort(arcs, kind="stable")
    arcs, tag = arcs[o], tag[o]

    g2 = guide.at(arcs)
    t2 = guide.tangent(arcs)
    n2 = np.stack([-t2[:, 1], t2[:, 0]], -1)
    if np.sum(np.einsum("ij,ij->i", n2, g2 - inner)) < 0:
        n2 = -n2
    stations = [Station(float(a), g, n, ordered[k] if k >= 0 else None)
                for a, g, n, k in zip(arcs, g2, n2, tag)]

    sv, zv = _evaluate_stations(stations, field_, frame, p, list(zip(guide.implant_arc, ordered)), lateral)

    # a) tüm kılavuz üzerinde çöz, uçların nerede bitebileceğini bul
    _solve(stations, sv, zv, frame, p)
    imp_idx = [i for i, s in enumerate(stations) if s.implant is not None]
    first, last = imp_idx[0], imp_idx[-1]
    sup_first = _support_arc(stations[first], guide, frame)
    sup_last = _support_arc(stations[last], guide, frame)
    need_end = max(sup_last, stations[last].arc) + sleeve_r + 0.5
    need_start = min(sup_first, stations[first].arc) - sleeve_r - 0.5
    need_depth = p.min_cover + p.design_margin

    def feasible_end(rng, skip):
        # Ped bölgesini atla; ondan sonra güvenli hacim bitene kadar ilerle
        end = None
        for i in rng:
            if skip(stations[i].arc):
                continue
            if stations[i].depth < need_depth:
                break
            end = stations[i].arc
        return end

    end_ok = feasible_end(range(last, len(stations)), lambda a: a < need_end)
    start_ok = feasible_end(range(first, -1, -1), lambda a: a > need_start)
    end_ok = need_end if end_ok is None else end_ok
    start_ok = need_start if start_ok is None else start_ok
    end_arc = min(end_ok, sup_last + cant_limit)
    start_arc = max(start_ok, sup_first - cant_limit)
    if end_arc < need_end:
        warnings.append(f"#{ordered[-1].id}: distal implant silindirini örtecek kadar güvenli hacim yok; "
                        f"bar minimum uzunlukta bırakıldı.")
        end_arc = need_end
    if start_arc > need_start:
        warnings.append(f"#{ordered[0].id}: distal implant silindirini örtecek kadar güvenli hacim yok; "
                        f"bar minimum uzunlukta bırakıldı.")
        start_arc = need_start

    # b) kırpılmış aralıkta yeniden çöz; pedler implant ekseninin bar yüksekliğindeki
    #    gerçek konumuna (eğik implantlarda distale kayar) yerleşir
    pads = [_support_arc(stations[i], guide, frame) for i in imp_idx]
    sub = [s for s in stations if start_arc - 0.5 * p.station_step <= s.arc <= end_arc + 0.5 * p.station_step]
    _evaluate_stations(sub, field_, frame, p, list(zip(pads, ordered)), lateral)
    _solve(sub, sv, zv, frame, p)
    support = [_support_arc(s, guide, frame) for s in sub if s.implant is not None]
    return _Pass(guide, sub, support, start_arc, end_arc, warnings)


def _smooth(stations: list[Station], frame: ArchFrame, spacing: float = 0.25):
    c = np.array([frame.to3d(s.g2 + s.s * s.n2, frame.h0 + s.z) for s in stations])
    a = np.array([s.arc for s in stations])
    tck, _ = splprep(c.T, u=(a - a[0]) / (a[-1] - a[0]), s=len(c) * 0.1 ** 2, k=3)
    dense = np.array(splev(np.linspace(0, 1, 4000), tck)).T
    darc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))])
    sa = np.arange(0, darc[-1], spacing)
    sa = np.append(sa, darc[-1]) if darc[-1] - sa[-1] > 0.05 else sa
    return np.stack([np.interp(sa, darc, dense[:, j]) for j in range(3)], -1), sa


def bend_radius(pts: np.ndarray) -> np.ndarray:
    """Her iç noktada üç-nokta çember yarıçapı (uçlar = inf)."""
    a = pts[1:-1] - pts[:-2]
    b = pts[2:] - pts[1:-1]
    c = pts[2:] - pts[:-2]
    cross = np.linalg.norm(np.cross(a, b) if pts.shape[1] == 3 else
                           (a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0])[:, None], axis=1)
    r = np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1) * np.linalg.norm(c, axis=1) / np.maximum(2 * cross, 1e-12)
    return np.concatenate([[np.inf], r, [np.inf]])


def fair(pts: np.ndarray, min_radius: float, max_iter: int = 3000) -> np.ndarray:
    """Yalnızca eğrilik yarıçapı sınırın altındaki bölgeleri yerel Laplace ile yumuşatır."""
    pts = pts.copy()
    win = 12
    for _ in range(max_iter):
        r = bend_radius(pts)
        bad = r < min_radius
        if not bad.any():
            break
        mask = np.convolve(bad.astype(float), np.ones(2 * win + 1), mode="same") > 0
        mask[0] = mask[-1] = False
        mid = 0.5 * (pts[:-2] + pts[2:])
        upd = pts.copy()
        upd[1:-1] = pts[1:-1] + 0.5 * (mid - pts[1:-1])
        pts[mask] = upd[mask]
    return pts


def _decisions(first: _Pass, final: _Pass, ids) -> list[str]:
    """Optimizasyonun her bölgede verdiği kararları operatör diliyle yazar.

    Kaydırma ve 'önce' örtüsü implant kılavuzuna göre (tur 1), 'sonra' örtüsü nihai bardan (tur 2)."""
    def group(ps):
        g: dict[str, list[Station]] = {}
        for s in ps.stations:
            g.setdefault(region_label(s.arc, ps.support, ids), []).append(s)
        return g

    g0, g1 = group(first), group(final)
    out = []
    for label, sts in g0.items():
        fin = g1.get(label, sts)
        shift = float(np.mean([s.s for s in sts]))
        z = float(np.mean([s.z for s in fin]))
        d_now = min(s.depth for s in fin)
        d_old = min(s.depth_unshifted for s in sts)
        line = f"{label}: bar merkezi platformdan {z:.1f} mm yukarıda"
        if abs(shift) >= 0.3:
            yon = "bukkale" if shift > 0 else "linguale/palatinale"
            line += (f"; implant kılavuz hattına göre ort. {abs(shift):.2f} mm {yon} kaydırıldı "
                     f"(min. örtü {d_old:.1f} → {d_now:.1f} mm)")
        else:
            line += f"; kılavuz hattında kaldı (min. örtü ≈ {d_now:.1f} mm)"
        out.append(line)
    return out


def compute_centerline(field_: DepthField, implants: list[Implant], p: Params) -> CenterlineResult:
    frame = make_frame(implants, field_.mesh.vertices)
    ordered, inner, ap = order_implants(implants, frame)
    ids = [i.id for i in ordered]
    cant_limit = min(p.max_cantilever, p.cantilever_ap_ratio * ap) if len(ordered) > 2 else 0.0
    imp2d = frame.to2d([i.platform for i in ordered])

    # Tur 1: implant platformlarından geçen kılavuz, geniş arama
    guide0 = build_guide(ordered, frame, extension=cant_limit + p.sleeve_diameter / 2 + 8.0)
    pass0 = _run_pass(guide0, ordered, inner, frame, field_, p, p.lateral_search, cant_limit)
    pts0, _ = _smooth(pass0.stations, frame)

    # Tur 2: kılavuz = tur 1'in (yumuşatılmış) bar ekseni; kesitler gerçek bar eksenine dik, dar arama
    guide1 = guide_from_polyline(fair(frame.to2d(pts0), 2.0 * p.min_bend_radius), imp2d, extension=6.0)
    pass1 = _run_pass(guide1, ordered, inner, frame, field_, p, min(1.5, p.lateral_search), cant_limit)
    pts, sa = _smooth(pass1.stations, frame)
    pts = fair(pts, 1.25 * p.min_bend_radius)
    sa = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])

    d1 = np.gradient(pts, sa, axis=0)
    d2 = np.gradient(d1, sa, axis=0)
    kappa = np.linalg.norm(np.cross(d1, d2), axis=1) / np.maximum(np.linalg.norm(d1, axis=1) ** 3, 1e-9)
    min_r = float(1.0 / max(kappa[2:-2].max(), 1e-9))
    # Ped geometrisi: her halkada implant ekseninin yanal konumu
    garc = np.array([guide1.project(frame.to2d(q)) for q in pts])
    k, idx = pad_profile(garc, pass1.support, p, ordered, frame.up)
    _, n, b = sweep_frames(pts, frame.up)
    off = np.zeros((len(pts), 3))
    for j in range(len(pts)):
        imp = ordered[idx[j]]
        for m, dz in enumerate((-p.bar_height / 2, 0.0, p.bar_height / 2)):
            plane = pts[j] + dz * b[j]
            t = ((plane - imp.platform) @ b[j]) / (imp.axis @ b[j])
            off[j, m] = (imp.point_at(t) - pts[j]) @ n[j]
    lo, hi = section_bounds(k, off.min(axis=1), off.max(axis=1), p)

    return CenterlineResult(frame, ordered, guide1, pass1.stations, pts, sa, ap, cant_limit, pass1.support,
                            pass1.start_arc, pass1.end_arc, min_r, lo, hi,
                            decisions=_decisions(pass0, pass1, ids), warnings=pass1.warnings)
