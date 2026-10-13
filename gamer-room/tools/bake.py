# Copyright 2026, Opera Norway AS
# SPDX-License-Identifier: Apache-2.0
"""Headless Cycles lightmap bake.

Usage:
  Blender -b blender/Scene_isometric.blend --python tools/bake.py -- public/lightmaps [--atlas-size 2048]
      [--samples 128] [--intensity 2.0] [--quick] [--no-denoise] [--kernel-opt FULL|INTERSECT|OFF]

Unwraps every static mesh onto a new `Lightmap` UV layer (UV index 1), packs each group into one atlas,
bakes Cycles DIFFUSE direct+indirect (lighting only, no albedo), writes <out>/LM_<group>.png and
<out>/manifest.json ({object: {file, intensity}}) and SAVES the .blend so the exporter emits TEXCOORD_1.
The .blend is changed permanently (single-user mesh data, flipped inside-out meshes, applied
topology-changing modifiers, Lightmap UVs); keep a backup.

PNGs are saved at view exposure -1 for 8-bit headroom; manifest intensity 2.0 undoes it at runtime.
--quick bakes only the ROOM collection at 512 px / 16 samples into public/lightmaps-quick/ and does not
save the .blend.
"""
import bpy, collections, json, math, os, sys, time

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_dir = "public/lightmaps"
atlas_size, samples, quick, intensity, no_denoise, kernel_opt = None, None, False, 2.0, False, "FULL"
i = 0
while i < len(argv):
    a = argv[i]
    if a == "--atlas-size":
        atlas_size = int(argv[i + 1]); i += 2; continue
    if a == "--samples":
        samples = int(argv[i + 1]); i += 2; continue
    if a == "--intensity":
        intensity = float(argv[i + 1]); i += 2; continue
    if a == "--no-denoise":
        no_denoise = True; i += 1; continue
    if a == "--kernel-opt":
        kernel_opt = argv[i + 1].upper(); i += 2; continue
    if a == "--quick":
        quick = True; i += 1; continue
    out_dir = a; i += 1
atlas_size = atlas_size or (512 if quick else 2048)
samples = samples or (16 if quick else 128)
out_dir = os.path.abspath(out_dir)
if quick and os.path.basename(out_dir) == "lightmaps":
    out_dir += "-quick"  # never overwrite the committed full bake
os.makedirs(out_dir, exist_ok=True)

here = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(os.path.join(here, "export_config.json")))
scene = bpy.context.scene
view_layer = bpy.context.view_layer
LM = "Lightmap"
DIFFUSE_AID = 0.02  # albedo of the temporary diffuse lobe (see 5c'); small so bounce barely changes
SAFE_MODIFIERS = {"WEIGHTED_NORMAL"}  # plus "Smooth by Angle" geometry nodes (topology-preserving)
T0 = time.time()


def log(msg):
    print(f"[bake] {msg}", flush=True)


# ---------------------------------------------------------------- 1. render settings
saved = {
    "engine": scene.render.engine,
    "device": scene.cycles.device,
    "samples": scene.cycles.samples,
    "persistent": scene.render.use_persistent_data,
    "view_transform": scene.view_settings.view_transform,
    "look": scene.view_settings.look,
    "exposure": scene.view_settings.exposure,
    "gamma": scene.view_settings.gamma,
}
scene.render.engine = "CYCLES"
device = "CPU"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    # Specialised kernels compile in the background on first use; use --kernel-opt OFF if that crashes.
    if hasattr(prefs, "kernel_optimization_level"):
        prefs.kernel_optimization_level = kernel_opt
        log(f"Metal kernel optimisation: {kernel_opt}")
    gpus = [d for d in prefs.devices if d.type == "METAL"]
    # GPU only: adding the CPU as a second device makes the GPU wait on the slower CPU tiles.
    for d in prefs.devices:
        d.use = d.type == "METAL"
    if gpus:
        device = "GPU"
        log(f"Metal devices: {[d.name for d in gpus]}")
except Exception as e:  # noqa: BLE001
    log(f"WARN Metal unavailable ({e}), baking on CPU")
if device == "CPU":
    log("WARN no Metal GPU found, baking on CPU")
scene.cycles.device = device
scene.cycles.samples = samples
scene.render.use_persistent_data = True  # avoid re-syncing the scene for every baked object
bake = scene.render.bake
bake.margin = max(4, atlas_size // 128)  # 16 px at 2048
bake.use_pass_direct = True
bake.use_pass_indirect = True
bake.use_pass_color = False
bake.use_selected_to_active = False
bake.target = "IMAGE_TEXTURES"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = -1.0  # headroom; undone by manifest intensity 2.0
scene.view_settings.gamma = 1.0
img_settings = scene.render.image_settings
img_settings.file_format = "PNG"
img_settings.color_mode = "RGB"
img_settings.color_depth = "8"
log(f"device={device} atlas={atlas_size} samples={samples} intensity={intensity} quick={quick} out={out_dir}")

# ---------------------------------------------------------------- 2. collect bakeable meshes
dropped = set()
for cname in cfg.get("drop_collections", []):
    c = bpy.data.collections.get(cname)
    if c:
        dropped |= {o.name for o in c.all_objects}
dropped |= set(cfg.get("drop_objects", []))
hidden_coll = set()
for c in bpy.data.collections:
    if c.hide_render:
        hidden_coll |= {o.name for o in c.all_objects}
screens = set(cfg.get("rename", {}).keys())

# Meshes with no material, or an empty slot, render with Blender's default surface; give them a
# real grey material so the bake (which adds a node to every slot's material) can include them.
default_mat = None
for o in bpy.data.objects:
    if o.type != "MESH" or o.data.library is not None or len(o.data.polygons) == 0:
        continue
    if o.material_slots and all(s.material is not None for s in o.material_slots):
        continue
    if default_mat is None:
        default_mat = bpy.data.materials.get("LM_Default") or bpy.data.materials.new("LM_Default")
        default_mat.diffuse_color = (0.8, 0.8, 0.8, 1.0)
    if not o.material_slots:
        o.data.materials.append(default_mat)
    for s in o.material_slots:
        if s.material is None:
            s.material = default_mat
    log(f"gave {o.name} LM_Default for its missing material")

bakeable, skipped = [], []
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    why = None
    if o.name in screens:
        why = "screen"
    elif o.name in dropped:
        why = "dropped (config)"
    elif o.hide_render:
        why = "hidden in render"
    elif o.name in hidden_coll:
        why = "collection hidden in render"
    elif len(o.data.polygons) == 0:
        why = "no faces"
    elif o.name not in view_layer.objects:
        why = "not in view layer"
    elif not o.material_slots or any(s.material is None for s in o.material_slots):
        why = "missing material"
    elif not o.data.is_editable or o.library:
        why = "linked data"
    if why:
        skipped.append((o.name, why))
    else:
        bakeable.append(o)
log(f"{len(bakeable)} bakeable meshes, {len(skipped)} skipped")
for name, why in skipped:
    if why != "dropped (config)" or name in cfg.get("drop_objects", []):
        log(f"  skip {name}: {why}")

room_coll = bpy.data.collections.get("ROOM")
room_names = {o.name for o in room_coll.all_objects} if room_coll else set()
if quick:
    bakeable = [o for o in bakeable if o.name in room_names]

# Mesh data shared by several baked objects would share lightmap UVs: give each its own copy.
seen_data = set()
for o in bakeable:
    if o.data.name in seen_data or o.data.users > 1:
        o.data = o.data.copy()
        log(f"  single-user mesh data for {o.name}")
    seen_data.add(o.data.name)


# ---------------------------------------------------------------- 3. apply topology-changing modifiers
def is_safe(m):
    if m.type in SAFE_MODIFIERS:
        return True
    return m.type == "NODES" and m.node_group is not None and m.node_group.name.startswith("Smooth by Angle")


deps = bpy.context.evaluated_depsgraph_get()
applied = 0
for o in bakeable:
    mods = [m for m in o.modifiers if m.show_render]
    if not mods or all(is_safe(m) for m in mods):
        continue
    if o.data.shape_keys:
        log(f"  WARN {o.name}: has shape keys, modifiers not applied (lightmap UVs may overlap)")
        continue
    names = [m.type for m in mods]
    ev = o.evaluated_get(deps)
    new_me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=deps)
    new_me.name = o.data.name
    o.modifiers.clear()
    o.data = new_me
    applied += 1
    log(f"  applied modifiers {names} on {o.name} ({len(new_me.polygons)} faces)")
log(f"applied modifiers on {applied} objects")


# ---------------------------------------------------------------- 3b. flip inside-out closed meshes
def signed_volume(o):
    me = o.data
    edges = collections.Counter(k for p in me.polygons for k in p.edge_keys)
    if not edges or any(c != 2 for c in edges.values()):
        return None  # open or non-manifold: orientation is undefined
    M = o.matrix_world
    vs = [M @ v.co for v in me.vertices]
    vol = 0.0
    for p in me.polygons:
        idx = list(p.vertices)
        a = vs[idx[0]]
        for k in range(1, len(idx) - 1):
            vol += a.dot(vs[idx[k]].cross(vs[idx[k + 1]])) / 6.0
    return vol


flipped = []
for o in bakeable:
    vol = signed_volume(o)
    if vol is not None and vol < 0:
        o.data.flip_normals()
        o.data.update()
        flipped.append(o.name)
        log(f"  flipped inside-out normals on {o.name} (signed volume {vol:.3g})")
log(f"flipped normals on {len(flipped)} objects")


# ---------------------------------------------------------------- 4. group into atlases
def world_area(o):
    det = abs(o.matrix_world.to_3x3().determinant())
    return sum(p.area for p in o.data.polygons) * (det ** (2.0 / 3.0) if det > 0 else 1.0)


groups = []  # (name, [objects])
room = [o for o in bakeable if o.name in room_names]
rest = [o for o in bakeable if o.name not in room_names]
if room:
    groups.append(("room", room))
if rest:
    # keep collections together: order by first collection name, then object name
    rest.sort(key=lambda o: ((o.users_collection[0].name if o.users_collection else ""), o.name))
    areas = {o.name: world_area(o) for o in rest}
    faces = {o.name: len(o.data.polygons) for o in rest}
    tot_a, tot_f = sum(areas.values()) or 1.0, sum(faces.values()) or 1
    n = max(4, min(8, math.ceil(tot_f / 10000)))
    weights = [areas[o.name] / tot_a + faces[o.name] / tot_f for o in rest]
    per = sum(weights) / n
    cur, acc = [], 0.0
    for o, w in zip(rest, weights):
        if cur and acc + w / 2 > per and len(groups) < n:  # never more than n groups (room excluded)
            groups.append((f"group{len(groups) + (0 if room else 1)}", cur))
            cur, acc = [], 0.0
        cur.append(o)
        acc += w
    if cur:
        groups.append((f"group{len(groups) + (0 if room else 1)}", cur))
for name, objs in groups:
    log(f"atlas {name}: {len(objs)} objects, {sum(len(o.data.polygons) for o in objs)} faces")


# ---------------------------------------------------------------- 5. bake
def select_only(objs):
    for o in view_layer.objects:
        if o.select_get():
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    view_layer.objects.active = objs[0]


def check(res, what):
    if res != {"FINISHED"}:
        raise RuntimeError(f"{what} returned {res}; nothing saved")


def denoise(img, size):
    """Run Open Image Denoise over a baked image in place.

    Cycles ignores its denoiser when baking, so atlases come out grainy. This builds a
    throwaway scene (no objects, Workbench) whose compositor feeds the image through a
    Denoise node, renders that tiny scene, and copies the result back into `img`.
    """
    dn = bpy.data.scenes.new("LM_Denoise")
    try:
        dn.render.engine = "BLENDER_WORKBENCH"
        dn.render.resolution_x = dn.render.resolution_y = size
        dn.render.resolution_percentage = 100
        dn.render.use_compositing = True
        dn.view_settings.view_transform = "Raw"  # keep the round trip linear
        dn.display_settings.display_device = scene.display_settings.display_device
        if hasattr(dn, "compositing_node_group"):          # Blender 5.x
            tree = bpy.data.node_groups.new("LM_Denoise", "CompositorNodeTree")
            dn.compositing_node_group = tree
            tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            out = tree.nodes.new("NodeGroupOutput")
        else:                                              # Blender 4.x
            dn.use_nodes = True
            tree = dn.node_tree
            tree.nodes.clear()
            out = tree.nodes.new("CompositorNodeComposite")
        src = tree.nodes.new("CompositorNodeImage"); src.image = img
        node = tree.nodes.new("CompositorNodeDenoise")
        for attr, val in (("prefilter", "ACCURATE"), ("use_hdr", True), ("quality", "HIGH")):
            if hasattr(node, attr):
                setattr(node, attr, val)
        tree.links.new(src.outputs["Image"], node.inputs["Image"])
        tree.links.new(node.outputs["Image"], out.inputs[0])
        check(bpy.ops.render.render(scene=dn.name), "denoise render")
        rr = bpy.data.images["Render Result"]
        tmp = os.path.join(bpy.app.tempdir, f"{img.name}_dn.exr")
        rr.save_render(tmp, scene=dn)
        den = bpy.data.images.load(tmp)
        if den.size[:] != img.size[:]:
            log(f"  denoise size mismatch {den.size[:]} vs {img.size[:]}, kept raw")
        else:
            before, after = sum(img.pixels[0::4]) / (len(img.pixels) // 4), sum(den.pixels[0::4]) / (len(den.pixels) // 4)
            if abs(after - before) > 0.25 * max(before, 1e-6):  # catches a gamma slip (~2x), allows firefly removal
                raise RuntimeError(f"denoise changed mean red from {before:.4f} to {after:.4f}; colour management is off")
            img.pixels.foreach_set(den.pixels[:])
        bpy.data.images.remove(den)
        if hasattr(dn, "compositing_node_group"):
            bpy.data.node_groups.remove(tree)
    finally:
        bpy.data.scenes.remove(dn)


manifest = {}
timings = []
for gname, objs in groups:
    tg = time.time()
    # 5a. UV layers: exactly one layer at index 0, then Lightmap at index 1 (active for unwrap + bake)
    prev_active = {}
    for o in objs:
        me = o.data
        old = me.uv_layers.get(LM)
        if old is not None:
            me.uv_layers.remove(old)
        if len(me.uv_layers) == 0:
            me.uv_layers.new(name="UVMap")
            log(f"  added empty UVMap to {o.name}")
        while len(me.uv_layers) > 1:
            extra = me.uv_layers[-1]
            log(f"  WARN {o.name}: removing extra UV layer {extra.name} so Lightmap is index 1")
            me.uv_layers.remove(extra)
        prev_active[o.name] = me.uv_layers[0].name
        lm = me.uv_layers.new(name=LM, do_init=False)
        if lm is None or me.uv_layers.find(LM) != 1:
            raise RuntimeError(f"{o.name}: Lightmap UV layer is not at index 1")
        me.uv_layers.active = lm

    # 5b. Smart UV Project + pack all islands of the group into one 0..1 space. The unwrap works in
    #     object space, so temporarily bake each object's world 3x3 into its vertices: islands then
    #     share one texel density across the atlas.
    mats = {}
    for o in objs:
        m3 = o.matrix_world.to_3x3().to_4x4()
        mats[o.name] = m3
        o.data.transform(m3)
    select_only(objs)
    ts = scene.tool_settings
    prev_sync = ts.use_uv_select_sync
    ts.use_uv_select_sync = True  # UV selection follows the (all-selected) mesh selection
    try:
        with bpy.context.temp_override(active_object=objs[0], object=objs[0],
                                       selected_objects=objs, selected_editable_objects=objs):
            check(bpy.ops.object.mode_set(mode="EDIT"), "mode_set EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            check(bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0,
                                           correct_aspect=True, scale_to_bounds=False),
                  f"{gname}: uv.smart_project")
            check(bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, scale=True,
                                          margin_method="FRACTION", margin=0.006,
                                          shape_method="CONCAVE"),
                  f"{gname}: uv.pack_islands")
            check(bpy.ops.object.mode_set(mode="OBJECT"), "mode_set OBJECT")
    finally:
        ts.use_uv_select_sync = prev_sync
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for o in objs:
            o.data.transform(mats[o.name].inverted())
            o.data.update()
    log(f"  {gname}: smart_project + pack_islands ({time.time() - tg:.1f}s)")

    # 5c. bake target image + one active, unlinked image node per material of the group
    img_name = f"LM_{gname}"
    old_img = bpy.data.images.get(img_name)
    if old_img:
        bpy.data.images.remove(old_img)
    img = bpy.data.images.new(img_name, atlas_size, atlas_size, alpha=False, float_buffer=True)
    temp_nodes = []
    group_mats = {s.material for o in objs for s in o.material_slots if s.material}
    for mat in group_mats:
        if mat.node_tree is None:
            mat.use_nodes = True
        nt = mat.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.name = node.label = "__lightmap_bake__"
        node.image = img
        node.select = True
        nt.nodes.active = node
        temp_nodes.append((mat, node))
    # Invariant: every material in this group points at exactly this atlas (nodes of previous
    # groups were removed), so materials shared across groups cannot bake into the wrong atlas.
    for mat in group_mats:
        lm_nodes = [n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name.startswith("LM_")]
        assert len(lm_nodes) == 1 and lm_nodes[0].image == img and mat.node_tree.nodes.active == lm_nodes[0], mat.name

    # 5c'. Cycles' DIFFUSE light pass is (diffuse light) / (diffuse colour), so surfaces without a
    #      diffuse lobe (metallic=1 keyboard, black base colour) bake pure black. Add a faint white
    #      Diffuse BSDF to every group material for the bake only, restored right after.
    diffuse_aids = []
    for mat in group_mats:
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
        if out is None:
            out = nt.nodes.new("ShaderNodeOutputMaterial")
        surf = out.inputs["Surface"]
        src = surf.links[0].from_socket if surf.links else None
        dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
        dif.inputs["Color"].default_value = (DIFFUSE_AID,) * 3 + (1.0,)
        add = nt.nodes.new("ShaderNodeAddShader")
        if src is not None:
            nt.links.new(src, add.inputs[0])
        nt.links.new(dif.outputs[0], add.inputs[1])
        nt.links.new(add.outputs[0], surf)
        diffuse_aids.append((mat, out, src, dif, add))

    # 5d. bake
    tb = time.time()
    select_only(objs)
    with bpy.context.temp_override(active_object=objs[0], object=objs[0],
                                   selected_objects=objs, selected_editable_objects=objs):
        res = bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"},
                                  use_selected_to_active=False, margin=bake.margin,
                                  target="IMAGE_TEXTURES", save_mode="INTERNAL")
    check(res, f"{gname}: object.bake")
    log(f"  {gname}: bake -> {res} ({time.time() - tb:.1f}s)")

    # 5d'. denoise (Cycles bakes ignore the denoiser)
    if not no_denoise:
        td = time.time()
        denoise(img, atlas_size)
        log(f"  {gname}: denoised ({time.time() - td:.1f}s)")

    # 5e. save PNG through the scene's (Standard) view transform: plain sRGB of linear light
    path = os.path.join(out_dir, f"{img_name}.png")
    img.save_render(path, scene=scene)
    for o in objs:
        manifest[o.name] = {"file": f"{img_name}.png", "intensity": intensity}

    # 5f. clean up: diffuse aids, temp nodes, image, restore active UV layer
    for mat, out, src, dif, add in diffuse_aids:
        nt = mat.node_tree
        nt.nodes.remove(add)
        nt.nodes.remove(dif)
        if src is not None:
            nt.links.new(src, out.inputs["Surface"])
    for mat, node in temp_nodes:
        mat.node_tree.nodes.remove(node)
    bpy.data.images.remove(img)
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers[prev_active[o.name]]
    dt = time.time() - tg
    timings.append((gname, len(objs), dt))
    log(f"  {gname}: wrote {path} ({os.path.getsize(path) // 1024} KB), {len(objs)} objects, {dt:.1f}s")

# ---------------------------------------------------------------- 6. manifest, restore, save
with open(os.path.join(out_dir, "manifest.json"), "w") as f:
    json.dump(dict(sorted(manifest.items())), f, indent=1)
for name, n, dt in timings:
    log(f"summary {name}: {n} objects, {dt:.1f}s")
log(f"manifest: {len(manifest)} objects in {len(timings)} atlases; total {time.time() - T0:.1f}s")

scene.render.engine = saved["engine"]
scene.cycles.device = saved["device"]
scene.cycles.samples = saved["samples"]
scene.render.use_persistent_data = saved["persistent"]
scene.view_settings.view_transform = saved["view_transform"]
scene.view_settings.look = saved["look"]
scene.view_settings.exposure = saved["exposure"]
scene.view_settings.gamma = saved["gamma"]
if quick:
    log("quick: .blend NOT saved")
else:
    bpy.ops.wm.save_mainfile()
    log(f"saved {bpy.data.filepath} (Lightmap UV layers persisted)")
