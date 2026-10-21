"""Minigame prop library (v0.4): props_minigame.glb.

Usage: blender -b -P props_minigame.py -- --out <dir> [--only id,id]
Conventions as in props.py (Babylon space, ground y = 0, front = -Z, "<prop>__<material>").

  snowpine   snowy conifer, ~3.6 high                  (ice backdrop)
  buoy       striped buoy, waterline at y = 0, ~1.3 high (tint = stripes)
  flag       pole 3.2 high with a waving flag at the top (tint = flag), flag points to +X
  bunting    pennant garland between two posts at x = ±3, rope at ~2.6 (tint = every 2nd pennant)
  easel      painter's easel, canvas (white, 1.4 × 1.0) facing -Z, canvas center at y ≈ 1.45
  stagelight spotlight on a tripod, lamp at y ≈ 2.3 pointing -Z and down (tint = housing)
  haybale    round hay bale lying on its side, ~1.3 across
  podium     winner podium 1-2-3 (center 1 high, sides 0.65/0.4), 3.6 wide
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import box, cone, cyl, lathe, prism, shade, tone, tube, vgrad  # noqa: E402
from propkit import (  # noqa: E402
    GOLD, LAMP, METAL, R, ROPE, SLATE, STONE, WHITE, WOOD, WOOD_D, WOOD_L, at, blob, boulder, lerp, plank, post, rope,
)

TAU = math.tau
SNOW = 'c_f4f8fb'
PINE = 'c_4f8f6a'
HAY = 'c_e8c86a'
CLOTH = 'c_fbf6ec'


def snowpine():
    """Conifer with snow lying on every tier."""
    g = 'snowpine'
    tube(g, 'c_8a5a3c', [(0, -0.1, 0), (0, 0.3, 0), (0, 1.4, 0), (0, 2.8, 0)], [0.3, 0.2, 0.15, 0.08], verts=6)
    for k in range(4):
        rr = R(70 + k)
        y0 = 0.7 + k * 0.72
        r = 1.25 - k * 0.25
        hgt = 1.25 - k * 0.1
        o = lathe(g, PINE, (0, y0, 0), [(r * 0.4, 0.15), (r, -0.05), (r * 0.6, hgt * 0.4), (0, hgt)], verts=12, phase=k * 0.5,
                  rfn=lambda a, j, rr=rr: (1.0 if round(a / TAU * 12) % 2 == 0 else 0.82) * (rr.uniform(0.94, 1.05) if j == 1 else 1.0))
        lib.noisify(o, 0.04, 1.5, k)
        tone(o, 0.85 + k * 0.05)
        # snow cap: a flatter, smaller skirt on the upper part of the tier
        s = lathe(g, SNOW, (0, y0 + hgt * 0.32, 0), [(r * 0.7, 0.0), (r * 0.42, hgt * 0.22), (0, hgt * 0.72)], verts=12, phase=k * 0.5 + 0.13,
                  rfn=lambda a, j, rr=rr: rr.uniform(0.88, 1.06))
        lib.noisify(s, 0.03, 2.0, k + 9)
        vgrad(s, 0.9, 1.0)
    blob(g, SNOW, (0.5, 0.05, -0.2), r=0.45, scale=(1.2, 0.35, 1.0), seed=3, subdiv=1, rough=0.12, lo=0.9)


def buoy():
    g = 'buoy'
    o = lathe(g, 'tint', (0, -0.55, 0), [(0.0, 0.0), (0.42, 0.05), (0.55, 0.4), (0.5, 0.7), (0.3, 0.78)], verts=12)
    vgrad(o, 0.8, 1.0)
    lathe(g, WHITE, (0, 0.05, 0), [(0.52, 0.0), (0.53, 0.14), (0.5, 0.2)], verts=12)
    # cage + lamp on top
    for k in range(4):
        a = k / 4 * TAU + 0.4
        tube(g, SLATE, [(math.cos(a) * 0.28, 0.2, math.sin(a) * 0.28), (math.cos(a) * 0.1, 0.9, math.sin(a) * 0.1)], 0.03, verts=4)
    cyl(g, SLATE, (0, 0.92, 0), r1=0.14, h=0.06, verts=8)
    lib.ico(g, 'glow_ffe08a', (0, 1.04, 0), r=0.11, subdiv=1)
    lib.torus(g, SLATE, (0, 0.45, 0), R=0.5, r=0.04, seg=12, mseg=4)


def flag():
    g = 'flag'
    post(g, 'c_e9e4f2', (0, -0.05, 0), 3.25, r=0.055, verts=6, seed=2, var=0.02)
    lib.ico(g, GOLD, (0, 3.24, 0), r=0.09, subdiv=1)
    boulder(g, STONE, (0, 0.06, 0), size=(0.32, 0.14, 0.3), seed=5, subdiv=1, rough=0.08)
    # waving flag: a strip of quads along +X with a sine wave in Z
    verts, faces = [], []
    n = 8
    for i in range(n + 1):
        u = i / n
        x = 0.06 + u * 1.25
        z = math.sin(u * 3.2) * 0.12 * u
        droop = -0.08 * u * u
        verts += [(x, 3.05 + droop, z), (x, 2.3 + droop * 1.5, z)]
    for i in range(n):
        a = i * 2
        faces.append((a, a + 2, a + 3, a + 1))
    o = lib.mesh(g, 'tint', verts, faces, recalc=False)
    shade(o, lambda x, y, z: 0.85 + 0.15 * math.cos(x * 5))
    # back side (single quads are culled from behind)
    o2 = lib.mesh(g, 'tint', verts, [tuple(reversed(f)) for f in faces], recalc=False)
    shade(o2, lambda x, y, z: 0.8 + 0.15 * math.cos(x * 5))


def bunting():
    g = 'bunting'
    for sx in (-3, 3):
        post(g, WOOD_D, (sx, -0.05, 0), 2.85, r=0.07, verts=6, seed=sx)
    rope(g, ROPE, (-3, 2.65, 0), (3, 2.65, 0), sag=0.35, r=0.02, n=10)
    for k in range(11):
        t = (k + 0.5) / 11
        x = lerp(-3, 3, t)
        y = 2.65 - 0.35 * 4 * t * (1 - t) - 0.03
        mat = 'tint' if k % 2 == 0 else ('c_ffffff' if k % 4 == 1 else 'c_f2c94c')
        for side in (1, -1):
            pts = [(x - 0.2, y, 0), (x + 0.2, y, 0), (x, y - 0.45, 0)]
            lib.mesh(g, mat, pts, [(0, 1, 2) if side > 0 else (2, 1, 0)], recalc=False)


def easel():
    g = 'easel'
    # three legs: two front, one back
    for sx in (-1, 1):
        lib.beam(g, WOOD, (sx * 0.55, 0, -0.15), (sx * 0.12, 2.3, 0.05), width=0.07, thick=0.06, up=(0, 0, -1))
    lib.beam(g, WOOD_D, (0, 0, 0.75), (0, 2.1, 0.08), width=0.06, thick=0.06, up=(1, 0, 0))
    plank(g, WOOD_D, (-0.5, 0.88, -0.2), (0.5, 0.88, -0.2), w=0.08, t=0.06, seed=3)
    # canvas on the ledge
    box(g, WOOD_L, (0, 1.45, -0.16), (1.48, 1.08, 0.06))
    o = box(g, CLOTH, (0, 1.45, -0.2), (1.4, 1.0, 0.02))
    tone(o, 1.0)
    plank(g, WOOD_D, (-0.3, 2.02, -0.15), (0.3, 2.02, -0.15), w=0.07, t=0.05, seed=5)
    # palette + brush pot at the foot
    with at((0.55, 0.03, -0.45), (0, 0.4, 0)):
        lathe(g, WOOD_L, (0, 0, 0), [(0, 0), (0.28, 0.0), (0.27, 0.03), (0, 0.03)], verts=10, scale=(1, 1, 0.75))
        for k, c in enumerate(('c_e8676b', 'c_5f8fe0', 'c_f2c94c', 'c_56c08e')):
            a = k / 4 * TAU
            lib.ico(g, c, (math.cos(a) * 0.17, 0.04, math.sin(a) * 0.12), r=0.05, scale=(1, 0.4, 1), subdiv=1)
    cyl(g, 'c_5f8fe0', (-0.6, 0.12, -0.35), r1=0.1, h=0.24, verts=8)
    for k in range(3):
        tube(g, WOOD_D, [(-0.6 + (k - 1) * 0.03, 0.15, -0.35), (-0.6 + (k - 1) * 0.08, 0.5, -0.35 + (k - 1) * 0.03)], 0.015, verts=4)


def stagelight():
    g = 'stagelight'
    for k in range(3):
        a = k / 3 * TAU + 0.5
        lib.beam(g, SLATE, (math.cos(a) * 0.55, 0, math.sin(a) * 0.55), (0, 1.7, 0), width=0.05, thick=0.05, up=(0, 0, 1))
    cyl(g, SLATE, (0, 1.95, 0), r1=0.04, h=0.6, verts=6)
    with at((0, 2.3, 0), (-0.45, 0, 0)):
        # yoke + can
        for sx in (-1, 1):
            box(g, METAL, (sx * 0.3, 0, 0), (0.04, 0.4, 0.06))
        o = lathe(g, 'tint', (0, 0, 0.25), [(0.0, -0.3), (0.2, -0.28), (0.24, 0.0), (0.26, 0.4), (0.0, 0.4)], verts=10, rot=(math.pi / 2, 0, 0))
        vgrad(o, 0.75, 1.0)
        cyl(g, 'glow_fff2c4', (0, 0, -0.16), r1=0.22, h=0.03, verts=10, rot=(math.pi / 2, 0, 0))
        for k in range(4):
            box(g, SLATE, (0, 0.1 + (k - 1.5) * 0.08, 0.5), (0.36, 0.02, 0.02))


def haybale():
    g = 'haybale'
    o = cyl(g, HAY, (0, 0.6, 0), r1=0.62, h=1.0, verts=12, rot=(0, 0, math.pi / 2))
    lib.noisify(o, 0.03, 3, 2)
    vgrad(o, 0.8, 1.0)
    for sx in (-0.51, 0.51):
        lathe(g, 'c_d9b45a', (sx, 0.6, 0), [(0, 0), (0.55, 0.0), (0.5, 0.02), (0, 0.03)], verts=12, rot=(0, 0, math.pi / 2 if sx > 0 else -math.pi / 2))
    for k in (-0.25, 0.25):
        lib.torus(g, 'c_c98a4a', (k, 0.6, 0), R=0.63, r=0.025, seg=14, mseg=3, rot=(0, 0, math.pi / 2))
    for k in range(5):
        a = k * 1.3
        tube(g, HAY, [(math.cos(a) * 0.3, 0.03, -0.75 + k * 0.08), (math.cos(a) * 0.45, 0.02, -0.85 + k * 0.1)], 0.015, verts=3)


def podium():
    g = 'podium'
    for x, h, mat, num in ((0, 1.0, 'c_f2c94c', 1), (-1.2, 0.65, 'c_d9d6ea', 2), (1.2, 0.4, 'c_e8a46a', 3)):
        o = box(g, mat, (x, h / 2, 0), (1.18, h, 1.2), bevel=0.04)
        vgrad(o, 0.75, 1.0)
        box(g, WHITE, (x, h - 0.02, 0), (1.1, 0.05, 1.12))
        # number plate on the front
        box(g, WHITE, (x, h * 0.5, -0.61), (0.42, 0.42, 0.02))
        for k in range(num):
            box(g, SLATE, (x + (k - (num - 1) / 2) * 0.1, h * 0.5, -0.63), (0.05, 0.26, 0.02))


PROPS = (snowpine, buoy, flag, bunting, easel, stagelight, haybale, podium)

if __name__ == '__main__':
    import propkit

    propkit.build('props_minigame.glb', PROPS, ao_opts={'buoy': {'ground': None}, 'bunting': {'samples': 8}, 'flag': {'samples': 8}})
