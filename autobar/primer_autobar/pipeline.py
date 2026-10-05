"""Uçtan uca akış: STL + implantlar -> bar STL + kesilmiş restorasyon + QA raporu."""
from __future__ import annotations

import json
import os
import time

import numpy as np

from .builder import build_bar, cut_restoration, fill_screw_holes
from .centerline import compute_centerline
from .config import Params
from .field import DepthField
from .geometry import export_verified
from .io import Implant, load_implants, load_restoration
from .qa import format_report, run_qa


def run(restoration_path: str, implants_path: str, out_dir: str, params: Params | None = None,
        cut: bool = True, log=print) -> dict:
    p = params or Params()
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()

    log("1/7 Girdiler okunuyor")
    restoration = load_restoration(restoration_path)
    implants: list[Implant] = load_implants(implants_path)

    log("2/7 Güvenli hacim (derinlik alanı) hesaplanıyor")
    analysis = fill_screw_holes(restoration, implants, p) if p.fill_screw_holes else restoration
    field_ = DepthField(analysis, p.sdf_spacing)

    log("3/7 Merkez hattı optimize ediliyor")
    cl = compute_centerline(field_, implants, p)

    log("4/7 Bar, silindirler ve vida kanalları oluşturuluyor")
    bar, conns = build_bar(cl, p)
    bar = export_verified(bar, os.path.join(out_dir, "bar.stl"))
    np.savetxt(os.path.join(out_dir, "bar_centerline.csv"), cl.points, delimiter=",",
               header="x,y,z", comments="", fmt="%.4f")

    if cut:
        log("5/7 Hibrit (restorasyon) iç boşluğu açılıyor")
        hybrid = export_verified(cut_restoration(restoration, cl, conns, p),
                                 os.path.join(out_dir, "restoration_cut.stl"))
        if not hybrid.is_watertight:
            log("UYARI: kesilmiş restorasyon mesh'i kapalı değil")
    else:
        log("5/7 Restorasyon kesimi atlandı")

    log("6/7 QA kontrolleri")
    rep = run_qa(bar, cl, conns, field_, p)
    rep["params"] = p.to_dict()
    rep["elapsed_s"] = round(time.time() - t0, 1)
    with open(os.path.join(out_dir, "qa_report.json"), "w", encoding="utf-8") as fh:
        json.dump(rep, fh, ensure_ascii=False, indent=2)
    text = format_report(rep)
    with open(os.path.join(out_dir, "qa_report.txt"), "w", encoding="utf-8") as fh:
        fh.write(text + "\n")

    log(f"7/7 Bitti ({rep['elapsed_s']} s): {rep['summary']}")
    return rep
