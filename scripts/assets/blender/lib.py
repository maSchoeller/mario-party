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


# Optional fast path (opt-in, see fast_primitives): build primitives with bmesh + the data
# API instead of bpy.ops, which gets slow once a scene holds thousands of objects. Same
# geometry, no operator/context overhead. Default off -> identical behaviour for old callers.
_FAST = False


def fast_primitives(on=True):
    global _FAST
    _FAST = on


def _bm_object(bm):
    me = bpy.data.meshes.new('prim')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('prim', me)
    bpy.context.scene.collection.objects.link(o)
    return o


def ico(group, mat, loc, r=0.5, scale=(1, 1, 1), subdiv=2, rot=(0, 0, 0)):
    if _FAST:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
        return _finish(_bm_object(bm), group, mat, loc, rot, _swap_scale(scale))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r)
    return _finish(bpy.context.active_object, group, mat, loc, rot, _swap_scale(scale))


def uvs(group, mat, loc, r=0.5, scale=(1, 1, 1), seg=10, rings=7, rot=(0, 0, 0)):
    if _FAST:
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
        return _finish(_bm_object(bm), group, mat, loc, rot, _swap_scale(scale))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r)
    return _finish(bpy.context.active_object, group, mat, loc, rot, _swap_scale(scale))


def cyl(group, mat, loc, r1=0.5, r2=None, h=1, verts=8, scale=(1, 1, 1), rot=(0, 0, 0)):
    """Cylinder / truncated cone along Babylon +Y (r1 bottom, r2 top)."""
    r2 = r1 if r2 is None else r2
    if _FAST:
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r1, radius2=r2, depth=h)
        if r2 == 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        return _finish(_bm_object(bm), group, mat, loc, rot, _swap_scale(scale))
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=h)
    return _finish(bpy.context.active_object, group, mat, loc, rot, _swap_scale(scale))


def cone(group, mat, loc, r=0.5, h=1, verts=6, scale=(1, 1, 1), rot=(0, 0, 0)):
    return cyl(group, mat, loc, r, 0, h, verts, scale, rot)


def box(group, mat, loc, size=(1, 1, 1), rot=(0, 0, 0), bevel=0.0):
    if _FAST:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:], offset=bevel, segments=1, affect='EDGES', profile=0.5)
        return _finish(_bm_object(bm), group, mat, loc, rot, _swap_scale(size))
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
    if _FAST:
        bm = bmesh.new()
        rings = []
        for i in range(seg):
            a = i / seg * math.tau
            ring = []
            for j in range(mseg):
                b = j / mseg * math.tau
                d = R + r * math.cos(b)
                ring.append(bm.verts.new((d * math.cos(a), d * math.sin(a), r * math.sin(b))))
            rings.append(ring)
        for i in range(seg):
            A, C = rings[i], rings[(i + 1) % seg]
            for j in range(mseg):
                bm.faces.new((A[j], C[j], C[(j + 1) % mseg], A[(j + 1) % mseg]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = _bm_object(bm)
        return _finish(o, group, mat, loc, rot, _swap_scale(scale))
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


def finalize(out_path, triangle_budget=None, ao=False, ao_opts=None, budgets=None):
    """Apply transforms, join per group+material, flat shade, triangulate, export GLB.

    Optional (all off by default, so older callers behave exactly as before):
      ao        bake per-vertex ambient occlusion + a soft top-down gradient into the
                color attribute COLOR_0 (see bake_ao); vertex colors set with tone()/shade()
                are exported as well.
      ao_opts   {group: {bake_ao kwargs}} per-group overrides, key '*' = defaults.
      budgets   {group: max triangles} or callable(group) -> max/None; exits with 2 if exceeded.
    """
    scene = bpy.context.scene
    objs = [o for o in scene.objects if o.type == 'MESH']
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    colored = ao or any(COLOR_ATTR in o.data.color_attributes for o in objs)
    if colored:
        # every mesh needs the attribute before joining (missing ones would turn black)
        for o in objs:
            _col(o)

    groups = {}
    for o in objs:
        key = o.name.split('.')[0]
        groups.setdefault(key, []).append(o)
    for key, members in groups.items():
        if _FAST:
            # data-level join (bpy.ops.object.join gets slow with thousands of objects)
            bm = bmesh.new()
            for o in members:
                bm.from_mesh(o.data)
            mats = list(members[0].data.materials)
            for o in members:
                me_old = o.data
                bpy.data.objects.remove(o)
                if me_old.users == 0:
                    bpy.data.meshes.remove(me_old)
            me = bpy.data.meshes.new(key)
            bm.to_mesh(me)
            bm.free()
            for m in mats:
                me.materials.append(m)
            ob = bpy.data.objects.new(key, me)
            scene.collection.objects.link(ob)
            continue
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

    if ao:
        import time

        t0 = time.time()
        opts = ao_opts or {}
        by_group = {}
        for o in [o for o in scene.objects if o.type == 'MESH']:
            by_group.setdefault(o.name.split('__')[0], []).append(o)
        for group, members in by_group.items():
            kw = dict(opts.get('*', {}))
            kw.update(opts.get(group, {}))
            if kw.pop('skip', False):
                continue
            bake_ao(members, **kw)
        print(f'[asset] ambient occlusion baked in {time.time() - t0:.1f}s')

    extra = {}
    if colored:
        # Blender 4.2+/5.x exporter: 'ACTIVE' writes the active color attribute as COLOR_0
        # (linear floats, used as-is by Babylon as a diffuse multiplier)
        for o in [o for o in scene.objects if o.type == 'MESH']:
            a = o.data.color_attributes.get(COLOR_ATTR)
            if a:
                o.data.color_attributes.active_color = a
                o.data.color_attributes.render_color_index = o.data.color_attributes.active_color_index
        extra = dict(export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True)

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
        **extra,
    )
    total = sum(tris.values())
    print(f'[asset] {out_path}: {total} triangles {tris}')
    failed = False
    if triangle_budget and total > triangle_budget:
        print(f'[asset] ERROR budget {triangle_budget} exceeded', file=sys.stderr)
        failed = True
    if budgets:
        for group, n in sorted(tris.items()):
            limit = budgets(group) if callable(budgets) else budgets.get(group)
            print(f'[asset]   {group:<14} {n:>6} tris' + (f' / {limit}' if limit else ''))
            if limit and n > limit:
                print(f'[asset] ERROR {group}: {n} triangles > budget {limit}', file=sys.stderr)
                failed = True
    if failed:
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
    if _FAST:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        o = _bm_object(bm)
    else:
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


# ---------------------------------------------------------------------------
# v0.3 additions (props detail pass). Everything below is additive; the helpers
# above keep their behaviour.
#
# Raw-geometry builders take points in Babylon space and return an object named
# "<group>__<mat>" exactly like the primitive helpers. place() positions an object
# built around the origin (same loc/rot/scale semantics as the primitive helpers).
# Vertex colors live in the FLOAT_COLOR point attribute COLOR_ATTR and act as a
# multiplier on the palette color (about 0.55 .. 1.0): tone()/shade() author them,
# bake_ao() (via finalize(ao=True)) multiplies ambient occlusion on top.

COLOR_ATTR = 'Col'


def mesh(group, mat, verts, faces, recalc=True):
    """Object from raw geometry in Babylon space: verts [(x, y, z)], faces [index tuples]."""
    me = bpy.data.meshes.new(f'{group}__{mat}')
    bm = bmesh.new()
    bv = [bm.verts.new(B(*v)) for v in verts]
    for f in faces:
        idx = [i for k, i in enumerate(f) if i != f[k - 1]]  # drop repeated corners
        if len(set(idx)) < 3:
            continue
        try:
            bm.faces.new([bv[i] for i in idx])
        except ValueError:
            pass  # face exists already
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(f'{group}__{mat}', me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(material(mat))
    return o


def place(obj, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Position an origin-built object (Babylon loc / XYZ rot / scale), like the primitives."""
    group, mat = obj.name.split('.')[0].split('__')
    return _finish(obj, group, mat, loc, rot, _swap_scale(scale))


def _radius(r, i):
    return r[i] if isinstance(r, (list, tuple)) else r


def tube(group, mat, pts, radii, verts=6, cap=True, twist=0.0, squash=1.0, phase=0.0):
    """Generalised cylinder through Babylon points `pts` (parallel-transport frames).

    radii: number or per-point list; a radius of 0 at an end makes a pointed tip.
    squash scales the ring along its second axis (flat ribbons / planks)."""
    P = [Vector(p) for p in pts]
    n = len(P)
    T = []
    for i in range(n):
        if i == 0:
            t = P[1] - P[0]
        elif i == n - 1:
            t = P[-1] - P[-2]
        else:
            t = (P[i + 1] - P[i]).normalized() + (P[i] - P[i - 1]).normalized()
        T.append(t.normalized())
    ref = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    u = T[0].cross(ref).normalized()
    vs, rings = [], []
    for i in range(n):
        if i > 0:
            u = u - T[i] * u.dot(T[i])
            u = u.normalized() if u.length > 1e-6 else T[i].orthogonal().normalized()
        v = T[i].cross(u)
        r = _radius(radii, i)
        if r <= 1e-5:
            rings.append([len(vs)])
            vs.append(tuple(P[i]))
            continue
        ring = []
        for k in range(verts):
            a = k / verts * TAU + twist * i + phase
            q = P[i] + u * (math.cos(a) * r) + v * (math.sin(a) * r * squash)
            ring.append(len(vs))
            vs.append(tuple(q))
        rings.append(ring)
    faces = []
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            faces += [(a[0], b[k], b[(k + 1) % verts]) for k in range(verts)]
        elif len(b) == 1:
            faces += [(a[k], a[(k + 1) % verts], b[0]) for k in range(verts)]
        else:
            faces += [(a[k], a[(k + 1) % verts], b[(k + 1) % verts], b[k]) for k in range(verts)]
    if cap:
        if len(rings[0]) > 1:
            faces.append(tuple(reversed(rings[0])))
        if len(rings[-1]) > 1:
            faces.append(tuple(rings[-1]))
    return mesh(group, mat, vs, faces)


def lathe(group, mat, loc, profile, verts=12, rot=(0, 0, 0), scale=(1, 1, 1), phase=0.0, rfn=None):
    """Surface of revolution around Babylon +Y. profile = [(r, y), ...] bottom -> top;
    r = 0 closes an end with a single vertex, otherwise ends get flat caps.
    rfn(angle, ring_index) -> radius factor (ribs, flutes, irregular outlines)."""
    vs, rings = [], []
    for j, (r, y) in enumerate(profile):
        if r <= 1e-5:
            rings.append([len(vs)])
            vs.append((0, y, 0))
            continue
        ring = []
        for k in range(verts):
            a = k / verts * TAU + phase
            f = rfn(a, j) if rfn else 1.0
            ring.append(len(vs))
            vs.append((math.cos(a) * r * f, y, math.sin(a) * r * f))
        rings.append(ring)
    faces = []
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            faces += [(a[0], b[(k + 1) % verts], b[k]) for k in range(verts)]
        elif len(b) == 1:
            faces += [(a[k], a[(k + 1) % verts], b[0]) for k in range(verts)]
        else:
            faces += [(a[k], a[(k + 1) % verts], b[(k + 1) % verts], b[k]) for k in range(verts)]
    if len(rings[0]) > 1:
        faces.append(tuple(rings[0]))
    if len(rings[-1]) > 1:
        faces.append(tuple(reversed(rings[-1])))
    o = mesh(group, mat, vs, faces)
    return place(o, loc, rot, scale)


def prism(group, mat, loc, outline, depth, rot=(0, 0, 0), scale=(1, 1, 1)):
    """Polygon outline [(x, y), ...] in the Babylon XY plane, extruded along Z (centered)."""
    n = len(outline)
    vs = [(x, y, -depth / 2) for x, y in outline] + [(x, y, depth / 2) for x, y in outline]
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    o = mesh(group, mat, vs, faces)
    return place(o, loc, rot, scale)


def loft(group, mat, rings, cap=True):
    """Skin consecutive closed rings (same vertex count) given in Babylon space."""
    m = len(rings[0])
    vs = [tuple(p) for ring in rings for p in ring]
    faces = []
    for j in range(len(rings) - 1):
        a, b = j * m, (j + 1) * m
        faces += [(a + k, a + (k + 1) % m, b + (k + 1) % m, b + k) for k in range(m)]
    if cap:
        faces.append(tuple(range(m)))
        faces.append(tuple(range(len(vs) - 1, len(vs) - m - 1, -1)))
    return mesh(group, mat, vs, faces)


def noisify(obj, amount=0.1, freq=1.0, seed=0, axes=(1, 1, 1)):
    """Smooth (coherent) noise displacement - organic, deterministic. axes in Babylon (x, y, z)."""
    from mathutils import noise

    off = Vector((seed * 13.17, seed * 7.31, seed * 3.77))
    ax = Vector((axes[0], axes[2], axes[1]))  # Babylon -> Blender axes (sign irrelevant for noise)
    for v in obj.data.vertices:
        n = noise.noise_vector(v.co * freq + off)
        v.co += Vector((n.x * ax.x, n.y * ax.y, n.z * ax.z)) * amount
    return obj


def flatten(obj, y=0.0, sink=0.0):
    """Clamp the object's world-space (Babylon) y to >= y - sink: a flat base on the ground."""
    mw = obj.matrix_basis
    inv = mw.inverted()
    for v in obj.data.vertices:
        w = mw @ v.co
        if w.z < y - sink:
            w.z = y - sink
            v.co = inv @ w
    return obj


def _col(obj):
    me = obj.data
    a = me.color_attributes.get(COLOR_ATTR)
    if a is None:
        a = me.color_attributes.new(COLOR_ATTR, 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', [1.0] * (4 * len(a.data)))
    me.color_attributes.active_color = a
    return a


def tone(obj, f):
    """Multiply the vertex color of a whole object (scalar or (r, g, b))."""
    f = (f, f, f) if isinstance(f, (int, float)) else f
    for d in _col(obj).data:
        c = d.color
        d.color = (c[0] * f[0], c[1] * f[1], c[2] * f[2], 1.0)
    return obj


def shade(obj, fn):
    """Per-vertex color multiplier fn(x, y, z) in world Babylon space -> scalar or (r, g, b)."""
    mw = obj.matrix_basis
    a = _col(obj)
    for v, d in zip(obj.data.vertices, a.data):
        w = mw @ v.co
        f = fn(-w.x, w.z, -w.y)
        f = (f, f, f) if isinstance(f, (int, float)) else f
        c = d.color
        d.color = (c[0] * f[0], c[1] * f[1], c[2] * f[2], 1.0)
    return obj


def vgrad(obj, lo=0.8, hi=1.0):
    """Vertical gradient over the object's own height (darker base, lighter top)."""
    mw = obj.matrix_basis
    ys = [(mw @ v.co).z for v in obj.data.vertices]
    y0, y1 = min(ys), max(ys)
    span = max(y1 - y0, 1e-6)
    return shade(obj, lambda x, y, z: lo + (hi - lo) * min(1.0, max(0.0, (y - y0) / span)))


def _hemisphere(n):
    """Cosine-weighted, stratified directions around +Z (Blender up)."""
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        u = (i + 0.5) / n
        r = math.sqrt(u)
        a = i * ga
        out.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u)))))
    return out


def _to_corner(obj):
    """Convert the color attribute to the face-corner domain (flat shading splits anyway)."""
    me = obj.data
    a = _col(obj)
    if a.domain == 'CORNER':
        return a
    vals = [0.0] * (4 * len(a.data))
    a.data.foreach_get('color', vals)
    me.color_attributes.remove(a)
    c = me.color_attributes.new(COLOR_ATTR, 'FLOAT_COLOR', 'CORNER')
    vi = [0] * len(me.loops)
    me.loops.foreach_get('vertex_index', vi)
    c.data.foreach_set('color', [vals[4 * i + k] for i in vi for k in range(4)])
    me.color_attributes.active_color = c
    return c


def bake_ao(objs, samples=16, dist=None, ground=0.0, lo=0.62, power=0.6, grad=(0.9, 1.0), floor=0.55, inset=0.3):
    """Cheap ambient occlusion by ray casting against all meshes of one prop (plus a
    ground plane at Babylon y = `ground`; None = no ground), then a soft top-down gradient.

    Evaluated per face corner with the flat face normal, from a point pulled `inset`
    towards the face center (avoids black corners on big faces). The result multiplies
    the existing vertex colors; glow_ meshes stay unshaded.

    color = max(floor, (lo + (1 - lo) * visible^power) * lerp(grad[0], grad[1], height01))"""
    from mathutils.bvhtree import BVHTree

    verts, polys = [], []
    for o in objs:
        base = len(verts)
        mw = o.matrix_world
        verts += [mw @ v.co for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    if not polys:
        return
    bvh = BVHTree.FromPolygons(verts, polys)
    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    zs = [v.z for v in verts]
    size = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs), 1e-3)
    d_max = dist if dist else min(1.5, max(0.2, size * 0.15))
    z0, z1 = (ground if ground is not None else min(zs)), max(zs)
    span = max(z1 - z0, 1e-3)
    eps = 0.001 * size + 0.002
    hemi = _hemisphere(samples)
    for o in objs:
        a = _to_corner(o)
        if o.name.split('__')[1].startswith('glow_'):
            continue
        me = o.data
        mw = o.matrix_world
        rot = mw.to_3x3().inverted().transposed()
        wv = [mw @ v.co for v in me.vertices]
        for poly in me.polygons:
            n = rot @ poly.normal
            if n.length < 1e-9:
                continue
            n.normalize()
            t1 = n.orthogonal().normalized()
            t2 = n.cross(t1)
            dirs = [t1 * h.x + t2 * h.y + n * h.z for h in hemi]
            cen = mw @ poly.center
            for li in poly.loop_indices:
                p = wv[me.loops[li].vertex_index]
                s = p + (cen - p) * inset
                origin = s + n * eps
                hit = 0
                for dirv in dirs:
                    if ground is not None and dirv.z < -1e-4 and s.z >= ground - 1e-3 and (s.z - ground) / -dirv.z < d_max:
                        hit += 1
                        continue
                    if bvh.ray_cast(origin, dirv, d_max)[0] is not None:
                        hit += 1
                vis = 1 - hit / len(dirs)
                f = lo + (1 - lo) * (vis**power)
                hgt = min(1.0, max(0.0, (s.z - z0) / span))
                f *= grad[0] + (grad[1] - grad[0]) * hgt
                c = a.data[li].color
                a.data[li].color = (max(floor, c[0] * f), max(floor, c[1] * f), max(floor, c[2] * f), 1.0)
