"""Shared Blender helpers: scene reset, FBX/GLB import, transform baking, export.

bpy must be imported before bmesh (bpy-as-module bootstraps Blender).
"""
from __future__ import annotations

import json
import os

import bpy  # noqa: F401  (must load first)
import numpy as np

ARM_TOKENS = ("uparm", "lowarm", "wrist", "pinky", "ring", "middle", "index", "thumb")
MORPH_COUNT = 6


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def find_one(kind: str) -> bpy.types.Object:
    objs = [o for o in bpy.data.objects if o.type == kind]
    if len(objs) != 1:
        raise RuntimeError(f"expected exactly one {kind}, found {[o.name for o in objs]}")
    return objs[0]


def delete_objects(objs) -> None:
    for o in list(objs):
        bpy.data.objects.remove(o, do_unlink=True)


def select_only(objs) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake_transforms(armature: bpy.types.Object, mesh: bpy.types.Object) -> None:
    """Apply loc/rot/scale on armature + mesh so both live in metres, identity matrices.

    Pitfall: rigged meshes in cm under a scaled armature give wrong sizes downstream.
    """
    select_only([armature, mesh])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()
    for o in (armature, mesh):
        if not np.allclose(np.array(o.matrix_world), np.eye(4), atol=1e-6):
            raise RuntimeError(f"{o.name} still has a non-identity world matrix")


def vertex_coords(mesh: bpy.types.Object, key=None) -> np.ndarray:
    me = mesh.data
    src = key.data if key is not None else me.vertices
    out = np.empty(len(me.vertices) * 3, dtype=np.float64)
    src.foreach_get("co", out)
    return out.reshape(-1, 3)


def edge_array(mesh: bpy.types.Object) -> np.ndarray:
    me = mesh.data
    out = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", out)
    return out.reshape(-1, 2)


def weight_matrix(mesh: bpy.types.Object) -> tuple[np.ndarray, list[str]]:
    """Dense (n_verts, n_groups) skin weight matrix + group names."""
    names = [g.name for g in mesh.vertex_groups]
    w = np.zeros((len(mesh.data.vertices), len(names)), dtype=np.float32)
    for v in mesh.data.vertices:
        for g in v.groups:
            w[v.index, g.group] = g.weight
    return w, names


def arm_weight(weights: np.ndarray, names: list[str]) -> np.ndarray:
    cols = [i for i, n in enumerate(names) if any(t in n for t in ARM_TOKENS)]
    return weights[:, cols].sum(axis=1)


def assert_all_weighted(mesh: bpy.types.Object) -> None:
    """Pitfall: verts with zero weights produce a neutral_bone in the GLB."""
    bad = [v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups) <= 1e-6]
    if bad:
        raise RuntimeError(f"{mesh.name}: {len(bad)} vertices have no skin weight (e.g. {bad[:5]})")


def evaluated_coords(mesh) -> np.ndarray:
    """World-space vertex positions after shape keys and the armature pose."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    return co.reshape(-1, 3)


def export_glb(path: str, objs, animations: bool = False) -> None:
    """Export to a temp file, then rename: the viewer never loads a half-written GLB."""
    select_only(list(objs))
    tmp = f"{path}.tmp.glb"
    bpy.ops.export_scene.gltf(
        filepath=tmp,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=False,
        export_animations=animations,
        export_animation_mode="NLA_TRACKS",
        export_def_bones=False,
        export_leaf_bone=False,
        export_rest_position_armature=True,
        export_materials="EXPORT",
    )
    os.replace(tmp, path)


def write_json_atomic(path: str, payload: dict) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f, indent=2)
    os.replace(tmp, path)
