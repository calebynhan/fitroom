"""Turn a finished garment (numpy arrays) into a Blender object that exports to the Garment GLB contract:
one SkinnedMesh on the body's bones, UVs in metres, rib-band mask in COLOR_0.r, body_0..5 + fit_* shape keys.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

import bpy
import numpy as np

import bl_scene as bs
import garment_fit as gf
import render
from garment_body import BodyData

WHITE = (1.0, 1.0, 1.0)
MATERIAL_ROUGHNESS = {"fabric": 0.85, "shoe": 0.6}
SLIDER_RANGE = (-3.0, 3.0)


@dataclass(frozen=True)
class GarmentMesh:
    name: str
    v: np.ndarray                 # (n, 3) rest positions at the default body weights
    f: np.ndarray                 # (t, 3)
    weights: np.ndarray           # (n, groups) skin weights, columns = BodyData.names
    arm_w: np.ndarray             # (n,) arm membership (UV unwrapping axis)
    band: np.ndarray              # (n,) 0..1 knit rib mask, exported as COLOR_0 (r = g = b = band)
    body_deltas: np.ndarray       # (6, n, 3)
    fit_deltas: dict = field(default_factory=dict)   # name -> (n, 3)
    material: str = "fabric"
    outer: np.ndarray | None = None   # (t,) bool: faces of the outer shell (not turned-back strips); None = all

    def outer_faces(self) -> np.ndarray:
        """Faces another garment layers over. Turned-back strips face the body; as a collider they flip the
        inside/outside test right at an edge (a waistband rim then pushes a top *into* the pants)."""
        return self.f if self.outer is None else self.f[self.outer]


def _set_vertex_groups(obj, w: np.ndarray, names: list) -> None:
    used = [g for g in range(w.shape[1]) if w[:, g].max() > 0]   # collect used NAMES first
    for g in used:
        vg = obj.vertex_groups.new(name=names[g])
        rows = np.nonzero(w[:, g] > 0)[0]
        for i in rows:
            vg.add([int(i)], float(w[i, g]), "REPLACE")


def cylindrical_uvs(co: np.ndarray, arm_w: np.ndarray, bd: BodyData) -> np.ndarray:
    """UVs in metres (1 UV unit = 1 m), unrolled around the body, arm or leg axis, so a fabric texture
    tiles at the same physical scale everywhere: u = arc length around the axis, v = distance along it."""
    L, n = bd.landmarks, len(co)
    base = np.tile([0.0, float(np.median(co[:, 1])), 0.0], (n, 1))
    axis = np.tile([0.0, 0.0, 1.0], (n, 1))
    side = np.where(co[:, 0] >= 0, "l", "r")
    arm = arm_w > 0.5
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
    return np.column_stack([ang * np.linalg.norm(radial, axis=1), np.where(axis[:, 2] > 0.5, co[:, 2], -along)])


def _set_uvs(me, uv: np.ndarray) -> None:
    loop_v = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loop_v)
    me.uv_layers.new(name="UVMap").data.foreach_set("uv", uv[loop_v].ravel())


def _set_band(me, band: np.ndarray) -> None:
    """Rib-band mask as the active (linear float) colour attribute: survives meshopt packing, unlike custom
    attributes. The viewer swaps the material, so the colour never tints anything by itself."""
    attr = me.color_attributes.new(name="band", type="FLOAT_COLOR", domain="POINT")
    rgba = np.column_stack([band, band, band, np.ones_like(band)]).astype(np.float32)
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr


def _add_shape_keys(obj, basis: np.ndarray, keys: list) -> None:
    obj.shape_key_add(name="Basis", from_mix=False)
    for name, delta, value in keys:
        kb = obj.shape_key_add(name=name, from_mix=False)
        kb.data.foreach_set("co", (basis + delta).ravel())
        kb.slider_min, kb.slider_max = SLIDER_RANGE
        kb.value = float(value)


def skinned_object(name: str, v: np.ndarray, f: np.ndarray, weights: np.ndarray, arm, bd: BodyData):
    """A mesh skinned to the body's armature (vertex groups by bone name + Armature modifier)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(v.tolist(), [], f.tolist())
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for poly in me.polygons:
        poly.use_smooth = True
    _set_vertex_groups(obj, weights, bd.names)
    obj.parent = arm
    obj.modifiers.new("Armature", "ARMATURE").object = arm
    bs.assert_all_weighted(obj)
    return obj


def build_object(g: GarmentMesh, arm, bd: BodyData):
    """Geometry, UVs, attributes and weights first; shape keys LAST (no geometry ops after them)."""
    obj = skinned_object(g.name, g.v, g.f, g.weights, arm, bd)
    me = obj.data
    _set_uvs(me, cylindrical_uvs(g.v, g.arm_w, bd))
    _set_band(me, g.band)
    me.materials.append(render.make_material(g.material, WHITE, MATERIAL_ROUGHNESS[g.material]))
    basis = g.v - np.tensordot(bd.default_w, g.body_deltas, axes=1)
    obj.data.vertices.foreach_set("co", basis.ravel())
    keys = [(f"body_{i}", g.body_deltas[i], bd.default_w[i]) for i in range(bs.MORPH_COUNT)]
    keys += [(name, delta, 0.0) for name, delta in sorted(g.fit_deltas.items())]
    _add_shape_keys(obj, basis, keys)
    return obj


def write_fits_json(out_dir: str) -> None:
    payload = {"items": gf.ITEM_FITS, "name_rules": gf.NAME_RULES,
               "note": "Set garment.morphTargetInfluences[morphTargetDictionary[name]] = weight for each morph."}
    bs.write_json_atomic(os.path.join(out_dir, "fits.json"), payload)
