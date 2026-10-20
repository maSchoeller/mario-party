"""Prop library + map landmarks (ASSET-01/02, ART-04/05).

Usage: blender -b -P props.py -- --out <dir>

One GLB (props.glb) whose objects are named "<prop>__<material>"; every prop is built
around its own origin (Babylon space, ground at y = 0, front = -Z) and has the same
footprint as the procedural placeholder it replaces, so board layouts stay valid.
Material "tint" is colored at runtime (roofs, train …).
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import beam, box, cone, cyl, ico, jitter  # noqa: E402

TAU = math.tau


def palm():
    x = y = 0.0
    for i in range(5):
        seg = cyl('palm', 'c_a0703f' if i % 2 else 'c_b07d48', (x, y + 0.45, 0), r1=0.19 - i * 0.015, r2=0.16 - i * 0.015, h=0.95, verts=6, rot=(0, 0, -0.06 * i))
        jitter(seg, 0.01, i)
        y += 0.9
        x += 0.06 * i
    for i in range(8):
        a = i / 8 * TAU + 0.2
        # drooping leaf: three beams bending down, getting narrower
        p = (x, y + 0.05, 0.0)
        for k in range(3):
            length = 0.95
            tilt = -0.15 + k * 0.45
            q = (p[0] + math.cos(a) * length * math.cos(tilt), p[1] - length * math.sin(tilt), p[2] + math.sin(a) * length * math.cos(tilt))
            beam('palm', 'c_7cbf6b' if (i + k) % 2 else 'c_8fcf78', p, q, width=0.7 - k * 0.18, thick=0.05)
            p = q
    for k in range(3):
        a = k / 3 * TAU
        ico('palm', 'c_6b4a2b', (x + 0.18 * math.cos(a), y - 0.12, 0.18 * math.sin(a)), r=0.17, subdiv=1)


def hut(name='hut', w=3.0, h=2.0, d=2.6):
    box(name, 'c_f6efe2', (0, h / 2, 0), size=(w, h, d), bevel=0.05)
    # wooden corner posts + base
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(name, 'c_a0703f', (sx * (w / 2), h / 2, sz * (d / 2)), size=(0.22, h + 0.1, 0.22))
    box(name, 'c_a0703f', (0, 0.08, 0), size=(w + 0.3, 0.16, d + 0.3))
    # thatched / tiled roof with overhang (tint) + ridge
    roof = cone(name, 'tint', (0, h + 0.85, 0), r=w * 0.82, h=1.8, verts=4, rot=(0, math.pi / 4, 0), scale=(1, 1, d / w))
    jitter(roof, 0.03, 7)
    cone(name, 'c_3d3a55', (0, h + 1.82, 0), r=0.12, h=0.3, verts=4)
    box(name, 'c_8a5a3c', (0, 0.6, -d / 2 - 0.03), size=(0.75, 1.15, 0.08))
    ico(name, 'glow_f2c94c', (0.25, 0.6, -d / 2 - 0.09), r=0.05, subdiv=1)
    for sx in (-1, 1):
        box(name, 'c_86c8e0', (sx * w * 0.3, h * 0.6, -d / 2 - 0.03), size=(0.5, 0.5, 0.06))
        box(name, 'c_a0703f', (sx * w * 0.3, h * 0.6 - 0.3, -d / 2 - 0.08), size=(0.62, 0.08, 0.14))


def house():
    """City house: two floors, chimney, windows (scaled ×1.3 by the board like the hut)."""
    n = 'house'
    w, h, d = 3.0, 2.8, 2.6
    box(n, 'c_f6efe2', (0, h / 2, 0), size=(w, h, d), bevel=0.04)
    box(n, 'c_d9d6ea', (0, 0.12, 0), size=(w + 0.2, 0.24, d + 0.2))
    box(n, 'c_d9d6ea', (0, h * 0.5, 0), size=(w + 0.1, 0.1, d + 0.1))
    cone(n, 'tint', (0, h + 0.75, 0), r=w * 0.8, h=1.5, verts=4, rot=(0, math.pi / 4, 0), scale=(1, 1, d / w))
    box(n, 'c_8a5a3c', (0.8, h + 0.8, 0.4), size=(0.35, 1.0, 0.35))
    box(n, 'c_8a5a3c', (-0.6, 0.6, -d / 2 - 0.03), size=(0.7, 1.1, 0.08))
    for row in (0, 1):
        for sx in ((0.6,) if row == 0 else (-0.7, 0.7)):
            box(n, 'c_86c8e0', (sx, 0.95 + row * 1.3, -d / 2 - 0.03), size=(0.55, 0.6, 0.06))
            box(n, 'tint', (sx, 0.95 + row * 1.3 - 0.36, -d / 2 - 0.1), size=(0.7, 0.12, 0.2))


def rock():
    r = ico('rock', 'c_b9b6c4', (0, 0.25, 0), r=0.8, scale=(1, 0.7, 0.9), subdiv=1)
    jitter(r, 0.12, 3)
    s = ico('rock', 'c_a7a5b3', (0.55, 0.15, 0.3), r=0.38, scale=(1, 0.75, 1), subdiv=1)
    jitter(s, 0.06, 4)


def tree():
    cyl('tree', 'c_8a5a3c', (0, 0.6, 0), r1=0.22, r2=0.17, h=1.2, verts=6)
    for k, (r, hgt, y, col) in enumerate(((1.25, 1.7, 1.75, 'c_6fae6a'), (1.0, 1.5, 2.6, 'c_82c27a'), (0.7, 1.3, 3.35, 'c_93cf86'))):
        c = cone('tree', col, (0, y, 0), r=r, h=hgt, verts=7, rot=(0, k * 0.4, 0))
        jitter(c, 0.05, k)


def deadtree():
    cyl('deadtree', 'c_5a4a48', (0, 1.5, 0), r1=0.26, r2=0.08, h=3, verts=5)
    for k, (y, a, l) in enumerate(((1.6, 0.4, 1.0), (2.2, 2.6, 0.8), (1.1, 4.4, 0.7))):
        beam('deadtree', 'c_5a4a48', (0, y, 0), (math.cos(a) * l, y + l * 0.6, math.sin(a) * l), width=0.12, thick=0.12)


def obsidian():
    for k in range(4):
        hgt = 1.8 + k * 0.5
        c = cone('obsidian', 'c_3b3446' if k % 2 else 'c_4a4158', ((k - 1.5) * 0.45, hgt / 2, (k % 2) * 0.4), r=0.42, h=hgt, verts=5, rot=(0, k, (k - 1.5) * 0.15))
        jitter(c, 0.04, k)
    ico('obsidian', 'glow_ff7a3d', (0.1, 0.12, -0.3), r=0.22, scale=(1.4, 0.3, 1), subdiv=1)


def volcano():
    """Landmark: crater sits at y = 10 (lava disk at 10.05) like the placeholder."""
    v = cyl('volcano', 'c_7a6a72', (0, 5, 0), r1=10, r2=3, h=10, verts=14)
    jitter(v, 0.35, 11)
    for k in range(9):
        a = k / 9 * TAU + 0.2
        s = cyl('volcano', 'c_6a5a62' if k % 2 else 'c_8a7a82', (math.cos(a) * 7.3, 2.2, math.sin(a) * 7.3), r1=2.6, r2=1.2, h=4.4, verts=6, rot=(0, -a, 0))
        jitter(s, 0.25, 20 + k)
    # snow-free ash rim + glowing lava with streams down the back
    cyl('volcano', 'c_5a4a52', (0, 10.0, 0), r1=3.05, r2=2.7, h=0.3, verts=14)
    cyl('volcano', 'glow_ff7a3d', (0, 10.05, 0), r1=2.6, r2=2.5, h=0.4, verts=14)
    for k, a in enumerate((1.9, 2.6, 3.6)):
        p0 = (math.cos(a) * 2.9, 10.1, math.sin(a) * 2.9)
        p1 = (math.cos(a + 0.15) * 6.2, 5.2, math.sin(a + 0.15) * 6.2)
        p2 = (math.cos(a + 0.05) * 8.6, 1.8, math.sin(a + 0.05) * 8.6)
        beam('volcano', 'glow_ff8a4d', p0, p1, width=0.9, thick=0.25, up=(math.cos(a), 0.7, math.sin(a)))
        beam('volcano', 'glow_ff8a4d', p1, p2, width=0.6, thick=0.25, up=(math.cos(a), 0.7, math.sin(a)))
    for k in range(5):
        a = k * 1.3
        r = ico('volcano', 'c_5a4a48', (math.cos(a) * 10.5, 0.4, math.sin(a) * 10.5), r=0.7, subdiv=1)
        jitter(r, 0.15, 40 + k)


def cannon():
    cyl('cannon', 'c_8a5a3c', (0, 0.3, 0), r1=0.85, r2=0.75, h=0.6, verts=8)
    for sx in (-1, 1):
        cyl('cannon', 'c_6b4a2b', (sx * 0.85, 0.45, 0), r1=0.45, h=0.18, verts=10, rot=(0, 0, math.pi / 2))
    cyl('cannon', 'c_3d3a4a', (0, 1.2, -0.3), r1=0.45, r2=0.35, h=2.4, verts=10, rot=(-0.7, 0, 0))
    cyl('cannon', 'glow_f2c94c', (0, 1.95, -1.15), r1=0.42, h=0.15, verts=10, rot=(-0.7, 0, 0))
    for k in range(3):
        ico('cannon', 'c_6b4a2b', (1 + k * 0.3, 0.28, 0.5 - k * 0.5), r=0.28, subdiv=1)


def crab():
    ico('crab', 'c_e8676b', (0, 0.4, 0), r=0.6, scale=(1, 0.55, 0.8), subdiv=2)
    for side in (-1, 1):
        ico('crab', 'c_e8676b', (side * 0.85, 0.55, -0.45), r=0.25, scale=(1, 0.8, 1.2), subdiv=1)
        cone('crab', 'c_f08a8d', (side * 0.95, 0.65, -0.7), r=0.12, h=0.3, verts=4, rot=(-1.2, 0, 0))
        for k in range(3):
            cyl('crab', 'c_d9575b', (side * 0.6, 0.2, 0.1 - k * 0.22), r1=0.05, h=0.6, verts=4, rot=(0, 0, side * 1.0))
        cyl('crab', 'c_e8676b', (side * 0.18, 0.75, -0.3), r1=0.04, h=0.3, verts=4)
        ico('crab', 'c_ffffff', (side * 0.18, 0.92, -0.3), r=0.09, subdiv=1)
        ico('crab', 'c_1d1b2a', (side * 0.18, 0.93, -0.38), r=0.045, subdiv=1)


def tower():
    """Clock tower: board places it at y = 3.5 (center of a 7 m tall shaft) – keep that origin."""
    n = 'tower'
    cyl(n, 'c_f6efe2', (0, 0, 0), r1=1.0, r2=0.9, h=7, verts=6)
    cyl(n, 'c_d9d6ea', (0, -3.3, 0), r1=1.25, r2=1.15, h=0.5, verts=6)
    cyl(n, 'c_d9d6ea', (0, 2.6, 0), r1=1.05, h=0.2, verts=6)
    cyl(n, 'c_ffffff', (0, 2.0, -0.9), r1=0.55, h=0.08, verts=12, rot=(math.pi / 2, 0, 0))
    box(n, 'c_3d3a55', (0, 2.15, -0.96), size=(0.06, 0.4, 0.04))
    box(n, 'c_3d3a55', (0.12, 2.0, -0.96), size=(0.3, 0.06, 0.04))
    cone(n, 'tint', (0, 4.5, 0), r=1.4, h=2.0, verts=6)
    cone(n, 'glow_f2c94c', (0, 5.7, 0), r=0.12, h=0.5, verts=4)
    box(n, 'c_8a5a3c', (0, -2.9, -0.9), size=(0.7, 1.2, 0.1))


def fountain():
    """Board places it at y = 0.3."""
    n = 'fountain'
    cyl(n, 'c_d9d6ea', (0, 0, 0), r1=1.5, h=0.6, verts=12)
    cyl(n, 'c_86c8e0', (0, 0.32, 0), r1=1.25, h=0.08, verts=12)
    cyl(n, 'c_d9d6ea', (0, 0.8, 0), r1=0.25, r2=0.18, h=1.0, verts=8)
    cyl(n, 'c_d9d6ea', (0, 1.3, 0), r1=0.7, r2=0.6, h=0.18, verts=10)
    cyl(n, 'c_9ad6ec', (0, 1.42, 0), r1=0.55, h=0.06, verts=10)
    for k in range(6):
        a = k / 6 * TAU
        cone(n, 'c_b8e4f2', (math.cos(a) * 0.3, 1.75, math.sin(a) * 0.3), r=0.08, h=0.6, verts=4, rot=(math.sin(a) * 0.4, 0, -math.cos(a) * 0.4))


def loco():
    """Train engine (faces +Z like the placeholder: board rotates with atan2(dx, dz))."""
    n = 'loco'
    box(n, 'tint', (0, 0.95, 0.4), size=(1.6, 1.3, 2.6), bevel=0.06)
    cyl(n, 'tint', (0, 1.2, 1.3), r1=0.7, h=1.6, verts=10, rot=(math.pi / 2, 0, 0))
    box(n, 'c_3d3a55', (0, 1.6, -0.95), size=(1.8, 1.6, 1.3), bevel=0.05)
    box(n, 'c_86c8e0', (0, 1.85, -0.3), size=(1.5, 0.5, 0.05))
    box(n, 'c_e8676b', (0, 2.5, -0.95), size=(2.0, 0.12, 1.5))
    cyl(n, 'c_3d3a55', (0, 2.2, 1.6), r1=0.22, r2=0.32, h=0.9, verts=8)
    cyl(n, 'glow_f2c94c', (0, 1.25, 2.12), r1=0.25, h=0.08, verts=8, rot=(math.pi / 2, 0, 0))
    cone(n, 'c_3d3a55', (0, 0.35, 2.2), r=0.7, h=0.6, verts=4, rot=(math.pi / 2 + 0.6, 0, 0), scale=(1.2, 1, 0.5))
    for sx in (-1, 1):
        for z in (-0.9, 0.1, 1.1):
            cyl(n, 'c_2b2b3a', (sx * 0.85, 0.4, z), r1=0.38, h=0.16, verts=10, rot=(0, 0, math.pi / 2))
            cyl(n, 'glow_f2c94c', (sx * 0.94, 0.4, z), r1=0.12, h=0.04, verts=6, rot=(0, 0, math.pi / 2))


def stall():
    """Shop stall (striped awning, counter) – replaces the hut at shop fields."""
    n = 'stall'
    box(n, 'c_a0703f', (0, 0.55, 0), size=(2.6, 1.1, 1.4), bevel=0.04)
    box(n, 'c_f6efe2', (0, 1.13, 0), size=(2.8, 0.1, 1.6))
    for sx in (-1, 1):
        box(n, 'c_8a5a3c', (sx * 1.25, 1.6, 0.55), size=(0.14, 3.2, 0.14))
        box(n, 'c_8a5a3c', (sx * 1.25, 1.2, -0.55), size=(0.14, 2.4, 0.14))
    for k in range(6):
        x0 = -1.25 + 0.5 * k + 0.25
        beam(n, 'tint' if k % 2 else 'c_f6efe2', (x0, 3.05, 0.65), (x0, 2.35, -1.0), width=0.5, thick=0.06)
    for k, col in enumerate(('c_e8676b', 'c_f2c94c', 'c_7cbf6b')):
        ico(n, col, (-0.7 + k * 0.7, 1.32, -0.2), r=0.2, subdiv=1)


OUT = lib.arg('out', '.')
os.makedirs(OUT, exist_ok=True)
lib.reset()
random.seed(1)
PROPS = (palm, hut, house, rock, tree, deadtree, obsidian, volcano, cannon, crab, tower, fountain, loco, stall)
for i, fn in enumerate(PROPS):
    fn()
tris = lib.finalize(os.path.join(OUT, 'props.glb'))
