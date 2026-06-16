from pathlib import Path
import math

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "quest-mr" / "assets"
OUTPUT_DIR = ROOT / "output"
ASSET_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

GLB_PATH = ASSET_DIR / "glass_demo.glb"
PREVIEW_PATH = ASSET_DIR / "glass_demo_preview.png"
BLEND_PATH = OUTPUT_DIR / "quest_mr_glass_demo.blend"


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def set_input(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return True
    return False


def find_node_by_type(nodes, node_type):
    for node in nodes:
        if node.type == node_type:
            return node
    return None


def make_principled_material(name, color, alpha, roughness=0.03, transmission=0.85):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color

    if hasattr(material, "blend_method"):
        material.blend_method = "BLEND"
    if hasattr(material, "use_screen_refraction"):
        material.use_screen_refraction = True
    if hasattr(material, "show_transparent_back"):
        material.show_transparent_back = True
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "BLENDED"

    bsdf = find_node_by_type(material.node_tree.nodes, "BSDF_PRINCIPLED")
    if bsdf:
        set_input(bsdf, ["Base Color"], color)
        set_input(bsdf, ["Alpha"], alpha)
        set_input(bsdf, ["Roughness"], roughness)
        set_input(bsdf, ["Metallic"], 0.0)
        set_input(bsdf, ["IOR"], 1.45)
        set_input(bsdf, ["Transmission Weight", "Transmission"], transmission)
        set_input(bsdf, ["Alpha"], alpha)
    return material


def make_metal_material(name, color, roughness=0.12):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    bsdf = find_node_by_type(material.node_tree.nodes, "BSDF_PRINCIPLED")
    if bsdf:
        set_input(bsdf, ["Base Color"], color)
        set_input(bsdf, ["Metallic"], 1.0)
        set_input(bsdf, ["Roughness"], roughness)
        set_input(bsdf, ["Alpha"], color[3])
        set_input(bsdf, ["Coat Weight"], 0.7)
        set_input(bsdf, ["Coat Roughness"], 0.06)
    return material


def make_emission_material(name, color, strength):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    nodes = material.node_tree.nodes
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = strength
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def shade_glass_object(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.shade_smooth()
    finally:
        obj.select_set(False)

    bevel = obj.modifiers.new("soft bevels", "BEVEL")
    bevel.width = 0.035
    bevel.segments = 4
    bevel.affect = "EDGES"

    weighted = obj.modifiers.new("weighted glass normals", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    return obj


def add_cube(name, location, rotation, scale, material):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return shade_glass_object(obj)


def add_torus(name, location, major_radius, minor_radius, material):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=96,
        minor_segments=10,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def add_ring(name, location, rotation, major_radius, minor_radius, material):
    obj = add_torus(name, location, major_radius, minor_radius, material)
    obj.rotation_euler = rotation
    return obj


def build_model():
    glass = make_principled_material(
        "Quest_Glass_Cyan",
        (0.58, 0.88, 1.0, 0.52),
        alpha=0.52,
        roughness=0.004,
        transmission=0.72,
    )

    model_objects = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=0.42, location=(0, 0, 0.54))
    sphere = bpy.context.object
    sphere.name = "hero_glass_sphere"
    sphere.scale = (1.0, 1.0, 1.0)
    sphere.data.materials.append(glass)
    shade_glass_object(sphere)
    model_objects.append(sphere)

    return model_objects


def setup_preview_scene():
    floor_mat = make_principled_material("matte_preview_floor", (0.08, 0.09, 0.1, 1.0), 1.0, 0.55, 0.0)
    bpy.ops.mesh.primitive_plane_add(size=3.5, location=(0, 0, -0.004))
    floor = bpy.context.object
    floor.name = "preview_floor"
    floor.data.materials.append(floor_mat)

    bpy.ops.object.light_add(type="AREA", location=(0, -2.5, 3.2))
    key = bpy.context.object
    key.name = "large_softbox"
    key.data.energy = 600
    key.data.size = 4.0

    bpy.ops.object.light_add(type="POINT", location=(-1.4, 1.2, 1.6))
    rim = bpy.context.object
    rim.name = "cyan_rim_light"
    rim.data.color = (0.1, 0.7, 1.0)
    rim.data.energy = 90

    bpy.ops.object.camera_add(location=(1.7, -2.2, 1.55), rotation=(math.radians(62), 0, math.radians(38)))
    camera = bpy.context.object
    bpy.context.scene.camera = camera
    direction = Vector((0, 0, 0.45)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 58

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 1100
    scene.render.film_transparent = False


def export_model(model_objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in model_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = model_objects[0]
    export_args = {
        "filepath": str(GLB_PATH),
        "export_format": "GLB",
        "export_apply": True,
        "export_materials": "EXPORT",
        "export_lights": False,
        "export_cameras": False,
    }
    try:
        bpy.ops.export_scene.gltf(**export_args, use_selection=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**export_args, export_selected=True)


def main():
    clear_scene()
    model_objects = build_model()
    export_model(model_objects)
    setup_preview_scene()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.context.scene.render.filepath = str(PREVIEW_PATH)
    bpy.ops.render.render(write_still=True)
    print(f"GLB exported: {GLB_PATH}")
    print(f"Preview rendered: {PREVIEW_PATH}")
    print(f"Blend saved: {BLEND_PATH}")


if __name__ == "__main__":
    main()
