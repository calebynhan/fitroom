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
# Catalogue posing tip: keep a little air between arm and waist so the garment silhouette reads. Store
# mannequins stand that way too, and it keeps forearms out of a loose (boxy) tee's side panels.
RELAXED_ARM_DROP = 33.0   # degrees the upper arm swings down from the A-pose
# Arms hang close to the sides with soft elbows; palms turn to face the thighs (twist split over the
# forearm and wrist so neither joint candy-wraps); shoulders drop slightly.
RELAXED_ARM = {
    "l": [("l_clavicle", "Y", 3), ("l_uparm", "Y", RELAXED_ARM_DROP), ("l_uparm", "X", -3), ("l_lowarm", "Y", 6),
          ("l_lowarm", "X", -4), ("forearm_twist", "l", 75)],
    "r": [("r_clavicle", "Y", -3), ("r_uparm", "Y", -RELAXED_ARM_DROP), ("r_uparm", "X", -3), ("r_lowarm", "Y", -6),
          ("r_lowarm", "X", -4), ("forearm_twist", "r", 75)],
}
# Forearm twist (pronation) is spread over MHR's twist bones so the skin doesn't candy-wrap at the wrist.
FOREARM_TWIST_BONES = (("lowarm_twist1_proc", 0.2), ("lowarm_twist2_proc", 0.4), ("lowarm_twist3_proc", 0.6),
                       ("lowarm_twist4_proc", 0.8), ("wrist_twist", 1.0))
WEIGHT_SHIFT = [("r_upleg", "Y", -1.5), ("l_upleg", "X", -3), ("l_lowleg", "X", 6), ("l_talocrural", "X", -3),
                ("c_spine0", "Y", 1.0), ("c_spine2", "Y", -1.0)]

POSES = {
    # Arms loose at the sides with a soft elbow, feet hip-width, weight even.
    "relaxed": {"rot": STANCE + WEIGHT_SHIFT + RELAXED_ARM["l"] + RELAXED_ARM["r"], "ik": []},
    # Both hands in the front pockets (wrists just under the shirt hem, hands inside the pants), elbows
    # relaxed back, shoulders down, weight on the right leg.
    "pocket": {
        "rot": STANCE + WEIGHT_SHIFT + [("l_clavicle", "Y", 4), ("r_clavicle", "Y", -4), ("c_head", "Z", 4.0)],
        "ik": [("l", "pocket"), ("r", "pocket")],
        # fingers tuck back into the pocket; thumbs fold in too (left out they poke 3 cm through the pants)
        "post": [("l_wrist", "X", 36), ("r_wrist", "X", 36), ("l_thumb0", "X", 50), ("r_thumb0", "X", 50)],
    },
    # Mid-stride, left foot forward; arms swing opposite; shoulders counter-rotate.
    "walk": {
        "rot": STANCE + [
            ("l_upleg", "X", -15), ("l_lowleg", "X", 8), ("l_talocrural", "X", 1),
            ("r_upleg", "X", 10), ("r_lowleg", "X", 13), ("r_talocrural", "X", -7),
            ("r_uparm", "Y", -33), ("r_uparm", "X", -13), ("r_lowarm", "Y", -6), ("r_lowarm", "X", -16),
            ("l_uparm", "Y", 33), ("l_uparm", "X", 11), ("l_lowarm", "Y", 6), ("l_lowarm", "X", -7),
            ("forearm_twist", "l", 60), ("forearm_twist", "r", 60),
            ("c_spine1", "Z", -4.0), ("c_head", "Z", 3.0),
        ],
        "ik": [],
    },
}
# Garments are draped (cloth sim) in this pose: the Relaxed stance with the arms only half lowered. A pattern
# cut in the A-pose has a sleeve cap sized for raised arms; lowering them all the way in the sim hauls a
# loose top up by its sleeves (hem +8 cm at 39 deg, +1 cm at 25 deg). Skinning covers the last ~8 degrees.
# Not exported as a clip.
DRAPE_ARM_FRACTION = 0.75
DRAPE = {"rot": STANCE + WEIGHT_SHIFT + [(b, a, d * DRAPE_ARM_FRACTION) for b, a, d in RELAXED_ARM["l"] + RELAXED_ARM["r"]],
         "ik": []}
AXES = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}
SOLE_LIFT = 0.018   # every pose stands the feet this high: the shoes' soles (shoes.py) reach the floor
POCKET_DEPTH = 0.022   # wrist this far behind the thigh front: deeper and the fingertips poke out of the thigh


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
    z = hips_z - 0.045                      # just under the shirt hem, at the front pocket opening
    near = (np.abs(body_co[:, 2] - z) < 0.02) & (np.abs(body_co[:, 0] - sign * 0.15) < 0.02)
    front_y = float(body_co[near, 1].min()) if near.any() else -0.10
    target = Vector((sign * 0.16, front_y + POCKET_DEPTH, z))   # wrist just behind the pants surface
    shoulder = arm.pose.bones[f"{side}_uparm"].head
    pole = shoulder + Vector((sign * 0.22, 0.35, -0.25))   # elbow relaxed out and back
    return target, pole


def forearm_twist(arm, side: str, deg: float) -> None:
    """Rotate the forearm twist bones about the elbow->wrist axis (positive turns the palm toward the body)."""
    a = arm.pose.bones[f"{side}_lowarm"].head.copy()
    axis = (arm.pose.bones[f"{side}_wrist"].head - a).normalized()
    sign = 1.0 if side == "l" else -1.0
    for name, frac in FOREARM_TWIST_BONES:
        rotate_about_head(arm, f"{side}_{name}", Matrix.Rotation(math.radians(sign * deg * frac), 3, axis))


def ground(arm, mesh) -> None:
    """Translate the root so the lowest posed vertex sits SOLE_LIFT above z = 0 (shoe soles fill the gap)."""
    z_min = bs.evaluated_coords(mesh)[:, 2].min()
    root = arm.pose.bones["root"]
    root.matrix = Matrix.Translation((0, 0, SOLE_LIFT - z_min)) @ root.matrix
    bpy.context.view_layer.update()


def apply(arm, mesh, name: str, body_co: np.ndarray) -> None:
    apply_spec(arm, mesh, POSES[name], body_co)


def apply_spec(arm, mesh, spec: dict, body_co: np.ndarray) -> None:
    reset(arm)
    for op in spec["rot"]:
        if op[0] == "forearm_twist":             # palm toward the thigh, spread along the forearm
            _, side, deg = op
            forearm_twist(arm, side, deg)
        else:
            bone, axis, deg = op
            rotate_about_head(arm, bone, Matrix.Rotation(math.radians(deg), 3, AXES[axis]))
    for side, kind in spec["ik"]:
        if kind == "pocket":
            two_bone_ik(arm, side, *_pocket_target(arm, body_co, side))
    for bone, axis, deg in spec.get("post", []):
        rotate_about_head(arm, bone, Matrix.Rotation(math.radians(deg), 3, AXES[axis]))
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
