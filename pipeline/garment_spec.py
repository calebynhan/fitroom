"""Per-shape garment parameters and region selection by skeleton landmarks (pure numpy)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import garment_geom as gg

ARM_VERT_CUTOFF = 0.15      # skin weight on arm bones above which a vert counts as "arm"
COLLAR_FORWARD = 0.010      # crew neck opening sits slightly forward of the neck centre (front = -Y)
COLLAR_BACK_RISE = 0.01     # neckline height at the sides/back, above the neck joint
HEAD_CLEAR = 0.045          # everything this far above the neck joint is head
CROTCH_MARGIN = 0.045       # tops can't hem below the crotch: the body splits into two legs there
DRAPE_STRENGTH = 0.6        # 1.0 = hang straight down from the chest outline
DRAPE_TAPER = 0.97
MIDLINE_CLEARANCE = 0.006   # pant legs never cross x = 0
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
    sleeve_flare_r: float = 0.0
    drape: bool = False
    waist_above_hips: float = 0.0
    hem_above_ankle: float = 0.0
    leg_hem_r: float = 0.0


SPECS = {
    "tee": GarmentSpec("tee", "top", inflate=0.008, thickness=0.0022, hem_below_hips=0.10, collar_rx=0.078,
                       collar_ry=0.070, collar_front_drop=0.035, sleeve="short", sleeve_t=0.45, sleeve_flare_r=0.054, drape=True),
    "sweater": GarmentSpec("sweater", "top", inflate=0.015, thickness=0.0035, hem_below_hips=0.13,
                           collar_rx=0.072, collar_ry=0.066,
                           collar_front_drop=0.040, sleeve="long", sleeve_t=0.93, drape=True),
    "pants": GarmentSpec("pants", "bottom", inflate=0.010, thickness=0.0028, waist_above_hips=0.06,
                         hem_above_ankle=0.03, leg_hem_r=0.058),
}


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def side_of(co: np.ndarray) -> np.ndarray:
    return np.where(co[:, 0] >= 0, "l", "r")


def _per_side(co: np.ndarray, table: dict) -> np.ndarray:
    return np.where((co[:, 0] >= 0)[:, None], table["l"], table["r"])


def top_hem_z(L: Landmarks, spec: GarmentSpec) -> float:
    return max(L.hips_z - spec.hem_below_hips, L.crotch_z + CROTCH_MARGIN)


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
    hem_z = float(np.mean([L.ankle["l"][2], L.ankle["r"][2]])) + spec.hem_above_ankle
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


def drape_torso(v: np.ndarray, arm_w: np.ndarray, L: Landmarks) -> np.ndarray:
    """Below the chest, fabric hangs from the chest outline instead of hugging the waist."""
    torso = arm_w < 0.2
    band = torso & (np.abs(v[:, 2] - L.chest_z) < 0.015)
    centre_xy = np.array([0.0, np.median(v[band, 1])])
    prof = gg.polar_profile(v[band, :2], centre_xy)
    target = gg.sample_profile(prof, v[:, :2] - centre_xy)
    target = target * DRAPE_TAPER
    blend = DRAPE_STRENGTH * gg.smoothstep(0.0, 0.12, L.chest_z - v[:, 2]) * torso
    centre = np.column_stack([np.zeros(len(v)), np.full(len(v), centre_xy[1]), v[:, 2]])
    return gg.push_radial(v, centre, None, target, blend)


def flare_sleeves(v: np.ndarray, arm_w: np.ndarray, L: Landmarks, flare_r: float) -> np.ndarray:
    """Tee sleeves stand off the upper arm as an open tube."""
    s_pt, e_pt = _per_side(v, L.shoulder), _per_side(v, L.elbow)
    seg = e_pt - s_pt
    length = np.linalg.norm(seg, axis=1, keepdims=True)
    axis = seg / length
    t = ((v - s_pt) * axis).sum(1) / length[:, 0]
    centre = s_pt + np.clip(t, 0, 1)[:, None] * seg
    blend = gg.smoothstep(0.3, 0.7, arm_w) * gg.smoothstep(0.05, 0.35, t)
    return gg.push_radial(v, centre, axis, np.full(len(v), flare_r), blend)


def drape_legs(v: np.ndarray, L: Landmarks, hem_r: float, hem_z: float) -> np.ndarray:
    """Straight pant legs: from the thigh at the crotch, fall as a tapering tube to the hem."""
    z_top = L.crotch_z - 0.03
    out = v.copy()
    for s, sign in (("l", 1.0), ("r", -1.0)):
        sel = (sign * v[:, 0] > 0) & (v[:, 2] < z_top)
        hj, an = L.hip_joint[s], L.ankle[s]
        z = v[sel, 2]
        t = np.clip((hj[2] - z) / (hj[2] - an[2]), 0, 1)[:, None]
        centre = hj + t * (an - hj)   # straight hip->ankle axis: no kink at the knee
        centre[:, 2] = z
        ring = np.abs(z - (z_top - 0.015)) < 0.015
        d = v[sel][ring, :2] - centre[ring, :2]
        r_top = float(np.percentile(np.linalg.norm(d, axis=1), 80)) if ring.any() else hem_r
        s_lin = np.clip((z_top - z) / (z_top - hem_z), 0, 1)
        target = r_top + s_lin * (hem_r - r_top)
        blend = gg.smoothstep(0.0, 0.06, z_top - z)
        pushed = gg.push_radial(v[sel], centre, None, target, blend)
        pushed[:, 0] = sign * np.maximum(sign * pushed[:, 0], MIDLINE_CLEARANCE)
        out[sel] = pushed
    return out
