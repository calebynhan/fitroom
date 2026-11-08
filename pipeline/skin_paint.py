"""Bake a person-like base-colour texture for the body (pure numpy, no new geometry).

Every texel is mapped back to its 3D point on the body (UV-space rasterisation), then coloured by
landmark-anchored rules: natural skin with soft tonal variation, short hair on the scalp, eyebrows,
painted eyes (sclera, iris, pupil, lash line) and lips. Rules use |x| so mirrored UVs stay correct.
Blender world: Z up, front = -Y.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage


@dataclass(frozen=True)
class Look:
    skin: tuple
    hair: tuple
    iris: tuple
    lips: tuple
    lip_strength: float
    hair_front: float       # hairline height above the eyes at the forehead (m)
    hair_side: float        # at the temples
    hair_back: float        # at the nape (negative = below the eyes)
    blush: float
    brow_thick: float = 0.006   # m
    brow_arch: float = 0.004    # m
    hair_volume: float = 0.0    # m of scalp displacement on top of the head (0 = painted only)


LOOKS = {
    # Male = Caleb (from his photo): near-black mop cut, bangs to the brows, sides over the ear tops,
    # light-medium warm skin, dark brown eyes, straight dark brows.
    "male": Look(skin=(0.851, 0.635, 0.518), hair=(0.114, 0.122, 0.141), iris=(0.18, 0.12, 0.08),
                 lips=(0.70, 0.45, 0.42), lip_strength=0.5, hair_front=0.021, hair_side=-0.010,
                 hair_back=-0.060, blush=0.05, brow_thick=0.0055, brow_arch=0.0015, hair_volume=0.018),
    "female": Look(skin=(0.90, 0.71, 0.60), hair=(0.12, 0.08, 0.06), iris=(0.30, 0.20, 0.13),
                   lips=(0.74, 0.38, 0.40), lip_strength=0.75, hair_front=0.046, hair_side=0.004,
                   hair_back=-0.085, blush=0.10, brow_thick=0.0042, brow_arch=0.0065),
}


def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _noise(p: np.ndarray, freq: float) -> np.ndarray:
    """Cheap deterministic 3D value-ish noise in [0, 1]."""
    s = np.sin(p[:, 0] * freq * 1.7 + 1.3) * np.sin(p[:, 1] * freq * 2.3 + 0.7) * np.sin(p[:, 2] * freq * 1.1 + 2.1)
    s += 0.5 * np.sin(p[:, 0] * freq * 3.9 + p[:, 2] * freq * 2.7)
    return 0.5 + 0.35 * s


def rasterise(uv_tri: np.ndarray, pos_tri: np.ndarray, res: int):
    """UV triangles (F,3,2) -> per-texel 3D position (res,res,3) and filled mask."""
    pos = np.zeros((res, res, 3))
    filled = np.zeros((res, res), dtype=bool)
    px = uv_tri * res - 0.5
    for t, p3 in zip(px, pos_tri):
        x0, y0 = np.floor(t.min(0)).astype(int)
        x1, y1 = np.ceil(t.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, res - 1), min(y1, res - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        q = np.stack([gx.ravel(), gy.ravel()], 1).astype(float)
        v0, v1 = t[1] - t[0], t[2] - t[0]
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        d = q - t[0]
        b1 = (d[:, 0] * v1[1] - v1[0] * d[:, 1]) / den
        b2 = (v0[0] * d[:, 1] - d[:, 0] * v0[1]) / den
        b0 = 1 - b1 - b2
        inside = (b0 >= -0.02) & (b1 >= -0.02) & (b2 >= -0.02)
        if not inside.any():
            continue
        bc = np.stack([b0, b1, b2], 1)[inside]
        xs, ys = gx.ravel()[inside], gy.ravel()[inside]
        pos[ys, xs] = bc @ p3
        filled[ys, xs] = True
    return pos, filled


def hair_weight(p: np.ndarray, eye_l: np.ndarray, look: Look) -> np.ndarray:
    """0..1 hair coverage. Hairline height varies with the angle around the head (front -> temple -> nape)."""
    x, y, z = np.abs(p[:, 0]), p[:, 1], p[:, 2]
    _, ey, ez = eye_l
    ang = np.arctan2(x, -(y - (ey + 0.085)))                           # 0 front, pi back
    t = ang / np.pi
    front_curve = np.sqrt(np.clip(np.cos(ang), 0, 1))                 # rounded forehead hairline, no peak
    line = np.where(t < 0.5, look.hair_side + (look.hair_front - look.hair_side) * front_curve,
                    look.hair_side + (look.hair_back - look.hair_side) * _smooth(0.5, 1.0, t))
    ear_top = min(ez + 0.003, ez + look.hair_side - 0.004)              # hair may cover the ear tops
    ear = (x > 0.055) & ((((y - (ey + 0.10)) / 0.032) ** 2 + ((z - (ear_top - 0.028)) / 0.028) ** 2) < 1.0)
    fringe = np.clip(1 - t / 0.3, 0, 1)                                 # break the bangs edge into tips
    tips = 0.0045 * fringe * (np.abs(np.sin(x * 260.0 + 0.6 * np.sin(x * 47.0))) ** 0.6)
    return _smooth(-0.0025, 0.003, z - (ez + line - tips)) * (z < ez + 0.2) * ~ear


def hair_displacement(p: np.ndarray, normals: np.ndarray, eye_l: np.ndarray, look: Look) -> np.ndarray:
    """Push the scalp out along its normals: full volume on top, thinner bangs/sides, soft at the hairline."""
    if look.hair_volume <= 0:
        return np.zeros_like(p)
    w = hair_weight(p, eye_l, look)
    ez = eye_l[2]
    top = _smooth(ez + 0.02, ez + 0.09, p[:, 2])                       # crown carries the volume
    thick = look.hair_volume * (0.55 + 0.45 * top) * _smooth(0.0, 0.6, w)
    ey = eye_l[1]
    ear = ((np.abs(p[:, 0]) > 0.058) & ((((p[:, 1] - (ey + 0.10)) / 0.036) ** 2
                                        + ((p[:, 2] - (ez - 0.012)) / 0.042) ** 2) < 1.0))
    thick *= ~ear                                                     # thin ear shells would spike
    return normals * thick[:, None]


def hair_colour(p: np.ndarray, eye_l: np.ndarray, look: Look) -> np.ndarray:
    """Strands radiating from the crown, a soft overhead sheen band and darker roots near the hairline."""
    _, ey, ez = eye_l
    crown = np.array([0.0, ey + 0.10, ez + 0.11])
    d = p - crown
    phi = np.arctan2(d[:, 0], -d[:, 1])                                 # azimuth around the crown
    wobble = 0.8 * np.sin(np.hypot(d[:, 0], d[:, 1]) * 90.0)
    jitter = 2.5 * _noise(p, 220.0) + 1.5 * _noise(p * 1.7, 520.0)      # irregular, not knit-like
    strands = (0.86 + 0.08 * np.sin(phi * 140.0 + wobble + jitter) + 0.06 * np.sin(phi * 61.0 + 2 * jitter)
               + 0.22 * (_noise(p, 1400.0) - 0.5))
    sheen = 0.55 * np.exp(-(((p[:, 2] - (ez + 0.085)) / 0.018) ** 2)) * (p[:, 1] < ey + 0.14)
    shade = np.clip(strands + sheen, 0.55, 1.9)
    return np.clip(np.array(look.hair)[None, :] * shade[:, None] + 0.03 * sheen[:, None], 0, 1)


def colour(p: np.ndarray, eye_l: np.ndarray, look: Look) -> np.ndarray:
    """RGB in [0,1] (linear-ish) for points p (n,3). eye_l = left eye joint (x>0)."""
    x, y, z = np.abs(p[:, 0]), p[:, 1], p[:, 2]
    ex, ey, ez = eye_l
    rgb = np.tile(np.array(look.skin), (len(p), 1))
    rgb *= (0.95 + 0.1 * _noise(p, 90.0))[:, None]                       # subtle skin variation
    face = (y < ey + 0.03) & (z > ez - 0.12) & (z < ez + 0.06)
    cheek = np.exp(-(((x - 0.045) / 0.02) ** 2 + ((z - (ez - 0.035)) / 0.018) ** 2)) * face
    rgb = rgb * (1 - look.blush * cheek[:, None]) + np.array([0.85, 0.45, 0.42]) * (look.blush * cheek)[:, None]

    hair_w = hair_weight(p, eye_l, look)
    rgb = rgb * (1 - hair_w[:, None]) + hair_colour(p, eye_l, look) * hair_w[:, None]

    # Eyebrows: arched band above each eye, tapering toward the tail.
    dx = x - ex
    arc = look.brow_arch * (1 - np.clip((dx - 0.004) / 0.022, -1, 1) ** 2)
    brow_lo = ez + 0.013 + arc
    brow_hi = brow_lo + look.brow_thick - 0.002 * np.clip(dx / 0.024, 0, 1)
    brow = (_smooth(-0.017, -0.012, dx) * (1 - _smooth(0.020, 0.027, dx)) * _smooth(-0.0012, 0.0012, z - brow_lo)
            * (1 - _smooth(-0.0012, 0.0012, z - brow_hi)) * (y < ey + 0.01))
    rgb = rgb * (1 - 0.85 * brow[:, None]) + np.array(look.hair) * (0.85 * brow)[:, None]

    # Eyes: almond opening with sclera, iris, pupil and a soft lash line.
    front = y < ey - 0.005
    dz = z - ez
    half_h = 0.0058 * np.clip(1 - (dx / 0.0135) ** 2, 0, 1)
    almond = (1 - _smooth(-0.0006, 0.0006, np.abs(dz) - half_h)) * front * (np.abs(dx) < 0.0135)
    r_iris = np.hypot(dx - 0.0005, dz)
    iris = 1 - _smooth(-0.0005, 0.0005, r_iris - 0.0056)
    pupil = 1 - _smooth(-0.0004, 0.0004, r_iris - 0.0022)
    eye_rgb = np.tile(np.array([0.93, 0.91, 0.88]), (len(p), 1))
    limbal = _smooth(0.0040, 0.0056, r_iris)[:, None]
    iris_rgb = np.array(look.iris) * (1 - 0.5 * limbal)
    eye_rgb = eye_rgb * (1 - iris[:, None]) + iris_rgb * iris[:, None]
    eye_rgb = eye_rgb * (1 - pupil[:, None]) + 0.03 * pupil[:, None]
    rgb = rgb * (1 - almond[:, None]) + eye_rgb * almond[:, None]
    lash = (np.exp(-((np.abs(dz) - half_h) / 0.0009) ** 2) * front * (np.abs(dx) < 0.0145)
            * (dz > -0.002))
    rgb = rgb * (1 - 0.8 * lash[:, None]) + 0.05 * (0.8 * lash)[:, None]

    # Lips: upper and lower lip around the mouth line, centre-weighted.
    mz = ez - 0.072
    lip_half_w = 0.024
    lip_x = np.clip(1 - (x / lip_half_w) ** 2, 0, 1)
    upper = (z > mz) & (z < mz + 0.007 * lip_x + 0.001)
    lower = (z <= mz) & (z > mz - 0.009 * lip_x - 0.001)
    lips = (upper | lower) * (y < ey - 0.01) * _smooth(0.0, 0.25, lip_x)
    lips = ndimage.uniform_filter1d(lips.astype(float), 1)
    rgb = rgb * (1 - look.lip_strength * lips[:, None]) + np.array(look.lips) * (look.lip_strength * lips)[:, None]
    return np.clip(rgb, 0, 1)


def bake(uv_tri, pos_tri, eye_l, look: Look, res: int = 2048) -> np.ndarray:
    """Return an (res, res, 4) float RGBA image (row 0 = bottom, Blender convention)."""
    pos, filled = rasterise(uv_tri, pos_tri, res)
    rgb = np.zeros((res, res, 3))
    rgb[filled] = colour(pos[filled], eye_l, look)
    idx = ndimage.distance_transform_edt(~filled, return_distances=False, return_indices=True)
    rgb = rgb[idx[0], idx[1]]                                           # bleed into UV gutters
    return np.concatenate([rgb, np.ones((res, res, 1))], axis=2)
