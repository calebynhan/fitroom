"""body.glb -> web/public/garments/{tee,sweater,pants}.glb (same skeleton, body_0..5 + fit_tight/fit_loose).

Usage:
    .venv/bin/python pipeline/garments.py --body web/public/models/body.glb --out web/public/garments
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass

import bpy  # noqa: F401  (must load before bmesh)
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_scene as bs  # noqa: E402
import garment_fit as gf  # noqa: E402
import garment_geom as gg  # noqa: E402
import garment_spec as gs  # noqa: E402
import glb_tools  # noqa: E402
import poses  # noqa: E402
import render  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FABRIC_RGB = (1.0, 1.0, 1.0)
RENDER_RGB = {"tee": (0.80, 0.80, 0.78), "sweater": (0.05, 0.08, 0.20), "pants": (0.45, 0.36, 0.25)}
MAX_INFLUENCES = 4
MIN_INFLUENCE = 0.01
TIGHT_GAP = 0.003
LOOSE_EXTRA = 0.018
SNAP_TOL = 0.03
POSE_PASSES = ("relaxed", "walk", "pocket", "relaxed")   # default pose last so it ends cleanest
POSE_GAP = 0.003
HAND_TOKENS = ("lowarm", "wrist", "pinky", "ring", "middle", "index", "thumb")
HEM_SNAP_TOL = 0.05


@dataclass(frozen=True)
class BodyData:
    proxy: np.ndarray
    faces: np.ndarray
    normals: np.ndarray
    deltas: np.ndarray
    default_w: np.ndarray
    weights: np.ndarray
    names: list
    arm_w: np.ndarray
    bvh: BVHTree
    landmarks: gs.Landmarks


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--body", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--shapes", default="tee,sweater,pants")
    p.add_argument("--renders", default=os.path.join(ROOT, "pipeline/renders"))
    p.add_argument("--render-prefix", default="", help="filename prefix for check renders, e.g. female_")
    return p.parse_args()


def load_body(path: str):
    bs.reset_scene()
    bpy.ops.import_scene.gltf(filepath=path, merge_vertices=True, disable_bone_shape=True)
    arm, body = bs.find_one("ARMATURE"), bs.find_one("MESH")
    if arm.animation_data:   # pose clips from body.glb must not drive the armature here
        arm.animation_data.action = None
        for track in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(track)
    poses.reset(arm)
    bs.bake_transforms(arm, body)
    return arm, body


def triangles(mesh) -> np.ndarray:
    polys = [tuple(p.vertices) for p in mesh.data.polygons]
    if any(len(p) != 3 for p in polys):
        raise RuntimeError("body mesh is expected to be triangulated (glTF import)")
    return np.array(polys, dtype=np.int64)


def bone_head(arm, name: str) -> np.ndarray:
    return np.array(arm.matrix_world @ arm.data.bones[name].head_local)


def find_landmarks(arm, co: np.ndarray) -> gs.Landmarks:
    z0, height = co[:, 2].min(), co[:, 2].max() - co[:, 2].min()
    centre = np.abs(co[:, 0]) < 0.004
    crotch = co[centre & (co[:, 2] > z0 + 0.35 * height) & (co[:, 2] < z0 + 0.6 * height), 2].min()
    neck = bone_head(arm, "c_neck")
    ring = (np.abs(co[:, 2] - (neck[2] + 0.03)) < 0.012) & (np.abs(co[:, 0]) < 0.1)
    neck_half_width = float(np.abs(co[ring, 0]).max())
    both = lambda bone: {s: bone_head(arm, f"{s}_{bone}") for s in ("l", "r")}  # noqa: E731
    return gs.Landmarks(
        height=height, hips_z=bone_head(arm, "root")[2], crotch_z=crotch, chest_z=z0 + 0.725 * height,
        neck=neck, neck_xy=co[ring, :2].mean(axis=0), neck_scale=neck_half_width / gs.REF_NECK_HALF_WIDTH,
        shoulder=both("uparm"), elbow=both("lowarm"), wrist=both("wrist"),
        hip_joint=both("upleg"), knee=both("lowleg"), ankle=both("talocrural"),
    )


def body_data(arm, body) -> BodyData:
    keys = body.data.shape_keys.key_blocks
    names = [f"body_{i}" for i in range(bs.MORPH_COUNT)]
    base = bs.vertex_coords(body, keys[0])
    deltas = np.stack([bs.vertex_coords(body, keys[n]) - base for n in names])
    w0 = np.array([keys[n].value for n in names])
    proxy = base + np.tensordot(w0, deltas, axes=1)
    faces = triangles(body)
    weights, gnames = bs.weight_matrix(body)
    bvh = BVHTree.FromPolygons(proxy.tolist(), faces.tolist())
    return BodyData(proxy, faces, gg.vertex_normals(proxy, faces), deltas, w0, weights, gnames,
                    bs.arm_weight(weights, gnames), bvh, find_landmarks(arm, proxy))


def nearest_on_body(v: np.ndarray, bd: BodyData):
    loc = np.empty_like(v)
    nrm = np.empty_like(v)
    tri = np.empty(len(v), dtype=np.int64)
    for i, p in enumerate(v):
        l, n, fi, _ = bd.bvh.find_nearest(Vector(p))
        loc[i], nrm[i], tri[i] = l, n, fi
    return loc, nrm, tri


def anti_clip(v: np.ndarray, bd: BodyData, gap, iters: int = 2) -> tuple[np.ndarray, int]:
    """Push any vert closer than `gap` (scalar or per-vert) to, or inside, the body back out along the normal."""
    gap = np.broadcast_to(np.asarray(gap, dtype=np.float64), (len(v),))
    out, total = v.copy(), 0
    for _ in range(iters):
        loc, nrm, _ = nearest_on_body(out, bd)
        signed = ((out - loc) * nrm).sum(1)
        bad = signed < gap
        out[bad] = loc[bad] + nrm[bad] * gap[bad, None]
        total += int(bad.sum())
        if not bad.any():
            break
    return out, total


def build_surface(bd: BodyData, spec: gs.GarmentSpec):
    L = bd.landmarks
    mask, planes = gs.region(bd.proxy, bd.arm_w, L, spec)
    v, f, idx = gg.submesh(bd.proxy, bd.faces, mask[bd.faces].all(axis=1))
    v, f, idx2 = gg.largest_component(v, f)
    idx = idx[idx2]
    v = gg.snap_boundary_to_planes(v, f, planes, SNAP_TOL)
    v = v + bd.normals[idx] * spec.inflate
    v = gg.taubin_smooth(v, f, iters=spec.smooth_iters)
    arm_w = bd.arm_w[idx]
    variants = {fit.name: shape_fit(v, f, arm_w, bd, spec, fit, planes) for fit in gf.FITS[spec.shape]}
    (_, f2, kept), dropped = gg.drop_long_edge_faces(variants["base"], f)   # spike cleanup on base fit
    _, f3, kept2 = gg.largest_component(variants["base"][kept], f2)
    sel = kept[kept2]
    print(f"  {spec.shape}: {len(sel)} verts, {len(f3)} tris, fits {list(variants)}, spikes dropped {dropped}")
    return f3, idx[sel], {name: pos[sel] for name, pos in variants.items()}


def shape_fit(v, f, arm_w, bd: BodyData, spec: gs.GarmentSpec, fit: gf.Fit, planes) -> np.ndarray:
    """Apply one UNIQLO fit to the shared inflated surface; every fit keeps the same topology."""
    L = bd.landmarks
    if spec.slot == "top":
        v = gf.ease_torso(v, arm_w, L, fit, spec.inflate)
        if fit.hem_band:
            v = gf.hem_band(v, arm_w, gs.top_hem_z(L, spec), spec.inflate)
        if fit.folds > 0:
            v = gf.hem_folds(v, arm_w, L, gs.top_hem_z(L, spec), fit.folds)
        if fit.sleeve_flare_r > 0:
            v = gf.flare_sleeves(v, arm_w, L, fit)
        if fit.forearm_ease > 0:
            v = gf.roomy_forearms(v, arm_w, L, fit)
    else:
        v = gf.drape_legs(v, L, fit, gs.pants_hem_z(L, spec))
        v = gf.close_crotch(v, L)
    v, _ = anti_clip(v, bd, gs.clearance(v, L, spec))
    v = gg.taubin_smooth(v, f, iters=4)
    v, _ = anti_clip(v, bd, gs.clearance(v, L, spec))
    v = gg.snap_boundary_to_planes(v, f, planes, HEM_SNAP_TOL)   # clean straight hems and cuffs
    v, _ = anti_clip(v, bd, gs.clearance(v, L, spec) * 0.8)
    return v


def solidify(name: str, v: np.ndarray, f: np.ndarray, thickness: float):
    me = bpy.data.meshes.new(name)
    me.from_pydata(v.tolist(), [], f.tolist())
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new("solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0              # grow outward: inner surface stays at the anti-clipped position
    mod.use_even_offset = False   # pitfall: even offset divides by fold angle -> spikes
    mod.thickness_clamp = 1.0
    mod.use_rim = True
    bs.select_only([obj])
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def solid_variant(spec: gs.GarmentSpec, f: np.ndarray, pos: np.ndarray, n_expected: int, bd: BodyData):
    """Solidify a fit variant on the shared topology and return its anti-clipped vertex positions."""
    obj = solidify(f"{spec.shape}_variant", pos, f, spec.thickness)
    solid = bs.vertex_coords(obj)
    bpy.data.objects.remove(obj, do_unlink=True)
    if len(solid) != n_expected:
        raise RuntimeError("fit variant topology differs from base; cannot store it as a morph target")
    built, _ = anti_clip(solid, bd, gs.clearance(solid, bd.landmarks, spec) * 0.9)
    return built


def skin_and_morphs(v: np.ndarray, src: np.ndarray, bd: BodyData, spec: gs.GarmentSpec):
    """One transfer from a single source (the body). Each garment vert copies skin weights and body_i deltas
    from the body vert it was grown from (its nearest point before inflate/drape). Using the post-drape
    nearest point instead hands flared sleeve verts torso weights, and then sleeves don't follow the arms.
    """
    loc, nrm, _ = nearest_on_body(v, bd)
    w = bd.weights[src].astype(np.float64)
    order = np.argsort(-w, axis=1)
    w[np.arange(len(w))[:, None], order[:, MAX_INFLUENCES:]] = 0.0
    w[w < MIN_INFLUENCE] = 0.0
    w = w / np.maximum(w.sum(1, keepdims=True), 1e-12)
    deltas = bd.deltas[:, src]
    offset = v - loc
    gap = np.linalg.norm(offset, axis=1)
    out_dir = np.where(gap[:, None] > 1e-6, offset / np.maximum(gap, 1e-9)[:, None], nrm)
    tight = -np.maximum(gap - TIGHT_GAP, 0.0)[:, None] * out_dir
    L = bd.landmarks
    anchor_z = L.shoulder["l"][2] if spec.slot == "top" else L.hips_z + spec.waist_above_hips
    loose = LOOSE_EXTRA * gg.smoothstep(0.0, 0.12, anchor_z - v[:, 2])[:, None] * out_dir
    return w, deltas, tight, loose


def _bone_skin_matrices(arm, names: list) -> np.ndarray:
    """(groups, 4, 4) posed-from-rest matrix for each vertex-group bone (armature space == world)."""
    out = np.zeros((len(names), 4, 4))
    for g, name in enumerate(names):
        pb = arm.pose.bones.get(name)
        out[g] = np.array(pb.matrix @ pb.bone.matrix_local.inverted()) if pb else np.eye(4)
    return out


def pose_correct(built: np.ndarray, w: np.ndarray, arm, body, bd: BodyData) -> tuple[np.ndarray, dict]:
    """Posed anti-clip: in each pose, push garment verts that end up inside the posed body back out, and
    map the correction to rest space through the inverse of each vertex's skinning transform (LBS)."""
    hand_v = bd.weights[:, [i for i, n in enumerate(bd.names) if any(t in n for t in HAND_TOKENS)]].sum(1) > 0.3
    no_hand_faces = bd.faces[~hand_v[bd.faces].any(axis=1)]
    out, report = built.copy(), {}
    for pose in POSE_PASSES:
        poses.apply(arm, body, pose, bd.proxy)
        faces = no_hand_faces if pose == "pocket" else bd.faces   # hand-in-pocket is intended
        bvh = BVHTree.FromPolygons(bs.evaluated_coords(body).tolist(), faces.tolist())
        m = np.einsum("vg,gij->vij", w, _bone_skin_matrices(arm, bd.names))
        posed = np.einsum("vij,vj->vi", m[:, :3, :3], out) + m[:, :3, 3]
        hits = [bvh.find_nearest(Vector(p)) for p in posed]
        loc = np.array([h[0] for h in hits])
        nrm = np.array([h[1] for h in hits])
        bad = ((posed - loc) * nrm).sum(1) < POSE_GAP
        dp = loc[bad] + nrm[bad] * POSE_GAP - posed[bad]
        out[bad] += np.linalg.solve(m[bad, :3, :3], dp[:, :, None])[:, :, 0]
        report[pose] = int(bad.sum())
    poses.reset(arm)
    return out, report


def set_vertex_groups(obj, w: np.ndarray, names: list) -> None:
    used = [g for g in range(w.shape[1]) if w[:, g].max() > 0]   # collect used NAMES first
    groups = {g: obj.vertex_groups.new(name=names[g]) for g in used}
    for i, row in enumerate(w):
        for g in np.nonzero(row)[0]:
            groups[g].add([i], float(row[g]), "REPLACE")
    unused = [vg.name for vg in obj.vertex_groups if not np.any(w[:, names.index(vg.name)] > 0)]
    for name in unused:  # remove by name, never by index (indices renumber)
        obj.vertex_groups.remove(obj.vertex_groups[name])


def cylindrical_uvs(obj, bd: BodyData, src: np.ndarray) -> None:
    """UVs in metres (1 UV unit = 1 m), unrolled around the body, arm or leg axis, so a fabric texture
    tiles at the same physical scale everywhere: u = arc length around the axis, v = distance along it."""
    me, L = obj.data, bd.landmarks
    co = bs.vertex_coords(obj)
    n = len(co)
    base = np.tile([0.0, float(np.median(co[:, 1])), 0.0], (n, 1))
    axis = np.tile([0.0, 0.0, 1.0], (n, 1))
    side = np.where(co[:, 0] >= 0, "l", "r")
    arm = bd.arm_w[src] > 0.5
    leg = (co[:, 2] < L.crotch_z) & ~arm
    for s in ("l", "r"):
        a = (side == s) & arm
        base[a], axis[a] = L.shoulder[s], (L.wrist[s] - L.shoulder[s]) / np.linalg.norm(L.wrist[s] - L.shoulder[s])
        g = (side == s) & leg
        base[g], axis[g] = L.hip_joint[s], (L.ankle[s] - L.hip_joint[s]) / np.linalg.norm(L.ankle[s] - L.hip_joint[s])
    d = co - base
    along = (d * axis).sum(1)
    radial = d - along[:, None] * axis
    ref = np.array([0.0, -1.0, 0.0]) - axis * (-axis[:, 1:2])          # forward, projected off the axis
    ref /= np.maximum(np.linalg.norm(ref, axis=1, keepdims=True), 1e-9)
    ang = np.arctan2((np.cross(ref, radial) * axis).sum(1), (ref * radial).sum(1))
    u_v = np.column_stack([ang * np.linalg.norm(radial, axis=1), np.where(axis[:, 2] > 0.5, co[:, 2], -along)])
    loop_v = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loop_v)
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", u_v[loop_v].ravel())


def add_shape_keys(obj, basis: np.ndarray, keys: list) -> None:
    obj.shape_key_add(name="Basis", from_mix=False)
    for name, delta, value in keys:
        kb = obj.shape_key_add(name=name, from_mix=False)
        kb.data.foreach_set("co", (basis + delta).ravel())
        kb.slider_min, kb.slider_max = -3.0, 3.0
        kb.value = float(value)


def make_garment(arm, body, bd: BodyData, spec: gs.GarmentSpec):
    f, src, variants = build_surface(bd, spec)
    v = variants["base"]
    obj = solidify(spec.shape, v, f, spec.thickness)
    solid = bs.vertex_coords(obj)
    dist, nearest = cKDTree(v).query(solid)   # shell (mm) << edge length (cm): unambiguous
    if dist.max() > 2 * spec.thickness + 1e-4:
        raise RuntimeError(f"solidified vert {dist.max():.4f} m from any surface vert")
    built, _ = anti_clip(solid, bd, gs.clearance(solid, bd.landmarks, spec) * 0.9)
    fit_deltas = {name: solid_variant(spec, f, pos, len(solid), bd) - built
                  for name, pos in variants.items() if name != "base"}
    w, deltas, tight, loose = skin_and_morphs(built, src[nearest], bd, spec)
    built, fixed = pose_correct(built, w, arm, body, bd)
    built, _ = anti_clip(built, bd, gs.clearance(built, bd.landmarks, spec) * 0.9)   # rest stays clean too
    print(f"  {spec.shape}: posed anti-clip moved {fixed}")
    for name, delta in list(fit_deltas.items()):   # fit morphs get the same posed clean-up
        var, var_fixed = pose_correct(built + delta, w, arm, body, bd)
        var, _ = anti_clip(var, bd, gs.clearance(var, bd.landmarks, spec) * 0.9)
        fit_deltas[name] = var - built
        print(f"  {spec.shape}/{name}: posed anti-clip moved {var_fixed}")
    basis = built - np.tensordot(bd.default_w, deltas, axes=1)
    obj.data.vertices.foreach_set("co", built.ravel())
    cylindrical_uvs(obj, bd, src[nearest])
    obj.data.vertices.foreach_set("co", basis.ravel())
    for poly in obj.data.polygons:
        poly.use_smooth = True
    set_vertex_groups(obj, w, bd.names)
    obj.data.materials.append(render.make_material("fabric", FABRIC_RGB, 0.85))
    obj.parent = arm
    obj.modifiers.new("Armature", "ARMATURE").object = arm
    bs.assert_all_weighted(obj)
    keys = [(f"body_{i}", deltas[i], bd.default_w[i]) for i in range(bs.MORPH_COUNT)]
    keys += [("fit_tight", tight, 0.0), ("fit_loose", loose, 0.0)]
    keys += [(name, delta, 0.0) for name, delta in fit_deltas.items()]
    add_shape_keys(obj, basis, keys)   # shape keys LAST: no geometry ops after this
    return obj


# One check render per UNIQLO hero item (shape + fit morphs), plus a full outfit.
SHOTS = (
    ("supima_tee", {"tee": {}}),
    ("u_crew_tee", {"tee": {"fit_boxy": 1.0}}),
    ("cashmere_sweater", {"sweater": {}}),
    ("ultra_stretch_pants", {"pants": {}}),
    ("barrel_jeans", {"pants": {"fit_barrel": 1.0}}),
    ("outfit", {"tee": {}, "pants": {}}),
    ("outfit_u_barrel", {"tee": {"fit_boxy": 1.0}, "pants": {"fit_barrel": 1.0}}),
    ("pose_pocket", {"tee": {}, "pants": {}}),
    ("pose_walk", {"sweater": {}, "pants": {"fit_barrel": 1.0}}),
)


def _set_fit_morphs(obj, morphs: dict) -> None:
    for kb in obj.data.shape_keys.key_blocks:
        if kb.name.startswith("fit_"):
            kb.value = float(morphs.get(kb.name, 0.0))


def render_checks(arm, body, body_co, objs: dict, out_dir: str, height: float, prefix: str) -> list:
    for shape, obj in objs.items():
        obj.data.materials[0] = render.make_material(f"render_{shape}", RENDER_RGB[shape], 0.85)
    paths = []
    for label, outfit in SHOTS:
        if not set(outfit) <= set(objs):
            continue
        poses.apply(arm, body, label.split("pose_")[1] if label.startswith("pose_") else "relaxed", body_co)
        for shape, obj in objs.items():
            obj.hide_render = shape not in outfit
            _set_fit_morphs(obj, outfit.get(shape, {}))
        path = os.path.join(out_dir, f"{prefix}{label}.png")
        render.render_front(path, height)
        paths.append(path)
    for obj in objs.values():
        _set_fit_morphs(obj, {})
    render.tile_images(paths, len(paths), os.path.join(out_dir, f"{prefix}items.png"))
    return paths


def write_fits_json(out_dir: str) -> None:
    payload = {"items": gf.ITEM_FITS, "name_rules": gf.NAME_RULES,
               "note": "Set garment.morphTargetInfluences[morphTargetDictionary[name]] = weight for each morph."}
    bs.write_json_atomic(os.path.join(out_dir, "fits.json"), payload)


def main() -> None:
    args = parse_args()
    arm, body = load_body(args.body)
    bd = body_data(arm, body)
    L = bd.landmarks
    print(f"landmarks: height {L.height:.3f} hips_z {L.hips_z:.3f} crotch_z {L.crotch_z:.3f} chest_z {L.chest_z:.3f}")
    os.makedirs(args.out, exist_ok=True)
    objs = {}
    for shape in [s.strip() for s in args.shapes.split(",") if s.strip()]:
        spec = gs.SPECS[shape]
        obj = make_garment(arm, body, bd, spec)
        for o in objs.values():
            o.hide_set(True)
        path = os.path.join(args.out, f"{shape}.glb")
        bs.export_glb(path, [arm, obj])
        diff = glb_tools.assert_same_bind(path, args.body)
        print(f"  wrote {path} {os.path.getsize(path) // 1024} KB, bind diff {diff:.1e}, {glb_tools.summary(path)}")
        objs[shape] = obj
    for o in objs.values():
        o.hide_set(False)
    write_fits_json(args.out)
    if args.renders:
        for p in render_checks(arm, body, bd.proxy, objs, os.path.abspath(args.renders), L.height,
                               args.render_prefix):
            print("  rendered", p)


if __name__ == "__main__":
    main()
