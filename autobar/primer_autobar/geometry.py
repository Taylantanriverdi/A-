"""Temel geometri yardımcıları: kesit, sweep, silindir, boolean."""
from __future__ import annotations

import numpy as np
import trimesh


def normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.where(n == 0, 1, n)


def rounded_rect(width: float, height: float, radius: float, n_corner: int = 6) -> np.ndarray:
    """Merkezli yuvarlatılmış dikdörtgen kesit, (K,2) saat yönü tersine (u=genişlik, v=yükseklik)."""
    r = max(0.0, min(radius, width / 2 - 1e-3, height / 2 - 1e-3))
    cx, cy = width / 2 - r, height / 2 - r
    pts = []
    for (sx, sy, a0) in ((1, 1, 0.0), (-1, 1, 90.0), (-1, -1, 180.0), (1, -1, 270.0)):
        for a in np.radians(np.linspace(a0, a0 + 90.0, n_corner)):
            pts.append((sx * cx + r * np.cos(a), sy * cy + r * np.sin(a)))
    pts = np.array(pts)
    keep = np.ones(len(pts), bool)
    keep[1:] = np.linalg.norm(np.diff(pts, axis=0), axis=1) > 1e-6
    return pts[keep]


def sweep_frames(points: np.ndarray, up: np.ndarray):
    """Eğri boyunca (T, N, B) çerçeveleri. N yatay (bukko-lingual), B ~ up."""
    t = normalize(np.gradient(points, axis=0))
    n = normalize(np.cross(up, t))
    b = normalize(np.cross(t, n))
    return t, n, b


def sweep(points: np.ndarray, normals: np.ndarray, binormals: np.ndarray, sections) -> trimesh.Trimesh:
    """Kesit(ler)i eğri boyunca süpür, uçları kapat. sections: (K,2) ya da her nokta için (K,2) listesi."""
    m = len(points)
    if isinstance(sections, np.ndarray) and sections.ndim == 2:
        sections = [sections] * m
    k = len(sections[0])
    verts = np.empty((m * k + 2, 3))
    for j in range(m):
        s = sections[j]
        verts[j * k:(j + 1) * k] = points[j] + s[:, :1] * normals[j] + s[:, 1:] * binormals[j]
    verts[m * k] = verts[:k].mean(axis=0)
    verts[m * k + 1] = verts[(m - 1) * k:m * k].mean(axis=0)
    faces = []
    jj, kk = np.meshgrid(np.arange(m - 1), np.arange(k), indexing="ij")
    a = (jj * k + kk).ravel()
    b = (jj * k + (kk + 1) % k).ravel()
    c = a + k
    d = b + k
    faces.append(np.stack([a, b, d], 1))
    faces.append(np.stack([a, d, c], 1))
    ring = np.arange(k)
    faces.append(np.stack([np.full(k, m * k), (ring + 1) % k, ring], 1))
    last = (m - 1) * k
    faces.append(np.stack([np.full(k, m * k + 1), last + ring, last + (ring + 1) % k], 1))
    mesh = trimesh.Trimesh(verts, np.vstack(faces), process=True)
    if mesh.volume < 0:
        mesh.invert()
    return mesh


def cylinder(p0: np.ndarray, p1: np.ndarray, radius: float, sections: int = 48) -> trimesh.Trimesh:
    return trimesh.creation.cylinder(radius=radius, segment=np.array([p0, p1]), sections=sections)


def union(meshes) -> trimesh.Trimesh:
    meshes = [m for m in meshes if m is not None]
    if len(meshes) == 1:
        return meshes[0]
    return trimesh.boolean.union(meshes, engine="manifold")


def difference(a: trimesh.Trimesh, cutters) -> trimesh.Trimesh:
    cutters = [c for c in cutters if c is not None]
    if not cutters:
        return a
    return trimesh.boolean.difference([a] + cutters, engine="manifold")


def finalize(mesh: trimesh.Trimesh, tolerance: float = 1e-3) -> trimesh.Trimesh:
    """Boolean sonrası temizlik: mikro kenarları manifold koruyarak çökert (STL float32'de bozulmasın)."""
    import manifold3d

    m = manifold3d.Manifold(manifold3d.Mesh(vert_properties=np.asarray(mesh.vertices, np.float32),
                                            tri_verts=np.asarray(mesh.faces, np.uint32)))
    out = m.simplify(tolerance).to_mesh()
    return trimesh.Trimesh(np.asarray(out.vert_properties)[:, :3], np.asarray(out.tri_verts), process=True)


def export_verified(mesh: trimesh.Trimesh, path: str) -> trimesh.Trimesh:
    """STL'e yaz ve diskteki dosyayı geri oku (QA üretime gidecek dosya üzerinde yapılır)."""
    mesh.export(path)
    return trimesh.load_mesh(path, force="mesh")


def intersection(meshes) -> trimesh.Trimesh:
    return trimesh.boolean.intersection(meshes, engine="manifold")
