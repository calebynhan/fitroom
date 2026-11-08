"""Front-view check renders: arms lowered, studio light, orthographic camera."""
from __future__ import annotations

import math

import bpy
from mathutils import Matrix, Vector

UPARM_DROP_DEG = 36.0
LOWARM_DROP_DEG = 14.0
RES = (768, 1152)
ENGINES = ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH")


def make_material(name: str, rgb: tuple[float, float, float], roughness: float = 0.6):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    mat.diffuse_color = (*rgb, 1.0)  # workbench fallback
    return mat


def _rotate_bone(arm: bpy.types.Object, name: str, axis: Vector, deg: float) -> None:
    pb = arm.pose.bones[name]
    head = pb.head.copy()
    rot = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = rot @ pb.matrix
    bpy.context.view_layer.update()


def lower_arms(arm: bpy.types.Object) -> None:
    """Swing both arms from the A-pose down toward the sides (armature space == world)."""
    for side, sign in (("l", 1.0), ("r", -1.0)):
        _rotate_bone(arm, f"{side}_uparm", Vector((0, 1, 0)), sign * UPARM_DROP_DEG)
        _rotate_bone(arm, f"{side}_lowarm", Vector((0, 1, 0)), sign * LOWARM_DROP_DEG)


def reset_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def _set_engine(scene) -> str:
    for eng in ENGINES:
        try:
            scene.render.engine = eng
            return eng
        except TypeError:
            continue
    raise RuntimeError("no render engine available")


def _setup_world(scene) -> None:
    world = bpy.data.worlds.new("studio")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.82, 0.83, 0.86, 1.0)
    bg.inputs["Strength"].default_value = 0.35
    scene.world = world


def _add_light(name, kind, loc, rot, energy, size=1.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    if kind == "AREA":
        data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    obj.rotation_euler = [math.radians(a) for a in rot]
    bpy.context.scene.collection.objects.link(obj)


def _setup_stage(scene, height: float) -> None:
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = height * 1.12
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0.0, -6.0, height * 0.5)
    cam.rotation_euler = (math.radians(90), 0.0, 0.0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    _add_light("key", "AREA", (1.8, -3.0, 2.6), (55, 0, 30), 260, 2.5)
    _add_light("fill", "AREA", (-2.5, -2.5, 1.4), (70, 0, -45), 90, 3.0)
    _add_light("rim", "AREA", (0.0, 3.0, 2.5), (-60, 0, 180), 160, 2.0)
    _setup_world(scene)


def render_front(path: str, height: float) -> str:
    scene = bpy.context.scene
    eng = _set_engine(scene)
    if eng == "BLENDER_WORKBENCH":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = RES
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    if scene.camera is None:
        _setup_stage(scene, height)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return eng
