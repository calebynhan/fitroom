"""Measurements -> MHR body morph weights, fitted on mesh slices (pure numpy/scipy, no bpy).

Girths are compared at the reference height: a body of stature H with chest C is the reference-height body
with chest C * ref / H, scaled by H / mesh_height. The browser evaluates a linear map
weights = clamp(intercept + coef . x + quad . ((x - 90) / 10)^2); it is fitted so the *tape-measured* mesh matches ANSUR II bodies:
evaluate the map on training targets, measure the meshes (body_measure.measure), take a regularised
Gauss-Newton step per body with a sampled Jacobian, refit the map, repeat.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass

import numpy as np

import body_measure as bm

GIRTHS = ("chest", "waist", "hips")
INPUTS = ("chest", "waist", "hips", "inseam")
# ANSUR II (2012) column -> our name; values in mm (weight in 0.1 kg)
ANSUR_COLS = {"stature": "stature", "weightkg": "weight", "chestcircumference": "chest",
              "waistcircumference": "waist", "buttockcircumference": "hips", "crotchheight": "inseam"}
INSEAM_WEIGHT = 0.1      # girths first: with one uniform scale, chasing inseam saturates PCs and costs girth accuracy
REGULARISATION = 0.15    # cm-equivalent cost per unit of morph weight (keeps solutions plausible)
WEIGHT_LIMIT = 3.0
QUAD_CENTER = 90.0       # cm: squared terms ((x - centre) / scale)^2 keep big and small bodies within 2 cm
QUAD_SCALE = 10.0


@dataclass(frozen=True)
class Subject:
    height: float   # cm
    weight: float   # kg
    chest: float    # cm
    waist: float
    hips: float
    inseam: float


def load_ansur(path: str) -> list[Subject]:
    with open(path, encoding="latin-1") as fh:
        rows = list(csv.DictReader(fh))
    out = []
    for r in rows:
        v = {name: float(r[col]) for col, name in ANSUR_COLS.items()}
        out.append(Subject(height=v["stature"] / 10, weight=v["weight"] / 10, chest=v["chest"] / 10,
                           waist=v["waist"] / 10, hips=v["hips"] / 10, inseam=v["inseam"] / 10))
    return out


def estimate_model(subjects: list[Subject]) -> dict:
    """Linear regression of each measurement on height (cm) and weight (kg), with its residual SD."""
    x = np.column_stack([np.ones(len(subjects)), [s.height for s in subjects], [s.weight for s in subjects]])
    model = {}
    for name in INPUTS:
        y = np.array([getattr(s, name) for s in subjects])
        coef, *_ = np.linalg.lstsq(x, y, rcond=None)
        resid = y - x @ coef
        model[f"{name}Cm"] = {"intercept": round(float(coef[0]), 4), "heightCm": round(float(coef[1]), 5),
                              "weightKg": round(float(coef[2]), 5), "sd_cm": round(float(resid.std()), 2),
                              "r2": round(float(1 - resid.var() / y.var()), 3)}
    return model


def at_reference(s: Subject, ref_cm: float) -> np.ndarray:
    """(chest, waist, hips, inseam) of the reference-height body with this subject's proportions."""
    k = ref_cm / s.height
    return np.array([s.chest, s.waist, s.hips, s.inseam]) * k


def weight_bounds(sex: str) -> tuple[np.ndarray, np.ndarray]:
    lo, hi = np.full(6, -WEIGHT_LIMIT), np.full(6, WEIGHT_LIMIT)
    if sex == "male":
        hi[1] = 0.0          # body_1 positive adds a bust (CLAUDE.md)
    return lo, hi


def measure_inputs(geo: bm.BodyGeometry, w: np.ndarray, ref_m: float) -> np.ndarray:
    m = bm.measure(geo.coords(w), geo, ref_m)
    out = np.array([m[n] for n in INPUTS])
    if not np.isfinite(out).all():
        raise RuntimeError(f"tape measurement failed at weights {np.round(w, 2)}: {dict(zip(INPUTS, out))}")
    return out


def sampled_jacobian(geo: bm.BodyGeometry, centre: np.ndarray, free: np.ndarray, ref_m: float,
                     samples: int = 48, sigma: float = 0.6, seed: int = 0) -> np.ndarray:
    """(4, n_free) d(inputs cm)/d(weight), least squares over random perturbations: a global slope that
    doesn't care that the tape slices pick the max/min of a band (finite differences would)."""
    rng = np.random.default_rng(seed)
    dw = rng.normal(0.0, sigma, (samples, free.sum()))
    m0 = measure_inputs(geo, centre, ref_m)
    dm = []
    for d in dw:
        w = centre.copy()
        w[free] += d
        dm.append(measure_inputs(geo, w, ref_m) - m0)
    sol, *_ = np.linalg.lstsq(dw, np.array(dm), rcond=None)
    return sol.T


def fit_map(geo: bm.BodyGeometry, targets: np.ndarray, default: np.ndarray, ref_m: float, sex: str,
            iters: int = 6) -> tuple[np.ndarray, np.ndarray, list]:
    """Map targets -> weights whose measured meshes match the targets. Returns (intercept (6,), coef (8, 6),
    per-iteration mean abs error (4,) in cm). body_1 stays at its default for men (no bust)."""
    lo, hi = weight_bounds(sex)
    free = np.ones(6, dtype=bool)
    if sex == "male":
        free[1] = False
    jac = sampled_jacobian(geo, default, free, ref_m)
    scale = np.array([1.0, 1.0, 1.0, INSEAM_WEIGHT])
    js = jac * scale[:, None]
    step = np.linalg.solve(js.T @ js + REGULARISATION ** 2 * np.eye(free.sum()), js.T)   # (n_free, 4)
    weights = np.tile(default, (len(targets), 1))
    history = []
    for _ in range(iters):
        measured = np.array([measure_inputs(geo, w, ref_m) for w in weights])
        err = measured - targets
        history.append(np.abs(err).mean(axis=0))
        weights[:, free] -= (err * scale) @ step.T
        weights = np.clip(weights, lo, hi)
        intercept, coef = fit_linear(targets, weights)
        weights = np.clip(intercept + features(targets) @ coef, lo, hi)   # next round judges the map itself
    return intercept, coef, history


def features(targets: np.ndarray) -> np.ndarray:
    """(n, 8): the four reference-height inputs, then their centred squares."""
    return np.column_stack([targets, ((targets - QUAD_CENTER) / QUAD_SCALE) ** 2])


def fit_linear(targets: np.ndarray, weights: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """weights ~ intercept + features(targets) @ coef (least squares). Returns (intercept (6,), coef (8, 6))."""
    x = np.column_stack([np.ones(len(targets)), features(targets)])
    sol, *_ = np.linalg.lstsq(x, weights, rcond=None)
    return sol[0], sol[1:]


def height_model(geo: bm.BodyGeometry, weights: np.ndarray) -> tuple[float, np.ndarray]:
    """Mesh height (cm) ~ intercept + weights @ per_weight. Weights that never vary in `weights` (body_1 for
    men) get slope 0, so the model can't blow up if a viewer moves them."""
    h = np.array([np.ptp(geo.coords(w)[:, 2]) * 100 for w in weights])
    varies = weights.std(axis=0) > 1e-6
    x = np.column_stack([np.ones(len(weights)), weights[:, varies]])
    sol, *_ = np.linalg.lstsq(x, h, rcond=None)
    per_w = np.zeros(weights.shape[1])
    per_w[varies] = sol[1:]
    return float(sol[0]), per_w


def evaluate(model: dict, height_cm: float, weight_kg: float, given: dict) -> tuple[np.ndarray, float]:
    """Reference evaluation of fit_model.json (the browser does the same). given: name -> cm or None.
    Returns (body weights (6,), scale)."""
    est = model["estimate"]
    vals = []
    for name in INPUTS:
        cm = given.get(name)
        if cm is None:
            e = est[f"{name}Cm"]
            cm = e["intercept"] + e["heightCm"] * height_cm + e["weightKg"] * weight_kg
        vals.append(cm * model["ref_height_cm"] / height_cm)
    wm = model["weights"]
    c, k = wm["quad_center"], wm["quad_scale"]
    w = np.array(wm["intercept"]) + sum(np.array(wm["coef"][f"{n}Cm"]) * v + np.array(wm["quad"][f"{n}Cm"]) * ((v - c) / k) ** 2
                                        for n, v in zip(INPUTS, vals))
    w = np.clip(w, wm["min"], wm["max"])
    hm = model["height"]
    scale = height_cm / (hm["intercept_cm"] + float(np.dot(hm["per_weight_cm"], w)))
    return w, scale


def check(geo: bm.BodyGeometry, model: dict, subjects: list[Subject]) -> dict:
    """Build each subject's body from the model and tape-measure it at their stature: error per girth (cm)."""
    errs = {n: [] for n in INPUTS}
    for s in subjects:
        w, scale = evaluate(model, s.height, s.weight, {n: getattr(s, n) for n in INPUTS})
        co = geo.coords(w)
        m = bm.measure(co, geo, np.ptp(co[:, 2]) * scale)
        for n in INPUTS:
            errs[n].append(m[n] - getattr(s, n))
    return {n: np.array(v) for n, v in errs.items()}
