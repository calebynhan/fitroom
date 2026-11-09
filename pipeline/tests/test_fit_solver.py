"""Unit tests for fit_model.json evaluation and the ANSUR estimate regression."""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fit_solver as fs  # noqa: E402


def toy_model() -> dict:
    zeros = [0.0] * 6
    return {
        "ref_height_cm": 178.0,
        "estimate": {f"{n}Cm": {"intercept": 10.0, "heightCm": 0.5, "weightKg": 0.1} for n in fs.INPUTS},
        "weights": {"intercept": [0.0, -0.5, 0, 0, 0, 0],
                    "coef": {"chestCm": [0.1, 0, 0, 0, 0, 0], "waistCm": [0, 0, 0.1, 0, 0, 0],
                             "hipsCm": zeros, "inseamCm": [0, 0, 0, 0, 0, 1.0]},
                    "quad": {f"{n}Cm": zeros for n in fs.INPUTS}, "quad_center": 90.0, "quad_scale": 10.0,
                    "min": [-3.0] * 6, "max": [3.0, 0.0, 3.0, 3.0, 3.0, 3.0]},
        "height": {"intercept_cm": 178.0, "per_weight_cm": zeros},
    }


def test_evaluate_normalises_girths_to_reference_height():
    w, scale = fs.evaluate(toy_model(), 178.0, 70.0, {"chest": 20.0, "waist": 10.0, "hips": 90.0, "inseam": 1.0})
    assert w[0] == pytest.approx(2.0) and w[2] == pytest.approx(1.0) and w[1] == pytest.approx(-0.5)
    assert scale == pytest.approx(1.0)
    w2, scale2 = fs.evaluate(toy_model(), 2 * 178.0, 70.0, {"chest": 40.0, "waist": 20.0, "hips": 90.0, "inseam": 2.0})
    assert np.allclose(w, w2) and scale2 == pytest.approx(2.0)   # same proportions, twice as tall


def test_evaluate_clamps_and_estimates_missing_inputs():
    model = toy_model()
    model["weights"]["coef"]["waistCm"] = [0, 0, 0.01, 0, 0, 0]
    w, _ = fs.evaluate(model, 178.0, 70.0, {"chest": 500.0, "waist": None, "hips": None, "inseam": None})
    assert w[0] == 3.0                                    # clamped to max
    assert w[2] == pytest.approx(0.01 * (10 + 0.5 * 178 + 0.1 * 70))   # waist estimated from height + weight
    assert w[5] == pytest.approx(3.0)                     # estimated inseam (106) -> clamped


def test_estimate_model_recovers_a_linear_relation():
    rng = np.random.default_rng(0)
    subjects = []
    for _ in range(300):
        h, kg = rng.uniform(160, 195), rng.uniform(55, 110)
        subjects.append(fs.Subject(height=h, weight=kg, chest=20 + 0.2 * h + 0.6 * kg, waist=0.9 * kg + 10,
                                   hips=0.3 * h + 0.4 * kg, inseam=0.47 * h))
    est = fs.estimate_model(subjects)
    assert est["chestCm"]["weightKg"] == pytest.approx(0.6, abs=1e-6)
    assert est["inseamCm"]["heightCm"] == pytest.approx(0.47, abs=1e-6)
    assert est["waistCm"]["r2"] == pytest.approx(1.0)


def test_evaluate_applies_centred_squares():
    model = toy_model()
    model["weights"]["quad"]["hipsCm"] = [0, 0, 0, 0.5, 0, 0]
    w, _ = fs.evaluate(model, 178.0, 70.0, {"chest": 0.0, "waist": 0.0, "hips": 110.0, "inseam": 0.0})
    assert w[3] == pytest.approx(0.5 * ((110 - 90) / 10) ** 2)


def test_features_append_centred_squares():
    f = fs.features(np.array([[90.0, 100.0, 80.0, 70.0]]))
    assert np.allclose(f, [[90, 100, 80, 70, 0, 1, 1, 4]])


def test_male_bounds_forbid_a_bust():
    lo, hi = fs.weight_bounds("male")
    assert hi[1] == 0.0 and lo[1] == -3.0
    assert fs.weight_bounds("female")[1][1] == 3.0


class _LinearHeightGeo:
    """Stand-in BodyGeometry: mesh height grows 2 cm per unit of body_0 and ignores the rest."""

    def coords(self, w):
        return np.array([[0, 0, 0.0], [0, 0, 1.78 + 0.02 * w[0]]])


def test_height_model_gives_constant_weights_zero_slope():
    rng = np.random.default_rng(3)
    w = rng.normal(size=(30, 6))
    w[:, 1] = -1.28                                   # fixed for men
    h0, per_w = fs.height_model(_LinearHeightGeo(), w)
    assert h0 == pytest.approx(178.0, abs=1e-6)
    assert per_w[0] == pytest.approx(2.0, abs=1e-6)
    assert per_w[1] == 0.0
