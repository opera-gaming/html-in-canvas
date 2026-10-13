# Copyright 2026, Opera Norway AS
# SPDX-License-Identifier: Apache-2.0
"""Headless Blender export to public/models/room.glb + lights.json.

Usage:
  Blender -b blender/Scene_isometric.blend --python tools/export.py -- public/models/room.glb

Renames screen meshes to Screen_<id>, drops leftovers, moves lights into lights.json (only Dyn_* once
public/lightmaps/manifest.json is non-empty), downsizes large images and exports cameras + animations.
Never saves the .blend.
"""
import bpy, json, os, sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_glb = os.path.abspath(argv[0] if argv else "public/models/room.glb")
here = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(here, "export_config.json")))

# 1. Rename screens
for src, dst in cfg["rename"].items():
    o = bpy.data.objects.get(src)
    if o is None:
        print(f"[export] WARN rename source not found: {src}")
        continue
    o.name = dst

# 2. Drop leftovers
for cname in cfg.get("drop_collections", []):
    c = bpy.data.collections.get(cname)
    if c:
        for o in list(c.all_objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(c)
for oname in cfg.get("drop_objects", []):
    o = bpy.data.objects.get(oname)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)

# 2a. Nudge objects by a world-space offset (Blender coordinates, metres) to break
#     coplanar overlaps that z-fight in the browser, e.g. skirting boards meeting in a corner.
for oname, off in cfg.get("nudge", {}).items():
    o = bpy.data.objects.get(oname)
    if o is None:
        print(f"[export] WARN nudge target not found: {oname}")
        continue
    o.matrix_world.translation += Vector(off)
    print(f"[export] nudged {oname} by {off}")

# 2b. Drop images with no pixel data: the exporter would emit sourceless textures, which crash
#     GLTFLoader. Base-colour uses fall back to mid grey instead of the BSDF's white default.
def neutralise_base_colour_uses(img):
    for mat in bpy.data.materials:
        if not mat.use_nodes or mat.node_tree is None:
            continue
        tree = mat.node_tree
        for node in tree.nodes:
            if node.type != "TEX_IMAGE" or node.image != img:
                continue
            color_out = node.outputs.get("Color")
            if color_out is None:
                continue
            for link in list(color_out.links):
                to = link.to_socket
                if link.to_node.type == "BSDF_PRINCIPLED" and to.name == "Base Color":
                    tree.links.remove(link)
                    to.default_value = (0.5, 0.5, 0.5, 1.0)
                    print(f"[export] WARN {mat.name}: base colour texture {img.name} missing, using grey")

for img in list(bpy.data.images):
    if img.type != "IMAGE" or img.packed_file is not None:
        continue
    if img.size[0] == 0 or img.size[1] == 0:
        neutralise_base_colour_uses(img)
        print(f"[export] dropping image with no data: {img.name}")
        bpy.data.images.remove(img)

# 3. All lights → lights.json (three.js coords: Blender (x, y, z) → (x, z, -y)), then remove every
#    light object from the GLB. `dynamic` marks Dyn_* lights, which the runtime also animates.
Z_TO_Y = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
dyn = []
for o in list(bpy.data.objects):
    if o.type != "LIGHT":
        continue
    m = Z_TO_Y @ o.matrix_world
    loc, rot, _ = m.decompose()
    L = o.data
    entry = {
        "name": o.name, "type": L.type, "dynamic": o.name.startswith("Dyn_"),
        "position": [round(v, 4) for v in loc],
        "quaternion": [round(rot.x, 5), round(rot.y, 5), round(rot.z, 5), round(rot.w, 5)],
        "color": [round(c, 4) for c in L.color], "energy": L.energy,
    }
    if L.type == "AREA":
        entry["size"] = [L.size, L.size_y if L.shape in ("RECTANGLE", "ELLIPSE") else L.size]
    if L.type == "SPOT":
        entry["spotAngle"] = L.spot_size
    dyn.append(entry)
    bpy.data.objects.remove(o, do_unlink=True)
lights_path = os.path.join(os.path.dirname(out_glb), "lights.json")
os.makedirs(os.path.dirname(out_glb), exist_ok=True)
# Once lightmaps are baked (non-empty manifest), static lighting lives in the lightmaps:
# only Dyn_* lights stay real-time. Without a bake, keep every light so the room is still lit.
manifest_path = os.path.join(here, "..", "public", "lightmaps", "manifest.json")
try:
    baked = bool(json.load(open(manifest_path)))
except (OSError, ValueError):
    baked = False
if baked:
    dyn = [d for d in dyn if d["dynamic"]]
    print("[export] baked: static lights omitted")
json.dump(dyn, open(lights_path, "w"), indent=1)

# 4. Downsize big images
mx = cfg.get("max_texture_size", 2048)
for img in bpy.data.images:
    w, h = img.size
    if w > mx or h > mx:
        s = mx / max(w, h)
        img.scale(int(w * s), int(h * s))

# 5. Report
screens = sorted(o.name for o in bpy.data.objects if o.name.lower().startswith("screen_"))
cams = sorted(o.name for o in bpy.data.objects if o.type == "CAMERA" and o.name.startswith("Cam_"))
print(f"[export] screens: {screens}")
print(f"[export] camera paths: {cams}")
print(f"[export] lights: {len(dyn)} total, {sum(1 for d in dyn if d['dynamic'])} dynamic")

# 6. Export
bpy.ops.export_scene.gltf(
    filepath=out_glb, export_format="GLB", export_apply=True, export_yup=True,
    export_cameras=True, export_lights=False, export_animations=True,
    export_image_format=cfg.get("image_format", "WEBP"), export_image_quality=cfg.get("image_quality", 80),
    use_renderable=True,
)
print(f"[export] wrote {out_glb} ({os.path.getsize(out_glb) // 1024 // 1024} MB) and {lights_path}")
