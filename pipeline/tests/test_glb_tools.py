"""Unit tests for the bpy-free GLB accessor decoding."""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import glb_tools  # noqa: E402


def build(blobs: list) -> tuple[list, bytes]:
    views, data = [], b""
    for blob in blobs:
        views.append({"byteOffset": len(data), "byteLength": len(blob)})
        data += blob
    return views, data


def test_dense_float_and_normalized_accessors():
    pos = np.arange(12, dtype="<f4").reshape(4, 3)
    w = np.array([[255, 0, 0, 0], [128, 127, 0, 0]], dtype="<u1")
    views, data = build([pos.tobytes(), w.tobytes()])
    doc = {"bufferViews": views, "accessors": [
        {"bufferView": 0, "componentType": 5126, "type": "VEC3", "count": 4},
        {"bufferView": 1, "componentType": 5121, "type": "VEC4", "count": 2, "normalized": True}]}
    assert np.allclose(glb_tools.accessor(doc, data, 0), pos)
    got = glb_tools.accessor(doc, data, 1)
    assert np.allclose(got[0], [1, 0, 0, 0]) and np.allclose(got[1].sum(), 1.0)


def test_sparse_accessor_without_buffer_view_is_zero_plus_substitutions():
    idx = np.array([1, 3], dtype="<u2")
    vals = np.array([[1, 2, 3], [4, 5, 6]], dtype="<f4")
    views, data = build([idx.tobytes(), vals.tobytes()])
    doc = {"bufferViews": views, "accessors": [{
        "componentType": 5126, "type": "VEC3", "count": 5,
        "sparse": {"count": 2, "indices": {"bufferView": 0, "componentType": 5123},
                   "values": {"bufferView": 1}}}]}
    got = glb_tools.accessor(doc, data, 0)
    assert got.shape == (5, 3)
    assert np.allclose(got[[0, 2, 4]], 0.0)
    assert np.allclose(got[1], [1, 2, 3]) and np.allclose(got[3], [4, 5, 6])
