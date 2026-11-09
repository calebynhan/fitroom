"""Simple mannequin shoes: a plain low-top grown from the feet (no laces, no logos), on the body's bones.

Upper: the foot surface below a collar line (dips under the ankle bones, rises over the instep and a little
at the heel) is eased off the foot, smoothed until the toes melt into one toe box, lengthened at the toe and
subdivided for a smooth silhouette; its collar gets a thick rolled edge.
Sole: a flat slab SOLE thick under each foot, following the footprint outline and sticking out a few mm past
the upper, with a rounded bottom edge. Pose clips lift the body by SOLE (poses.SOLE_LIFT) so the soles stand
on the floor.
"""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

import garment_bands as gb
import garment_body as gbody
import garment_geom as gg
import poses
from garment_body import BodyData, Surface
from garment_export import GarmentMesh
import garment_spec as gs
from garment_spec import Band, GarmentSpec

SOLE = poses.SOLE_LIFT
EASE = 0.006            # upper stands this far off the foot
SMOOTH_ITERS = 30       # enough to melt the toes into one toe box
TOE_EXTRA = 0.012       # shoe is longer than the foot
TOE_FLATTEN = 0.25      # toe box is lower than the toes' bumpy top
SOLE_TOP = 0.006        # sole wall rises this far above the foot's underside (hides the upper's lower edge)
SOLE_FLARE = 0.004      # sole sticks out past the upper by this much
SOLE_ROUND = 0.003      # inset of the rounded bottom edge
SOLE_SAMPLES = 96       # points around each sole outline
COLLAR = Band(0.02, turn=0.018)
SPEC = GarmentSpec("shoes", "shoes", ease=EASE, yoke_ease=EASE, sleeve_ease=0.0, thickness=0.004,
                   bands={"collar": COLLAR})


def _components(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    e, _ = gg.edges_with_counts(f)
    adj = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(v), len(v)))
    return connected_components(adj, directed=False)[1]


def _feet(bd: BodyData, uni: Surface) -> Surface:
    keep = uni.v[:, 2] < gs.shoe_collar_z(uni.v, bd.landmarks)
    surf = uni.subset(keep[uni.f].all(axis=1))
    labels = _components(surf.v, surf.f)
    feet = np.argsort(-np.bincount(labels))[:2]
    return surf.subset(np.isin(labels[surf.f[:, 0]], feet))


def _upper(surf: Surface, bd: BodyData) -> np.ndarray:
    floor = bd.landmarks.floor_z
    n = gbody.interp(bd.normals, bd, surf.tri, surf.bary)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    v = gg.taubin_smooth(surf.v + n * EASE, surf.f, iters=SMOOTH_ITERS)
    v, _ = gbody.anti_clip(v, bd, EASE * 0.6)
    out = v.copy()
    for sign in (1.0, -1.0):
        side = sign * v[:, 0] > 0
        y_toe, y_heel = v[side, 1].min(), v[side, 1].max()
        toe = gg.smoothstep(0.55, 1.0, (y_heel - v[:, 1]) / (y_heel - y_toe)) * side
        out[:, 1] -= TOE_EXTRA * toe
        out[:, 2] = np.where(side, floor + (out[:, 2] - floor) * (1.0 - TOE_FLATTEN * toe), out[:, 2])
    out, _ = gbody.anti_clip(out, bd, EASE * 0.5)                  # the flattened toe box clears the toes
    out[:, 2] = np.maximum(out[:, 2], floor + 0.5 * SOLE_TOP)     # underside flat, tucked inside the sole
    return out


def _sole(upper: np.ndarray, floor: float) -> tuple[np.ndarray, np.ndarray]:
    """Two sole slabs: outline = footprint hull + flare; rings top -> wall -> rounded edge, plus a flat tread."""
    verts, faces, count = [], [], 0
    for sign in (1.0, -1.0):
        foot = upper[(sign * upper[:, 0] > 0) & (upper[:, 2] < floor + 0.03)]
        outline = gg.convex_outline(foot[:, :2], SOLE_SAMPLES)
        centre = outline.mean(axis=0)
        radial = outline - centre
        unit = radial / np.linalg.norm(radial, axis=1, keepdims=True)
        rim = outline + unit * SOLE_FLARE
        rings = [(rim, floor + SOLE_TOP), (rim, floor - SOLE + SOLE_ROUND),
                 (rim - unit * SOLE_ROUND, floor - SOLE)]
        ring_v = [np.column_stack([xy, np.full(len(xy), z)]) for xy, z in rings]
        m = len(outline)
        ids = [count + k * m + np.arange(m) for k in range(len(rings))]
        for a, b in zip(ids[:-1], ids[1:]):           # CCW outline seen from above: wall faces outward
            a1, b1 = np.roll(a, -1), np.roll(b, -1)
            faces += [np.column_stack([a, b, a1]), np.column_stack([a1, b, b1])]
        centre_id = count + len(rings) * m
        bottom = ids[-1]
        faces.append(np.column_stack([bottom, np.full(m, centre_id), np.roll(bottom, -1)]))   # tread faces down
        verts += ring_v + [np.array([[centre[0], centre[1], floor - SOLE]])]
        count = centre_id + 1
    return np.concatenate(verts), np.concatenate(faces)


def build_shoes(bd: BodyData, uni: Surface) -> GarmentMesh:
    surf = _feet(bd, uni)
    v, f, par = gg.subdivide(_upper(surf, bd), surf.f)
    v = gg.taubin_smooth(v, f, iters=3)
    tri, bary = surf.tri[par[:, 0]], surf.bary[par[:, 0]]   # each subdivided vert takes one parent's origin
    loops = {f"collar_{i}": lp for i, lp in enumerate(gg.boundary_loops(f))}
    if len(loops) != 2:
        raise RuntimeError(f"shoes: expected 2 collar openings, found {len(loops)}")
    n_shell = len(f)
    v, f, parent = gb.add_turnbacks(v, f, loops, SPEC, SPEC.thickness)
    tri, bary = tri[parent], bary[parent]
    weights = gbody.limit_influences(0.5 * (gbody.skin_weights(bd, surf.tri[par[:, 0]], surf.bary[par[:, 0]])
                                            + gbody.skin_weights(bd, surf.tri[par[:, 1]], surf.bary[par[:, 1]])))[parent]
    deltas = gbody.morph_deltas(bd, tri, bary)
    sole_v, sole_f = _sole(v, bd.landmarks.floor_z)
    src = np.empty(len(sole_v), dtype=np.int64)
    for sign in (1.0, -1.0):                                  # sole verts move with the foot above them
        low = np.nonzero((v[:, 2] < bd.landmarks.floor_z + 0.02) & (sign * v[:, 0] > 0))[0]
        mine = sign * sole_v[:, 0] > 0
        src[mine] = low[cKDTree(v[low, :2]).query(sole_v[mine, :2])[1]]
    v_all = np.concatenate([v, sole_v])
    f_all = np.concatenate([f, sole_f + len(v)])
    print(f"  shoes: {len(v_all)} verts, {len(f_all)} tris, sole {SOLE * 100:.1f} cm")
    outer = np.concatenate([np.arange(len(f)) < n_shell, np.ones(len(sole_f), dtype=bool)])   # upper + sole
    return GarmentMesh(name="shoes", v=v_all, f=f_all, weights=np.concatenate([weights, weights[src]]),
                       arm_w=np.zeros(len(v_all)), band=np.zeros(len(v_all)),
                       body_deltas=np.concatenate([deltas, deltas[:, src]], axis=1), material="shoe", outer=outer)
