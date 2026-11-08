"""MHR lod2.fbx -> web/public/models/body.glb (skinned, metres, morphs body_0..body_5 at Caleb's body).

Usage:
    .venv/bin/python pipeline/body.py --fbx assets/mhr/assets/lod2.fbx --height 178 \
        --out web/public/models/body.glb
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
import render  # noqa: E402

DEFAULT_TARGET = {"chest": 92.0, "waist": 75.0, "hips": 90.0, "inseam": 84.0}
SKIN_RGB = (0.52, 0.34, 0.25)
SLIDER_RANGE = (-3.0, 3.0)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--fbx", required=True)
    p.add_argument("--height", type=float, default=178.0, help="standing height in cm")
    p.add_argument("--chest", type=float, default=DEFAULT_TARGET["chest"])
    p.add_argument("--waist", type=float, default=DEFAULT_TARGET["waist"])
    p.add_argument("--hips", type=float, default=DEFAULT_TARGET["hips"])
    p.add_argument("--out", required=True)
    p.add_argument("--render", default=os.path.join(ROOT, "pipeline/renders/body_front.png"))
    return p.parse_args()


def load_mhr(fbx: str):
    bs.reset_scene()
    bpy.ops.import_scene.fbx(filepath=fbx)
    arm, mesh = bs.find_one("ARMATURE"), bs.find_one("MESH")
    bs.delete_objects(o for o in bpy.data.objects if o not in (arm, mesh))
    bs.bake_transforms(arm, mesh)
    arm.name, arm.data.name = "Armature", "Armature"
    mesh.name, mesh.data.name = "body", "body"
    return arm, mesh


def keep_body_morphs(mesh) -> np.ndarray:
    """Drop every shape key except shape_0..5; rename them body_0..5. Returns deltas (k, n, 3)."""
    keys = mesh.data.shape_keys.key_blocks
    keep = {f"shape_{i}" for i in range(bs.MORPH_COUNT)}
    drop = [k.name for k in keys if k.name not in keep and k != keys[0]]
    for name in drop:  # remove by name: indices shift as we go
        mesh.shape_key_remove(mesh.data.shape_keys.key_blocks[name])
    base = bs.vertex_coords(mesh, keys[0])
    deltas = []
    for i in range(bs.MORPH_COUNT):
        kb = keys[f"shape_{i}"]
        kb.name = f"body_{i}"
        kb.slider_min, kb.slider_max = SLIDER_RANGE
        deltas.append(bs.vertex_coords(mesh, kb) - base)
    return np.stack(deltas)


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


def write_measure_json(path, weights, measured, jac, height_cm) -> None:
    payload = {
        "height_cm": height_cm,
        "morphs": [f"body_{i}" for i in range(bs.MORPH_COUNT)],
        "slider_range": list(SLIDER_RANGE),
        "default_weights": [round(float(w), 4) for w in weights],
        "measured_cm_at_default": {k: round(float(measured[k]), 2) for k in ("chest", "waist", "hips", "inseam")},
        "jacobian_cm_per_unit": jac,
        "note": "Linear model: measurement ~= measured_cm_at_default + J @ (w - default_weights).",
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


def main() -> None:
    args = parse_args()
    target_h = args.height / 100.0
    target = {"chest": args.chest, "waist": args.waist, "hips": args.hips}

    arm, mesh = load_mhr(args.fbx)
    deltas = keep_body_morphs(mesh)
    w_mat, names = bs.weight_matrix(mesh)
    base = bs.vertex_coords(mesh, mesh.data.shape_keys.key_blocks[0])
    geo = bm.make_geometry(base, deltas, bs.edge_array(mesh), bs.arm_weight(w_mat, names))

    print("MHR mean body @%.0fcm:" % args.height, {k: round(v, 1) for k, v in bm.measure(base, geo, target_h).items()})
    weights, measured = bm.fit_weights(geo, target, target_h)
    print("fitted weights:", np.round(weights, 3))
    print("fitted body:", {k: round(v, 1) for k, v in measured.items()})

    co = geo.coords(weights)
    scale_to_height(arm, mesh, target_h / (co[:, 2].max() - co[:, 2].min()))
    for i, w in enumerate(weights):
        mesh.data.shape_keys.key_blocks[f"body_{i}"].value = float(w)

    jac = bm.jacobian(geo, weights, target_h)
    mesh.data.materials.clear()
    mesh.data.materials.append(render.make_material("skin", SKIN_RGB, 0.55))
    clear_custom_normals(mesh)
    bs.assert_all_weighted(mesh)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bs.export_glb(args.out, [arm, mesh])
    write_measure_json(os.path.join(os.path.dirname(args.out), "body_measure.json"), weights, measured, jac, args.height)
    print("wrote", args.out, os.path.getsize(args.out) // 1024, "KB")

    if args.render:
        render.lower_arms(arm)
        eng = render.render_front(os.path.abspath(args.render), target_h)
        print("rendered", args.render, "with", eng)


if __name__ == "__main__":
    main()
