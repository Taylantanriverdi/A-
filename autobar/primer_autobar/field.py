"""Restorasyon içi derinlik alanı (signed distance). Pozitif = restorasyonun içinde."""
from __future__ import annotations

import numpy as np
import trimesh
from scipy.spatial import cKDTree


class DepthField:
    def __init__(self, mesh: trimesh.Trimesh, spacing: float = 0.2, seed: int = 0):
        self.mesh = mesh
        n = int(np.clip(3.0 * mesh.area / spacing ** 2, 20_000, 3_000_000))
        pts, _ = trimesh.sample.sample_surface(mesh, n, seed=seed)
        self._tree = cKDTree(np.vstack([pts, mesh.vertices]))

    def depth(self, q: np.ndarray) -> np.ndarray:
        """Hızlı yaklaşık derinlik (yüzey örnekleri ile, ~spacing/2 hassasiyet)."""
        q = np.asarray(q, float).reshape(-1, 3)
        d, _ = self._tree.query(q, workers=-1)
        inside = self.mesh.contains(q)
        return np.where(inside, d, -d)

    def depth_exact(self, q: np.ndarray) -> np.ndarray:
        """Kesin derinlik (en yakın üçgene uzaklık). Yavaş; QA için."""
        q = np.asarray(q, float).reshape(-1, 3)
        _, d, _ = trimesh.proximity.closest_point(self.mesh, q)
        inside = self.mesh.contains(q)
        return np.where(inside, d, -d)
