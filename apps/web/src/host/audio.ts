import { t, type Params } from '@wb/shared/i18n/index';

/**
 * Host audio (AUDIO-05: audio only on the host). Placeholder implementation until the
 * Suno/ElevenLabs assets exist (see docs/OPEN_POINTS.md):
 *  - music: procedural WebAudio loops per map + finale variant, lobby, minigame moods
 *  - SFX: synthesized blips
 *  - moderator voice: browser speech synthesis (de-DE) – texts come from i18n keys
 *  - character babble: fantasy syllables (AUDIO-04)
 * Separate volumes for music / effects / voice (AUDIO-06).
 */
export type MusicKey = 'lobby' | 'island' | 'volcano' | 'city' | 'minigame' | 'minigame2' | 'minigame3' | 'victory' | 'none';
export type Sfx = 'dice' | 'step' | 'coin' | 'coinLoss' | 'star' | 'item' | 'ui' | 'whoosh' | 'boom' | 'train' | 'buzz' | 'ding' | 'fanfare' | 'pad0' | 'pad1' | 'pad2' | 'pad3' | 'splash';

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

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class HostAudio {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private vol: Volumes = { music: 0.5, sfx: 0.7, voice: 0.9 };
  private current: MusicKey = 'none';
  private finale = false;
  private nextTime = 0;
  private step = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  onSubtitle: (text: string | null) => void = () => {};

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
      this.ctx = new AC();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      this.applyVolumes();
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
    if (this.musicGain) this.musicGain.gain.value = this.vol.music * 0.22;
    if (this.sfxGain) this.sfxGain.gain.value = this.vol.sfx * 0.5;
  }

  playMusic(key: MusicKey, finale = false): void {
    if (key === this.current && finale === this.finale) return;
    this.current = key;
    this.finale = finale;
    this.step = 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.1;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || this.current === 'none' || ctx.state !== 'running') return;
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

  sfx(kind: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
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
    const base = { rocco: 62, quaki: 70, pingo: 66, foxy: 74, moderator: 78 }[character] ?? 68;
    for (let i = 0; i < 5; i++) this.note(base + Math.floor(Math.random() * 7), ctx.currentTime + i * 0.07, 0.06, 'square', 0.15, this.sfxGain);
  }

  /** Moderator line: subtitle always (A11Y-03) + voice (AUDIO-03). Resolves when done. */
  say(key: string, params?: Params, minMs = 1400, speed = 1): Promise<void> {
    const text = t(key, params);
    this.onSubtitle(text);
    const est = Math.max(minMs, text.length * 55) / speed;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      if ('speechSynthesis' in window && this.vol.voice > 0 && this.unlocked && speed <= 1) {
        try {
          speechSynthesis.cancel();
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

  stopVoice(): void {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
