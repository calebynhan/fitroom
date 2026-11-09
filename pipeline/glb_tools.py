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


def is_meshopt(path: str) -> bool:
    doc, _ = read_glb(path)
    return "EXT_meshopt_compression" in doc.get("extensionsUsed", [])


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


_DTYPES = {5120: "<i1", 5121: "<u1", 5122: "<i2", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _view(doc: dict, binary: bytes, view_index: int, offset: int, count: int, dtype, width: int) -> np.ndarray:
    view = doc["bufferViews"][view_index]
    start = view.get("byteOffset", 0) + offset
    stride = view.get("byteStride", dtype.itemsize * width)
    raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (count - 1) + dtype.itemsize * width, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(count, dtype.itemsize * width), strides=(stride, 1))
    return np.ascontiguousarray(rows).view(dtype).reshape(count, width)


def accessor(doc: dict, binary: bytes, index: int) -> np.ndarray:
    """Decode one accessor into an (count, width) float array: normalized ints scaled to 0..1, a missing
    bufferView read as zeros, and sparse substitutions applied (Blender writes sparse morph targets)."""
    acc = doc["accessors"][index]
    dtype = np.dtype(_DTYPES[acc["componentType"]])
    width = _WIDTH[acc["type"]]
    if "bufferView" in acc:
        out = _view(doc, binary, acc["bufferView"], acc.get("byteOffset", 0), acc["count"], dtype, width)
        out = out.astype(np.float64)
    else:
        out = np.zeros((acc["count"], width))
    sparse = acc.get("sparse")
    if sparse:
        ix, vals = sparse["indices"], sparse["values"]
        idx = _view(doc, binary, ix["bufferView"], ix.get("byteOffset", 0), sparse["count"],
                    np.dtype(_DTYPES[ix["componentType"]]), 1)[:, 0].astype(np.int64)
        out[idx] = _view(doc, binary, vals["bufferView"], vals.get("byteOffset", 0), sparse["count"], dtype, width)
    if acc.get("normalized"):
        out /= np.iinfo(dtype).max
    return out


def read_skinned_mesh(path: str) -> dict:
    """First mesh primitive of a GLB in Blender axes (Z up, front -Y): positions, triangles, morph deltas
    by name, default morph weights, skin joints/weights and joint names. No bpy needed."""
    doc, binary = read_glb(path)
    if "EXT_meshopt_compression" in doc.get("extensionsUsed", []):
        raise RuntimeError(f"{path} is meshopt-compressed; pass the uncompressed build copy (assets/build/)")
    mesh = doc["meshes"][0]
    prim = mesh["primitives"][0]
    to_z_up = lambda a: np.column_stack([a[:, 0], -a[:, 2], a[:, 1]])  # noqa: E731  glTF Y-up -> Blender
    pos = to_z_up(accessor(doc, binary, prim["attributes"]["POSITION"]))
    tris = accessor(doc, binary, prim["indices"]).astype(np.int64).reshape(-1, 3)
    names = mesh.get("extras", {}).get("targetNames", [])
    targets = {n: to_z_up(accessor(doc, binary, t["POSITION"])) for n, t in zip(names, prim.get("targets", []))}
    skin = doc["skins"][0]
    return {
        "positions": pos, "triangles": tris, "targets": targets,
        "default_weights": dict(zip(names, mesh.get("weights", [0.0] * len(names)))),
        "joints": accessor(doc, binary, prim["attributes"]["JOINTS_0"]).astype(np.int64),
        "weights": accessor(doc, binary, prim["attributes"]["WEIGHTS_0"]),
        "joint_names": [doc["nodes"][i]["name"] for i in skin["joints"]],
    }
