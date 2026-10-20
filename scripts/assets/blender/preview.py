"""Render a quick front/3-4 preview of GLB files (QA for the asset pipeline).

Usage: blender -b -P preview.py -- --out <png> <file.glb> [<file.glb> ...]
"""

import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1 :]
out = argv[argv.index('--out') + 1]
files = [a for a in argv if a.endswith('.glb')]
spacing = float(argv[argv.index('--spacing') + 1]) if '--spacing' in argv else 2.0
height = float(argv[argv.index('--height') + 1]) if '--height' in argv else 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
for i, f in enumerate(files):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    for o in set(bpy.data.objects) - before:
        if o.parent is None:
            o.location.x += (i - (len(files) - 1) / 2) * spacing

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
yaw = float(argv[argv.index('--yaw') + 1]) if '--yaw' in argv else 0.35
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
