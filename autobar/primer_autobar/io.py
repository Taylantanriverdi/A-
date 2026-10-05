"""Girdi okuma: restorasyon mesh'i ve implant listesi."""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np
import trimesh


@dataclass
class Implant:
    id: str
    platform: np.ndarray  # MUA/implant platform merkezi (bar-oturma noktası)
    axis: np.ndarray      # birim vektör, platformdan protezin okluzaline doğru

    def point_at(self, t: float) -> np.ndarray:
        return self.platform + t * self.axis


def load_implants(path: str) -> list[Implant]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    items = data["implants"] if isinstance(data, dict) else data
    out = []
    for it in items:
        axis = np.asarray(it["axis"], float)
        n = np.linalg.norm(axis)
        if n == 0:
            raise ValueError(f"İmplant {it['id']}: eksen vektörü sıfır")
        out.append(Implant(str(it["id"]), np.asarray(it["platform"], float), axis / n))
    if len(out) < 2:
        raise ValueError("En az 2 implant gerekli")
    return out


def save_implants(path: str, implants: list[Implant]) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"units": "mm", "implants": [
            {"id": i.id, "platform": i.platform.round(4).tolist(), "axis": i.axis.round(6).tolist()}
            for i in implants]}, fh, indent=2)


def load_restoration(path: str) -> trimesh.Trimesh:
    mesh = trimesh.load_mesh(path, force="mesh")
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    if not mesh.is_watertight:
        trimesh.repair.fill_holes(mesh)
    trimesh.repair.fix_normals(mesh)
    if not mesh.is_watertight:
        raise ValueError(
            "Restorasyon mesh'i kapalı (watertight) değil. Bar hacmi hesaplanabilmesi için "
            "protezin dış ve iç (intaglio) yüzeyi kapalı tek gövde olmalı.")
    return mesh
