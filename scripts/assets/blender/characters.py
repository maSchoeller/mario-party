"""Heroes + moderator as rigid-part rigs (ASSET-02, ART-02/03).

Usage: blender -b -P characters.py -- --out <dir>

Each figure is exported as one GLB whose meshes are grouped by rig part:
  body  (pivot 0,0,0)       head (pivot 0,1.15,0)
  armL  (pivot -0.48,0.8,0) armR (pivot 0.48,0.8,0)
The host parents every part to the matching bone node of CharacterRig and keeps the
procedural animations (idle, walk, jump, cheer, sad, hit, roll). Faces -Z (Babylon).
Budget: ≤ 5 000 triangles per figure (ASSET-04).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import beam, box, cone, cyl, ico, uvs  # noqa: E402

HEAD_Y = 1.15
ARM = (0.48, 0.8)


def H(x, y, z):
    """Head-local -> rig space."""
    return (x, HEAD_Y + y, z)


def A(side, x, y, z):
    return (side * ARM[0] + side * x, ARM[1] + y, z)


def arm_name(side):
    return 'armL' if side < 0 else 'armR'


def base_body(c, belly_shape=(1, 1.1, 0.6)):
    ico('body', c['body'], (0, 0.6, 0), r=0.53, scale=(1, 1.05, 0.9), subdiv=3)
    ico('body', c['belly'], (0, 0.6, -0.2), r=0.36, scale=belly_shape, subdiv=2)


def feet(c, color=None, toes=False):
    col = color or c['dark']
    for side in (-1, 1):
        ico('body', col, (side * 0.26, 0.1, -0.14), r=0.19, scale=(1, 0.55, 1.35), subdiv=1)
        if toes:
            for k in (-1, 0, 1):
                ico('body', col, (side * 0.26 + k * 0.09, 0.07, -0.38), r=0.07, scale=(1, 0.6, 1.2), subdiv=1)


def arms(c, color=None, flipper=False):
    col = color or c['body']
    for side in (-1, 1):
        g = arm_name(side)
        if flipper:
            ico(g, col, A(side, 0.04, -0.25, 0), r=0.17, scale=(0.45, 1.6, 0.9), subdiv=2)
        else:
            ico(g, col, A(side, 0.0, -0.17, 0), r=0.15, scale=(0.85, 1.35, 0.85), subdiv=1)
            ico(g, c.get('hand', c['belly']), A(side, 0.02, -0.36, -0.02), r=0.1, subdiv=1)


def eyes(y=0.08, spread=0.17, z=-0.37, size=0.11, pupil='c_1d1b2a', look=-0.07):
    for side in (-1, 1):
        x = side * spread
        ico('head', 'c_ffffff', H(x, y, z), r=size, scale=(1, 1.15, 0.7), subdiv=2)
        ico('head', pupil, H(x * 1.02, y - 0.01, z + look), r=size * 0.58, scale=(1, 1.15, 0.6), subdiv=1)
        ico('head', 'c_ffffff', H(x + 0.03, y + 0.04, z + look - 0.035), r=size * 0.2, subdiv=1)


def cheeks(y=-0.1, spread=0.29, z=-0.33):
    for side in (-1, 1):
        ico('head', 'c_f3a3b0', H(side * spread, y, z), r=0.075, scale=(1, 0.7, 0.35), subdiv=1)


# --- heroes -------------------------------------------------------------------


def rocco():
    c = {'body': 'c_a3a1b0', 'belly': 'c_ecebf2', 'dark': 'c_3d3a4a', 'accent': 'c_6c6a7a', 'hand': 'c_3d3a4a'}
    base_body(c)
    feet(c)
    arms(c)
    ico('head', c['body'], H(0, 0, 0), r=0.46, scale=(1.08, 0.9, 0.95), subdiv=3)
    # white face blaze + bandit mask
    ico('head', c['belly'], H(0, -0.1, -0.24), r=0.3, scale=(1.25, 0.75, 0.7), subdiv=2)
    for side in (-1, 1):
        ico('head', c['dark'], H(side * 0.17, 0.07, -0.33), r=0.17, scale=(1.25, 0.75, 0.5), subdiv=2)
    eyes(y=0.08, z=-0.42, size=0.09)
    ico('head', c['dark'], H(0, -0.06, -0.47), r=0.07, scale=(1.2, 0.8, 0.8), subdiv=1)  # nose
    cheeks(y=-0.14, z=-0.36)
    for side in (-1, 1):
        cone('head', c['accent'], H(side * 0.3, 0.42, 0.02), r=0.15, h=0.3, verts=5, rot=(0, 0, -side * 0.35))
        cone('head', c['belly'], H(side * 0.3, 0.4, -0.04), r=0.08, h=0.18, verts=5, rot=(0, 0, -side * 0.35))
    # ringed tail curving upwards
    for i in range(6):
        t = i / 5
        ico('body', c['dark'] if i % 2 else c['body'], (0, 0.35 + t * 0.75, 0.5 + t * 0.35 - t * t * 0.25),
            r=0.2 - i * 0.012, scale=(1, 0.9, 1), subdiv=1)
    lib.finalize(out('rocco'), 5000)


def quaki():
    c = {'body': 'c_7cc56f', 'belly': 'c_d8efc5', 'dark': 'c_2f4a2b', 'accent': 'c_f2c94c', 'hand': 'c_7cc56f'}
    base_body(c, belly_shape=(1.05, 1.15, 0.55))
    feet({'dark': 'c_6fb262'}, toes=True)
    arms(c)
    # wide flat frog head with eyes on top
    ico('head', c['body'], H(0, -0.05, 0), r=0.5, scale=(1.2, 0.72, 1.0), subdiv=3)
    ico('head', c['belly'], H(0, -0.17, -0.18), r=0.38, scale=(1.3, 0.45, 0.85), subdiv=2)
    for side in (-1, 1):
        ico('head', c['body'], H(side * 0.22, 0.26, -0.12), r=0.18, subdiv=2)
    eyes(y=0.3, spread=0.22, z=-0.24, size=0.13)
    box('head', c['dark'], H(0, -0.13, -0.47), size=(0.46, 0.035, 0.05))
    cheeks(y=-0.08, spread=0.38, z=-0.38)
    # golden crown with gem
    cyl('head', 'glow_f2c94c', H(0, 0.42, 0.05), r1=0.17, r2=0.2, h=0.13, verts=6)
    for i in range(6):
        import math

        a = i / 6 * lib.TAU
        cone('head', 'glow_f2c94c', H(0.17 * math.cos(a), 0.55, 0.05 + 0.17 * math.sin(a)), r=0.05, h=0.12, verts=4)
    ico('head', 'c_e8676b', H(0, 0.43, -0.14), r=0.045, subdiv=1)
    lib.finalize(out('quaki'), 5000)


def pingo():
    c = {'body': 'c_2f3552', 'belly': 'c_f1f0f4', 'dark': 'c_1b1e2e', 'accent': 'c_e8676b'}
    ico('body', c['body'], (0, 0.62, 0), r=0.55, scale=(1, 1.12, 0.92), subdiv=3)
    ico('body', c['belly'], (0, 0.56, -0.2), r=0.42, scale=(0.95, 1.2, 0.62), subdiv=2)
    feet(c, color='c_f4a259', toes=True)
    arms(c, flipper=True)
    ico('head', c['body'], H(0, 0, 0), r=0.44, scale=(1.05, 0.95, 0.95), subdiv=3)
    # white face heart
    for side in (-1, 1):
        ico('head', c['belly'], H(side * 0.13, 0.0, -0.27), r=0.21, scale=(1, 1.2, 0.6), subdiv=2)
    eyes(y=0.05, spread=0.14, z=-0.39, size=0.085)
    cone('head', 'c_f4a259', H(0, -0.09, -0.5), r=0.1, h=0.22, verts=5, rot=(-1.5708, 0, 0))
    cheeks(y=-0.12, spread=0.25, z=-0.34)
    # red scarf with hanging end + bobble hat
    lib.torus('body', c['accent'], (0, 1.0, 0), R=0.37, r=0.09, seg=12, mseg=4, scale=(1, 1, 0.92))
    box('body', c['accent'], (0.22, 0.83, -0.37), size=(0.16, 0.36, 0.06), rot=(0, 0, 0.25))
    cyl('head', c['accent'], H(0, 0.34, 0.02), r1=0.36, r2=0.2, h=0.2, verts=10)
    cyl('head', c['belly'], H(0, 0.25, 0.02), r1=0.4, r2=0.38, h=0.08, verts=10)
    ico('head', c['belly'], H(0, 0.5, 0.02), r=0.1, subdiv=1)
    lib.finalize(out('pingo'), 5000)


def foxy():
    c = {'body': 'c_f0a050', 'belly': 'c_fbf1e4', 'dark': 'c_3a2a22', 'accent': 'c_f6c08a', 'hand': 'c_3a2a22'}
    base_body(c)
    feet(c)
    arms(c)
    ico('head', c['body'], H(0, 0.02, 0), r=0.45, scale=(1.12, 0.92, 0.95), subdiv=3)
    # pointed white muzzle + cheek fluff
    cone('head', c['belly'], H(0, -0.1, -0.42), r=0.2, h=0.32, verts=6, scale=(1.25, 1, 0.75), rot=(-1.5708, 0, 0))
    for side in (-1, 1):
        cone('head', c['belly'], H(side * 0.38, -0.1, -0.1), r=0.12, h=0.25, verts=4, rot=(0, 0, side * 1.9))
    ico('head', c['dark'], H(0, -0.06, -0.6), r=0.06, subdiv=1)
    eyes(y=0.08, spread=0.17, z=-0.39, size=0.095, pupil='c_3a2a22')
    cheeks(y=-0.07, spread=0.3, z=-0.33)
    for side in (-1, 1):
        cone('head', c['body'], H(side * 0.26, 0.48, 0.02), r=0.17, h=0.45, verts=4, rot=(0, 0, -side * 0.22))
        cone('head', c['dark'], H(side * 0.3, 0.66, 0.02), r=0.07, h=0.15, verts=4, rot=(0, 0, -side * 0.22))
        cone('head', c['belly'], H(side * 0.25, 0.44, -0.05), r=0.09, h=0.26, verts=4, rot=(0, 0, -side * 0.22))
    # big bushy tail with white tip
    ico('body', c['body'], (0, 0.5, 0.62), r=0.3, scale=(0.95, 0.9, 1.45), subdiv=2, rot=(-0.6, 0, 0))
    ico('body', c['body'], (0, 0.82, 0.92), r=0.26, scale=(1, 1, 1.1), subdiv=2)
    ico('body', c['belly'], (0, 1.02, 1.05), r=0.2, subdiv=2)
    lib.finalize(out('foxy'), 5000)


def moderator():
    """Käpt’n Plapperschnabel – parrot captain."""
    c = {'body': 'c_5cc08a', 'belly': 'c_f2c94c', 'dark': 'c_2b2b3a', 'accent': 'c_e8676b'}
    base_body(c, belly_shape=(0.95, 1.2, 0.6))
    feet({'dark': 'c_f4a259'}, toes=True)
    for side in (-1, 1):
        g = arm_name(side)
        ico(g, c['body'], A(side, 0.04, -0.24, 0.02), r=0.17, scale=(0.5, 1.6, 1), subdiv=2)
        ico(g, 'c_5f8fe0', A(side, 0.05, -0.42, 0.05), r=0.12, scale=(0.5, 1.2, 0.9), subdiv=1)
        ico(g, c['accent'], A(side, 0.05, -0.55, 0.07), r=0.08, scale=(0.5, 1.1, 0.8), subdiv=1)
    # tail feathers
    for k, col in enumerate((c['accent'], 'c_5f8fe0', c['body'])):
        beam('body', col, ((k - 1) * 0.08, 0.45, 0.4), ((k - 1) * 0.25, 0.12, 0.95), width=0.12, thick=0.05)
    ico('head', c['body'], H(0, 0, 0), r=0.44, scale=(1.0, 0.95, 1.0), subdiv=3)
    for side in (-1, 1):
        ico('head', 'c_ffffff', H(side * 0.17, 0.05, -0.28), r=0.17, scale=(1, 1.1, 0.6), subdiv=2)
    eyes(y=0.06, spread=0.17, z=-0.4, size=0.08)
    # curved beak: upper hook + lower jaw
    ico('head', c['belly'], H(0, -0.03, -0.45), r=0.12, scale=(0.85, 1.0, 1.2), subdiv=2)
    cone('head', c['belly'], H(0, -0.12, -0.55), r=0.06, h=0.14, verts=5, rot=(3.1, 0, 0))
    ico('head', 'c_d9a62e', H(0, -0.15, -0.42), r=0.08, scale=(0.9, 0.6, 1), subdiv=1)
    # captain hat (tricorne-ish) with gold emblem + feather crest
    cyl('head', 'c_3d3a55', H(0, 0.36, 0.03), r1=0.5, r2=0.48, h=0.07, verts=3, rot=(0, 3.1416, 0))
    cyl('head', 'c_3d3a55', H(0, 0.48, 0.03), r1=0.3, r2=0.24, h=0.24, verts=8)
    ico('head', 'glow_f2c94c', H(0, 0.48, -0.25), r=0.07, scale=(1, 1, 0.4), subdiv=1)
    for i, col in enumerate(('c_5f8fe0', c['accent'], 'c_5f8fe0')):
        cone('head', col, H((i - 1) * 0.1, 0.7, 0.12), r=0.06, h=0.38, verts=4, rot=(0.3, 0, (1 - i) * 0.35))
    lib.finalize(out('moderator'), 5000)


OUT = lib.arg('out', '.')


def out(name):
    os.makedirs(OUT, exist_ok=True)
    return os.path.join(OUT, f'{name}.glb')


only = lib.arg('only')
for fn in (rocco, quaki, pingo, foxy, moderator):
    if only and fn.__name__ != only:
        continue
    lib.reset()
    lib._mats.clear()
    fn()
