"""Linear blend skinning in numpy: pose a garment like the viewer does, map posed edits back to rest,
and clean up poke-through in every pose clip.

Armature space == world space here (transforms are baked by garment_body.load_body).
"""
from __future__ import annotations

import bpy  # noqa: F401  (must load before mathutils users)
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

import bl_scene as bs
import garment_geom as gg
import poses
from garment_body import BodyData

POSE_PASSES = ("relaxed", "walk", "pocket", "relaxed")   # default pose last so it ends cleanest
POSE_GAP = 0.004
INWARD_BELOW_CHEST = 0.08   # the inward forearm push only applies to fabric this far below the chest line
POSE_MAX_PUSH = 0.04   # ignore matches farther than this (wrong body part)
HAND_GAP = 0.010       # fabric tents this far over hands and fingers (a fingertip is wider than an edge)
HAND_SPREAD = 4        # neighbour-averaging steps that turn a hand push into a soft bulge
UNDER_COS = -0.2       # hand counts as under the fabric unless its surface faces back at it (side-on fingertips count)
ARM_SPAN = 0.06        # longest inward move through a forearm/hand (m); farther means a wrong match


def skin_matrices(arm, names: list) -> np.ndarray:
    """(groups, 4, 4) posed-from-rest matrix for each vertex-group bone."""
    out = np.zeros((len(names), 4, 4))
    for g, name in enumerate(names):
        pb = arm.pose.bones.get(name)
        out[g] = np.array(pb.matrix @ pb.bone.matrix_local.inverted()) if pb else np.eye(4)
    return out


def blend(w: np.ndarray, mats: np.ndarray) -> np.ndarray:
    """(n, 4, 4) per-vertex blended skinning matrix."""
    return np.einsum("vg,gij->vij", w, mats)


def lbs(v: np.ndarray, m: np.ndarray) -> np.ndarray:
    return np.einsum("vij,vj->vi", m[:, :3, :3], v) + m[:, :3, 3]


def unlbs(posed: np.ndarray, m: np.ndarray) -> np.ndarray:
    """Inverse of lbs for each vertex's own blended matrix."""
    return np.linalg.solve(m[:, :3, :3], (posed - m[:, :3, 3])[:, :, None])[:, :, 0]


def posed_body(arm, body, bd: BodyData, pose: str) -> np.ndarray:
    poses.apply(arm, body, pose, bd.proxy)
    return bs.evaluated_coords(body)


def _push_out(posed: np.ndarray, bvh: BVHTree, sel: np.ndarray, gap: float, under: np.ndarray | None = None):
    """Posed-space correction that moves selected verts out of `bvh` to `gap` (zero elsewhere).

    under: the garment's outward normals. If given, only push where the collider faces the same way, i.e.
    it is *under* the fabric (a hand in a pocket); a hand hanging outside a shirt must not shove it inward.
    """
    dp = np.zeros_like(posed)
    for i in np.nonzero(sel)[0]:
        loc, nrm, _, _ = bvh.find_nearest(Vector(posed[i]), POSE_MAX_PUSH)
        if loc is None:
            continue
        if under is not None and nrm.dot(Vector(under[i])) < UNDER_COS:
            continue
        depth = (Vector(posed[i]) - loc).dot(nrm)
        if depth < gap:
            dp[i] = np.array(nrm) * (gap - depth)
    return dp


def _push_inward(posed: np.ndarray, bvh: BVHTree, sel: np.ndarray, gap: float, normals: np.ndarray):
    """For selected verts that sit inside the collider (an arm cutting through a shirt's side panel), move them
    inward along the fabric's own normal until they're `gap` past the collider's inner face: the fabric then
    passes between arm and body instead of being split around the arm."""
    dp = np.zeros_like(posed)
    for i in np.nonzero(sel)[0]:
        p = Vector(posed[i])
        loc, nrm, _, dist = bvh.find_nearest(p, POSE_MAX_PUSH)
        if loc is None or (p - loc).dot(nrm) >= 0.0:
            continue
        if nrm.dot(Vector(normals[i])) >= UNDER_COS:   # the arm is under the fabric (pocket): tent, don't push in
            continue
        inward = -Vector(normals[i])
        hit, _, _, travel = bvh.ray_cast(p, inward, ARM_SPAN)
        if hit is not None and travel < ARM_SPAN:
            dp[i] = np.array(inward) * (travel + gap)
    return dp


def _apply(out: np.ndarray, dp: np.ndarray, m: np.ndarray, f, spread: int) -> np.ndarray:
    """Add a posed-space correction (mapped back to rest). With faces, the push spreads to neighbours so a
    hand pressing into fabric makes a soft bulge rather than a spike."""
    if f is not None and spread > 0:
        hit = np.abs(dp).sum(1) > 0
        soft = gg.diffuse(dp, f, spread)
        dp = np.where(hit[:, None], dp, soft)
    moved = np.abs(dp).sum(1) > 1e-7
    out = out.copy()
    out[moved] += np.linalg.solve(m[moved, :3, :3], dp[moved, :, None])[:, :, 0]
    return out, moved


def pose_correct(built: np.ndarray, w: np.ndarray, arm, body, bd: BodyData, passes: tuple = POSE_PASSES,
                 f: np.ndarray | None = None, extras: tuple = (), inward: bool = False) -> tuple[np.ndarray, dict]:
    """Posed anti-clip: in each pose, push garment verts that end up inside the posed body back out, and
    map the correction to rest space through the inverse of each vertex's skinning transform.

    Sleeves collide only with the arm, the garment body with the torso and legs: a sleeve pinched between
    forearm and hip must not be shoved into the arm (that shows skin through the sleeve). The garment body
    also clears forearms and hands (a tee hem drapes over the wrists, pants tent over fingers in pockets).
    extras: (rest_v, faces, weights, mask, gap) skinned meshes to clear too, e.g. the pants under a top.
    inward: also push fabric that a forearm cuts through inward (tops only: in pants the hands are inside).
    """
    arm_cols = [i for i, n in enumerate(bd.names) if any(t in n for t in bs.ARM_TOKENS)]
    hand_cols = [i for i, n in enumerate(bd.names) if any(t in n for t in bs.ARM_TOKENS[1:])]
    body_arm_f = bd.arm_w[bd.faces].mean(axis=1) > 0.5
    body_hand_f = bd.weights[:, hand_cols].sum(1)[bd.faces].mean(axis=1) > 0.5
    # Forearms/hands hanging beside the waist cut through a shirt's side panels; push that fabric inward. Only
    # below the chest: at the shoulder, torso fabric reads as "inside" the deltoid and would be torn up.
    low_torso = bd.landmarks.chest_z - INWARD_BELOW_CHEST
    rest_low = (built[:, 2] < low_torso)
    sleeve = w[:, arm_cols].sum(1) > 0.5          # garment verts that belong to a sleeve
    out, report = built.copy(), {}
    for pose in passes:
        posed_b = posed_body(arm, body, bd, pose).tolist()
        mats = skin_matrices(arm, bd.names)
        m = blend(w, mats)
        # Torso clearance runs after the hand/forearm passes: an inward push must never leave fabric in the body.
        colliders = [(posed_b, bd.faces[body_arm_f], sleeve, POSE_GAP, 0, "out"),
                     (posed_b, bd.faces[body_hand_f], ~sleeve, HAND_GAP, HAND_SPREAD, "under"),
                     (posed_b, bd.faces[body_hand_f], ~sleeve & rest_low, POSE_GAP, 3, "inward"),
                     (posed_b, bd.faces[~body_arm_f], ~sleeve, POSE_GAP, 2, "out")]
        for ev, ef, ew, mask, gap in extras:
            colliders.append((lbs(ev, blend(ew, mats)).tolist(), ef, ~sleeve & mask, gap, 2, "out"))
        moved = np.zeros(len(out), dtype=bool)
        for verts, faces, sel, gap, spread, mode in colliders:
            if (mode != "out" and f is None) or (mode == "inward" and not inward):
                continue
            posed = lbs(out, m)
            bvh = BVHTree.FromPolygons(verts, np.asarray(faces).tolist())
            if mode == "inward":
                dp = _push_inward(posed, bvh, sel, gap, gg.vertex_normals(posed, f))
            else:
                dp = _push_out(posed, bvh, sel, gap, gg.vertex_normals(posed, f) if mode == "under" else None)
            out, hit = _apply(out, dp, m, f, spread)
            moved |= hit
        report[pose] = int(moved.sum())
    poses.reset(arm)
    return out, report
