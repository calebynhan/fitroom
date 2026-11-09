"""Pure numpy/scipy triangle-mesh helpers for garment building (no bpy)."""
from __future__ import annotations

import numpy as np
from scipy.sparse import coo_matrix, diags
from scipy.sparse.csgraph import connected_components


def face_normals(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    """Area-weighted (unnormalised) face normals."""
    return np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])


def vertex_normals(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    fn = face_normals(v, f)
    vn = np.zeros_like(v)
    for k in range(3):
        np.add.at(vn, f[:, k], fn)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)


def edges_with_counts(f: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    e = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    return np.unique(e, axis=0, return_counts=True)


def boundary_edges(f: np.ndarray) -> np.ndarray:
    e, c = edges_with_counts(f)
    return e[c == 1]


def submesh(v: np.ndarray, f: np.ndarray, face_keep: np.ndarray):
    """Keep selected faces; drop unreferenced verts. Returns (v, f, old_index_of_new_vert)."""
    f2 = f[face_keep]
    used = np.unique(f2)
    remap = -np.ones(len(v), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return v[used], remap[f2], used


def largest_component(v: np.ndarray, f: np.ndarray):
    e, _ = edges_with_counts(f)
    adj = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(v), len(v)))
    _, labels = connected_components(adj, directed=False)
    counts = np.bincount(labels[f[:, 0]])
    keep = labels[f[:, 0]] == np.argmax(counts)
    return submesh(v, f, keep)


def _row_normalised(e: np.ndarray, n: int):
    rows = np.concatenate([e[:, 0], e[:, 1]])
    cols = np.concatenate([e[:, 1], e[:, 0]])
    a = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)).tocsr()
    deg = np.asarray(a.sum(axis=1)).ravel()
    return diags(1.0 / np.maximum(deg, 1)) @ a, deg > 0


def taubin_smooth(v: np.ndarray, f: np.ndarray, iters: int = 10, lam: float = 0.5, mu: float = -0.53,
                  pinned: np.ndarray | None = None) -> np.ndarray:
    """Volume-preserving-ish smoothing. Boundary verts smooth only along the boundary (clean hems)."""
    n = len(v)
    all_e, _ = edges_with_counts(f)
    b_e = boundary_edges(f)
    w_all, _ = _row_normalised(all_e, n)
    w_bnd, has_b = _row_normalised(b_e, n)
    is_b = np.zeros(n, dtype=bool)
    is_b[b_e.ravel()] = True
    free = np.ones(n, dtype=bool) if pinned is None else ~pinned
    out = v.copy()
    for _ in range(iters):
        for step in (lam, mu):
            avg = np.where(is_b[:, None], w_bnd @ out, w_all @ out)
            out = out + np.where(free[:, None], step * (avg - out), 0.0)
    return out


def drop_long_edge_faces(v: np.ndarray, f: np.ndarray, factor: float = 4.0):
    """Spike cleanup: remove faces with any edge longer than factor x median edge length."""
    e, _ = edges_with_counts(f)
    med = np.median(np.linalg.norm(v[e[:, 0]] - v[e[:, 1]], axis=1))
    lens = np.stack([np.linalg.norm(v[f[:, a]] - v[f[:, b]], axis=1) for a, b in ((0, 1), (1, 2), (2, 0))], 1)
    keep = lens.max(axis=1) <= factor * med
    return submesh(v, f, keep), int((~keep).sum())


def snap_boundary_to_planes(v: np.ndarray, f: np.ndarray, planes, tol: float) -> np.ndarray:
    """Project each boundary vert onto its nearest cut plane (point, unit normal) if within tol."""
    if not planes:
        return v
    out = v.copy()
    bidx = np.unique(boundary_edges(f))
    pts = out[bidx]
    d = np.stack([(pts - p) @ n for p, n in planes], axis=1)
    best = np.argmin(np.abs(d), axis=1)
    dist = d[np.arange(len(bidx)), best]
    normals = np.stack([planes[i][1] for i in best])
    ok = np.abs(dist) < tol
    out[bidx[ok]] = pts[ok] - dist[ok, None] * normals[ok]
    return out


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def push_radial(v: np.ndarray, centre: np.ndarray, axis: np.ndarray | None, target_r: np.ndarray,
                blend: np.ndarray) -> np.ndarray:
    """Move verts outward (never inward) from an axis line until radius >= target, blended per vert.

    centre: (n,3) point on the axis for each vert. axis: (n,3) unit axis per vert, or None for world Z.
    """
    d = v - centre
    if axis is None:
        radial = d.copy()
        radial[:, 2] = 0.0
    else:
        radial = d - (d * axis).sum(1, keepdims=True) * axis
    r = np.linalg.norm(radial, axis=1)
    unit = radial / np.maximum(r, 1e-9)[:, None]
    grow = np.maximum(target_r - r, 0.0) * blend
    return v + unit * grow[:, None]


def polar_profile(points_xy: np.ndarray, centre_xy: np.ndarray, bins: int = 48) -> np.ndarray:
    """Max radius per angular bin around centre (circular-interpolated over empty bins)."""
    d = points_xy - centre_xy
    ang = np.arctan2(d[:, 1], d[:, 0])
    r = np.linalg.norm(d, axis=1)
    idx = ((ang + np.pi) / (2 * np.pi) * bins).astype(int) % bins
    prof = np.full(bins, np.nan)
    for b in range(bins):
        sel = r[idx == b]
        if sel.size:
            prof[b] = sel.max()
    good = ~np.isnan(prof)
    xs = np.arange(bins)
    return np.interp(xs, xs[good], prof[good], period=bins)


def sample_profile(prof: np.ndarray, d_xy: np.ndarray) -> np.ndarray:
    bins = len(prof)
    ang = np.arctan2(d_xy[:, 1], d_xy[:, 0])
    pos = (ang + np.pi) / (2 * np.pi) * bins - 0.5
    return np.interp(pos, np.arange(bins), prof, period=bins)


def barycentric(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Barycentric coords of p on triangles (a,b,c), clipped to the triangle and renormalised."""
    v0, v1, v2 = b - a, c - a, p - a
    d00 = (v0 * v0).sum(1)
    d01 = (v0 * v1).sum(1)
    d11 = (v1 * v1).sum(1)
    d20 = (v2 * v0).sum(1)
    d21 = (v2 * v1).sum(1)
    den = np.maximum(d00 * d11 - d01 * d01, 1e-18)
    bv = (d11 * d20 - d01 * d21) / den
    bw = (d00 * d21 - d01 * d20) / den
    bary = np.clip(np.stack([1 - bv - bw, bv, bw], 1), 0.0, None)
    return bary / np.maximum(bary.sum(1, keepdims=True), 1e-12)


def triangulate(polys: list, v: np.ndarray) -> np.ndarray:
    """Split quads (and fan-split larger polygons) into triangles; quads use their shorter diagonal."""
    tris = []
    for p in polys:
        if len(p) == 3:
            tris.append(p)
        elif len(p) == 4:
            a, b, c, d = p
            if np.linalg.norm(v[a] - v[c]) <= np.linalg.norm(v[b] - v[d]):
                tris += [(a, b, c), (a, c, d)]
            else:
                tris += [(a, b, d), (b, c, d)]
        else:
            tris += [(p[0], p[k], p[k + 1]) for k in range(1, len(p) - 1)]
    return np.array(tris, dtype=np.int64)


def boundary_loops(f: np.ndarray) -> list:
    """Ordered vertex loops along the open boundary, oriented like the faces (interior on the left)."""
    directed = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    key = np.sort(directed, axis=1)
    _, inv, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    bnd = directed[counts[inv.ravel()] == 1]
    nxt = {int(a): int(b) for a, b in bnd}
    loops, seen = [], set()
    for start in nxt:
        if start in seen:
            continue
        loop, cur = [], start
        while cur not in seen:
            seen.add(cur)
            loop.append(cur)
            cur = nxt.get(cur, start)
        loops.append(np.array(loop, dtype=np.int64))
    return loops


def edge_lengths(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    e, _ = edges_with_counts(f)
    return np.linalg.norm(v[e[:, 0]] - v[e[:, 1]], axis=1)


def geodesic_from(v: np.ndarray, f: np.ndarray, seeds: np.ndarray, limit: float = np.inf) -> np.ndarray:
    """Approximate surface distance (Dijkstra along edges) from the seed verts."""
    from scipy.sparse.csgraph import dijkstra
    e, _ = edges_with_counts(f)
    w = np.linalg.norm(v[e[:, 0]] - v[e[:, 1]], axis=1)
    g = coo_matrix((w, (e[:, 0], e[:, 1])), shape=(len(v), len(v))).tocsr()
    d = dijkstra(g, directed=False, indices=np.asarray(seeds), min_only=True, limit=limit)
    return d


def subdivide(v: np.ndarray, f: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Split every triangle into 4 at its edge midpoints. Returns (v, f, parents) where parents is
    (n_new, 2): the two original vertices each vertex interpolates (an original vertex lists itself twice)."""
    e, _ = edges_with_counts(f)
    n = len(v)
    mid = {(int(a), int(b)): n + i for i, (a, b) in enumerate(e)}
    key = lambda a, b: mid[(a, b) if a < b else (b, a)]  # noqa: E731
    faces = []
    for a, b, c in f.tolist():
        ab, bc, ca = key(a, b), key(b, c), key(c, a)
        faces += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
    parents = np.concatenate([np.repeat(np.arange(n)[:, None], 2, axis=1), e])
    v2 = np.concatenate([v, 0.5 * (v[e[:, 0]] + v[e[:, 1]])])
    return v2, np.array(faces, dtype=np.int64), parents


def convex_outline(xy: np.ndarray, samples: int) -> np.ndarray:
    """Convex hull of 2D points, resampled to `samples` points evenly spaced along its perimeter (CCW)."""
    from scipy.spatial import ConvexHull
    hull = xy[ConvexHull(xy).vertices]
    closed = np.vstack([hull, hull[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    t = np.linspace(0.0, s[-1], samples, endpoint=False)
    return np.column_stack([np.interp(t, s, closed[:, 0]), np.interp(t, s, closed[:, 1])])


def diffuse(field: np.ndarray, f: np.ndarray, iters: int) -> np.ndarray:
    """Spread a per-vertex field over the mesh by repeated neighbour averaging (keeps each vertex's share)."""
    e, _ = edges_with_counts(f)
    w, _ = _row_normalised(e, len(field))
    out = field.copy()
    for _ in range(iters):
        out = 0.5 * out + 0.5 * (w @ out)
    return out


def flipped_faces(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    """Faces folded over against their neighbours: face normal opposes the mean normal of its corners."""
    fn = face_normals(v, f)
    corner = vertex_normals(v, f)[f].sum(axis=1)
    return (fn * corner).sum(axis=1) < 0


def unfold(v: np.ndarray, f: np.ndarray, iters: int = 8) -> tuple[np.ndarray, int, int]:
    """Relax the corners of folded-over faces toward their neighbours until none are left (or iters run out).
    Returns (positions, flipped before, flipped after)."""
    e, _ = edges_with_counts(f)
    avg_op, _ = _row_normalised(e, len(v))
    out = v.copy()
    before = int(flipped_faces(out, f).sum())
    for _ in range(iters):
        bad = flipped_faces(out, f)
        if not bad.any():
            break
        idx = np.unique(f[bad])
        out[idx] = (avg_op @ out)[idx]
    return out, before, int(flipped_faces(out, f).sum())
