import { Color4, DynamicTexture, ParticleSystem, Texture, Vector3, type Scene } from '@babylonjs/core';
import type { MgFxKind } from '@wb/shared/minigames/types';
import type { Stage } from './stage';
import { cached } from './terrain';

/**
 * Particle effects for minigames (v0.4): one-shot bursts (splash, dust, sparkle …) and
 * ambient emitters for the backdrops (embers, snow, fireflies …). Textures are drawn once
 * into small canvases; every burst is a self-disposing ParticleSystem.
 */
type Sprite = 'dot' | 'star' | 'drop' | 'puff' | 'flake' | 'chip';

function sprite(scene: Scene, kind: Sprite): Texture {
  return cached(scene, `fx_${kind}`, () => {
    const N = 64;
    const tex = new DynamicTexture(`fx_${kind}`, { width: N, height: N }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, N, N);
    const c = N / 2;
    if (kind === 'star') {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 11 : 28;
        ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'drop') {
      const g = ctx.createRadialGradient(c, c + 6, 2, c, c + 4, 22);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(c, 6);
      ctx.quadraticCurveTo(c + 20, c + 10, c, N - 6);
      ctx.quadraticCurveTo(c - 20, c + 10, c, 6);
      ctx.fill();
    } else if (kind === 'puff') {
      for (let k = 0; k < 6; k++) {
        const x = c + Math.cos(k * 1.7) * 10;
        const y = c + Math.sin(k * 2.3) * 9;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, N, N);
      }
    } else if (kind === 'flake') {
      const g = ctx.createRadialGradient(c, c, 0, c, c, 14);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, N, N);
    } else if (kind === 'chip') {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(12, 18);
      ctx.lineTo(50, 10);
      ctx.lineTo(54, 44);
      ctx.lineTo(20, 54);
      ctx.closePath();
      ctx.fill();
    } else {
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, N, N);
    }
    tex.update();
    tex.hasAlpha = true;
    return tex;
  });
}

interface Preset {
  sprite: Sprite;
  count: number;
  life: [number, number];
  size: [number, number];
  speed: [number, number];
  /** emit direction cone: y component range (up), horizontal spread */
  up: [number, number];
  spread: number;
  gravity: number;
  colors: [string, string];
  /** additive (glowing) instead of alpha blending */
  add?: boolean;
  radius?: number;
  drag?: number;
  spin?: boolean;
}

const PRESETS: Record<MgFxKind, Preset> = {
  splash: { sprite: 'drop', count: 38, life: [0.5, 0.9], size: [0.18, 0.42], speed: [3, 7], up: [0.8, 1], spread: 0.55, gravity: -16, colors: ['#ffffff', '#9fd8f2'], radius: 0.6 },
  dust: { sprite: 'puff', count: 16, life: [0.5, 0.9], size: [0.6, 1.3], speed: [0.8, 2.2], up: [0.1, 0.5], spread: 1, gravity: 0.6, colors: ['#efe4cc', '#d9c8a6'], radius: 0.5, drag: 0.9 },
  sparkle: { sprite: 'star', count: 18, life: [0.4, 0.8], size: [0.18, 0.4], speed: [1.5, 4], up: [0.3, 1], spread: 1, gravity: -3, colors: ['#fff6c2', '#f2c94c'], add: true, spin: true },
  coins: { sprite: 'star', count: 24, life: [0.5, 1], size: [0.22, 0.45], speed: [3, 6], up: [0.7, 1], spread: 0.6, gravity: -12, colors: ['#ffe28a', '#f2b53c'], add: true, spin: true },
  hit: { sprite: 'star', count: 10, life: [0.35, 0.6], size: [0.3, 0.55], speed: [2.5, 4], up: [0, 0.4], spread: 1, gravity: 0, colors: ['#ffffff', '#ffe08a'], add: true, spin: true, drag: 0.85 },
  pop: { sprite: 'chip', count: 26, life: [0.6, 1.1], size: [0.12, 0.26], speed: [3, 6], up: [-0.2, 1], spread: 1, gravity: -9, colors: ['#ffffff', '#ffffff'], spin: true },
  boom: { sprite: 'puff', count: 34, life: [0.6, 1.3], size: [1.2, 2.6], speed: [2, 6], up: [0.1, 1], spread: 1, gravity: 1.5, colors: ['#ffb067', '#7a6a72'], radius: 0.8, drag: 0.88 },
  confetti: { sprite: 'chip', count: 90, life: [1.6, 2.6], size: [0.16, 0.3], speed: [5, 10], up: [0.85, 1], spread: 0.45, gravity: -7, colors: ['#ffffff', '#ffffff'], spin: true, drag: 0.97 },
  smoke: { sprite: 'puff', count: 14, life: [1, 1.8], size: [1, 2], speed: [0.5, 1.5], up: [0.6, 1], spread: 0.5, gravity: 1.2, colors: ['#d8d4e0', '#9a95a8'], radius: 0.6, drag: 0.95 },
  ice: { sprite: 'chip', count: 22, life: [0.5, 0.9], size: [0.12, 0.3], speed: [2, 5], up: [0.3, 1], spread: 1, gravity: -12, colors: ['#ffffff', '#bfe6f7'], spin: true },
  embers: { sprite: 'dot', count: 26, life: [0.6, 1.2], size: [0.1, 0.24], speed: [2, 5], up: [0.6, 1], spread: 0.8, gravity: -4, colors: ['#ffd27a', '#ff6a2a'], add: true },
  ring: { sprite: 'dot', count: 40, life: [0.35, 0.5], size: [0.16, 0.3], speed: [5, 6], up: [0, 0.05], spread: 1, gravity: 0, colors: ['#ffffff', '#ffffff'], add: true, drag: 0.8 },
};

const CONFETTI = ['#e8676b', '#5f8fe0', '#56c08e', '#f2c23c', '#9b7ddb', '#f49a4a'];

const c4 = (hex: string, a = 1) => {
  const n = parseInt(hex.slice(1), 16);
  return new Color4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
};

export function burst(stage: Stage, kind: MgFxKind, at: Vector3, opts: { color?: string; scale?: number } = {}): void {
  const p = PRESETS[kind];
  const scale = opts.scale ?? 1;
  const lowQ = stage.qualityLevel === 0;
  const count = Math.max(4, Math.round(p.count * (lowQ ? 0.4 : 1) * Math.sqrt(scale)));
  if (kind === 'confetti' || (kind === 'pop' && !opts.color)) {
    // several colored systems (particles can't pick from a palette)
    const colors = kind === 'confetti' ? CONFETTI : ['#ffffff'];
    colors.forEach((c) => emit(stage, p, at, Math.ceil(count / colors.length), scale, c, c));
    return;
  }
  const [a, b] = opts.color ? [opts.color, opts.color] : p.colors;
  emit(stage, p, at, count, scale, a, b);
}

function emit(stage: Stage, p: Preset, at: Vector3, count: number, scale: number, colA: string, colB: string) {
  const scene = stage.scene;
  const ps = new ParticleSystem('fx', count, scene);
  ps.particleTexture = sprite(scene, p.sprite);
  ps.emitter = at.clone();
  const r = (p.radius ?? 0.2) * scale;
  ps.minEmitBox = new Vector3(-r, 0, -r);
  ps.maxEmitBox = new Vector3(r, r * 0.3, r);
  ps.direction1 = new Vector3(-p.spread, p.up[0], -p.spread);
  ps.direction2 = new Vector3(p.spread, p.up[1], p.spread);
  ps.minEmitPower = p.speed[0] * Math.sqrt(scale);
  ps.maxEmitPower = p.speed[1] * Math.sqrt(scale);
  ps.minLifeTime = p.life[0];
  ps.maxLifeTime = p.life[1];
  ps.minSize = p.size[0] * scale;
  ps.maxSize = p.size[1] * scale;
  ps.gravity = new Vector3(0, p.gravity, 0);
  ps.color1 = c4(colA);
  ps.color2 = c4(colB);
  ps.colorDead = c4(colB, 0);
  if (p.drag) ps.addDragGradient(0, 1 - p.drag);
  ps.addSizeGradient(0, p.size[0] * scale * 0.6);
  ps.addSizeGradient(0.25, p.size[1] * scale);
  ps.addSizeGradient(1, p.size[1] * scale * (p.sprite === 'puff' ? 1.6 : 0.5));
  if (p.spin) {
    ps.minAngularSpeed = -8;
    ps.maxAngularSpeed = 8;
  }
  ps.blendMode = p.add ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
  ps.manualEmitCount = count;
  ps.targetStopDuration = p.life[1] + 0.1;
  ps.disposeOnStop = true;
  ps.updateSpeed = 1 / 60;
  ps.start();
}

/** Ambient emitters of the backdrops. */
export type AmbientKind = 'embers' | 'snow' | 'fireflies' | 'petals' | 'motes' | 'sparkles' | 'ash';

export function ambient(stage: Stage, kind: AmbientKind, center: Vector3, size: Vector3): ParticleSystem {
  const scene = stage.scene;
  const lowQ = stage.qualityLevel === 0;
  const cfg: Record<AmbientKind, { sprite: Sprite; rate: number; life: [number, number]; size: [number, number]; dir: [Vector3, Vector3]; grav: number; cols: [string, string]; add?: boolean; power: [number, number] }> = {
    embers: { sprite: 'dot', rate: 26, life: [3, 6], size: [0.08, 0.22], dir: [new Vector3(-0.3, 1, -0.3), new Vector3(0.3, 1, 0.3)], grav: 0.2, cols: ['#ffcf6a', '#ff6a2a'], add: true, power: [0.6, 1.6] },
    ash: { sprite: 'flake', rate: 14, life: [5, 9], size: [0.08, 0.16], dir: [new Vector3(-0.3, -0.4, -0.3), new Vector3(0.3, -0.1, 0.3)], grav: -0.05, cols: ['#8f8a96', '#6a6572'], power: [0.3, 0.7] },
    snow: { sprite: 'flake', rate: 60, life: [6, 10], size: [0.1, 0.24], dir: [new Vector3(-0.3, -1, -0.2), new Vector3(0.2, -1, 0.3)], grav: -0.1, cols: ['#ffffff', '#e6f4fb'], power: [0.8, 1.6] },
    fireflies: { sprite: 'dot', rate: 9, life: [3, 6], size: [0.14, 0.26], dir: [new Vector3(-0.5, -0.2, -0.5), new Vector3(0.5, 0.4, 0.5)], grav: 0, cols: ['#e8ff8a', '#b8f070'], add: true, power: [0.2, 0.5] },
    petals: { sprite: 'chip', rate: 6, life: [6, 9], size: [0.1, 0.18], dir: [new Vector3(0.4, -0.3, -0.2), new Vector3(1, -0.1, 0.2)], grav: -0.08, cols: ['#ffd1dc', '#ffffff'], power: [0.6, 1.2] },
    motes: { sprite: 'dot', rate: 8, life: [4, 7], size: [0.05, 0.12], dir: [new Vector3(-0.3, -0.1, -0.3), new Vector3(0.3, 0.3, 0.3)], grav: 0, cols: ['#fffbe6', '#ffffff'], add: true, power: [0.1, 0.3] },
    sparkles: { sprite: 'star', rate: 10, life: [1, 2], size: [0.12, 0.3], dir: [new Vector3(-0.2, 0.2, -0.2), new Vector3(0.2, 0.6, 0.2)], grav: 0, cols: ['#fff3b0', '#ffffff'], add: true, power: [0.1, 0.4] },
  };
  const c = cfg[kind];
  const ps = new ParticleSystem(`amb_${kind}`, Math.ceil(c.rate * c.life[1] * 1.2), scene);
  ps.particleTexture = sprite(scene, c.sprite);
  ps.emitter = center.clone();
  ps.minEmitBox = size.scale(-0.5);
  ps.maxEmitBox = size.scale(0.5);
  ps.direction1 = c.dir[0];
  ps.direction2 = c.dir[1];
  ps.minEmitPower = c.power[0];
  ps.maxEmitPower = c.power[1];
  ps.minLifeTime = c.life[0];
  ps.maxLifeTime = c.life[1];
  ps.minSize = c.size[0];
  ps.maxSize = c.size[1];
  ps.emitRate = c.rate * (lowQ ? 0.3 : 1);
  ps.gravity = new Vector3(0, c.grav, 0);
  ps.color1 = c4(c.cols[0]);
  ps.color2 = c4(c.cols[1]);
  ps.colorDead = c4(c.cols[1], 0);
  ps.addColorGradient(0, c4(c.cols[0], 0));
  ps.addColorGradient(0.15, c4(c.cols[0], 1));
  ps.addColorGradient(0.8, c4(c.cols[1], 0.9));
  ps.addColorGradient(1, c4(c.cols[1], 0));
  if (c.sprite === 'chip' || c.sprite === 'star') {
    ps.minAngularSpeed = -2;
    ps.maxAngularSpeed = 2;
  }
  ps.blendMode = c.add ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
  ps.preWarmCycles = 120;
  ps.preWarmStepOffset = 5;
  ps.start();
  return ps;
}
