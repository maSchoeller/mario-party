"""Prop library + map landmarks (ASSET-01/02, ART-04/05) – shared + field buildings.

Usage: blender -b -P props.py -- --out <dir> [--only id,id]

One GLB (props.glb) whose objects are named "<prop>__<material>"; every prop is built
around its own origin (Babylon space, ground at y = 0, front = -Z) and keeps the
footprint of the procedural placeholder it replaces, so board layouts stay valid.
Material "tint" is colored at runtime (roofs, train, awnings …). Vertex colors (COLOR_0)
carry tone variation + baked AO and multiply the palette color.

Theme libraries: props_island.py, props_volcano.py, props_city.py (same conventions).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import beam, box, cone, cyl, ico, lathe, prism, shade, tone, tube, vgrad  # noqa: E402
from propkit import (  # noqa: E402
    BARK, CREAM, GLASS, GOLD, GRASS, LAMP, LEAF, LEAF_D, METAL, PLASTER, R, RED, ROCK, ROPE, SLATE, STONE, WHITE, WOOD, WOOD_D, WOOD_L,
    at, barrel as barrel_, bezier, blob, boulder, crate as crate_, door, fence_segment, gable_roof, gable_wall, grass_tuft, lantern_head,
    lashing, leaf, lerp, plank, post, rope, sack, thatch, vlerp, window,
)

TAU = math.tau
TRUNK = 'c_b88a5a'
NUT = 'c_7a5232'


# ---- vegetation (also used by props_island) -----------------------------------------


def palm_tree(g, spine, seed=0, fronds=11, flen=2.7, r0=0.27, r1=0.14):
    """Ringed, curved palm trunk along `spine` (bezier control points) + drooping crown."""
    rr = R(seed)
    n = 10
    sp = bezier(*spine, n)
    pts, radii = [(sp[0][0], -0.15, sp[0][2])], [r0 * 1.35]
    for i in range(n):
        p0, p1 = sp[i], sp[i + 1]
        r = lerp(r0, r1, i / n)
        pts += [p0, vlerp(p0, p1, 0.8)]
        radii += [r * (1.25 if i == 0 else 0.9), r * 1.08]
    pts.append(sp[-1])
    radii.append(r1 * 0.85)
    t = tube(g, TRUNK, pts, radii, verts=7)
    top = sp[-1]
    h = top[1]
    shade(t, lambda x, y, z: 0.82 + 0.18 * min(1.0, y / h))
    # crown knob + coconuts
    blob(g, 'c_8a9a4a', (top[0], top[1] + 0.05, top[2]), r=0.26, scale=(1, 0.8, 1), seed=seed, subdiv=1, rough=0.1)
    for k in range(3):
        a = k / 3 * TAU + rr.uniform(-0.3, 0.3)
        ico(g, NUT, (top[0] + 0.2 * math.cos(a), top[1] - 0.2, top[2] + 0.2 * math.sin(a)), r=0.16, subdiv=1)
    # fronds: drooping outer ring + a few young ones pointing up
    for k in range(fronds):
        a = k / fronds * TAU + rr.uniform(-0.18, 0.18)
        young = k % 3 == 0
        L = flen * (0.75 if young else rr.uniform(0.9, 1.05))
        o = leaf(g, LEAF, (top[0], top[1] + 0.08, top[2]), a, length=L, width=0.6 if not young else 0.45,
                 rise=0.9 if young else 0.55, droop=0.7 if young else rr.uniform(1.4, 1.9), segs=8, fold=0.35, serr=0.5,
                 pitch=0.25 if young else 0.05, lo=0.7)
        tone(o, rr.uniform(0.86, 1.0))


def palm():
    palm_tree('palm', ((0, 0, 0), (0.05, 2.6, 0.02), (0.75, 4.6, 0.12)), seed=3)


def tree():
    """Conifer: root flare, trunk, four jagged, drooping tiers."""
    g = 'tree'
    tube(g, BARK, [(0, -0.1, 0), (0, 0.25, 0), (0, 1.2, 0), (0, 2.6, 0)], [0.36, 0.22, 0.18, 0.1], verts=6)
    for k in range(4):
        rr = R(40 + k)
        y0 = 0.95 + k * 0.78
        r = 1.35 - k * 0.27
        hgt = 1.35 - k * 0.12
        o = lathe(g, LEAF_D, (0, y0, 0), [(r * 0.42, 0.18), (r, -0.05), (r * 0.62, hgt * 0.38), (0, hgt)], verts=14,
                  phase=k * 0.6, rfn=lambda a, j, rr=rr: (1.0 if round(a / TAU * 14) % 2 == 0 else 0.8) * (rr.uniform(0.93, 1.05) if j == 1 else 1.0))
        lib.noisify(o, 0.05, 1.5, k)
        tone(o, 0.86 + k * 0.045)


def deadtree():
    g = 'deadtree'
    mat = 'c_6e5e5c'
    trunk = bezier((0, 0, 0), (0.15, 1.6, -0.1), (-0.2, 3.0, 0.15), 6)
    tube(g, mat, [(0, -0.1, 0)] + trunk, [0.42, 0.3, 0.24, 0.2, 0.16, 0.12, 0.09, 0.05], verts=6)
    for k, (a, l) in enumerate(((0.3, 0.7), (2.0, 0.6), (3.6, 0.75), (5.0, 0.55))):
        tube(g, mat, [(0.1 * math.cos(a), 0.25, 0.1 * math.sin(a)), (0.45 * math.cos(a) * l / 0.6, 0.06, 0.45 * math.sin(a) * l / 0.6), (0.8 * math.cos(a) * l / 0.6, -0.1, 0.8 * math.sin(a) * l / 0.6)], [0.16, 0.08, 0.02], verts=5)
    for k, (i, a, l, up) in enumerate(((2, 0.5, 1.1, 0.7), (3, 2.7, 0.9, 0.6), (4, 4.4, 0.8, 0.8), (5, 1.5, 0.6, 0.5))):
        p = trunk[i]
        q = (p[0] + math.cos(a) * l, p[1] + l * up, p[2] + math.sin(a) * l)
        mid = (p[0] + math.cos(a) * l * 0.5, p[1] + l * up * 0.3, p[2] + math.sin(a) * l * 0.5)
        tube(g, mat, [p, mid, q], [0.09, 0.06, 0.015], verts=5)
        tw = (q[0] + math.cos(a + 0.9) * 0.35, q[1] + 0.3, q[2] + math.sin(a + 0.9) * 0.35)
        tube(g, mat, [vlerp(mid, q, 0.6), tw], [0.035, 0.008], verts=4)
    tone_all = [o for o in lib.bpy.data.objects if o.name.startswith(g + '__')]
    for o in tone_all:
        vgrad(o, 0.8, 1.0)


def rock():
    g = 'rock'
    boulder(g, ROCK, (0, 0.35, 0), size=(0.95, 0.72, 0.82), seed=3, subdiv=2, rough=0.3, strata=0.08)
    boulder(g, ROCK, (0.62, 0.18, 0.35), size=(0.45, 0.4, 0.42), seed=4, subdiv=2, rough=0.25)
    boulder(g, ROCK, (0.2, 0.08, -0.72), size=(0.3, 0.2, 0.26), seed=6, subdiv=2, rough=0.2)
    boulder(g, ROCK, (-0.55, 0.08, -0.45), size=(0.24, 0.18, 0.22), seed=5, subdiv=1, rough=0.15)
    grass_tuft(g, GRASS, (-0.5, 0, 0.45), n=4, h=0.32, seed=1)
    grass_tuft(g, GRASS, (0.75, 0, -0.25), n=3, h=0.25, seed=2)


def obsidian():
    g = 'obsidian'
    boulder(g, 'c_4a4158', (0, 0.1, 0), size=(1.3, 0.35, 1.0), seed=7, subdiv=1, rough=0.2)
    shards = ((-0.55, 0, 0.1, 1.9, 0.38, 0.2, -0.2), (0.05, 0, -0.1, 3.1, 0.46, 0.0, 0.05), (0.6, 0, 0.25, 2.3, 0.4, -0.15, 0.25),
              (0.25, 0, 0.55, 1.4, 0.3, 0.35, 0.1), (-0.3, 0, -0.55, 1.1, 0.28, -0.3, -0.3), (0.75, 0, -0.45, 0.9, 0.24, 0.2, 0.45))
    for k, (x, y, z, h, r, tx, tz) in enumerate(shards):
        o = lathe(g, 'c_5d4f74' if k % 2 else 'c_4b4060', (x, -0.1, z), [(r * 0.8, 0), (r, h * 0.12), (r * 0.9, h * 0.72), (0, h)], verts=5, rot=(tx * 0.6, k * 1.3, tz * 0.6), phase=k)
        vgrad(o, 0.68, 1.0)
        tone(o, (0.95, 0.95, 1.0) if k % 2 else 1.0)
    # lava seeping out between the shards
    o = ico(g, 'glow_ff7a3d', (0.15, 0.06, -0.62), r=0.42, scale=(1.4, 0.12, 0.75), subdiv=2)
    lib.noisify(o, 0.08, 2.5, 2)
    for k, (x, z) in enumerate(((-0.55, -0.7), (0.85, -0.75), (0.65, -1.05))):
        boulder(g, 'c_4a4158', (x, 0.05, z), size=(0.18, 0.12, 0.16), seed=30 + k, subdiv=1, rough=0.1)


def volcano():
    """Landmark: crater sits at y = 10 (lava disk top at 10.25) like the placeholder."""
    g = 'volcano'

    def rf(a, j, top=False):
        amp = 0.1 if not top else 0.03
        ridge = abs(math.sin(3.5 * a + 0.35 * math.sin(2 * a) + j * 0.05)) * 2 - 1  # sharp radial ridges + gullies
        return 1 + amp * ridge + 0.025 * math.sin(11 * a + 1.3 * j)

    ys = [-0.4, 0.0, 0.7, 1.5, 2.4, 3.3, 4.2, 5.1, 6.0, 6.9, 7.8, 8.6, 9.3, 9.8]
    prof = [(10.6 if y < 0 else 10.0 - 0.7 * y + 0.25 * math.sin(y / 10 * math.pi), y) for y in ys]
    prof += [(3.0, 10.12), (2.75, 10.18), (2.6, 9.7)]
    body = lathe(g, 'c_8a7a82', (0, 0, 0), prof, verts=40, rfn=lambda a, j: rf(a, j, j >= len(ys) - 2) if j < len(ys) else 1 + 0.02 * math.sin(7 * a))
    lib.noisify(body, 0.22, 0.3, 11)
    lib.flatten(body, 0.0, 0.4)
    shade(body, lambda x, y, z: (0.8 + 0.2 * (1 - y / 10.2)) * (1 - 0.06 * (0.5 + 0.5 * math.sin(y * 2.2 + 0.6 * math.sin(math.atan2(z, x) * 3)))))
    # ashy, jagged crater rim
    ring = [(math.cos(a) * 2.95, 10.2 + 0.18 * math.sin(a * 5) ** 2, math.sin(a) * 2.95) for a in [k / 22 * TAU for k in range(23)]]
    rim = tube(g, 'c_5a4a52', ring, 0.32, verts=5)
    lib.noisify(rim, 0.12, 1.2, 4)
    # lava lake (same disk as the placeholder: r 2.6, top 10.25)
    cyl(g, 'glow_ff7a3d', (0, 10.05, 0), r1=2.65, r2=2.6, h=0.4, verts=20)
    # lava streams following gullies down the back (+Z side, away from the path)
    for k, a0 in enumerate((1.6, 2.5, 3.35)):
        pts, rad = [], []
        for i in range(13):
            t = i / 12
            y = 10.0 - t * 9.6
            a = a0 + 0.1 * math.sin(t * 6 + k) + t * 0.12
            r = (10.0 - 0.7 * y + 0.25 * math.sin(y / 10 * math.pi)) * (1 + 0.07) + 0.05
            pts.append((math.cos(a) * r, y + 0.1, math.sin(a) * r))
            rad.append(0.5 - 0.15 * t if i < 12 else 0.12)
        tube(g, 'glow_ff8a4d', pts, rad, verts=6, squash=0.45)
    # boulders around the foot, half sunk into the ground
    for k in range(10):
        a = k * 0.69 + 0.2
        rr = R(40 + k)
        sz = rr.uniform(0.6, 1.2)
        boulder(g, 'c_7a6a72', (math.cos(a) * rr.uniform(10.2, 11.2), 0.25, math.sin(a) * rr.uniform(10.2, 11.2)), size=(sz, sz * 0.7, sz * 0.9), seed=40 + k, subdiv=2, rough=0.25, yaw=a)


def cannon():
    g = 'cannon'
    # stone ring + round plank turntable
    lathe(g, STONE, (0, 0, 0), [(1.02, 0), (1.05, 0.12), (0.98, 0.18)], verts=12)
    for k in range(7):
        x = -0.84 + k * 0.28
        L = 2 * math.sqrt(max(0.05, 0.95**2 - x * x))
        plank(g, WOOD, (x, 0.24, -L / 2), (x, 0.24, L / 2), w=0.26, t=0.1, seed=k)
    # carriage: stepped side cheeks, axle, spoked wheels
    with at((0, 0.29, 0.15)):
        for sx in (-1, 1):
            prism(g, WOOD_D, (sx * 0.36, 0, 0), [(-0.55, 0), (0.75, 0), (0.75, 0.42), (0.35, 0.42), (0.35, 0.6), (-0.1, 0.6), (-0.1, 0.78), (-0.55, 0.78)], 0.12, rot=(0, math.pi / 2, 0))
            with at((sx * 0.55, 0.32, -0.25)):
                cyl(g, WOOD_D, (0, 0, 0), r1=0.36, h=0.1, verts=12, rot=(0, 0, math.pi / 2))
                cyl(g, WOOD, (sx * 0.02, 0, 0), r1=0.28, h=0.11, verts=12, rot=(0, 0, math.pi / 2))
                cyl(g, METAL, (sx * 0.05, 0, 0), r1=0.08, h=0.14, verts=6, rot=(0, 0, math.pi / 2))
                for k in range(3):
                    a = k / 3 * math.pi
                    beam(g, WOOD_D, (sx * 0.06, math.cos(a) * 0.27, math.sin(a) * 0.27), (sx * 0.06, -math.cos(a) * 0.27, -math.sin(a) * 0.27), width=0.05, thick=0.05, up=(1, 0, 0))
        box(g, METAL, (0, 0.32, -0.25), (1.24, 0.08, 0.08))
        box(g, WOOD_D, (0, 0.18, 0.1), (0.62, 0.14, 1.1))
    # barrel aiming forward/up (-Z), reinforcing rings + muzzle swell
    prof = [(0, -0.12), (0.14, -0.08), (0.32, 0.05), (0.4, 0.2), (0.4, 0.55), (0.43, 0.6), (0.43, 0.7), (0.37, 0.75), (0.33, 1.6), (0.36, 1.65), (0.36, 1.72), (0.31, 1.78), (0.3, 2.05), (0.36, 2.15), (0.36, 2.25)]
    with at((0, 1.0, 0.45), (-0.75, 0, 0)):
        lathe(g, 'c_4a475e', (0, -0.6, 0), prof, verts=12)
        cyl(g, SLATE, (0, 1.66, 0), r1=0.22, h=0.04, verts=10)
        lathe(g, 'glow_f2c94c', (0, 1.5, 0), [(0.37, 0), (0.37, 0.07)], verts=12)
        cyl(g, 'c_4a475e', (0, 0, 0), r1=0.1, h=0.95, verts=6, rot=(0, 0, math.pi / 2))
    # cannon balls, rope coil
    for k, (x, y, z) in enumerate(((0.95, 0.42, -0.55), (1.2, 0.42, -0.3), (1.2, 0.42, -0.75), (1.12, 0.65, -0.53))):
        ico(g, 'c_4a475e', (x, y, z), r=0.17, subdiv=1)
    lib.torus(g, ROPE, (-0.95, 0.38, 0.55), R=0.22, r=0.06, seg=10, mseg=4)
    lib.torus(g, ROPE, (-0.95, 0.47, 0.55), R=0.17, r=0.055, seg=10, mseg=4)


def crab():
    g = 'crab'
    body = ico(g, 'c_ef7f7a', (0, 0.42, 0), r=0.6, scale=(1.05, 0.5, 0.8), subdiv=2)
    lib.noisify(body, 0.03, 3, 1)
    vgrad(body, 0.8, 1.0)
    lathe(g, 'c_ef7f7a', (0, 0.3, 0), [(0.58, 0), (0.64, 0.06), (0.6, 0.11)], verts=12, scale=(1.05, 1, 0.8))
    for k, (x, z, r) in enumerate(((0.22, 0.1, 0.1), (-0.2, 0.2, 0.08), (0.05, 0.32, 0.07))):
        ico(g, 'c_f7aaa2', (x, 0.66, z), r=r, scale=(1, 0.3, 1), subdiv=1)
    for side in (-1, 1):
        # arm + big claw with open pincer
        tube(g, 'c_ef7f7a', [(side * 0.45, 0.4, -0.3), (side * 0.75, 0.55, -0.5), (side * 0.85, 0.6, -0.75)], [0.09, 0.08, 0.07], verts=5)
        ico(g, 'c_ef7f7a', (side * 0.88, 0.65, -0.95), r=0.24, scale=(0.9, 0.75, 1.15), subdiv=1)
        cone(g, 'c_f08a8d', (side * 0.95, 0.78, -1.2), r=0.1, h=0.36, verts=4, rot=(-1.3, 0, side * 0.2))
        cone(g, 'c_f08a8d', (side * 0.85, 0.58, -1.18), r=0.08, h=0.3, verts=4, rot=(-1.75, 0, -side * 0.1))
        # legs: three bent legs per side
        for k in range(3):
            z = 0.05 + k * 0.22
            tube(g, 'c_d9575b', [(side * 0.5, 0.35, z), (side * 0.85, 0.48, z + 0.05), (side * 1.05, 0.0, z + 0.12)], [0.055, 0.045, 0.015], verts=4)
        # eye stalks
        tube(g, 'c_ef7f7a', [(side * 0.17, 0.6, -0.3), (side * 0.19, 0.82, -0.33)], [0.04, 0.035], verts=5)
        ico(g, WHITE, (side * 0.19, 0.92, -0.34), r=0.1, subdiv=1)
        ico(g, 'c_1d1b2a', (side * 0.19, 0.93, -0.43), r=0.05, subdiv=1)
    # little smile
    tube(g, 'c_1d1b2a', [(-0.12, 0.42, -0.47), (0, 0.38, -0.5), (0.12, 0.42, -0.47)], 0.02, verts=4)


def tower():
    """Clock tower: board places it at y = 3.5 (center of a 7 m tall shaft) – keep that origin."""
    g = 'tower'
    lathe(g, STONE, (0, 0, 0), [(1.32, -3.55), (1.32, -3.1), (1.18, -2.98), (1.04, -2.9)], verts=6)
    sh = lathe(g, CREAM, (0, 0, 0), [(1.0, -2.95), (0.93, 2.45)], verts=6)
    for y in (-1.0, 1.0):
        lathe(g, STONE, (0, y, 0), [(1.0 - (y + 3) * 0.013, -0.06), (1.03 - (y + 3) * 0.013, 0.0), (1.0 - (y + 3) * 0.013, 0.06)], verts=6)
    # corner quoins
    for k in range(6):
        a = k / 6 * TAU
        for j in range(5):
            y = -2.6 + j * 1.15
            rr = 1.0 - (y + 3) * 0.0125
            box(g, STONE, (math.cos(a) * rr, y, math.sin(a) * rr), (0.2 if j % 2 else 0.14, 0.32, 0.2 if j % 2 else 0.14), rot=(0, -a, 0))
    # cornice, gallery with balusters, belfry posts
    lathe(g, STONE, (0, 0, 0), [(0.93, 2.45), (1.18, 2.62), (1.22, 2.78), (1.0, 2.8)], verts=6)
    lathe(g, CREAM, (0, 0, 0), [(0.82, 2.78), (0.8, 3.55)], verts=6)
    for k in range(12):
        a = k / 12 * TAU + 0.26
        cyl(g, WHITE, (math.cos(a) * 1.1, 3.0, math.sin(a) * 1.1), r1=0.045, h=0.42, verts=4)
    lathe(g, WHITE, (0, 3.22, 0), [(1.16, -0.03), (1.16, 0.03)], verts=12)
    for k in range(6):
        a = (k + 0.5) / 6 * TAU
        box(g, SLATE, (math.cos(a) * 0.72, 3.15, math.sin(a) * 0.72), (0.16, 0.5, 0.22), rot=(0, -a, 0))
    # roof (tint) with eaves + golden finial
    lathe(g, 'tint', (0, 0, 0), [(1.3, 3.45), (1.38, 3.55), (0.95, 4.2), (0.45, 5.0), (0, 5.75)], verts=6)
    lathe(g, 'glow_f2c94c', (0, 5.68, 0), [(0, 0), (0.06, 0.1), (0.04, 0.35), (0.12, 0.42), (0, 0.6)], verts=5)
    # clock faces front/back
    for s in (-1, 1):
        z = s * (0.93 * math.cos(math.pi / 6) + 0.02)
        with at((0, 1.85, z), (0, 0 if s < 0 else math.pi, 0)):
            cyl(g, STONE, (0, 0, 0.02), r1=0.58, h=0.08, verts=16, rot=(math.pi / 2, 0, 0))
            cyl(g, WHITE, (0, 0, -0.03), r1=0.48, h=0.06, verts=16, rot=(math.pi / 2, 0, 0))
            for k in range(4):
                a = k / 4 * TAU
                box(g, SLATE, (math.cos(a) * 0.4, math.sin(a) * 0.4, -0.07), (0.06, 0.06, 0.02))
            box(g, SLATE, (0, 0.13, -0.08), (0.05, 0.3, 0.02))
            box(g, SLATE, (0.1, 0.0, -0.09), (0.24, 0.05, 0.02), rot=(0, 0, 0.3))
            ico(g, 'glow_f2c94c', (0, 0, -0.1), r=0.05, subdiv=1)
    # slit windows + door
    for y in (-1.6, 0.0):
        for a in (math.pi / 2 * -1, math.pi / 6, math.pi * 5 / 6):
            d = 0.93 * math.cos(math.pi / 6) + 0.03 - (y + 3) * 0.006
            with at((math.cos(a) * d, y, math.sin(a) * d), (0, -a - math.pi / 2, 0)):
                box(g, GLASS, (0, 0, 0), (0.2, 0.5, 0.05))
                lib.cyl(g, GLASS, (0, 0.25, 0), r1=0.1, h=0.05, verts=8, rot=(math.pi / 2, 0, 0))
                box(g, STONE, (0, -0.29, -0.04), (0.32, 0.06, 0.1))
    door(g, (0, -3.12, -0.9), w=0.62, h=1.05, step=None)


def fountain():
    """Board places it at y = 0.3 (basin from y = -0.3 to +0.3)."""
    g = 'fountain'
    lathe(g, STONE, (0, 0, 0), [(1.5, -0.32), (1.54, 0.12), (1.64, 0.2), (1.64, 0.32), (1.44, 0.32), (1.4, 0.05)], verts=8, phase=math.pi / 8)
    lathe(g, 'c_9fd8ec', (0, 0, 0), [(1.42, 0.1), (1.42, 0.2)], verts=16)
    lathe(g, STONE, (0, 0, 0), [(0.42, 0.05), (0.38, 0.28), (0.24, 0.4), (0.2, 0.95), (0.3, 1.08), (0.18, 1.18)], verts=8,
          rfn=lambda a, j: 1.0 if j not in (3,) else (1.0 if round(a / TAU * 8) % 2 else 0.88))
    lathe(g, STONE, (0, 0, 0), [(0.16, 1.15), (0.68, 1.36), (0.76, 1.48), (0.6, 1.48), (0.56, 1.42)], verts=10)
    lathe(g, 'c_9fd8ec', (0, 0, 0), [(0.6, 1.38), (0.6, 1.45)], verts=12)
    lathe(g, STONE, (0, 0, 0), [(0.1, 1.42), (0.1, 1.7), (0.16, 1.78), (0, 1.95)], verts=6)
    # water: spout cap + arcs falling into the basin
    lathe(g, 'c_cbeefa', (0, 0, 0), [(0, 1.92), (0.14, 2.06), (0.08, 2.18), (0, 2.25)], verts=6)
    for k in range(6):
        a = k / 6 * TAU + 0.3
        c, s = math.cos(a), math.sin(a)
        pts = [(c * 0.1, 2.05, s * 0.1), (c * 0.35, 2.12, s * 0.35), (c * 0.6, 1.85, s * 0.6), (c * 0.72, 1.5, s * 0.72)]
        tube(g, 'c_cbeefa', pts, [0.035, 0.04, 0.045, 0.03], verts=4)
        pts = [(c * 0.74, 1.47, s * 0.74), (c * 0.98, 1.2, s * 0.98), (c * 1.12, 0.75, s * 1.12), (c * 1.16, 0.2, s * 1.16)]
        tube(g, 'c_cbeefa', pts, [0.03, 0.035, 0.03, 0.02], verts=4)
    for k in range(8):
        a = (k + 0.5) / 8 * TAU
        o = box(g, STONE, (math.cos(a) * 1.55, 0.33, math.sin(a) * 1.55), (0.12, 0.04, 0.5), rot=(0, -a, 0))
        tone(o, 0.92)


def loco():
    """Train engine (faces +Z like the placeholder: board rotates with atan2(dx, dz))."""
    g = 'loco'
    box(g, SLATE, (0, 0.6, 0.3), (1.3, 0.32, 3.9), bevel=0.03)
    box(g, RED, (0, 0.6, 2.3), (1.8, 0.34, 0.16))
    for sx in (-1, 1):
        cyl(g, SLATE, (sx * 0.6, 0.6, 2.42), r1=0.09, h=0.2, verts=6, rot=(math.pi / 2, 0, 0))
        cyl(g, SLATE, (sx * 0.6, 0.6, 2.53), r1=0.15, h=0.04, verts=8, rot=(math.pi / 2, 0, 0))
        box(g, 'tint', (sx * 0.72, 0.86, 0.75), (0.32, 0.06, 2.9))
    # boiler (tint) with golden bands, darker smokebox
    with at((0, 1.28, 0), (math.pi / 2, 0, 0)):
        lathe(g, 'tint', (0, 0, 0), [(0.6, -0.3), (0.62, 1.7)], verts=14)
        lathe(g, SLATE, (0, 0, 0), [(0.66, 1.68), (0.66, 2.12), (0.5, 2.2), (0, 2.22)], verts=14)
        for y in (0.15, 0.8, 1.45):
            lathe(g, GOLD, (0, y, 0), [(0.635, -0.04), (0.635, 0.04)], verts=14)
    # smokestack, steam + sand domes, whistle
    lathe(g, SLATE, (0, 1.75, 1.85), [(0.17, 0), (0.18, 0.45), (0.33, 0.85), (0.36, 0.98), (0.3, 1.02), (0.27, 0.95)], verts=10)
    lathe(g, GOLD, (0, 1.75, 0.95), [(0.28, 0), (0.28, 0.12), (0.2, 0.3), (0, 0.36)], verts=10)
    lathe(g, 'tint', (0, 1.78, 0.35), [(0.2, 0), (0.2, 0.08), (0.14, 0.2), (0, 0.24)], verts=8)
    lathe(g, GOLD, (0, 1.85, -0.12), [(0.04, 0), (0.04, 0.25), (0.07, 0.3), (0, 0.4)], verts=5)
    # headlamp
    box(g, SLATE, (0, 1.95, 2.0), (0.32, 0.28, 0.26))
    cyl(g, 'glow_f2c94c', (0, 1.95, 2.14), r1=0.11, h=0.04, verts=8, rot=(math.pi / 2, 0, 0))
    # cab: walls with window openings, curved roof
    box(g, 'tint', (0, 1.25, -0.95), (1.7, 0.95, 1.35), bevel=0.03)
    for sx in (-1, 1):
        for z in (-1.55, -0.35):
            box(g, 'tint', (sx * 0.78, 2.0, z), (0.14, 0.6, 0.14))
        box(g, 'tint', (sx * 0.78, 2.24, -0.95), (0.14, 0.12, 1.3))
    box(g, 'tint', (0, 2.0, -0.32), (1.7, 0.6, 0.1))
    for sx in (-1, 1):
        box(g, GLASS, (sx * 0.42, 2.02, -0.26), (0.48, 0.42, 0.04))
    arc = [(math.sin(a) * 1.6, 2.32 + (math.cos(a) - 1) * 1.6 * 0.55) for a in [-0.62 + k * 0.124 for k in range(11)]]
    outline = [(x, y + 0.09) for x, y in arc] + [(x, y) for x, y in reversed(arc)]
    prism(g, RED, (0, -0.0, -0.95), outline, 1.65)
    box(g, RED, (0, 2.33, -0.95), (0.3, 0.06, 1.7))
    # cow catcher (slats)
    for k in range(5):
        x = (k - 2) * 0.28
        beam(g, SLATE, (x * 0.6, 0.12, 2.75), (x, 0.55, 2.38), width=0.1, thick=0.06, up=(0, 0.6, 1))
    # wheels with golden hubs + coupling rods
    for sx in (-1, 1):
        for z in (-0.9, 0.2, 1.3):
            cyl(g, RED, (sx * 0.74, 0.42, z), r1=0.4, h=0.14, verts=14, rot=(0, 0, math.pi / 2))
            cyl(g, SLATE, (sx * 0.77, 0.42, z), r1=0.3, h=0.1, verts=14, rot=(0, 0, math.pi / 2))
            cyl(g, 'glow_f2c94c', (sx * 0.84, 0.42, z), r1=0.1, h=0.06, verts=6, rot=(0, 0, math.pi / 2))
        box(g, GOLD, (sx * 0.88, 0.32, 0.2), (0.05, 0.08, 2.3))


def stall():
    """Shop stall (striped awning, counter) – replaces the hut at shop fields."""
    g = 'stall'
    # counter: plank front, top board, side legs
    for k in range(9):
        x = -1.2 + k * 0.3
        plank(g, WOOD, (x, 0.04, -0.62), (x, 1.05, -0.62), w=0.28, t=0.07, up=(0, 0, -1), seed=k)
    box(g, WOOD_D, (0, 0.55, 0), (2.5, 1.0, 1.2))
    box(g, WOOD_L, (0, 1.1, -0.05), (2.85, 0.1, 1.45), bevel=0.02)
    box(g, WOOD_D, (0, 0.85, -0.68), (2.6, 0.08, 0.05))
    # posts (back taller) + lashings
    for sx in (-1, 1):
        post(g, WOOD_D, (sx * 1.3, 0, 0.6), 3.15, r=0.075, seed=sx)
        post(g, WOOD_D, (sx * 1.3, 0, -0.62), 2.45, r=0.075, seed=sx + 5)
        lashing(g, ROPE, (sx * 1.3, 2.3, -0.62), 0.075)
    # striped awning with scalloped valance
    for k in range(6):
        x0 = -1.375 + 0.55 * k + 0.275
        o = beam(g, 'tint' if k % 2 else CREAM, (x0, 3.15, 0.72), (x0, 2.42, -0.95), width=0.55, thick=0.06)
        o2 = prism(g, 'tint' if k % 2 else CREAM, (x0, 2.39, -0.97), [(-0.275, 0.0), (0.275, 0.0), (0.0, -0.22)], 0.04)
    box(g, WOOD_D, (0, 2.42, -0.95), (2.85, 0.07, 0.07))
    # goods: crates of fruit, a basket, a sack
    for k, col in enumerate(('c_e8676b', 'c_f2c94c', 'c_7cbf6b')):
        with at((-0.8 + k * 0.8, 1.15, -0.15)):
            box(g, WOOD_L, (0, 0.1, 0), (0.62, 0.2, 0.5))
            for j in range(5):
                ico(g, col, (-0.18 + (j % 3) * 0.18, 0.24 + (j // 3) * 0.06, -0.08 + (j // 3) * 0.14), r=0.1, subdiv=1)
    lathe(g, WOOD_L, (1.0, 1.15, 0.35), [(0.16, 0), (0.24, 0.2), (0.25, 0.24)], verts=8)
    barrel_(g, (1.65, 0, 0.1), h=0.8, r=0.3, seed=2)
    sack(g, (-1.65, 0, -0.3), s=0.55, seed=3)
    # sign board above the counter
    box(g, WOOD, (0, 2.85, -0.55), (1.2, 0.36, 0.06), bevel=0.02)
    ico(g, 'glow_f2c94c', (0, 2.85, -0.6), r=0.1, scale=(1, 1, 0.4), subdiv=1)
    for sx in (-1, 1):
        rope(g, ROPE, (sx * 0.5, 3.1, -0.4), (sx * 0.5, 3.03, -0.55), sag=0.0, r=0.015, n=1)


def hut(name='hut', w=3.0, h=2.0, d=2.6):
    """Island hut: plank walls on a deck, log corner posts, layered thatch roof (tint)."""
    g = name
    rr = R(5)
    # deck
    box(g, WOOD_D, (0, 0.08, 0), (w + 0.3, 0.16, d + 0.9))
    n = 11
    for k in range(n):
        z = -(d + 0.9) / 2 + (k + 0.5) * (d + 0.9) / n
        plank(g, WOOD_L, (-(w + 0.5) / 2, 0.2, z), ((w + 0.5) / 2 + rr.uniform(-0.08, 0.08), 0.2, z), w=(d + 0.9) / n * 0.92, t=0.07, seed=k)
    # plank walls
    pw = 0.33
    for side, (L, pos, ax) in enumerate(((w, -d / 2, 'x'), (w, d / 2, 'x'), (d, -w / 2, 'z'), (d, w / 2, 'z'))):
        m = int(L / pw)
        for k in range(m):
            c = -L / 2 + (k + 0.5) * L / m
            top = h + rr.uniform(-0.05, 0.05)
            if ax == 'x':
                plank(g, WOOD_L, (c, 0.2, pos), (c, top, pos), w=L / m * 0.94, t=0.1, up=(0, 0, 1), seed=side * 20 + k, var=0.16)
            else:
                plank(g, WOOD_L, (pos, 0.2, c), (pos, top, c), w=L / m * 0.94, t=0.1, up=(1, 0, 0), seed=side * 20 + k, var=0.16)
    box(g, WOOD, (0, h / 2, 0), (w - 0.1, h - 0.1, d - 0.1))
    for y in (0.7, h - 0.15):
        box(g, WOOD, (0, y, -d / 2 - 0.07), (w, 0.1, 0.05))
        box(g, WOOD, (0, y, d / 2 + 0.07), (w, 0.1, 0.05))
    # log corner posts with rope lashings
    for sx in (-1, 1):
        for sz in (-1, 1):
            post(g, WOOD_D, (sx * w / 2, 0.15, sz * d / 2), h + 0.25, r=0.13, seed=sx * 3 + sz)
            lashing(g, ROPE, (sx * w / 2, h - 0.25, sz * d / 2), 0.13, h=0.16)
    # layered thatch roof (tint) + ridge cap
    thatch(g, 'tint', (0, h + 0.05, 0), w * 0.8, 1.85, tiers=3, sx=1.0, sz=d / w, seed=9)
    cone(g, WOOD_D, (0, h + 2.0, 0), r=0.16, h=0.35, verts=4, rot=(0, math.pi / 4, 0))
    # door, windows with tint shutters, lantern, pot plant
    door(g, (0.15, 0.22, -d / 2 - 0.05), w=0.75, h=1.25, step=None)
    for sx in (-1, 1):
        window(g, (sx * w * 0.32, h * 0.62, -d / 2 - 0.06), w=0.42, h=0.46, frame=WOOD_D, shutter='tint', sill=WOOD, cross=True)
    window(g, (0, h * 0.62, d / 2 + 0.06), w=0.42, h=0.46, yaw=math.pi, frame=WOOD_D, shutter='tint', sill=WOOD)
    with at((-0.42, 1.45, -d / 2 - 0.15)):
        box(g, WOOD_D, (0, 0.25, 0.05), (0.05, 0.05, 0.25))
        lantern_head(g, (0, -0.05, -0.05), s=0.7)
    lathe(g, 'c_d98c6a', (w / 2 + 0.1, 0.2, -d / 2 - 0.3), [(0.14, 0), (0.2, 0.28), (0.21, 0.32)], verts=8)
    blob(g, LEAF, (w / 2 + 0.1, 0.62, -d / 2 - 0.3), r=0.24, seed=4)
    crate_(g, (-w / 2 - 0.05, 0.2, -d / 2 - 0.3), s=0.45, yaw=0.3, seed=6, diag=False)


def house():
    """City house: two floors, gable roof (tint), shutters (tint) – board scales it ×1.3."""
    g = 'house'
    w, h, d = 3.0, 2.8, 2.6
    box(g, STONE, (0, 0.14, 0), (w + 0.16, 0.28, d + 0.16), bevel=0.03)
    box(g, PLASTER, (0, h / 2, 0), (w, h, d), bevel=0.03)
    box(g, STONE, (0, 1.38, 0), (w + 0.08, 0.1, d + 0.08))
    for sx in (-1, 1):
        for sz in (-1, 1):
            for j in range(5):
                y = 0.45 + j * 0.5
                big = j % 2 == 0
                box(g, STONE, (sx * (w / 2 - (0.12 if big else 0.08) + 0.03), y, sz * (d / 2 - (0.08 if big else 0.12) + 0.03)), (0.3 if big else 0.2, 0.2, 0.2 if big else 0.3))
    # gable roof (ridge along X) + gable walls + chimney
    gable_wall(g, PLASTER, (0, h, 0), d, 1.4, w - 0.02, yaw=math.pi / 2)
    gable_roof(g, 'tint', (0, h - 0.02, 0), w, d, 1.45, over=0.28, thick=0.12, rows=4, ridge='c_c96f5f', seed=3)
    with at((0.85, h, 0.55)):
        box(g, 'c_c98a72', (0, 1.25, 0), (0.42, 1.5, 0.42))
        box(g, STONE, (0, 2.04, 0), (0.54, 0.1, 0.54))
        box(g, SLATE, (0, 2.1, 0), (0.28, 0.04, 0.28))
    # front: door with canopy, windows with shutters + flower boxes
    door(g, (-0.75, 0.28, -d / 2 - 0.02), w=0.68, h=1.0, wood='c_7a8fc0', frame=WHITE, step=STONE)
    beam(g, 'tint', (-0.75, 1.62, -d / 2), (-0.75, 1.45, -d / 2 - 0.45), width=1.0, thick=0.06)
    window(g, (0.6, 0.9, -d / 2 - 0.03), w=0.55, h=0.6, shutter='tint')
    for sx in (-0.75, 0.75):
        window(g, (sx, 2.1, -d / 2 - 0.03), w=0.5, h=0.62, shutter='tint', box_flowers='c_f28aa0')
    # back + sides
    for sx in (-0.75, 0.75):
        window(g, (sx, 2.1, d / 2 + 0.03), w=0.5, h=0.62, yaw=math.pi, shutter='tint')
        window(g, (sx, 0.9, d / 2 + 0.03), w=0.5, h=0.6, yaw=math.pi)
    for sx in (-1, 1):
        window(g, (sx * (w / 2 + 0.03), 2.1, 0), w=0.45, h=0.55, yaw=-sx * math.pi / 2)
        window(g, (sx * (w / 2 + 0.03), 0.9, 0.3), w=0.45, h=0.55, yaw=-sx * math.pi / 2)
    # small details: bush + bench by the door
    blob(g, LEAF_D, (1.4, 0.3, -d / 2 - 0.35), r=0.35, scale=(1, 0.8, 0.8), seed=2)
    blob(g, LEAF_D, (-1.45, 0.25, -d / 2 - 0.3), r=0.28, scale=(1, 0.8, 0.8), seed=5)


# ---- shared new props ------------------------------------------------------------------


def itemshop():
    """Item-Häuschen for item fields: small shop hut, open counter, striped awning (tint)."""
    g = 'itemshop'
    w, d, h = 2.4, 2.0, 1.9
    box(g, STONE, (0, 0.1, 0), (w + 0.3, 0.2, d + 0.3), bevel=0.03)
    # back + side walls (plaster) with timber corner posts; front is an open counter
    box(g, PLASTER, (0, h / 2 + 0.2, d / 2 - 0.1), (w, h, 0.2))
    for sx in (-1, 1):
        box(g, PLASTER, (sx * (w / 2 - 0.1), h / 2 + 0.2, 0), (0.2, h, d))
    box(g, PLASTER, (0, h - 0.15, -d / 2 + 0.1), (w, 0.5, 0.2))
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(g, WOOD_D, (sx * w / 2, h / 2 + 0.2, sz * d / 2), (0.18, h + 0.05, 0.18))
    for k in range(7):
        x = -w / 2 + 0.2 + k * (w - 0.4) / 6
        plank(g, WOOD, (x, 0.2, -d / 2 + 0.05), (x, 0.95, -d / 2 + 0.05), w=(w - 0.4) / 6 * 0.92, t=0.08, up=(0, 0, -1), seed=k)
    box(g, WOOD_L, (0, 1.0, -d / 2 + 0.05), (w + 0.1, 0.09, 0.5), bevel=0.02)
    # shelves with potion bottles inside
    for j, y in enumerate((0.85, 1.35)):
        box(g, WOOD, (0, y, d / 2 - 0.35), (w - 0.5, 0.06, 0.3))
        for k, col in enumerate(('c_b48cf0', 'c_8fd3ff', 'c_ff9fb8', 'c_9be08a')):
            x = -0.75 + k * 0.5 + j * 0.15
            lathe(g, col, (x, y + 0.03, d / 2 - 0.35), [(0.08, 0), (0.1, 0.12), (0.04, 0.2), (0.04, 0.26), (0, 0.27)], verts=6)
    # roof (fixed lavender-blue) + gable walls
    gable_wall(g, PLASTER, (0, h + 0.2, 0), d, 0.95, w - 0.05, yaw=math.pi / 2)
    gable_roof(g, 'c_8c9ad6', (0, h + 0.18, 0), w, d, 1.0, over=0.25, thick=0.1, rows=3, ridge=WOOD_D, seed=7)
    # striped awning (tint/cream) with scallops
    for k in range(6):
        x0 = -w / 2 - 0.1 + (w + 0.2) / 6 * (k + 0.5)
        beam(g, 'tint' if k % 2 == 0 else CREAM, (x0, h - 0.05, -d / 2 + 0.05), (x0, h - 0.4, -d / 2 - 0.75), width=(w + 0.2) / 6, thick=0.05)
        prism(g, 'tint' if k % 2 == 0 else CREAM, (x0, h - 0.43, -d / 2 - 0.77), [(-(w + 0.2) / 12, 0), ((w + 0.2) / 12, 0), (0, -0.18)], 0.04)
    # round sign with a golden star on a bracket above the awning
    with at((0, h + 0.85, -d / 2 - 0.25)):
        cyl(g, WOOD, (0, 0, 0), r1=0.42, h=0.08, verts=12, rot=(math.pi / 2, 0, 0))
        lib.torus(g, WOOD_D, (0, 0, 0), R=0.43, r=0.045, seg=12, mseg=4, rot=(math.pi / 2, 0, 0))
        star = [(math.cos(a) * (0.3 if k % 2 == 0 else 0.13), math.sin(a) * (0.3 if k % 2 == 0 else 0.13)) for k, a in enumerate([math.pi / 2 + k * math.pi / 5 for k in range(10)])]
        prism(g, 'glow_f2c94c', (0, 0, -0.06), star, 0.06)
    # crates, barrel, sack, lantern
    crate_(g, (-w / 2 - 0.45, 0, -d / 2 - 0.1), s=0.6, yaw=0.25, seed=1)
    crate_(g, (-w / 2 - 0.4, 0.6, -d / 2 - 0.05), s=0.42, yaw=-0.2, seed=2, diag=False)
    barrel_(g, (w / 2 + 0.45, 0, -d / 2 + 0.1), h=0.85, r=0.32, seed=3)
    sack(g, (w / 2 + 0.35, 0, -d / 2 - 0.5), s=0.5, seed=4)
    with at((w / 2 + 0.05, 1.7, -d / 2 - 0.2)):
        box(g, WOOD_D, (0, 0.2, 0.12), (0.05, 0.05, 0.3))
        lantern_head(g, (0, -0.15, 0), s=0.75)


def startgate():
    """Start arch spanning a 2.5 wide tile: posts at x = ±1.75, banner top at y ≈ 3.5."""
    g = 'startgate'
    for sx in (-1, 1):
        x = sx * 1.75
        box(g, STONE, (x, 0.18, 0), (0.7, 0.36, 0.7), bevel=0.04)
        o = lathe(g, CREAM, (x, 0.35, 0), [(0.24, 0), (0.22, 2.75)], verts=10)
        for k in range(5):
            # candy stripes (tint) – spiral look from tilted rings
            lathe(g, 'tint', (x, 0.6 + k * 0.52, 0), [(0.235, -0.09), (0.235, 0.09)], verts=10, rot=(0.25, 0, 0.0))
        lathe(g, 'glow_f2c94c', (x, 3.1, 0), [(0.18, 0), (0.28, 0.12), (0.18, 0.3), (0, 0.42)], verts=8)
        # pennant flag on top
        cyl(g, WOOD_D, (x, 3.75, 0), r1=0.03, h=0.8, verts=4)
        prism(g, 'tint', (x + sx * 0.3, 3.95, 0), [(-sx * 0.28, 0.18), (-sx * 0.28, -0.18), (sx * 0.32, 0.0)], 0.03)
    # arched banner board with checkered stripes front and back
    arc = [(math.cos(a) * 1.75, 2.55 + math.sin(a) * 0.45, 0) for a in [math.pi - k / 10 * math.pi for k in range(11)]]
    for i in range(10):
        p, q = arc[i], arc[i + 1]
        beam(g, WOOD, (p[0], p[1], 0), (q[0], q[1], 0), width=0.18, thick=0.6, up=(0, 1, 0))
        for s in (-1, 1):
            for row in (0, 1):
                mat = WHITE if (i + row) % 2 == 0 else SLATE
                y_off = 0.1 - row * 0.2
                beam(g, mat, (p[0], p[1] + y_off + 0.05, s * 0.1), (q[0], q[1] + y_off + 0.05, s * 0.1), width=0.02, thick=0.18, up=(0, 1, 0))
    box(g, WOOD, (0, 3.08, 0), (1.3, 0.55, 0.16), bevel=0.03)
    star = [(math.cos(a) * (0.32 if k % 2 == 0 else 0.14), math.sin(a) * (0.32 if k % 2 == 0 else 0.14)) for k, a in enumerate([math.pi / 2 + k * math.pi / 5 for k in range(10)])]
    for s in (-1, 1):
        prism(g, 'glow_f2c94c', (0, 3.08, s * 0.1), star, 0.05)
    # pennant garland under the banner
    pts = [(-1.5, 2.3, -0.12), (1.5, 2.3, -0.12)]
    rope(g, ROPE, pts[0], pts[1], sag=0.35, r=0.018, n=8)
    for k in range(7):
        t = (k + 1) / 8
        x = lerp(-1.5, 1.5, t)
        y = 2.3 - 0.35 * 4 * t * (1 - t)
        prism(g, ('tint', 'c_f2c94c', 'c_8fd3ff')[k % 3], (x, y - 0.02, -0.12), [(-0.12, 0), (0.12, 0), (0, -0.26)], 0.02)


def chest():
    """Treasure chest pile for item fields (~1 wide)."""
    g = 'chest'
    with at((0, 0, 0.05)):
        for k in range(4):
            o = box(g, WOOD, (0, 0.08 + k * 0.13, 0), (0.86, 0.13, 0.56))
            tone(o, 0.88 + 0.12 * (k % 2))
        for sx in (-1, 1):
            box(g, GOLD, (sx * 0.3, 0.28, 0), (0.08, 0.56, 0.6))
        box(g, GOLD, (0, 0.3, -0.29), (0.16, 0.2, 0.04))
        box(g, SLATE, (0, 0.28, -0.31), (0.05, 0.08, 0.02))
        # open, rounded lid tilted back
        with at((0, 0.56, 0.28), (0.95, 0, 0)):
            lathe(g, WOOD, (0, 0, -0.28), [(0.28, -0.43), (0.28, 0.43)], verts=10, rot=(0, 0, math.pi / 2), scale=(1, 1, 1))
            for sx in (-1, 1):
                lathe(g, GOLD, (sx * 0.3, 0, -0.28), [(0.295, -0.04), (0.295, 0.04)], verts=10, rot=(0, 0, math.pi / 2))
        # gold heap inside + spilled coins and a gem
        o = ico(g, 'glow_f2c94c', (0, 0.55, 0), r=0.36, scale=(1.1, 0.35, 0.7), subdiv=1)
        lib.noisify(o, 0.05, 4, 3)
    rr = R(9)
    for k in range(7):
        a = rr.uniform(0, TAU)
        r = rr.uniform(0.5, 0.75)
        cyl(g, 'glow_f2c94c', (math.cos(a) * r, 0.025 + (k % 2) * 0.04, math.sin(a) * r * 0.8), r1=0.08, h=0.035, verts=8, rot=(rr.uniform(-0.3, 0.3), 0, rr.uniform(-0.3, 0.3)))
    ico(g, 'c_7fd6e0', (0.15, 0.68, 0.0), r=0.09, subdiv=0)
    ico(g, 'c_f28aa0', (-0.2, 0.66, 0.08), r=0.07, subdiv=0)


def duelring():
    """Crossed swords behind a round shield on a stump (~1 wide)."""
    g = 'duelring'
    boulder(g, STONE, (0, 0.06, 0), size=(0.55, 0.14, 0.5), seed=2, subdiv=1, rough=0.1)
    post(g, WOOD_D, (0, 0.05, 0.05), 1.05, r=0.11, seed=1)
    for s in (-1, 1):
        with at((0, 1.05, 0.08), (0, 0, s * 0.7)), at((0, -0.5, 0)):
            prism(g, 'c_e6e9f2', (0, 0.7, 0), [(-0.07, -0.7), (0.07, -0.7), (0.07, 0.5), (0, 0.68), (-0.07, 0.5)], 0.035)
            box(g, 'c_c9cede', (0, 0.62, -0.02), (0.025, 1.1, 0.01))
            box(g, GOLD, (0, -0.02, 0), (0.36, 0.06, 0.08), bevel=0.01)
            cyl(g, WOOD_D, (0, -0.17, 0), r1=0.035, h=0.24, verts=5)
            ico(g, GOLD, (0, -0.31, 0), r=0.05, subdiv=1)
    with at((0, 0.95, -0.12)):
        cyl(g, 'tint', (0, 0, 0), r1=0.3, h=0.07, verts=14, rot=(math.pi / 2, 0, 0))
        lib.torus(g, METAL, (0, 0, 0), R=0.31, r=0.04, seg=14, mseg=4, rot=(math.pi / 2, 0, 0))
        ico(g, GOLD, (0, 0, -0.05), r=0.1, scale=(1, 1, 0.6), subdiv=2)
        box(g, WHITE, (0, 0, -0.04), (0.08, 0.42, 0.02))
        box(g, WHITE, (0, 0.06, -0.04), (0.42, 0.08, 0.02))
    grass_tuft(g, GRASS, (0.35, 0, -0.2), n=4, h=0.28, seed=3)
    grass_tuft(g, GRASS, (-0.3, 0, 0.25), n=3, h=0.24, seed=4)


def luckysign():
    """Signpost with a lucky wheel and a big golden '?' (~1 wide)."""
    g = 'luckysign'
    boulder(g, STONE, (0, 0.05, 0), size=(0.45, 0.12, 0.4), seed=5, subdiv=1, rough=0.1)
    post(g, WOOD_D, (0, 0.0, 0.08), 1.6, r=0.07, seed=2)
    with at((0, 1.25, -0.02)):
        cols = ('tint', 'c_f2c94c', 'c_8fd3ff', 'c_9be08a', 'c_f28aa0', WHITE)
        for k in range(6):
            a0 = k / 6 * TAU
            a1 = (k + 1) / 6 * TAU
            pts = [(0, 0)] + [(math.cos(lerp(a0, a1, t)) * 0.45, math.sin(lerp(a0, a1, t)) * 0.45) for t in (0, 0.5, 1)]
            prism(g, cols[k], (0, 0, 0), pts, 0.06)
        lib.torus(g, WOOD, (0, 0, 0), R=0.47, r=0.045, seg=14, mseg=4, rot=(math.pi / 2, 0, 0))
        for k in range(6):
            a = k / 6 * TAU
            ico(g, 'glow_ffd98a', (math.cos(a) * 0.47, math.sin(a) * 0.47, -0.05), r=0.035, subdiv=1)
        cyl(g, GOLD, (0, 0, -0.05), r1=0.07, h=0.06, verts=8, rot=(math.pi / 2, 0, 0))
        prism(g, RED, (0, 0.52, -0.06), [(-0.08, 0.08), (0.08, 0.08), (0, -0.1)], 0.04)
    # golden question mark on top
    with at((0, 1.95, 0.05)):
        pts = [(math.cos(a) * 0.16, 0.2 + math.sin(a) * 0.16, 0) for a in [math.pi * 1.05 - k / 7 * math.pi * 1.45 for k in range(8)]]
        pts += [(0.0, 0.0, 0), (0.0, -0.08, 0)]
        tube(g, 'glow_f2c94c', pts, 0.045, verts=6)
        ico(g, 'glow_f2c94c', (0, -0.22, 0), r=0.06, subdiv=1)


def barrel():
    g = 'barrel'
    barrel_(g, (0, 0, 0), h=0.95, r=0.38, seed=1)


def crate():
    crate_('crate', (0, 0, 0), s=0.8, seed=1)


def signpost():
    g = 'signpost'
    post(g, WOOD_D, (0, -0.05, 0), 1.85, r=0.075, seed=3)
    cone(g, WOOD_D, (0, 1.86, 0), r=0.09, h=0.14, verts=6)
    for k, (y, yaw, L) in enumerate(((1.55, 0.3, 0.95), (1.22, 2.6, 0.85), (0.92, -0.9, 0.75))):
        with at((0, y, 0), (0, yaw, 0)):
            o = prism(g, WOOD_L, (0, 0, 0), [(0.05, -0.12), (L - 0.15, -0.12), (L, 0), (L - 0.15, 0.12), (0.05, 0.12)], 0.05)
            tone(o, (0.95, 0.9, 1.0)[k])
            box(g, WOOD, (L * 0.5, 0, -0.03), (L * 0.55, 0.035, 0.012))
            box(g, WOOD, (L * 0.45, -0.06, -0.03), (L * 0.4, 0.03, 0.012))
        lashing(g, ROPE, (0, y, 0), 0.075, h=0.08)
    grass_tuft(g, GRASS, (0.12, 0, -0.1), n=4, h=0.28, seed=7)
    boulder(g, ROCK, (-0.18, 0.05, 0.12), size=(0.16, 0.12, 0.14), seed=4, subdiv=1, rough=0.1)


def fence():
    """One fence segment: 2 long along X, origin at its center (posts at x = ±1)."""
    fence_segment('fence', (0, 0, 0), length=2.0, seed=4, pickets=3)


def lantern():
    g = 'lantern'
    boulder(g, STONE, (0, 0.06, 0), size=(0.32, 0.12, 0.3), seed=8, subdiv=1, rough=0.08)
    lathe(g, SLATE, (0, 0, 0), [(0.12, 0.08), (0.1, 0.2), (0.06, 0.3), (0.05, 2.0), (0.08, 2.05), (0, 2.12)], verts=6)
    tube(g, SLATE, [(0, 1.9, 0), (0, 1.97, -0.25), (0, 1.92, -0.45)], 0.025, verts=4)
    tube(g, SLATE, [(0, 1.68, 0), (0, 1.85, -0.2)], 0.02, verts=4)
    box(g, SLATE, (0, 1.9, -0.47), (0.03, 0.12, 0.03))
    lantern_head(g, (0, 1.4, -0.47), s=0.9, hang=True)


def bench():
    g = 'bench'
    for sx in (-1, 1):
        with at((sx * 0.62, 0, 0)):
            prism(g, SLATE, (0, 0, 0), [(-0.22, 0), (-0.16, 0), (-0.12, 0.38), (0.12, 0.38), (0.16, 0), (0.22, 0), (0.18, 0.44), (0.24, 0.88), (0.18, 0.9), (0.12, 0.46), (-0.18, 0.46)], 0.06, rot=(0, math.pi / 2, 0))
    for k in range(3):
        plank(g, WOOD, (-0.8, 0.46, -0.16 + k * 0.13), (0.8, 0.46, -0.16 + k * 0.13), w=0.11, t=0.05, seed=k)
    for k in range(2):
        y = 0.62 + k * 0.17
        z = 0.16 + k * 0.05
        plank(g, WOOD, (-0.8, y, z), (0.8, y, z), w=0.13, t=0.04, up=(0, 0.25, -1), seed=k + 4)


PROPS = (palm, hut, house, rock, tree, deadtree, obsidian, volcano, cannon, crab, tower, fountain, loco, stall,
         itemshop, startgate, chest, duelring, luckysign, barrel, crate, signpost, fence, lantern, bench)

if __name__ == '__main__':
    import propkit

    propkit.build('props.glb', PROPS, ao_opts={'volcano': {'samples': 12, 'dist': 1.2}, 'tower': {'ground': -3.55}, 'fountain': {'ground': -0.32}})
