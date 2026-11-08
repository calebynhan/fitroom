"""Per-shape garment cut parameters and region selection by skeleton landmarks (pure numpy).

How each garment stands off the body (ease, drape, sleeve/leg shape) lives in garment_fit.py.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import garment_geom as gg

ARM_VERT_CUTOFF = 0.15      # skin weight on arm bones above which a vert counts as "arm"
COLLAR_FORWARD = 0.010      # crew neck opening sits slightly forward of the neck centre (front = -Y)
COLLAR_BACK_RISE = 0.01     # neckline height at the sides/back, above the neck joint
HEAD_CLEAR = 0.045          # everything this far above the neck joint is head
CROTCH_MARGIN = 0.045       # tops can't hem below the crotch: the body splits into two legs there
LAYER_GAP = 0.020           # untucked tops clear the pants shell (pants inflate + thickness + margin)
LAYER_BLEND = 0.03          # metres above the pants waistband over which top clearance ramps up


@dataclass(frozen=True)
class Landmarks:
    height: float
    hips_z: float
    crotch_z: float
    chest_z: float
    neck: np.ndarray
    neck_xy: np.ndarray
    shoulder: dict
    elbow: dict
    wrist: dict
    hip_joint: dict
    knee: dict
    ankle: dict


@dataclass(frozen=True)
class GarmentSpec:
    shape: str
    slot: str
    inflate: float
    thickness: float
    gap: float = 0.004
    smooth_iters: int = 10
    hem_below_hips: float = 0.0
    collar_rx: float = 0.0
    collar_ry: float = 0.0
    collar_front_drop: float = 0.0
    sleeve: str = ""            # "short" | "long" | ""
    sleeve_t: float = 0.0
    waist_above_hips: float = 0.0
    hem_above_ankle: float = 0.0


# Hem heights follow UNIQLO model photos: tee/sweater hems sit ~8 cm below the belt, at the hip.
SPECS = {
    "tee": GarmentSpec("tee", "top", inflate=0.008, thickness=0.0022, hem_below_hips=0.02, collar_rx=0.078,
                       collar_ry=0.068, collar_front_drop=0.016, sleeve="short", sleeve_t=0.50),
    "sweater": GarmentSpec("sweater", "top", inflate=0.012, thickness=0.0035, hem_below_hips=0.035,
                           collar_rx=0.070, collar_ry=0.064, collar_front_drop=0.008, sleeve="long",
                           sleeve_t=0.93),
    "pants": GarmentSpec("pants", "bottom", inflate=0.010, thickness=0.0028, waist_above_hips=0.06,
                         hem_above_ankle=0.03),
}


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def top_hem_z(L: Landmarks, spec: GarmentSpec) -> float:
    return max(L.hips_z - spec.hem_below_hips, L.crotch_z + CROTCH_MARGIN)


def pants_hem_z(L: Landmarks, spec: GarmentSpec) -> float:
    return float(np.mean([L.ankle["l"][2], L.ankle["r"][2]])) + spec.hem_above_ankle


def _sleeve_segment(L: Landmarks, spec: GarmentSpec, s: str):
    if spec.sleeve == "short":
        return L.shoulder[s], L.elbow[s]
    return L.elbow[s], L.wrist[s]


def _collar_uv(co: np.ndarray, L: Landmarks, spec: GarmentSpec) -> np.ndarray:
    cx, cy = L.neck_xy[0], L.neck_xy[1] - COLLAR_FORWARD
    return np.column_stack([(co[:, 0] - cx) / spec.collar_rx, (co[:, 1] - cy) / spec.collar_ry])


def in_collar(co: np.ndarray, L: Landmarks, spec: GarmentSpec, scale: float) -> np.ndarray:
    """Inside the elliptical crew-neck cylinder and above its floor. The floor scoops down at the
    front (deepest at centre-front) and sits at the neck base at the sides/back, so the neckline is a
    smooth U instead of the vertical-sided notch a plain cylinder cuts into the upper chest."""
    uv = _collar_uv(co, L, spec)
    r = np.linalg.norm(uv, axis=1)
    front = np.clip(-uv[:, 1] / np.maximum(r, 1e-9), 0.0, 1.0)  # 1 at centre-front, 0 at sides/back
    floor = L.neck[2] + COLLAR_BACK_RISE - (COLLAR_BACK_RISE + spec.collar_front_drop) * front ** 2
    return (r < scale) & (co[:, 2] > floor)


def top_region(co: np.ndarray, arm_w: np.ndarray, L: Landmarks, spec: GarmentSpec):
    hem_z = top_hem_z(L, spec)
    keep = (co[:, 2] > hem_z) & ~in_collar(co, L, spec, 1.0) & (co[:, 2] < L.neck[2] + HEAD_CLEAR)
    planes = [(np.array([0.0, 0.0, hem_z]), np.array([0.0, 0.0, 1.0]))]
    arm_ok = np.zeros(len(co), dtype=bool)
    for s, sel in (("l", co[:, 0] >= 0), ("r", co[:, 0] < 0)):
        a, b = _sleeve_segment(L, spec, s)
        axis = _unit(b - a)
        cut = a + spec.sleeve_t * (b - a)
        arm_ok |= sel & ((co - cut) @ axis < 0)
        planes.append((cut, axis))
    is_arm = arm_w > ARM_VERT_CUTOFF
    return keep & (~is_arm | arm_ok), planes


def pants_region(co: np.ndarray, arm_w: np.ndarray, L: Landmarks, spec: GarmentSpec):
    waist_z = L.hips_z + spec.waist_above_hips
    hem_z = pants_hem_z(L, spec)
    keep = (co[:, 2] > hem_z) & (co[:, 2] < waist_z) & (arm_w <= ARM_VERT_CUTOFF)
    up = np.array([0.0, 0.0, 1.0])
    return keep, [(np.array([0.0, 0.0, waist_z]), up), (np.array([0.0, 0.0, hem_z]), up)]


def region(co, arm_w, L, spec):
    return top_region(co, arm_w, L, spec) if spec.slot == "top" else pants_region(co, arm_w, L, spec)


def clearance(v: np.ndarray, L: Landmarks, spec: GarmentSpec) -> np.ndarray:
    """Per-vertex min distance from the body. Tops sit outside the pants below the pants waistband."""
    if spec.slot != "top":
        return np.full(len(v), spec.gap)
    pants_waist = L.hips_z + SPECS["pants"].waist_above_hips
    ramp = 1.0 - gg.smoothstep(pants_waist, pants_waist + LAYER_BLEND, v[:, 2])
    return spec.gap + (LAYER_GAP - spec.gap) * ramp
