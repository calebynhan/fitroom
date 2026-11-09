"""Per-shape garment parameters: cut, ease, bands and cloth behaviour; region selection by skeleton landmarks
(pure numpy).

How each garment's silhouette stands off the body (chest ease, sleeve flare, leg taper) lives in
garment_fit.py; the hem/cuff/collar band geometry in garment_bands.py; the drape in cloth_sim.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

import garment_geom as gg
from cloth_sim import ClothParams

ARM_VERT_CUTOFF = 0.15      # skin weight on arm bones above which a vert counts as "arm"
COLLAR_FORWARD = 0.010      # crew neck opening sits slightly forward of the neck centre (front = -Y)
COLLAR_BACK_RISE = 0.01     # neckline height at the sides/back, above the neck joint
HEAD_CLEAR = 0.07           # everything this far above the neck joint is head (lower clips the collar sides)
CROTCH_MARGIN = 0.045       # tops can't hem below the crotch: the body splits into two legs there
LAYER_GAP = 0.015           # untucked tops clear the pants shell (pants ease + margin)
LAYER_BLEND = 0.03          # metres above the pants waistband over which top clearance ramps up
REF_NECK_HALF_WIDTH = 0.058  # male neck the collar radii were tuned on; other necks scale the collar
# Shoe collar line (shoes.py) relative to the ankle joint; pants hems ride just above it.
SHOE_COLLAR_DROP = 0.008     # below the ankle joint at the sides (just under the ankle bones) ...
SHOE_INSTEP_RISE = 0.035     # ... rising this much over the instep (tongue) ...
SHOE_HEEL_RISE = 0.008       # ... and a little at the heel counter


@dataclass(frozen=True)
class Landmarks:
    height: float
    floor_z: float
    hips_z: float
    crotch_z: float
    chest_z: float
    neck: np.ndarray
    neck_xy: np.ndarray
    neck_scale: float
    shoulder: dict
    elbow: dict
    wrist: dict
    hip_joint: dict
    knee: dict
    ankle: dict


@dataclass(frozen=True)
class Band:
    """The fabric along one open edge. Turned hems fold `turn` metres of fabric back inside the edge
    (a thick, rounded edge) and double the fabric over `height` (a faint step at the stitch line);
    knit rib bands are drawn in by the cloth sim and flagged in `_band` for the viewer's rib normal map."""
    height: float           # band height above the edge (m)
    rib: bool = False
    shrink: float = 0.0     # cloth rest-length shrink inside the band (+ draws it in)
    turn: float = 0.0       # depth of fabric turned back inside the edge (m)
    ridge: float = 0.0      # outward step of the doubled fabric over the band (m)
    pin: float = 0.0        # cloth pin weight on the band (holds a cuff or waistband in place)


@dataclass(frozen=True)
class GarmentSpec:
    shape: str
    slot: str
    ease: float               # standoff from the body along normals (m), full below the chest
    yoke_ease: float          # standoff over the shoulders, where a top rests on the body (m)
    sleeve_ease: float        # standoff along the sleeves (m)
    thickness: float          # fabric thickness: depth of turned-back edges (m)
    gap: float = 0.004        # minimum clearance from the body
    smooth_iters: int = 10
    hem_below_hips: float = 0.0
    collar_rx: float = 0.0
    collar_ry: float = 0.0
    collar_front_drop: float = 0.0
    sleeve: str = ""            # "short" | "long" | ""
    sleeve_t: float = 0.0
    waist_above_hips: float = 0.0
    hem_above_shoe: float = 0.0   # pants: hem height above the shoe collar line (m)
    slack: float = 0.0          # cloth rest-length shrink where fabric hangs free (- = extra fabric, folds)
    sleeve_slack: float = 0.0
    sleeve_pin: float = 0.0     # soft pin along sleeves (they follow the arm while it swings down)
    pin_reach: float = 0.10     # tops: pin fades out this far (m) from the collar; pants: from the waist
    bands: dict = field(default_factory=dict)
    cloth: ClothParams = ClothParams()


# Hem heights follow UNIQLO model photos: tee/sweater hems sit ~8 cm below the belt, at the hip.
# Ease along normals per the CLAUDE.md garment recipe: tee ~8 mm, sweater ~15 mm, pants ~12 mm.
SPECS = {
    "tee": GarmentSpec(
        "tee", "top", ease=0.008, yoke_ease=0.004, sleeve_ease=0.008, thickness=0.0018, hem_below_hips=0.02,
        collar_rx=0.078, collar_ry=0.068, collar_front_drop=0.016, sleeve="short", sleeve_t=0.50,
        sleeve_pin=0.5,
        bands={"collar": Band(0.018, rib=True, shrink=0.05, turn=0.010, ridge=0.0012, pin=1.0),
               "hem": Band(0.022, turn=0.020, ridge=0.0007),
               "cuff": Band(0.022, turn=0.020, ridge=0.0007, pin=0.5)},
        smooth_iters=24, cloth=ClothParams(bending=3.0, mass=0.12)),
    "sweater": GarmentSpec(
        "sweater", "top", ease=0.015, yoke_ease=0.005, sleeve_ease=0.007, thickness=0.003, hem_below_hips=0.035,
        collar_rx=0.070, collar_ry=0.064, collar_front_drop=0.008, sleeve="long", sleeve_t=0.97,
        sleeve_pin=0.2,
        bands={"collar": Band(0.022, rib=True, shrink=0.06, turn=0.012, ridge=0.0015, pin=1.0),
               "hem": Band(0.055, rib=True, shrink=0.10, turn=0.012),
               "cuff": Band(0.060, rib=True, shrink=0.18, turn=0.012, pin=0.35)},
        smooth_iters=24, cloth=ClothParams(bending=4.0, mass=0.18)),
    "pants": GarmentSpec(
        "pants", "bottom", ease=0.012, yoke_ease=0.012, sleeve_ease=0.0, thickness=0.0025, waist_above_hips=0.06,
        hem_above_shoe=0.004, pin_reach=0.07,
        bands={"waist": Band(0.040, turn=0.035, ridge=0.0012, pin=1.0),
               "leg": Band(0.030, turn=0.028, ridge=0.0008)},
        cloth=ClothParams(bending=5.0, mass=0.18, self_collision=True)),
}


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v)


def top_hem_z(L: Landmarks, spec: GarmentSpec) -> float:
    return max(L.hips_z - spec.hem_below_hips, L.crotch_z + CROTCH_MARGIN)


def pants_hem_z(L: Landmarks, spec: GarmentSpec) -> float:
    """Nominal hem height at the sides; the actual hem follows the shoe collar line (pants_hem_surface)."""
    return float(np.mean([L.ankle["l"][2], L.ankle["r"][2]])) - SHOE_COLLAR_DROP + spec.hem_above_shoe


def shoe_collar_z(v: np.ndarray, L: Landmarks) -> np.ndarray:
    """Height of the shoe collar line under each point: low under the ankle bones, up over the instep."""
    ank = np.where((v[:, 0] >= 0)[:, None], L.ankle["l"], L.ankle["r"])
    ahead = np.clip((ank[:, 1] - v[:, 1]) / 0.07, 0.0, 1.0)     # front = -Y
    behind = np.clip((v[:, 1] - ank[:, 1]) / 0.05, 0.0, 1.0)
    return ank[:, 2] - SHOE_COLLAR_DROP + SHOE_INSTEP_RISE * ahead ** 1.5 + SHOE_HEEL_RISE * behind


def pants_hem_surface(v: np.ndarray, L: Landmarks, spec: GarmentSpec) -> np.ndarray:
    """Pants hem height under each point: `hem_above_shoe` above the shoe collar line, so the hem sits on
    the shoe all the way round instead of a flat cut catching the instep."""
    return shoe_collar_z(v, L) + spec.hem_above_shoe


def _sleeve_segment(L: Landmarks, spec: GarmentSpec, s: str):
    if spec.sleeve == "short":
        return L.shoulder[s], L.elbow[s]
    return L.elbow[s], L.wrist[s]


def _collar_uv(co: np.ndarray, L: Landmarks, spec: GarmentSpec) -> np.ndarray:
    cx, cy = L.neck_xy[0], L.neck_xy[1] - COLLAR_FORWARD
    rx, ry = spec.collar_rx * L.neck_scale, spec.collar_ry * L.neck_scale
    return np.column_stack([(co[:, 0] - cx) / rx, (co[:, 1] - cy) / ry])


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
    keep = (co[:, 2] > pants_hem_surface(co, L, spec)) & (co[:, 2] < waist_z) & (arm_w <= ARM_VERT_CUTOFF)
    return keep, [(np.array([0.0, 0.0, waist_z]), np.array([0.0, 0.0, 1.0]))]


def region(co, arm_w, L, spec):
    return top_region(co, arm_w, L, spec) if spec.slot == "top" else pants_region(co, arm_w, L, spec)


def clearance(v: np.ndarray, L: Landmarks, spec: GarmentSpec) -> np.ndarray:
    """Per-vertex min distance from the body. Tops sit outside the pants below the pants waistband."""
    if spec.slot != "top":
        return np.full(len(v), spec.gap)
    pants_waist = L.hips_z + SPECS["pants"].waist_above_hips
    ramp = 1.0 - gg.smoothstep(pants_waist, pants_waist + LAYER_BLEND, v[:, 2])
    return spec.gap + (LAYER_GAP - spec.gap) * ramp


def ease_offset(v: np.ndarray, arm_w: np.ndarray, L: Landmarks, spec: GarmentSpec) -> np.ndarray:
    """Per-vertex standoff along the normal: tops rest on the shoulders (yoke_ease) and gain full ease by
    the chest; sleeves gain sleeve_ease a few cm down the arm."""
    if spec.slot != "top":
        return np.full(len(v), spec.ease)
    shoulder_z = 0.5 * (L.shoulder["l"][2] + L.shoulder["r"][2])
    arm = gg.smoothstep(0.3, 0.7, arm_w)
    torso_t = 1.0 - gg.smoothstep(L.chest_z, shoulder_z + 0.02, v[:, 2])
    sleeve_t = gg.smoothstep(0.0, 0.06, shoulder_z + 0.03 - v[:, 2])
    torso = spec.yoke_ease + (spec.ease - spec.yoke_ease) * torso_t
    sleeve = spec.yoke_ease + (spec.sleeve_ease - spec.yoke_ease) * sleeve_t
    return (1.0 - arm) * torso + arm * sleeve
