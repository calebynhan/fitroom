"""Three everyday poses, modelled on UNIQLO catalogue shots (relaxed stand, hand in pocket, walking step).

Each pose is a list of world-space bone rotations (about the bone head; children follow) plus optional
two-bone IK for hand placement, then the body is re-grounded. Poses are exported as single-keyframe glTF
animation clips on the body GLB; garments are bound to the same bones, so they follow.
Blender world: Z up, front = -Y, model's left = +X.  Rotation signs: about +X, negative swings a limb
forward; about +Y, positive swings the left limb toward the body (right limb: negative).
"""
from __future__ import annotations

import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import bl_scene as bs

STANCE = [  # A-pose legs -> natural hip-width stance, soles kept flat
    ("l_upleg", "Y", 4.5), ("r_upleg", "Y", -4.5), ("l_talocrural", "Y", -4.5), ("r_talocrural", "Y", 4.5),
]
RELAXED_ARM = {
    "l": [("l_uparm", "Y", 37), ("l_uparm", "X", -4), ("l_lowarm", "Y", 10), ("l_lowarm", "X", -9)],
    "r": [("r_uparm", "Y", -37), ("r_uparm", "X", -4), ("r_lowarm", "Y", -10), ("r_lowarm", "X", -9)],
}

POSES = {
    # Arms loose at the sides with a soft elbow, feet hip-width, weight even.
    "relaxed": {"rot": STANCE + RELAXED_ARM["l"] + RELAXED_ARM["r"], "ik": []},
    # Weight on the right leg, left knee eased forward, left hand in the front pocket, S-curve spine.
    "pocket": {
        "rot": STANCE + RELAXED_ARM["r"] + [
            ("r_upleg", "Y", -2.0), ("l_upleg", "X", -7), ("l_lowleg", "X", 12), ("l_talocrural", "X", -5),
            ("c_spine0", "Y", 2.0), ("c_spine2", "Y", -3.0), ("c_neck", "Y", 2.0), ("c_head", "Z", 6.0),
        ],
        "ik": [("l", "pocket")],
    },
    # Mid-stride, left foot forward; arms swing opposite; shoulders counter-rotate.
    "walk": {
        "rot": STANCE + [
            ("l_upleg", "X", -15), ("l_lowleg", "X", 8), ("l_talocrural", "X", 1),
            ("r_upleg", "X", 10), ("r_lowleg", "X", 13), ("r_talocrural", "X", -7),
            ("r_uparm", "Y", -37), ("r_uparm", "X", -13), ("r_lowarm", "Y", -10), ("r_lowarm", "X", -16),
            ("l_uparm", "Y", 37), ("l_uparm", "X", 11), ("l_lowarm", "Y", 10), ("l_lowarm", "X", -7),
            ("c_spine1", "Z", -4.0), ("c_head", "Z", 3.0),
        ],
        "ik": [],
    },
}
AXES = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}


def reset(arm) -> None:
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def rotate_about_head(arm, bone: str, rot: Matrix) -> None:
    pb = arm.pose.bones[bone]
    head = pb.head.copy()
    pb.matrix = Matrix.Translation(head) @ rot.to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def _aim(arm, bone: str, child_head: Vector, target: Vector) -> None:
    """Rotate `bone` about its head so the point child_head moves onto the line toward target."""
    head = arm.pose.bones[bone].head
    q = (child_head - head).rotation_difference(target - head)
    rotate_about_head(arm, bone, q.to_matrix())


def two_bone_ik(arm, side: str, target: Vector, pole: Vector) -> None:
    """Analytic IK: shoulder->elbow->wrist reaches target, elbow bends toward pole."""
    up, low, wr = arm.pose.bones[f"{side}_uparm"], arm.pose.bones[f"{side}_lowarm"], arm.pose.bones[f"{side}_wrist"]
    s, e, w = up.head.copy(), low.head.copy(), wr.head.copy()
    a, b = (e - s).length, (w - e).length
    d = min((target - s).length, a + b - 1e-4)
    axis = (target - s).normalized()
    cos_s = (a * a + d * d - b * b) / (2 * a * d)
    bend = (pole - s) - axis * (pole - s).dot(axis)
    elbow = s + axis * (a * cos_s) + bend.normalized() * (a * math.sqrt(max(0.0, 1 - cos_s ** 2)))
    _aim(arm, f"{side}_uparm", e, elbow)
    _aim(arm, f"{side}_lowarm", arm.pose.bones[f"{side}_wrist"].head.copy(), target)


def _pocket_target(arm, body_co: np.ndarray, side: str) -> tuple[Vector, Vector]:
    sign = 1.0 if side == "l" else -1.0
    hips_z = arm.pose.bones["root"].head.z
    z = hips_z + 0.005                      # wrist at the pocket opening on the front hip
    near = (np.abs(body_co[:, 2] - z) < 0.02) & (np.abs(body_co[:, 0] - sign * 0.15) < 0.02)
    front_y = float(body_co[near, 1].min()) if near.any() else -0.10
    target = Vector((sign * 0.165, front_y + 0.03, z))
    shoulder = arm.pose.bones[f"{side}_uparm"].head
    pole = shoulder + Vector((sign * 0.30, 0.30, -0.20))   # elbow out and back
    return target, pole


def ground(arm, mesh) -> None:
    """Translate the root so the lowest posed vertex touches z = 0."""
    z_min = bs.evaluated_coords(mesh)[:, 2].min()
    root = arm.pose.bones["root"]
    root.matrix = Matrix.Translation((0, 0, -z_min)) @ root.matrix
    bpy.context.view_layer.update()


def apply(arm, mesh, name: str, body_co: np.ndarray) -> None:
    reset(arm)
    spec = POSES[name]
    for bone, axis, deg in spec["rot"]:
        rotate_about_head(arm, bone, Matrix.Rotation(math.radians(deg), 3, AXES[axis]))
    for side, kind in spec["ik"]:
        if kind == "pocket":
            two_bone_ik(arm, side, *_pocket_target(arm, body_co, side))
    ground(arm, mesh)


def bake_clips(arm, mesh, body_co: np.ndarray) -> list:
    """One single-keyframe action per pose, stashed on NLA tracks for glTF export."""
    ad = arm.animation_data or arm.animation_data_create()
    names = []
    for name in POSES:
        apply(arm, mesh, name, body_co)
        action = bpy.data.actions.new(name)
        ad.action = action
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=1)
            pb.keyframe_insert("location", frame=1)
        track = ad.nla_tracks.new()
        track.name = name
        track.strips.new(name, 1, action)
        track.mute = True    # a live track would override the next pose while it is being built
        ad.action = None
        names.append(name)
    for track in ad.nla_tracks:
        track.mute = False
    reset(arm)
    return names
