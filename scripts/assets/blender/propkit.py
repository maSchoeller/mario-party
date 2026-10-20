"""Shared building blocks for the prop libraries (props*.py).

All coordinates are Babylon space (Y up, front = -Z), see lib.py. Every helper creates
objects named "<group>__<material>". `at()` groups everything created inside it and
moves/rotates it as one sub-assembly, so details can be modelled around the origin.

Style: pastel low-poly, flat shaded, organic silhouettes. Detail comes from geometry
(planks, frames, ropes) and from vertex colors (tone variation, gradients, baked AO),
not from extra materials – every prop keeps a handful of palette materials.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import B, TAU, beam, box, cone, cyl, ico, lathe, loft, mesh, noisify, place, prism, shade, tone, tube, vgrad  # noqa: E402,F401

# ---- palette (pastel, shared by all maps) -----------------------------------------
WOOD = 'c_b98a5e'  # warm mid wood
WOOD_D = 'c_8a5a3c'  # dark wood / posts
WOOD_L = 'c_dcb98f'  # planks, bleached wood
BARK = 'c_a0703f'
CREAM = 'c_f6efe2'
PLASTER = 'c_f3e3cf'
STONE = 'c_d9d6ea'  # light lavender stone
ROCK = 'c_b9b6c4'
SLATE = 'c_3d3a55'
METAL = 'c_6e6a82'
GOLD = 'c_f2c94c'
GLASS = 'c_9fd4e8'
WHITE = 'c_ffffff'
RED = 'c_e8676b'
ROPE = 'c_e2cfa4'
LEAF = 'c_8fcf78'
LEAF_D = 'c_6fae6a'
GRASS = 'c_9bd27e'
SAND = 'c_efe2c0'
LAMP = 'glow_ffd98a'
FLAME = 'glow_ffb347'
LAVA = 'glow_ff7a3d'


def R(seed):
    return random.Random(seed)


def lerp(a, b, t):
    return a + (b - a) * t


def vlerp(p, q, t):
    return tuple(a + (b - a) * t for a, b in zip(p, q))


def rot_y(p, a):
    """Rotate a Babylon point around +Y (positive a turns +X towards +Z)."""
    x, y, z = p
    c, s = math.cos(a), math.sin(a)
    return (x * c - z * s, y, x * s + z * c)


_CONV = Matrix(((-1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def babylon_matrix(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    m = Euler(rot, 'XYZ').to_matrix().to_4x4()
    return Matrix.Translation(B(*loc)) @ (_CONV @ m @ _CONV.inverted()) @ Matrix.Diagonal((scale, scale, scale, 1))


class at:
    """Sub-assembly: objects created inside are transformed together on exit."""

    def __init__(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
        self.m = babylon_matrix(loc, rot if isinstance(rot, (tuple, list)) else (0, rot, 0), scale)

    def __enter__(self):
        self.before = set(bpy.data.objects)
        return self

    def __exit__(self, *exc):
        for o in set(bpy.data.objects) - self.before:
            o.matrix_world = self.m @ o.matrix_basis
        return False


# ---- organic shapes ---------------------------------------------------------------


def boulder(g, mat, loc, size=(1, 1, 1), seed=0, subdiv=1, rough=0.22, yaw=0.0, ground=0.0, sink=0.05, strata=0.0):
    """Irregular rock: noisy icosphere, flat underside where it meets the ground."""
    o = ico(g, mat, (0, 0, 0), r=1.0, subdiv=subdiv)
    noisify(o, rough, 1.1, seed)
    lib.jitter(o, rough * 0.2, seed)
    place(o, loc, (0, yaw, 0), size)
    if ground is not None:
        lib.flatten(o, ground, sink)
    rr = R(seed)
    tone(o, rr.uniform(0.9, 1.0))
    if strata:
        ph = rr.uniform(0, 6)
        shade(o, lambda x, y, z: 1 - strata * (0.5 + 0.5 * math.sin(y * 6.0 + ph + 0.6 * math.sin(x * 1.3 + z))))
    return o


def blob(g, mat, loc, r=1.0, scale=(1, 1, 1), seed=0, subdiv=1, rough=0.22, lo=0.8):
    """Foliage clump: noisy sphere with a dark-bottom gradient."""
    o = ico(g, mat, (0, 0, 0), r=1.0, subdiv=subdiv)
    noisify(o, rough, 1.4, seed)
    place(o, loc, (0, seed * 0.77, 0), (r * scale[0], r * scale[1], r * scale[2]))
    vgrad(o, lo, 1.0)
    return o


def leaf(g, mat, base, yaw, length=1.0, width=0.3, rise=0.4, droop=0.6, segs=4, fold=0.25, thick=0.025, serr=0.0, tip_w=0.0, pitch=0.0, lo=0.78):
    """Closed thin leaf / frond along a drooping spine (visible from both sides).

    serr > 0 makes alternate rings narrower -> serrated palm-leaflet edge."""
    fw = Vector((math.cos(yaw), 0, math.sin(yaw)))
    up = Vector((0, 1, 0))
    side = fw.cross(up).normalized()
    b = Vector(base)
    spine = []
    for i in range(segs + 1):
        s = i / segs
        spine.append(b + fw * (length * s * math.cos(pitch)) + up * (length * s * math.sin(pitch) + rise * s - droop * s * s))
    vs, rings = [], []
    for i, p in enumerate(spine):
        s = i / segs
        t = (spine[min(i + 1, segs)] - spine[max(i - 1, 0)]).normalized()
        n = side.cross(t).normalized()
        if n.y < 0:
            n = -n
        w = width * (math.sin(math.pi * (0.12 + 0.88 * s)) ** 0.7) + tip_w * s
        if serr and i % 2 == 1 and i < segs:
            w *= 1 - serr
        if i == segs and tip_w == 0:
            rings.append([len(vs)])
            vs.append(tuple(p))
            continue
        if i == 0:
            w = max(w, width * 0.12)
        ring = [p - side * w - n * (fold * w), p + n * thick, p + side * w - n * (fold * w), p - n * thick * 0.6]
        rings.append(list(range(len(vs), len(vs) + 4)))
        vs += [tuple(q) for q in ring]
    faces = [tuple(reversed(rings[0]))]
    for a, c in zip(rings, rings[1:]):
        if len(c) == 1:
            faces += [(a[k], a[(k + 1) % 4], c[0]) for k in range(4)]
        else:
            faces += [(a[k], a[(k + 1) % 4], c[(k + 1) % 4], c[k]) for k in range(4)]
    if len(rings[-1]) == 4:
        faces.append(tuple(rings[-1]))
    o = mesh(g, mat, vs, faces)
    bx, bz = b.x, b.z
    shade(o, lambda x, y, z: lo + (1 - lo) * min(1.0, math.hypot(x - bx, z - bz) / max(length * 0.8, 1e-3)))
    return o


def curve(p0, p1, bend=(0, 0, 0), n=6, ease=2.0):
    """Points from p0 to p1 bowed by `bend` (offset at the end, eased in with ^ease)."""
    pts = []
    for i in range(n + 1):
        t = i / n
        q = vlerp(p0, p1, t)
        k = t**ease
        pts.append((q[0] + bend[0] * k, q[1] + bend[1] * k, q[2] + bend[2] * k))
    return pts


def bezier(p0, p1, p2, n=6):
    out = []
    for i in range(n + 1):
        t = i / n
        a = vlerp(p0, p1, t)
        b = vlerp(p1, p2, t)
        out.append(vlerp(a, b, t))
    return out


def arc_pts(center, radius, a0, a1, n=8, plane='xy'):
    """Arc in the XY (default) or ZY plane."""
    cx, cy, cz = center
    out = []
    for i in range(n + 1):
        a = lerp(a0, a1, i / n)
        if plane == 'xy':
            out.append((cx + math.cos(a) * radius, cy + math.sin(a) * radius, cz))
        else:
            out.append((cx, cy + math.sin(a) * radius, cz + math.cos(a) * radius))
    return out


# ---- wood & rope -------------------------------------------------------------------


def plank(g, mat, p0, p1, w=0.25, t=0.06, up=(0, 1, 0), seed=0, var=0.12):
    o = beam(g, mat, p0, p1, width=w, thick=t, up=up)
    tone(o, 1 - var * R(seed).random())
    return o


def post(g, mat, loc, h, r=0.09, verts=6, seed=0, lean=0.0, var=0.08):
    """Round wooden post from loc upwards (slightly irregular)."""
    x, y, z = loc
    rr = R(seed)
    top = (x + rr.uniform(-lean, lean), y + h, z + rr.uniform(-lean, lean))
    o = tube(g, mat, [(x, y, z), vlerp((x, y, z), top, 0.5), top], [r * 1.06, r, r * 0.94], verts=verts, phase=rr.uniform(0, 1))
    tone(o, 1 - var * rr.random())
    return o


def rope(g, mat, p0, p1, sag=0.12, r=0.025, n=6, verts=4):
    pts = []
    for i in range(n + 1):
        t = i / n
        q = vlerp(p0, p1, t)
        pts.append((q[0], q[1] - sag * 4 * t * (1 - t), q[2]))
    return tube(g, mat, pts, r, verts=verts)


def lashing(g, mat, loc, r, h=0.12, axis_rot=(0, 0, 0)):
    """Rope wrap around a post (a short, slightly fatter ring)."""
    return lathe(g, mat, loc, [(r * 1.18, -h / 2), (r * 1.25, 0), (r * 1.18, h / 2)], verts=6, rot=axis_rot)


# ---- small set pieces --------------------------------------------------------------


def barrel(g, loc, h=0.9, r=0.36, wood=WOOD, hoop=METAL, rot=(0, 0, 0), seed=0):
    with at(loc, rot):
        prof = [(r * 0.8, 0), (r * 0.93, h * 0.2), (r, h * 0.5), (r * 0.93, h * 0.8), (r * 0.8, h)]
        o = lathe(g, wood, (0, 0, 0), prof, verts=10, rfn=lambda a, j: 1.0 + 0.03 * (round(a / TAU * 10) % 2), phase=R(seed).uniform(0, 1))
        tone(o, R(seed).uniform(0.9, 1.0))
        for y, f in ((0.16, 0.92), (0.84, 0.92)):
            lathe(g, hoop, (0, h * y, 0), [(r * f * 1.03, -0.035), (r * f * 1.05, 0.035)], verts=10)
        lathe(g, wood, (0, h - 0.02, 0), [(r * 0.72, 0), (r * 0.72, 0.03)], verts=10)


def crate(g, loc, s=0.7, yaw=0.0, wood=WOOD_L, frame=WOOD, seed=0, diag=True):
    with at(loc, (0, yaw, 0)):
        o = box(g, wood, (0, s / 2, 0), (s * 0.92, s * 0.92, s * 0.92))
        tone(o, R(seed).uniform(0.88, 1.0))
        e = s * 0.11
        for sx in (-1, 1):
            for sz in (-1, 1):
                box(g, frame, (sx * (s / 2 - e / 2), s / 2, sz * (s / 2 - e / 2)), (e, s, e))
        for y in (e / 2, s - e / 2):
            for sz in (-1, 1):
                box(g, frame, (0, y, sz * (s / 2 - e / 2)), (s - 2 * e, e, e))
            for sx in (-1, 1):
                box(g, frame, (sx * (s / 2 - e / 2), y, 0), (e, e, s - 2 * e))
        if diag:
            for sz in (-1, 1):
                beam(g, frame, (-s / 2 + e, e, sz * (s / 2 - e * 0.3)), (s / 2 - e, s - e, sz * (s / 2 - e * 0.3)), width=e * 0.9, thick=e * 0.5, up=(0, 0, sz))


def sack(g, loc, s=0.5, mat='c_e8d6b0', seed=0, yaw=0.0):
    with at(loc, (0, yaw, 0)):
        o = ico(g, mat, (0, s * 0.42, 0), r=s * 0.5, scale=(1, 0.85, 0.8), subdiv=1)
        noisify(o, 0.06 * s / 0.5, 2.0, seed)
        lib.flatten(o, 0.0)
        cone(g, mat, (0, s * 0.9, 0), r=s * 0.16, h=s * 0.3, verts=5)
        lathe(g, ROPE, (0, s * 0.8, 0), [(s * 0.14, -0.02), (s * 0.15, 0.02)], verts=6)


def window(g, loc, w=0.6, h=0.7, yaw=0.0, glass=GLASS, frame=WHITE, sill=STONE, shutter=None, cross=True, arch=False, box_flowers=None):
    """Window on a wall facing -Z (loc = center of the glass on the wall surface)."""
    with at(loc, (0, yaw, 0)):
        box(g, glass, (0, 0, 0.0), (w, h, 0.06))
        f = 0.07
        box(g, frame, (0, h / 2 + f / 2, -0.04), (w + 2 * f, f, 0.1))
        box(g, frame, (0, -h / 2 - f / 2, -0.04), (w + 2 * f, f, 0.1))
        for sx in (-1, 1):
            box(g, frame, (sx * (w / 2 + f / 2), 0, -0.04), (f, h, 0.1))
        if cross:
            box(g, frame, (0, 0, -0.04), (0.04, h, 0.06))
            box(g, frame, (0, h * 0.12, -0.04), (w, 0.04, 0.06))
        if sill:
            box(g, sill, (0, -h / 2 - f - 0.03, -0.08), (w + 0.26, 0.06, 0.18))
        if arch:
            lathe(g, frame, (0, h / 2 + f, -0.04), [(w / 2 + f, -0.05), (w / 2 + f, 0.05)], verts=10, rot=(math.pi / 2, 0, 0), scale=(1, 1, 0.5))
        if shutter:
            for sx in (-1, 1):
                s = box(g, shutter, (sx * (w / 2 + f + w * 0.26), 0, -0.05), (w * 0.48, h + 0.08, 0.05))
                tone(s, 0.95)
                for k in range(3):
                    box(g, shutter, (sx * (w / 2 + f + w * 0.26), -h * 0.3 + k * h * 0.3, -0.085), (w * 0.4, 0.035, 0.03))
        if box_flowers:
            box(g, WOOD, (0, -h / 2 - f - 0.14, -0.16), (w + 0.1, 0.16, 0.2))
            for k in range(4):
                ico(g, box_flowers if k % 2 else LEAF, (-w / 2 + 0.1 + k * (w - 0.2) / 3, -h / 2 - f - 0.02, -0.17), r=0.09, subdiv=1)


def door(g, loc, w=0.7, h=1.2, yaw=0.0, wood=WOOD_D, frame=WOOD, knob=GOLD, planks=4, step=STONE):
    """Plank door on a wall facing -Z, loc = bottom center on the wall surface."""
    with at(loc, (0, yaw, 0)):
        pw = w / planks
        for k in range(planks):
            o = box(g, wood, (-w / 2 + pw * (k + 0.5), h / 2, -0.03), (pw * 0.94, h, 0.06))
            tone(o, 0.9 + 0.1 * ((k * 7) % 3) / 2)
        box(g, wood, (0, h * 0.3, -0.07), (w * 0.9, 0.07, 0.03))
        box(g, wood, (0, h * 0.75, -0.07), (w * 0.9, 0.07, 0.03))
        f = 0.08
        box(g, frame, (0, h + f / 2, -0.05), (w + 2 * f, f, 0.1))
        for sx in (-1, 1):
            box(g, frame, (sx * (w / 2 + f / 2), h / 2, -0.05), (f, h, 0.1))
        ico(g, knob, (w * 0.32, h * 0.48, -0.1), r=0.045, subdiv=1)
        if step:
            box(g, step, (0, 0.05, -0.22), (w + 0.3, 0.1, 0.34), bevel=0.02)


def gable_roof(g, mat, loc, w, d, h, over=0.25, thick=0.1, rows=4, ridge=None, yaw=0.0, seed=0):
    """Gable roof, ridge along X, eaves at loc.y. Made of overlapping tile rows."""
    rr = R(seed)
    with at(loc, (0, yaw, 0)):
        for s in (-1, 1):
            eave = Vector((0, -over * h / (d / 2), s * (d / 2 + over)))
            top = Vector((0, h, 0))
            slope = (top - eave)
            nrm = Vector((0, abs(slope.z), s * abs(slope.y))).normalized()
            for i in range(rows):
                t0, t1 = i / rows, min(1.0, (i + 1) / rows + 0.05)
                a = eave + slope * t0 + nrm * (thick * 0.6)
                b = eave + slope * t1
                o = beam(g, mat, (0, a.y, a.z), (0, b.y, b.z), width=w + 2 * over, thick=thick, up=tuple(nrm))
                tone(o, 0.88 + 0.12 * ((i + 1) % 2) * rr.uniform(0.7, 1.0))
        if ridge:
            o = box(g, ridge, (0, h + thick * 0.6, 0), (w + 2 * over + 0.08, thick * 1.6, thick * 2.2), bevel=0.02)


def gable_wall(g, mat, loc, w, h, depth, yaw=0.0):
    """Triangular gable infill (in XY) – sits on top of a wall, depth along Z."""
    return prism(g, mat, loc, [(-w / 2, 0), (w / 2, 0), (0, h)], depth, rot=(0, yaw, 0))


def thatch(g, mat, loc, r, h, tiers=3, verts=4, seed=0, yaw=math.pi / 4, sx=1.0, sz=1.0, rough=0.04):
    """Layered thatch / straw pyramid roof (tiers of overlapping skirts)."""
    out = []
    for i in range(tiers):
        t0 = i / tiers
        t1 = (i + 1) / tiers
        r0 = r * (1 - t0 * 0.92)
        r1 = r * (1 - t1 * 0.92)
        y0 = loc[1] + h * t0 * 0.92
        y1 = loc[1] + h * t1 + (h * 0.12 if i == tiers - 1 else 0)
        prof = [(r0 * 1.04, y0 - 0.1), (r0, y0), (r1 * 0.98 if i < tiers - 1 else 0, y1)]
        o = lathe(g, mat, (loc[0], 0, loc[2]), prof, verts=verts, phase=yaw, scale=(sx, 1, sz))
        noisify(o, rough, 3.0, seed + i)
        tone(o, 0.88 + 0.12 * (i / max(tiers - 1, 1)))
        out.append(o)
    return out


def fence_segment(g, loc, length=2.0, yaw=0.0, h=0.8, wood=WOOD_L, post_mat=WOOD, seed=0, pickets=0):
    with at(loc, (0, yaw, 0)):
        for sx in (-1, 1):
            post(g, post_mat, (sx * length / 2, -0.05, 0), h + 0.1, r=0.07, verts=5, seed=seed + sx)
            cone(g, post_mat, (sx * length / 2, h + 0.1, 0), r=0.075, h=0.12, verts=5)
        for y in (h * 0.35, h * 0.78):
            plank(g, wood, (-length / 2, y, -0.07), (length / 2, y + R(seed + int(y * 9)).uniform(-0.03, 0.03), -0.07), w=0.11, t=0.04, up=(0, 0, -1), seed=seed + int(y * 10))
        for k in range(pickets):
            x = -length / 2 + (k + 1) * length / (pickets + 1)
            plank(g, wood, (x, 0.05, -0.1), (x, h * 0.95, -0.1), w=0.1, t=0.03, up=(0, 0, -1), seed=seed + k)


def lantern_head(g, loc, s=1.0, frame=SLATE, light=LAMP, hang=False):
    """Small 4-sided lantern; loc = bottom center."""
    with at(loc, (0, 0, 0), s):
        box(g, frame, (0, 0.03, 0), (0.26, 0.06, 0.26))
        box(g, light, (0, 0.19, 0), (0.19, 0.26, 0.19))
        for sx in (-1, 1):
            for sz in (-1, 1):
                box(g, frame, (sx * 0.11, 0.19, sz * 0.11), (0.035, 0.28, 0.035))
        cone(g, frame, (0, 0.4, 0), r=0.24, h=0.16, verts=4, rot=(0, math.pi / 4, 0))
        if hang:
            lib.torus(g, frame, (0, 0.52, 0), R=0.05, r=0.015, seg=6, mseg=3, rot=(math.pi / 2, 0, 0))


def flower(g, loc, r=0.1, petal='c_f28aa0', center=GOLD, petals=5, tilt=0.4, seed=0):
    """Tiny 5-petal flower (hibiscus style)."""
    rr = R(seed)
    with at(loc, (tilt * rr.uniform(-1, 1), rr.uniform(0, TAU), tilt * rr.uniform(-1, 1))):
        # star-shaped cup: alternating rim radius gives petals
        lathe(g, petal, (0, 0, 0), [(0, -r * 0.2), (r, r * 0.3), (0, r * 0.1)], verts=petals * 2,
              rfn=lambda a, j: 1.0 if round(a / TAU * petals * 2) % 2 == 0 else 0.55)
        cone(g, center, (0, r * 0.3, 0), r=r * 0.15, h=r * 0.6, verts=3)


def grass_tuft(g, mat, loc, n=5, h=0.4, r=0.12, seed=0, lean=0.25, blade_w=0.05):
    """Ultra cheap grass: n bent 3-sided blades, 6 tris each."""
    rr = R(seed)
    for k in range(n):
        a = k / n * TAU + rr.uniform(-0.3, 0.3)
        bx = loc[0] + math.cos(a) * r * rr.uniform(0.2, 1.0)
        bz = loc[2] + math.sin(a) * r * rr.uniform(0.2, 1.0)
        hh = h * rr.uniform(0.7, 1.1)
        lx, lz = math.cos(a) * lean * hh, math.sin(a) * lean * hh
        pts = [(bx, loc[1], bz), (bx + lx * 0.35, loc[1] + hh * 0.55, bz + lz * 0.35), (bx + lx, loc[1] + hh, bz + lz)]
        o = tube(g, mat, pts, [blade_w, blade_w * 0.6, 0], verts=3, cap=False, phase=a)
        shade(o, lambda x, y, z, y0=loc[1], hh=hh: 0.7 + 0.3 * min(1.0, (y - y0) / hh))


# ---- bridges (shared contract: deck along Z, 7 long, origin at center) ---------------


def deck_y(z, length=7.0, top=0.45, rise=0.15):
    """Deck top height of the arched bridges: 0.45 at the center, 0.30 at the ends."""
    return top - rise + rise * math.cos(math.pi * z / length)


def arch_bridge_body(g, stone, voussoir, paving, width=2.2, span=2.7, base=-1.3, seed=150):
    """Masonry body (deck curve minus an arch opening), voussoirs on both faces, paving."""
    top = [(-3.5 + i * 0.35, deck_y(-3.5 + i * 0.35) - 0.06) for i in range(21)]
    arch = [(math.cos(a) * span, base + 0.1 + math.sin(a) * 1.0) for a in [k / 12 * math.pi for k in range(13)]]
    outline = [(-3.5, base)] + top + [(3.5, base)] + arch
    prism(g, stone, (0, 0, 0), outline, width, rot=(0, math.pi / 2, 0))
    rr = R(seed)
    for sx in (-1, 1):
        for k in range(11):
            am = (k + 0.5) / 11 * math.pi
            o = box(g, voussoir, (sx * (width / 2 + 0.02), base + 0.1 + math.sin(am) * 1.12, math.cos(am) * (span + 0.12)), (0.1, 0.3, 0.38))
            tone(o, 0.86 + 0.14 * (k % 2))
    for i in range(14):
        z = -3.5 + (i + 0.5) * 0.5
        y = deck_y(z)
        o = beam(g, paving, (-(width / 2 - 0.15), y - 0.03, z), ((width / 2 - 0.15), y - 0.03, z), width=0.47, thick=0.06,
                 up=(0, 1, -(deck_y(z + 0.05) - deck_y(z - 0.05)) / 0.1))
        tone(o, rr.uniform(0.88, 1.0))


# ---- run helper ------------------------------------------------------------------

VEG = {'grass': 40, 'shell': 30, 'fern': 300, 'flowers': 300, 'bush': 300, 'rocksmall': 300, 'bushround': 300, 'hedge': 300}
LANDMARK = {'volcano', 'lighthouse', 'temple', 'station', 'cliff'}


def budget(group):
    if group in VEG:
        return VEG[group]
    return 6000 if group in LANDMARK else 2500


def build(filename, props, ao_opts=None):
    """Build the given prop functions (id = function name) into one GLB file."""
    out = lib.arg('out', '.')
    only = lib.arg('only')
    only = set(only.split(',')) if only else None
    os.makedirs(out, exist_ok=True)
    lib.reset()
    lib._mats.clear()
    lib.fast_primitives(True)
    for i, fn in enumerate(props):
        if only and fn.__name__ not in only:
            continue
        random.seed(1000 + i)
        fn()
    opts = {'*': {}}
    opts.update(ao_opts or {})
    return lib.finalize(os.path.join(out, filename), ao=True, ao_opts=opts, budgets=budget)
