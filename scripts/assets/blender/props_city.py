"""City prop library (Bimmelbahn-Stadt): props_city.glb.

Usage: blender -b -P props_city.py -- --out <dir> [--only id,id]
Conventions as in props.py (Babylon space, ground y = 0, front = -Z, "<prop>__<material>").
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import beam, box, cone, cyl, ico, lathe, prism, shade, tone, tube, vgrad  # noqa: E402
from propkit import (  # noqa: E402
    CREAM, GLASS, GOLD, LEAF, LEAF_D, METAL, PLASTER, R, RED, SLATE, STONE, WHITE, WOOD, WOOD_D, WOOD_L,
    arch_bridge_body, at, barrel, blob, crate, deck_y, door, gable_roof, gable_wall, lerp, plank, post, sack, window,
)

TAU = math.tau
IRON = 'c_4a5a78'
PEACH = 'c_f3d9c8'
MINT = 'c_bfe3d0'
TERRA = 'c_d98a6a'
FOLIAGE = 'c_86c77a'
LAMPGLOW = 'glow_ffe6a0'


def street_lantern(g, loc, h=2.6, s=1.0):
    with at(loc, (0, 0, 0), s):
        lathe(g, IRON, (0, 0, 0), [(0.16, 0), (0.15, 0.12), (0.08, 0.22), (0.06, 0.5), (0.09, 0.56), (0.05, 0.62), (0.045, h - 0.25), (0.08, h - 0.2), (0.05, h - 0.15)], verts=8)
        lathe(g, IRON, (0, h - 0.2, 0), [(0.1, 0), (0.18, 0.06)], verts=6)
        lathe(g, LAMPGLOW, (0, h - 0.14, 0), [(0.13, 0), (0.17, 0.3), (0.12, 0.36)], verts=6)
        for k in range(6):
            a = k / 6 * TAU
            box(g, IRON, (math.cos(a) * 0.16, h + 0.03, math.sin(a) * 0.16), (0.025, 0.36, 0.025))
        lathe(g, IRON, (0, h + 0.2, 0), [(0.24, 0), (0.22, 0.04), (0.08, 0.16), (0, 0.24)], verts=6)
        cone(g, IRON, (0, h + 0.5, 0), r=0.035, h=0.14, verts=4)


def house2():
    """Tall narrow townhouse (2.2 wide x 2.4 deep, 3 floors), street gable facing -Z, roof in tint."""
    g = 'house2'
    w, d, h = 2.2, 2.4, 4.8
    box(g, STONE, (0, 0.18, 0), (w + 0.14, 0.36, d + 0.14), bevel=0.03)
    box(g, PEACH, (0, h / 2, 0), (w, h, d), bevel=0.03)
    for y in (1.75, 3.3):
        box(g, STONE, (0, y, 0), (w + 0.08, 0.1, d + 0.08))
    box(g, STONE, (0, h - 0.05, 0), (w + 0.16, 0.12, d + 0.16))
    # steep roof, ridge along Z, gable towards the street
    gable_wall(g, PEACH, (0, h, 0), w, 1.55, d - 0.04)
    gable_roof(g, 'tint', (0, h - 0.02, 0), d, w, 1.6, over=0.22, thick=0.11, rows=4, ridge='c_c96f5f', yaw=math.pi / 2, seed=11)
    window(g, (0, h + 0.55, -d / 2 - 0.03), w=0.42, h=0.5, arch=True, sill=None)
    with at((-0.55, h, 0.6)):
        box(g, 'c_c98a72', (0, 1.0, 0), (0.36, 1.4, 0.36))
        box(g, STONE, (0, 1.72, 0), (0.46, 0.08, 0.46))
    # street side: door + bay of windows, balcony on floor 2
    door(g, (-0.5, 0.36, -d / 2 - 0.02), w=0.6, h=1.05, wood='c_6f9de6', frame=WHITE, step=STONE)
    beam(g, 'tint', (-0.5, 1.6, -d / 2), (-0.5, 1.48, -d / 2 - 0.35), width=0.85, thick=0.05)
    window(g, (0.5, 1.0, -d / 2 - 0.03), w=0.55, h=0.7, shutter='tint')
    for x in (-0.5, 0.5):
        window(g, (x, 2.55, -d / 2 - 0.03), w=0.45, h=0.75, box_flowers=None)
        window(g, (x, 4.0, -d / 2 - 0.03), w=0.45, h=0.65, box_flowers='c_f28aa0')
    box(g, STONE, (0, 2.0, -d / 2 - 0.3), (1.8, 0.08, 0.6))
    for k in range(9):
        x = -0.85 + k * 0.2125
        cyl(g, IRON, (x, 2.25, -d / 2 - 0.57), r1=0.02, h=0.42, verts=4)
    box(g, IRON, (0, 2.48, -d / 2 - 0.57), (1.8, 0.05, 0.05))
    for sx in (-1, 1):
        box(g, IRON, (sx * 0.88, 2.48, -d / 2 - 0.3), (0.05, 0.05, 0.55))
    # back + sides
    for y in (1.0, 2.55, 4.0):
        window(g, (0, y, d / 2 + 0.03), w=0.5, h=0.65, yaw=math.pi)
        for sx in (-1, 1):
            window(g, (sx * (w / 2 + 0.03), y, 0.3), w=0.4, h=0.6, yaw=-sx * math.pi / 2, sill=None, cross=False)
    blob(g, LEAF_D, (0.95, 0.3, -d / 2 - 0.3), r=0.3, scale=(1, 0.85, 0.8), seed=12)


def house3():
    """Corner bakery (3 x 3): shop window + striped awning (tint), hip roof, pretzel sign."""
    g = 'house3'
    w, d, h = 3.0, 3.0, 3.4
    box(g, STONE, (0, 0.15, 0), (w + 0.14, 0.3, d + 0.14), bevel=0.03)
    box(g, CREAM, (0, h / 2, 0), (w, h, d), bevel=0.03)
    box(g, 'c_e7c9a8', (0, 0.85, 0), (w + 0.04, 1.4, d + 0.04))
    box(g, STONE, (0, 1.6, 0), (w + 0.1, 0.12, d + 0.1))
    box(g, STONE, (0, h, 0), (w + 0.2, 0.14, d + 0.2))
    # hip roof (terracotta) with dormer-ish chimney
    o = lathe(g, TERRA, (0, h + 0.05, 0), [(2.25, 0), (2.2, 0.1), (0.9, 1.15), (0, 1.5)], verts=4, phase=math.pi / 4)
    vgrad(o, 0.85, 1.0)
    for k in range(3):
        lathe(g, TERRA, (0, h + 0.1 + k * 0.38, 0), [(2.15 - k * 0.42, 0), (2.17 - k * 0.42, 0.06)], verts=4, phase=math.pi / 4)
    with at((0.8, h, 0.7)):
        box(g, 'c_c98a72', (0, 1.0, 0), (0.4, 1.3, 0.4))
        box(g, STONE, (0, 1.68, 0), (0.5, 0.08, 0.5))
    # shop front (-Z) and side (-X): big windows with bread + door
    for yaw, face in ((0, (0, -d / 2)), (-math.pi / 2, (-w / 2, 0))):
        with at((face[0], 0, face[1]), (0, yaw, 0)):
            box(g, GLASS, (0.45, 0.95, -0.02), (1.5, 0.9, 0.05))
            box(g, WOOD_D, (0.45, 0.48, -0.06), (1.7, 0.1, 0.1))
            box(g, WOOD_D, (0.45, 1.42, -0.06), (1.7, 0.08, 0.1))
            for x in (-0.33, 0.45, 1.23):
                box(g, WOOD_D, (x, 0.95, -0.06), (0.08, 0.95, 0.1))
            for k in range(4 if yaw == 0 else 0):
                lathe(g, 'c_d9a05b', (0.0 + k * 0.32, 0.62, -0.12), [(0.06, -0.1), (0.09, 0), (0.06, 0.1)], verts=6, rot=(0, 0, math.pi / 2))
            for k in range(6):
                x0 = -0.45 + (k + 0.5) * 1.9 / 6
                beam(g, 'tint' if k % 2 == 0 else CREAM, (x0, 1.85, -0.02), (x0, 1.5, -0.62), width=1.9 / 6, thick=0.05)
                prism(g, 'tint' if k % 2 == 0 else CREAM, (x0, 1.47, -0.64), [(-0.16, 0), (0.16, 0), (0, -0.16)], 0.03)
            door(g, (-0.85, 0.3, -0.02), w=0.6, h=1.15, wood='c_7a8fc0', frame=WOOD_D, step=None)
            for x in (-0.6, 0.6):
                window(g, (x, 2.45, -0.03), w=0.5, h=0.65, shutter='c_9fc3e8' if yaw == 0 else None, box_flowers='c_f28aa0')
    for yaw, face in ((math.pi, (0, d / 2)), (math.pi / 2, (w / 2, 0))):
        with at((face[0], 0, face[1]), (0, yaw, 0)):
            for x in (-0.6, 0.6):
                window(g, (x, 2.45, -0.03), w=0.5, h=0.65, cross=False)
    # pretzel sign on a bracket at the corner
    with at((-w / 2 - 0.05, 2.1, -d / 2 - 0.05), (0, math.pi / 4, 0)):
        tube(g, IRON, [(0, 0.3, 0), (0, 0.3, -0.55)], 0.025, verts=4)
        pretzel = [(math.sin(t) * 0.22 * (1 + 0.4 * math.cos(t)), -0.05 - 0.18 * math.cos(t) + 0.12 * math.sin(2 * t) * 0, 0) for t in [k / 16 * TAU for k in range(17)]]
        with at((0, 0.0, -0.45)):
            tube(g, 'c_c98a4a', pretzel, 0.05, verts=5)
            tube(g, 'c_c98a4a', [(-0.15, 0.06, 0), (0.0, -0.12, 0), (0.15, 0.06, 0)], 0.045, verts=5)
        tube(g, IRON, [(0, 0.3, -0.45), (0, 0.12, -0.45)], 0.015, verts=4)
    box(g, WOOD, (0.7, 0.42, -d / 2 - 0.65), (1.0, 0.07, 0.3))
    for x in (0.3, 1.1):
        box(g, IRON, (x, 0.21, -d / 2 - 0.65), (0.06, 0.42, 0.26))


def station():
    """Train station (~6 x 3): building + raised platform at the front (-Z) with a canopy."""
    g = 'station'
    w, d, h = 4.2, 2.4, 2.6
    box(g, STONE, (0, 0.2, 0.55), (6.4, 0.4, 3.6), bevel=0.03)
    box(g, GOLD, (0, 0.405, -1.15), (6.4, 0.01, 0.12))
    box(g, CREAM, (0, 0.4 + h / 2, 0.9), (w, h, d), bevel=0.03)
    box(g, STONE, (0, 0.55, 0.9), (w + 0.06, 0.3, d + 0.06))
    box(g, STONE, (0, 0.4 + h, 0.9), (w + 0.16, 0.14, d + 0.16))
    gable_wall(g, CREAM, (0, 0.4 + h, 0.9), d, 1.0, w - 0.04, yaw=math.pi / 2)
    gable_roof(g, 'tint', (0, 0.4 + h - 0.02, 0.9), w, d, 1.05, over=0.3, thick=0.12, rows=3, ridge='c_c96f5f', seed=21)
    # central front gable with a clock
    with at((0, 0.4 + h, 0.9 - d / 2)):
        prism(g, CREAM, (0, 0, -0.1), [(-0.9, 0), (0.9, 0), (0, 1.0)], 0.3)
        beam(g, 'tint', (-1.1, -0.05, -0.12), (0, 1.15, -0.12), width=0.5, thick=0.1, up=(-1, 1, 0))
        beam(g, 'tint', (1.1, -0.05, -0.12), (0, 1.15, -0.12), width=0.5, thick=0.1, up=(1, 1, 0))
        cyl(g, WHITE, (0, 0.42, -0.27), r1=0.3, h=0.05, verts=14, rot=(math.pi / 2, 0, 0))
        lib.torus(g, IRON, (0, 0.42, -0.28), R=0.3, r=0.035, seg=14, mseg=4, rot=(math.pi / 2, 0, 0))
        box(g, IRON, (0, 0.5, -0.31), (0.04, 0.18, 0.02))
        box(g, IRON, (0.06, 0.42, -0.31), (0.14, 0.035, 0.02))
    # facade: arched windows + double door
    door(g, (0, 0.4, 0.9 - d / 2 - 0.02), w=0.9, h=1.4, wood='c_6f9de6', frame=STONE, planks=6, step=None)
    for x in (-1.5, -0.8, 0.8, 1.5):
        window(g, (x, 1.45, 0.9 - d / 2 - 0.03), w=0.42, h=0.9, arch=True, sill=STONE)
    for x in (-1.2, 0, 1.2):
        window(g, (x, 1.45, 0.9 + d / 2 + 0.03), w=0.5, h=0.8, yaw=math.pi)
    for sx in (-1, 1):
        window(g, (sx * (w / 2 + 0.03), 1.45, 0.9), w=0.5, h=0.8, yaw=-sx * math.pi / 2)
    # platform canopy: posts + sloping roof (tint) with valance
    for x in (-2.7, -0.9, 0.9, 2.7):
        lathe(g, IRON, (x, 0.4, -1.0), [(0.1, 0), (0.06, 0.15), (0.05, 2.2), (0.09, 2.3)], verts=6)
        beam(g, IRON, (x, 2.3, -1.0), (x, 2.75, -0.35), width=0.06, thick=0.06, up=(1, 0, 0))
        beam(g, IRON, (x, 2.0, -1.0), (x, 2.65, -1.25), width=0.05, thick=0.05, up=(1, 0, 0))
    for k in range(8):
        x0 = -3.0 + (k + 0.5) * 6.0 / 8
        o = beam(g, 'tint' if k % 2 == 0 else CREAM, (x0, 2.85, -0.3), (x0, 2.55, -1.55), width=6.0 / 8, thick=0.07)
    for k in range(16):
        x = -3.0 + (k + 0.5) * 6 / 16
        prism(g, CREAM, (x, 2.5, -1.57), [(-0.19, 0.04), (0.19, 0.04), (0, -0.14)], 0.03)
    box(g, IRON, (0, 2.52, -1.56), (6.05, 0.06, 0.06))
    # station sign with a little loco icon, benches, lanterns
    with at((0, 2.2, -1.28)):
        box(g, WHITE, (0, 0, 0), (1.5, 0.36, 0.05), bevel=0.01)
        box(g, IRON, (0, 0, 0.0), (1.56, 0.42, 0.03))
        prism(g, 'tint', (-0.3, -0.08, -0.04), [(-0.25, 0), (0.25, 0), (0.25, 0.14), (0.05, 0.14), (0.05, 0.22), (-0.1, 0.22), (-0.1, 0.14), (-0.25, 0.14)], 0.02)
        for x in (-0.48, -0.2):
            cyl(g, IRON, (x, -0.1, -0.05), r1=0.05, h=0.02, verts=8, rot=(math.pi / 2, 0, 0))
        box(g, IRON, (0.35, 0.0, -0.04), (0.6, 0.06, 0.01))
        box(g, IRON, (0.3, -0.09, -0.04), (0.5, 0.05, 0.01))
    for x in (-1.8, 1.8):
        with at((x, 0.4, -0.25)):
            for k in range(3):
                plank(g, WOOD, (-0.6, 0.42, -0.12 + k * 0.12), (0.6, 0.42, -0.12 + k * 0.12), w=0.1, t=0.05, seed=k)
            plank(g, WOOD, (-0.6, 0.62, 0.15), (0.6, 0.62, 0.15), w=0.14, t=0.04, up=(0, 0.2, -1), seed=4)
            for sx in (-0.5, 0.5):
                box(g, IRON, (sx, 0.3, 0.0), (0.05, 0.6, 0.35))
    for x in (-3.0, 3.0):
        street_lantern(g, (x, 0.4, 0.2), h=2.3, s=0.9)
    barrel(g, (2.6, 0.4, 1.9), h=0.75, r=0.28, seed=3)
    crate(g, (-2.7, 0.4, 1.8), s=0.55, yaw=0.2, seed=4)


def wagon():
    """Passenger wagon matching 'loco' (faces +Z, 3.4 long, body in tint)."""
    g = 'wagon'
    box(g, SLATE, (0, 0.6, 0), (1.3, 0.3, 3.3), bevel=0.03)
    for sz in (-1, 1):
        box(g, SLATE, (0, 0.6, sz * 1.75), (0.3, 0.16, 0.25))
        for sx in (-1, 1):
            cyl(g, SLATE, (sx * 0.5, 0.6, sz * 1.72), r1=0.08, h=0.18, verts=6, rot=(math.pi / 2, 0, 0))
            cyl(g, SLATE, (sx * 0.5, 0.6, sz * 1.82), r1=0.13, h=0.04, verts=8, rot=(math.pi / 2, 0, 0))
    box(g, 'tint', (0, 1.0, 0), (1.6, 0.55, 3.1), bevel=0.04)
    box(g, GOLD, (0, 1.3, 0), (1.62, 0.06, 3.12))
    for sx in (-1, 1):
        for k in range(4):
            z = -1.15 + k * 0.77
            box(g, 'tint', (sx * 0.77, 1.75, z - 0.38), (0.08, 0.84, 0.14))
            box(g, GLASS, (sx * 0.74, 1.75, z), (0.04, 0.6, 0.55))
        box(g, 'tint', (sx * 0.77, 1.75, 1.5), (0.08, 0.84, 0.14))
    for sz in (-1, 1):
        box(g, 'tint', (0, 1.75, sz * 1.52), (1.6, 0.84, 0.08))
        box(g, GLASS, (0, 1.8, sz * 1.56), (0.5, 0.5, 0.04))
    box(g, GLASS, (0, 1.75, 0), (1.44, 0.75, 2.9))
    box(g, 'tint', (0, 2.2, 0), (1.62, 0.1, 3.12))
    arc = [(math.sin(a) * 1.5, 2.35 + (math.cos(a) - 1) * 1.5 * 0.45) for a in [-0.6 + k * 0.12 for k in range(11)]]
    outline = [(x, y + 0.09) for x, y in arc] + [(x, y) for x, y in reversed(arc)]
    prism(g, RED, (0, 0, 0), outline, 3.35)
    for sz in (-1, 1):
        for sx in (-1, 1):
            for z in (sz * 1.05 - 0.3, sz * 1.05 + 0.3):
                cyl(g, RED, (sx * 0.72, 0.38, z), r1=0.3, h=0.12, verts=12, rot=(0, 0, math.pi / 2))
                cyl(g, 'glow_f2c94c', (sx * 0.8, 0.38, z), r1=0.08, h=0.05, verts=6, rot=(0, 0, math.pi / 2))
            box(g, SLATE, (sx * 0.72, 0.45, sz * 1.05), (0.1, 0.18, 0.9))


def treeround():
    """Deciduous round tree (~3 wide, ~4 high)."""
    g = 'treeround'
    tube(g, 'c_9a7458', [(0, -0.1, 0), (0, 0.3, 0), (0.05, 1.3, 0.0), (0.1, 2.0, 0.05)], [0.3, 0.2, 0.16, 0.12], verts=6)
    tube(g, 'c_9a7458', [(0.05, 1.4, 0), (-0.45, 2.0, 0.1), (-0.65, 2.3, 0.12)], [0.09, 0.06, 0.03], verts=5)
    tube(g, 'c_9a7458', [(0.08, 1.6, 0), (0.5, 2.1, -0.2)], [0.08, 0.04], verts=5)
    rr = R(300)
    for k, (x, y, z, r) in enumerate(((0.05, 2.75, 0.0, 1.05), (-0.75, 2.35, 0.2, 0.75), (0.7, 2.4, -0.25, 0.72), (0.0, 3.35, 0.15, 0.7), (0.1, 2.3, 0.75, 0.65), (-0.2, 2.25, -0.7, 0.6))):
        o = blob(g, FOLIAGE, (x, y, z), r=r, scale=(1, 0.9, 1), seed=310 + k, subdiv=2, rough=0.2, lo=0.78)
        tone(o, rr.uniform(0.9, 1.0))


def hedge():
    """Trimmed hedge, 2 long along X (<= 300 tris)."""
    g = 'hedge'
    for k, x in enumerate((-0.55, 0.0, 0.55)):
        o = blob(g, 'c_74b56c', (x, 0.4, 0), r=0.55, scale=(0.95, 0.75, 0.6), seed=320 + k, subdiv=2, rough=0.1, lo=0.72)
        lib.flatten(o, 0.0, 0.0)


def streetlamp():
    street_lantern('streetlamp', (0, 0, 0), h=2.6)


def flowerbox():
    """Planter box with flowers (~1.2 long)."""
    g = 'flowerbox'
    box(g, WOOD, (0, 0.22, 0), (1.2, 0.44, 0.45), bevel=0.02)
    for x in (-0.6, 0.6):
        box(g, WOOD_D, (x, 0.22, 0), (0.08, 0.46, 0.5))
    box(g, 'c_8a6a52', (0, 0.43, 0), (1.1, 0.04, 0.38))
    for k, x in enumerate((-0.35, 0.05, 0.4)):
        blob(g, LEAF, (x, 0.55, 0), r=0.2, scale=(1, 0.75, 0.9), seed=330 + k, subdiv=1, rough=0.15)
    rr = R(331)
    for k in range(7):
        x = -0.45 + k * 0.15
        col = ('c_f28aa0', 'c_f7b267', 'c_b48cf0')[k % 3]
        ico(g, col, (x, 0.64 + rr.uniform(-0.04, 0.04), rr.uniform(-0.12, 0.12)), r=0.065, scale=(1, 0.7, 1), subdiv=1)


def kiosk():
    """Octagonal newspaper/ticket kiosk with an onion roof in tint."""
    g = 'kiosk'
    lathe(g, STONE, (0, 0, 0), [(1.0, 0), (1.0, 0.15), (0.92, 0.2)], verts=8, phase=math.pi / 8)
    lathe(g, MINT, (0, 0, 0), [(0.86, 0.2), (0.86, 2.0)], verts=8, phase=math.pi / 8)
    lathe(g, WHITE, (0, 0, 0), [(0.92, 1.98), (0.98, 2.08), (0.92, 2.16)], verts=8, phase=math.pi / 8)
    lathe(g, 'tint', (0, 2.12, 0), [(1.08, 0), (1.1, 0.08), (0.8, 0.45), (0.55, 0.75), (0.2, 1.0), (0, 1.1)], verts=8, phase=math.pi / 8)
    lathe(g, GOLD, (0, 3.18, 0), [(0, 0), (0.07, 0.08), (0.03, 0.18), (0, 0.32)], verts=5)
    ap = 0.86 * math.cos(math.pi / 8)
    # sales window with counter + awning on the front face
    box(g, GLASS, (0, 1.35, -ap - 0.01), (0.6, 0.55, 0.04))
    box(g, WHITE, (0, 1.05, -ap - 0.12), (0.75, 0.06, 0.26))
    beam(g, 'tint', (0, 1.82, -ap), (0, 1.68, -ap - 0.4), width=0.85, thick=0.04)
    # posters on the other faces
    cols = ('c_f28aa0', 'c_f7b267', 'c_8fd3ff', WHITE, 'c_9be08a', 'c_b48cf0', 'c_f7b267')
    for k in range(1, 8):
        a = -math.pi / 2 + k * TAU / 8
        with at((math.cos(a) * (ap + 0.01), 1.15, math.sin(a) * (ap + 0.01)), (0, -a - math.pi / 2, 0)):
            box(g, cols[k - 1], (0, 0, 0), (0.42, 0.62, 0.03))
            box(g, WHITE, (0, 0.18, -0.02), (0.3, 0.08, 0.01))
    for k in range(8):
        a = (k + 0.5) / 8 * TAU + math.pi / 8
        box(g, WHITE, (math.cos(a) * 0.86, 1.1, math.sin(a) * 0.86), (0.06, 1.8, 0.06), rot=(0, -a, 0))
    box(g, WOOD_L, (0.75, 0.2, -0.9), (0.4, 0.4, 0.3))
    for k in range(3):
        box(g, WHITE, (0.75, 0.42 + k * 0.025, -0.9), (0.32, 0.02, 0.24))


def marketstall():
    """Market stall with a striped gable awning (tint) and produce crates."""
    g = 'marketstall'
    for sx in (-1, 1):
        for sz in (-1, 1):
            post(g, WOOD_D, (sx * 1.2, 0, sz * 0.6), 2.05, r=0.06, verts=5, seed=sx * 2 + sz)
    tube(g, WOOD_D, [(-1.35, 2.5, 0), (1.35, 2.5, 0)], 0.05, verts=5)
    for s in (-1, 1):
        for k in range(6):
            x0 = -1.35 + (k + 0.5) * 2.7 / 6
            beam(g, 'tint' if k % 2 == 0 else CREAM, (x0, 2.52, 0), (x0, 1.95, s * 0.95), width=2.7 / 6, thick=0.05)
            prism(g, 'tint' if k % 2 == 0 else CREAM, (x0, 1.92, s * 0.97), [(-0.225, 0), (0.225, 0), (0, -0.18)], 0.03, rot=(0, 0, 0))
    box(g, WOOD_L, (0, 0.85, 0), (2.5, 0.08, 1.2), bevel=0.02)
    for sx in (-1, 1):
        beam(g, WOOD_D, (sx * 1.0, 0, -0.5), (sx * 1.0, 0.82, 0.5), width=0.06, thick=0.06, up=(1, 0, 0))
        beam(g, WOOD_D, (sx * 1.0, 0, 0.5), (sx * 1.0, 0.82, -0.5), width=0.06, thick=0.06, up=(1, 0, 0))
    goods = (('c_e8676b', 0.1), ('c_f7b267', 0.11), ('c_9be08a', 0.12), ('c_b48cf0', 0.07))
    for k, (col, r) in enumerate(goods):
        with at((-0.9 + k * 0.6, 0.89, -0.15), (0.25, 0, 0)):
            box(g, WOOD, (0, 0.09, 0), (0.52, 0.18, 0.5))
            for j in range(6):
                ico(g, col, (-0.14 + (j % 3) * 0.14, 0.22 + (j // 3) * 0.04, -0.1 + (j // 3) * 0.18), r=r, subdiv=1)
    crate(g, (1.55, 0, 0.3), s=0.5, yaw=0.3, seed=7)
    crate(g, (1.5, 0.5, 0.3), s=0.38, yaw=-0.1, seed=8, diag=False)
    sack(g, (-1.55, 0, -0.2), s=0.5, seed=9)
    with at((0, 2.15, -0.98)):
        box(g, WOOD, (0, 0, 0), (0.8, 0.25, 0.04), bevel=0.01)
        box(g, WHITE, (0, 0, -0.025), (0.55, 0.06, 0.01))


def cityshop():
    """City shop building for shop fields (~3 x 3): display windows, awning (tint), sign."""
    g = 'cityshop'
    w, d, h = 2.8, 2.6, 3.6
    box(g, STONE, (0, 0.15, 0), (w + 0.14, 0.3, d + 0.14), bevel=0.03)
    box(g, 'c_cfe0f0', (0, h / 2, 0), (w, h, d), bevel=0.03)
    box(g, IRON, (0, 0.95, -d / 2 + 0.01), (w + 0.04, 1.6, 0.06))
    box(g, STONE, (0, 1.8, 0), (w + 0.08, 0.12, d + 0.08))
    box(g, STONE, (0, h, 0), (w + 0.2, 0.16, d + 0.2))
    for k in range(9):
        box(g, STONE, (-w / 2 + 0.15 + k * (w - 0.3) / 8, h + 0.2, -d / 2 + 0.05), (0.1, 0.25, 0.1))
    box(g, STONE, (0, h + 0.36, -d / 2 + 0.05), (w + 0.1, 0.08, 0.16))
    lathe(g, 'c_7d86b8', (0, h + 0.05, 0.25), [(1.75, 0), (1.7, 0.08), (0.6, 0.9), (0, 1.1)], verts=4, phase=math.pi / 4, scale=(1, 1, 0.9))
    # display windows with goods + central door
    for sx in (-1, 1):
        box(g, GLASS, (sx * 0.85, 0.95, -d / 2 - 0.03), (0.85, 1.05, 0.04))
        box(g, WHITE, (sx * 0.85, 0.36, -d / 2 - 0.08), (0.95, 0.08, 0.14))
        for k, col in enumerate(('c_b48cf0', 'c_f28aa0', 'c_8fd3ff')):
            lathe(g, col, (sx * 0.85 - 0.25 + k * 0.25, 0.42, -d / 2 + 0.12), [(0.07, 0), (0.09, 0.12), (0.04, 0.2), (0.04, 0.26), (0, 0.27)], verts=6)
    door(g, (0, 0.3, -d / 2 - 0.04), w=0.62, h=1.3, wood='c_f2c94c', frame=WHITE, step=None)
    for k in range(8):
        x0 = -w / 2 - 0.05 + (k + 0.5) * (w + 0.1) / 8
        beam(g, 'tint' if k % 2 == 0 else CREAM, (x0, 1.9, -d / 2), (x0, 1.62, -d / 2 - 0.75), width=(w + 0.1) / 8, thick=0.05)
        prism(g, 'tint' if k % 2 == 0 else CREAM, (x0, 1.59, -d / 2 - 0.77), [(-0.18, 0), (0.18, 0), (0, -0.16)], 0.03)
    # sign with a golden coin bag
    with at((0, 2.45, -d / 2 - 0.06)):
        box(g, WOOD_D, (0, 0, 0), (1.9, 0.5, 0.06), bevel=0.02)
        box(g, WHITE, (0, 0, -0.035), (1.75, 0.38, 0.02))
        ico(g, 'glow_f2c94c', (0, -0.02, -0.06), r=0.15, scale=(1, 1, 0.4), subdiv=2)
        cone(g, 'glow_f2c94c', (0, 0.14, -0.06), r=0.07, h=0.1, verts=5, rot=(math.pi, 0, 0))
        for x in (-0.6, 0.6):
            box(g, 'tint', (x, 0, -0.05), (0.42, 0.06, 0.01))
    for x in (-0.85, 0.85):
        window(g, (x, 2.9, -d / 2 - 0.03), w=0.5, h=0.5, box_flowers='c_f28aa0', sill=None)
        window(g, (x, 2.6, d / 2 + 0.03), w=0.5, h=0.6, yaw=math.pi)
    for sx in (-1, 1):
        window(g, (sx * (w / 2 + 0.03), 2.6, 0), w=0.5, h=0.6, yaw=-sx * math.pi / 2)
    for x in (-1.6, 1.6):
        lathe(g, TERRA, (x, 0, -d / 2 - 0.4), [(0.14, 0), (0.2, 0.32), (0.22, 0.36)], verts=8)
        blob(g, LEAF_D, (x, 0.65, -d / 2 - 0.4), r=0.28, scale=(1, 1.2, 1), seed=int(x * 10 + 400))


def bridgestone():
    """Canal bridge (same contract as island 'bridge'): deck along Z, 7 long x 2.4 wide,
    origin at its center, deck top y = 0.45 at the center, 0.30 at the ends."""
    g = 'bridgestone'
    arch_bridge_body(g, 'c_ddd3cb', 'c_c98a72', 'c_cfc6be', width=2.2, seed=410)
    for sx in (-1, 1):
        box(g, 'c_c98a72', (sx * 1.1, -0.02, 0), (0.06, 0.08, 7.0))
        n = 14
        for i in range(n + 1):
            z = -3.3 + i * 6.6 / n
            cyl(g, IRON, (sx * 1.05, deck_y(z) + 0.35, z), r1=0.025, h=0.7, verts=4)
        for i in range(n):
            z0, z1 = -3.3 + i * 6.6 / n, -3.3 + (i + 1) * 6.6 / n
            beam(g, IRON, (sx * 1.05, deck_y(z0) + 0.7, z0), (sx * 1.05, deck_y(z1) + 0.7, z1), width=0.07, thick=0.05)
        for z in (-3.4, 3.4):
            box(g, 'c_ddd3cb', (sx * 1.05, deck_y(z) + 0.4, z), (0.3, 0.8, 0.3), bevel=0.03)
        street_lantern(g, (sx * 1.05, deck_y(0) + 0.0, 0), h=1.6, s=0.8)


def bushround():
    g = 'bushround'
    blob(g, FOLIAGE, (0, 0.38, 0), r=0.45, scale=(1, 0.85, 1), seed=420, subdiv=2, rough=0.15, lo=0.72)
    blob(g, FOLIAGE, (0.35, 0.25, 0.2), r=0.28, scale=(1, 0.85, 1), seed=421, subdiv=2, rough=0.15, lo=0.72)
    blob(g, FOLIAGE, (-0.3, 0.22, -0.2), r=0.25, scale=(1, 0.85, 1), seed=422, subdiv=1, rough=0.1, lo=0.72)


def bike():
    """Parked bicycle with a front basket (~1.7 long along X)."""
    g = 'bike'
    with at((0, 0, 0), (0.12, 0, 0)):
        for x in (-0.55, 0.55):
            lib.torus(g, SLATE, (x, 0.34, 0), R=0.3, r=0.035, seg=14, mseg=3, rot=(math.pi / 2, 0, 0))
            cyl(g, 'c_c9cede', (x, 0.34, 0), r1=0.04, h=0.1, verts=6, rot=(math.pi / 2, 0, 0))
        fr = 'c_6cc6a8'
        for p, q in (((-0.55, 0.34, 0), (-0.05, 0.36, 0)), ((-0.55, 0.34, 0), (-0.18, 0.75, 0)), ((-0.05, 0.36, 0), (-0.2, 0.8, 0)),
                     ((-0.05, 0.36, 0), (0.42, 0.78, 0)), ((-0.18, 0.75, 0), (0.42, 0.78, 0)), ((0.42, 0.78, 0), (0.55, 0.34, 0)), ((0.42, 0.78, 0), (0.38, 0.95, 0))):
            tube(g, fr, [p, q], 0.025, verts=4)
        box(g, SLATE, (-0.22, 0.84, 0), (0.22, 0.05, 0.12), bevel=0.02)
        tube(g, SLATE, [(0.38, 0.95, -0.25), (0.38, 0.95, 0.25)], 0.02, verts=4)
        with at((0.62, 0.78, 0)):
            box(g, WOOD_L, (0, 0, 0), (0.25, 0.18, 0.3))
            ico(g, 'c_f28aa0', (0, 0.12, 0.05), r=0.06, subdiv=1)
            ico(g, LEAF, (0.02, 0.1, -0.06), r=0.07, subdiv=1)


def mailbox():
    """Yellow post box on a post (~1.3 high)."""
    g = 'mailbox'
    lathe(g, SLATE, (0, 0, 0), [(0.08, 0), (0.05, 0.08), (0.04, 0.85)], verts=6)
    with at((0, 0.85, 0)):
        box(g, 'c_f2c94c', (0, 0.18, 0), (0.42, 0.36, 0.3), bevel=0.02)
        cyl(g, 'c_f2c94c', (0, 0.36, 0), r1=0.15, h=0.42, verts=10, rot=(0, 0, math.pi / 2), )
        box(g, SLATE, (0, 0.3, -0.155), (0.24, 0.035, 0.02))
        lathe(g, SLATE, (0, 0.14, -0.16), [(0.06, -0.01), (0.06, 0.01)], verts=8, rot=(math.pi / 2, 0, 0))
        box(g, WHITE, (0, 0.05, -0.155), (0.18, 0.06, 0.01))


PROPS = (house2, house3, station, wagon, treeround, hedge, streetlamp, flowerbox, kiosk, marketstall, cityshop, bridgestone, bushround, bike, mailbox)

if __name__ == '__main__':
    import propkit

    propkit.build('props_city.glb', PROPS, ao_opts={'bridgestone': {'ground': None}, 'station': {'samples': 12}})
