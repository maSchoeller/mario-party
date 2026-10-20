import { t, type Params } from '@wb/shared/i18n/index';
import { voiceSegments } from '@wb/shared/i18n/voice';

/**
 * Host audio (AUDIO-05: audio only on the host). Generated assets in public/media/audio
 * (scripts/assets, see docs/ASSETS_LICENSES.md):
 *  - music (Suno): one loop per map + finale variant, lobby, 3 minigame moods, victory;
 *    streamed via <audio> and looped with a crossfade (AUDIO-01)
 *  - jingles (Suno) + SFX (ElevenLabs), decoded once (AUDIO-02)
 *  - moderator voice (ElevenLabs): pre-recorded segments chained per line (AUDIO-03)
 *  - character babble (ElevenLabs): fantasy gibberish per figure (AUDIO-04)
 * Every part falls back to the procedural WebAudio / speech-synthesis placeholder when
 * a file is missing or cannot be decoded.
 * Separate volumes for music / effects / voice (AUDIO-06).
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
  | 'splash';

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
};
const BABBLERS = ['rocco', 'quaki', 'pingo', 'foxy', 'moderator'];
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
  private voice: SpeechSynthesisVoice | null = null;
  onSubtitle: (text: string | null) => void = () => {};
  /** Maps a player name to the spoken character name (set by the session). */
  characterOf: (playerName: string) => string | null = () => null;
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

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('wb.volumes') ?? 'null');
      if (saved) this.vol = { ...this.vol, ...saved };
    } catch {
      /* ignore */
    }
    if ('speechSynthesis' in window) {
      const pick = () => {
        const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('de'));
        this.voice = voices[0] ?? null;
      };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
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
      this.musicGain.connect(this.duck).connect(ctx.destination);
      this.sfxGain.connect(ctx.destination);
      this.voiceGain.connect(ctx.destination);
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
    // the procedural loops are much louder than the mastered files
    if (this.musicGain) this.musicGain.gain.value = this.vol.music * (this.procedural ? 0.22 : 0.8);
    if (this.sfxGain) this.sfxGain.gain.value = this.vol.sfx * 0.5;
    if (this.voiceGain) this.voiceGain.gain.value = this.vol.voice;
  }

  // --- files -------------------------------------------------------------------

  /** Decodes SFX right away and the voice segments in the background. */
  private preload() {
    const sfx = new Set(Object.values(SFX_FILES).flat());
    for (const c of BABBLERS) sfx.add(`babble_${c}`);
    for (const f of sfx) void this.buffer(`sfx/${f}.mp3`);
    void fetch(`${MEDIA}voice/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : null))
      .then(async (m) => {
        this.voiceManifest = m;
        for (const id of new Set(Object.values(m ?? {}))) await this.buffer(`voice/${id}.mp3`);
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
    if (opts.gain !== undefined || opts.dur !== undefined) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(opts.gain ?? 1, start);
      if (opts.dur !== undefined) {
        g.gain.setValueAtTime(opts.gain ?? 1, start + opts.dur * 0.7);
        g.gain.linearRampToValueAtTime(0, start + opts.dur);
      }
      src.connect(g).connect(out);
    } else src.connect(out);
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
    for (const [m, to] of [
      [next, 1],
      [old, 0],
    ] as const) {
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setValueAtTime(m.gain.gain.value, now);
      m.gain.gain.linearRampToValueAtTime(to, now + XFADE);
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
      m.gain.gain.linearRampToValueAtTime(0, now + 0.8);
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
      for (const b of recorded) this.play(b, this.sfxGain);
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
      case 'pad0':
      case 'pad1':
      case 'pad2':
      case 'pad3':
        this.note([64, 67, 71, 74][Number(kind.slice(3))], at, 0.35, 'sine', 0.5, out);
        break;
    }
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
    const base = { rocco: 62, quaki: 70, pingo: 66, foxy: 74, moderator: 78 }[character] ?? 68;
    for (let i = 0; i < 5; i++) this.note(base + Math.floor(Math.random() * 7), ctx.currentTime + i * 0.07, 0.06, 'square', 0.15, this.sfxGain);
  }

  // --- moderator ---------------------------------------------------------------

  /** Moderator line: subtitle always (A11Y-03) + voice (AUDIO-03). Resolves when done. */
  say(key: string, params?: Params, minMs = 1400, speed = 1): Promise<void> {
    const text = t(key, params);
    this.lineId++;
    this.onSubtitle(text);
    const est = Math.max(minMs, text.length * 55) / speed;
    const recorded = speed <= 1 ? this.recordedLine(key, params) : null;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.unduck();
        // keep the subtitle a moment, then clear it unless a newer line replaced it
        const mine = this.lineId;
        setTimeout(() => mine === this.lineId && this.onSubtitle(null), 1200);
        resolve();
      };
      if (recorded && this.vol.voice > 0 && this.unlocked) {
        const dur = this.speak(recorded);
        setTimeout(finish, Math.max(dur * 1000 + 150, minMs / speed));
        return;
      }
      if ('speechSynthesis' in window && this.vol.voice > 0 && this.unlocked && speed <= 1) {
        try {
          this.stopVoice();
          const u = new SpeechSynthesisUtterance(text.replace(/[★●▲■◆]/g, ''));
          u.lang = 'de-DE';
          if (this.voice) u.voice = this.voice;
          u.pitch = 1.5;
          u.rate = 1.12;
          u.volume = this.vol.voice;
          u.onend = () => setTimeout(finish, 150);
          u.onerror = () => setTimeout(finish, est);
          speechSynthesis.speak(u);
          setTimeout(finish, est + 4000);
          return;
        } catch {
          /* fall back to timer */
        }
      }
      this.babble('moderator');
      setTimeout(finish, est);
    });
  }

  /** Decoded segment buffers for a line, or null if any segment is unavailable. */
  private recordedLine(key: string, params?: Params): AudioBuffer[] | null {
    if (!this.voiceManifest || !this.ctx) return null;
    const segs = voiceSegments(key, params, (name) => this.characterOf(name));
    if (!segs?.length) return null;
    const bufs: AudioBuffer[] = [];
    for (const seg of segs) {
      const id = this.voiceManifest[seg];
      const b = id ? this.buffers.get(`voice/${id}.mp3`) : null;
      if (!b) return null;
      bufs.push(b);
    }
    return bufs;
  }

  /** Plays the segments back to back (music ducked); returns the duration in seconds. */
  private speak(bufs: AudioBuffer[]): number {
    const ctx = this.ctx!;
    this.stopVoice();
    this.duckTo(0.5, 0.15);
    let at = ctx.currentTime + 0.03;
    for (const b of bufs) {
      this.voiceSources.push(this.play(b, this.voiceGain!, at));
      at += b.duration + 0.04;
    }
    return at - ctx.currentTime;
  }

  private duckTo(v: number, secs: number) {
    if (!this.duck || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(now);
    this.duck.gain.setValueAtTime(this.duck.gain.value, now);
    this.duck.gain.linearRampToValueAtTime(v, now + secs);
  }

  private unduck() {
    this.duckTo(1, 0.6);
  }

  stopVoice(): void {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
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
