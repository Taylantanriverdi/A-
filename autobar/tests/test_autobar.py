import json
import os

import numpy as np
import pytest
import trimesh

from primer_autobar.centerline import bend_radius, fair, make_frame, order_implants
from primer_autobar.config import Params
from primer_autobar.demo import make_case
from primer_autobar.geometry import rounded_rect, sweep, sweep_frames
from primer_autobar.io import Implant
from primer_autobar.pipeline import run


def test_sweep_is_closed_solid():
    pts = np.stack([np.linspace(0, 20, 41), np.zeros(41), np.zeros(41)], -1)
    _, n, b = sweep_frames(pts, np.array([0, 0, 1.0]))
    m = sweep(pts, n, b, rounded_rect(3.5, 4.0, 0.0001))
    assert m.is_watertight and m.is_volume
    assert m.volume == pytest.approx(3.5 * 4.0 * 20, rel=1e-3)


def test_order_implants_along_arch():
    up = np.array([0, 0, 1.0])
    imps = [Implant(i, np.array(p, float), up) for i, p in
            (("32", [8, 24, 0]), ("45", [-21, 13, 0]), ("42", [-8, 24, 0]), ("35", [21, 13, 0]))]
    ordered, _, ap = order_implants(imps, make_frame(imps))
    ids = [i.id for i in ordered]
    assert ids in (["35", "32", "42", "45"], ["45", "42", "32", "35"])
    assert ap == pytest.approx(11.0, abs=0.01)


def test_occlusal_frame_ignores_tilted_implants():
    """All-on-4 distal eğimleri 'up' yönünü bozmamalı: restorasyonun düzlemi esas alınır."""
    rng = np.random.default_rng(0)
    verts = np.c_[rng.uniform(-25, 25, 500), rng.uniform(-5, 30, 500), rng.uniform(0, 12, 500)]
    t = np.radians(30)
    imps = [Implant("a", np.zeros(3), np.array([0, -np.sin(t), np.cos(t)])),
            Implant("b", np.zeros(3), np.array([0, -np.sin(t), np.cos(t)]))]
    frame = make_frame(imps, verts)
    assert frame.up @ np.array([0, 0, 1.0]) > 0.99


def test_fair_removes_kink():
    x = np.linspace(-10, 10, 81)
    pts = np.stack([x, np.where(x > 0, x * 1.5, 0)], -1)  # 56° kırılma
    assert bend_radius(pts).min() < 1
    out = fair(pts, 5.0)
    assert bend_radius(out).min() >= 5.0
    assert np.allclose(out[0], pts[0]) and np.allclose(out[-1], pts[-1])


@pytest.fixture(scope="module")
def demo_run(tmp_path_factory):
    d = tmp_path_factory.mktemp("demo")
    resto, imps = make_case(str(d / "input"))
    rep = run(resto, imps, str(d / "out"), Params(), log=lambda *_: None)
    return d / "out", rep


def test_demo_case_passes(demo_run):
    out, rep = demo_run
    assert rep["status"] == "PASS", rep["summary"]
    for f in ("bar.stl", "restoration_cut.stl", "qa_report.json", "qa_report.txt", "bar_centerline.csv"):
        assert (out / f).exists()
    bar = trimesh.load(out / "bar.stl")
    assert bar.is_watertight and bar.is_volume
    assert len(bar.split(only_watertight=False)) == 1


def test_demo_report_contents(demo_run):
    out, rep = demo_run
    checks = {c["name"]: c for c in rep["checks"]}
    assert checks["restorasyon_ortusu"]["value"] >= 2.0 - 0.05
    assert checks["ti_duvar_kalinligi"]["value"] >= 1.2 - 0.05
    for side in ("35", "45"):
        c = checks[f"kantilever_#{side}"]
        assert 5.0 < c["value"] <= c["limit"] + 0.5
    for imp in ("32", "42", "35", "45"):
        assert checks[f"baglanti_#{imp}"]["status"] == "PASS"
    assert any("kaydırıldı" in d for d in rep["decisions"])
    with open(out / "qa_report.json", encoding="utf-8") as fh:
        assert json.load(fh)["status"] == "PASS"


def test_narrow_anterior_is_reported(tmp_path):
    """Ön bölge çok dar + implantlar lingualde: yazılım 'PASS' dememeli, bölgeyi göstermeli."""
    resto, imps = make_case(str(tmp_path / "input"), lingual_offset=1.2, anterior_width=8.5)
    rep = run(resto, imps, str(tmp_path / "out"), Params(), cut=False, log=lambda *_: None)
    assert rep["status"] == "FAIL"
    cover = {c["name"]: c for c in rep["checks"]}["restorasyon_ortusu"]
    assert cover["status"] == "FAIL"
    assert "#32" in cover["message"] or "#42" in cover["message"]
    assert not os.path.exists(tmp_path / "out" / "restoration_cut.stl")
