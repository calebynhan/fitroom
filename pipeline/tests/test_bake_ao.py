"""Unit tests for baked per-vertex ambient occlusion."""
from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import bake_ao  # noqa: E402


def test_hemisphere_is_unit_and_upward():
    d = bake_ao.hemisphere(64)
    assert np.allclose(np.linalg.norm(d, axis=1), 1.0)
    assert (d[:, 2] > 0).all()
    assert abs(d[:, 0].mean()) < 0.05 and abs(d[:, 1].mean()) < 0.05


def test_corner_is_darker_than_open_floor():
    floor = (np.array([[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], float), np.array([[0, 1, 2], [0, 2, 3]]))
    wall = (np.array([[0.05, -1, 0], [0.05, 1, 0], [0.05, 1, 1], [0.05, -1, 1]], float), np.array([[0, 1, 2], [0, 2, 3]]))
    pts = np.array([[0.04, 0.0, 0.0], [0.0, 0.0, 0.0], [-0.8, 0.0, 0.0]])   # 1 cm / 5 cm / far from the wall
    up = np.tile([0.0, 0.0, 1.0], (3, 1))
    ao = bake_ao.vertex_ao(pts, up, [floor, wall])
    assert ao[2] > 0.99                    # nothing within the AO radius
    assert ao[0] < ao[1] < ao[2]           # closer to the wall = darker
    assert ao[0] < 0.75
