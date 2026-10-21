import type { CharacterId } from '@wb/shared/config';
import { t, type Params } from '@wb/shared/i18n/index';
import { clipFile, numberClip, voiceClips } from '@wb/shared/i18n/voice';
import type { MgSfx } from '@wb/shared/minigames/types';
import type { AmbienceKey } from './render/mgScenery';

/**
 * Host audio (AUDIO-05: audio only on the host). Generated assets in public/media/audio
 * (scripts/assets, see docs/ASSETS_LICENSES.md):
 *  - music (Suno): one loop per map + finale variant, lobby, 3 minigame moods, victory;
 *    streamed via <audio> and looped with a crossfade (AUDIO-01)
 *  - jingles (Suno) + SFX (ElevenLabs), decoded once (AUDIO-02)
 *  - moderator voice (ElevenLabs): few whole lines at the big moments + dice numbers,
 *    everything else is subtitle only (AUDIO-03, v0.3)
 *  - character babble (ElevenLabs): fantasy gibberish per figure (AUDIO-04)
 * Music and effects fall back to procedural WebAudio when a file is missing.
 * Separate volumes for music / effects / voice (AUDIO-06). All buses run through a gentle
 * master compressor; every gain change is ramped (no clicks, clean fades).
 */
export type MusicKey = 'lobby' | 'island' | 'volcano' | 'city' | 'minigame' | 'minigame2' | 'minigame3' | 'victory' | 'none';
export type Sfx =
  | 'dice'
  | 'step'
  | 'coin'
  | 'coinLoss'
  | 'star'
  | 'item'
  | 'itemJingle'
  | 'ui'
  | 'whoosh'
  | 'boom'
  | 'train'
  | 'buzz'
  | 'ding'
  | 'fanfare'
  | 'pad0'
  | 'pad1'
  | 'pad2'
  | 'pad3'
  | 'splash'
  | 'clack';

interface Volumes {
  music: number;
  sfx: number;
  voice: number;
}

const SONGS: Record<Exclude<MusicKey, 'none'>, { bpm: number; root: number; prog: number[]; scale: number[]; melody: number[]; wave: OscillatorType }> = {
  lobby: { bpm: 104, root: 60, prog: [0, 5, 3, 4], scale: [0, 2, 4, 7, 9], melody: [0, 2, 4, 2, 3, 4, 2, 0], wave: 'triangle' },
  island: { bpm: 112, root: 62, prog: [0, 3, 4, 3], scale: [0, 2, 4, 7, 9], melody: [4, 2, 0, 2, 4, 4, 3, 1], wave: 'triangle' },
  volcano: { bpm: 120, root: 57, prog: [0, 6, 3, 4], scale: [0, 3, 5, 7, 10], melody: [0, 1, 2, 4, 3, 2, 1, 0], wave: 'square' },
  city: { bpm: 126, root: 65, prog: [0, 4, 5, 3], scale: [0, 2, 4, 5, 7, 9], melody: [0, 2, 4, 5, 4, 2, 1, 2], wave: 'triangle' },
  minigame: { bpm: 140, root: 64, prog: [0, 4, 5, 4], scale: [0, 2, 4, 7, 9], melody: [0, 4, 2, 4, 3, 4, 2, 4], wave: 'square' },
  minigame2: { bpm: 132, root: 59, prog: [0, 3, 0, 4], scale: [0, 3, 5, 7, 10], melody: [0, 2, 1, 3, 2, 4, 3, 1], wave: 'sawtooth' },
  minigame3: { bpm: 150, root: 67, prog: [0, 5, 3, 4], scale: [0, 2, 4, 7, 9], melody: [4, 3, 2, 1, 2, 3, 4, 4], wave: 'triangle' },
  victory: { bpm: 96, root: 60, prog: [0, 3, 4, 0], scale: [0, 2, 4, 7, 9], melody: [0, 2, 4, 4, 3, 2, 4, 4], wave: 'triangle' },
};

const MEDIA = `${import.meta.env.BASE_URL}media/audio/`;
const MUSIC_FILES: Record<Exclude<MusicKey, 'none'>, [normal: string, finale: string]> = {
  lobby: ['lobby', 'lobby'],
  island: ['island', 'island_finale'],
  volcano: ['volcano', 'volcano_finale'],
  city: ['city', 'city_finale'],
  minigame: ['minigame', 'minigame'],
  minigame2: ['minigame2', 'minigame2'],
  minigame3: ['minigame3', 'minigame3'],
  victory: ['victory', 'victory'],
};
/** Recorded files per effect (pads stay synthesized: they are pitched notes for the memo game). */
const SFX_FILES: Partial<Record<Sfx, string[]>> = {
  dice: ['dice'],
  step: ['step'],
  coin: ['coin'],
  coinLoss: ['coinLoss'],
  star: ['jingle_star', 'star'],
  item: ['item'],
  itemJingle: ['jingle_item'],
  ui: ['ui'],
  whoosh: ['whoosh'],
  boom: ['boom', 'jingle_eruption'],
  train: ['train', 'jingle_train'],
  buzz: ['buzz'],
  ding: ['ding'],
  fanfare: ['fanfare'],
  splash: ['splash'],
  clack: ['clack'],
};
/**
 * Minigame effects (v0.4, ElevenLabs): several takes where an effect repeats a lot; one is
 * picked at random and slightly detuned.
 */
const MG_SFX: Record<MgSfx, string[]> = {
  coin: ['coin'],
  splash: ['splash', 'mg_splash2'],
  whoosh: ['whoosh', 'mg_swish'],
  boom: ['boom'],
  buzz: ['buzz'],
  ding: ['ding'],
  thud: ['mg_thud', 'mg_thud2'],
  pop: ['mg_pop'],
  jump: ['mg_jump'],
  land: ['mg_land'],
  cheer: ['mg_cheer'],
  aww: ['mg_aww'],
  crack: ['mg_crack'],
  sizzle: ['mg_sizzle'],
  cannon: ['mg_cannon'],
  catch: ['mg_catch'],
  correct: ['mg_correct'],
  click: ['mg_click'],
  magic: ['mg_magic'],
  scribble: ['mg_scribble'],
  creak: ['mg_creak'],
  paddle: ['mg_paddle'],
  stomp: ['mg_stomp'],
  train: ['train'],
  swing: ['mg_swing'],
  slide: ['mg_slide'],
};
/** Countdown and match flow stingers (v0.4). */
const FLOW_SFX = ['mg_tick', 'mg_go', 'mg_whistle', 'mg_transition', 'mg_reveal'];
const AMBIENCE: AmbienceKey[] = ['sea', 'lava', 'meadow', 'city', 'ice', 'wind', 'studio', 'desert', 'night'];
const BABBLERS = ['rocco', 'quaki', 'pingo', 'foxy', 'bruno', 'hoppla', 'schildi', 'zippy', 'moderator'];
/** Effects that get a little pitch variation so repeats never sound identical. */
const VARIED: Sfx[] = ['step', 'coin', 'clack', 'ui', 'whoosh'];
/** Crossfade length for track changes and the loop point (seconds). */
const XFADE = 1.4;

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class HostAudio {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private duck: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private vol: Volumes = { music: 0.5, sfx: 0.7, voice: 0.9 };
  private current: MusicKey = 'none';
  private finale = false;
  private nextTime = 0;
  private step = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private master: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  onSubtitle: (text: string | null) => void = () => {};
  /** Maps a player name to its character (winner announcement; set by the session). */
  characterOf: (playerName: string) => CharacterId | null = () => null;
  private lineId = 0;
  // file-based assets
  private buffers = new Map<string, AudioBuffer | null>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private voiceManifest: Record<string, string> | null = null;
  private voiceSources: AudioBufferSourceNode[] = [];
  private music: { el: HTMLAudioElement; gain: GainNode }[] = [];
  private activeEl = 0;
  private musicSrc = '';
  private failedMusic = new Set<string>();
  private procedural = false;
  private looping = false;
  // v0.4: minigame dynamics (level + low-pass before the speech ducking) and ambience beds
  private level: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private ambGain: GainNode | null = null;
  private amb: { key: AmbienceKey; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private ambWanted: AmbienceKey | null = null;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('wb.volumes') ?? 'null');
      if (saved) this.vol = { ...this.vol, ...saved };
    } catch {
      /* ignore */
    }
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Needs a user gesture once (autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.musicGain = ctx.createGain();
      this.duck = ctx.createGain();
      this.sfxGain = ctx.createGain();
      this.voiceGain = ctx.createGain();
      // gentle bus compression keeps voice, jingles and music in one consistent loudness
      this.master = ctx.createDynamicsCompressor();
      this.master.threshold.value = -14;
      this.master.knee.value = 12;
      this.master.ratio.value = 3;
      this.master.attack.value = 0.01;
      this.master.release.value = 0.25;
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 0;
      this.master.connect(this.masterGain).connect(ctx.destination);
      this.level = ctx.createGain();
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 20000;
      this.filter.Q.value = 0.7;
      this.musicGain.connect(this.level).connect(this.filter).connect(this.duck).connect(this.master);
      this.ambGain = ctx.createGain();
      this.ambGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.voiceGain.connect(this.master);
      // fade the whole mix in instead of starting hard
      this.masterGain.gain.setTargetAtTime(1, ctx.currentTime + 0.05, 0.25);
      for (let i = 0; i < 2; i++) {
        const el = new Audio();
        el.preload = 'auto';
        const gain = ctx.createGain();
        gain.gain.value = 0;
        ctx.createMediaElementSource(el).connect(gain).connect(this.musicGain);
        el.addEventListener('error', () => this.onMusicError(el));
        this.music.push({ el, gain });
      }
      this.applyVolumes();
      this.preload();
      this.startMusic();
      if (this.ambWanted) this.ambience(this.ambWanted);
    }
    void this.ctx.resume();
    if (!this.timer) this.timer = setInterval(() => this.schedule(), 50);
  }

  volumes(): Volumes {
    return { ...this.vol };
  }

  setVolume(kind: keyof Volumes, v: number): void {
    this.vol[kind] = Math.max(0, Math.min(1, v));
    localStorage.setItem('wb.volumes', JSON.stringify(this.vol));
    this.applyVolumes();
  }

  private applyVolumes() {
    // the procedural loops are much louder than the mastered files; ramps avoid zipper noise
    const now = this.ctx?.currentTime ?? 0;
    this.musicGain?.gain.setTargetAtTime(this.vol.music * (this.procedural ? 0.22 : 0.8), now, 0.08);
    this.sfxGain?.gain.setTargetAtTime(this.vol.sfx * 0.5, now, 0.05);
    this.voiceGain?.gain.setTargetAtTime(this.vol.voice * 1.1, now, 0.05);
    // ambience sits well under the effects
    this.ambGain?.gain.setTargetAtTime(this.vol.sfx * 0.32, now, 0.1);
  }

  // --- files -------------------------------------------------------------------

  /** Decodes SFX right away and the voice segments in the background. */
  private preload() {
    const sfx = new Set(Object.values(SFX_FILES).flat());
    for (const c of BABBLERS) sfx.add(`babble_${c}`);
    for (const f of [...Object.values(MG_SFX).flat(), ...FLOW_SFX]) sfx.add(f);
    for (const f of sfx) void this.buffer(`sfx/${f}.mp3`);
    void fetch(`${MEDIA}voice/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : null))
      .then(async (m) => {
        this.voiceManifest = m;
        for (const id of Object.keys(m ?? {})) await this.buffer(`voice/${clipFile(id)}.mp3`);
      })
      .catch(() => (this.voiceManifest = null));
  }

  private buffer(path: string): Promise<AudioBuffer | null> {
    let p = this.loading.get(path);
    if (!p) {
      p = fetch(`${MEDIA}${path}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => this.ctx!.decodeAudioData(data))
        .catch(() => null)
        .then((b) => {
          this.buffers.set(path, b);
          return b;
        });
      this.loading.set(path, p);
    }
    return p;
  }

  private play(buf: AudioBuffer, out: AudioNode, at = 0, opts: { rate?: number; offset?: number; dur?: number; gain?: number } = {}): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const start = Math.max(at, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    // 4 ms fade-in and a short fade-out: no clicks, even when cut mid-sample
    const g = ctx.createGain();
    const peak = opts.gain ?? 1;
    const len = (opts.dur ?? buf.duration - (opts.offset ?? 0)) / (opts.rate ?? 1);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.004);
    const tail = opts.dur !== undefined ? Math.min(0.25, len * 0.3) : Math.min(0.03, len * 0.2);
    g.gain.setValueAtTime(peak, start + Math.max(0.005, len - tail));
    g.gain.linearRampToValueAtTime(0, start + len);
    src.connect(g).connect(out);
    src.start(start, opts.offset ?? 0, opts.dur);
    return src;
  }

  // --- music -------------------------------------------------------------------

  playMusic(key: MusicKey, finale = false): void {
    if (key === this.current && finale === this.finale) return;
    this.current = key;
    this.finale = finale;
    this.step = 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.1;
    this.startMusic();
  }

  private startMusic() {
    if (!this.ctx || !this.music.length) return;
    if (this.current === 'none') {
      this.musicSrc = '';
      this.fadeOutMusic();
      return;
    }
    const src = `${MEDIA}music/${MUSIC_FILES[this.current][this.finale ? 1 : 0]}.mp3`;
    this.procedural = this.failedMusic.has(src);
    this.applyVolumes();
    if (this.procedural) {
      this.musicSrc = '';
      this.fadeOutMusic();
      return;
    }
    if (src !== this.musicSrc) this.crossfadeTo(src);
  }

  private crossfadeTo(src: string) {
    const now = this.ctx!.currentTime;
    const old = this.music[this.activeEl];
    this.activeEl = 1 - this.activeEl;
    const next = this.music[this.activeEl];
    this.musicSrc = src;
    if (!next.el.src.endsWith(src)) next.el.src = src;
    next.el.currentTime = 0;
    void next.el.play().catch(() => undefined);
    // equal-power curves: no loudness dip in the middle of the crossfade
    const curve = (from: number, to: number) => Float32Array.from({ length: 32 }, (_, i) => {
      const k = i / 31;
      return to > from ? from + (to - from) * Math.sin((k * Math.PI) / 2) : to + (from - to) * Math.cos((k * Math.PI) / 2);
    });
    for (const [m, to] of [
      [next, 1],
      [old, 0],
    ] as const) {
      const from = m.gain.gain.value;
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setValueCurveAtTime(curve(from, to), now, XFADE);
    }
    setTimeout(() => {
      if (this.music[this.activeEl] !== old) old.el.pause();
    }, XFADE * 1000 + 100);
  }

  private fadeOutMusic() {
    const now = this.ctx!.currentTime;
    for (const m of this.music) {
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setValueAtTime(m.gain.gain.value, now);
      m.gain.gain.setTargetAtTime(0, now, 0.25);
    }
    setTimeout(() => {
      if (!this.musicSrc) for (const m of this.music) m.el.pause();
    }, 900);
  }

  private onMusicError(el: HTMLAudioElement) {
    const src = this.musicSrc;
    if (!src || !el.src.endsWith(src)) return;
    this.failedMusic.add(src);
    this.musicSrc = '';
    this.startMusic();
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // loop the streamed track by crossfading into its own beginning
    const cur = this.music[this.activeEl];
    if (this.musicSrc && cur && !cur.el.paused && cur.el.duration > XFADE * 4 && !this.looping && cur.el.duration - cur.el.currentTime < XFADE) {
      this.looping = true;
      this.crossfadeTo(this.musicSrc);
      setTimeout(() => (this.looping = false), XFADE * 1000 + 400);
    }
    if (!this.procedural || !this.musicGain || this.current === 'none') return;
    const song = SONGS[this.current];
    const bpm = song.bpm * (this.finale ? 1.18 : 1);
    const stepDur = 60 / bpm / 2; // eighth notes
    while (this.nextTime < ctx.currentTime + 0.2) {
      const s = this.step;
      const bar = Math.floor(s / 8) % song.prog.length;
      const chordRoot = song.root + MAJOR[song.prog[bar] % 7] + (song.prog[bar] >= 7 ? 12 : 0);
      if (s % 8 === 0 || s % 8 === 4) this.note(chordRoot - 24, this.nextTime, stepDur * 3.5, 'sine', 0.9);
      if (s % 2 === 0) {
        for (const iv of [0, 4, 7]) this.note(chordRoot - 12 + iv, this.nextTime, stepDur * 0.9, 'triangle', 0.18);
      }
      const mi = song.melody[s % song.melody.length];
      const deg = song.scale[mi % song.scale.length];
      if (s % 16 < 12 || this.finale) this.note(song.root + deg + 12, this.nextTime, stepDur * 0.8, song.wave, song.wave === 'triangle' ? 0.45 : 0.18);
      // percussion
      if (s % 4 === 0) this.noise(this.nextTime, 0.06, 0.5, 120);
      if (s % 4 === 2) this.noise(this.nextTime, 0.04, 0.35, 3000);
      if (this.finale && s % 2 === 1) this.noise(this.nextTime, 0.02, 0.2, 6000);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private note(n: number, at: number, dur: number, wave: OscillatorType, gain: number, out?: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.value = midi(n);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(out ?? this.musicGain!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private noise(at: number, dur: number, gain: number, freq: number, out?: AudioNode) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = freq < 500 ? 'lowpass' : 'highpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(out ?? this.musicGain!);
    src.start(at);
  }

  // --- effects -----------------------------------------------------------------

  sfx(kind: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const recorded = (SFX_FILES[kind] ?? []).map((f) => this.buffers.get(`sfx/${f}.mp3`)).filter((b): b is AudioBuffer => !!b);
    if (recorded.length) {
      const rate = VARIED.includes(kind) ? 0.95 + Math.random() * 0.1 : 1;
      for (const b of recorded) this.play(b, this.sfxGain, 0, { rate });
      return;
    }
    const at = ctx.currentTime;
    const out = this.sfxGain;
    const seq = (notes: number[], step: number, wave: OscillatorType = 'square', gain = 0.3) =>
      notes.forEach((n, i) => this.note(n, at + i * step, step * 1.4, wave, gain, out));
    switch (kind) {
      case 'dice':
        for (let i = 0; i < 6; i++) this.noise(at + i * 0.05, 0.03, 0.6, 2000, out);
        break;
      case 'step':
        this.note(72, at, 0.06, 'sine', 0.25, out);
        break;
      case 'coin':
        seq([88, 95], 0.07, 'square', 0.2);
        break;
      case 'coinLoss':
        seq([76, 69, 64], 0.08, 'triangle', 0.35);
        break;
      case 'star':
        seq([72, 76, 79, 84, 88, 91], 0.07, 'triangle', 0.4);
        break;
      case 'item':
      case 'itemJingle':
        seq([79, 83, 86], 0.06, 'square', 0.2);
        break;
      case 'ui':
        this.note(84, at, 0.05, 'sine', 0.3, out);
        break;
      case 'whoosh':
        this.noise(at, 0.35, 0.5, 900, out);
        break;
      case 'boom':
        this.noise(at, 0.9, 1.2, 150, out);
        this.note(36, at, 0.6, 'sine', 0.8, out);
        break;
      case 'train':
        seq([79, 76, 79, 76], 0.25, 'square', 0.25);
        break;
      case 'buzz':
        this.note(45, at, 0.4, 'sawtooth', 0.3, out);
        break;
      case 'ding':
        this.note(91, at, 0.4, 'sine', 0.4, out);
        break;
      case 'fanfare':
        seq([67, 72, 76, 79, 76, 79, 84], 0.12, 'triangle', 0.45);
        break;
      case 'splash':
        this.noise(at, 0.5, 0.8, 600, out);
        break;
      case 'clack':
        this.noise(at, 0.035, 0.7, 2500, out);
        this.note(55, at, 0.08, 'sine', 0.35, out);
        break;
      case 'pad0':
      case 'pad1':
      case 'pad2':
      case 'pad3':
        this.note([64, 67, 71, 74][Number(kind.slice(3))], at, 0.35, 'sine', 0.5, out);
        break;
    }
  }

  // --- minigames (v0.4) ---------------------------------------------------------

  /** Minigame effect at a stereo position (-1..1) with a distance gain. */
  mgSfx(kind: MgSfx, pan = 0, gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const takes = MG_SFX[kind].map((f) => this.buffers.get(`sfx/${f}.mp3`)).filter((b): b is AudioBuffer => !!b);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.sfxGain);
    setTimeout(() => panner.disconnect(), 4000);
    if (takes.length) {
      const b = takes[Math.floor(Math.random() * takes.length)];
      this.play(b, panner, 0, { rate: 0.94 + Math.random() * 0.12, gain });
      return;
    }
    // procedural fallback (files missing)
    const at = ctx.currentTime;
    switch (kind) {
      case 'thud':
      case 'land':
      case 'stomp':
        this.note(45, at, 0.12, 'sine', 0.6 * gain, panner);
        this.noise(at, 0.05, 0.4 * gain, 300, panner);
        break;
      case 'pop':
      case 'catch':
        this.note(84, at, 0.05, 'sine', 0.4 * gain, panner);
        this.noise(at, 0.03, 0.4 * gain, 2000, panner);
        break;
      case 'jump':
        [72, 79].forEach((n, i) => this.note(n, at + i * 0.05, 0.08, 'square', 0.15 * gain, panner));
        break;
      case 'correct':
      case 'magic':
        [79, 84, 88].forEach((n, i) => this.note(n, at + i * 0.06, 0.2, 'triangle', 0.3 * gain, panner));
        break;
      case 'cheer':
      case 'aww':
        this.noise(at, 0.8, 0.3 * gain, 800, panner);
        break;
      default:
        this.noise(at, 0.12, 0.4 * gain, 1200, panner);
    }
  }

  /** Countdown tick (3, 2, 1 rising) or the start stinger (n = 0). */
  countdownTick(n: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const file = this.buffers.get(n > 0 ? 'sfx/mg_tick.mp3' : 'sfx/mg_go.mp3');
    if (file) {
      this.play(file, this.sfxGain, 0, { rate: n > 0 ? [1.26, 1.12, 1][Math.min(2, n - 1)] : 1, gain: n > 0 ? 0.9 : 1 });
      return;
    }
    if (n > 0) this.note([76, 74, 72][Math.min(2, n - 1)] + 12, ctx.currentTime, 0.18, 'sine', 0.5, this.sfxGain);
    else [72, 76, 79, 84].forEach((m) => this.note(m, ctx.currentTime, 0.5, 'triangle', 0.3, this.sfxGain!));
  }

  /** Match flow stingers: final whistle, iris transition, results reveal. */
  stinger(kind: 'whistle' | 'transition' | 'reveal'): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const b = this.buffers.get(`sfx/mg_${kind}.mp3`);
    if (b) {
      this.play(b, this.sfxGain, 0, { gain: kind === 'transition' ? 0.8 : 1 });
      return;
    }
    if (kind === 'whistle') this.note(96, ctx.currentTime, 0.5, 'sine', 0.35, this.sfxGain);
    else if (kind === 'transition') this.noise(ctx.currentTime, 0.45, 0.5, 900, this.sfxGain);
    else this.sfx('fanfare');
  }

  /**
   * Music dynamics for a minigame: level (0..1, e.g. softer under the explanation) and an
   * optional low-pass ("muffled", e.g. right after the final whistle). Smooth ramps.
   */
  musicShape(level: number, muffled = false, secs = 0.6): void {
    const ctx = this.ctx;
    if (!ctx || !this.level || !this.filter) return;
    const now = ctx.currentTime;
    this.level.gain.cancelScheduledValues(now);
    this.level.gain.setValueAtTime(this.level.gain.value, now);
    this.level.gain.setTargetAtTime(level, now, secs / 3);
    const f = this.filter.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(f.value, now);
    f.exponentialRampToValueAtTime(muffled ? 650 : 20000, now + secs);
  }

  /** Looping ambience bed of a minigame backdrop (null = fade out). */
  ambience(key: AmbienceKey | null): void {
    this.ambWanted = key;
    const ctx = this.ctx;
    if (!ctx || !this.ambGain) return;
    if (this.amb?.key === key) return;
    const now = ctx.currentTime;
    if (this.amb) {
      const old = this.amb;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.setTargetAtTime(0, now, 0.4);
      setTimeout(() => old.src.stop(), 2000);
      this.amb = null;
    }
    if (!key || !AMBIENCE.includes(key)) return;
    void this.buffer(`sfx/amb_${key}.mp3`).then((buf) => {
      if (!buf || this.ambWanted !== key || this.amb || !this.ctx) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      // skip the encoder padding at both ends so the loop point is seamless
      src.loopStart = Math.min(0.06, buf.duration / 10);
      src.loopEnd = buf.duration - Math.min(0.06, buf.duration / 10);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.ambGain!);
      const t0 = this.ctx.currentTime;
      src.start(t0, src.loopStart);
      gain.gain.setTargetAtTime(1, t0, 0.6);
      this.amb = { key, src, gain };
    });
  }

  /** Character babble in a fantasy language (AUDIO-04). */
  babble(character: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const rec = this.buffers.get(`sfx/babble_${character}.mp3`);
    if (rec) {
      // a random snippet at a slightly varied pitch, so it never sounds the same twice
      const dur = Math.min(rec.duration, 0.45 + Math.random() * 0.4);
      const offset = Math.random() * Math.max(0, rec.duration - dur);
      this.play(rec, this.sfxGain, 0, { rate: 0.92 + Math.random() * 0.2, offset, dur, gain: 0.9 });
      return;
    }
    const base = { rocco: 62, quaki: 70, pingo: 66, foxy: 74, bruno: 55, hoppla: 76, schildi: 58, zippy: 80, moderator: 78 }[character] ?? 68;
    for (let i = 0; i < 5; i++) this.note(base + Math.floor(Math.random() * 7), ctx.currentTime + i * 0.07, 0.06, 'square', 0.15, this.sfxGain);
  }

  // --- moderator ---------------------------------------------------------------

  /**
   * Moderator line: subtitle always (A11Y-03); voice only for the few recorded big moments
   * (AUDIO-03). Resolves when the line is done.
   */
  say(key: string, params?: Params, minMs = 1400, speed = 1): Promise<void> {
    const text = t(key, params);
    this.lineId++;
    this.onSubtitle(text);
    const est = Math.max(minMs, text.length * 55) / speed;
    const clips = speed <= 1 ? this.recorded(voiceClips(key, params, (name) => this.characterOf(name))) : null;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        // keep the subtitle a moment, then clear it unless a newer line replaced it
        const mine = this.lineId;
        setTimeout(() => mine === this.lineId && this.onSubtitle(null), 1200);
        resolve();
      };
      if (clips && this.vol.voice > 0 && this.unlocked) {
        const dur = this.speak(clips, 0.35);
        // reading time still counts: long subtitles stay a little longer than the voice
        setTimeout(finish, Math.max(dur * 1000 + 150, Math.min(est, dur * 1000 + 900)));
        return;
      }
      setTimeout(finish, est);
    });
  }

  /** Calls out a dice total ("Sieben!") – the only per-turn voice line. */
  sayNumber(n: number, minMs = 700): Promise<void> {
    const id = numberClip(n);
    const clips = id ? this.recorded([id]) : null;
    if (!clips || this.vol.voice <= 0 || !this.unlocked) return new Promise((r) => setTimeout(r, minMs));
    const dur = this.speak(clips, 0);
    return new Promise((r) => setTimeout(r, Math.max(minMs, dur * 1000 + 100)));
  }

  /** Impact of a 3D die (strength 0..1). */
  diceClack(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running' || strength <= 0.05) return;
    const rec = this.buffers.get('sfx/clack.mp3');
    if (rec) this.play(rec, this.sfxGain, 0, { rate: 0.9 + Math.random() * 0.25, gain: 0.35 + strength * 0.65 });
    else {
      this.noise(ctx.currentTime, 0.03, 0.5 * strength, 2500, this.sfxGain);
      this.note(52 + Math.floor(Math.random() * 5), ctx.currentTime, 0.07, 'sine', 0.3 * strength, this.sfxGain);
    }
  }

  /** Decoded buffers for the clip ids, or null if any is unavailable. */
  private recorded(ids: string[]): AudioBuffer[] | null {
    if (!ids.length || !this.voiceManifest || !this.ctx) return null;
    const bufs: AudioBuffer[] = [];
    for (const id of ids) {
      const b = this.voiceManifest[id] ? this.buffers.get(`voice/${clipFile(id)}.mp3`) : null;
      if (!b) return null;
      bufs.push(b);
    }
    return bufs;
  }

  /** Plays whole clips back to back with a natural pause (music ducked); returns seconds. */
  private speak(bufs: AudioBuffer[], gap: number): number {
    const ctx = this.ctx!;
    this.stopVoice();
    this.duckTo(0.45, 0.18);
    let at = ctx.currentTime + 0.04;
    for (const b of bufs) {
      this.voiceSources.push(this.play(b, this.voiceGain!, at));
      at += b.duration + gap;
    }
    const total = at - gap - ctx.currentTime;
    setTimeout(() => this.unduck(), total * 1000);
    return total;
  }

  /** Session pause: the mix dips softly instead of cutting out. */
  setPaused(on: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.masterGain.gain.setTargetAtTime(on ? 0.35 : 1, this.ctx.currentTime, 0.2);
  }

  private duckTo(v: number, secs: number) {
    if (!this.duck || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(now);
    this.duck.gain.setValueAtTime(this.duck.gain.value, now);
    this.duck.gain.setTargetAtTime(v, now, secs / 3);
  }

  private unduck() {
    this.duckTo(1, 0.9);
  }

  stopVoice(): void {
    for (const s of this.voiceSources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.voiceSources = [];
  }
}
