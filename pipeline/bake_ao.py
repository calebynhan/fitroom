"""Per-vertex ambient occlusion, baked offline (the viewer's screen-space AO is too slow on phones).

For each vertex, cosine-weighted rays leave the surface along its normal; a hit within `radius` occludes by
(1 - distance / radius), so nearby contact (armpits, folds, inside collars) darkens and distant geometry fades
out instead of leaving a dirty gradient. Result: 1 = fully open, 0 = fully occluded (stored raw in COLOR_0.g).
"""
from __future__ import annotations

import bpy  # noqa: F401  (bpy-as-module provides mathutils)
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import garment_geom as gg

RAYS = 48
RADIUS = 0.12           # m: contact shading, not a global gradient
OFFSET = 0.0015         # m: start rays just off the surface (no self hits)
SMOOTH_ITERS = 2        # denoise over the mesh


def hemisphere(count: int) -> np.ndarray:
    """(count, 3) cosine-weighted directions around +Z (Fibonacci spiral: even, deterministic)."""
    i = np.arange(count) + 0.5
    r = np.sqrt(i / count)
    phi = np.pi * (3.0 - np.sqrt(5.0)) * i
    return np.column_stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(np.maximum(1.0 - r * r, 0.0))])


def _frames(normals: np.ndarray):
    """Orthonormal tangent frames (t, b, n) per normal."""
    n = normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    helper = np.where(np.abs(n[:, 2:3]) < 0.9, np.array([[0.0, 0.0, 1.0]]), np.array([[1.0, 0.0, 0.0]]))
    t = np.cross(helper, n)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    return t, np.cross(n, t), n


def vertex_ao(points: np.ndarray, normals: np.ndarray, occluders: list, faces: np.ndarray | None = None,
              rays: int = RAYS, radius: float = RADIUS) -> np.ndarray:
    """AO per point. occluders: list of (verts, faces) meshes (posed body, the garment itself, ...).
    faces: the points' own triangles, used to smooth the result (optional)."""
    verts, polys, offset = [], [], 0
    for v, f in occluders:
        verts.append(np.asarray(v))
        polys.append(np.asarray(f) + offset)
        offset += len(v)
    bvh = BVHTree.FromPolygons(np.concatenate(verts).tolist(), np.concatenate(polys).tolist())
    local = hemisphere(rays)
    t, b, n = _frames(normals)
    occ = np.zeros(len(points))
    for i in range(len(points)):
        origin = Vector(points[i] + n[i] * OFFSET)
        dirs = local[:, :1] * t[i] + local[:, 1:2] * b[i] + local[:, 2:3] * n[i]
        total = 0.0
        for d in dirs:
            hit, _, _, dist = bvh.ray_cast(origin, Vector(d), radius)
            if hit is not None:
                total += 1.0 - dist / radius
        occ[i] = total / rays
    ao = 1.0 - occ
    if faces is not None and SMOOTH_ITERS:
        ao = gg.diffuse(ao[:, None], faces, SMOOTH_ITERS)[:, 0]
    return np.clip(ao, 0.0, 1.0)
