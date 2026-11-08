"""MHR lod2.fbx -> skinned body GLB (metres, morphs body_0..body_5 at the target body) + measure JSON.

Usage:
    .venv/bin/python pipeline/body.py --fbx assets/mhr/assets/lod2.fbx --height 178 \
        --out web/public/models/body.glb
    .venv/bin/python pipeline/body.py --fbx assets/mhr/assets/lod2.fbx --sex female \
        --out web/public/models/body_female.glb
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import bpy  # noqa: F401  (must load before bmesh / other bpy-dependent modules)
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bl_scene as bs  # noqa: E402
import body_measure as bm  # noqa: E402
import poses  # noqa: E402
import render  # noqa: E402
import sculpt  # noqa: E402

# Male: Caleb. Female: classic fashion-model proportions (WHR ~0.69, bust ~= hips, ~1:8 head).
PRESETS = {
    "male": {"height": 178.0, "chest": 92.0, "waist": 75.0, "hips": 90.0, "fit_pcs": 6},
    "female": {"height": 172.0, "chest": 86.0, "underbust": 70.0, "waist": 61.0, "hips": 89.0, "fit_pcs": 20,
               "shoulder_width": 45.0, "hip_width": 36.5, "bust_projection": 4.5},
}
SKIN_RGB = (0.52, 0.34, 0.25)
SLIDER_RANGE = (-3.0, 3.0)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--fbx", required=True)
    p.add_argument("--sex", choices=sorted(PRESETS), default="male")
    p.add_argument("--height", type=float, help="standing height in cm (default from --sex preset)")
    for name in ("chest", "underbust", "waist", "hips"):
        p.add_argument(f"--{name}", type=float, help=f"{name} circumference in cm (default from preset)")
    p.add_argument("--out", required=True)
    p.add_argument("--render", help="front render PNG (default pipeline/renders/<out stem>_front.png)")
    return p.parse_args()


def resolve_targets(args) -> dict:
    preset = dict(PRESETS[args.sex])
    for name in ("height", "chest", "underbust", "waist", "hips"):
        if getattr(args, name) is not None:
            preset[name] = getattr(args, name)
    return preset


def load_mhr(fbx: str):
    bs.reset_scene()
    bpy.ops.import_scene.fbx(filepath=fbx)
    arm, mesh = bs.find_one("ARMATURE"), bs.find_one("MESH")
    bs.delete_objects(o for o in bpy.data.objects if o not in (arm, mesh))
    bs.bake_transforms(arm, mesh)
    arm.name, arm.data.name = "Armature", "Armature"
    mesh.name, mesh.data.name = "body", "body"
    return arm, mesh


def add_to_all_keys(mesh, delta: np.ndarray) -> None:
    """Bake a displacement into the base shape: every key block (absolute coords) moves together."""
    for kb in mesh.data.shape_keys.key_blocks:
        kb.data.foreach_set("co", (bs.vertex_coords(mesh, kb) + delta).ravel())
    mesh.data.vertices.foreach_set("co", bs.vertex_coords(mesh, mesh.data.shape_keys.key_blocks[0]).ravel())


def sculpt_face(arm, mesh, sex: str) -> None:
    bone = lambda n: np.array(arm.data.bones[n].head_local)  # noqa: E731  (armature space == world)
    eye = (bone("l_eye") + bone("r_eye")) / 2
    base = bs.vertex_coords(mesh, mesh.data.shape_keys.key_blocks[0])
    add_to_all_keys(mesh, sculpt.displacement(base, eye, bone("c_neck"), sculpt.STYLES[sex]))


def keep_pcs(mesh, count: int) -> np.ndarray:
    """Drop every shape key except shape_0..count-1. Returns their deltas (count, n, 3)."""
    keys = mesh.data.shape_keys.key_blocks
    keep = {f"shape_{i}" for i in range(count)}
    for name in [k.name for k in keys if k.name not in keep and k != keys[0]]:
        mesh.shape_key_remove(mesh.data.shape_keys.key_blocks[name])  # by name: indices shift
    base = bs.vertex_coords(mesh, keys[0])
    return np.stack([bs.vertex_coords(mesh, keys[f"shape_{i}"]) - base for i in range(count)])


def bake_extra_pcs(mesh, weights: np.ndarray, deltas: np.ndarray) -> None:
    """PCs beyond the 6 exported morphs are baked into the base shape, then removed."""
    extra = np.tensordot(weights[bs.MORPH_COUNT:], deltas[bs.MORPH_COUNT:], axes=1)
    for i in range(bs.MORPH_COUNT, len(weights)):
        mesh.shape_key_remove(mesh.data.shape_keys.key_blocks[f"shape_{i}"])
    if len(weights) > bs.MORPH_COUNT:
        add_to_all_keys(mesh, extra)


def finish_morphs(mesh, weights: np.ndarray) -> None:
    for i in range(bs.MORPH_COUNT):
        kb = mesh.data.shape_keys.key_blocks[f"shape_{i}"]
        kb.name = f"body_{i}"
        kb.slider_min, kb.slider_max = SLIDER_RANGE
        kb.value = float(weights[i])


def clear_custom_normals(mesh) -> None:
    """FBX custom split normals don't follow morphs and leave shading seams; use computed smooth normals."""
    bs.select_only([mesh])
    if mesh.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    for poly in mesh.data.polygons:
        poly.use_smooth = True


def scale_to_height(arm, mesh, factor: float) -> None:
    arm.scale = (factor, factor, factor)
    bpy.context.view_layer.update()
    bs.bake_transforms(arm, mesh)


def write_measure_json(path, sex, weights, measured, jac, height_cm) -> None:
    payload = {
        "sex": sex,
        "height_cm": height_cm,
        "morphs": [f"body_{i}" for i in range(bs.MORPH_COUNT)],
        "slider_range": list(SLIDER_RANGE),
        "default_weights": [round(float(w), 4) for w in weights[: bs.MORPH_COUNT]],
        "measured_cm_at_default": {k: round(float(measured[k]), 2)
                                   for k in ("chest", "underbust", "waist", "hips", "inseam")},
        "jacobian_cm_per_unit": jac,
        "note": "Linear model: measurement ~= measured_cm_at_default + J @ (w - default_weights).",
    }
    bs.write_json_atomic(path, payload)


def main() -> None:
    args = parse_args()
    t = resolve_targets(args)
    target_h = t["height"] / 100.0
    target = {k: t[k] for k in ("chest", "underbust", "waist", "hips", "shoulder_width", "hip_width",
                                "bust_projection") if k in t}

    arm, mesh = load_mhr(args.fbx)
    sculpt_face(arm, mesh, args.sex)
    deltas = keep_pcs(mesh, t["fit_pcs"])
    w_mat, names = bs.weight_matrix(mesh)
    edges, arm_w = bs.edge_array(mesh), bs.arm_weight(w_mat, names)
    base = bs.vertex_coords(mesh, mesh.data.shape_keys.key_blocks[0])
    geo = bm.make_geometry(base, deltas, edges, arm_w)
    print(f"MHR mean @{t['height']:.0f}cm:", {k: round(v, 1) for k, v in bm.measure(base, geo, target_h).items()})
    weights, measured = bm.fit_weights(geo, target, target_h)
    print("fitted weights:", np.round(weights, 2))
    print("fitted body:", {k: round(v, 1) for k, v in measured.items()})

    bake_extra_pcs(mesh, weights, deltas)
    finish_morphs(mesh, weights)
    base6 = bs.vertex_coords(mesh, mesh.data.shape_keys.key_blocks[0])
    geo6 = bm.make_geometry(base6, deltas[: bs.MORPH_COUNT], edges, arm_w)
    co = geo6.coords(weights[: bs.MORPH_COUNT])
    scale_to_height(arm, mesh, target_h / (co[:, 2].max() - co[:, 2].min()))
    jac = bm.jacobian(geo6, weights[: bs.MORPH_COUNT], target_h)

    mesh.data.materials.clear()
    mesh.data.materials.append(render.make_material("skin", SKIN_RGB, 0.45))
    clear_custom_normals(mesh)
    bs.assert_all_weighted(mesh)

    out_dir = os.path.dirname(os.path.abspath(args.out))
    stem = os.path.splitext(os.path.basename(args.out))[0]
    os.makedirs(out_dir, exist_ok=True)
    rest_co = bs.evaluated_coords(mesh)
    render_poses(arm, mesh, rest_co, target_h, args.render or os.path.join(ROOT, f"pipeline/renders/{stem}_front.png"))
    clips = poses.bake_clips(arm, mesh, rest_co)   # after renders: NLA tracks override manual posing
    bs.export_glb(args.out, [arm, mesh], animations=True)
    write_measure_json(os.path.join(out_dir, f"{stem}_measure.json"), args.sex, weights, measured, jac, t["height"])
    print("wrote", args.out, os.path.getsize(args.out) // 1024, "KB, pose clips", clips)


def render_poses(arm, mesh, rest_co, height_m: float, front_path: str) -> None:
    front_path = os.path.abspath(front_path)
    shots = []
    for name in poses.POSES:
        poses.apply(arm, mesh, name, rest_co)
        shots.append(front_path.replace("_front.png", f"_{name}.png"))
        render.render_front(shots[-1], height_m)
    poses.apply(arm, mesh, "relaxed", rest_co)
    render.render_front(front_path, height_m)
    poses.reset(arm)
    print("rendered", render.tile_images(shots, len(shots), front_path.replace("_front.png", "_poses.png")))


if __name__ == "__main__":
    main()
