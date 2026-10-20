"""Island prop library (Kokosnuss-Insel): props_island.glb.

Usage: blender -b -P props_island.py -- --out <dir> [--only id,id]
Conventions as in props.py (Babylon space, ground y = 0, front = -Z, "<prop>__<material>").
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import beam, box, cone, cyl, ico, lathe, prism, shade, tone, tube, vgrad  # noqa: E402
from propkit import (  # noqa: E402
    CREAM, GLASS, GOLD, GRASS, LEAF, LEAF_D, R, ROCK, ROPE, SAND, SLATE, STONE, WOOD, WOOD_D, WOOD_L,
    at, blob, boulder, deck_y, door, grass_tuft, lantern_head, lashing, leaf, lerp, plank, post, rope, thatch, flower, window,
)
from props import palm_tree  # noqa: E402

TAU = math.tau
SANDSTONE = 'c_d9c3a5'
BLEACHED = 'c_d6c6b0'


def palm2():
    """Strongly bent palm (leans towards +X, crown at x ≈ 2.4, y ≈ 3.9)."""
    g = 'palm2'
    palm_tree(g, ((0, 0, 0), (1.7, 0.9, 0.1), (2.4, 3.9, 0.25)), seed=8, fronds=10, flen=2.5, r0=0.3, r1=0.15)
    for k, a in enumerate((2.4, 3.6, 4.6)):
        tube(g, 'c_b88a5a', [(0, 0.35, 0), (math.cos(a) * 0.35, 0.12, math.sin(a) * 0.35), (math.cos(a) * 0.55, -0.05, math.sin(a) * 0.55)], [0.1, 0.07, 0.03], verts=4)


def bush():
    """Tropical bush (~1.2 wide): broad leaves around a dense core."""
    g = 'bush'
    rr = R(3)
    blob(g, LEAF_D, (0, 0.32, 0), r=0.42, scale=(1, 0.8, 1), seed=2, subdiv=2, rough=0.2, lo=0.7)
    for k in range(9):
        a = k / 9 * TAU + rr.uniform(-0.2, 0.2)
        o = leaf(g, LEAF_D, (math.cos(a) * 0.12, 0.2, math.sin(a) * 0.12), a, length=rr.uniform(0.55, 0.75), width=0.24, rise=0.55, droop=0.6,
                 segs=3, fold=0.35, pitch=0.35, lo=0.75)
        tone(o, rr.uniform(0.9, 1.05))


def fern():
    g = 'fern'
    rr = R(5)
    for k in range(7):
        a = k / 7 * TAU + rr.uniform(-0.2, 0.2)
        o = leaf(g, 'c_7cc46e', (0, 0.03, 0), a, length=rr.uniform(0.45, 0.55), width=0.13, rise=0.45, droop=0.45, segs=5, fold=0.2, serr=0.55, pitch=0.5, lo=0.7)
        tone(o, rr.uniform(0.9, 1.0))


def flowers():
    """Hibiscus clump (~0.8)."""
    g = 'flowers'
    rr = R(7)
    blob(g, LEAF_D, (0, 0.2, 0), r=0.3, scale=(1.2, 0.75, 1.0), seed=4, subdiv=2, rough=0.18, lo=0.72)
    for k in range(3):
        a = k / 3 * TAU + 0.4
        leaf(g, LEAF_D, (0, 0.1, 0), a, length=0.42, width=0.14, rise=0.25, droop=0.3, segs=2, fold=0.3, pitch=0.2)
    for k, (x, y, z) in enumerate(((0.14, 0.42, -0.12), (-0.18, 0.38, -0.05), (0.02, 0.4, 0.2), (-0.25, 0.28, -0.25))):
        flower(g, (x, y, z), r=0.11 if k < 3 else 0.09, petal='c_f28aa0' if k % 2 == 0 else 'c_f7b267', tilt=0.5, seed=k)


def grass():
    """Grass tuft (~0.5), <= 40 triangles."""
    grass_tuft('grass', GRASS, (0, 0, 0), n=4, h=0.45, r=0.1, seed=4, lean=0.35, blade_w=0.06)


def shell():
    """Scallop + little snail shell, <= 30 triangles."""
    g = 'shell'
    o = lathe(g, 'c_f7d9c4', (0, 0.0, 0), [(0, 0), (0.16, 0.02), (0, 0.07)], verts=7, scale=(1, 1, 0.8), rot=(0.25, 0.4, 0),
              rfn=lambda a, j: 1.0 if round(a / TAU * 7) % 2 == 0 else 0.9)
    vgrad(o, 0.85, 1.0)
    cone(g, 'c_f2b8a0', (0.2, 0.05, 0.1), r=0.06, h=0.14, verts=4, rot=(0, 0.6, 1.3))


def rocksmall():
    g = 'rocksmall'
    boulder(g, ROCK, (0, 0.16, 0), size=(0.32, 0.24, 0.28), seed=12, subdiv=2, rough=0.28, strata=0.06)
    boulder(g, ROCK, (0.27, 0.07, 0.12), size=(0.16, 0.12, 0.15), seed=13, subdiv=2, rough=0.2)
    boulder(g, ROCK, (-0.2, 0.04, -0.2), size=(0.08, 0.06, 0.08), seed=14, subdiv=1, rough=0.1)


def cliff():
    """Map-edge rock formation (~6 wide, ~4 high, ~3 deep); front (-Z) faces the board.
    Stacked, stepped sandstone slabs (strata) with grassy ledges on top."""
    g = 'cliff'
    rr = R(21)
    # (x, y, z, sx, sy, sz): wide flat slabs, each layer stepping back
    slabs = (
        (-1.7, 0.55, -0.2, 1.5, 0.75, 1.3), (0.2, 0.6, -0.4, 1.6, 0.8, 1.2), (2.1, 0.5, -0.1, 1.2, 0.7, 1.2),
        (-1.1, 1.6, 0.3, 1.5, 0.65, 1.1), (1.0, 1.65, 0.2, 1.5, 0.7, 1.1), (2.6, 1.2, 0.5, 0.7, 0.6, 0.8),
        (-0.3, 2.65, 0.6, 1.5, 0.6, 1.0), (-2.2, 2.1, 0.7, 0.8, 0.55, 0.8), (1.3, 2.5, 0.75, 0.9, 0.5, 0.8),
        (-0.4, 3.45, 0.9, 1.0, 0.45, 0.75),
        (-2.8, 0.25, -0.9, 0.45, 0.3, 0.4), (2.9, 0.2, -1.0, 0.35, 0.25, 0.3), (0.9, 0.18, -1.55, 0.3, 0.2, 0.28),
    )
    for k, (x, y, z, sx, sy, sz) in enumerate(slabs):
        boulder(g, SANDSTONE, (x, y, z), size=(sx, sy, sz), seed=50 + k, subdiv=2, rough=0.3, yaw=rr.uniform(-0.3, 0.3),
                ground=0.0 if y < 1 else None, sink=0.1, strata=0.12)
    # grassy ledges on top + a bit of greenery at the foot
    for x, y, z, r in ((-0.4, 3.85, 0.9, 0.95), (-2.2, 2.6, 0.8, 0.7), (1.3, 2.95, 0.8, 0.8), (2.6, 1.75, 0.55, 0.55), (-1.1, 2.2, 0.2, 0.6)):
        blob(g, GRASS, (x, y, z), r=r, scale=(1.15, 0.2, 0.9), seed=int(x * 10 + 30), subdiv=2, rough=0.15, lo=0.75)
    for x, y, z in ((-0.6, 3.95, 0.7), (0.0, 3.9, 1.1), (-2.3, 2.7, 0.6), (1.4, 3.05, 0.6)):
        grass_tuft(g, GRASS, (x, y, z), n=4, h=0.4, seed=int(x * 7 + 3))
    for x, z in ((-2.6, -1.5), (2.4, -1.3), (-0.5, -1.4)):
        blob(g, LEAF_D, (x, 0.25, z), r=0.4, scale=(1.1, 0.75, 1.0), seed=int(x * 3 + 9), subdiv=2)


def bridge():
    """Wooden plank bridge: deck along Z (7 long, 2.4 wide), origin at its center.
    Deck top y = 0.45 at the center, 0.30 at the ends (gentle arch), railings with rope."""
    g = 'bridge'
    rr = R(31)
    n = 20
    for k in range(n):
        z = -3.5 + (k + 0.5) * 7 / n
        y = deck_y(z)
        slope = (deck_y(z + 0.05) - deck_y(z - 0.05)) / 0.1
        up = (0, 1, -slope)
        dx = rr.uniform(-0.06, 0.06)
        plank(g, WOOD_L, (-1.08 + dx, y - 0.035, z), (1.08 + dx, y - 0.035, z), w=7 / n * 0.9, t=0.07, up=up, seed=k, var=0.18)
    for sx in (-0.8, 0.8):
        pts = [(sx, deck_y(-3.5 + i * 0.7) - 0.15, -3.5 + i * 0.7) for i in range(11)]
        for p, q in zip(pts, pts[1:]):
            beam(g, WOOD_D, p, q, width=0.16, thick=0.16)
    for z in (-3.35, -1.15, 1.15, 3.35):
        y = deck_y(z)
        for sx in (-1, 1):
            post(g, WOOD_D, (sx * 1.13, -1.2, z), y + 1.2 + 0.85, r=0.09, verts=6, seed=int(z * 10) + sx)
            lashing(g, ROPE, (sx * 1.13, y + 0.6, z), 0.09)
        box(g, WOOD_D, (0, y - 0.24, z), (2.4, 0.14, 0.16))
    for sx in (-1, 1):
        zs = (-3.35, -1.15, 1.15, 3.35)
        for z0, z1 in zip(zs, zs[1:]):
            rope(g, ROPE, (sx * 1.13, deck_y(z0) + 0.8, z0), (sx * 1.13, deck_y(z1) + 0.8, z1), sag=0.12, r=0.028, n=6)
            rope(g, ROPE, (sx * 1.13, deck_y(z0) + 0.42, z0), (sx * 1.13, deck_y(z1) + 0.42, z1), sag=0.08, r=0.022, n=5)
    for z in (-3.35, 3.35):
        for sx in (-1, 1):
            beam(g, WOOD_D, (sx * 1.13, -0.9, z), (-sx * 1.13, deck_y(z) - 0.3, z), width=0.1, thick=0.08, up=(0, 0, 1))


def pier():
    """Jetty segment: 3 long (Z) x 2.4 wide, origin at its center, deck top y = 0.45,
    posts reach down to y = -2 (into the water). Tiles seamlessly along Z."""
    g = 'pier'
    rr = R(41)
    n = 9
    for k in range(n):
        z = -1.5 + (k + 0.5) * 3 / n
        dx = rr.uniform(-0.05, 0.05)
        plank(g, WOOD_L, (-1.15 + dx, 0.41, z), (1.15 + dx, 0.41, z), w=3 / n * 0.9, t=0.08, seed=k, var=0.18)
    for sx in (-0.85, 0.85):
        box(g, WOOD_D, (sx, 0.25, 0), (0.18, 0.18, 3.0))
    for z in (-1.2, 1.2):
        box(g, WOOD_D, (0, 0.1, z), (2.5, 0.16, 0.16))
        for sx in (-1, 1):
            o = post(g, WOOD_D, (sx * 1.18, -2.0, z), 2.75, r=0.14, verts=7, seed=int(z * 10) + sx)
            shade(o, lambda x, y, z: (0.72, 0.85, 0.78) if y < -0.1 else 1.0)
            lashing(g, ROPE, (sx * 1.18, 0.3, z), 0.14, h=0.14)
            cone(g, WOOD_D, (sx * 1.18, 0.82, z), r=0.15, h=0.12, verts=7)
        beam(g, WOOD_D, (-1.18, -1.6, z), (1.18, -0.05, z), width=0.1, thick=0.08, up=(0, 0, 1))
    # mooring cleat + coiled rope on one side
    box(g, SLATE, (1.0, 0.5, 0.3), (0.12, 0.08, 0.4))
    lib.torus(g, ROPE, (0.75, 0.5, -0.4), R=0.17, r=0.045, seg=10, mseg=4)


def boat():
    """Rowboat (~3 long along Z, bow at -Z), hull in tint, waterline at y = 0."""
    g = 'boat'
    rings = []
    zs = [-1.55, -1.35, -1.0, -0.5, 0.0, 0.5, 0.9, 1.2, 1.4]
    for z in zs:
        t = (z - 0.15) / 1.75
        W = 0.66 * max(0.02, 1 - t * t) ** 0.55 if z < 1.3 else 0.5
        rim = 0.45 + 0.18 * max(0.0, -z / 1.55) ** 2
        bot = -0.22 + 0.2 * max(0.0, -z / 1.55) ** 3
        th = 0.06
        outer = [(-W, rim), (-W * 0.96, rim * 0.45), (-W * 0.72, bot * 0.6), (-W * 0.35, bot), (0, bot - 0.05), (W * 0.35, bot), (W * 0.72, bot * 0.6), (W * 0.96, rim * 0.45), (W, rim)]
        Wi = max(0.005, W - th)
        inner = [(Wi, rim), (Wi * 0.94, rim * 0.45), (Wi * 0.6, bot + 0.12), (0, bot + 0.1), (-Wi * 0.6, bot + 0.12), (-Wi * 0.94, rim * 0.45), (-Wi, rim)]
        rings.append([(x, y, z) for x, y in outer + inner])
    o = lib.loft(g, 'tint', rings)
    shade(o, lambda x, y, z: 0.8 if y < 0.05 else 1.0)
    # gunwales, floor boards, seats, oars
    for sx in (-1, 1):
        pts = []
        for z in zs[1:-1]:
            t = (z - 0.15) / 1.75
            W = 0.66 * max(0.02, 1 - t * t) ** 0.55
            pts.append((sx * W, 0.45 + 0.18 * max(0.0, -z / 1.55) ** 2 + 0.02, z))
        pts.append((sx * 0.5, 0.47, 1.42))
        tube(g, WOOD, pts, 0.045, verts=4)
    for k in range(3):
        plank(g, WOOD_L, (-0.35 + k * 0.35, -0.05, -0.8), (-0.35 + k * 0.35, -0.05, 1.2), w=0.3, t=0.04, seed=k)
    for z, w in ((-0.55, 1.05), (0.55, 1.15)):
        box(g, WOOD, (0, 0.28, z), (w, 0.07, 0.32))
    box(g, WOOD, (0, 0.47, 1.4), (1.0, 0.05, 0.08))
    for sx in (-1, 1):
        with at((sx * 0.35, 0.37, 0.1), (0, 0, sx * 0.12)), at((0, 0, 0), (0, sx * 0.25, 0)):
            tube(g, WOOD_L, [(0, 0, -1.0), (0, 0, 0.9)], 0.035, verts=5)
            box(g, WOOD_L, (0, 0, -1.2), (0.03, 0.18, 0.45), bevel=0.01)
    rope(g, ROPE, (0, 0.62, -1.5), (0.25, 0.05, -1.9), sag=0.1, r=0.025, n=4)


def lighthouse():
    """Landmark lighthouse (~3 wide, ~10 high); stripes + dome in tint, lamp = glow."""
    g = 'lighthouse'
    for k in range(6):
        a = k / 6 * TAU + 0.3
        boulder(g, ROCK, (math.cos(a) * 1.55, 0.25, math.sin(a) * 1.55), size=(0.6, 0.45, 0.5), seed=60 + k, subdiv=2, rough=0.25, yaw=a)
    lathe(g, STONE, (0, 0, 0), [(1.55, -0.05), (1.55, 0.45), (1.45, 0.55), (1.3, 0.6)], verts=8, phase=math.pi / 8)
    H0, H1, R0, R1 = 0.55, 7.2, 1.2, 0.78
    rad = lambda y: lerp(R0, R1, (y - H0) / (H1 - H0))
    lathe(g, CREAM, (0, 0, 0), [(R0, H0), (R1, H1)], verts=16)
    for y0, y1 in ((1.6, 2.6), (3.7, 4.7), (5.8, 6.8)):
        lathe(g, 'tint', (0, 0, 0), [(rad(y0) + 0.02, y0), (rad(y1) + 0.02, y1)], verts=16)
    # windows (spiral) + door
    for k, y in enumerate((2.0, 3.1, 4.2, 5.3, 6.3)):
        a = -math.pi / 2 + (k - 2) * 0.9
        r = rad(y) + 0.02
        with at((math.cos(a) * r, y, math.sin(a) * r), (0, -a - math.pi / 2, 0)):
            box(g, SLATE, (0, 0, 0), (0.22, 0.36, 0.06))
            box(g, STONE, (0, -0.22, -0.04), (0.32, 0.06, 0.1))
    door(g, (0, 0.58, -R0 - 0.02), w=0.6, h=1.05, wood='c_7a8fc0', frame=STONE, step=None)
    for k in range(3):
        box(g, STONE, (0, 0.08 + k * 0.17, -1.85 + k * 0.17), (1.0, 0.17, 0.35), bevel=0.02)
    # gallery + railing
    lathe(g, SLATE, (0, 0, 0), [(0.8, 7.05), (1.3, 7.2), (1.3, 7.32), (0.8, 7.32)], verts=16)
    for k in range(16):
        a = k / 16 * TAU
        cyl(g, CREAM, (math.cos(a) * 1.22, 7.55, math.sin(a) * 1.22), r1=0.03, h=0.5, verts=4)
    lib.torus(g, SLATE, (0, 7.8, 0), R=1.22, r=0.04, seg=16, mseg=4)
    # lantern room: glowing glass behind slate mullions, tint dome, finial
    lathe(g, SLATE, (0, 0, 0), [(0.72, 7.3), (0.72, 7.5)], verts=8)
    lathe(g, 'glow_fff2b0', (0, 0, 0), [(0.62, 7.5), (0.62, 8.5)], verts=8)
    for k in range(8):
        a = k / 8 * TAU
        box(g, SLATE, (math.cos(a) * 0.64, 8.0, math.sin(a) * 0.64), (0.07, 1.0, 0.07), rot=(0, -a, 0))
    lathe(g, 'tint', (0, 0, 0), [(0.82, 8.48), (0.86, 8.58), (0.7, 8.85), (0.4, 9.15), (0, 9.3)], verts=16)
    lathe(g, GOLD, (0, 9.25, 0), [(0, 0), (0.1, 0.1), (0.04, 0.2), (0.03, 0.55), (0, 0.6)], verts=6)


WHITE = 'c_ffffff'


def driftwood():
    g = 'driftwood'
    o = tube(g, BLEACHED, [(-0.9, 0.12, 0.1), (-0.3, 0.16, -0.05), (0.3, 0.14, 0.05), (0.85, 0.1, -0.15)], [0.13, 0.15, 0.12, 0.07], verts=6)
    lib.flatten(o, 0.0, 0.03)
    tube(g, BLEACHED, [(-0.2, 0.2, 0.0), (0.0, 0.42, -0.25), (0.05, 0.55, -0.45)], [0.06, 0.04, 0.01], verts=4)
    tube(g, BLEACHED, [(0.45, 0.15, 0.0), (0.65, 0.22, 0.25)], [0.04, 0.01], verts=4)
    for x in (-0.9, 0.85):
        cyl(g, 'c_b8a48c', (x, 0.12 if x < 0 else 0.1, 0.1 if x < 0 else -0.15), r1=0.1, h=0.02, verts=6, rot=(0, 0, math.pi / 2))


def torch():
    """Tiki torch (~1.8 high) with a glowing flame."""
    g = 'torch'
    prof = []
    for k in range(5):
        y = k * 0.36
        prof += [(0.055, y + 0.02), (0.062, y + 0.33), (0.07, y + 0.36)]
    lathe(g, 'c_c9a86b', (0, 0, 0), [(0.07, -0.1)] + prof, verts=6)
    lathe(g, WOOD_L, (0, 1.6, 0), [(0.08, 0), (0.17, 0.18), (0.19, 0.3), (0.15, 0.32)], verts=8,
          rfn=lambda a, j: 1.0 if round(a / TAU * 8) % 2 else 0.93)
    lashing(g, ROPE, (0, 1.58, 0), 0.07, h=0.1)
    lathe(g, 'glow_ffa34d', (0, 1.86, 0), [(0.13, 0), (0.15, 0.1), (0.07, 0.26), (0, 0.4)], verts=6)
    lathe(g, 'glow_ffd27a', (0, 1.9, 0), [(0.08, 0), (0.09, 0.06), (0, 0.24)], verts=5, phase=0.5)
    boulder(g, ROCK, (0.0, 0.05, 0.0), size=(0.22, 0.12, 0.2), seed=70, subdiv=1, rough=0.1)


def ruin():
    """Overgrown stone pillar + broken arch fragment (~2 wide)."""
    g = 'ruin'
    st = 'c_d8d0c4'
    box(g, st, (0, 0.12, 0), (2.4, 0.24, 1.0), bevel=0.04)
    flute = lambda a, j: 1.0 if round(a / TAU * 12) % 2 else 0.9
    for x, h in ((-0.8, 2.3), (0.85, 1.1)):
        box(g, st, (x, 0.36, 0), (0.7, 0.24, 0.7), bevel=0.03)
        y = 0.48
        k = 0
        while y < h:
            dh = min(0.55, h - y)
            o = lathe(g, st, (x, y, 0), [(0.27, 0), (0.25, dh)], verts=12, rfn=flute, phase=k * 0.3)
            tone(o, 0.92 + 0.08 * (k % 2))
            y += dh + 0.01
            k += 1
        top = lathe(g, st, (x, y, 0), [(0.25, 0), (0.24, 0.12), (0.12, 0.2)], verts=7)
        lib.noisify(top, 0.06, 4, int(x * 10))
    with at((-0.8, 2.3, 0)):
        box(g, st, (0, 0.12, 0), (0.75, 0.24, 0.75), bevel=0.03)
    arc = [(-0.8 + 0.85 - math.cos(a) * 0.85, 2.42 + math.sin(a) * 0.85, 0) for a in [k / 6 * math.pi * 0.42 for k in range(7)]]
    tube(g, st, arc, 0.2, verts=4, phase=math.pi / 4)
    lathe(g, st, (0.3, 0.25, -0.75), [(0.26, -0.22), (0.24, 0.22)], verts=12, rot=(0, 0, math.pi / 2 - 0.1), rfn=flute)
    boulder(g, st, (1.25, 0.12, 0.55), size=(0.25, 0.18, 0.22), seed=80, subdiv=1, rough=0.1)
    # vines + moss
    helix = [(-0.8 + math.cos(t) * 0.29, 0.4 + t * 0.2, math.sin(t) * 0.29) for t in [k * 0.6 for k in range(14)]]
    tube(g, LEAF_D, helix, 0.03, verts=4)
    for k in range(0, 14, 3):
        p = helix[k]
        blob(g, LEAF, (p[0], p[1], p[2]), r=0.11, scale=(1, 0.6, 1), seed=k, subdiv=1, rough=0.2)
    for p, r in (((-0.8, 2.55, 0.0), 0.3), ((0.85, 1.25, 0.05), 0.22), ((-0.2, 0.28, 0.45), 0.28), ((0.95, 0.27, -0.45), 0.24)):
        blob(g, LEAF_D, p, r=r, scale=(1.2, 0.45, 1.0), seed=int(p[0] * 10 + 99), subdiv=2, rough=0.2)
    grass_tuft(g, GRASS, (-1.25, 0.24, -0.35), n=4, h=0.35, seed=5)
    grass_tuft(g, GRASS, (1.2, 0.0, -0.6), n=4, h=0.3, seed=6)


def stilthut():
    """Hut on stilts (~4 x 4): deck at y = 1.6, ladder at the front (-Z), thatch roof (tint)."""
    g = 'stilthut'
    rr = R(91)
    Y = 1.6
    for x in (-1.6, 0, 1.6):
        for z in (-1.6, 0, 1.6):
            post(g, WOOD_D, (x, -0.6, z), Y + 0.6, r=0.11, verts=6, seed=int(x * 7 + z * 3), lean=0.03)
    for z in (-1.6, 1.6):
        beam(g, WOOD_D, (-1.6, 0.2, z), (1.6, Y - 0.25, z), width=0.09, thick=0.07, up=(0, 0, 1))
    for x in (-1.6, 1.6):
        beam(g, WOOD_D, (x, 0.2, -1.6), (x, Y - 0.25, 1.6), width=0.09, thick=0.07, up=(1, 0, 0))
    for x in (-1.6, 0, 1.6):
        box(g, WOOD_D, (x, Y - 0.14, 0), (0.16, 0.16, 3.6))
    n = 12
    for k in range(n):
        z = -1.85 + (k + 0.5) * 3.7 / n
        dx = rr.uniform(-0.06, 0.06)
        plank(g, WOOD_L, (-1.85 + dx, Y + 0.03, z), (1.85 + dx, Y + 0.03, z), w=3.7 / n * 0.9, t=0.07, seed=k, var=0.18)
    # railing posts + ropes (open at the ladder)
    rail = [(-1.8, -1.8), (-0.5, -1.8), (0.5, -1.8), (1.8, -1.8), (1.8, 0), (1.8, 1.8), (0, 1.8), (-1.8, 1.8), (-1.8, 0)]
    for x, z in rail:
        post(g, WOOD_D, (x, Y, z), 0.75, r=0.06, verts=5, seed=int(x * 5 + z))
    loop = rail[2:] + rail[:2]
    for (x0, z0), (x1, z1) in zip(loop, loop[1:]):
        rope(g, ROPE, (x0, Y + 0.68, z0), (x1, Y + 0.68, z1), sag=0.1, r=0.025, n=5)
    # ladder down the front
    for sx in (-0.32, 0.32):
        beam(g, WOOD, (sx, 0.0, -2.55), (sx, Y + 0.1, -1.85), width=0.08, thick=0.08, up=(0, 0.3, -1))
    for k in range(5):
        t = (k + 0.6) / 6
        beam(g, WOOD_L, (-0.32, lerp(0.0, Y + 0.1, t), lerp(-2.55, -1.85, t)), (0.32, lerp(0.0, Y + 0.1, t), lerp(-2.55, -1.85, t)), width=0.07, thick=0.05)
    # the hut itself
    w, d, h = 2.3, 2.0, 1.55
    pw = 0.32
    for side, (L, pos, ax) in enumerate(((w, -d / 2, 'x'), (w, d / 2, 'x'), (d, -w / 2, 'z'), (d, w / 2, 'z'))):
        m = int(L / pw)
        for k in range(m):
            c = -L / 2 + (k + 0.5) * L / m
            top = Y + h + rr.uniform(-0.04, 0.04)
            if ax == 'x':
                plank(g, WOOD_L, (c, Y + 0.08, pos + 0.4), (c, top, pos + 0.4), w=L / m * 0.94, t=0.08, up=(0, 0, 1), seed=side * 20 + k, var=0.16)
            else:
                plank(g, WOOD_L, (pos, Y + 0.08, c + 0.4), (pos, top, c + 0.4), w=L / m * 0.94, t=0.08, up=(1, 0, 0), seed=side * 20 + k, var=0.16)
    box(g, WOOD, (0, Y + h / 2, 0.4), (w - 0.08, h - 0.05, d - 0.08))
    for sx in (-1, 1):
        for sz in (-1, 1):
            post(g, WOOD_D, (sx * w / 2, Y, 0.4 + sz * d / 2), h + 0.15, r=0.1, verts=6, seed=sx * 2 + sz)
    thatch(g, 'tint', (0, Y + h, 0.4), w * 0.85, 1.5, tiers=3, sz=d / w, seed=12)
    cone(g, WOOD_D, (0, Y + h + 1.62, 0.4), r=0.14, h=0.3, verts=4, rot=(0, math.pi / 4, 0))
    door(g, (0.35, Y + 0.08, 0.4 - d / 2 - 0.04), w=0.62, h=1.1, step=None)
    window(g, (-0.6, Y + 0.95, 0.4 - d / 2 - 0.05), w=0.38, h=0.4, frame=WOOD_D, shutter='tint', sill=WOOD)
    with at((0.85, Y + 1.3, 0.4 - d / 2 - 0.14)):
        box(g, WOOD_D, (0, 0.2, 0.05), (0.05, 0.05, 0.22))
        lantern_head(g, (0, -0.1, -0.05), s=0.6)
    lib.torus(g, ROPE, (1.35, Y + 0.12, -1.35), R=0.18, r=0.05, seg=10, mseg=4)


PROPS = (palm2, bush, fern, flowers, grass, shell, rocksmall, cliff, bridge, pier, boat, lighthouse, driftwood, torch, ruin, stilthut)

if __name__ == '__main__':
    import propkit

    propkit.build('props_island.glb', PROPS, ao_opts={
        'bridge': {'ground': None}, 'pier': {'ground': None}, 'boat': {'ground': None}, 'stilthut': {'ground': 0.0},
        'grass': {'samples': 8}, 'shell': {'samples': 8}, 'cliff': {'samples': 12, 'dist': 1.0}, 'lighthouse': {'samples': 12},
    })
