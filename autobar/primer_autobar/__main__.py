"""Komut satırı.

    python -m primer_autobar run --restoration hibrit.stl --implants implants.json --out cikti/
    python -m primer_autobar demo --out demo_cikti/
"""
from __future__ import annotations

import argparse
import os
import sys

from .config import Params
from .pipeline import run
from .qa import format_report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="primer_autobar", description="PRIMER AUTO BAR V1 — otomatik Ti bar")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="Vakadan bar üret")
    r.add_argument("--restoration", required=True, help="Full-arch hibrit restorasyon STL (kapalı mesh)")
    r.add_argument("--implants", required=True, help="implants.json")
    r.add_argument("--params", help="Parametre JSON (opsiyonel)")
    r.add_argument("--out", required=True, help="Çıktı klasörü")
    r.add_argument("--no-cut", action="store_true", help="Restorasyon iç boşluğunu açma")

    d = sub.add_parser("demo", help="Sentetik All-on-4 vakası üret ve çalıştır")
    d.add_argument("--out", default="demo_out")
    d.add_argument("--params")

    a = ap.parse_args(argv)
    params = Params.from_json(a.params)
    if a.cmd == "demo":
        from .demo import make_case
        resto, imps = make_case(os.path.join(a.out, "input"))
        rep = run(resto, imps, a.out, params)
    else:
        rep = run(a.restoration, a.implants, a.out, params, cut=not a.no_cut)
    print()
    print(format_report(rep))
    return 0 if rep["status"] == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
