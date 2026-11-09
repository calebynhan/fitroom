"""Tape-measure style body measurements on a mesh, pure numpy/scipy.

Circumference = convex-hull perimeter of the torso cross-section (a tape bridges concavities).
Arms are excluded by skin weight so they never enter the chest slice.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares
from scipy.spatial import ConvexHull

# Landmark search bands as fractions of standing height (z up, feet at min z).
CHEST_BAND = (0.70, 0.745)
WAIST_BAND = (0.60, 0.70)
HIPS_BAND = (0.47, 0.56)
UNDERBUST_BAND = (0.665, 0.695)  # just below the bust (female fit only)
BAND_SAMPLES = 17
ARM_WEIGHT_CUTOFF = 0.15
REGULARISATION = 0.15  # cm-equivalent penalty per unit of PCA weight


@dataclass(frozen=True)
class BodyGeometry:
    base: np.ndarray        # (n, 3) metres, z up
    deltas: np.ndarray      # (k, n, 3) morph deltas, metres
    edges: np.ndarray       # (e, 2)
    torso_edge: np.ndarray  # (e,) bool, both endpoints off the arms
    torso_v: np.ndarray     # (n,) bool, vert off the arms

    def coords(self, weights: np.ndarray) -> np.ndarray:
        return self.base + np.tensordot(weights, self.deltas, axes=1)


def make_geometry(base, deltas, edges, arm_w) -> BodyGeometry:
    torso_v = arm_w < ARM_WEIGHT_CUTOFF
    torso_e = torso_v[edges[:, 0]] & torso_v[edges[:, 1]]
    return BodyGeometry(base, deltas, edges, torso_e, torso_v)


def slice_perimeter(co: np.ndarray, edges: np.ndarray, z0: float) -> float:
    za, zb = co[edges[:, 0], 2], co[edges[:, 1], 2]
    cross = (za - z0) * (zb - z0) < 0
    if cross.sum() < 3:
        return 0.0
    a, b = co[edges[cross, 0]], co[edges[cross, 1]]
    t = ((z0 - a[:, 2]) / (b[:, 2] - a[:, 2]))[:, None]
    pts = (a + t * (b - a))[:, :2]
    return float(ConvexHull(pts).area)  # 2D hull: .area is the perimeter


def _band(co, edges, z_min, height, band, pick):
    zs = z_min + height * np.linspace(band[0], band[1], BAND_SAMPLES)
    za, zb = co[edges[:, 0], 2], co[edges[:, 1], 2]
    near = (np.minimum(za, zb) <= zs[-1]) & (np.maximum(za, zb) >= zs[0])   # edges that can cross the band
    vals = np.array([slice_perimeter(co, edges[near], z) for z in zs])
    i = int(pick(vals))
    return vals[i], zs[i]


def measure(co: np.ndarray, geo: BodyGeometry, target_height_m: float) -> dict:
    """Measurements in cm after uniform scaling to target height."""
    z_min, z_max = co[:, 2].min(), co[:, 2].max()
    height = z_max - z_min
    s = target_height_m / height
    edges = geo.edges[geo.torso_edge]
    chest, zc = _band(co, edges, z_min, height, CHEST_BAND, np.argmax)
    waist, zw = _band(co, edges, z_min, height, WAIST_BAND, np.argmin)
    hips, zh = _band(co, edges, z_min, height, HIPS_BAND, np.argmax)
    underbust, _ = _band(co, edges, z_min, height, UNDERBUST_BAND, np.argmin)
    shape = shape_features(co, geo, z_min, height)
    centre = np.abs(co[:, 0]) < 0.004
    crotch = co[centre & (co[:, 2] > z_min + 0.35 * height) & (co[:, 2] < z_min + 0.6 * height), 2]
    inseam = (crotch.min() - z_min) if crotch.size else np.nan
    return {
        "height": height * s * 100,
        "chest": chest * s * 100,
        "waist": waist * s * 100,
        "hips": hips * s * 100,
        "underbust": underbust * s * 100,
        **{k: v * s * 100 for k, v in shape.items()},
        "inseam": inseam * s * 100,
        "z_chest": (zc - z_min) / height,
        "z_waist": (zw - z_min) / height,
        "z_hips": (zh - z_min) / height,
    }


def shape_features(co: np.ndarray, geo: BodyGeometry, z_min: float, height: float) -> dict:
    """Silhouette widths (m): bideltoid shoulder width, hip width, and bust projection over the underbust."""
    z = (co[:, 2] - z_min) / height
    sh = (np.abs(z - 0.815) < 0.008) & (np.abs(co[:, 0]) < 0.30)
    hp = (np.abs(z - 0.51) < 0.01) & geo.torso_v
    side = (np.abs(co[:, 0]) > 0.03) & (np.abs(co[:, 0]) < 0.12) & geo.torso_v
    bust_front = co[side & (np.abs(z - 0.725) < 0.012), 1].min()
    under_front = co[side & (np.abs(z - 0.68) < 0.008), 1].min()
    return {
        "shoulder_width": float(np.ptp(co[sh, 0])),
        "hip_width": float(np.ptp(co[hp, 0])),
        "bust_projection": float(under_front - bust_front),
    }


def fit_weights(geo: BodyGeometry, target: dict, target_height_m: float, bound: float = 3.0):
    """Fit all morphs in geo to the target measurements present in `target` (cm)."""
    keys = tuple(n for n in ("chest", "underbust", "waist", "hips", "shoulder_width", "hip_width",
                             "bust_projection") if n in target)
    k = geo.deltas.shape[0]

    def residual(w):
        m = measure(geo.coords(w), geo, target_height_m)
        return np.concatenate([[m[n] - target[n] for n in keys], REGULARISATION * w])

    res = least_squares(residual, np.zeros(k), bounds=(-bound, bound), diff_step=0.05)
    return res.x, measure(geo.coords(res.x), geo, target_height_m)


def jacobian(geo: BodyGeometry, weights: np.ndarray, target_height_m: float, step: float = 0.25):
    """d(measurement cm)/d(weight) around `weights`, central differences."""
    keys = ("chest", "waist", "hips")
    cols = []
    for i in range(len(weights)):
        e = np.zeros_like(weights)
        e[i] = step
        hi = measure(geo.coords(weights + e), geo, target_height_m)
        lo = measure(geo.coords(weights - e), geo, target_height_m)
        cols.append([(hi[n] - lo[n]) / (2 * step) for n in keys])
    return {n: [round(c[j], 4) for c in cols] for j, n in enumerate(keys)}
