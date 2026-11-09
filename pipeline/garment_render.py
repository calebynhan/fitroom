"""Posed check renders: each garment on the mannequin from 4 angles (front, 3/4, side, back), in the viewer's
default pose, plus a couple of outfits. The model turns on its turntable; camera and lights stay put.
"""
from __future__ import annotations

import math
import os

import bpy
from mathutils import Vector

import poses
import render
from garment_body import BodyData

RES = (560, 900)
LENS_MM = 85.0
VIEWS = (("front", 0.0), ("three_quarter", -35.0), ("side", -90.0), ("back", 180.0))
DEFAULT_POSE = "pocket"     # the viewer's default (web/src/viewer/poses.ts)
COLORS = {"tee": (0.60, 0.61, 0.63), "sweater": (0.16, 0.23, 0.40), "pants": (0.42, 0.35, 0.25),
          "shoes": (0.07, 0.07, 0.075), "body": (0.80, 0.78, 0.74)}
ROUGHNESS = {"tee": 0.9, "sweater": 0.95, "pants": 0.85, "shoes": 0.55, "body": 0.55}

# (label, pose, {shape: {fit morph: weight}}); shoes are always on.
LOOKS = (
    ("supima_tee", DEFAULT_POSE, {"tee": {}}),
    ("u_crew_tee", DEFAULT_POSE, {"tee": {"fit_boxy": 1.0}}),
    ("cashmere_sweater", DEFAULT_POSE, {"sweater": {}}),
    ("ultra_stretch_pants", DEFAULT_POSE, {"pants": {}}),
    ("barrel_jeans", DEFAULT_POSE, {"pants": {"fit_barrel": 1.0}}),
    ("outfit_relaxed", "relaxed", {"tee": {}, "pants": {}}),
    ("outfit_walk", "walk", {"sweater": {}, "pants": {"fit_barrel": 1.0}}),
)


def _stage(height: float):
    scene = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = RES
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    cam = bpy.data.objects.get("turntable_cam")
    if cam is None:
        data = bpy.data.cameras.new("turntable_cam")
        data.lens = LENS_MM
        cam = bpy.data.objects.new("turntable_cam", data)
        scene.collection.objects.link(cam)
        dist = height * 2.7
        target = Vector((0.0, 0.0, height * 0.5))
        cam.location = Vector((0.0, -dist, height * 0.55))
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        render._add_light("tt_key", "AREA", (2.2, -3.2, 3.0), (52, 0, 35), 300, 2.0)
        render._add_light("tt_fill", "AREA", (-3.0, -2.2, 1.5), (72, 0, -55), 70, 4.0)
        render._add_light("tt_rim", "AREA", (0.5, 3.2, 2.8), (-58, 0, 175), 200, 2.5)
        render._setup_world(scene)
    scene.camera = cam


def _paint(objs: dict, body) -> None:
    for shape, obj in objs.items():
        obj.data.materials[0] = render.make_material(f"check_{shape}", COLORS[shape], ROUGHNESS[shape])
    body.data.materials.clear()
    body.data.materials.append(render.make_material("check_body", COLORS["body"], ROUGHNESS["body"]))


def _set_fit_morphs(obj, morphs: dict) -> None:
    if not obj.data.shape_keys:
        return
    for kb in obj.data.shape_keys.key_blocks:
        if kb.name.startswith("fit_"):
            kb.value = float(morphs.get(kb.name, 0.0))


def render_look(arm, body, bd: BodyData, objs: dict, look: tuple, out_dir: str, prefix: str) -> str:
    label, pose, outfit = look
    poses.apply(arm, body, pose, bd.proxy)
    for shape, obj in objs.items():
        obj.hide_render = shape != "shoes" and shape not in outfit
        _set_fit_morphs(obj, outfit.get(shape, {}))
    paths = []
    arm.rotation_mode = "XYZ"   # glTF import leaves objects in quaternion mode
    for view, az in VIEWS:
        arm.rotation_euler = (0.0, 0.0, math.radians(az))
        bpy.context.view_layer.update()
        path = os.path.join(out_dir, f"{prefix}{label}_{view}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    arm.rotation_euler = (0.0, 0.0, 0.0)
    sheet = render.tile_images(paths, len(paths), os.path.join(out_dir, f"{prefix}{label}.png"))
    for p in paths:
        os.remove(p)
    return sheet


SIZE_LOOKS = (("fit_tight", {"fit_tight": 1.0}), ("base", {}), ("fit_loose", {"fit_loose": 1.0}))


def render_sizes(arm, body, bd: BodyData, objs: dict, out_dir: str, prefix: str) -> str:
    """Front and side of tee + pants at fit_tight / base / fit_loose (a size down, the right size, a size up)."""
    poses.apply(arm, body, "relaxed", bd.proxy)
    for shape, obj in objs.items():
        obj.hide_render = shape not in ("tee", "pants", "shoes")
    paths = []
    arm.rotation_mode = "XYZ"
    for view, az in (("front", 0.0), ("side", -90.0)):
        arm.rotation_euler = (0.0, 0.0, math.radians(az))
        for label, morphs in SIZE_LOOKS:
            for shape in ("tee", "pants"):
                if shape in objs:
                    _set_fit_morphs(objs[shape], morphs)
            bpy.context.view_layer.update()
            path = os.path.join(out_dir, f"{prefix}sizes_{view}_{label}.png")
            bpy.context.scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            paths.append(path)
    arm.rotation_euler = (0.0, 0.0, 0.0)
    sheet = render.tile_images(paths, 3, os.path.join(out_dir, f"{prefix}sizes.png"))   # front row on top
    for p in paths:
        os.remove(p)
    return sheet


def render_checks(arm, body, bd: BodyData, objs: dict, out_dir: str, prefix: str = "") -> list:
    os.makedirs(out_dir, exist_ok=True)
    _stage(bd.landmarks.height)
    _paint(objs, body)
    sheets = [render_look(arm, body, bd, objs, look, out_dir, prefix)
              for look in LOOKS if set(look[2]) <= set(objs)]
    if {"tee", "pants"} <= set(objs):
        sheets.append(render_sizes(arm, body, bd, objs, out_dir, prefix))
    for obj in objs.values():
        _set_fit_morphs(obj, {})
        obj.hide_render = False
    poses.reset(arm)
    return sheets
