"""Shared helpers for the Blender asset scripts (ASSET-02/03/04).

All coordinates are given in *Babylon space* (left-handed, Y up, models face -Z),
the space the host renderer works in. `B()` converts them to Blender space so that
the exported glTF ends up exactly there after Babylon's glTF import.

Babylon (x, y, z)  ->  glTF (-x, y, z)  ->  Blender (-x, -z, y)

Material convention (the host maps names to its shared flat-shaded palette
materials, see apps/web/src/host/render/assets.ts):
  c_<rrggbb>   fixed palette color
  tint         color chosen at runtime (roof colors, player colors …)
  glow_<hex>   emissive palette color (lava, gold)

Objects are named "<group>__<material>"; the group is the rig part for characters
(body/head/armL/armR) or the prop id for the prop library.
"""

import math
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


def B(x, y, z):
    return Vector((-x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


_mats = {}


def material(name):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    hexcol = name.split('_', 1)[1] if '_' in name else 'ffffff'
    try:
        r, g, b = (int(hexcol[i : i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        r = g = b = 1.0
    # sRGB -> linear for the glTF base color
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    m.diffuse_color = (lin(r), lin(g), lin(b), 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (lin(r), lin(g), lin(b), 1)
        bsdf.inputs['Roughness'].default_value = 0.9
        if name.startswith('glow_'):
            bsdf.inputs['Emission Color'].default_value = (lin(r), lin(g), lin(b), 1)
            bsdf.inputs['Emission Strength'].default_value = 0.6
    _mats[name] = m
    return m


def _finish(obj, group, mat, loc, rot, scale):
    obj.name = f'{group}__{mat}'
    obj.data.materials.clear()
    obj.data.materials.append(material(mat))
    obj.scale = scale
    # rotation given in Babylon space (radians, XYZ). Convert by conjugating with the axis change.
    if rot != (0, 0, 0):
        rx, ry, rz = rot
        m = Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()
        conv = Matrix(((-1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        obj.matrix_world = conv @ m @ conv.inverted() @ Matrix.Diagonal((*scale, 1))
    obj.location = B(*loc)
    return obj


def _swap_scale(s):
    # scale is given in Babylon axes (sx, sy, sz) -> Blender (sx, sz, sy)
    return (s[0], s[2], s[1])


def ico(group, mat, loc, r=0.5, scale=(1, 1, 1), subdiv=2, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r)
    return _finish(bpy.context.active_object, group, mat, loc, rot, _swap_scale(scale))


def uvs(group, mat, loc, r=0.5, scale=(1, 1, 1), seg=10, rings=7, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r)
    return _finish(bpy.context.active_object, group, mat, loc, rot, _swap_scale(scale))


def cyl(group, mat, loc, r1=0.5, r2=None, h=1, verts=8, scale=(1, 1, 1), rot=(0, 0, 0)):
    """Cylinder / truncated cone along Babylon +Y (r1 bottom, r2 top)."""
    r2 = r1 if r2 is None else r2
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h)
    return _finish(bpy.context.active_object, group, mat, loc, rot, _swap_scale(scale))


def cone(group, mat, loc, r=0.5, h=1, verts=6, scale=(1, 1, 1), rot=(0, 0, 0)):
    return cyl(group, mat, loc, r, 0, h, verts, scale, rot)


def box(group, mat, loc, size=(1, 1, 1), rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    if bevel > 0:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='bevel')
    return _finish(o, group, mat, loc, rot, _swap_scale(size))


def torus(group, mat, loc, R=0.5, r=0.1, seg=12, mseg=5, scale=(1, 1, 1), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=mseg)
    o = bpy.context.active_object
    # torus lies in Blender XY -> rotate so it lies in Babylon XZ (horizontal) by default
    return _finish(o, group, mat, loc, rot, _swap_scale(scale))


def jitter(obj, amount=0.04, seed=1):
    """Low-poly 'hand made' look: displace vertices a little (deterministic)."""
    import random

    rnd = random.Random(seed)
    for v in obj.data.vertices:
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * amount
    return obj


def bulge(obj, axis_fn):
    """Generic vertex deformation in Babylon space: axis_fn(x,y,z)->(x,y,z) on local coords."""
    for v in obj.data.vertices:
        x, y, z = -v.co.x, v.co.z, -v.co.y
        nx, ny, nz = axis_fn(x, y, z)
        v.co = Vector((-nx, -nz, ny))
    return obj


def finalize(out_path, triangle_budget=None):
    """Apply transforms, join per group+material, flat shade, triangulate, export GLB."""
    scene = bpy.context.scene
    objs = [o for o in scene.objects if o.type == 'MESH']
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')

    groups = {}
    for o in objs:
        key = o.name.split('.')[0]
        groups.setdefault(key, []).append(o)
    for key, members in groups.items():
        for o in members:
            o.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        if len(members) > 1:
            bpy.ops.object.join()
        joined = bpy.context.active_object
        joined.name = key
        joined.data.name = key
        bpy.ops.object.select_all(action='DESELECT')

    tris = {}
    for o in [o for o in scene.objects if o.type == 'MESH']:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(o.data)
        bm.free()
        for p in o.data.polygons:
            p.use_smooth = False
        group = o.name.split('__')[0]
        tris[group] = tris.get(group, 0) + len(o.data.polygons)

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=False,
        export_animations=False,
        export_extras=False,
    )
    total = sum(tris.values())
    print(f'[asset] {out_path}: {total} triangles {tris}')
    if triangle_budget and total > triangle_budget:
        print(f'[asset] ERROR budget {triangle_budget} exceeded', file=sys.stderr)
        sys.exit(2)
    return tris


def arg(name, default=None):
    argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
    for i, a in enumerate(argv):
        if a == f'--{name}' and i + 1 < len(argv):
            return argv[i + 1]
    return default


TAU = math.tau


def beam(group, mat, p0, p1, width=0.2, thick=0.06, up=(0, 1, 0)):
    """Box spanning from p0 to p1 (Babylon space); its flat side faces `up`."""
    a, b = B(*p0), B(*p1)
    d = b - a
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = f'{group}__{mat}'
    o.data.materials.append(material(mat))
    # local X along the beam, local Z towards `up`
    x = d.normalized()
    u = B(*up)
    z = (u - x * u.dot(x)).normalized()
    y = z.cross(x)
    rot = Matrix((x, y, z)).transposed().to_4x4()
    o.matrix_world = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((d.length, width, thick, 1))
    return o
