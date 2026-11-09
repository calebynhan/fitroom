"""body.glb -> web/public/garments/{shoes,tee,sweater,pants}.glb on the same skeleton and body morphs.

Recipe per garment (CLAUDE.md): cut the region from an evenly remeshed body, ease it off the body, pose it
(Relaxed stance, arms half lowered) and let it settle under gravity with Blender's cloth solver (shoulders or
waistband pinned, extra fabric where it should fold, rib bands drawn in), map it back to the rest pose,
clean up poke-through in every pose clip, finish the edges with turned hems/bands, then add UVs, skin
weights, body_0..5 and fit morphs. Shoes are built first: the pants hems drape onto them.

Usage:
    .venv/bin/python pipeline/garments.py --body web/public/models/body.glb --out web/public/garments
"""
from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

import bpy  # noqa: F401  (must load before bmesh)
import dataclasses

import numpy as np
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_scene as bs  # noqa: E402
import bake_ao  # noqa: E402
import cloth_sim  # noqa: E402
import garment_bands as gb  # noqa: E402
import garment_body as gbody  # noqa: E402
import garment_export as gx  # noqa: E402
import garment_fit as gf  # noqa: E402
import garment_geom as gg  # noqa: E402
import garment_pose as gp  # noqa: E402
import garment_render as gr  # noqa: E402
import garment_spec as gs  # noqa: E402
import glb_tools  # noqa: E402
import poses  # noqa: E402
import shoes as sh  # noqa: E402
from garment_body import BodyData, Surface  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOXEL = 0.011           # cloth edge length ~1 cm: enough for soft folds, small GLBs
SNAP_TOL = 0.03
EDGE_SMOOTH_ITERS = 10
HEM_SNAP_TOL = 0.05
SIZE_EASE_CM = 3.0      # fit_tight / fit_loose change garment circumference by about this much
LOOSE_FOLDS = 0.5       # fit_loose deepens the drape folds by this fraction
TIGHT_FLATTEN = 0.6     # fit_tight smooths this fraction of them away
DELTA_SMOOTH_ITERS = 6
EDGE_RELAX_ITERS = 6
SHOE_GAP = 0.003        # pants hems clear the shoes by this much
PANTS_GAP = 0.004       # an untucked top clears the pants (incl. waistband) by this much
UNDER_REACH = 0.03      # only verts within this of a lower garment are tested against it
FINAL_POSES = ("pocket",)   # the clip with hands under the fabric; corrected again after unfolding
LEDGE_BAND = 0.05       # fabric within this height of a lower garment's top edge gets relaxed over it
LEDGE_ROUNDS = 3
AO_POSE = "relaxed"     # baked AO is computed in the viewer's Relaxed clip
HEM_DROP = 0.012        # pant hems drop this far after the drape: ~8 mm over the shoe collar line
HEM_DROP_REACH = 0.05   # ... fading out this far up the leg


@dataclass(frozen=True)
class Cut:
    """One garment's shared topology: every fit variant is a different position set on this mesh."""
    surf: Surface
    arm_w: np.ndarray
    normals: np.ndarray
    planes: list
    loops: dict
    fields: dict        # rib / shrink / pin / ridge maps from the bands
    dists: dict
    weights: np.ndarray


@dataclass(frozen=True)
class Under:
    """A garment already built that this one must stay outside of: shoes under pants, pants under tops."""
    obj: object             # skinned Blender object: a collider for the cloth sim
    v: np.ndarray           # rest positions in its roomiest fit (fit_loose), so every size combination clears
    f: np.ndarray
    weights: np.ndarray
    z_max: float            # only garment verts below this rest height have to clear it
    gap: float


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--body", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--shapes", default="tee,sweater,pants")
    p.add_argument("--renders", default=os.path.join(ROOT, "pipeline/renders"))
    p.add_argument("--render-prefix", default="", help="filename prefix for check renders, e.g. female_")
    return p.parse_args()


def cut_garment(bd: BodyData, uni: Surface, spec: gs.GarmentSpec) -> Cut:
    arm_w_all = gbody.interp(bd.arm_w, bd, uni.tri, uni.bary)
    mask, planes = gs.region(uni.v, arm_w_all, bd.landmarks, spec)
    surf = uni.subset(mask[uni.f].all(axis=1)).largest_component()
    surf = surf.with_v(gg.taubin_smooth(surf.v, surf.f, iters=EDGE_SMOOTH_ITERS))   # melt the voxel staircase
    surf = surf.with_v(gg.snap_boundary_to_planes(surf.v, surf.f, planes, SNAP_TOL))   # straight hems/cuffs
    if spec.slot == "bottom":
        surf = surf.with_v(_snap_hems(surf.v, surf.f, bd.landmarks, spec))
    normals = gbody.interp(bd.normals, bd, surf.tri, surf.bary)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    loops = gb.classify_loops(surf.v, surf.f, spec.slot)
    dists = gb.edge_distance(surf.v, surf.f, loops)
    return Cut(surf, gbody.interp(bd.arm_w, bd, surf.tri, surf.bary), normals, planes, loops,
               gb.band_fields(dists, spec), dists, gbody.skin_weights(bd, surf.tri, surf.bary))


def _snap_hems(v: np.ndarray, f: np.ndarray, L, spec: gs.GarmentSpec) -> np.ndarray:
    """Pants hem verts sit exactly on the hem surface (it follows the shoe collar, so it isn't a plane)."""
    out = v.copy()
    bidx = np.unique(gg.boundary_edges(f))
    low = bidx[v[bidx, 2] < L.crotch_z]
    out[low, 2] = gs.pants_hem_surface(v[low], L, spec)
    return out


def clear_under(v: np.ndarray, bd: BodyData, under: list, mask_z: np.ndarray, scale: float = 1.0) -> np.ndarray:
    """Push verts (selected by their rest height mask_z) out of each garment underneath."""
    for u in under:
        sel = mask_z < u.z_max
        if sel.any():
            tree = BVHTree.FromPolygons(u.v.tolist(), u.f.tolist())
            moved, _ = gbody.anti_clip(v[sel], bd, u.gap * scale, bvh=tree, max_dist=UNDER_REACH)
            v = v.copy()
            v[sel] = moved
    return v


def pattern(cut: Cut, bd: BodyData, spec: gs.GarmentSpec, fit: gf.Fit, under: list) -> np.ndarray:
    """The garment's eased shape before gravity: standoff along normals plus the fit's silhouette."""
    L, f = bd.landmarks, cut.surf.f
    v = cut.surf.v + cut.normals * gs.ease_offset(cut.surf.v, cut.arm_w, L, spec)[:, None]
    v = gg.taubin_smooth(v, f, iters=spec.smooth_iters)
    if spec.slot == "top":
        v = gf.ease_torso(v, cut.arm_w, L, fit, spec.ease)
        if fit.hem_flare > 0:
            v = gf.flare_hem(v, cut.arm_w, L, gs.top_hem_z(L, spec), fit.hem_flare)
        if fit.sleeve_flare_r > 0:
            v = gf.flare_sleeves(v, cut.arm_w, L, fit)
        if fit.forearm_ease > 0:
            v = gf.roomy_forearms(v, cut.arm_w, L, fit)
    else:
        v = gf.drape_legs(v, L, fit, gs.pants_hem_z(L, spec))
        v = gf.close_crotch(v, L)
    gap = gs.clearance(v, L, spec)
    v, _ = gbody.anti_clip(v, bd, gap)
    v = gg.taubin_smooth(v, f, iters=4)
    v = gg.snap_boundary_to_planes(v, f, cut.planes, HEM_SNAP_TOL)
    if spec.slot == "bottom":
        v = _snap_hems(v, f, L, spec)
    v, _ = gbody.anti_clip(v, bd, gap * 1.2)   # start the sim clear of the colliders
    return clear_under(v, bd, under, cut.surf.v[:, 2], scale=1.2)


def sim_fields(cut: Cut, bd: BodyData, spec: gs.GarmentSpec) -> tuple[np.ndarray, np.ndarray]:
    """Pin weights (hold the garment up) and rest-length shrink (slack folds, rib bands) per vertex."""
    L, v = bd.landmarks, cut.surf.v
    anchor = cut.dists["collar"] if spec.slot == "top" else cut.dists["waist"]
    pin = np.maximum(1.0 - gg.smoothstep(0.03, spec.pin_reach, anchor), cut.fields["pin"])
    if spec.slot == "top":
        torso = 1.0 - gg.smoothstep(0.3, 0.6, cut.arm_w)
        pin = np.maximum(pin, spec.sleeve_pin * (1.0 - torso))   # sleeves follow the arm loosely
        hang = gg.smoothstep(0.0, 0.15, L.chest_z + 0.02 - v[:, 2])
        sleeve = gg.smoothstep(0.03, 0.10, anchor - 0.12) * (1.0 - torso)
        slack = spec.slack * hang * torso + spec.sleeve_slack * sleeve
    else:
        slack = spec.slack * gg.smoothstep(0.0, 0.25, L.crotch_z - v[:, 2])
    band = np.clip(sum(gb.band_weight(d, spec.bands[gb.band_of(n)].height) for n, d in cut.dists.items()), 0, 1)
    shrink = (1.0 - band) * slack + cut.fields["shrink"]
    return pin, shrink


def drape(cut: Cut, start: np.ndarray, arm, body, bd: BodyData, spec: gs.GarmentSpec,
          colliders: list) -> np.ndarray:
    """Skin the eased garment, animate the skeleton from rest into the drape pose while the cloth settles
    under gravity against the body (and shoes), then map the result back to the rest pose."""
    sim = gx.skinned_object(f"{spec.shape}_sim", start, cut.surf.f, cut.weights, arm, bd)
    pin, shrink = sim_fields(cut, bd, spec)
    to_pose = lambda: poses.apply_spec(arm, body, poses.DRAPE, bd.proxy)  # noqa: E731
    try:
        settled = cloth_sim.drape(sim, arm, [body, *colliders], to_pose, pin, shrink, spec.cloth)
    finally:
        bs.delete_objects([sim])
    to_pose()
    m = gp.blend(cut.weights, gp.skin_matrices(arm, bd.names))
    rest = gp.unlbs(settled, m)
    poses.reset(arm)
    strain = gg.edge_lengths(rest, cut.surf.f) / np.maximum(gg.edge_lengths(start, cut.surf.f), 1e-9)
    print(f"    drape: rest-space edge strain p5/p50/p95 {np.percentile(strain, [5, 50, 95]).round(3)}")
    return rest


def lower_hems(v: np.ndarray, cut: Cut) -> np.ndarray:
    """Drop the pant hems over the shoe collars after the drape (no ankle gap). Draped already overlapping, the
    hem catches on the moving shoes in the sim and the legs bunch up; clean() then lays it over the shoe."""
    w = np.zeros(len(v))
    for name, d in cut.dists.items():
        if gb.band_of(name) == "leg":
            w = np.maximum(w, 1.0 - gg.smoothstep(0.0, HEM_DROP_REACH, d))
    out = v.copy()
    out[:, 2] -= HEM_DROP * w
    return out


def smooth_edges(v: np.ndarray, cut: Cut, spec: gs.GarmentSpec, iters: int = EDGE_RELAX_ITERS) -> np.ndarray:
    """Relax crumples along hems, cuffs and collars (where the sim and pose clean-up bunch fabric)."""
    w = np.zeros(len(v))
    for name, d in cut.dists.items():
        h = spec.bands[gb.band_of(name)].height
        w = np.maximum(w, 1.0 - gg.smoothstep(h, 1.8 * h, d))
    smooth = gg.taubin_smooth(v, cut.surf.f, iters=iters)
    return v + w[:, None] * (smooth - v)


def clean(v: np.ndarray, cut: Cut, arm, body, bd: BodyData, spec: gs.GarmentSpec, under: list,
          passes: tuple = gp.POSE_PASSES) -> np.ndarray:
    """No poke-through at rest or in any pose clip: outer fabric clears the body by >= gap and every garment
    underneath by its layer gap; hands and fingers tent the fabric instead of poking through."""
    L, z = bd.landmarks, cut.surf.v[:, 2]
    extras = tuple((u.v, u.f, u.weights, z < u.z_max, u.gap) for u in under)
    v, _ = gbody.anti_clip(v, bd, gs.clearance(v, L, spec))
    v = clear_under(v, bd, under, z)
    top = spec.slot == "top"
    v, report = gp.pose_correct(v, cut.weights, arm, body, bd, passes=passes, f=cut.surf.f, extras=extras, inward=top)
    v = smooth_edges(v, cut, spec, iters=2)      # pose clean-up can re-crumple hems and cuffs a little
    v, _ = gbody.anti_clip(v, bd, gs.clearance(v, L, spec))
    v = clear_under(v, bd, under, z)
    v = relax_over_edges(v, cut, bd, spec, under)
    v, folded, left = gg.unfold(v, cut.surf.f)
    v, _ = gbody.anti_clip(v, bd, gs.clearance(v, L, spec))
    # Unfolding relaxes the soft bulges pushed out over hands in pockets; re-tent them last.
    v, _ = gp.pose_correct(v, cut.weights, arm, body, bd, passes=FINAL_POSES, f=cut.surf.f, extras=extras,
                           inward=top)
    print(f"    posed anti-clip moved {report}; unfolded {folded - left}/{folded} flipped faces")
    return v


def relax_over_edges(v: np.ndarray, cut: Cut, bd: BodyData, spec: gs.GarmentSpec, under: list) -> np.ndarray:
    """A waistband rim under a top leaves a bumpy ledge once each vert is pushed out on its own: smooth the
    band of fabric over the rim and re-clear, a few rounds, so it reads as one soft line."""
    z = cut.surf.v[:, 2]
    for u in under:
        if not np.isfinite(u.z_max):
            continue
        w = (1.0 - gg.smoothstep(0.0, LEDGE_BAND, np.abs(z - (u.z_max - 0.01))))[:, None]
        for _ in range(LEDGE_ROUNDS):
            v = v + w * (gg.taubin_smooth(v, cut.surf.f, iters=2) - v)
            v, _ = gbody.anti_clip(v, bd, gs.clearance(v, bd.landmarks, spec))
            v = clear_under(v, bd, [u], z)
    return v


def size_variants(v: np.ndarray, cut: Cut, bd: BodyData, spec: gs.GarmentSpec) -> dict:
    """fit_tight / fit_loose: about -/+3 cm of circumference ease. Loose also deepens the folds, tight
    smooths them out (a snug garment can't fold). The pinned yoke/waistband moves less."""
    f = cut.surf.f
    n = gg.vertex_normals(v, f)
    detail = v - gg.taubin_smooth(v, f, iters=12)
    mask = (1.0 - 0.6 * cut.fields["pin"])[:, None]
    dr = SIZE_EASE_CM / 100.0 / (2 * np.pi)
    loose = v + mask * (n * dr + LOOSE_FOLDS * detail)
    tight = v + mask * (-n * dr - TIGHT_FLATTEN * detail)
    return {"fit_tight": tight, "fit_loose": loose}


def finish_edges(v: np.ndarray, cut: Cut, spec: gs.GarmentSpec):
    """Doubled-fabric ridge over turned hems, then the turned-back strips inside every edge."""
    n = gg.vertex_normals(v, cut.surf.f)
    v = v + n * cut.fields["ridge"][:, None]
    return gb.add_turnbacks(v, cut.surf.f, cut.loops, spec, spec.thickness)


def smooth_deltas(deltas: np.ndarray, f: np.ndarray) -> np.ndarray:
    """Body morph deltas are interpolated per vertex; smooth them over the garment so folds keep their shape."""
    return np.stack([gg.taubin_smooth(d, f, iters=DELTA_SMOOTH_ITERS) for d in deltas])


def make_garment(arm, body, bd: BodyData, uni: Surface, spec: gs.GarmentSpec, under: list):
    """Build one garment over the body and the garments `under` it. Returns (Blender object, GarmentMesh)."""
    cut = cut_garment(bd, uni, spec)
    print(f"  {spec.shape}: {len(cut.surf.v)} verts, {len(cut.surf.f)} tris, edges {sorted(cut.loops)}")
    fits = {}
    for fit in gf.FITS[spec.shape]:
        start = pattern(cut, bd, spec, fit, under)
        # Only shoes join the cloth sim (pants hems settle on them). A top starts inside the pants' collision
        # margin and the waistband rim pushes it up over the pants; tops clear the pants after the drape.
        colliders = [u.obj for u in under if spec.slot == "bottom"]
        draped = drape(cut, start, arm, body, bd, spec, colliders)
        if spec.slot == "bottom":
            draped = lower_hems(draped, cut)
        draped = smooth_edges(draped, cut, spec)
        fits[fit.name] = clean(draped, cut, arm, body, bd, spec, under)
        print(f"    {spec.shape}/{fit.name} draped")
    for name, pos in size_variants(fits["base"], cut, bd, spec).items():
        fits[name] = clean(pos, cut, arm, body, bd, spec, under, passes=gp.POSE_PASSES[:3])
    finished = {name: finish_edges(pos, cut, spec) for name, pos in fits.items()}
    v, f, parent = finished["base"]
    deltas = smooth_deltas(gbody.morph_deltas(bd, cut.surf.tri, cut.surf.bary), cut.surf.f)[:, parent]
    built = gx.GarmentMesh(
        name=spec.shape, v=v, f=f, weights=cut.weights[parent], arm_w=cut.arm_w[parent],
        band=cut.fields["rib"][parent], body_deltas=deltas,
        fit_deltas={k: fv - v for k, (fv, _, _) in finished.items() if k != "base"},
        material="fabric", outer=np.arange(len(f)) < len(cut.surf.f),   # strips come after the shell
        ao=garment_ao(v, f, cut.weights[parent], arm, body, bd))
    print(f"    {spec.shape}: girth change at weight 1 (cm) {size_report(built, spec, bd.landmarks)}")
    return gx.build_object(built, arm, bd), built


def garment_ao(v: np.ndarray, f: np.ndarray, w: np.ndarray, arm, body, bd: BodyData) -> np.ndarray:
    """Baked AO in the Relaxed pose: the garment occluded by the body and by itself (folds, armpits, collars)."""
    poses.apply(arm, body, AO_POSE, bd.proxy)
    posed = gp.lbs(v, gp.blend(w, gp.skin_matrices(arm, bd.names)))
    body_posed = bs.evaluated_coords(body)
    poses.reset(arm)
    good = f[gx.drop_degenerate(v, f)]
    return bake_ao.vertex_ao(posed, gg.vertex_normals(posed, good), [(body_posed, bd.faces), (posed, good)], good)


def size_report(built: gx.GarmentMesh, spec: gs.GarmentSpec, L) -> dict:
    """Garment girth change (cm, tape-slice of the torso/legs) for each fit morph at weight 1."""
    import body_measure as bm
    torso = built.arm_w < 0.3
    e, _ = gg.edges_with_counts(built.f)
    edges = e[torso[e[:, 0]] & torso[e[:, 1]]]
    z = L.chest_z if spec.slot == "top" else L.hips_z - 0.02
    base = bm.slice_perimeter(built.v, edges, z)
    if spec.slot == "bottom":   # one leg's slice would be a second loop: measure the hip girth above the crotch
        z = max(z, L.crotch_z + 0.05)
        base = bm.slice_perimeter(built.v, edges, z)
    return {name: round((bm.slice_perimeter(built.v + d, edges, z) - base) * 100, 2)
            for name, d in sorted(built.fit_deltas.items())}


def layers_under(spec: gs.GarmentSpec, objs: dict, meshes: dict, L) -> list:
    """Shoes sit under pants hems; pants (in their roomiest fit) sit under the lower part of tops."""
    def under(shape: str, z_max: float, gap: float) -> Under:
        m = meshes[shape]
        return Under(objs[shape], m.v + m.fit_deltas.get("fit_loose", 0.0), m.outer_faces(), m.weights, z_max, gap)
    if spec.slot == "bottom":
        return [under("shoes", np.inf, SHOE_GAP)]
    if spec.slot == "top" and "pants" in meshes:
        return [under("pants", L.hips_z + gs.SPECS["pants"].waist_above_hips + 0.01, PANTS_GAP)]
    return []


def main() -> None:
    args = parse_args()
    arm, body = gbody.load_body(args.body)
    bd = gbody.body_data(arm, body)
    L = bd.landmarks
    print(f"landmarks: height {L.height:.3f} hips_z {L.hips_z:.3f} crotch_z {L.crotch_z:.3f} chest_z {L.chest_z:.3f}")
    uni = gbody.uniform_surface(bd, VOXEL)
    print(f"uniform body surface: {len(uni.v)} verts")
    os.makedirs(args.out, exist_ok=True)
    shoes = sh.build_shoes(bd, uni)
    meshes = {"shoes": dataclasses.replace(shoes, ao=garment_ao(shoes.v, shoes.f, shoes.weights, arm, body, bd))}
    objs = {"shoes": gx.build_object(meshes["shoes"], arm, bd)}
    shapes = [s.strip() for s in args.shapes.split(",") if s.strip()]
    for shape in sorted(shapes, key=lambda s: gs.SPECS[s].slot != "bottom"):   # bottoms first: tops go over
        spec = gs.SPECS[shape]
        objs[shape], meshes[shape] = make_garment(arm, body, bd, uni, spec, layers_under(spec, objs, meshes, L))
    for shape, obj in objs.items():
        path = os.path.join(args.out, f"{shape}.glb")
        for o in objs.values():
            o.hide_set(o is not obj)
        bs.export_glb(path, [arm, obj], colors=True)
        diff = glb_tools.assert_same_bind(path, args.body)
        print(f"  wrote {path} {os.path.getsize(path) // 1024} KB, bind diff {diff:.1e}, {glb_tools.summary(path)}")
        print(f"    mesh check: {glb_tools.mesh_report(path)}")
    for o in objs.values():
        o.hide_set(False)
    gx.write_fits_json(args.out)
    if args.renders:
        for p in gr.render_checks(arm, body, bd, objs, os.path.abspath(args.renders), args.render_prefix):
            print("  rendered", p)


if __name__ == "__main__":
    main()
