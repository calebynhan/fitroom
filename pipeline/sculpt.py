"""Idealised mannequin head/neck: smooth, landmark-driven deformation of the base mesh (pure numpy).

Statistical head components can't be steered reliably from slab measurements (the eye joint doesn't move
with them), so the face is sculpted directly with smooth falloffs anchored on the skeleton:
lean lower face, crisp jaw-neck line, slimmer neck; female adds a narrower jaw/chin, smaller nose and
a slightly smaller head (closer to the 1:8 head-to-height ideal).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class FaceStyle:
    neck_slim: float          # radial scale reduction of the neck (0.1 = 10% thinner)
    cheek_slim: float         # lower-face width reduction at mouth level
    jaw_slim: float           # jaw-angle width reduction (0 keeps a square male jaw)
    chin_forward: float       # m
    chin_narrow: float        # chin width reduction
    underchin_back: float     # m, pulls submental fullness back for a crisp jaw line
    nose_narrow: float
    head_scale: float         # uniform head scale about the neck top


STYLES = {
    "male": FaceStyle(neck_slim=0.08, cheek_slim=0.08, jaw_slim=0.0, chin_forward=0.003, chin_narrow=0.0,
                      underchin_back=0.008, nose_narrow=0.05, head_scale=0.98),
    "female": FaceStyle(neck_slim=0.16, cheek_slim=0.11, jaw_slim=0.12, chin_forward=0.001, chin_narrow=0.14,
                        underchin_back=0.007, nose_narrow=0.14, head_scale=0.93),
}


def _smooth(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _bump(x: np.ndarray, lo: float, peak: float, hi: float) -> np.ndarray:
    return _smooth(lo, peak, x) * (1.0 - _smooth(peak, hi, x))


def displacement(co: np.ndarray, eye: np.ndarray, neck: np.ndarray, style: FaceStyle) -> np.ndarray:
    """Per-vertex displacement (n, 3). eye = midpoint of eye joints, neck = c_neck joint (z up, front -Y)."""
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    ez, ey = eye[2], eye[1]
    ring = (np.abs(z - (neck[2] + 0.03)) < 0.012) & (np.abs(x) < 0.1)
    ncy = float(np.median(y[ring]))
    d = np.zeros_like(co)

    # Neck: radial slim between the shoulders and the jaw, only near the neck axis.
    r = np.hypot(x, y - ncy)
    w_neck = _bump(z, neck[2] - 0.06, neck[2] + 0.03, ez - 0.10) * (1.0 - _smooth(0.065, 0.10, r))
    d[:, 0] -= style.neck_slim * w_neck * x
    d[:, 1] -= style.neck_slim * w_neck * (y - ncy)

    face = 1.0 - _smooth(ey + 0.05, ey + 0.09, y)            # in front of the ears
    # Lower face: narrow toward the midline, strongest at mouth level.
    w_cheek = _bump(z, ez - 0.14, ez - 0.07, ez - 0.015) * face
    d[:, 0] -= style.cheek_slim * w_cheek * x
    # Jaw angle (behind the cheeks, below the ear).
    w_jaw = _bump(z, ez - 0.14, ez - 0.095, ez - 0.05) * _bump(y, ey + 0.0, ey + 0.05, ey + 0.10)
    d[:, 0] -= style.jaw_slim * w_jaw * x
    # Chin: narrower and/or projected.
    chin = _bump(z, ez - 0.145, ez - 0.11, ez - 0.075) * (1.0 - _smooth(0.02, 0.05, np.abs(x))) * face
    d[:, 0] -= style.chin_narrow * chin * x
    d[:, 1] -= style.chin_forward * chin
    # Under-chin: pull submental tissue back for a crisp jaw-neck line.
    sub = _bump(z, ez - 0.17, ez - 0.135, ez - 0.11) * (1.0 - _smooth(ncy - 0.04, ncy - 0.01, y))
    sub *= 1.0 - _smooth(0.03, 0.07, np.abs(x))
    d[:, 1] += style.underchin_back * sub
    # Nose: narrower alar base and bridge.
    nose = _bump(z, ez - 0.06, ez - 0.035, ez - 0.0) * (1.0 - _smooth(ey - 0.01, ey + 0.005, y))
    nose *= 1.0 - _smooth(0.02, 0.035, np.abs(x))
    d[:, 0] -= style.nose_narrow * nose * x

    # Whole head: scale about the top of the neck, fading out down the neck.
    pivot = np.array([0.0, ncy, ez - 0.13])
    w_head = _smooth(ez - 0.17, ez - 0.11, z)
    d += (style.head_scale - 1.0) * w_head[:, None] * ((co + d) - pivot)
    return d
