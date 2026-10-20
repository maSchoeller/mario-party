"""Render previews of GLB files (QA for the asset pipeline).

Usage:
  blender -b -P preview.py -- --out <png> <file.glb> [<file.glb> ...]     (side by side)
  blender -b -P preview.py -- --sheet --out <png> [--tint e8767a] [--cols 6] [--tile 360] <props.glb>

--sheet renders every group ("<prop>__<material>" meshes) of a prop library in its own
auto-framed tile (3/4 view from the front, ground disc, label with size and triangle
count) and composes a contact sheet. Colors are shown like in the game: palette color
(name c_<hex> / glow_<hex>, tint -> --tint) multiplied by the exported COLOR_0.
"""

import math
import os
import sys
import tempfile

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1 :]
out = argv[argv.index('--out') + 1]
files = [a for a in argv if a.endswith('.glb')]


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


spacing = float(opt('--spacing', 2.0))
height = float(opt('--height', 1.0))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
for i, f in enumerate(files):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    for o in set(bpy.data.objects) - before:
        if o.parent is None:
            o.location.x += (i - (len(files) - 1) / 2) * spacing


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    return [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]


def bake_preview_colors(tint):
    """Palette color x COLOR_0 -> attribute 'Preview' (workbench VERTEX shading)."""
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        name = o.name.split('.')[0]
        mat = name.split('__')[1] if '__' in name else 'c_ffffff'
        base = hexcol(tint) if mat == 'tint' else hexcol(mat.split('_', 1)[1]) if '_' in mat else [1, 1, 1]
        glow = mat.startswith('glow_')
        me = o.data
        src = None
        for a in me.color_attributes:
            if a.name != 'Preview':
                src = a
                break
        dst = me.color_attributes.new('Preview', 'FLOAT_COLOR', 'CORNER')
        vals = []
        if src is not None:
            if src.domain == 'POINT':
                per_loop = [src.data[l.vertex_index].color for l in me.loops]
            else:
                per_loop = [d.color for d in src.data]
            # the importer gives linear values exactly as stored in COLOR_0
            vals = [tuple(c[:3]) for c in per_loop]
        else:
            vals = [(1, 1, 1)] * len(me.loops)
        for d, v in zip(dst.data, vals):
            c = [min(1.0, base[k] * v[k] * (1.25 if glow else 1.0)) for k in range(3)]
            d.color = (*[srgb_to_lin(x) for x in c], 1)
        me.color_attributes.active_color = dst


def setup_render(w, h):
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.show_shadows = True
    scene.display.shading.shadow_intensity = 0.35
    scene.display.shading.show_cavity = False
    scene.display.render_aa = '8'
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    world.color = (0.93, 0.95, 0.97)
    scene.world = world


if '--sheet' not in argv:
    if '--spread' in argv:
        # lay out the groups of a prop library side by side
        groups = sorted({o.name.split('__')[0] for o in bpy.data.objects if o.type == 'MESH'})
        for o in bpy.data.objects:
            if o.type == 'MESH':
                gi = groups.index(o.name.split('__')[0])
                o.location.x += (gi % 7 - 3) * spacing
                o.location.y += -(gi // 7) * spacing
        files = groups[:7]

    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    dist = max(4.5, len(files) * spacing * 1.35)
    yaw = float(opt('--yaw', 0.35))
    # models face Blender +Y -> camera looks from +Y towards -Y, slightly from the right and above
    cam.location = Vector((dist * math.sin(yaw), dist * math.cos(yaw), height + dist * 0.3))
    direction = Vector((0, 0, height)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(150))
    scene.collection.objects.link(sun)

    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 700
    scene.render.filepath = out
    world = bpy.data.worlds.new('w')
    scene.world = world
    bpy.ops.render.render(write_still=True)
    print('[preview]', out)
    sys.exit(0)

# ---- contact sheet ---------------------------------------------------------------
import numpy as np  # noqa: E402  (bundled with Blender)

tint = opt('--tint', 'e8767a')
cols = int(opt('--cols', 6))
tile = int(opt('--tile', 360))
yaw = float(opt('--yaw', 0.55))
pitch = float(opt('--pitch', 0.5))
bake_preview_colors(tint)
setup_render(tile, tile)
if '--workbench' in argv:
    scene.display.shading.color_type = 'VERTEX'
else:
    # EEVEE approximating the game light: hemispheric ambient ~0.5 + sun ~0.72, soft shadows
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 16
    scene.render.film_transparent = True
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1)
    bg.inputs['Strength'].default_value = 0.55
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 2.4
    sun.data.angle = math.radians(6)
    sun.rotation_euler = (math.radians(40), 0, math.radians(200))
    scene.collection.objects.link(sun)
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        glow = '__glow_' in o.name
        m = bpy.data.materials.new('pv_' + o.name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.attribute_name = 'Preview'
        nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 1.0
        bsdf.inputs['Specular IOR Level'].default_value = 0.05
        if glow:
            nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 0.8
        o.data.materials.clear()
        o.data.materials.append(m)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
groups = {}
for o in meshes:
    groups.setdefault(o.name.split('.')[0].split('__')[0], []).append(o)
only = opt('--only', None)
names = sorted(groups) if not only else [n for n in only.split(',') if n in groups]

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 50
cam.data.clip_end = 1000

# ground disc (light sand), shown under every prop
bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1.0, fill_type='NGON')
disc = bpy.context.active_object
dc = disc.data.color_attributes.new('Preview', 'FLOAT_COLOR', 'CORNER')
for d in dc.data:
    d.color = (*[srgb_to_lin(x) for x in hexcol('e9e4d8')], 1)
if bpy.data.materials.get('pv_disc') is None and scene.render.engine == 'BLENDER_EEVEE':
    m = bpy.data.materials.new('pv_disc')
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*[srgb_to_lin(x) for x in hexcol('e9e4d8')], 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    disc.data.materials.append(m)

scene.render.use_stamp = True
for p in dir(scene.render):
    if p.startswith('use_stamp_'):
        try:
            setattr(scene.render, p, False)
        except (AttributeError, TypeError):
            pass
scene.render.use_stamp_note = True
scene.render.stamp_font_size = 14
scene.render.stamp_background = (1, 1, 1, 0.6)
scene.render.stamp_foreground = (0.1, 0.1, 0.15, 1)

tmp = tempfile.mkdtemp()
tiles = []
for name in names:
    objs = groups[name]
    for o in meshes:
        o.hide_render = o not in objs
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = (lo + hi) / 2
    size = hi - lo
    radius = max(size.length / 2, 0.2)
    disc.location = (center.x, center.y, min(0.0, lo.z) - 0.002 if lo.z > -0.05 else lo.z - 0.002)
    disc.scale = (radius * 1.25, radius * 1.25, 1)
    fov = 2 * math.atan(18 / cam.data.lens)
    d = radius / math.sin(fov / 2) * 1.02
    direction = Vector((math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.location = center + direction * d
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
    tris = sum(len(o.data.loop_triangles) if o.data.loop_triangles else len(o.data.polygons) for o in objs)
    # Babylon size: x = Blender x, y = Blender z (height), z = Blender y
    scene.render.stamp_note_text = f'{name}  {size.x:.1f}x{size.z:.1f}x{size.y:.1f}  {tris} tris  {len(objs)} mats'
    path = os.path.join(tmp, f'{name}.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    tiles.append(path)

rows = math.ceil(len(tiles) / cols)
W, H = cols * tile, rows * tile
sheet = np.ones((H, W, 4), dtype=np.float32)
for i, path in enumerate(tiles):
    img = bpy.data.images.load(path)
    px = np.empty(tile * tile * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(tile, tile, 4)
    r, c = divmod(i, cols)
    y0 = H - (r + 1) * tile
    al = px[:, :, 3:4]
    bgc = np.array([0.93, 0.95, 0.97, 1.0], dtype=np.float32)
    sheet[y0 : y0 + tile, c * tile : (c + 1) * tile] = px * al + bgc * (1 - al) if '--workbench' not in argv else px
    sheet[y0 : y0 + tile, c * tile : (c + 1) * tile, 3] = 1.0
    bpy.data.images.remove(img)
im = bpy.data.images.new('sheet', W, H)
im.pixels.foreach_set(sheet.ravel())
im.filepath_raw = os.path.abspath(out)
im.file_format = 'PNG'
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
im.save()
print('[preview] sheet', out, len(tiles), 'tiles')
