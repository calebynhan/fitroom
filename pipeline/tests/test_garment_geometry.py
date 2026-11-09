"""Unit tests for the pure-numpy garment geometry (run: .venv/bin/python -m pytest pipeline/tests)."""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import garment_bands as gb  # noqa: E402
import garment_geom as gg  # noqa: E402
import sculpt  # noqa: E402
from garment_spec import Band, GarmentSpec  # noqa: E402


def tube(centre, axis_z: bool, radius=0.05, length=0.2, ring=24, rows=8):
    """Open cylinder (outward normals) along Z (or X), returns (v, f)."""
    ang = np.linspace(0, 2 * np.pi, ring, endpoint=False)
    t = np.linspace(-length / 2, length / 2, rows)
    v = []
    for h in t:
        for a in ang:
            p = (radius * np.cos(a), radius * np.sin(a), h) if axis_z else (h, radius * np.cos(a), radius * np.sin(a))
            v.append(p)
    v = np.array(v) + np.asarray(centre)
    f = []
    for r in range(rows - 1):
        for k in range(ring):
            a, b = r * ring + k, r * ring + (k + 1) % ring
            c, d = a + ring, b + ring
            f += [(a, b, d), (a, d, c)]
    return v, np.array(f)


def directed_edges(f):
    return np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])


def test_triangulate_quads_and_ngons():
    v = np.array([[x, y, 0.0] for y in range(3) for x in range(3)])
    quads = [(0, 1, 4, 3), (1, 2, 5, 4), (3, 4, 7, 6), (4, 5, 8, 7)]
    assert gg.triangulate(quads, v).shape == (8, 3)
    assert gg.triangulate([(0, 1, 2, 5, 4)], v).shape == (3, 3)


def test_boundary_loops_are_ordered_and_closed():
    v, f = tube((0, 0, 0), True)
    loops = gg.boundary_loops(f)
    assert sorted(len(lp) for lp in loops) == [24, 24]
    for lp in loops:
        z = v[lp, 2]
        assert np.ptp(z) < 1e-9                       # each loop is one ring
        step = np.linalg.norm(np.diff(v[np.append(lp, lp[0])], axis=0), axis=1)
        assert step.max() < 2.5 * step.min()         # consecutive neighbours, no jumps


def test_subdivide_parents_and_counts():
    v, f = tube((0, 0, 0), True, ring=8, rows=3)
    v2, f2, parents = gg.subdivide(v, f)
    assert len(f2) == 4 * len(f)
    assert np.allclose(v2, 0.5 * (v[parents[:, 0]] + v[parents[:, 1]]))
    assert len(gg.boundary_loops(f2)) == 2


def test_convex_outline_resamples_evenly():
    pts = np.random.default_rng(0).random((200, 2))
    out = gg.convex_outline(pts, 40)
    step = np.linalg.norm(np.diff(np.vstack([out, out[:1]]), axis=0), axis=1)
    assert out.shape == (40, 2)
    assert step.std() / step.mean() < 0.05


def test_geodesic_grows_away_from_seed_ring():
    v, f = tube((0, 0, 0), True, length=0.2, rows=11)
    bottom = np.nonzero(v[:, 2] < -0.099)[0]
    d = gg.geodesic_from(v, f, bottom)
    assert np.allclose(d[bottom], 0.0)
    assert d[v[:, 2] > 0.099].min() == pytest.approx(0.2, rel=0.05)


def top_like():
    """Four open edges like a top: body tube (collar + hem) and one sleeve tube (two cuff-like rings)."""
    vb, fb = tube((0, 0, 1.2), True, radius=0.15, length=0.6)
    vs, fs = tube((0.3, 0, 1.3), False, radius=0.05, length=0.1)
    return np.concatenate([vb, vs]), np.concatenate([fb, fs + len(vb)])


def test_classify_loops_names_top_edges():
    v, f = top_like()
    loops = gb.classify_loops(v, f, "top")
    assert set(loops) == {"collar", "hem", "cuff_l", "cuff_r"}
    assert v[loops["collar"], 2].mean() == pytest.approx(1.5)
    assert abs(v[loops["hem"], 0].mean()) < 1e-6


def test_classify_loops_rejects_wrong_edge_count():
    v, f = tube((0, 0, 0), True)
    with pytest.raises(RuntimeError, match="expected 4 open edges"):
        gb.classify_loops(v, f, "top")


def test_band_weight_is_one_inside_and_zero_outside():
    d = np.array([0.0, 0.01, 0.03, 0.05])
    w = gb.band_weight(d, 0.02, soft=0.005)
    assert w[0] == 1.0 and w[1] == 1.0 and w[3] == 0.0


SPEC = GarmentSpec("t", "top", ease=0.01, yoke_ease=0.01, sleeve_ease=0.01, thickness=0.002,
                   bands={"hem": Band(0.02, turn=0.02), "collar": Band(0.02, rib=True, shrink=0.05, pin=1.0)})


def test_add_turnbacks_closes_the_edge_and_keeps_winding():
    v, f = tube((0, 0, 0), True, rows=11)
    loops = {"hem": gg.boundary_loops(f)[0], "collar": gg.boundary_loops(f)[1]}
    v2, f2, parent = gb.add_turnbacks(v, f, loops, SPEC, SPEC.thickness)
    assert len(v2) == len(v) + 4 * len(loops["hem"])          # collar has turn=0
    assert np.array_equal(parent[: len(v)], np.arange(len(v)))
    d = directed_edges(f2)
    key = [tuple(e) for e in d]
    assert len(key) == len(set(key))                            # no edge used twice in one direction
    assert len(gg.boundary_loops(f2)) == 2                      # hem loop moved to the strip's inner edge
    inner = v2[len(v):]
    r = np.linalg.norm(inner[:, :2], axis=1)
    assert r[len(loops["hem"]):].max() < 0.05                   # strip lies inside the outer fabric


def test_band_fields_mark_rib_collar_only():
    v, f = tube((0, 0, 0), True, rows=11)
    lp = gg.boundary_loops(f)
    loops = {"hem": lp[0], "collar": lp[1]}
    fields = gb.band_fields(gb.edge_distance(v, f, loops), SPEC)
    assert fields["rib"][loops["collar"]].min() == 1.0
    assert fields["rib"][loops["hem"]].max() == 0.0
    assert fields["pin"][loops["collar"]].min() == 1.0
    assert fields["shrink"][loops["collar"]].min() == pytest.approx(0.05)


def test_mannequin_chest_only_moves_near_the_nipples():
    rng = np.random.default_rng(1)
    co = np.column_stack([rng.uniform(-0.2, 0.2, 4000), rng.uniform(-0.1, 0.1, 4000), rng.uniform(0, 1.8, 4000)])
    co[0] = (0.1, -0.2, 1.3)       # most forward point of the left chest band
    co[1] = (-0.1, -0.2, 1.3)
    smoothed = co.copy()
    smoothed[:, 1] += 0.01
    d = sculpt.mannequin_chest(co, smoothed)
    assert np.allclose(d[0], (0, 0.01, 0)) and np.allclose(d[1], (0, 0.01, 0))
    far = np.linalg.norm(co - co[0], axis=1) > 0.03
    far &= np.linalg.norm(co - co[1], axis=1) > 0.03
    assert np.abs(d[far]).max() == 0.0
