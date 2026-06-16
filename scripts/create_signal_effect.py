import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output"
OUT_DIR.mkdir(exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def make_material(name, color, emission=0.0, roughness=0.45):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    if emission >= 1.0:
        nodes.clear()
        out = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeEmission")
        shader.inputs["Color"].default_value = color
        shader.inputs["Strength"].default_value = emission
        mat.node_tree.links.new(shader.outputs["Emission"], out.inputs["Surface"])
        return mat
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = color
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def add_curve(name, points, mat, bevel_depth=0.035):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = 5
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (co[0], co[1], co[2], 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def add_torus(name, location, major_radius, minor_radius, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=160,
        minor_segments=14,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def add_sphere(name, location, radius, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def build_scene():
    clear_scene()

    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 140
    bpy.context.scene.frame_set(60)

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.color = (0.015, 0.017, 0.024)

    cyan = make_material("neon_cyan", (0.0, 0.85, 1.0, 1), emission=3.0)
    amber = make_material("warm_signal", (1.0, 0.42, 0.05, 1), emission=2.5)
    magenta = make_material("soft_magenta", (1.0, 0.05, 0.62, 1), emission=1.9)
    graphite = make_material("matte_graphite", (0.02, 0.022, 0.028, 1), emission=0.0)
    glass = make_material("dark_glass", (0.015, 0.045, 0.06, 0.65), emission=0.25, roughness=0.18)
    white = make_material("label_white", (0.86, 0.94, 1.0, 1), emission=1.1)

    bpy.ops.mesh.primitive_plane_add(size=13, location=(0, 0, -1.05))
    floor = bpy.context.object
    floor.name = "dark_reflective_floor"
    floor.data.materials.append(graphite)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.95))
    base = bpy.context.object
    base.name = "low_control_plinth"
    base.dimensions = (7.2, 4.4, 0.18)
    base.data.materials.append(glass)

    for i, radius in enumerate((1.1, 1.55, 2.05)):
        ring = add_torus(
            f"rotating_signal_ring_{i + 1}",
            (0, 0, 0.15 + i * 0.08),
            radius,
            0.018 + i * 0.004,
            cyan if i != 1 else magenta,
            rotation=(math.radians(80 - i * 17), math.radians(8 + i * 12), math.radians(i * 24)),
        )
        ring.keyframe_insert("rotation_euler", frame=1)
        ring.rotation_euler.z += math.radians(270 + i * 55)
        ring.rotation_euler.x += math.radians(30)
        ring.keyframe_insert("rotation_euler", frame=140)

    spiral_points = []
    for n in range(220):
        t = n / 219
        angle = t * math.tau * 4.2
        radius = 0.18 + 2.35 * t
        z = -0.5 + math.sin(t * math.pi) * 1.55
        spiral_points.append((math.cos(angle) * radius, math.sin(angle) * radius, z))
    spiral = add_curve("gold_signal_spiral", spiral_points, amber, bevel_depth=0.027)
    spiral.keyframe_insert("rotation_euler", frame=1)
    spiral.rotation_euler.z += math.tau
    spiral.keyframe_insert("rotation_euler", frame=140)

    for lane in range(7):
        y = -1.8 + lane * 0.6
        points = []
        for n in range(70):
            x = -3.2 + n * 0.095
            z = -0.72 + 0.05 * math.sin(n * 0.55 + lane * 0.8)
            points.append((x, y + 0.03 * math.sin(n * 0.24), z))
        add_curve(f"floor_trace_{lane + 1}", points, cyan if lane % 2 == 0 else amber, bevel_depth=0.012)

    for i in range(95):
        angle = i * 2.399963
        r = 0.35 + (i % 17) * 0.16
        z = -0.55 + ((i * 37) % 100) / 100 * 2.25
        mat = cyan if i % 3 else magenta if i % 5 else amber
        dot = add_sphere(
            f"noise_particle_{i + 1:02d}",
            (math.cos(angle) * r, math.sin(angle) * r, z),
            0.025 + (i % 4) * 0.006,
            mat,
        )
        dot.keyframe_insert("scale", frame=1)
        pulse = 1.0 + 0.55 * ((i % 6) / 5)
        dot.scale = (pulse, pulse, pulse)
        dot.keyframe_insert("scale", frame=70 + (i % 25))

    bpy.ops.object.text_add(location=(-2.95, -2.25, -0.42), rotation=(math.radians(76), 0, 0))
    text = bpy.context.object
    text.name = "caption_signal_noise"
    text.data.body = "CODEX + BLENDER"
    text.data.align_x = "LEFT"
    text.data.size = 0.22
    text.data.extrude = 0.012
    text.data.materials.append(white)

    bpy.ops.object.text_add(location=(1.35, 2.25, 0.18), rotation=(math.radians(69), 0, math.radians(-23)))
    label = bpy.context.object
    label.name = "caption_no_ui"
    label.data.body = "NO UI TOUCHES"
    label.data.align_x = "LEFT"
    label.data.size = 0.16
    label.data.extrude = 0.01
    label.data.materials.append(amber)

    bpy.ops.object.light_add(type="AREA", location=(0, -3.6, 4.6))
    key = bpy.context.object
    key.name = "large_softbox_key"
    key.data.energy = 560
    key.data.size = 5.5

    bpy.ops.object.light_add(type="POINT", location=(-2.3, 1.7, 1.2))
    rim = bpy.context.object
    rim.name = "cyan_rim_light"
    rim.data.color = (0.25, 0.95, 1.0)
    rim.data.energy = 260

    bpy.ops.object.camera_add(location=(4.7, -6.4, 3.25), rotation=(math.radians(60), 0, math.radians(38)))
    cam = bpy.context.object
    bpy.context.scene.camera = cam
    cam.data.lens = 34
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = 6.1
    cam.data.dof.aperture_fstop = 4.0

    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 72
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "High Contrast"
    bpy.context.scene.view_settings.exposure = -0.35
    bpy.context.scene.render.resolution_x = 1600
    bpy.context.scene.render.resolution_y = 1000
    if hasattr(bpy.context.scene, "eevee"):
        bpy.context.scene.eevee.taa_render_samples = 64


if __name__ == "__main__":
    build_scene()
    blend_path = OUT_DIR / "codex_blender_signal_effect.blend"
    png_path = OUT_DIR / "codex_blender_signal_effect.png"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.context.scene.render.filepath = str(png_path)
    bpy.ops.render.render(write_still=True)
    print(f"Saved {blend_path}")
    print(f"Saved {png_path}")
