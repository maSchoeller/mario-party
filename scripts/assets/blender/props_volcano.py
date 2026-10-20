"""Volcano prop library (Vulkan-Krater): props_volcano.glb.

Usage: blender -b -P props_volcano.py -- --out <dir> [--only id,id]
Conventions as in props.py (Babylon space, ground y = 0, front = -Z, "<prop>__<material>").
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import beam, box, cone, cyl, ico, lathe, prism, shade, tone, tube, vgrad  # noqa: E402
from propkit import (  # noqa: E402
    CREAM, GLASS, GOLD, METAL, R, ROPE, SLATE, WOOD, WOOD_D, WOOD_L,
    arch_bridge_body, at, barrel, blob, boulder, crate, deck_y, lantern_head, lashing, leaf, lerp, plank, post, rope, sack,
)

TAU = math.tau
BASALT = 'c_5a4a5e'
ASH = 'c_8d7f86'
TSTONE = 'c_d4c1b5'
BONE = 'c_f3ead8'
LAVA = 'glow_ff7a3d'
EMBER = 'glow_ffb347'


def lavarock():
    """Dark basalt rock split by glowing lava cracks (~1.4)."""
    g = 'lavarock'
    ico(g, LAVA, (0, 0.4, 0), r=0.5, scale=(1.0, 0.9, 1.0), subdiv=2)
    chunks = ((-0.32, 0.36, -0.12, 0.42, 0.42, 0.5), (0.3, 0.33, -0.18, 0.4, 0.38, 0.42), (0.02, 0.36, 0.33, 0.5, 0.4, 0.34), (0.05, 0.78, 0.0, 0.36, 0.2, 0.36))
    for k, (x, y, z, sx, sy, sz) in enumerate(chunks):
        boulder(g, BASALT, (x * 1.15, y, z * 1.15), size=(sx, sy * 1.05, sz), seed=100 + k, subdiv=2, rough=0.22, sink=0.05)


def crystal():
    """Crystal cluster on a basalt base, lavender with glowing shards."""
    g = 'crystal'
    boulder(g, BASALT, (0, 0.1, 0), size=(0.75, 0.25, 0.65), seed=110, subdiv=2, rough=0.2)
    rr = R(111)
    spec = ((0, 1.9, 0.26, 0, 0), (0.35, 1.2, 0.2, 0.35, 0.2), (-0.35, 1.4, 0.22, -0.4, 0.1), (0.1, 0.9, 0.17, 0.2, -0.45), (-0.2, 0.7, 0.15, -0.3, 0.45), (0.45, 0.6, 0.13, 0.6, -0.2))
    for k, (x, h, r, tx, tz) in enumerate(spec):
        mat = 'c_c3a6f5' if k % 3 else 'glow_d9b8ff'
        z = rr.uniform(-0.2, 0.2)
        o = lathe(g, mat, (x, 0.05, z), [(r * 0.85, 0), (r, h * 0.1), (r * 0.92, h * 0.72), (0, h)], verts=6, rot=(tz * 0.7, k * 0.9, -tx * 0.7), phase=k)
        vgrad(o, 0.7, 1.0)
    for k in range(4):
        a = k / 4 * TAU + 0.5
        lathe(g, 'glow_d9b8ff', (math.cos(a) * 0.62, 0.0, math.sin(a) * 0.5), [(0.06, 0), (0, 0.28)], verts=4, rot=(math.sin(a) * 0.5, 0, -math.cos(a) * 0.5))


def mushroom():
    """Giant mushroom (~2.2 high) with spotted cap + two little ones."""
    g = 'mushroom'

    def shroom(x, z, h, R0, lean, seed):
        top = (x + lean[0], h, z + lean[1])
        tube(g, 'c_f3e6d6', [(x, -0.05, z), (x, h * 0.3, z), (x + lean[0] * 0.6, h * 0.75, z + lean[1] * 0.6), top], [R0 * 0.32, R0 * 0.24, R0 * 0.2, R0 * 0.22], verts=8)
        lathe(g, 'c_f3e6d6', (x, h * 0.62, z), [(R0 * 0.2, 0), (R0 * 0.34, 0.05), (R0 * 0.21, 0.1)], verts=8)
        lathe(g, 'c_e9c4a8', top, [(R0 * 0.25, -0.02), (R0 * 0.95, 0.06), (R0 * 0.95, 0.1), (0, 0.1)], verts=14)
        cap = lathe(g, 'c_ef8a6a', top, [(R0, 0.05), (R0 * 1.02, 0.15), (R0 * 0.85, R0 * 0.48), (R0 * 0.5, R0 * 0.72), (0, R0 * 0.8)], verts=14)
        lib.noisify(cap, R0 * 0.04, 2, seed)
        vgrad(cap, 0.85, 1.0)
        rr = R(seed)
        for k in range(7 if R0 > 0.5 else 3):
            a = rr.uniform(0, TAU)
            t = rr.uniform(0.25, 0.8)
            rad = R0 * (0.98 - 0.55 * t * t)
            yy = 0.15 + R0 * 0.62 * t
            ico(g, 'c_fff4e0', (top[0] + math.cos(a) * rad, top[1] + yy, top[2] + math.sin(a) * rad), r=R0 * 0.13, scale=(1, 0.45, 1), subdiv=1)

    shroom(0, 0, 1.6, 0.9, (0.15, -0.1), 3)
    shroom(0.8, 0.45, 0.55, 0.32, (0.08, 0.05), 4)
    shroom(-0.65, -0.55, 0.4, 0.24, (-0.05, -0.05), 5)
    for k in range(3):
        a = k * 2.1
        boulder(g, BASALT, (math.cos(a) * 0.55, 0.05, math.sin(a) * 0.55), size=(0.14, 0.1, 0.12), seed=120 + k, subdiv=1, rough=0.1)


def vent():
    """Steam vent crater (~1.5) with glowing throat and rising puffs."""
    g = 'vent'
    ring = [(math.cos(a) * 0.55, 0.12 + 0.05 * math.sin(a * 3), math.sin(a) * 0.55) for a in [k / 12 * TAU for k in range(13)]]
    rim = tube(g, ASH, ring, [0.24] * 13, verts=5)
    lib.noisify(rim, 0.06, 3, 6)
    lib.flatten(rim, 0.0, 0.05)
    lathe(g, 'c_3b3446', (0, 0, 0), [(0.6, -0.05), (0.55, 0.12), (0.3, 0.02), (0, -0.05)], verts=10)
    lathe(g, LAVA, (0, 0, 0), [(0.22, 0.0), (0.24, 0.04), (0, 0.05)], verts=8)
    for k, (y, r, dx) in enumerate(((0.4, 0.36, 0.0), (0.72, 0.33, 0.12), (1.0, 0.27, -0.05), (1.3, 0.22, 0.1), (1.5, 0.14, 0.2))):
        blob(g, 'c_f4eef0', (dx, y, 0.05 * k), r=r, scale=(1.1, 0.8, 1), seed=130 + k, subdiv=2, rough=0.12, lo=0.85)
    for k in range(5):
        a = k * 1.3 + 0.2
        boulder(g, BASALT, (math.cos(a) * 0.9, 0.06, math.sin(a) * 0.9), size=(0.16, 0.11, 0.14), seed=140 + k, subdiv=1, rough=0.1)


def stonebridge():
    """Stone arch bridge (same contract as island 'bridge'): deck along Z, 7 long x 2.4 wide,
    origin at its center, deck top y = 0.45 at the center, 0.30 at the ends."""
    g = 'stonebridge'
    st = 'c_b8a9a6'
    arch_bridge_body(g, st, 'c_a8999a', 'c_cbbfb8')
    rr = R(151)
    for sx in (-1, 1):
        for i in range(10):
            z0, z1 = -3.5 + i * 0.7, -3.5 + (i + 1) * 0.7
            o = beam(g, st, (sx * 1.08, deck_y(z0) + 0.22, z0 + 0.02), (sx * 1.08, deck_y(z1) + 0.22, z1 - 0.02), width=0.24, thick=0.5)
            tone(o, rr.uniform(0.85, 1.0))
            beam(g, 'c_cbbfb8', (sx * 1.08, deck_y(z0) + 0.5, z0), (sx * 1.08, deck_y(z1) + 0.5, z1), width=0.3, thick=0.07)
        for z in (-3.45, 3.45):
            box(g, st, (sx * 1.08, deck_y(z) + 0.4, z), (0.34, 0.85, 0.34), bevel=0.03)
            lathe(g, EMBER, (sx * 1.08, deck_y(z) + 0.85, z), [(0.1, 0), (0.12, 0.1), (0, 0.28)], verts=5)


def cablestation():
    """Cable car station (~4 x 3). The cable leaves the bull wheel at (0, 4.0, 0) –
    the board's cable endpoint (field position + 4 m)."""
    g = 'cablestation'
    box(g, 'c_b8a9a6', (0, 0.35, 0.2), (4.0, 0.7, 3.0), bevel=0.04)
    for k in range(3):
        box(g, 'c_b8a9a6', (0, 0.12 + k * 0.23 - 0.12, -1.45 - 0.3 * (2 - k)), (1.4, 0.23 * (k + 1), 0.3))
    for k in range(8):
        plank(g, WOOD_L, (-1.9, 0.73, -1.2 + k * 0.38 + 0.19), (1.9, 0.73, -1.2 + k * 0.38 + 0.19), w=0.36, t=0.05, seed=k)
    # steel frame: four legs + cross beams, bull wheel under the roof
    for sx in (-1, 1):
        for sz in (-1, 1):
            box(g, METAL, (sx * 1.7, 2.6, 0.2 + sz * 1.2), (0.16, 3.8, 0.16))
        beam(g, METAL, (sx * 1.7, 0.8, -1.0), (sx * 1.7, 4.3, 1.4), width=0.08, thick=0.06, up=(1, 0, 0))
    for sz in (-1, 1):
        box(g, METAL, (0, 4.45, 0.2 + sz * 1.2), (3.6, 0.14, 0.14))
    box(g, METAL, (0, 4.45, 0.2), (0.16, 0.14, 2.6))
    cyl(g, METAL, (0, 4.25, 0.2), r1=0.08, h=0.5, verts=6)
    lathe(g, 'c_e8676b', (0, 3.92, 0.2), [(0.95, -0.08), (1.0, 0), (0.95, 0.08)], verts=16)
    for k in range(6):
        a = k / 6 * math.pi
        beam(g, METAL, (math.cos(a) * 0.95, 3.92, 0.2 + math.sin(a) * 0.95), (-math.cos(a) * 0.95, 3.92, 0.2 - math.sin(a) * 0.95), width=0.06, thick=0.05)
    cyl(g, GOLD, (0, 3.92, 0.2), r1=0.15, h=0.14, verts=8)
    # gable roof (tint)
    from propkit import gable_roof
    gable_roof(g, 'tint', (0, 4.55, 0.2), 3.8, 2.9, 0.9, over=0.2, thick=0.1, rows=3, ridge=SLATE, seed=5)
    # operator booth at the back with window + lantern, sign, bench
    box(g, CREAM, (1.2, 1.5, 1.25), (1.1, 1.5, 0.9), bevel=0.03)
    box(g, GLASS, (1.2, 1.7, 0.78), (0.7, 0.45, 0.04))
    box(g, WOOD_D, (1.2, 1.44, 0.75), (0.8, 0.06, 0.1))
    box(g, SLATE, (1.2, 2.3, 1.25), (1.3, 0.1, 1.1))
    lantern_head(g, (-1.7, 2.2, -1.0), s=0.8)
    box(g, WOOD, (-1.0, 3.5, -1.05), (1.3, 0.4, 0.06), bevel=0.02)
    lathe(g, 'tint', (-1.0, 3.38, -1.1), [(0.1, 0), (0.1, 0.15), (0.06, 0.25), (0, 0.27)], verts=6)
    for k in range(2):
        plank(g, WOOD, (-1.6, 1.15 + k * 0.01, 0.8 + k * 0.15), (-0.4, 1.15 + k * 0.01, 0.8 + k * 0.15), w=0.14, t=0.05, seed=k)
    for x in (-1.5, -0.5):
        box(g, METAL, (x, 0.95, 0.88), (0.06, 0.4, 0.3))


def gondola():
    """Cable car cabin (~1.4). ORIGIN = cable clamp at the top; the cabin hangs below
    (cabin center at y = -1.35, bottom at y = -1.95)."""
    g = 'gondola'
    box(g, SLATE, (0, 0.0, 0), (0.16, 0.14, 0.42))
    for sz in (-1, 1):
        cyl(g, METAL, (0, 0.1, sz * 0.18), r1=0.09, h=0.08, verts=8, rot=(0, 0, math.pi / 2))
    tube(g, METAL, [(0, -0.05, 0), (0, -0.35, 0), (0.05, -0.55, 0)], 0.04, verts=5)
    box(g, METAL, (0, -0.62, 0), (0.6, 0.06, 0.08))
    with at((0, -1.35, 0)):
        box(g, 'tint', (0, -0.42, 0), (1.25, 0.36, 1.05), bevel=0.05)
        box(g, 'tint', (0, 0.42, 0), (1.25, 0.18, 1.05), bevel=0.04)
        for sx in (-1, 1):
            for sz in (-1, 1):
                box(g, 'tint', (sx * 0.58, 0.05, sz * 0.48), (0.1, 0.6, 0.1))
        box(g, GLASS, (0, 0.05, 0), (1.1, 0.56, 0.92))
        lathe(g, SLATE, (0, 0.5, 0), [(0.6, 0), (0.55, 0.08), (0.25, 0.16), (0, 0.18)], verts=8, phase=math.pi / 8, scale=(1.05, 1, 0.9))
        box(g, GOLD, (0, -0.25, -0.53), (1.0, 0.05, 0.02))
        box(g, CREAM, (0, -0.42, -0.535), (0.3, 0.16, 0.02))


def temple():
    """Ancient temple ruin landmark (~6 wide, ~5 deep); stairs at the front (-Z)."""
    g = 'temple'
    rr = R(160)
    tiers = ((6.0, 5.0, 0.0), (5.0, 4.2, 0.5), (4.1, 3.5, 1.0))
    for w, d, y in tiers:
        o = box(g, TSTONE, (0, y + 0.25, 0.2), (w, 0.5, d), bevel=0.04)
        for k in range(int(w / 0.75)):
            b = box(g, 'c_c7b3a6', (-w / 2 + 0.375 + k * 0.75, y + 0.25, 0.2 - d / 2 - 0.02), (0.7, 0.44, 0.04))
            tone(b, rr.uniform(0.85, 1.0))
    for k in range(6):
        box(g, 'c_c7b3a6', (0, 0.125 + k * 0.25, -2.55 + k * 0.25 + 0.3), (1.6, 0.25, 0.5))
    for sx in (-1, 1):
        beam(g, TSTONE, (sx * 0.95, 0.1, -3.0 + 0.3), (sx * 0.95, 1.6, -1.5 + 0.3), width=0.3, thick=0.3, up=(0, 1, -1))
    flute = lambda a, j: 1.0 if round(a / TAU * 12) % 2 else 0.88
    H = 1.5
    cols = [(x, z) for z in (-0.9, 0.9) for x in (-1.6, 0.0, 1.6)]
    for k, (x, z) in enumerate(cols):
        broken = k in (2, 3)
        h = 2.4 if not broken else (1.2 if k == 2 else 0.7)
        box(g, TSTONE, (x, H + 0.12, z + 0.2), (0.62, 0.24, 0.62), bevel=0.03)
        y = H + 0.24
        j = 0
        while y < H + h - 0.01:
            dh = min(0.6, H + h - y)
            o = lathe(g, TSTONE, (x, y, z + 0.2), [(0.24, 0), (0.22, dh)], verts=12, rfn=flute, phase=j * 0.25)
            tone(o, 0.9 + 0.1 * (j % 2))
            y += dh + 0.01
            j += 1
        if broken:
            o = lathe(g, TSTONE, (x, y, z + 0.2), [(0.22, 0), (0.2, 0.12), (0.08, 0.22)], verts=7)
            lib.noisify(o, 0.05, 4, k)
        else:
            box(g, TSTONE, (x, y + 0.12, z + 0.2), (0.6, 0.24, 0.6), bevel=0.03)
    # lintels on the intact columns + broken pediment
    top = H + 2.4 + 0.24
    box(g, TSTONE, (-0.8, top + 0.2, -0.7), (2.4, 0.4, 0.7), bevel=0.03)
    box(g, TSTONE, (0.8, top + 0.2, 1.1), (2.4, 0.4, 0.7), bevel=0.03)
    box(g, TSTONE, (-1.6, top + 0.2, 0.2), (0.7, 0.4, 2.5), bevel=0.03)
    prism(g, 'c_c7b3a6', (-0.8, top + 0.4, -0.7), [(-1.2, 0), (0.6, 0), (0.3, 0.45), (-0.3, 0.75), (-0.6, 0.6)], 0.6)
    # inner sanctum wall with glowing lava emblem
    box(g, 'c_c7b3a6', (0, H + 1.0, 1.65), (3.0, 2.0, 0.4), bevel=0.03)
    lib.torus(g, LAVA, (0, H + 1.2, 1.42), R=0.42, r=0.07, seg=14, mseg=4, rot=(math.pi / 2, 0, 0))
    star = [(math.cos(a) * (0.25 if k % 2 == 0 else 0.1), math.sin(a) * (0.25 if k % 2 == 0 else 0.1)) for k, a in enumerate([math.pi / 2 + k * math.pi / 5 for k in range(10)])]
    prism(g, LAVA, (0, H + 1.2, 1.43), star, 0.05)
    # braziers on the stairs, fallen blocks + drum, ash plants
    for sx in (-1, 1):
        with at((sx * 1.25, 1.0, -1.45)):
            lathe(g, SLATE, (0, 0, 0), [(0.18, 0), (0.12, 0.3), (0.28, 0.5), (0.3, 0.58), (0.22, 0.55)], verts=8)
            lathe(g, EMBER, (0, 0.5, 0), [(0.2, 0), (0.18, 0.15), (0, 0.45)], verts=6)
    lathe(g, TSTONE, (2.2, 0.25, -2.0), [(0.22, -0.4), (0.2, 0.4)], verts=12, rot=(0, 0.4, math.pi / 2), rfn=flute)
    for k, (x, z, s) in enumerate(((-2.6, -2.2, 0.45), (2.8, 1.8, 0.5), (-2.9, 2.2, 0.35), (1.0, -2.8, 0.3))):
        o = box(g, TSTONE, (x, s / 2, z), (s * 1.4, s, s), rot=(0, rr.uniform(0, 1), 0), bevel=0.03)
        tone(o, 0.9)
    for x, z in ((-2.4, -1.9), (2.6, -1.2), (-1.9, 2.5)):
        for k in range(5):
            leaf(g, 'c_a99bb8', (x, 0.0, z), k / 5 * TAU + x, length=0.5, width=0.07, rise=0.55, droop=0.2, segs=2, fold=0.3, pitch=0.9)


def bones():
    """Dino skeleton fragment: ribcage arching out of the ground + a grinning skull."""
    g = 'bones'
    spine = [(-1.6, 0.3, 0.2), (-0.9, 0.95, 0.1), (0.0, 1.25, 0.0), (0.9, 1.0, -0.05), (1.6, 0.35, 0.0)]
    tube(g, BONE, [(-2.0, -0.1, 0.25)] + spine + [(2.0, -0.1, 0.0)], 0.1, verts=6)
    for k in range(9):
        t = (k + 1) / 10
        x = lerp(-1.8, 1.8, t)
        y = 1.25 * math.sin(math.pi * t) * 0.95 + 0.1
        ico(g, BONE, (x, y + 0.08, 0.05), r=0.11, scale=(0.8, 1.2, 0.9), subdiv=1)
    for k in range(5):
        x = -1.0 + k * 0.5
        y = 1.25 * math.sin(math.pi * (x + 1.8) / 3.6) * 0.95 + 0.05
        for s in (-1, 1):
            rib = [(x, y, 0.0), (x + 0.05, y + 0.1, s * 0.5), (x + 0.1, y * 0.55, s * 0.85), (x + 0.12, -0.1, s * 0.85)]
            tube(g, BONE, rib, [0.07, 0.065, 0.055, 0.05], verts=5)
    # skull resting in front, slightly turned
    with at((2.0, 0, -1.2), (0, -0.6, 0)):
        sk = ico(g, BONE, (0, 0.38, 0), r=0.45, scale=(1.3, 0.85, 0.95), subdiv=2)
        lib.noisify(sk, 0.03, 3, 2)
        box(g, BONE, (0.55, 0.25, 0), (0.6, 0.28, 0.6), bevel=0.06)
        box(g, BONE, (0.45, 0.06, 0), (0.75, 0.12, 0.55), bevel=0.04)
        for s in (-1, 1):
            ico(g, 'c_3b3446', (0.05, 0.52, s * 0.36), r=0.13, subdiv=1)
            for k in range(3):
                cone(g, 'c_fffaf0', (0.35 + k * 0.17, 0.12, s * 0.24), r=0.05, h=0.14, verts=4, rot=(math.pi, 0, 0))
        ico(g, 'c_3b3446', (0.86, 0.3, 0), r=0.06, subdiv=1)
    for k in range(4):
        a = k * 1.7
        boulder(g, ASH, (math.cos(a) * 1.4, 0.04, math.sin(a) * 0.9 + 0.3), size=(0.18, 0.1, 0.15), seed=170 + k, subdiv=1, rough=0.1)


def minecart():
    """Mine cart on a short rail segment (rails along Z, 2.4 long) loaded with glowing ore."""
    g = 'minecart'
    for k in range(4):
        o = box(g, WOOD_D, (0, 0.05, -0.9 + k * 0.6), (1.3, 0.1, 0.22))
        tone(o, 0.9 + 0.1 * (k % 2))
    for sx in (-1, 1):
        box(g, METAL, (sx * 0.45, 0.14, 0), (0.08, 0.1, 2.4))
    with at((0, 0.18, 0)):
        for sx in (-1, 1):
            for sz in (-1, 1):
                cyl(g, SLATE, (sx * 0.45, 0.2, sz * 0.4), r1=0.2, h=0.08, verts=10, rot=(0, 0, math.pi / 2))
                cyl(g, GOLD, (sx * 0.5, 0.2, sz * 0.4), r1=0.06, h=0.04, verts=6, rot=(0, 0, math.pi / 2))
        prism(g, WOOD, (0, 0.3, 0), [(-0.45, 0), (0.45, 0), (0.6, 0.6), (-0.6, 0.6)], 1.2)
        for k in range(3):
            box(g, WOOD_D, (0, 0.55, -0.6 + k * 0.6), (1.28, 0.08, 0.03))
        for sx in (-1, 1):
            beam(g, METAL, (sx * 0.47, 0.32, -0.62), (sx * 0.61, 0.9, -0.62), width=0.07, thick=0.04, up=(0, 0, -1))
            beam(g, METAL, (sx * 0.47, 0.32, 0.62), (sx * 0.61, 0.9, 0.62), width=0.07, thick=0.04, up=(0, 0, 1))
        for sz in (-1, 1):
            box(g, METAL, (0, 0.9, sz * 0.61), (1.3, 0.07, 0.07))
        for sx in (-1, 1):
            box(g, METAL, (sx * 0.61, 0.9, 0), (0.07, 0.07, 1.29))
        rr = R(180)
        for k in range(9):
            x, z = rr.uniform(-0.38, 0.38), rr.uniform(-0.45, 0.45)
            mat = EMBER if k % 3 == 0 else 'c_3b3446'
            o = ico(g, mat, (x, 0.88 + rr.uniform(0, 0.12), z), r=rr.uniform(0.14, 0.2), subdiv=1)
            lib.jitter(o, 0.03, k)


def cactus():
    """Pastel ribbed cactus with two arms and a blossom (~1.8 high)."""
    g = 'cactus'
    ribs = lambda a, j: 1.0 if round(a / TAU * 16) % 2 else 0.86
    lathe(g, 'c_8fbf8a', (0, 0, 0), [(0.24, -0.05), (0.26, 0.4), (0.25, 1.3), (0.2, 1.65), (0.1, 1.78), (0, 1.8)], verts=16, rfn=ribs)
    for s, (y, h) in ((1, (0.6, 0.6)), (-1, (0.9, 0.45))):
        tube(g, 'c_8fbf8a', [(0, y, 0), (s * 0.4, y + 0.02, 0), (s * 0.5, y + 0.15, 0), (s * 0.5, y + h, 0), (s * 0.5, y + h + 0.12, 0)], [0.13, 0.13, 0.13, 0.12, 0.0], verts=8, phase=0.2)
    lathe(g, 'c_f28aa0', (0, 1.76, 0), [(0, 0), (0.12, 0.06), (0.05, 0.1), (0, 0.06)], verts=10, rfn=lambda a, j: 1.0 if round(a / TAU * 10) % 2 == 0 else 0.6)
    boulder(g, ASH, (0.25, 0.05, -0.2), size=(0.16, 0.1, 0.14), seed=190, subdiv=1, rough=0.1)


def ashplant():
    """Spiky ash-agave with a stalk of glowing seed pods (~1.4 high)."""
    g = 'ashplant'
    rr = R(200)
    for k in range(10):
        a = k / 10 * TAU + rr.uniform(-0.15, 0.15)
        inner = k % 2
        o = leaf(g, 'c_a99bb8', (0, 0.02, 0), a, length=0.6 if inner else 0.75, width=0.12, rise=0.3, droop=0.25 if inner else 0.45, segs=3, fold=0.4, pitch=0.9 if inner else 0.5, lo=0.7)
        tone(o, rr.uniform(0.88, 1.0))
    tube(g, 'c_8d7f86', [(0, 0.1, 0), (0.05, 0.8, 0.0), (0.1, 1.3, 0.05)], [0.04, 0.03, 0.02], verts=4)
    for k in range(4):
        ico(g, EMBER, (0.05 + 0.02 * k, 0.85 + k * 0.14, 0.02 * k), r=0.06, scale=(1, 1.3, 1), subdiv=1)


def camp():
    """Shop tent for the volcano shop field (~3 x 3): canvas in tint, open front flaps."""
    g = 'camp'
    # rug + tent poles
    box(g, 'c_e8a87c', (0, 0.02, -0.2), (2.6, 0.04, 3.0))
    for sx in (-1, 1):
        box(g, 'c_f3d3b0', (sx * 1.15, 0.045, -0.2), (0.15, 0.01, 3.0))
    for z in (-1.3, 1.2):
        post(g, WOOD_D, (0, 0, z), 2.45, r=0.06, verts=5, seed=int(z * 10))
    tube(g, WOOD_D, [(0, 2.4, -1.5), (0, 2.4, 1.3)], 0.05, verts=5)
    # canvas: two sloped panels with a sagging hem + back wall
    for s in (-1, 1):
        for k in range(4):
            z0 = -1.4 + k * 0.7
            o = beam(g, 'tint' if k % 2 == 0 else CREAM, (0, 2.42, z0 + 0.35), (s * 1.45, 0.25, z0 + 0.35), width=0.7, thick=0.05, up=(s * 1.0, 0.75, 0))
        rope(g, ROPE, (s * 1.45, 0.25, -1.4), (s * 1.95, 0.0, -1.8), sag=0.05, r=0.015, n=2)
        rope(g, ROPE, (s * 1.45, 0.25, 1.4), (s * 1.95, 0.0, 1.8), sag=0.05, r=0.015, n=2)
        cone(g, WOOD_D, (s * 1.95, 0.05, -1.8), r=0.04, h=0.12, verts=4, rot=(math.pi, 0, 0))
    prism(g, 'tint', (0, 0.0, 1.35), [(-1.45, 0.25), (1.45, 0.25), (0, 2.4)], 0.05)
    # open front flaps (tied back)
    for s in (-1, 1):
        prism(g, CREAM, (s * 0.95, 0, -1.45), [(-s * 0.55, 1.4), (s * 0.45, 0.25), (s * 0.25, 1.9)], 0.06)
        lashing(g, ROPE, (s * 0.95, 1.05, -1.45), 0.08, h=0.06)
    # shop goods: counter crate, barrel, sacks, potion shelf, lantern, sign
    crate(g, (-0.55, 0, -1.1), s=0.6, yaw=0.1, seed=2)
    crate(g, (0.25, 0, -1.2), s=0.55, yaw=-0.2, seed=3, diag=False)
    for k, col in enumerate(('c_b48cf0', 'c_8fd3ff', 'c_ff9fb8')):
        lathe(g, col, (0.1 + k * 0.17, 0.55, -1.2), [(0.06, 0), (0.08, 0.1), (0.03, 0.17), (0.03, 0.22), (0, 0.23)], verts=6)
    barrel(g, (0.85, 0, 0.3), h=0.8, r=0.3, seed=4)
    sack(g, (-0.8, 0, 0.5), s=0.55, seed=5)
    sack(g, (-0.45, 0, 0.85), s=0.45, seed=6, yaw=1.0)
    with at((0, 2.15, -1.55)):
        lantern_head(g, (0, -0.35, 0), s=0.7, hang=True)
    with at((1.75, 0, -1.6)):
        post(g, WOOD_D, (0, 0, 0), 1.3, r=0.05, verts=5, seed=9)
        box(g, WOOD, (0, 1.2, -0.04), (0.7, 0.36, 0.05), bevel=0.02)
        lathe(g, EMBER, (0, 1.12, -0.09), [(0.07, 0), (0.09, 0.08), (0.03, 0.15), (0, 0.17)], verts=6)
    # small campfire beside the tent
    with at((-1.85, 0, -1.4)):
        for k in range(6):
            a = k / 6 * TAU
            boulder(g, 'c_6a5a62', (math.cos(a) * 0.3, 0.06, math.sin(a) * 0.3), size=(0.11, 0.08, 0.1), seed=210 + k, subdiv=1, rough=0.1)
        for k in range(3):
            a = k / 3 * math.pi
            beam(g, WOOD_D, (math.cos(a) * 0.22, 0.06, math.sin(a) * 0.22), (-math.cos(a) * 0.22, 0.12, -math.sin(a) * 0.22), width=0.07, thick=0.07)
        lathe(g, EMBER, (0, 0.08, 0), [(0.14, 0), (0.12, 0.12), (0, 0.38)], verts=5)


PROPS = (lavarock, crystal, mushroom, vent, stonebridge, cablestation, gondola, temple, bones, minecart, cactus, ashplant, camp)

if __name__ == '__main__':
    import propkit

    propkit.build('props_volcano.glb', PROPS, ao_opts={'stonebridge': {'ground': None}, 'gondola': {'ground': None}, 'temple': {'samples': 12}})
