"""Gravity cloth relax with Blender's cloth solver, done the way a rigged garment is simulated in production:

The garment is skinned to the armature (Armature modifier BEFORE the Cloth modifier), the body and shoes are
armature-deformed colliders, and the skeleton animates from the rest A-pose into the drape pose over
`blend_frames`, then holds while the cloth settles. Rest lengths come from the undistorted rest-pose pattern,
so armpits fold by collision instead of collapsing under linear skinning. Pinned verts (shoulder yoke,
waistband, cuffs) follow the skeleton; everything else drapes under gravity.

Per-vertex `shrink` changes rest lengths: positive draws a rib band in. Blender maps a vertex-group weight w
to shrink_min + (shrink_max - shrink_min) * w, so any per-vertex shrink is encoded as a weight in [0, 1].
"""
from __future__ import annotations

from dataclasses import dataclass

import bpy
import numpy as np

import bl_scene as bs


@dataclass(frozen=True)
class ClothParams:
    blend_frames: int = 24      # rest pose -> drape pose
    settle_frames: int = 36     # hold the pose while the cloth comes to rest
    quality: int = 10           # solver steps per frame
    mass: float = 0.15          # kg per vertex (Blender cloth is per-vertex, tuned for ~1 cm edges)
    tension: float = 30.0
    compression: float = 30.0
    shear: float = 10.0
    bending: float = 2.0
    air_damping: float = 2.0
    pin_stiffness: float = 3.0
    collision_distance: float = 0.003
    body_thickness: float = 0.002
    friction: float = 6.0
    self_collision: bool = False
    self_distance: float = 0.003


def _vertex_group(obj, name: str, weights: np.ndarray) -> None:
    old = obj.vertex_groups.get(name)
    if old is not None:      # never inherit stale weights
        obj.vertex_groups.remove(old)
    vg = obj.vertex_groups.new(name=name)
    rounded = np.round(weights, 3)
    for value in np.unique(rounded):
        if value > 0:
            vg.add(np.nonzero(rounded == value)[0].tolist(), float(value), "REPLACE")


def _make_collider(obj, p: ClothParams):
    mod = obj.modifiers.new("collision", "COLLISION")   # after the Armature modifier: collides posed
    obj.collision.thickness_outer = p.body_thickness
    obj.collision.thickness_inner = 0.02
    obj.collision.cloth_friction = p.friction
    obj.collision.damping = 0.5
    return mod


def _cloth(obj, p: ClothParams, shrink_lo: float, shrink_hi: float, frames: int):
    mod = obj.modifiers.new("cloth", "CLOTH")
    s, c = mod.settings, mod.collision_settings
    s.quality, s.mass = p.quality, p.mass
    s.tension_stiffness, s.compression_stiffness = p.tension, p.compression
    s.shear_stiffness, s.bending_stiffness = p.shear, p.bending
    s.air_damping = p.air_damping
    s.vertex_group_mass, s.pin_stiffness = "pin", p.pin_stiffness
    s.vertex_group_shrink, s.shrink_min, s.shrink_max = "shrink", shrink_lo, shrink_hi
    c.use_collision, c.distance_min, c.collision_quality = True, p.collision_distance, 4
    c.use_self_collision, c.self_distance_min = p.self_collision, p.self_distance
    mod.point_cache.frame_start, mod.point_cache.frame_end = 1, frames
    return mod


def _animate(arm, to_pose, blend_frames: int) -> None:
    """Keyframe rest at frame 1 and the target pose at 1 + blend_frames (to_pose() poses the armature).
    The target is captured before the action exists: an assigned action would re-evaluate over manual posing."""
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = None
    to_pose()
    target = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones}
    ad.action = bpy.data.actions.new("drape_blend")
    for frame, use_target in ((1, False), (1 + blend_frames, True)):
        for pb in arm.pose.bones:
            if use_target:
                pb.rotation_quaternion, pb.location = target[pb.name]
            else:
                pb.rotation_quaternion, pb.location = (1.0, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            pb.keyframe_insert("location", frame=frame)


def _clear_animation(arm) -> None:
    ad = arm.animation_data
    if ad and ad.action:
        action = ad.action
        ad.action = None
        bpy.data.actions.remove(action)
    for pb in arm.pose.bones:
        pb.rotation_quaternion, pb.location = (1.0, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()


def drape(garment, arm, colliders: list, to_pose, pin: np.ndarray, shrink: np.ndarray,
          p: ClothParams) -> np.ndarray:
    """Simulate the skinned `garment` object into the pose set by `to_pose()` and return its settled,
    posed vertex positions (world space). colliders: skinned objects (body, shoes) to collide with.
    pin: (n,) 0..1 goal weight. shrink: (n,) per-vertex rest-length shrink (+0.1 = draw in 10 %)."""
    scene = bpy.context.scene
    frames = 1 + p.blend_frames + p.settle_frames
    scene.frame_start, scene.frame_end = 1, frames
    lo, hi = float(min(shrink.min(), 0.0)), float(max(shrink.max(), 0.0))
    span = hi - lo if hi > lo else 1.0
    col_mods, cloth = [], None
    try:   # set-up inside the try: a failure must not leave collision modifiers on the body
        _vertex_group(garment, "pin", np.clip(pin, 0.0, 1.0))
        _vertex_group(garment, "shrink", (shrink - lo) / span)
        for obj in colliders:
            col_mods.append((obj, _make_collider(obj, p)))
        cloth = _cloth(garment, p, lo, hi, frames)
        _animate(arm, to_pose, p.blend_frames)
        for frame in range(1, frames + 1):
            scene.frame_set(frame)
        out = bs.evaluated_coords(garment)
    finally:
        if cloth is not None:
            garment.modifiers.remove(cloth)
        for obj, mod in col_mods:
            obj.modifiers.remove(mod)
        scene.frame_set(1)
        _clear_animation(arm)
    if len(out) != len(garment.data.vertices) or not np.isfinite(out).all():
        raise RuntimeError("cloth simulation returned a different or non-finite mesh")
    return out
