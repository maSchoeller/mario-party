import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { clamp, dist2, faceAngle, lerp, moveWithStick, skill, steerTo, teamRanks } from '../util';

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
const HIT_R = 1.75;
const LIVES = 2;
const INVULN = 1.2;
const CANNON = { x: 0, z: AZ + 3.2 };
const DURATION = 40;
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

export interface KokosKanonierState {
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
    };
  },
  layout(s, i) {
    if (i === s.solo) return { kind: 'tilt', labelKey: 'ctrl.aimTilt' };
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
    // crosshair: tilt = velocity (works for gyro and slider fallback alike)
    const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
    s.cross.x = clamp(s.cross.x + dz(s.tilt.x) * CROSS_SPEED * dt, -AX, AX);
    s.cross.z = clamp(s.cross.z + dz(s.tilt.y) * CROSS_SPEED * dt, -AZ, AZ);
    // automatic fire
    s.fireIn -= dt;
    if (s.fireIn <= 0) {
      s.fireIn = lerp(FIRE_START, FIRE_END, clamp(s.t / s.duration, 0, 1));
      s.shells.push({ id: s.nextId++, x: s.cross.x, z: s.cross.z, eta: FLIGHT });
    }
    // trio movement
    for (const i of s.trio) {
      const p = s.ps[i];
      if (p.out) {
        if (s.practice && (p.revive -= dt) <= 0) {
          p.out = false;
          p.lives = LIVES;
          p.inv = INVULN;
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
        if (p.lives <= 0) {
          p.out = true;
          p.revive = 2;
          p.vx = 0;
          p.vz = 0;
        }
      }
      s.booms.push({ id: sh.id, x: sh.x, z: sh.z, t: 0.6, hit });
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
    const entities: MgEntity[] = [
      { id: 'sand', kind: 'box', x: 0, y: -0.25, z: 0, sx: AX * 2 + 1.5, sy: 0.5, sz: AZ * 2 + 1.5, color: '#efe2c0' },
      { id: 'hill', kind: 'cylinder', x: CANNON.x, y: 0.3, z: CANNON.z + 0.6, sx: 5, sy: 0.6, sz: 3.6, color: '#b9a27a' },
      { id: 'cannonBase', kind: 'box', x: CANNON.x, y: 0.9, z: CANNON.z, sx: 1.6, sy: 0.7, sz: 1.4, color: '#7a5c45' },
      {
        id: 'cannon',
        kind: 'cylinder',
        x: CANNON.x,
        y: 1.6,
        z: CANNON.z,
        sx: 0.9,
        sy: 2.2,
        sz: 0.9,
        rx: Math.PI / 2 - 0.35,
        ry: Math.atan2(aimDx, aimDz),
        color: '#3b3b46',
      },
      { id: 'palm1', kind: 'palm', x: -AX - 2, y: 0, z: AZ - 1 },
      { id: 'palm2', kind: 'palm', x: AX + 2, y: 0, z: AZ - 2 },
      { id: 'palm3', kind: 'palm', x: -AX - 1.5, y: 0, z: -AZ + 1 },
      // crosshair: big, red, glowing ring – readable from the couch
      { id: 'cross', kind: 'torus', x: s.cross.x, y: 0.08, z: s.cross.z, sx: HIT_R * 2, sy: 1, sz: HIT_R * 2, color: '#ff3b3b', glow: true },
      { id: 'crossDot', kind: 'cylinder', x: s.cross.x, y: 0.05, z: s.cross.z, sx: 0.35, sy: 0.04, sz: 0.35, color: '#ff3b3b', glow: true },
    ];
    s.ps.forEach((p, i) => {
      if (i === s.solo) {
        entities.push({ id: `p${i}`, kind: 'player', player: i, x: p.x, y: 0.6, z: p.z, ry: p.ry, anim: s.booms.some((b) => b.hit && b.t > 0.3) ? 'cheer' : 'idle' });
        return;
      }
      const blink = p.inv > 0 && !p.out && Math.floor(p.inv * 8) % 2 === 0;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: p.x,
        y: 0,
        z: p.z,
        ry: p.ry,
        alpha: p.out ? 0.35 : blink ? 0.5 : 1,
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
      entities.push({ id: `bm${b.id}`, kind: 'star', x: b.x, y: 0.8 + (0.6 - b.t) * 3, z: b.z, alpha: Math.min(1, b.t * 2), sx: b.hit ? 1.4 : 0.8, sy: b.hit ? 1.4 : 0.8, sz: b.hit ? 1.4 : 0.8, color: b.hit ? '#ff5a3d' : '#d9c48a' });
    }
    const live = alive(s).length;
    return {
      env: 'water',
      camera: { alpha: -Math.PI / 2, beta: 0.8, radius: 25, target: [0, 0, 1] },
      entities,
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
