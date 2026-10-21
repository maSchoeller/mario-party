"""Audio post-processing with Blender's audaspace (no ffmpeg install needed).

Usage: blender -b -P audio.py -- --root <repo>

  music  assets-src/music/<key>.mp3   -> public/media/audio/music/<key>.mp3  (loudness-matched, 112 kbps)
  jingle assets-src/music/jingle_*.mp3 -> public/media/audio/sfx/<key>.mp3   (onset trimmed, ≤ 4 s, faded)
  voice  assets-src/voice/<id>.mp3     -> public/media/audio/voice/<id>.mp3  (silence trimmed, normalized, mono 64 kbps)
  sfx    assets-src/sfx/<key>.mp3      -> public/media/audio/sfx/<key>.mp3   (silence trimmed, normalized)
Existing outputs that are newer than their source are skipped.
"""

import glob
import os
import sys

import aud
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
ROOT = argv[argv.index('--root') + 1] if '--root' in argv else os.getcwd()
SRC = os.path.join(ROOT, 'assets-src')
PUB = os.path.join(ROOT, 'apps', 'web', 'public', 'media', 'audio')


def load(path):
    s = aud.Sound(path)
    rate = int(s.specs[0])
    return s.data().astype(np.float32), rate


def rms_db(x):
    r = float(np.sqrt(np.mean(np.square(x)) + 1e-12))
    return 20 * np.log10(r)


def gain_to(x, target_db, peak=0.95):
    g = 10 ** ((target_db - rms_db(x)) / 20)
    p = float(np.max(np.abs(x))) * g
    if p > peak:
        g *= peak / p
    return x * g


def trim(x, rate, thresh_db=-42, pad=0.03):
    env = np.max(np.abs(x), axis=1)
    idx = np.where(env > 10 ** (thresh_db / 20))[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] - int(pad * rate))
    b = min(len(x), idx[-1] + int(pad * 2 * rate))
    return x[a:b]


def fade(x, rate, fin=0.005, fout=0.02):
    n_in, n_out = max(1, int(fin * rate)), max(1, int(fout * rate))
    x = x.copy()
    x[:n_in] *= np.linspace(0, 1, n_in)[:, None]
    x[-n_out:] *= np.linspace(1, 0, n_out)[:, None]
    return x


def write(x, rate, out, bitrate, mono=False):
    if mono and x.shape[1] > 1:
        x = x.mean(axis=1, keepdims=True)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    snd = aud.Sound.buffer(np.ascontiguousarray(x, dtype=np.float32), rate)
    channels = aud.CHANNELS_MONO if x.shape[1] == 1 else aud.CHANNELS_STEREO
    snd.write(out, rate, channels, aud.FORMAT_S16, aud.CONTAINER_MP3, aud.CODEC_MP3, bitrate)
    print(f'[audio] {os.path.relpath(out, ROOT)} {len(x) / rate:.2f}s')


def fresh(src, out):
    return os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src)


def music():
    for src in sorted(glob.glob(os.path.join(SRC, 'music', '*.mp3'))):
        key = os.path.basename(src)[:-4]
        if '.alt' in key:
            continue
        if key.startswith('jingle_'):
            out = os.path.join(PUB, 'sfx', f'{key}.mp3')
            if fresh(src, out):
                continue
            x, rate = load(src)
            x = trim(x, rate, -36)
            # cut after the main hit decays: ≤ 4 s, then fade out
            x = x[: int(4.0 * rate)]
            x = fade(gain_to(x, -16), rate, 0.003, 0.6)
            write(x, rate, out, 128)
        else:
            out = os.path.join(PUB, 'music', f'{key}.mp3')
            if fresh(src, out):
                continue
            x, rate = load(src)
            x = fade(gain_to(trim(x, rate, -50, 0.0), -17), rate, 0.01, 0.05)
            write(x, rate, out, 112)


def loopify(x, rate, xf=1.2):
    """Seamless loop: the tail is crossfaded (equal power) into the head."""
    n = min(int(xf * rate), len(x) // 3)
    k = np.linspace(0, 1, n)[:, None]
    out = x[:-n].copy()
    out[:n] = x[:n] * np.sin(k * np.pi / 2) + x[-n:] * np.cos(k * np.pi / 2)
    return out


def short(kind, target_db, bitrate, mono):
    for src in sorted(glob.glob(os.path.join(SRC, kind, '*.mp3'))):
        out = os.path.join(PUB, kind, os.path.basename(src))
        if fresh(src, out):
            continue
        x, rate = load(src)
        if os.path.basename(src).startswith('amb_'):
            # ambience beds (v0.4): quieter, no trimming/fades, seamless loop point
            x = gain_to(loopify(x, rate), -22)
            write(x, rate, out, 96, mono)
            continue
        x = fade(gain_to(trim(x, rate), target_db), rate)
        write(x, rate, out, bitrate, mono)


music()
short('voice', -16, 96, True)
short('sfx', -17, 96, False)
