"""Fit shaping: how a garment stands off the body, per UNIQLO fit (pure numpy).

Fits were matched to UNIQLO's own product data and model photos (models 183-186 cm in M/L):
- SUPIMA Cotton T-Shirt: "regular fit, not oversized"; hem ~8 cm below the belt; sleeve mid upper arm.
- U Crew Neck T-Shirt: heavyweight, visibly boxier body, wider and longer sleeves toward the elbow.
- Cashmere / Milano sweaters: regular crew; ribbed hem band at the hip; roomy forearm into a wrist cuff.
- Ultra Stretch Pants: "regular, tapered"; relaxed thigh tapering to an ankle-length hem.
- Barrel Jeans: "loose, high rise, barrel"; leg curves outward with volume at the knee, tapers at hem.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import ConvexHull

import garment_geom as gg

TWO_PI = 2 * np.pi
MIDLINE_CLEARANCE = 0.006   # pant legs never cross x = 0
CROTCH_BRIDGE = 0.08        # below the crotch seam, fabric hangs straight instead of following a thigh gap


@dataclass(frozen=True)
class Fit:
    name: str                       # "base" or a morph target name, e.g. "fit_boxy"
    chest_ease_cm: float = 0.0      # garment chest circumference minus body chest
    drape: float = 0.0              # 0 = follows the waist, 1 = hangs straight from the chest
    hem_flare: float = 0.0          # extra circumference at the hem vs the chest hang (gravity folds it)
    sleeve_flare_r: float = 0.0     # open tee sleeve radius around the upper arm (m)
    sleeve_stretch: float = 1.0     # sleeve length multiplier (tee sleeve slides further down the arm)
    forearm_ease: float = 0.0       # knit sleeve stands this far off the (inflated) forearm (m)
    thigh_extra: float = 0.0        # pants: extra radius at the top of the thigh (m)
    leg_hem_r: float = 0.0          # pants: hem opening radius (m)
    leg_bulge: float = 0.0          # pants: extra radius peaking at mid leg (barrel)
    leg_outward: float = 0.0        # pants: mid-leg volume shifted to the outer side (barrel)


FITS = {
    "tee": (Fit("base", chest_ease_cm=10, drape=0.45, hem_flare=0.05, sleeve_flare_r=0.046),
            Fit("fit_boxy", chest_ease_cm=16, drape=0.9, hem_flare=0.07, sleeve_flare_r=0.056, sleeve_stretch=1.18)),
    "sweater": (Fit("base", chest_ease_cm=8, drape=0.35, hem_flare=0.04, forearm_ease=0.002),),
    "pants": (Fit("base", thigh_extra=0.010, leg_hem_r=0.052),
              Fit("fit_barrel", thigh_extra=0.018, leg_hem_r=0.070, leg_bulge=0.016, leg_outward=0.012)),
}

# UNIQLO item -> garment shape + fit morph weights (viewer sets these morph influences on the garment).
ITEM_FITS = {
    "E455365-000": {"shape": "tee", "morphs": {}, "fit": "Regular (SUPIMA)"},
    "E422992-000": {"shape": "tee", "morphs": {"fit_boxy": 1.0}, "fit": "Boxy heavyweight (Uniqlo U)"},
    "E453754-000": {"shape": "sweater", "morphs": {"fit_loose": 0.15}, "fit": "Regular, slightly roomier"},
    "E450543-000": {"shape": "sweater", "morphs": {}, "fit": "Regular"},
    "E475598-000": {"shape": "pants", "morphs": {}, "fit": "Regular, tapered"},
    "E479000-000": {"shape": "pants", "morphs": {"fit_barrel": 1.0}, "fit": "Loose barrel leg"},
}
# For pasted links: first rule whose regex matches the product name (case-insensitive) wins.
NAME_RULES = [
    {"match": "barrel|wide|baggy|balloon|curved|loose", "morphs": {"fit_barrel": 1.0}},
    {"match": "oversized|boxy|heavyweight|uniqlo u|relaxed", "morphs": {"fit_boxy": 1.0}},
    {"match": "skinny|slim", "morphs": {"fit_tight": 0.5}},
]


def _per_side(v: np.ndarray, table: dict) -> np.ndarray:
    return np.where((v[:, 0] >= 0)[:, None], table["l"], table["r"])


def _perimeter(xy: np.ndarray) -> float:
    return float(ConvexHull(xy).area) if len(xy) >= 3 else 0.0


def ease_torso(v, arm_w, L, fit: Fit, inflate: float) -> np.ndarray:
    """Add chest ease (ramping in below the shoulders, so the top still hangs from them) and hang the
    body below the chest from the eased chest outline."""
    torso_w = 1.0 - gg.smoothstep(0.1, 0.4, arm_w)
    band = (arm_w < 0.2) & (np.abs(v[:, 2] - L.chest_z) < 0.015)
    cy = float(np.median(v[band, 1]))
    c_now = _perimeter(v[band, :2])
    c_body = c_now - TWO_PI * inflate
    scale = (c_body + fit.chest_ease_cm / 100.0) / max(c_now, 1e-6)
    d = v[:, :2] - np.array([0.0, cy])
    r = np.linalg.norm(d, axis=1)
    unit = d / np.maximum(r, 1e-9)[:, None]
    shoulder_z = L.shoulder["l"][2]
    ramp = 1.0 - gg.smoothstep(L.chest_z, shoulder_z, v[:, 2])
    r_eased = r * (1.0 + (scale - 1.0) * ramp)
    centre = np.array([0.0, cy])
    prof = gg.polar_profile(centre + (v[band, :2] - centre) * scale, centre)
    hang = gg.sample_profile(prof, d) * 0.98
    below = fit.drape * gg.smoothstep(0.0, 0.12, L.chest_z - v[:, 2])
    r_new = np.maximum(r_eased, r_eased + below * np.maximum(hang - r_eased, 0.0))
    out = v.copy()
    out[:, :2] = v[:, :2] + unit * ((r_new - r) * torso_w)[:, None]
    return out


def flare_hem(v, arm_w, L, hem_z: float, flare: float) -> np.ndarray:
    """Widen the torso toward the hem (radially about the torso axis), from 0 at the chest to `flare`
    (fraction of circumference) at the hem. Gravity can't hang that excess straight, so the cloth sim
    gathers it into soft vertical folds, the way a real tee hangs."""
    torso = 1.0 - gg.smoothstep(0.1, 0.4, arm_w)
    band = (arm_w < 0.2) & (np.abs(v[:, 2] - L.chest_z) < 0.03)
    cy = float(np.median(v[band, 1])) if band.any() else 0.0
    t = gg.smoothstep(0.0, 1.0, (L.chest_z - v[:, 2]) / max(L.chest_z - hem_z, 1e-6))
    out = v.copy()
    out[:, 0] = v[:, 0] * (1.0 + flare * t * torso)
    out[:, 1] = cy + (v[:, 1] - cy) * (1.0 + flare * t * torso)
    return out


def _arm_frame(v, L, a_tab, b_tab):
    a, b = _per_side(v, a_tab), _per_side(v, b_tab)
    seg = b - a
    length = np.linalg.norm(seg, axis=1, keepdims=True)
    axis = seg / length
    t = ((v - a) * axis).sum(1) / length[:, 0]
    return a, seg, axis, t


def flare_sleeves(v, arm_w, L, fit: Fit) -> np.ndarray:
    """Tee sleeves stand off the upper arm as an open tube; optionally longer (slid down the arm)."""
    a, seg, axis, t = _arm_frame(v, L, L.shoulder, L.elbow)
    out = v
    if fit.sleeve_stretch != 1.0:
        w = gg.smoothstep(0.3, 0.6, arm_w) * gg.smoothstep(0.0, 0.3, t)
        out = out + (axis * (np.clip(t, 0, None) * (fit.sleeve_stretch - 1.0) * w)[:, None]
                     * np.linalg.norm(seg, axis=1, keepdims=True))
        a, seg, axis, t = _arm_frame(out, L, L.shoulder, L.elbow)
    centre = a + np.clip(t, 0, 1)[:, None] * seg
    blend = gg.smoothstep(0.3, 0.7, arm_w) * gg.smoothstep(0.05, 0.35, t)
    return gg.push_radial(out, centre, axis, np.full(len(v), fit.sleeve_flare_r), blend)


def roomy_forearms(v, arm_w, L, fit: Fit) -> np.ndarray:
    """Knit sleeve: relaxed around the forearm, gathered into a fitted cuff at the wrist."""
    a, seg, axis, t = _arm_frame(v, L, L.elbow, L.wrist)
    centre = a + np.clip(t, 0, 1)[:, None] * seg
    d = v - centre
    r = np.linalg.norm(d - (d * axis).sum(1, keepdims=True) * axis, axis=1)
    mid = (arm_w > 0.6) & (t > 0.25) & (t < 0.6)
    target = (float(np.median(r[mid])) if mid.any() else 0.04) + fit.forearm_ease   # relative to this arm
    cuff = 1.0 - gg.smoothstep(0.72, 0.86, t)
    blend = gg.smoothstep(0.4, 0.8, arm_w) * gg.smoothstep(0.0, 0.25, t) * cuff   # elbow left alone
    return gg.push_radial(v, centre, axis, np.full(len(v), target), blend)


def close_crotch(v: np.ndarray, L) -> np.ndarray:
    """Pull the inner-leg fabric just below the crotch toward the midline: real pants bridge the thigh
    gap from the crotch seam down, rather than following it (which shows a see-through hole)."""
    below = L.crotch_z - v[:, 2]
    w = (1.0 - gg.smoothstep(0.0, CROTCH_BRIDGE, below)) * (below > -0.01)
    ax = np.abs(v[:, 0])
    w *= 1.0 - gg.smoothstep(0.015, 0.05, ax)              # only the inner faces of the legs
    out = v.copy()
    out[:, 0] = np.sign(v[:, 0]) * (ax + w * (MIDLINE_CLEARANCE - ax).clip(max=0.0))
    return out


def drape_legs(v, L, fit: Fit, hem_z: float) -> np.ndarray:
    """Pant legs from the thigh at the crotch down to the hem: taper, plus an optional barrel bulge."""
    z_top = L.crotch_z - 0.03
    out = v.copy()
    for s, sign in (("l", 1.0), ("r", -1.0)):
        sel = (sign * v[:, 0] > 0) & (v[:, 2] < z_top)
        hj, an = L.hip_joint[s], L.ankle[s]
        z = v[sel, 2]
        t = np.clip((hj[2] - z) / (hj[2] - an[2]), 0, 1)[:, None]
        centre = hj + t * (an - hj)   # straight hip->ankle axis: no kink at the knee
        centre[:, 2] = z
        s_lin = np.clip((z_top - z) / (z_top - hem_z), 0, 1)
        bow = 4 * s_lin * (1 - s_lin)
        centre[:, 0] += sign * fit.leg_outward * bow
        ring = np.abs(z - (z_top - 0.015)) < 0.015
        d = v[sel][ring, :2] - centre[ring, :2]
        r_top = float(np.percentile(np.linalg.norm(d, axis=1), 80)) if ring.any() else fit.leg_hem_r
        r_top += fit.thigh_extra
        target = r_top + s_lin * (fit.leg_hem_r - r_top) + fit.leg_bulge * bow
        blend = gg.smoothstep(0.0, 0.06, z_top - z)
        pushed = gg.push_radial(v[sel], centre, None, target, blend)
        pushed[:, 0] = sign * np.maximum(sign * pushed[:, 0], MIDLINE_CLEARANCE)
        out[sel] = pushed
    return out
