"""Fit web/public/models/fit_model.json: measurements -> body_0..body_5 + scale, from ANSUR II bodies.

1. Regress chest/waist/hips/inseam on height + weight over all ANSUR II subjects (the onboarding estimate
   when a measurement is left blank).
2. Fit the linear map (reference-height measurements -> morph weights) so the tape-measured mesh matches
   TRAIN random subjects (fit_solver.fit_map), plus the mesh-height model behind `scale`.
3. Report chest/waist/hips/inseam error on CHECK held-out subjects (target <= 2 cm).

Usage (read the uncompressed build copy; web/public GLBs are meshopt-compressed):
    .venv/bin/python pipeline/fit_model.py --body assets/build/body.glb \
        --ansur <dir>/ANSUR_II_MALE_Public.csv --out web/public/models/fit_model.json
ANSUR II public data: https://www.openlab.psu.edu/ansur2/ (not committed).
"""
from __future__ import annotations

import argparse
import os
import sys

import json

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import body_measure as bm  # noqa: E402
import fit_solver as fs  # noqa: E402
import glb_tools  # noqa: E402

MORPH_COUNT = 6
ARM_TOKENS = ("uparm", "lowarm", "wrist", "pinky", "ring", "middle", "index", "thumb")

TRAIN = 200
CHECK = 20
SEED = 7


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--body", required=True)
    p.add_argument("--ansur", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--sex", default="male", choices=("male", "female"))
    p.add_argument("--ref-height", type=float, default=178.0, help="height the body GLB is exported at (cm)")
    p.add_argument("--train", type=int, default=TRAIN, help="ANSUR subjects solved to fit the linear map")
    p.add_argument("--check", type=int, default=CHECK, help="held-out ANSUR subjects for the error report")
    return p.parse_args()


def body_geometry(path: str) -> tuple[bm.BodyGeometry, np.ndarray]:
    """Basis, body_i deltas, edges and arm weight straight from the GLB (pure numpy, no Blender)."""
    m = glb_tools.read_skinned_mesh(path)
    names = [f"body_{i}" for i in range(MORPH_COUNT)]
    deltas = np.stack([m["targets"][n] for n in names])
    tris = m["triangles"]
    edges = np.unique(np.sort(np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]]), axis=1), axis=0)
    arm_joint = np.array([any(t in n for t in ARM_TOKENS) for n in m["joint_names"]])
    arm_w = (m["weights"] * arm_joint[m["joints"]]).sum(axis=1)
    default = np.array([m["default_weights"][n] for n in names])
    return bm.make_geometry(m["positions"], deltas, edges, arm_w), default


def build_model(args, geo, default, subjects) -> tuple[dict, list]:
    rng = np.random.default_rng(SEED)
    order = rng.permutation(len(subjects))
    train = [subjects[i] for i in order[:args.train]]
    held_out = [subjects[i] for i in order[args.train:args.train + args.check]]
    targets = np.array([fs.at_reference(s, args.ref_height) for s in train])
    intercept, coef, history = fs.fit_map(geo, targets, default, args.ref_height / 100, args.sex)
    for i, err in enumerate(history):
        print(f"  round {i}: mean abs error (cm) " + ", ".join(f"{n} {e:.2f}" for n, e in zip(fs.INPUTS, err)))
    lo, hi = fs.weight_bounds(args.sex)
    h0, per_w = fs.height_model(geo, np.clip(intercept + fs.features(targets) @ coef, lo, hi))
    model = {
        "version": 1,
        "sex": args.sex,
        "ref_height_cm": args.ref_height,
        "inputs": ["heightCm", "weightKg", "chestCm", "waistCm", "hipsCm", "inseamCm"],
        "estimate": fs.estimate_model(subjects),
        "weights": {"intercept": [round(float(x), 5) for x in intercept],
                    "coef": {f"{n}Cm": [round(float(x), 6) for x in coef[i]] for i, n in enumerate(fs.INPUTS)},
                    "quad": {f"{n}Cm": [round(float(x), 6) for x in coef[4 + i]] for i, n in enumerate(fs.INPUTS)},
                    "quad_center": fs.QUAD_CENTER, "quad_scale": fs.QUAD_SCALE,
                    "min": lo.tolist(), "max": hi.tolist()},
        "height": {"intercept_cm": round(h0, 4), "per_weight_cm": [round(float(x), 5) for x in per_w]},
        "how_to": ("For each of chest/waist/hips/inseam: use the entered cm, else estimate = intercept + "
                   "heightCm*e.heightCm + weightKg*e.weightKg. Normalise x = cm * ref_height_cm / heightCm. "
                   "body_i = clamp(intercept[i] + sum_n (coef[n][i] * x_n + quad[n][i] * ((x_n - quad_center) / "
                   "quad_scale)^2), min[i], max[i]). "
                   "scale = heightCm / (height.intercept_cm + sum_i height.per_weight_cm[i] * body_i)."),
        "source": f"ANSUR II (2012) {args.sex} public data, Penn State OPEN Design Lab; slices per body_measure.py",
    }
    return model, held_out


def main() -> None:
    args = parse_args()
    subjects = fs.load_ansur(args.ansur)
    geo, default = body_geometry(args.body)
    model, held_out = build_model(args, geo, default, subjects)
    errs = fs.check(geo, model, held_out)
    model["validation"] = {
        "bodies": len(held_out),
        "mean_abs_cm": {n: round(float(np.abs(e).mean()), 2) for n, e in errs.items()},
        "max_abs_cm": {n: round(float(np.abs(e).max()), 2) for n, e in errs.items()},
    }
    tmp = f"{args.out}.tmp"
    with open(tmp, "w") as fh:
        json.dump(model, fh, indent=2, allow_nan=False)
    os.replace(tmp, args.out)
    print("estimate r2:", {k: v["r2"] for k, v in model["estimate"].items()})
    print("validation (cm):", model["validation"])
    print("wrote", args.out)


if __name__ == "__main__":
    main()
