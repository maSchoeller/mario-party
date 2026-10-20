"""Heroes + moderator as rigid-part rigs (ASSET-02, ART-02/03).

Usage:
  blender -b --factory-startup -P characters.py -- --out <dir> [--only <id>]
  blender -b --factory-startup -P characters.py -- --out <dir> --preview <png dir> [--only <id>]

Each figure is exported as one GLB whose meshes are grouped by rig part:
  body  (pivot 0,0,0)       head (pivot 0,1.15,0)
  armL  (pivot -0.48,0.8,0) armR (pivot 0.48,0.8,0)
The host parents every part to the matching bone node of CharacterRig and keeps the
procedural animations (idle, walk, jump, cheer, sad, hit, roll). Faces -Z (Babylon).

v0.3 detail pass: smooth-shaded organic parts (crisp facets stay on accessories),
eyes with pupils + highlights, tufts/brows/claws/accessories, and a soft baked ambient
occlusion + height gradient in the vertex colors (COLOR_0, 0.55..1.0). The host's
StandardMaterials multiply COLOR_0 into the palette diffuse color.
Budget: ≤ 4 000 triangles per hero, ≤ 5 000 for the moderator, ≤ 8 materials each.

All geometry here is generated in Babylon space and converted with lib.B(); the
helpers below bake every transform into the vertices (objects keep identity
transforms), so orientation is given as direction vectors instead of Euler angles.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import B  # noqa: E402

HEAD_Y = 1.15
ARM = (0.48, 0.8)
TAU = math.tau

WHITE = 'c_ffffff'
INK = 'c_1d1b2a'
BLUSH = 'c_f3a3b0'


def H(x, y, z):
    """Head-local -> rig space."""
    return (x, HEAD_Y + y, z)


def A(side, x, y, z):
    return (side * ARM[0] + side * x, ARM[1] + y, z)


def arm_name(side):
    return 'armL' if side < 0 else 'armR'


V = lambda *a: Vector(a[0] if len(a) == 1 else a)  # noqa: E731


# --- geometry helpers (Babylon space) --------------------------------------------------


def _new_object(group, mat, me):
    o = bpy.data.objects.new(f'{group}__{mat}', me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(lib.material(mat))
    return o


def _tag(o, smooth, shade, ao):
    o['smooth'] = bool(smooth)
    o['shade'] = float(shade)
    o['ao'] = float(ao)
    return o


def frame(fwd=None, axis=None, up=(0, 1, 0), roll=0.0):
    """Orthonormal basis (columns x, y, z) in Babylon space.
    fwd : direction local -Z (the 'front') should face.
    axis: direction local +Y should point (cones/cylinders); fwd then only hints the front.
    """
    if axis is not None:
        y = V(axis).normalized()
        hint = V(fwd) if fwd is not None else V(0, 0, -1)
        z = -(hint - y * hint.dot(y))
        if z.length < 1e-5:
            alt = V(0, 1, 0) if abs(y.y) < 0.9 else V(1, 0, 0)
            z = alt - y * alt.dot(y)
        z.normalize()
    else:
        z = -V(fwd if fwd is not None else (0, 0, -1)).normalized()
        u = V(up)
        y = u - z * u.dot(z)
        if y.length < 1e-5:
            y = V(0, 0, 1) - z * z.z
        y.normalize()
    x = y.cross(z)
    M = Matrix((x, y, z)).transposed()
    if roll:
        M = M @ Matrix.Rotation(roll, 3, 'Z')
    return M


def part(kind, group, mat, loc, size=(1, 1, 1), fwd=None, axis=None, up=(0, 1, 0), roll=0.0,
         smooth=None, shade=1.0, ao=1.0, deform=None, jitter=0.0, seed=1, **kw):
    """Unit primitive -> scaled by `size` (local radii), oriented by frame(), moved to loc.
    kinds: ico(sub) · uv(seg, rings) · cyl(verts, r2: top radius ratio; height 1, centred) · cube · torus(minor, seg, mseg)
    deform(p) works on the unit local shape (Babylon axes) before scaling."""
    if kind == 'ico':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=kw.get('sub', 2), radius=1)
    elif kind == 'uv':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=kw.get('seg', 16), ring_count=kw.get('rings', 10), radius=1)
    elif kind == 'cyl':
        bpy.ops.mesh.primitive_cone_add(vertices=kw.get('verts', 8), radius1=1, radius2=kw.get('r2', 1.0), depth=1)
    elif kind == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == 'torus':
        bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=kw.get('minor', 0.2),
                                         major_segments=kw.get('seg', 16), minor_segments=kw.get('mseg', 6))
    else:
        raise ValueError(kind)
    o = bpy.context.active_object
    if smooth is None:
        smooth = kind in ('ico', 'uv', 'torus')
    M = frame(fwd, axis, up, roll)
    S = V(size)
    L = V(loc)
    rnd = random.Random(seed)
    for v in o.data.vertices:
        p = Vector((-v.co.x, v.co.z, -v.co.y))  # Blender local -> Babylon local
        if deform:
            p = Vector(deform(p))
        if jitter:
            p += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter
        q = M @ Vector((p.x * S.x, p.y * S.y, p.z * S.z)) + L
        v.co = B(*q)
    o.data.update()
    o.name = f'{group}__{mat}'
    o.data.materials.clear()
    o.data.materials.append(lib.material(mat))
    return _tag(o, smooth, shade, ao)


def spline(pts, n=4):
    """Catmull-Rom through pts, n samples per segment."""
    P = [V(p) for p in pts]
    out = []
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i > 0 else P[i] * 2 - P[i + 1]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else P[i + 1] * 2 - P[i]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(P[-1])
    return out


def tube(group, mat, pts, radius, verts=8, up=(0, 1, 0), flat=1.0, smooth=True, shade=1.0, ao=1.0, caps=True):
    """Swept tube along pts (Babylon). radius: float, list or f(t). flat squashes the
    cross-section along `up` (parallel-transported along the path)."""
    P = [V(p) for p in pts]
    n = len(P)
    if callable(radius):
        R = [radius(i / (n - 1)) for i in range(n)]
    elif isinstance(radius, (list, tuple)):
        R = list(radius)
    else:
        R = [radius] * n
    T = []
    for i in range(n):
        d = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        T.append(d.normalized())
    u = V(up)
    N = [u - T[0] * u.dot(T[0])]
    if N[0].length < 1e-5:
        N[0] = V(1, 0, 0) - T[0] * T[0].x
    N[0].normalize()
    for i in range(1, n):
        q = T[i - 1].rotation_difference(T[i])
        m = q @ N[i - 1]
        m = (m - T[i] * m.dot(T[i])).normalized()
        N.append(m)
    bm = bmesh.new()
    rings = []
    for i in range(n):
        Bn = T[i].cross(N[i])
        ring = []
        for k in range(verts):
            a = k / verts * TAU
            p = P[i] + (Bn * math.cos(a) + N[i] * math.sin(a) * flat) * R[i]
            ring.append(bm.verts.new(B(*p)))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(verts):
            k2 = (k + 1) % verts
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    if caps:
        for i, ring in ((0, rings[0]), (n - 1, rings[-1])):
            if R[i] > 1e-4:
                c = bm.verts.new(B(*P[i]))
                for k in range(verts):
                    bm.faces.new((ring[k], ring[(k + 1) % verts], c))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('tube')
    bm.to_mesh(me)
    bm.free()
    o = _new_object(group, mat, me)
    if not caps:
        o['occ'] = False
    return _tag(o, smooth, shade, ao)


class Ell:
    """Ellipsoid helper to put things onto a head/body surface."""

    def __init__(self, c, r):
        self.c = V(c)
        self.r = V(r)

    def at(self, yaw, pitch, out=0.0):
        """Surface point + normal in direction (yaw: 0 = front -Z, + = +X; pitch: + = up)."""
        d = V(math.sin(yaw) * math.cos(pitch), math.sin(pitch), -math.cos(yaw) * math.cos(pitch))
        t = 1 / math.sqrt(sum((d[i] / self.r[i]) ** 2 for i in range(3)))
        p = self.c + d * t
        n = V(*((p - self.c)[i] / self.r[i] ** 2 for i in range(3))).normalized()
        return p + n * out, n


def taper(k, axis='y'):
    """deform: shrink x/z (or x/y) towards +axis end (teardrop / rounded triangle)."""
    def f(p):
        if axis == 'y':
            s = 1 - k * (p.y + 1) / 2
            return (p.x * s, p.y, p.z * s)
        s = 1 - k * (-p.z + 1) / 2  # towards -z (front)
        return (p.x * s, p.y * s, p.z)
    return f


def pear(k):
    """deform: wider bottom."""
    return lambda p: (p.x * (1 - k * p.y), p.y, p.z * (1 - k * 0.6 * p.y))


# --- reusable features -----------------------------------------------------------------


def eyes(ell, yaw, pitch, size, pupil=INK, white=WHITE, group='head', look=(0.0, 0.0), flatten=0.55,
         pupil_scale=0.64, tall=1.15):
    """Glossy cartoon eyes: white + big pupil + two highlights (highlights skip AO)."""
    for s in (-1, 1):
        p, n = ell.at(s * yaw, pitch)
        F = frame(fwd=n)
        ex, ey = F.col[0], F.col[1]
        cw = p - n * size * 0.22
        part('ico', group, white, cw, size=(size, size * tall, size * flatten), fwd=n, sub=2)
        front = cw + n * size * flatten
        pc = front + ex * (look[0] * size) + ey * (look[1] * size) - n * size * 0.13
        ps = size * pupil_scale
        part('ico', group, pupil, pc, size=(ps, ps * tall, ps * 0.42), fwd=n, sub=2)
        hl = pc + n * ps * 0.36 + ex * (-0.32 * ps) + ey * (0.38 * ps)
        part('ico', group, WHITE, hl, size=(ps * 0.3, ps * 0.33, ps * 0.14), fwd=n, sub=1, ao=0)
        hl2 = pc + n * ps * 0.38 + ex * (0.3 * ps) + ey * (-0.34 * ps)
        part('ico', group, WHITE, hl2, size=(ps * 0.13, ps * 0.13, ps * 0.07), fwd=n, sub=1, ao=0)


def cheeks(ell, yaw, pitch, size=0.075, mat=BLUSH):
    for s in (-1, 1):
        p, n = ell.at(s * yaw, pitch)
        part('ico', 'head', mat, p - n * 0.012, size=(size, size * 0.68, size * 0.3), fwd=n, sub=2)


def brows(ell, yaw, pitch, mat, length=0.11, r=0.018, tilt=0.15, arch=0.02, out=0.0):
    """Short arched brows; tilt > 0 raises the outer end."""
    span = length / max(ell.r.x, 0.2)
    for s in (-1, 1):
        pts = []
        for k in range(5):
            t = k / 4 - 0.5
            pp = pitch + t * tilt + arch * (1 - (2 * t) ** 2) / max(ell.r.y, 0.2)
            pts.append(ell.at(s * (yaw + t * span), pp, out=r * 0.4 + out)[0])
        tube('head', mat, pts, lambda t: r * (0.55 + 0.45 * math.sin(math.pi * t)), verts=6)


def smile(ell, width, pitch, mat=INK, r=0.014, depth=0.05, out=0.0, wmouth=False):
    """Little smile along the surface of `ell` (yaw ±width). wmouth: cat-like 'w'."""
    pts = []
    N = 9
    for k in range(N):
        t = k / (N - 1) * 2 - 1
        if wmouth:
            dy = -depth * (1 - abs(abs(t) * 2 - 1)) * 0.9 + depth * 0.25 * abs(t) ** 3
        else:
            dy = -depth * (1 - t * t)
        pts.append(ell.at(t * width, pitch + dy / ell.r.y, out=out)[0])
    tube('head', mat, pts, lambda t: r * (0.5 + 0.5 * math.sin(math.pi * t)), verts=6)


def nose(ell, yaw, pitch, mat, size=(0.07, 0.05, 0.05), hl=True):
    p, n = ell.at(yaw, pitch)
    part('ico', 'head', mat, p, size=size, fwd=n, sub=2)
    if hl:
        F = frame(fwd=n)
        part('ico', 'head', WHITE, p + n * size[2] * 0.85 + F.col[1] * size[1] * 0.35 - F.col[0] * size[0] * 0.25,
             size=(size[0] * 0.28, size[1] * 0.22, size[2] * 0.12), fwd=n, sub=1, ao=0)


def tufts(group, mat, base, dirs, length=0.12, r=0.045, verts=4, shade=1.0):
    """Little flat-shaded fur tufts (cones) from base along dirs."""
    for d in dirs:
        d = V(d).normalized()
        part('cyl', group, mat, V(base) + d * length * 0.5, size=(r, length, r), axis=d, verts=verts, r2=0.0,
             shade=shade)


def torso(mat, r=0.53, size=(1, 1.05, 0.9), y=0.6, k=0.08):
    part('ico', 'body', mat, (0, y, 0), size=(r * size[0], r * size[1], r * size[2]), sub=3, deform=pear(k))
    return Ell((0, y, 0), (r * size[0], r * size[1], r * size[2]))


def belly(mat, loc=(0, 0.56, -0.2), size=(0.36, 0.4, 0.22), shade=1.0):
    part('ico', 'body', mat, loc, size=size, sub=3, shade=shade)


def feet(mat, toes=3, size=(0.19, 0.1, 0.25), x=0.26, z=-0.14, toe_mat=None, toe_r=0.06, claws=None):
    for s in (-1, 1):
        c = V(s * x, 0.1, z)
        part('uv', 'body', mat, c, size=size, seg=14, rings=8, deform=taper(0.12, 'z'))
        if toes:
            for k in range(toes):
                t = (k - (toes - 1) / 2) / max(toes - 1, 1)
                tp = c + V(t * size[0] * 1.1, -0.02, -size[2] * 0.82)
                part('ico', 'body', toe_mat or mat, tp, size=(toe_r, toe_r * 0.8, toe_r * 1.1), sub=1)
                if claws:
                    part('cyl', 'body', claws, tp + V(0, 0.0, -toe_r * 0.9), size=(0.02, 0.06, 0.02),
                         axis=(0, -0.3, -1), verts=4, r2=0.0)


def arms(mat, hand=None, upper=(0.14, 0.24, 0.14), hand_r=0.1, fingers=0, finger_mat=None, claws=None, sleeve=None):
    for s in (-1, 1):
        g = arm_name(s)
        part('uv', g, mat, A(s, 0.0, -0.17, 0), size=upper, seg=12, rings=8, deform=taper(-0.15))
        hc = V(A(s, 0.025, -0.37, -0.02))
        part('ico', g, hand or mat, hc, size=(hand_r, hand_r * 1.05, hand_r), sub=2)
        for k in range(fingers):
            t = (k - (fingers - 1) / 2) * 0.55
            fp = hc + V(s * hand_r * 0.35, -hand_r * 0.6, t * hand_r * 0.9)
            part('ico', g, finger_mat or hand or mat, fp, size=(0.042, 0.05, 0.042), sub=1)
            if claws:
                part('cyl', g, claws, fp + V(s * 0.012, -0.05, 0), size=(0.016, 0.05, 0.016), axis=(s * 0.3, -1, 0),
                     verts=4, r2=0.0)
        if sleeve:
            part('torus', g, sleeve, V(A(s, 0.015, -0.29, -0.01)), size=(0.115, 0.13, 0.115), minor=0.32, seg=14,
                 mseg=6, axis=(s * 0.12, 1, 0))


# --- finalize: AO + gradient into COLOR_0, smooth/flat shading, join, export ------------------

_HEMI = []


def _hemi(K=28):
    if not _HEMI:
        ga = math.pi * (3 - math.sqrt(5))
        for i in range(K):
            u = (i + 0.5) / K
            r = math.sqrt(u)
            th = i * ga
            _HEMI.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - u)))))
    return _HEMI


def _bvh(objs):
    verts, polys = [], []
    for o in objs:
        off = len(verts)
        verts += [v.co.copy() for v in o.data.vertices]
        polys += [[off + i for i in p.vertices] for p in o.data.polygons]
    # ground (Babylon y = 0) so feet and the lower body get grounded
    off = len(verts)
    verts += [Vector((-4, -4, 0)), Vector((4, -4, 0)), Vector((4, 4, 0)), Vector((-4, 4, 0))]
    polys.append([off, off + 1, off + 2, off + 3])
    return BVHTree.FromPolygons(verts, polys)


def bake_colors(objs, maxd=0.3, strength=0.5):
    """Ambient occlusion (ray cast) * height gradient * per-part shade -> point color 'Col'.
    Body/head ignore the arms as occluders (arms swing, a baked arm shadow would stick)."""
    full = _bvh(objs)
    noarms = _bvh([o for o in objs if not o.name.startswith('arm')])
    hemi = _hemi()
    up = Vector((0, 0, 1))
    for o in objs:
        me = o.data
        shade = o.get('shade', 1.0)
        aok = o.get('ao', 1.0)
        tree = full if o.name.startswith('arm') else noarms
        cols = []
        for v in me.vertices:
            if aok <= 0:
                cols.append(1.0)
                continue
            n = v.normal
            q = up.rotation_difference(n) if n.length > 0.5 else None
            org = v.co + n * 0.002
            occ = 0.0
            for d in hemi:
                dd = q @ d if q else d
                hit = tree.ray_cast(org, dd, maxd)
                if hit[0] is not None:
                    occ += 1 - hit[3] / maxd
            ao = 1 - strength * aok * occ / len(hemi)
            y = v.co.z  # Babylon height
            t = min(1.0, max(0.0, y / 1.25))
            grad = 0.87 + 0.13 * (t * t * (3 - 2 * t))
            cols.append(max(0.55, min(1.0, ao * grad * shade)))
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(cols):
            attr.data[i].color = (c, c, c, 1.0)


def cull_hidden(objs, margin=0.004):
    """Delete faces buried inside another closed part of the same rig group (never seen,
    the parts of one group move rigidly together)."""
    trees = {}
    for o in objs:
        if not o.get('occ', True):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        cos = [v.co for v in o.data.vertices]
        lo = Vector([min(c[i] for c in cos) for i in range(3)])
        hi = Vector([max(c[i] for c in cos) for i in range(3)])
        trees[o.name] = (BVHTree.FromBMesh(bm), o.name.split('__')[0], (lo, hi))
        bm.free()
    removed = 0
    for o in objs:
        group = o.name.split('__')[0]
        others = [(t, bb) for name, (t, g, bb) in trees.items() if g == group and name != o.name]
        inside = []
        for v in o.data.vertices:
            p = v.co
            hit = False
            for t, (lo, hi) in others:
                if not (lo.x - 0.01 <= p.x <= hi.x + 0.01 and lo.y - 0.01 <= p.y <= hi.y + 0.01
                        and lo.z - 0.01 <= p.z <= hi.z + 0.01):
                    continue
                loc, nrm, _i, dist = t.find_nearest(p)
                if loc is not None and (p - loc).dot(nrm) < 0 and dist > margin:
                    hit = True
                    break
            inside.append(hit)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.verts.ensure_lookup_table()
        dead = [f for f in bm.faces if all(inside[v.index] for v in f.verts)]
        removed += sum(len(f.verts) - 2 for f in dead)
        bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    return removed


def finalize_characters(out_path, triangle_budget):
    scene = bpy.context.scene
    objs = [o for o in scene.objects if o.type == 'MESH']
    for o in objs:
        for p in o.data.polygons:
            p.use_smooth = bool(o.get('smooth', False))
        o.data.update()
    bake_colors(objs)
    hidden = cull_hidden(objs)
    objs = [o for o in objs if len(o.data.polygons)]
    for o in [o for o in scene.objects if o.type == 'MESH' and not len(o.data.polygons)]:
        bpy.data.objects.remove(o)

    groups = {}
    for o in objs:
        groups.setdefault(o.name.split('.')[0], []).append(o)
    for key, members in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in members:
            o.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        if len(members) > 1:
            bpy.ops.object.join()
        j = bpy.context.active_object
        j.name = key
        j.data.name = key
    bpy.ops.object.select_all(action='DESELECT')

    tris, mats = {}, set()
    for o in [o for o in scene.objects if o.type == 'MESH']:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(o.data)
        bm.free()
        me = o.data
        me.color_attributes.active_color_name = 'Col'
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
        group, mat = o.name.split('__')
        mats.add(mat)
        tris[group] = tris.get(group, 0) + len(me.polygons)

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
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
    )
    total = sum(tris.values())
    print(f'[asset] {out_path}: {total} triangles {tris} · {len(mats)} materials {sorted(mats)} · culled {hidden}')
    if total > triangle_budget:
        print(f'[asset] ERROR budget {triangle_budget} exceeded', file=sys.stderr)
        sys.exit(2)
    if len(mats) > 8:
        print(f'[asset] ERROR more than 8 materials ({len(mats)})', file=sys.stderr)
        sys.exit(2)
    return tris


# --- heroes ------------------------------------------------------------------------


def rocco():
    """Waschbär: grey, bandit mask, white cheek fluff, ringed tail."""
    c = {'body': 'c_a3a1b0', 'belly': 'c_ecebf2', 'dark': 'c_3d3a4a', 'accent': 'c_6c6a7a'}
    torso(c['body'], k=0.08)
    belly(c['belly'], loc=(0, 0.55, -0.27), size=(0.34, 0.38, 0.24))
    feet(c['dark'], toes=3, toe_r=0.055)
    arms(c['body'], hand=c['dark'], fingers=3, upper=(0.13, 0.24, 0.13))
    head = Ell(H(0, 0, 0), (0.5, 0.41, 0.44))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    # white face blaze + snout
    blaze = Ell(H(0, -0.09, -0.25), (0.37, 0.24, 0.24))
    part('ico', 'head', c['belly'], blaze.c, size=blaze.r, sub=3)
    snout = Ell(H(0, -0.11, -0.4), (0.13, 0.095, 0.1))
    part('ico', 'head', c['belly'], snout.c, size=snout.r, sub=2)
    nose(snout, 0, 0.55, c['dark'], size=(0.06, 0.042, 0.045))
    smile(snout, 0.55, -0.45, mat=c['dark'], r=0.011, depth=0.025, wmouth=True)
    # bandit mask: dark patches slanting down to the sides + white brows above
    for s in (-1, 1):
        p, n = head.at(s * 0.4, 0.14)
        part('ico', 'head', c['dark'], p - n * 0.06, size=(0.18, 0.12, 0.1), fwd=n, up=(-s * 0.12, 1, 0), sub=2)
        p, n = head.at(s * 0.36, 0.42)
        part('ico', 'head', c['belly'], p - n * 0.02, size=(0.09, 0.04, 0.04), fwd=n, up=(-s * 0.25, 1, 0), sub=2)
    eyes(head, 0.36, 0.13, 0.088, flatten=0.6)
    cheeks(head, 0.6, -0.17, size=0.06)
    # cheek fluff (sideways tufts)
    for s in (-1, 1):
        p, n = head.at(s * 1.25, -0.28)
        tufts('head', c['belly'], p - n * 0.05, [(s, -0.35, -0.2), (s, -0.8, -0.1), (s * 0.8, 0.05, -0.1)],
              length=0.2, r=0.075, verts=4)
    # rounded ears with light inner part
    for s in (-1, 1):
        p, n = head.at(s * 0.62, 0.95)
        ax = V(s * 0.45, 1, 0.05)
        part('ico', 'head', c['accent'], p + ax.normalized() * 0.06, size=(0.15, 0.16, 0.06), axis=ax, sub=2,
             deform=taper(0.5))
        part('ico', 'head', c['belly'], p + ax.normalized() * 0.06 + V(0, 0, -0.035), size=(0.09, 0.11, 0.035),
             axis=ax, sub=2, deform=taper(0.5))
    # forehead tuft
    p, n = head.at(0, 1.25)
    tufts('head', c['body'], p - n * 0.03, [(0, 1, -0.3), (0.35, 1, -0.1), (-0.35, 1, -0.1)], length=0.12, r=0.045)
    # ringed tail curving up
    pts = spline([(0, 0.32, 0.4), (0, 0.4, 0.75), (0, 0.7, 1.0), (0, 1.05, 1.02), (0, 1.25, 0.9)], 4)
    n_ = len(pts) - 1
    rad = lambda t: 0.13 + 0.09 * math.sin(math.pi * min(1, t * 1.3)) - 0.04 * t  # noqa: E731
    R = [rad(i / n_) for i in range(len(pts))]
    R[-1] *= 0.6
    tube('body', c['body'], pts, R, verts=12)
    for a, b in ((3, 5), (7, 9), (11, 13), (14, 16)):
        tube('body', c['dark'], pts[a:b + 1], [R[i] * 1.07 for i in range(a, b + 1)], verts=12)
    lib_finalize('rocco', 4000)


def quaki():
    """Frosch: wide head, eyes on bumps, wide smile, spots, crooked golden crown."""
    c = {'body': 'c_7cc56f', 'belly': 'c_d8efc5', 'spot': 'c_6fb262'}
    gold = 'glow_f2c94c'
    torso(c['body'], k=0.14)
    belly(c['belly'], loc=(0, 0.53, -0.27), size=(0.38, 0.4, 0.24))
    # webbed feet: three long toes with round pads
    for s in (-1, 1):
        base = V(s * 0.26, 0.07, -0.12)
        part('uv', 'body', c['body'], base, size=(0.2, 0.08, 0.2), seg=14, rings=8)
        for k in (-1, 0, 1):
            d = V(s * 0.1 + k * 0.42, 0, -1).normalized()
            tip = base + d * 0.3 + V(0, -0.025, 0)
            tube('body', c['body'], [base + d * 0.05, tip], [0.065, 0.045], verts=8, up=(0, 1, 0), flat=0.6)
            part('ico', 'body', c['spot'], tip, size=(0.05, 0.035, 0.05), sub=2)
    for s in (-1, 1):
        g = arm_name(s)
        part('uv', g, c['body'], A(s, 0.0, -0.17, 0), size=(0.13, 0.24, 0.13), seg=12, rings=8, deform=taper(-0.15))
        hc = V(A(s, 0.025, -0.37, -0.02))
        part('ico', g, c['body'], hc, size=(0.095, 0.08, 0.1), sub=2)
        for k in (-1, 0, 1):
            part('ico', g, c['spot'], hc + V(s * 0.03, -0.065, k * 0.065), size=(0.035, 0.03, 0.035), sub=1)
    head = Ell(H(0, -0.05, 0), (0.6, 0.36, 0.5))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    jaw = Ell(H(0, -0.18, -0.17), (0.5, 0.18, 0.33))
    part('ico', 'head', c['belly'], jaw.c, size=jaw.r, sub=3)
    bumps = []
    for s in (-1, 1):
        e = Ell(H(s * 0.24, 0.24, -0.12), (0.18, 0.17, 0.17))
        part('ico', 'head', c['body'], e.c, size=e.r, sub=2)
        bumps.append(e)
    for s, e in zip((-1, 1), bumps):
        p, n = e.at(s * 0.25, 0.12)
        F = frame(fwd=n)
        sz = 0.13
        cw = p - n * sz * 0.3
        part('ico', 'head', WHITE, cw, size=(sz, sz * 1.1, sz * 0.62), fwd=n, sub=2)
        front = cw + n * sz * 0.62
        pc = front - n * sz * 0.14
        ps = sz * 0.6
        part('ico', 'head', INK, pc, size=(ps, ps * 1.1, ps * 0.42), fwd=n, sub=2)
        part('ico', 'head', WHITE, pc + n * ps * 0.36 - F.col[0] * ps * 0.32 + F.col[1] * ps * 0.38,
             size=(ps * 0.3, ps * 0.33, ps * 0.14), fwd=n, sub=1, ao=0)
        part('ico', 'head', WHITE, pc + n * ps * 0.38 + F.col[0] * ps * 0.3 - F.col[1] * ps * 0.34,
             size=(ps * 0.13, ps * 0.13, ps * 0.07), fwd=n, sub=1, ao=0)
    smile(head, 0.62, -0.32, mat=INK, r=0.016, depth=0.07)
    for s in (-1, 1):
        p, n = head.at(s * 0.09, 0.02)
        part('ico', 'head', INK, p, size=(0.018, 0.012, 0.012), fwd=n, sub=1)
    cheeks(head, 0.75, -0.18, size=0.075)
    # spots on head and back
    for (yaw, pitch, sz) in ((0.0, 1.1, 0.07), (2.5, 0.6, 0.09), (-2.2, 0.4, 0.06), (1.4, 0.5, 0.05), (-1.3, 0.75, 0.06)):
        p, n = head.at(yaw, pitch)
        part('ico', 'head', c['spot'], p - n * 0.008, size=(sz, sz * 0.8, sz * 0.25), fwd=n, sub=2)
    body = Ell((0, 0.6, 0), (0.53, 0.556, 0.477))
    for (yaw, pitch, sz) in ((2.8, 0.3, 0.1), (3.5, -0.2, 0.08), (2.2, -0.1, 0.07), (4.0, 0.35, 0.07), (1.7, 0.4, 0.05), (4.6, -0.1, 0.06)):
        p, n = body.at(yaw, pitch)
        part('ico', 'body', c['spot'], p - n * 0.008, size=(sz, sz * 0.8, sz * 0.25), fwd=n, sub=2)
    # crown, tilted jauntily
    up = V(0.18, 1, 0.08).normalized()
    cc = V(H(0.04, 0.33, 0.06))
    part('cyl', 'head', gold, cc, size=(0.2, 0.13, 0.2), axis=up, verts=10, r2=1.12)
    F = frame(axis=up)
    for i in range(5):
        a = i / 5 * TAU + 0.3
        rv = F.col[0] * math.cos(a) + F.col[2] * math.sin(a)
        base = cc + up * 0.06 + rv * 0.2
        part('cyl', 'head', gold, base + up * 0.07, size=(0.055, 0.14, 0.055), axis=up + rv * 0.15, verts=4, r2=0.0)
        part('ico', 'head', gold, base + up * 0.15 + rv * 0.012, size=(0.03, 0.03, 0.03), sub=1)
    part('ico', 'head', 'c_e8676b', cc - F.col[2] * 0.21 + up * 0.01, size=(0.05, 0.05, 0.03), fwd=-F.col[2], sub=1,
         smooth=False)
    for s in (-1, 1):
        rv = (F.col[0] * s * 0.7 - F.col[2] * 0.7).normalized()
        part('ico', 'head', 'c_e8676b', cc + rv * 0.215, size=(0.03, 0.03, 0.02), fwd=rv, sub=1, smooth=False)
    lib_finalize('quaki', 4000)


def pingo():
    """Pinguin: heart face, bobble hat, striped scarf with fringe, orange feet."""
    c = {'body': 'c_2f3552', 'belly': 'c_f1f0f4', 'dark': 'c_1b1e2e', 'accent': 'c_e8676b', 'beak': 'c_f4a259'}
    part('ico', 'body', c['body'], (0, 0.62, 0), size=(0.55, 0.6, 0.5), sub=3, deform=pear(0.12))
    part('ico', 'body', c['belly'], (0, 0.55, -0.26), size=(0.4, 0.48, 0.29), sub=3)
    feet(c['beak'], toes=3, size=(0.18, 0.08, 0.22), toe_r=0.06)
    # flippers
    for s in (-1, 1):
        g = arm_name(s)
        part('ico', g, c['body'], A(s, 0.05, -0.24, 0), size=(0.075, 0.3, 0.16), axis=(s * 0.35, -1, 0), sub=3,
             deform=taper(0.35))
    # tail
    part('cyl', 'body', c['body'], (0, 0.18, 0.45), size=(0.12, 0.2, 0.06), axis=(0, -0.5, 1), verts=6, r2=0.0)
    head = Ell(H(0, 0, 0), (0.46, 0.42, 0.42))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    for s in (-1, 1):
        p, n = head.at(s * 0.32, -0.05)
        part('ico', 'head', c['belly'], p - n * 0.085, size=(0.21, 0.27, 0.14), fwd=n, up=(-s * 0.25, 1, 0), sub=3)
    face = Ell(H(0, -0.02, -0.08), (0.4, 0.34, 0.36))
    eyes(face, 0.36, 0.08, 0.095, pupil=c['dark'], white=c['belly'], flatten=0.6)
    # beak: upper + lower
    p, n = face.at(0, -0.22)
    part('ico', 'head', c['beak'], p + V(0, 0.01, -0.06), size=(0.14, 0.075, 0.16), sub=2, deform=taper(0.55, 'z'))
    part('ico', 'head', c['beak'], p + V(0, -0.055, -0.04), size=(0.1, 0.05, 0.12), sub=2, deform=taper(0.5, 'z'),
         shade=0.8)
    cheeks(face, 0.62, -0.2, size=0.065)
    # bobble hat (red) with white turn-up, white stripe and fluffy pom-pom
    part('ico', 'head', c['accent'], H(0, 0.2, 0.02), size=(0.44, 0.37, 0.42), sub=3,
         deform=lambda p: (p.x * (1 - 0.12 * max(p.y, 0)), max(p.y, 0.0), p.z * (1 - 0.12 * max(p.y, 0))))
    part('torus', 'head', c['belly'], H(0, 0.22, 0.02), size=(0.43, 0.55, 0.41), minor=0.15, seg=24, mseg=8)
    part('torus', 'head', c['belly'], H(0, 0.39, 0.02), size=(0.36, 0.45, 0.34), minor=0.075, seg=20, mseg=6)
    part('ico', 'head', c['belly'], H(0, 0.62, 0.03), size=(0.12, 0.12, 0.12), sub=2, smooth=False, jitter=0.012,
         seed=3)
    # scarf ring with stripes + hanging end with fringe
    ring = [(0.36 * math.sin(a), 0.98 + 0.03 * math.cos(a), -0.33 * math.cos(a)) for a in [i / 24 * TAU for i in range(25)]]
    tube('body', c['accent'], ring, 0.1, verts=10, caps=False)
    for a0 in (0.45, 1.15, 2.6, 3.7, 5.1):
        arc = [(0.37 * math.sin(a), 0.98 + 0.03 * math.cos(a), -0.34 * math.cos(a)) for a in (a0, a0 + 0.06, a0 + 0.12)]
        tube('body', c['belly'], arc, 0.105, verts=10)
    hang = spline([(0.2, 0.96, -0.38), (0.26, 0.82, -0.44), (0.3, 0.62, -0.43)], 3)
    tube('body', c['accent'], hang, 0.09, verts=8, up=(0, 0, -1), flat=0.32)
    for k in (0.3, 0.6):
        q = hang[int(k * (len(hang) - 1))]
        tube('body', c['belly'], [q, q + V(0.012, -0.035, 0)], 0.093, verts=8, up=(0, 0, -1), flat=0.34)
    end = V(hang[-1])
    for k in (-1, 0, 1):
        tufts('body', c['accent'], end + V(k * 0.055, 0.01, 0), [(k * 0.1, -1, 0)], length=0.08, r=0.022)
    lib_finalize('pingo', 4000)


def foxy():
    """Fuchs: big ears with dark tips, pointy muzzle, cheek fluff, bushy white-tipped tail."""
    c = {'body': 'c_f0a050', 'belly': 'c_fbf1e4', 'dark': 'c_3a2a22', 'accent': 'c_f6c08a'}
    torso(c['body'], k=0.08)
    belly(c['belly'], loc=(0, 0.55, -0.27), size=(0.33, 0.4, 0.24))
    feet(c['dark'], toes=3, toe_r=0.055)
    arms(c['body'], hand=c['dark'], upper=(0.13, 0.24, 0.13))
    head = Ell(H(0, 0.02, 0), (0.5, 0.41, 0.43))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    # muzzle: white, tapering to the front
    mz = Ell(H(0, -0.1, -0.32), (0.25, 0.15, 0.3))
    part('ico', 'head', c['belly'], mz.c, size=mz.r, sub=3, deform=taper(0.72, 'z'))
    for s in (-1, 1):
        p, n = head.at(s * 0.5, -0.32)
        part('ico', 'head', c['belly'], p - n * 0.07, size=(0.17, 0.13, 0.12), fwd=n, sub=2)
    tip = V(H(0, -0.075, -0.615))
    part('ico', 'head', c['dark'], tip, size=(0.06, 0.045, 0.045), sub=2)
    part('ico', 'head', WHITE, tip + V(-0.018, 0.022, -0.03), size=(0.016, 0.01, 0.008), sub=1, ao=0)
    tube('head', c['dark'], spline([H(-0.065, -0.125, -0.47), H(-0.032, -0.152, -0.505), H(0, -0.138, -0.52),
                                    H(0.032, -0.152, -0.505), H(0.065, -0.125, -0.47)], 2),
         lambda t: 0.011 * (0.5 + 0.5 * math.sin(math.pi * t)), verts=6)
    eyes(head, 0.36, 0.14, 0.092, pupil=c['dark'], flatten=0.6)
    cheeks(head, 0.62, -0.08, size=0.06)
    # cheek fluff
    for s in (-1, 1):
        p, n = head.at(s * 1.3, -0.35)
        tufts('head', c['belly'], p - n * 0.05, [(s, -0.4, -0.15), (s, -0.9, -0.05), (s * 0.9, 0.1, 0)],
              length=0.21, r=0.075)
    # ears: rounded triangles with inner + dark tip
    for s in (-1, 1):
        ax = V(s * 0.28, 1, 0.02).normalized()
        base = V(H(s * 0.27, 0.3, 0.0))
        part('ico', 'head', c['body'], base + ax * 0.2, size=(0.17, 0.3, 0.075), axis=ax, sub=3, deform=taper(0.8))
        part('ico', 'head', c['accent'], base + ax * 0.17 + V(0, 0, -0.045), size=(0.1, 0.21, 0.04), axis=ax, sub=2,
             deform=taper(0.8))
        part('ico', 'head', c['dark'], base + ax * 0.4, size=(0.085, 0.11, 0.07), axis=ax, sub=2, deform=taper(0.75))
    p, n = head.at(0, 1.1)
    tufts('head', c['body'], p - n * 0.03, [(0, 0.8, -1), (0.4, 0.8, -1), (-0.4, 0.8, -1)], length=0.13, r=0.05)
    # bushy tail, swinging up, white tip growing out of the orange fur
    pts = spline([(0, 0.28, 0.38), (0.02, 0.36, 0.72), (0.06, 0.62, 0.98), (0.1, 0.98, 1.06), (0.12, 1.3, 0.98)], 5)
    n_ = len(pts) - 1
    rad = lambda t: 0.09 + 0.25 * math.sin(math.pi * min(1.0, 0.1 + t * 0.88)) ** 0.75  # noqa: E731
    R = [rad(i / n_) * (1 + 0.025 * math.sin(i * 1.9)) for i in range(len(pts))]
    R[-1] = 0.0
    tube('body', c['body'], pts, R, verts=14)
    k0 = int(n_ * 0.66)
    m = n_ - k0
    tube('body', c['belly'], pts[k0:], [R[k0 + j] * (0.9 + 0.17 * min(1, j / (m * 0.35))) for j in range(m + 1)],
         verts=14)
    d = (V(pts[-1]) - V(pts[-2])).normalized()
    tufts('body', c['belly'], V(pts[-2]), [d, d + V(0.5, 0, 0.2), d + V(-0.5, 0, 0.2)], length=0.12, r=0.05)
    for i in (5, 9, 13):
        p0, p1 = V(pts[i]), V(pts[i + 1])
        tng = (p1 - p0).normalized()
        outer = tng.cross(V(1, 0, 0)).normalized()
        if outer.y < 0:
            outer = -outer
        tufts('body', c['body'], p0 + outer * R[i] * 0.7, [outer + tng * 0.8], length=0.17, r=0.07)
    lib_finalize('foxy', 4000)


def bruno():
    """Bär: big round body, small round ears, tan muzzle, red polka-dot bandana."""
    c = {'body': 'c_9a6440', 'belly': 'c_e8c79a', 'dark': 'c_3a2a22', 'accent': 'c_d9483b'}
    part('ico', 'body', c['body'], (0, 0.6, 0), size=(0.6, 0.56, 0.52), sub=3, deform=pear(0.1))
    belly(c['belly'], loc=(0, 0.52, -0.31), size=(0.4, 0.38, 0.24))
    feet(c['body'], toes=3, size=(0.21, 0.11, 0.25), x=0.28, toe_r=0.065, claws=c['belly'])
    arms(c['body'], hand=c['body'], upper=(0.16, 0.25, 0.16), hand_r=0.12, fingers=3, claws=c['belly'])
    # stubby tail
    part('ico', 'body', c['body'], (0, 0.35, 0.5), size=(0.1, 0.1, 0.09), sub=2)
    head = Ell(H(0, 0.0, 0), (0.48, 0.42, 0.44))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    mz = Ell(H(0, -0.13, -0.33), (0.21, 0.15, 0.15))
    part('ico', 'head', c['belly'], mz.c, size=mz.r, sub=3)
    nose(mz, 0, 0.62, c['dark'], size=(0.085, 0.055, 0.06))
    p, n = mz.at(0, 0.0)
    tube('head', c['dark'], [p + V(0, 0.05, 0.01), p + V(0, -0.01, -0.005)], 0.011, verts=6)
    smile(mz, 0.42, -0.1, mat=c['dark'], r=0.012, depth=0.03, out=0.0, wmouth=True)
    eyes(head, 0.33, 0.14, 0.08, pupil=c['dark'], flatten=0.6)
    brows(head, 0.34, 0.42, c['dark'], length=0.1, r=0.02, tilt=-0.06)
    cheeks(head, 0.62, -0.12, size=0.07)
    # small round ears
    for s in (-1, 1):
        p, n = head.at(s * 0.75, 0.88)
        part('uv', 'head', c['body'], p, size=(0.14, 0.13, 0.08), fwd=n * 0.3 + V(0, 0, -1), seg=14, rings=8)
        part('uv', 'head', c['belly'], p + V(0, -0.005, -0.055), size=(0.085, 0.08, 0.04), fwd=(0, 0, -1), seg=12,
             rings=6)
    p, n = head.at(0, 1.2)
    tufts('head', c['body'], p - n * 0.03, [(0, 1, -0.25), (0.4, 1, 0), (-0.35, 1, -0.1)], length=0.11, r=0.045)
    # bandana: neck band + front triangle with white dots + knot at the back
    ring = [(0.4 * math.sin(a), 0.99 + 0.04 * math.cos(a), -0.37 * math.cos(a) + 0.02) for a in
            [i / 24 * TAU for i in range(25)]]
    tube('body', c['accent'], ring, 0.06, verts=8, caps=False)
    tri_c = V(0, 0.82, -0.47)
    part('cyl', 'body', c['accent'], tri_c, size=(0.28, 0.06, 0.28), axis=(0, 0.25, -1), fwd=(0, -1, 0), verts=3,
         roll=0, smooth=False,
         deform=lambda p: (p.x, p.y, p.z * 0.78))
    tn = V(0, 0.25, -1).normalized()
    for (dx, dy) in ((0.0, -0.12), (-0.1, 0.04), (0.1, 0.04), (0.0, 0.0)):
        part('ico', 'body', WHITE, tri_c + V(dx, dy, 0) + tn * 0.034, size=(0.026, 0.026, 0.01), fwd=tn, sub=1)
    part('ico', 'body', c['accent'], (0, 1.0, 0.39), size=(0.07, 0.06, 0.05), sub=2)
    for s in (-1, 1):
        tube('body', c['accent'], [(0, 0.99, 0.41), (s * 0.08, 0.9, 0.5), (s * 0.1, 0.8, 0.51)], [0.045, 0.04, 0.03],
             verts=6, up=(0, 0, 1), flat=0.35)
    lib_finalize('bruno', 4000)


def hoppla():
    """Hase: tall ears (one bent), sporty headband + wristbands, big feet, buck teeth, pom tail."""
    c = {'body': 'c_dcc39b', 'belly': 'c_fbf6ee', 'dark': 'c_4a3a32', 'accent': 'c_2fb3c6'}
    part('ico', 'body', c['body'], (0, 0.6, 0), size=(0.49, 0.57, 0.46), sub=3, deform=pear(0.1))
    belly(c['belly'], loc=(0, 0.55, -0.26), size=(0.31, 0.4, 0.23))
    # long hare feet
    for s in (-1, 1):
        part('uv', 'body', c['belly'], (s * 0.24, 0.085, -0.2), size=(0.16, 0.09, 0.32), seg=14, rings=8,
             deform=taper(-0.15, 'z'))
        for k in (-1, 0, 1):
            part('ico', 'body', c['belly'], (s * 0.24 + k * 0.07, 0.07, -0.48), size=(0.05, 0.05, 0.06), sub=1)
    arms(c['body'], hand=c['belly'], upper=(0.12, 0.24, 0.12), hand_r=0.09, sleeve=c['accent'])
    part('ico', 'body', c['belly'], (0, 0.38, 0.47), size=(0.16, 0.16, 0.16), sub=2, jitter=0.02, seed=5)
    head = Ell(H(0, 0.0, 0), (0.45, 0.42, 0.42))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    # muzzle puffs, pink nose, teeth
    for s in (-1, 1):
        part('ico', 'head', c['belly'], H(s * 0.075, -0.15, -0.35), size=(0.1, 0.085, 0.085), sub=2)
    part('ico', 'head', c['belly'], H(0, -0.2, -0.32), size=(0.08, 0.06, 0.06), sub=2)
    part('ico', 'head', BLUSH, H(0, -0.08, -0.43), size=(0.05, 0.035, 0.035), sub=2, deform=taper(0.4, 'y'))
    for s in (-1, 1):
        part('cube', 'head', WHITE, H(s * 0.022, -0.235, -0.39), size=(0.04, 0.06, 0.02), fwd=(0, -0.2, -1),
             smooth=False, ao=0.4)
    eyes(head, 0.36, 0.1, 0.09, pupil=c['dark'], flatten=0.6)
    brows(head, 0.36, 0.38, c['dark'], length=0.1, r=0.017, tilt=-0.1)
    cheeks(head, 0.62, -0.18, size=0.065)
    # headband (accent) with a white stripe, knot tails at the back
    hb_up = V(0, 1, 0.35).normalized()
    hb = V(H(0, 0.12, 0.0))
    part('torus', 'head', c['accent'], hb, size=(0.44, 0.44, 0.415), axis=hb_up, minor=0.11, seg=24, mseg=6,
         deform=lambda p: (p.x, p.y * 1.6, p.z))
    part('torus', 'head', WHITE, hb, size=(0.462, 0.462, 0.437), axis=hb_up, minor=0.03, seg=24, mseg=4)
    knot = V(H(0, -0.03, 0.445))
    part('ico', 'head', c['accent'], knot, size=(0.06, 0.055, 0.045), sub=2)
    for s in (-1, 1):
        tube('head', c['accent'], [knot, knot + V(s * 0.1, -0.08, 0.1), knot + V(s * 0.16, -0.2, 0.13)],
             [0.04, 0.04, 0.035], verts=6, up=(0, 0, 1), flat=0.3)
    # ears: long flattened tubes, right one upright, left one bent forward/out
    for s in (-1, 1):
        root = V(H(s * 0.16, 0.34, 0.05))
        if s > 0:
            ctrl = [root, root + V(0.04, 0.25, 0.02), root + V(0.08, 0.5, 0.04), root + V(0.11, 0.72, 0.03)]
        else:
            ctrl = [root, root + V(-0.05, 0.25, 0.02), root + V(-0.12, 0.45, -0.0), root + V(-0.3, 0.52, -0.08),
                    root + V(-0.45, 0.47, -0.12)]
        pts = spline(ctrl, 4)
        n_ = len(pts) - 1
        rad = lambda t: 0.06 + 0.07 * math.sin(math.pi * min(1, t * 1.05)) ** 0.7  # noqa: E731
        R = [rad(i / n_) for i in range(len(pts))]
        R[-1] = 0.012
        tube('head', c['body'], pts, R, verts=10, up=(0, 0, -1), flat=0.42)
        inner = [V(p) + V(0, 0, -0.04) for p in pts[1:-2]]
        tube('head', BLUSH, inner, [r * 0.6 for r in R[1:-2]], verts=8, up=(0, 0, -1), flat=0.3)
    lib_finalize('hoppla', 4000)


def schildi():
    """Schildkröte: domed shell with raised plates, cream plastron, goggles on the forehead."""
    c = {'body': 'c_a9c96a', 'belly': 'c_efe0b0', 'shell': 'c_6b4426', 'plate': 'c_c9923f', 'lens': 'c_8fd3f0'}
    torso(c['body'], r=0.5, size=(1, 1.04, 0.9), k=0.06)
    # plastron with segment lines
    pl = Ell((0, 0.55, -0.24), (0.35, 0.42, 0.24))
    part('ico', 'body', c['belly'], pl.c, size=pl.r, sub=3)
    for pitch in (-0.25, 0.2):
        pts = [pl.at(t, pitch, out=0.004)[0] for t in (-0.75, -0.4, 0, 0.4, 0.75)]
        tube('body', c['plate'], pts, 0.011, verts=5)
    # shell: dark dome + rim + raised hex plates
    sh = Ell((0, 0.62, 0.16), (0.62, 0.56, 0.5))
    part('uv', 'body', c['shell'], sh.c, size=sh.r, seg=18, rings=11,
         deform=lambda p: (p.x, p.y, max(p.z, -0.15)))
    rim = [(0.615 * math.sin(a), 0.62 + 0.555 * math.cos(a), 0.09) for a in [i / 28 * TAU for i in range(29)]]
    tube('body', c['plate'], rim, 0.06, verts=8, caps=False, up=(0, 0, 1), flat=1.0)
    plates = [(math.pi, 0.0, 0.17), (math.pi, 0.62, 0.15), (math.pi, -0.6, 0.15)]
    for s in (-1, 1):
        plates += [(math.pi - s * 0.68, 0.32, 0.14), (math.pi - s * 0.68, -0.3, 0.14), (math.pi - s * 1.2, 0.0, 0.11),
                   (math.pi - s * 0.55, 0.95, 0.1), (math.pi - s * 0.55, -0.9, 0.1)]
    for yaw, pitch, r in plates:
        p, n = sh.at(yaw, pitch)
        part('cyl', 'body', c['plate'], p + n * 0.006, size=(r, 0.05, r), axis=n, fwd=(0, -1, 0), verts=6, r2=0.78,
             smooth=False)
    part('cyl', 'body', c['body'], (0, 0.22, 0.6), size=(0.07, 0.16, 0.07), axis=(0, -0.4, 1), verts=6, r2=0.0)
    feet(c['body'], toes=3, size=(0.2, 0.12, 0.22), toe_mat=c['belly'], toe_r=0.045)
    arms(c['body'], hand=c['body'], upper=(0.14, 0.23, 0.14), hand_r=0.105, fingers=3, finger_mat=c['belly'])
    head = Ell(H(0, 0.0, -0.04), (0.44, 0.4, 0.45))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    eyes(head, 0.34, 0.06, 0.092, flatten=0.6)
    cheeks(head, 0.6, -0.2, size=0.07)
    smile(head, 0.3, -0.32, mat=INK, r=0.014, depth=0.05)
    for s in (-1, 1):
        p, n = head.at(s * 0.07, -0.08)
        part('ico', 'head', INK, p, size=(0.016, 0.011, 0.01), fwd=n, sub=1)
    # goggles pushed up onto the forehead
    st_up = V(0, 1, 0.75).normalized()
    part('torus', 'head', c['shell'], H(0, 0.0, -0.04), size=(0.445, 0.445, 0.435), axis=st_up, minor=0.06, seg=24,
         mseg=4, deform=lambda p: (p.x, p.y * 1.5, p.z))
    for s in (-1, 1):
        p, n = head.at(s * 0.3, 0.6)
        part('torus', 'head', c['plate'], p + n * 0.035, size=(0.105, 0.105, 0.105), axis=n, minor=0.24, seg=14, mseg=6)
        part('ico', 'head', c['lens'], p + n * 0.035, size=(0.088, 0.088, 0.03), fwd=n, sub=2)
        F = frame(fwd=n)
        part('ico', 'head', WHITE, p + n * 0.064 - F.col[0] * 0.03 + F.col[1] * 0.03, size=(0.022, 0.016, 0.005),
             fwd=n, sub=1, ao=0)
    lib_finalize('schildi', 4000)


def zippy():
    """Eichhörnchen: huge curled bushy tail, ear tufts, chubby cheeks, coin pouch on a strap."""
    c = {'body': 'c_c8643b', 'belly': 'c_fbe8cf', 'dark': 'c_3a2a22', 'pouch': 'c_8a5a2b'}
    gold = 'glow_f2c94c'
    torso(c['body'], r=0.5, size=(1, 1.05, 0.9), k=0.1)
    belly(c['belly'], loc=(0, 0.53, -0.25), size=(0.31, 0.38, 0.23))
    feet(c['body'], toes=3, size=(0.17, 0.09, 0.24), toe_r=0.05, toe_mat=c['belly'])
    arms(c['body'], hand=c['belly'], upper=(0.12, 0.23, 0.12), hand_r=0.09, fingers=3, finger_mat=c['belly'])
    # tail: rises behind the back (offset to one side so it peeks out), plume curls backwards
    pts = spline([(0, 0.3, 0.42), (0.08, 0.45, 0.8), (0.18, 0.9, 0.9), (0.24, 1.4, 0.8), (0.26, 1.8, 0.86),
                  (0.24, 1.98, 1.12), (0.2, 1.8, 1.3)], 5)
    n_ = len(pts) - 1
    rad = lambda t: 0.08 + 0.3 * math.sin(math.pi * min(1.0, 0.06 + t * 0.6)) ** 0.7  # noqa: E731
    R = [rad(i / n_) for i in range(len(pts))]
    R[-1] = 0.04
    R[-2] *= 0.8
    tube('body', c['body'], pts, R, verts=14, up=(1, 0, 0), flat=0.72)
    curl = V(0.2, 1.35, 0.6)
    for i in range(5, n_ - 2, 4):
        p0 = V(pts[i])
        tng = (V(pts[i + 1]) - V(pts[i - 1])).normalized()
        outer = tng.cross(V(1, 0, 0)).normalized()
        if outer.dot(p0 - curl) < 0:
            outer = -outer
        for sd in (-1, 1):
            tufts('body', c['body'], p0 + outer * R[i] * 0.55 + V(sd * R[i] * 0.3, 0, 0),
                  [outer + tng * 1.2 + V(sd * 0.3, 0, 0)], length=0.26, r=0.1, verts=5)
    d = (V(pts[-1]) - V(pts[-3])).normalized()
    tufts('body', c['body'], V(pts[-2]), [d], length=0.2, r=0.09, verts=5)
    head = Ell(H(0, 0.0, 0), (0.46, 0.42, 0.43))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    # chubby cheeks + muzzle
    for s in (-1, 1):
        p, n = head.at(s * 0.55, -0.35)
        part('ico', 'head', c['belly'], p - n * 0.06, size=(0.17, 0.14, 0.13), fwd=n, sub=2)
    mz = Ell(H(0, -0.11, -0.36), (0.13, 0.1, 0.1))
    part('ico', 'head', c['belly'], mz.c, size=mz.r, sub=2)
    nose(mz, 0, 0.5, c['dark'], size=(0.05, 0.035, 0.04))
    for s in (-1, 1):
        part('cube', 'head', WHITE, H(s * 0.02, -0.22, -0.415), size=(0.035, 0.055, 0.02), fwd=(0, -0.2, -1),
             smooth=False, ao=0.4)
    eyes(head, 0.35, 0.12, 0.094, pupil=c['dark'], flatten=0.6)
    cheeks(head, 0.68, -0.08, size=0.055)
    # pointy ears with dark tufts
    for s in (-1, 1):
        ax = V(s * 0.3, 1, 0.08).normalized()
        base = V(H(s * 0.25, 0.32, 0.02))
        part('ico', 'head', c['body'], base + ax * 0.12, size=(0.12, 0.2, 0.06), axis=ax, sub=2, deform=taper(0.75))
        part('ico', 'head', c['belly'], base + ax * 0.1 + V(0, 0, -0.035), size=(0.07, 0.13, 0.03), axis=ax, sub=2,
             deform=taper(0.75))
        tip = base + ax * 0.28
        tufts('head', c['dark'], tip - ax * 0.03, [ax, ax + V(s * 0.4, 0, 0.2), ax + V(-s * 0.3, 0, -0.1)],
              length=0.13, r=0.035)
    # strap across the chest + pouch on the hip with a coin peeking out
    body = Ell((0, 0.6, 0), (0.5, 0.525, 0.45))
    strap = [body.at(-0.8 + t * 1.5, 0.42 - t * 0.95, out=0.012 + 0.065 * math.sin(math.pi * t))[0]
             for t in [k / 8 for k in range(9)]]
    tube('body', c['pouch'], strap, 0.03, verts=6, up=(0, 0, -1), flat=0.45)
    p, n = body.at(0.75, -0.5)
    pc = p + n * 0.06
    part('uv', 'body', c['pouch'], pc, size=(0.15, 0.14, 0.08), fwd=n, seg=14, rings=8)
    part('cyl', 'body', c['pouch'], pc + V(0, 0.08, 0), size=(0.155, 0.05, 0.11), fwd=n, verts=14, smooth=True)
    part('ico', 'body', gold, pc + n * 0.11 + V(0, 0.04, 0), size=(0.03, 0.03, 0.015), fwd=n, sub=1)
    part('cyl', 'body', gold, pc + V(0.02, 0.15, 0.02), size=(0.065, 0.02, 0.065), axis=n + V(0, 2.5, 0), verts=12,
         smooth=False)
    lib_finalize('zippy', 4000)


def moderator():
    """Käpt’n Plapperschnabel – parrot captain with tricorne, epaulettes and colourful wings."""
    c = {'body': 'c_5cc08a', 'belly': 'c_f2c94c', 'accent': 'c_e8676b', 'blue': 'c_5f8fe0', 'hat': 'c_3d3a55'}
    gold = 'glow_f2c94c'
    torso(c['body'], k=0.1)
    belly(c['belly'], loc=(0, 0.55, -0.27), size=(0.34, 0.42, 0.24))
    # parrot feet
    for s in (-1, 1):
        base = V(s * 0.25, 0.08, -0.12)
        part('ico', 'body', c['hat'], base, size=(0.12, 0.07, 0.12), sub=2)
        for k in (-1, 0, 1):
            d = V(k * 0.5, 0, -1).normalized()
            tube('body', c['hat'], [base, base + d * 0.22 + V(0, -0.03, 0)], [0.04, 0.03], verts=6)
            part('cyl', 'body', c['hat'], base + d * 0.24 + V(0, -0.03, 0), size=(0.02, 0.05, 0.02), axis=d, verts=4,
                 r2=0.0, shade=0.8)
    # wings with blue + red tips and gold epaulettes
    for s in (-1, 1):
        g = arm_name(s)
        ax = V(s * 0.2, -1, 0.1)
        part('ico', g, c['body'], A(s, 0.04, -0.2, 0.02), size=(0.09, 0.26, 0.17), axis=ax, sub=3, deform=taper(0.3))
        part('ico', g, c['blue'], A(s, 0.08, -0.38, 0.05), size=(0.06, 0.15, 0.12), axis=ax, sub=2, deform=taper(0.4))
        part('ico', g, c['accent'], A(s, 0.1, -0.5, 0.08), size=(0.045, 0.1, 0.08), axis=ax, sub=2, deform=taper(0.6))
        ep = V(A(s, 0.03, 0.02, 0.0))
        part('cyl', g, gold, ep, size=(0.15, 0.05, 0.15), axis=(s * 0.3, 1, 0), verts=12, r2=0.8)
        for k in range(7):
            a = (k / 6 - 0.5) * 2.4
            fp = ep + V(s * 0.12 * math.cos(a) * 0.9 + s * 0.02, -0.05, 0.13 * math.sin(a))
            part('cyl', g, gold, fp, size=(0.018, 0.08, 0.018), axis=(s * 0.2, -1, 0), verts=4, smooth=False)
    # tail feathers
    for k, col in enumerate((c['accent'], c['blue'], c['body'])):
        x = (k - 1) * 0.12
        tube('body', col, spline([(x * 0.5, 0.45, 0.38), (x, 0.3, 0.75), (x * 1.6, 0.14, 1.0)], 3),
             lambda t: 0.06 + 0.04 * math.sin(math.pi * t) - 0.04 * t, verts=6, up=(0, 1, 0), flat=0.35)
    head = Ell(H(0, 0, 0), (0.45, 0.42, 0.44))
    part('ico', 'head', c['body'], head.c, size=head.r, sub=3)
    for s in (-1, 1):
        p, n = head.at(s * 0.4, 0.05)
        part('ico', 'head', WHITE, p - n * 0.07, size=(0.17, 0.19, 0.1), fwd=n, sub=2)
    eyes(head, 0.42, 0.08, 0.08, pupil=INK, flatten=0.6)
    brows(head, 0.4, 0.42, c['hat'], length=0.12, r=0.022, tilt=-0.1)
    # hooked beak: upper hook + lower jaw
    bk = [H(0, 0.05, -0.36), H(0, 0.01, -0.5), H(0, -0.09, -0.57), H(0, -0.19, -0.54)]
    tube('head', c['belly'], spline(bk, 3), lambda t: 0.15 * (1 - t) ** 0.7 + 0.014, verts=12, up=(1, 0, 0), flat=0.8)
    part('ico', 'head', c['belly'], H(0, -0.16, -0.43), size=(0.09, 0.06, 0.09), sub=2, shade=0.78)
    for s in (-1, 1):
        part('ico', 'head', INK, H(s * 0.04, 0.03, -0.49), size=(0.014, 0.01, 0.008), fwd=(s * 0.3, 0.3, -1), sub=1)
    cheeks(head, 0.75, -0.25, size=0.06, mat=c['accent'])
    # tricorne: crown + three upturned brim sides + gold trim + emblem + plume
    hc = V(H(0, 0.3, 0.02))
    part('uv', 'head', c['hat'], hc + V(0, 0.08, 0), size=(0.32, 0.2, 0.3), seg=16, rings=8,
         deform=lambda p: (p.x, max(p.y, -0.2), p.z))
    for i in range(3):
        a = i / 3 * TAU + math.pi  # one corner points to the front
        mid = V(math.sin(a + math.pi / 3), 0, -math.cos(a + math.pi / 3))
        side = [hc + V(math.sin(a + t) * 0.5, 0.02 + 0.13 * (1 - (2 * (t / (2 * math.pi / 3)) - 1) ** 2),
                       -math.cos(a + t) * 0.5) for t in [-0.12 + k / 6 * (2 * math.pi / 3 + 0.24) for k in range(7)]]
        tube('head', c['hat'], side, 0.07, verts=6, up=(0, 1, 0), flat=1.6)
        tube('head', gold, [V(p) + V(0, 0.095, 0) + mid * 0.02 for p in side[1:-1]], 0.024, verts=5)
    part('ico', 'head', gold, hc + V(0, 0.16, -0.31), size=(0.08, 0.08, 0.03), fwd=(0, 0.2, -1), sub=1, smooth=False)
    for i, col in enumerate((c['blue'], c['accent'], c['blue'])):
        base = hc + V((i - 1) * 0.07, 0.2, 0.12)
        tube('head', col, spline([base, base + V((i - 1) * 0.08, 0.2, 0.06), base + V((i - 1) * 0.16, 0.36, 0.2)], 3),
             lambda t: 0.035 + 0.04 * math.sin(math.pi * t), verts=6, up=(0, 0, 1), flat=0.4)
    lib_finalize('moderator', 5000)


# --- preview (QA): renders what Babylon will roughly show: palette color x COLOR_0 ---------


def _srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _prep_display(objs):
    for o in objs:
        me = o.data
        mat = o.name.split('__')[1].split('.')[0] if '__' in o.name else 'c_ffffff'
        hexcol = mat.split('_', 1)[1] if '_' in mat else 'f6efe2'
        base = [int(hexcol[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        if mat.startswith('glow_'):
            base = [min(1.0, b * 1.5) for b in base]
        src = me.color_attributes[0] if len(me.color_attributes) else None
        if src is None:
            print('[preview] WARNING no COLOR_0 on', o.name)
        dom = src.domain if src else 'POINT'
        disp = me.color_attributes.new('Disp', 'FLOAT_COLOR', dom)
        for i, d in enumerate(disp.data):
            v = src.data[i].color[0] if src else 1.0
            d.color = (*(_srgb2lin(b * v) for b in base), 1.0)
        me.color_attributes.active_color = disp


def _render(path, width, height, ortho, center_z=0.95, pitch_deg=10):
    scene = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ortho
    pitch = math.radians(pitch_deg)
    cam.location = Vector((0, 30 * math.cos(pitch), center_z + 30 * math.sin(pitch)))
    cam.rotation_euler = (Vector((0, 0, center_z)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = True
    sh.shadow_intensity = 0.35
    sh.show_specular_highlight = True
    scene.display.light_direction = (-0.4, 0.5, 0.75)
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.exposure = 0.3
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = os.path.abspath(path)
    w = bpy.data.worlds.new('w')
    w.color = (0.55, 0.62, 0.72)
    scene.world = w
    bpy.ops.render.render(write_still=True)
    print('[preview]', path)


def _import(path, dx, yaw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in set(bpy.data.objects) - before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = Matrix.Translation((dx, 0, 0)) @ Matrix.Rotation(yaw, 4, 'Z') @ mw
    return meshes


def preview(ids, src_dir, dst_dir):
    os.makedirs(dst_dir, exist_ok=True)
    for cid in ids:
        lib.reset()
        objs = _import(os.path.join(src_dir, f'{cid}.glb'), 0, 0)
        _prep_display(objs)
        base = {o.name: o.matrix_world.copy() for o in objs}
        for i, (dx, yaw) in enumerate(((-2.4, 0.5), (0.0, math.pi / 2), (2.4, math.pi - 0.5))):
            for o in objs:
                t = o
                if i:
                    t = o.copy()
                    bpy.context.scene.collection.objects.link(t)
                t.matrix_world = Matrix.Translation((dx, 0, 0)) @ Matrix.Rotation(yaw, 4, 'Z') @ base[o.name]
        _render(os.path.join(dst_dir, f'{cid}.png'), 1500, 640, 7.4, 1.15)
    if len(ids) == len(ALL):
        lib.reset()
        n = len(ids)
        for i, cid in enumerate(ids):
            objs = _import(os.path.join(src_dir, f'{cid}.glb'), -(i - (n - 1) / 2) * 1.9, 0.3)
            _prep_display(objs)
        _render(os.path.join(dst_dir, 'lineup.png'), 2600, 560, n * 1.9 + 0.4, 1.1)
        # roughly the board camera (~40 deg from above), small = 'TV from 3 m'
        _render(os.path.join(dst_dir, 'lineup_game.png'), 1000, 260, n * 1.9 + 0.4, 1.0, pitch_deg=40)


# --- main -------------------------------------------------------------------------------

OUT = lib.arg('out', '.')


def out(name):
    os.makedirs(OUT, exist_ok=True)
    return os.path.join(OUT, f'{name}.glb')


def lib_finalize(name, budget):
    finalize_characters(out(name), budget)


ALL = (rocco, quaki, pingo, foxy, bruno, hoppla, schildi, zippy, moderator)
only = lib.arg('only')
sel = [fn for fn in ALL if not only or fn.__name__ in only.split(',')]
prev = lib.arg('preview')
if not (prev and '--no-build' in sys.argv):
    for fn in sel:
        lib.reset()
        lib._mats.clear()
        fn()
if prev:
    preview([fn.__name__ for fn in sel], OUT, prev)
