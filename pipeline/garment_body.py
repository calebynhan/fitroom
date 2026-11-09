"""The body a garment is built on: rest-pose proxy, landmarks, skin weights, morph deltas, collision queries.

A garment vertex is tied to the body through its *origin*: the body triangle (and barycentric point on it)
it was cut from. Skin weights and body_i morph deltas are interpolated from that origin.
"""
from __future__ import annotations

from dataclasses import dataclass

import bpy  # noqa: F401  (must load before bmesh)
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import bl_scene as bs
import garment_geom as gg
import glb_tools
import garment_spec as gs
import poses

MAX_INFLUENCES = 4
NECK_SLICE = 0.72   # fraction of the way from the c_neck to the c_head joint where neck width is measured
MIN_INFLUENCE = 0.01


@dataclass(frozen=True)
class BodyData:
    proxy: np.ndarray       # (n, 3) rest A-pose at the default body weights, metres, Z up
    faces: np.ndarray       # (t, 3)
    normals: np.ndarray
    deltas: np.ndarray      # (6, n, 3) body_i morph deltas
    default_w: np.ndarray   # (6,)
    weights: np.ndarray     # (n, groups) skin weights
    names: list             # vertex group (bone) names
    arm_w: np.ndarray       # (n,) total skin weight on arm/hand bones
    bvh: BVHTree
    landmarks: gs.Landmarks


@dataclass(frozen=True)
class Surface:
    """A triangle mesh lying on (or grown from) the body, with each vertex's origin on the body."""
    v: np.ndarray
    f: np.ndarray
    tri: np.ndarray     # (n,) origin body triangle
    bary: np.ndarray    # (n, 3) origin barycentric coords on that triangle

    def subset(self, face_keep: np.ndarray) -> "Surface":
        v, f, idx = gg.submesh(self.v, self.f, face_keep)
        return Surface(v, f, self.tri[idx], self.bary[idx])

    def largest_component(self) -> "Surface":
        _, f, idx = gg.largest_component(self.v, self.f)
        return Surface(self.v[idx], f, self.tri[idx], self.bary[idx])

    def with_v(self, v: np.ndarray) -> "Surface":
        return Surface(v, self.f, self.tri, self.bary)


def load_body(path: str):
    if glb_tools.is_meshopt(path):
        raise RuntimeError(f"{path} is meshopt-compressed; pass the uncompressed build copy (assets/build/)")
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


def _triangles(mesh) -> np.ndarray:
    polys = [tuple(p.vertices) for p in mesh.data.polygons]
    if any(len(p) != 3 for p in polys):
        raise RuntimeError("body mesh is expected to be triangulated (glTF import)")
    return np.array(polys, dtype=np.int64)


def bone_head(arm, name: str) -> np.ndarray:
    return np.array(arm.matrix_world @ arm.data.bones[name].head_local)


def find_landmarks(arm, co: np.ndarray) -> gs.Landmarks:
    z0, height = co[:, 2].min(), co[:, 2].max() - co[:, 2].min()
    centre = np.abs(co[:, 0]) < 0.004
    crotch_band = centre & (co[:, 2] > z0 + 0.35 * height) & (co[:, 2] < z0 + 0.6 * height)
    if not crotch_band.any():
        raise RuntimeError("landmarks: no centreline vertices in the crotch band (unexpected body mesh)")
    crotch = co[crotch_band, 2].min()
    neck = bone_head(arm, "c_neck")
    head = bone_head(arm, "c_head")
    # Neck width at mid-neck: a slice at the c_neck joint (shoulder height) catches the trapezius.
    z_mid = neck[2] + NECK_SLICE * (head[2] - neck[2])
    ring = ((np.abs(co[:, 2] - z_mid) < 0.006) & (np.abs(co[:, 0]) < 0.1)
            & (co[:, 1] > neck[1] - 0.04) & (co[:, 1] < neck[1] + 0.07))
    if not ring.any():
        raise RuntimeError("landmarks: no vertices in the mid-neck slice (unexpected body mesh)")
    neck_half_width = float(np.abs(co[ring, 0]).max())
    both = lambda bone: {s: bone_head(arm, f"{s}_{bone}") for s in ("l", "r")}  # noqa: E731
    return gs.Landmarks(
        height=height, floor_z=z0, hips_z=bone_head(arm, "root")[2], crotch_z=crotch,
        chest_z=z0 + 0.725 * height, neck=neck, neck_xy=neck[:2].copy(),
        neck_scale=neck_half_width / gs.REF_NECK_HALF_WIDTH,
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
    faces = _triangles(body)
    weights, gnames = bs.weight_matrix(body)
    bvh = BVHTree.FromPolygons(proxy.tolist(), faces.tolist())
    return BodyData(proxy, faces, gg.vertex_normals(proxy, faces), deltas, w0, weights, gnames,
                    bs.arm_weight(weights, gnames), bvh, find_landmarks(arm, proxy))


def _nearest(v: np.ndarray, bvh: BVHTree):
    loc = np.empty_like(v)
    nrm = np.empty_like(v)
    tri = np.empty(len(v), dtype=np.int64)
    for i, p in enumerate(v):
        l, n, fi, _ = bvh.find_nearest(Vector(p))
        loc[i], nrm[i], tri[i] = l, n, fi
    return loc, nrm, tri


def nearest_on_body(v: np.ndarray, bd: BodyData):
    """Nearest rest-pose body point, its (interpolated) normal and triangle for each vertex."""
    return _nearest(v, bd.bvh)


def origins(v: np.ndarray, bd: BodyData) -> tuple[np.ndarray, np.ndarray]:
    """Origin triangle + barycentric coords of the nearest body point for each vertex."""
    loc, _, tri = nearest_on_body(v, bd)
    a, b, c = (bd.proxy[bd.faces[tri, k]] for k in range(3))
    return tri, gg.barycentric(loc, a, b, c)


def interp(field: np.ndarray, bd: BodyData, tri: np.ndarray, bary: np.ndarray) -> np.ndarray:
    """Interpolate a per-body-vertex field (n, ...) at origin points. Works on axis 0 of `field`."""
    idx = bd.faces[tri]                                   # (m, 3)
    vals = field[idx]                                     # (m, 3, ...)
    shape = (len(tri), 3) + (1,) * (vals.ndim - 2)
    return (vals * bary.reshape(shape)).sum(axis=1)


def uniform_surface(bd: BodyData, voxel: float) -> Surface:
    """Voxel-remesh the watertight body into even ~voxel-sized triangles (cloth needs uniform edges;
    MHR's torso edges are 2-3 cm while the head/hands are dense), each vertex mapped to its body origin."""
    me = bpy.data.meshes.new("body_remesh")
    me.from_pydata(bd.proxy.tolist(), [], bd.faces.tolist())
    me.update()
    obj = bpy.data.objects.new("body_remesh", me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new("remesh", "REMESH")
    mod.mode, mod.voxel_size, mod.adaptivity = "VOXEL", voxel, 0.0
    bs.select_only([obj])
    bpy.ops.object.modifier_apply(modifier=mod.name)
    v = bs.vertex_coords(obj)
    quads = [tuple(p.vertices) for p in obj.data.polygons]
    bpy.data.objects.remove(obj, do_unlink=True)
    f = gg.triangulate(quads, v)
    tri, bary = origins(v, bd)
    return Surface(v, f, tri, bary)


def anti_clip(v: np.ndarray, bd: BodyData, gap, iters: int = 2, bvh: BVHTree | None = None,
              max_dist: float | None = None) -> tuple[np.ndarray, int]:
    """Push any vert closer than `gap` (scalar or per-vert) to, or inside, the body back out along the normal.
    bvh: a posed body / another garment to test against instead of the rest-pose body. max_dist: ignore verts
    farther than this from it (a thigh 60 cm above a shoe can read as "behind" a collar face and get thrown)."""
    gap = np.broadcast_to(np.asarray(gap, dtype=np.float64), (len(v),))
    tree = bvh or bd.bvh
    out, total = v.copy(), 0
    for _ in range(iters):
        loc, nrm, _ = _nearest(out, tree)
        signed = ((out - loc) * nrm).sum(1)
        bad = signed < gap
        if max_dist is not None:
            bad &= np.linalg.norm(out - loc, axis=1) < max_dist
        out[bad] = loc[bad] + nrm[bad] * gap[bad, None]
        total += int(bad.sum())
        if not bad.any():
            break
    return out, total


def skin_weights(bd: BodyData, tri: np.ndarray, bary: np.ndarray) -> np.ndarray:
    """Skin weights interpolated at the origin points, limited to 4 influences and renormalised."""
    return limit_influences(interp(bd.weights.astype(np.float64), bd, tri, bary))


def limit_influences(w: np.ndarray) -> np.ndarray:
    """Keep each vertex's 4 strongest bone weights (glTF JOINTS_0), drop tiny ones, renormalise."""
    w = w.copy()
    order = np.argsort(-w, axis=1)
    rows = np.arange(len(w))[:, None]
    w[rows, order[:, MAX_INFLUENCES:]] = 0.0
    w[w < MIN_INFLUENCE] = 0.0
    return w / np.maximum(w.sum(1, keepdims=True), 1e-12)


def morph_deltas(bd: BodyData, tri: np.ndarray, bary: np.ndarray) -> np.ndarray:
    """(6, m, 3) body_i deltas at the origin points: the garment follows the body's shape morphs."""
    return np.stack([interp(bd.deltas[i], bd, tri, bary) for i in range(len(bd.deltas))])
