"""Minimal GLB reader for post-export verification (no bpy)."""
from __future__ import annotations

import json
import struct

import numpy as np


def read_glb(path: str) -> tuple[dict, bytes]:
    with open(path, "rb") as f:
        data = f.read()
    json_len = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + json_len])
    return doc, data[20 + json_len + 8:]


def inverse_binds(path: str) -> dict[str, np.ndarray]:
    doc, binary = read_glb(path)
    skin = doc["skins"][0]
    acc = doc["accessors"][skin["inverseBindMatrices"]]
    view = doc["bufferViews"][acc["bufferView"]]
    offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    mats = np.frombuffer(binary, dtype="<f4", count=16 * acc["count"], offset=offset).reshape(-1, 4, 4)
    names = [doc["nodes"][i]["name"] for i in skin["joints"]]
    return dict(zip(names, mats))


def summary(path: str) -> dict:
    doc, _ = read_glb(path)
    mesh = doc["meshes"][0]
    joints = [doc["nodes"][i]["name"] for i in doc["skins"][0]["joints"]]
    pos = doc["accessors"][mesh["primitives"][0]["attributes"]["POSITION"]]
    return {
        "targets": mesh.get("extras", {}).get("targetNames"),
        "weights": [round(w, 3) for w in mesh.get("weights", [])],
        "joints": len(joints),
        "neutral_bone": "neutral_bone" in joints,
        "verts": pos["count"],
        "materials": [m["name"] for m in doc.get("materials", [])],
    }


def assert_same_bind(garment_glb: str, body_glb: str, tol: float = 1e-4) -> float:
    g, b = inverse_binds(garment_glb), inverse_binds(body_glb)
    missing = set(g) - set(b)
    if missing:
        raise RuntimeError(f"{garment_glb}: joints not in body skeleton: {sorted(missing)[:5]}")
    diff = max(float(np.abs(g[k] - b[k]).max()) for k in g)
    if diff > tol:
        raise RuntimeError(f"{garment_glb}: inverse bind matrices differ from body by {diff}")
    return diff
