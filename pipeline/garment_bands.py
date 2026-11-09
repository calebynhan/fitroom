"""Hems, cuffs, collars and waistbands (pure numpy).

classify_loops names a garment's open edges; band_weight measures how far each vertex sits inside a band;
add_turnbacks folds fabric back inside each edge so it reads as a real finished edge (rounded and a few mm
thick) instead of a paper-thin cut.
"""
from __future__ import annotations

import numpy as np

import garment_geom as gg
from garment_spec import Band, GarmentSpec

LIP_OUT = 0.45      # rounded lip: how far (x thickness) the fold bulges past the cut edge


def classify_loops(v: np.ndarray, f: np.ndarray, slot: str) -> dict:
    """Map edge names to ordered boundary loops. Tops: collar, hem, cuff_l, cuff_r. Pants: waist, leg_l, leg_r."""
    loops = gg.boundary_loops(f)
    expected = 4 if slot == "top" else 3
    if len(loops) != expected:
        sizes = sorted((len(lp) for lp in loops), reverse=True)
        raise RuntimeError(f"{slot}: expected {expected} open edges, found {len(loops)} (sizes {sizes})")
    centres = np.array([v[lp].mean(axis=0) for lp in loops])
    order = np.argsort(-centres[:, 2])
    top = loops[order[0]]
    rest = [loops[i] for i in order[1:]]
    if slot == "top":
        hem_i = int(np.argmin([abs(v[lp, 0].mean()) for lp in rest]))
        hem = rest.pop(hem_i)
        left, right = sorted(rest, key=lambda lp: -v[lp, 0].mean())
        return {"collar": top, "hem": hem, "cuff_l": left, "cuff_r": right}
    left, right = sorted(rest, key=lambda lp: -v[lp, 0].mean())
    return {"waist": top, "leg_l": left, "leg_r": right}


def band_of(name: str) -> str:
    """cuff_l -> cuff, leg_r -> leg."""
    return name.split("_")[0]


def edge_distance(v: np.ndarray, f: np.ndarray, loops: dict, limit: float = 0.3) -> dict:
    """Surface distance from each named edge, per vertex."""
    return {name: gg.geodesic_from(v, f, lp, limit) for name, lp in loops.items()}


def band_weight(dist: np.ndarray, height: float, soft: float = 0.006) -> np.ndarray:
    """1 inside the band, easing to 0 over `soft` metres past its stitch line."""
    return 1.0 - gg.smoothstep(height - soft, height + soft, dist)


def band_fields(dists: dict, spec: GarmentSpec) -> dict:
    """Per-vertex maps from the bands: rib mask, cloth shrink, cloth pin and outward ridge offset."""
    n = len(next(iter(dists.values())))
    rib, shrink, pin, ridge = (np.zeros(n) for _ in range(4))
    for name, d in dists.items():
        band: Band = spec.bands[band_of(name)]
        w = band_weight(d, band.height)
        if band.rib:
            rib = np.maximum(rib, w)
        shrink = np.where(w > 0, (1 - w) * shrink + w * band.shrink, shrink)
        pin = np.maximum(pin, band.pin * w)
        crisp = band_weight(d, band.height, soft=0.0015)
        ridge = np.maximum(ridge, band.ridge * crisp)
    return {"rib": rib, "shrink": shrink, "pin": pin, "ridge": ridge}


def _loop_frames(v: np.ndarray, normals: np.ndarray, loop: np.ndarray):
    """Per loop vertex: outward surface normal n, and u pointing from the edge into the fabric."""
    p = v[loop]
    t = np.roll(p, -1, axis=0) - np.roll(p, 1, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    n = normals[loop]
    u = np.cross(n, t)                      # interior lies to the left of the loop direction
    u /= np.maximum(np.linalg.norm(u, axis=1, keepdims=True), 1e-12)
    return n, u


def _inside_surface(bvh, targets: np.ndarray, depth: float) -> np.ndarray:
    """Points `depth` behind the outer fabric nearest to each target: the turned-back strip follows the fabric's
    folds instead of cutting straight across them (a straight offset pokes through a wavy hem). Nearest *surface*
    points, not vertices: snapping to vertices stacks strip verts on one spot (zero-area faces)."""
    from mathutils import Vector
    out = np.empty_like(targets)
    for i, t in enumerate(targets):
        loc, nrm, _, _ = bvh.find_nearest(Vector(t))
        out[i] = np.array(loc) - np.array(nrm) * depth
    return out


def add_turnbacks(v: np.ndarray, f: np.ndarray, loops: dict, spec: GarmentSpec, thickness: float):
    """Append a folded-back strip inside every edge with band.turn > 0.

    Each strip is four rows: a rounded lip just past the edge, a row one fabric thickness inside the
    edge, then two rows that follow the outer fabric up to `turn` metres inside. Winding continues the
    sheet around the fold, so shading stays smooth. Returns (v, f, parent) where parent[i] is the original
    vertex a new vertex copies skin weights, morphs and attributes from (identity for original vertices).
    """
    from mathutils.bvhtree import BVHTree
    normals = gg.vertex_normals(v, f)
    bvh = BVHTree.FromPolygons(v.tolist(), f.tolist())
    verts, faces = [v], [f]
    parent = [np.arange(len(v))]
    count = len(v)
    for name, loop in loops.items():
        band: Band = spec.bands[band_of(name)]
        if band.turn <= 0:
            continue
        n, u = _loop_frames(v, normals, loop)
        p = v[loop]
        rows = [p - u * (LIP_OUT * thickness) - n * (0.5 * thickness),
                p - n * thickness,
                _inside_surface(bvh, p + u * (0.5 * band.turn), thickness),
                _inside_surface(bvh, p + u * band.turn, thickness)]
        ids = [loop] + [count + k * len(loop) + np.arange(len(loop)) for k in range(len(rows))]
        for a, b in zip(ids[:-1], ids[1:]):
            a1, b1 = np.roll(a, -1), np.roll(b, -1)
            # the original face holds edge a -> a1, so the strip face must run a1 -> a
            faces.append(np.column_stack([a1, a, b]))
            faces.append(np.column_stack([a1, b, b1]))
        verts += rows
        parent += [loop] * len(rows)
        count += len(rows) * len(loop)
    return np.concatenate(verts), np.concatenate(faces), np.concatenate(parent)
