import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { ageFx, clamp, dist2, emitFx, faceAngle, lerp, moveWithStick, skill, steerTo, teamRanks, viewFx, type FxState } from '../util';

/**
 * #14 Kokos-Kanonier (1 vs 3, Neigen vs. Joystick): the solo player aims a coconut cannon
 * by tilting the phone (crosshair on the TV); the cannon fires automatically. The trio
 * dodges with the joystick – every hit costs a heart, without hearts you are out.
 * Trio wins if at least one of them is still in the arena when time runs out.
 */
const AX = 7; // arena half width (x)
const AZ = 4.5; // arena half depth (z)
const SPEED = 5;
const CROSS_SPEED = 9;
/** fire interval at the start / at the end (the cannon gets faster) */
const FIRE_START = 1.1;
const FIRE_END = 0.55;
const FIRST_SHOT = 2;
const FLIGHT = 0.8;
const HIT_R = 1.8;
const LIVES = 2;
const INVULN = 1.2;
const CANNON = { x: 0, z: AZ + 3.2 };
const DURATION = 40;
/** height of the cannon mound (visual) */
const HILL = 0.6;
/** lagoon water level (visual) */
const WATER = -0.5;
/** trio bots: reaction to a new shell, chance to overlook it, running speed */
const DODGER = {
  easy: { delay: 0.4, miss: 0.44, speed: 0.92 },
  medium: { delay: 0.35, miss: 0.4, speed: 0.96 },
  hard: { delay: 0.31, miss: 0.37, speed: 1 },
};

interface Shell {
  id: number;
  x: number;
  z: number;
  /** time until impact */
  eta: number;
}

interface P {
  x: number;
  z: number;
  vx: number;
  vz: number;
  ry: number;
  stick: { x: number; y: number };
  lives: number;
  inv: number;
  out: boolean;
  /** practice: time until revive */
  revive: number;
  hits: number;
  /** bot memory */
  think: number;
  /** bot: per-shell decision whether this shell was noticed */
  seen: { id: number; at: number }[];
  target: { x: number; z: number } | null;
}

export interface KokosKanonierState extends FxState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  solo: number;
  trio: number[];
  ps: P[];
  cross: { x: number; z: number };
  tilt: { x: number; y: number };
  fireIn: number;
  shells: Shell[];
  nextId: number;
  booms: { id: number; x: number; z: number; t: number; hit: boolean }[];
  hits: number;
  /** solo bot memory */
  botTarget: number;
  botThink: number;
  botAim: { x: number; z: number };
}

/** cannon muzzle (visual): the barrel turns towards the crosshair */
function muzzle(s: KokosKanonierState): { x: number; y: number; z: number } {
  const dx = s.cross.x - CANNON.x;
  const dz = s.cross.z - CANNON.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: CANNON.x + (dx / l) * 1.4, y: HILL + 1.3, z: CANNON.z + (dz / l) * 1.4 };
}

function alive(s: KokosKanonierState): number[] {
  return s.trio.filter((i) => !s.ps[i].out);
}

export const kokosKanonier: MinigameDef<KokosKanonierState> = {
  id: 'kokosKanonier',
  format: '1v3',
  control: 'motion',
  motion: true,
  theme: 'island',
  duration: DURATION,
  setup(players, _rng, opts) {
    const solo = Math.max(0, players.findIndex((p) => p.team === 0));
    const trio = players.map((_, i) => i).filter((i) => i !== solo);
    const ps: P[] = players.map(() => ({
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      ry: 0,
      stick: { x: 0, y: 0 },
      lives: LIVES,
      inv: 0,
      out: false,
      revive: 0,
      hits: 0,
      think: 0,
      seen: [],
      target: null,
    }));
    trio.forEach((i, k) => {
      ps[i].x = (k - 1) * 4.5;
      ps[i].z = -2;
    });
    ps[solo].x = CANNON.x;
    ps[solo].z = CANNON.z + 1.6;
    ps[solo].ry = faceAngle(0, -1);
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      solo,
      trio,
      ps,
      cross: { x: 0, z: 0 },
      tilt: { x: 0, y: 0 },
      fireIn: FIRST_SHOT,
      shells: [],
      nextId: 1,
      booms: [],
      hits: 0,
      botTarget: -1,
      botThink: 0,
      botAim: { x: 0, z: 0 },
      fx: [],
      fxN: 0,
    };
  },
  layout(s, i) {
    if (i === s.solo) return { kind: 'tilt', labelKey: 'ctrl.aimCannon' };
    if (s.ps[i].out) return { kind: 'wait', labelKey: 'ctrl.eliminated' };
    return { kind: 'joystick' };
  },
  input(s, i, input: MgInput) {
    if (i === s.solo) {
      if (input.type === 'tilt') s.tilt = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1) };
      return;
    }
    if (input.type === 'stick') s.ps[i].stick = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1) };
  },
  tick(s, dt, _rng: Rng) {
    s.t += dt;
    ageFx(s, dt);
    // crosshair: tilt = velocity (works for gyro and slider fallback alike)
    const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
    s.cross.x = clamp(s.cross.x + dz(s.tilt.x) * CROSS_SPEED * dt, -AX, AX);
    s.cross.z = clamp(s.cross.z + dz(s.tilt.y) * CROSS_SPEED * dt, -AZ, AZ);
    // automatic fire
    s.fireIn -= dt;
    if (s.fireIn <= 0) {
      s.fireIn = lerp(FIRE_START, FIRE_END, clamp(s.t / s.duration, 0, 1));
      s.shells.push({ id: s.nextId++, x: s.cross.x, z: s.cross.z, eta: FLIGHT });
      // muzzle blast
      const m = muzzle(s);
      emitFx(s, { kind: 'smoke', sfx: 'cannon', x: m.x, y: m.y, z: m.z, s: 0.8 });
    }
    // trio movement
    for (const i of s.trio) {
      const p = s.ps[i];
      if (p.out) {
        if (s.practice && (p.revive -= dt) <= 0) {
          p.out = false;
          p.lives = LIVES;
          p.inv = INVULN;
          emitFx(s, { kind: 'sparkle', sfx: 'magic', x: p.x, y: 1.2, z: p.z });
        }
        continue;
      }
      p.inv = Math.max(0, p.inv - dt);
      moveWithStick(p, p.stick, SPEED, dt);
      p.x = clamp(p.x, -AX, AX);
      p.z = clamp(p.z, -AZ, AZ);
      if (Math.hypot(p.vx, p.vz) > 0.5) p.ry = faceAngle(p.vx, p.vz);
    }
    // impacts
    for (const sh of s.shells) {
      sh.eta -= dt;
      if (sh.eta > 0) continue;
      let hit = false;
      for (const i of s.trio) {
        const p = s.ps[i];
        if (p.out || p.inv > 0 || dist2(p.x, p.z, sh.x, sh.z) > HIT_R * HIT_R) continue;
        hit = true;
        p.lives--;
        p.hits++;
        p.inv = INVULN;
        s.hits++;
        emitFx(s, { kind: 'hit', sfx: 'thud', x: p.x, y: 1.3, z: p.z, s: 1.1 });
        if (p.lives <= 0) {
          p.out = true;
          p.revive = 2;
          p.vx = 0;
          p.vz = 0;
          emitFx(s, { kind: 'smoke', sfx: 'aww', x: p.x, y: 0.8, z: p.z, s: 1.1 }, 0.5);
        }
      }
      s.booms.push({ id: sh.id, x: sh.x, z: sh.z, t: 0.6, hit });
      // the coconut smacks into the sand
      emitFx(s, { kind: hit ? 'pop' : 'dust', sfx: hit ? undefined : 'land', x: sh.x, y: 0.15, z: sh.z, s: hit ? 0.8 : 1.2, color: hit ? '#f2c14e' : undefined });
    }
    s.shells = s.shells.filter((sh) => sh.eta > 0);
    s.booms = s.booms.filter((b) => (b.t -= dt) > 0);
  },
  isOver: (s) => !s.practice && (s.t >= s.duration || alive(s).length === 0),
  result: (s) => teamRanks(s.players, [alive(s).length > 0 ? 1 : 0]),
  bot(s, i, level, rng, dt) {
    const sk = skill(level);
    if (i === s.solo) {
      // pick the trio member closest to the crosshair, lead its movement a bit
      s.botThink -= dt;
      const live = alive(s);
      if (!live.length) return [{ type: 'tilt', x: 0, y: 0 }];
      if (s.botThink <= 0) {
        s.botThink = 0.12 + sk.reaction * 0.4 * (0.7 + rng.next() * 0.6);
        if (!live.includes(s.botTarget) || rng.chance(0.15)) {
          const sorted = [...live].sort((a, b) => dist2(s.ps[a].x, s.ps[a].z, s.cross.x, s.cross.z) - dist2(s.ps[b].x, s.ps[b].z, s.cross.x, s.cross.z));
          // ignore players that are still blinking after a hit
          s.botTarget = sorted.find((k) => s.ps[k].inv <= 0) ?? sorted[0];
        }
        const p = s.ps[s.botTarget];
        const leadT = Math.min(FLIGHT + 0.3, s.fireIn + FLIGHT) * { easy: 0.5, medium: 0.75, hard: 0.9 }[level];
        const err = (1 - sk.accuracy) * 2;
        s.botAim = {
          x: clamp(p.x + p.vx * leadT + rng.noise() * err, -AX, AX),
          z: clamp(p.z + p.vz * leadT + rng.noise() * err, -AZ, AZ),
        };
      }
      const gain = 0.9;
      return [
        {
          type: 'tilt',
          x: clamp((s.botAim.x - s.cross.x) * gain, -1, 1) * sk.speed,
          y: clamp((s.botAim.z - s.cross.z) * gain, -1, 1) * sk.speed,
        },
      ];
    }
    const p = s.ps[i];
    if (p.out) return [];
    p.think -= dt;
    if (p.think <= 0) {
      p.think = 0.1 + rng.next() * 0.1;
      // shells are only noticed after a reaction delay – and sometimes not at all
      p.seen = p.seen.filter((e) => s.shells.some((sh) => sh.id === e.id));
      for (const sh of s.shells) {
        if (!p.seen.some((e) => e.id === sh.id)) {
          const d = DODGER[level];
          p.seen.push({ id: sh.id, at: rng.chance(d.miss) ? 99 : Math.max(0.15, d.delay + rng.noise() * 0.08) });
        }
      }
      const danger = s.shells
        .filter((sh) => p.seen.some((e) => e.id === sh.id && FLIGHT - sh.eta > e.at) && dist2(p.x, p.z, sh.x, sh.z) < (HIT_R + 0.9) ** 2)
        .sort((a, b) => a.eta - b.eta)[0];
      if (danger) {
        let dx = p.x - danger.x;
        let dz = p.z - danger.z;
        if (Math.hypot(dx, dz) < 0.2) {
          const a = rng.next() * Math.PI * 2;
          dx = Math.cos(a);
          dz = Math.sin(a);
        }
        // flee away from the impact; near a wall, try sideways directions instead
        const base = Math.atan2(dz, dx);
        p.target = null;
        for (const off of [0, 0.9, -0.9, 1.6, -1.6, 2.3, -2.3]) {
          const tx = clamp(p.x + Math.cos(base + off) * 3.2, -AX + 0.4, AX - 0.4);
          const tz = clamp(p.z + Math.sin(base + off) * 3.2, -AZ + 0.4, AZ - 0.4);
          if (dist2(tx, tz, danger.x, danger.z) > (HIT_R + 0.9) ** 2) {
            p.target = { x: tx, z: tz };
            break;
          }
        }
      } else if (!p.target || rng.chance(0.03) || (dist2(p.x, p.z, s.cross.x, s.cross.z) < 2.5 ** 2 && dist2(p.x, p.z, p.target.x, p.target.z) < 1)) {
        // stroll to a new spot now and then (away from the crosshair), or when the crosshair comes close
        let best = { x: 0, z: 0 };
        let bestD = -1;
        for (let k = 0; k < 3; k++) {
          const c = { x: rng.range(-AX + 1, AX - 1), z: rng.range(-AZ + 1, AZ - 1) };
          const d = dist2(c.x, c.z, s.cross.x, s.cross.z);
          if (d > bestD) {
            bestD = d;
            best = c;
          }
        }
        p.target = best;
      }
    }
    if (!p.target) return [{ type: 'stick', x: 0, y: 0 }];
    const st = steerTo(p.x, p.z, p.target.x, p.target.z, rng, sk.accuracy);
    return [{ type: 'stick', x: st.x * DODGER[level].speed, y: st.y * DODGER[level].speed }];
  },
  view(s) {
    const aimDx = s.cross.x - CANNON.x;
    const aimDz = s.cross.z - CANNON.z;
    // sandy island (slightly oval, reaching back to the cannon mound) sloping into the lagoon
    const IZ = 1.5;
    const entities: MgEntity[] = [
      { id: 'beach', kind: 'cylinder', x: 0, y: -0.3, z: IZ, sx: 25, sy: 0.6, sz: 20, color: '#f0e0b6', mat: 'sand', taper: 0.88 },
      { id: 'rim', kind: 'cylinder', x: 0, y: -1.1, z: IZ, sx: 31, sy: 1, sz: 25, color: '#d6c08c', mat: 'sand', taper: 25 / 31 },
      // roped-off arena
      { id: 'ropeN', kind: 'box', x: 0, y: 0.32, z: AZ + 0.7, sx: AX * 2 + 1.4, sy: 0.07, sz: 0.07, color: '#d9bd86', mat: 'rope' },
      { id: 'ropeS', kind: 'box', x: 0, y: 0.32, z: -AZ - 0.7, sx: AX * 2 + 1.4, sy: 0.07, sz: 0.07, color: '#d9bd86', mat: 'rope' },
      { id: 'ropeW', kind: 'box', x: -AX - 0.7, y: 0.32, z: 0, sx: 0.07, sy: 0.07, sz: AZ * 2 + 1.4, color: '#d9bd86', mat: 'rope' },
      { id: 'ropeE', kind: 'box', x: AX + 0.7, y: 0.32, z: 0, sx: 0.07, sy: 0.07, sz: AZ * 2 + 1.4, color: '#d9bd86', mat: 'rope' },
      // grassy mound with the coconut cannon
      { id: 'hill', kind: 'cylinder', x: CANNON.x + 0.6, y: HILL / 2, z: CANNON.z + 0.5, sx: 6.8, sy: HILL, sz: 4.4, color: '#8fcb6e', mat: 'grass', taper: 0.8 },
      { id: 'cannon', kind: 'prop', prop: 'cannon', x: CANNON.x, y: HILL, z: CANNON.z, ry: faceAngle(aimDx, aimDz), sx: 1.05 },
      { id: 'ammo1', kind: 'coconut', x: 4.4, y: 0.33, z: CANNON.z - 0.4 },
      { id: 'ammo2', kind: 'coconut', x: 4.95, y: 0.33, z: CANNON.z - 0.1 },
      { id: 'ammo3', kind: 'coconut', x: 4.7, y: 0.33, z: CANNON.z + 0.45 },
      { id: 'ammo4', kind: 'coconut', x: 4.7, y: 0.85, z: CANNON.z - 0.02 },
      { id: 'barrel1', kind: 'prop', prop: 'barrel', x: -3.3, y: 0, z: CANNON.z - 0.2, ry: 0.4 },
      { id: 'crate1', kind: 'prop', prop: 'crate', x: -4.3, y: 0, z: CANNON.z + 0.4, ry: 0.3 },
      { id: 'crate2', kind: 'prop', prop: 'crate', x: -4.2, y: 0.8, z: CANNON.z + 0.35, ry: 0.9, sx: 0.85 },
      // palms, plants and beach clutter around the arena
      { id: 'palm1', kind: 'palm', x: -9.6, y: -0.05, z: 4 },
      { id: 'palm2', kind: 'palm', x: 9.6, y: -0.05, z: 3, ry: 2 },
      { id: 'palm3', kind: 'prop', prop: 'palm2', x: -8.4, y: -0.05, z: 6.6, ry: 0.6 },
      { id: 'bush3', kind: 'prop', prop: 'bush', x: -9, y: 0, z: -3.2, sx: 0.9, ry: 2 },
      { id: 'palm4', kind: 'prop', prop: 'palm2', x: 8.6, y: -0.05, z: 6.2, ry: 4 },
      { id: 'bush1', kind: 'prop', prop: 'bush', x: -9.2, y: 0, z: 1.8, sx: 1.1 },
      { id: 'bush2', kind: 'prop', prop: 'bush', x: 9.1, y: 0, z: -1.6 },
      { id: 'fern1', kind: 'prop', prop: 'fern', x: 5.6, y: 0, z: 8.9, sx: 1.2 },
      { id: 'fern2', kind: 'prop', prop: 'fern', x: -6.5, y: 0, z: 7.4 },
      { id: 'shell1', kind: 'prop', prop: 'shell', x: -4, y: 0, z: -6.4 },
      { id: 'shell2', kind: 'prop', prop: 'shell', x: 4.5, y: 0, z: -6, ry: 2 },
      { id: 'drift', kind: 'prop', prop: 'driftwood', x: 6.5, y: 0, z: -5.4, ry: 2.4 },
      { id: 'rock1', kind: 'prop', prop: 'rocksmall', x: -6.8, y: 0, z: -5.2, sx: 1.6 },
      { id: 'crab', kind: 'prop', prop: 'crab', x: 1.5, y: 0, z: -6.3, ry: 3.4, sx: 0.4 },
      // crosshair: big, red, glowing ring – readable from the couch
      { id: 'cross', kind: 'torus', x: s.cross.x, y: 0.08, z: s.cross.z, sx: HIT_R * 2, sy: 1, sz: HIT_R * 2, color: '#ff3b3b', glow: true },
      { id: 'crossDot', kind: 'cylinder', x: s.cross.x, y: 0.05, z: s.cross.z, sx: 0.35, sy: 0.04, sz: 0.35, color: '#ff3b3b', glow: true },
    ];
    // corner and middle posts of the rope fence
    let n = 0;
    for (const px of [-1, 0, 1]) {
      for (const pz of [-1, 1]) {
        entities.push({ id: `post${n++}`, kind: 'cylinder', x: px * (AX + 0.7), y: 0.22, z: pz * (AZ + 0.7), sx: 0.16, sy: 0.44, sz: 0.16, color: '#8a5a32', mat: 'wood' });
      }
    }
    for (const px of [-1, 1]) entities.push({ id: `post${n++}`, kind: 'cylinder', x: px * (AX + 0.7), y: 0.22, z: 0, sx: 0.16, sy: 0.44, sz: 0.16, color: '#8a5a32', mat: 'wood' });
    s.ps.forEach((p, i) => {
      if (i === s.solo) {
        // the gunner stands next to the cannon on the mound (not hidden behind it)
        entities.push({ id: `p${i}`, kind: 'player', player: i, x: CANNON.x + 2, y: HILL, z: CANNON.z + 0.6, ry: p.ry, anim: s.booms.some((b) => b.hit && b.t > 0.3) ? 'cheer' : 'idle' });
        return;
      }
      // short protection after a hit: shown as a white ring (alpha toggles would rebuild the figure)
      if (p.inv > 0 && !p.out) entities.push({ id: `shield${i}`, kind: 'torus', x: p.x, y: 0.9, z: p.z, sx: 1.6, sy: 1, sz: 1.6, color: '#ffffff', glow: true });
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: p.x,
        y: 0,
        z: p.z,
        ry: p.ry,
        alpha: p.out ? 0.35 : undefined,
        anim: p.out ? 'sad' : p.inv > INVULN - 0.5 ? 'hit' : Math.hypot(p.vx, p.vz) > 0.6 ? 'walk' : 'idle',
        label: p.out ? '✖' : '♥'.repeat(p.lives),
      });
    });
    for (const sh of s.shells) {
      const f = 1 - sh.eta / FLIGHT; // 0 at the cannon, 1 on impact
      entities.push({
        id: `sh${sh.id}`,
        kind: 'coconut',
        x: lerp(CANNON.x, sh.x, f),
        y: lerp(2, 0.35, f) + Math.sin(f * Math.PI) * 5,
        z: lerp(CANNON.z, sh.z, f),
        ry: f * 8,
        sx: 1.3,
        sy: 1.3,
        sz: 1.3,
      });
      const r = (0.6 + f * 1.9) * HIT_R;
      entities.push({ id: `sd${sh.id}`, kind: 'cylinder', x: sh.x, y: 0.03, z: sh.z, sx: r, sy: 0.02, sz: r, color: '#222222', alpha: 0.25 + f * 0.3 });
    }
    for (const b of s.booms) {
      if (!b.hit) continue;
      entities.push({ id: `bm${b.id}`, kind: 'star', x: b.x, y: 0.8 + (0.6 - b.t) * 3, z: b.z, alpha: Math.min(0.95, b.t * 2), sx: b.hit ? 1.4 : 0.8, sy: b.hit ? 1.4 : 0.8, sz: b.hit ? 1.4 : 0.8, color: b.hit ? '#ff5a3d' : '#d9c48a' });
    }
    const live = alive(s).length;
    return {
      env: 'water',
      scenery: { set: 'lagoon', clear: { r: 15, z: IZ }, water: WATER },
      camera: { alpha: -Math.PI / 2, beta: 0.8, radius: 25, target: [0, 0, 1] },
      entities,
      fx: viewFx(s),
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: [
          { team: 0, labelKey: 'team.solo', value: `💥 ${s.hits}` },
          { team: 1, labelKey: 'team.trio', value: `${live}/3` },
        ],
        scores: s.trio.map((i) => ({ player: i, value: s.ps[i].out ? '✖' : '♥'.repeat(s.ps[i].lives) })),
        message: s.t < FIRST_SHOT && !s.practice ? { key: 'mg.kokosKanonier.go' } : undefined,
      },
    };
  },
};
