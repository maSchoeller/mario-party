import type { Rng } from '../../rng';
import type { MgEntity, MgInput, MgPlayer, MinigameDef } from '../types';
import { clamp, faceAngle, lerp, skill, teamRanks } from '../util';

/**
 * #15 Wand-Labyrinth (1 vs 3, Wischen vs. Joystick): the trio walks through a grid maze
 * (cell by cell) looking for the exit. The solo swipes to shift the movable walls:
 * left/right moves all orange wall pieces, up/down all purple ones (with cooldown).
 * The maze is generated so that in every wall position every cell stays connected to
 * the exit – the solo can only force detours, never lock somebody in.
 * Trio wins as soon as one of them reaches the exit; solo wins when time runs out.
 */
const CW = 11; // cells in x
const CH = 7; // cells in z
const TW = CW * 2 + 1; // tiles
const TH = CH * 2 + 1;
const TS = 1.1; // tile size (world units)
// seconds per cell at full stick (not too fast: the solo needs time to react, MINI-03)
const STEP_TIME = 0.44;
const COOLDOWN = 0.8;
const SLIDE_TIME = 0.25;
const DURATION = 40;
const N_SLIDERS = 10; // per axis
const BRAID = 0.03;
/** maze generator: weight of the trio's shortest route (no short cuts) and number of tries */
const ROUTE_WEIGHT = 3;
const ATTEMPTS = 20;
const WALL_H = 1.3;
const COLOR_H = '#ff9f43';
const COLOR_V = '#a66bff';

type Cell = [number, number];

interface Slider {
  /** 'h' = moves along x (swipe left/right), 'v' = moves along z (swipe up/down) */
  axis: 'h' | 'v';
  /** tile position at pos 0 (left / down); pos 1 is +2 tiles along the axis */
  x: number;
  y: number;
}

interface P {
  cx: number;
  cy: number;
  /** cell we are walking to (== cx/cy when standing) */
  tx: number;
  ty: number;
  prog: number;
  /** step duration for the current step */
  stepTime: number;
  stick: { x: number; y: number };
  ry: number;
  /** bot memory */
  think: number;
  path: Cell[];
}

export interface WandLabyrinthState {
  t: number;
  duration: number;
  practice: boolean;
  players: MgPlayer[];
  solo: number;
  trio: number[];
  /** fixed walls (1) and floor (0), TW*TH */
  walls: number[];
  sliders: Slider[];
  /** wall group positions (0/1) and their animated value */
  hPos: number;
  vPos: number;
  hAnim: number;
  vAnim: number;
  cooldown: number;
  exit: Cell;
  starts: Cell[];
  ps: P[];
  swipes: number;
  won: number | null;
  /** bot memory for the solo */
  botThink: number;
}

const tileIdx = (x: number, y: number) => y * TW + x;
const worldX = (tx: number) => (tx - (TW - 1) / 2) * TS;
const worldZ = (ty: number) => (ty - (TH - 1) / 2) * TS;

/** Is the tile blocked for the given wall group positions? */
function blocked(walls: number[], sliders: Slider[], hPos: number, vPos: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= TW || y >= TH || walls[tileIdx(x, y)]) return true;
  for (const sl of sliders) {
    const pos = sl.axis === 'h' ? hPos : vPos;
    const sx = sl.x + (sl.axis === 'h' ? pos * 2 : 0);
    const sy = sl.y + (sl.axis === 'v' ? pos * 2 : 0);
    if (sx === x && sy === y) return true;
  }
  return false;
}

const DIRS: Cell[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** BFS distances (in cells) from the exit for one wall configuration. -1 = unreachable. */
function distances(walls: number[], sliders: Slider[], hPos: number, vPos: number, exit: Cell): number[] {
  const d = new Array<number>(CW * CH).fill(-1);
  const q: Cell[] = [exit];
  d[exit[1] * CW + exit[0]] = 0;
  for (let k = 0; k < q.length; k++) {
    const [cx, cy] = q[k];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= CW || ny >= CH || d[ny * CW + nx] >= 0) continue;
      if (blocked(walls, sliders, hPos, vPos, cx * 2 + 1 + dx, cy * 2 + 1 + dy)) continue;
      d[ny * CW + nx] = d[cy * CW + cx] + 1;
      q.push([nx, ny]);
    }
  }
  return d;
}

function generate(rng: Rng): { walls: number[]; sliders: Slider[]; exit: Cell; starts: Cell[] } {
  const starts: Cell[] = [
    [0, 1],
    [0, 3],
    [0, 5],
  ];
  let best: { walls: number[]; sliders: Slider[]; exit: Cell; starts: Cell[] } | null = null;
  let bestImpact = -1;
  for (let attempt = 0; attempt < 40 && (bestImpact < 0 || attempt < ATTEMPTS); attempt++) {
    const walls = new Array<number>(TW * TH).fill(1);
    // perfect maze by randomized depth-first search
    const seen = new Array<boolean>(CW * CH).fill(false);
    const stack: Cell[] = [[rng.int(0, CW - 1), rng.int(0, CH - 1)]];
    seen[stack[0][1] * CW + stack[0][0]] = true;
    walls[tileIdx(stack[0][0] * 2 + 1, stack[0][1] * 2 + 1)] = 0;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = DIRS.filter(([dx, dy]) => {
        const nx = cx + dx;
        const ny = cy + dy;
        return nx >= 0 && ny >= 0 && nx < CW && ny < CH && !seen[ny * CW + nx];
      });
      if (!opts.length) {
        stack.pop();
        continue;
      }
      const [dx, dy] = rng.pick(opts);
      const nx = cx + dx;
      const ny = cy + dy;
      seen[ny * CW + nx] = true;
      walls[tileIdx(cx * 2 + 1 + dx, cy * 2 + 1 + dy)] = 0;
      walls[tileIdx(nx * 2 + 1, ny * 2 + 1)] = 0;
      stack.push([nx, ny]);
    }
    const exit: Cell = [CW - 1, rng.int(1, CH - 2)];
    // movable walls: two neighbouring slots in the same wall line, exactly one of them is
    // a passage of the maze. Moving the wall closes that passage and opens the other one,
    // so every wall position is again a proper maze. Placed one by one; a wall is only
    // kept if every cell stays connected to the exit in all four wall positions.
    const used = new Set<number>();
    const sliders: Slider[] = [];
    const cands: Slider[] = [];
    for (let y = 2; y < TH - 2; y += 2) for (let x = 1; x + 2 < TW - 1; x += 2) cands.push({ axis: 'h', x, y });
    for (let x = 2; x < TW - 2; x += 2) for (let y = 1; y + 2 < TH - 1; y += 2) cands.push({ axis: 'v', x, y });
    rng.shuffle(cands);
    const count = { h: 0, v: 0 };
    const allConnected = () => {
      for (const h of [0, 1]) for (const v of [0, 1]) if (distances(walls, sliders, h, v, exit).some((x) => x < 0)) return false;
      return true;
    };
    for (const c of cands) {
      if (count[c.axis] >= N_SLIDERS) continue;
      const ta = tileIdx(c.x, c.y);
      const tb = c.axis === 'h' ? tileIdx(c.x + 2, c.y) : tileIdx(c.x, c.y + 2);
      const mid = c.axis === 'h' ? tileIdx(c.x + 1, c.y) : tileIdx(c.x, c.y + 1);
      if (used.has(ta) || used.has(tb) || used.has(mid)) continue;
      if (walls[ta] === walls[tb]) continue;
      const before = [walls[ta], walls[tb]];
      walls[ta] = 0;
      walls[tb] = 0;
      sliders.push(c);
      if (!allConnected()) {
        sliders.pop();
        walls[ta] = before[0];
        walls[tb] = before[1];
        continue;
      }
      used.add(ta).add(tb).add(mid);
      count[c.axis]++;
    }
    // optional extra loops (on fixed walls only)
    for (let y = 1; y < TH - 1; y++) {
      for (let x = 1; x < TW - 1; x++) {
        if ((x + y) % 2 === 1 && walls[tileIdx(x, y)] && !used.has(tileIdx(x, y)) && rng.chance(BRAID)) walls[tileIdx(x, y)] = 0;
      }
    }
    let impact = 0;
    const per: number[][] = [];
    for (const h of [0, 1]) {
      for (const v of [0, 1]) {
        const d = distances(walls, sliders, h, v, exit);
        per.push(starts.map(([x, y]) => d[y * CW + x]));
      }
    }
    // how much can the solo stretch the routes? (bigger = more interesting)
    for (let k = 0; k < starts.length; k++) {
      const ds = per.map((p) => p[k]);
      impact += Math.max(...ds) - Math.min(...ds);
    }
    // and no short cut: the shortest route of the trio counts too (MINI-03 play time)
    impact += Math.min(...per.flat()) * ROUTE_WEIGHT;
    if (impact > bestImpact) {
      bestImpact = impact;
      best = { walls, sliders, exit, starts };
    }
  }
  if (best) return best;
  // fallback (practically never): plain open grid without movable walls
  const walls = new Array<number>(TW * TH).fill(0).map((_, k) => {
    const x = k % TW;
    const y = Math.floor(k / TW);
    return x === 0 || y === 0 || x === TW - 1 || y === TH - 1 || (x % 2 === 0 && y % 2 === 0) ? 1 : 0;
  });
  return { walls, sliders: [], exit: [CW - 1, 3], starts };
}

function cellOf(p: P): Cell {
  return p.prog > 0 ? [p.tx, p.ty] : [p.cx, p.cy];
}

function isBlocked(s: WandLabyrinthState, x: number, y: number): boolean {
  return blocked(s.walls, s.sliders, s.hPos, s.vPos, x, y);
}

/** Smallest number of steps any trio member still needs (for HUD and solo bot). */
function trioDistance(s: WandLabyrinthState, hPos: number, vPos: number): number {
  const d = distances(s.walls, s.sliders, hPos, vPos, s.exit);
  return Math.min(...s.trio.map((i) => d[cellOf(s.ps[i])[1] * CW + cellOf(s.ps[i])[0]]));
}

function applySwipe(s: WandLabyrinthState, dir: 'up' | 'down' | 'left' | 'right'): boolean {
  const h = dir === 'left' ? 0 : dir === 'right' ? 1 : s.hPos;
  const v = dir === 'down' ? 0 : dir === 'up' ? 1 : s.vPos;
  if (h === s.hPos && v === s.vPos) return false;
  s.hPos = h;
  s.vPos = v;
  s.cooldown = COOLDOWN;
  s.swipes++;
  // somebody walking through a gap that just closed bounces back
  for (const i of s.trio) {
    const p = s.ps[i];
    if (p.prog <= 0) continue;
    if (isBlocked(s, p.cx + p.tx + 1, p.cy + p.ty + 1)) {
      [p.cx, p.tx] = [p.tx, p.cx];
      [p.cy, p.ty] = [p.ty, p.cy];
      p.prog = 1 - p.prog;
    }
  }
  return true;
}

export const wandLabyrinth: MinigameDef<WandLabyrinthState> = {
  id: 'wandLabyrinth',
  format: '1v3',
  control: 'draw',
  theme: 'any',
  duration: DURATION,
  setup(players, rng, opts) {
    const solo = Math.max(0, players.findIndex((p) => p.team === 0));
    const trio = players.map((_, i) => i).filter((i) => i !== solo);
    const g = generate(rng);
    const ps: P[] = players.map(() => ({ cx: 0, cy: 0, tx: 0, ty: 0, prog: 0, stepTime: STEP_TIME, stick: { x: 0, y: 0 }, ry: faceAngle(1, 0), think: 0, path: [] }));
    trio.forEach((i, k) => {
      const [x, y] = g.starts[k];
      Object.assign(ps[i], { cx: x, cy: y, tx: x, ty: y });
    });
    return {
      t: 0,
      duration: DURATION,
      practice: opts.practice,
      players,
      solo,
      trio,
      walls: g.walls,
      sliders: g.sliders,
      hPos: 0,
      vPos: 0,
      hAnim: 0,
      vAnim: 0,
      cooldown: 1,
      exit: g.exit,
      starts: g.starts,
      ps,
      swipes: 0,
      won: null,
      botThink: 0,
    };
  },
  layout(s, i) {
    // constant label: a changing label would remount the swipe pad on the phone
    if (i === s.solo) return { kind: 'swipe', labelKey: 'ctrl.swipeWalls' };
    return { kind: 'joystick' };
  },
  input(s, i, input: MgInput) {
    if (i === s.solo) {
      if (input.type === 'swipe' && s.cooldown <= 0 && s.won === null) applySwipe(s, input.dir);
      return;
    }
    if (input.type === 'stick') s.ps[i].stick = { x: clamp(input.x, -1, 1), y: clamp(input.y, -1, 1) };
  },
  tick(s, dt) {
    s.t += dt;
    s.cooldown = Math.max(0, s.cooldown - dt);
    const slide = dt / SLIDE_TIME;
    s.hAnim = s.hAnim < s.hPos ? Math.min(s.hPos, s.hAnim + slide) : Math.max(s.hPos, s.hAnim - slide);
    s.vAnim = s.vAnim < s.vPos ? Math.min(s.vPos, s.vAnim + slide) : Math.max(s.vPos, s.vAnim - slide);
    if (s.won !== null) return;
    for (const i of s.trio) {
      const p = s.ps[i];
      if (p.prog > 0) {
        p.prog += dt / p.stepTime;
        if (p.prog >= 1) {
          p.cx = p.tx;
          p.cy = p.ty;
          p.prog = 0;
          if (p.cx === s.exit[0] && p.cy === s.exit[1]) {
            if (s.practice) {
              const [x, y] = s.starts[s.trio.indexOf(i)];
              Object.assign(p, { cx: x, cy: y, tx: x, ty: y, path: [] });
            } else {
              s.won = i;
              return;
            }
          }
        }
        continue;
      }
      const mag = Math.hypot(p.stick.x, p.stick.y);
      if (mag < 0.4) continue;
      // main direction first, then the other axis (makes corners forgiving)
      const ax: Cell = [Math.sign(p.stick.x), 0];
      const az: Cell = [0, Math.sign(p.stick.y)];
      const order = Math.abs(p.stick.x) >= Math.abs(p.stick.y) ? [ax, az] : [az, ax];
      const minor = Math.min(Math.abs(p.stick.x), Math.abs(p.stick.y));
      for (let k = 0; k < 2; k++) {
        const [dx, dy] = order[k];
        if (dx === 0 && dy === 0) continue;
        if (k === 1 && minor < 0.25) break;
        if (isBlocked(s, p.cx * 2 + 1 + dx, p.cy * 2 + 1 + dy)) continue;
        p.tx = p.cx + dx;
        p.ty = p.cy + dy;
        p.stepTime = STEP_TIME / clamp(mag, 0.6, 1);
        p.prog = 0.0001;
        p.ry = faceAngle(dx, dy);
        break;
      }
    }
  },
  isOver: (s) => !s.practice && (s.won !== null || s.t >= s.duration),
  result: (s) => teamRanks(s.players, [s.won !== null ? 1 : 0]),
  bot(s, i, level, rng, dt) {
    const sk = skill(level);
    if (i === s.solo) {
      if (s.cooldown > 0) return [];
      s.botThink -= dt;
      if (s.botThink > 0) return [];
      s.botThink = sk.reaction * (0.7 + rng.next() * 0.6);
      const now = trioDistance(s, s.hPos, s.vPos);
      const opts: { dir: 'up' | 'down' | 'left' | 'right'; d: number }[] = [
        { dir: s.hPos ? 'left' : 'right', d: trioDistance(s, 1 - s.hPos, s.vPos) },
        { dir: s.vPos ? 'down' : 'up', d: trioDistance(s, s.hPos, 1 - s.vPos) },
        { dir: s.hPos ? 'left' : 'right', d: trioDistance(s, 1 - s.hPos, 1 - s.vPos) },
      ];
      // the diagonal option needs two swipes; only count the first one at half value
      opts[2].d = now + (opts[2].d - now) * 0.5;
      opts.sort((a, b) => b.d - a.d);
      if (rng.chance({ easy: 0.35, medium: 0.12, hard: 0.03 }[level])) {
        // sloppy: sometimes swipe at random
        return rng.chance(0.3) ? [{ type: 'swipe', dir: rng.pick(['up', 'down', 'left', 'right'] as const) }] : [];
      }
      if (opts[0].d > now) return [{ type: 'swipe', dir: opts[0].dir }];
      return [];
    }
    const p = s.ps[i];
    p.think -= dt;
    const cur = cellOf(p);
    if (p.think <= 0) {
      p.think = sk.reaction * (0.7 + rng.next() * 0.6);
      // plan the shortest way for the walls as they are now
      const d = distances(s.walls, s.sliders, s.hPos, s.vPos, s.exit);
      const path: Cell[] = [];
      let [x, y] = cur;
      for (let guard = 0; guard < CW * CH && d[y * CW + x] > 0; guard++) {
        const nexts = DIRS.map(([dx, dy]) => [x + dx, y + dy] as Cell).filter(
          ([nx, ny]) => nx >= 0 && ny >= 0 && nx < CW && ny < CH && d[ny * CW + nx] === d[y * CW + x] - 1 && !isBlocked(s, x + nx + 1, y + ny + 1),
        );
        if (!nexts.length) break;
        [x, y] = rng.pick(nexts);
        path.push([x, y]);
      }
      p.path = path;
      // weaker bots sometimes take a wrong turn
      if (rng.chance({ easy: 0.3, medium: 0.12, hard: 0.04 }[level])) {
        const open = DIRS.filter(([dx, dy]) => !isBlocked(s, cur[0] * 2 + 1 + dx, cur[1] * 2 + 1 + dy));
        if (open.length) {
          const [dx, dy] = rng.pick(open);
          p.path = [[cur[0] + dx, cur[1] + dy]];
        }
      }
    }
    if (p.prog > 0) {
      // keep pushing towards the next planned cell
      while (p.path.length && p.path[0][0] === p.tx && p.path[0][1] === p.ty) p.path.shift();
      return [];
    }
    while (p.path.length && p.path[0][0] === p.cx && p.path[0][1] === p.cy) p.path.shift();
    const next = p.path[0];
    if (!next) return [{ type: 'stick', x: 0, y: 0 }];
    const dx = clamp(next[0] - p.cx, -1, 1);
    const dy = clamp(next[1] - p.cy, -1, 1);
    const f = { easy: 0.8, medium: 0.9, hard: 1 }[level];
    return [{ type: 'stick', x: dx * f, y: dy * f }];
  },
  view(s) {
    const entities: MgEntity[] = [
      { id: 'floor', kind: 'box', x: 0, y: -0.25, z: 0, sx: TW * TS + 1, sy: 0.5, sz: TH * TS + 1, color: '#d9cfb8' },
    ];
    // fixed walls, merged into horizontal runs (fewer, bigger objects)
    for (let y = 0; y < TH; y++) {
      let x = 0;
      while (x < TW) {
        if (!s.walls[tileIdx(x, y)]) {
          x++;
          continue;
        }
        let e = x;
        while (e + 1 < TW && s.walls[tileIdx(e + 1, y)]) e++;
        entities.push({
          id: `w${y}-${x}`,
          kind: 'box',
          x: (worldX(x) + worldX(e)) / 2,
          y: WALL_H / 2,
          z: worldZ(y),
          sx: (e - x + 1) * TS,
          sy: WALL_H,
          sz: TS,
          color: '#6d7a8c',
        });
        x = e + 1;
      }
    }
    s.sliders.forEach((sl, k) => {
      const a = sl.axis === 'h' ? s.hAnim : s.vAnim;
      entities.push({
        id: `sl${k}`,
        kind: 'box',
        x: worldX(sl.x + (sl.axis === 'h' ? a * 2 : 0)),
        y: WALL_H / 2 + 0.05,
        z: worldZ(sl.y + (sl.axis === 'v' ? a * 2 : 0)),
        sx: TS * 0.98,
        sy: WALL_H + 0.1,
        sz: TS * 0.98,
        color: sl.axis === 'h' ? COLOR_H : COLOR_V,
        glow: true,
      });
      // rail showing where the wall can slide
      entities.push({
        id: `rail${k}`,
        kind: 'box',
        x: worldX(sl.x + (sl.axis === 'h' ? 1 : 0)),
        y: 0.03,
        z: worldZ(sl.y + (sl.axis === 'v' ? 1 : 0)),
        sx: sl.axis === 'h' ? TS * 3 : TS * 0.3,
        sy: 0.04,
        sz: sl.axis === 'v' ? TS * 3 : TS * 0.3,
        color: sl.axis === 'h' ? COLOR_H : COLOR_V,
        alpha: 0.6,
      });
    });
    const ex = worldX(s.exit[0] * 2 + 1);
    const ez = worldZ(s.exit[1] * 2 + 1);
    entities.push({ id: 'exitPad', kind: 'cylinder', x: ex, y: 0.03, z: ez, sx: TS * 0.95, sy: 0.05, sz: TS * 0.95, color: '#5cc08a', glow: true });
    entities.push({ id: 'exitStar', kind: 'star', x: ex, y: 1.6, z: ez, sx: 1.1, sy: 1.1, sz: 1.1, color: '#ffd23f', glow: true });
    for (const i of s.trio) {
      const p = s.ps[i];
      const f = p.prog;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: lerp(worldX(p.cx * 2 + 1), worldX(p.tx * 2 + 1), f),
        y: 0,
        z: lerp(worldZ(p.cy * 2 + 1), worldZ(p.ty * 2 + 1), f),
        ry: p.ry,
        sx: 0.8,
        sy: 0.8,
        sz: 0.8,
        anim: s.won === i ? 'cheer' : s.won !== null ? 'idle' : p.prog > 0 ? 'walk' : 'idle',
      });
    }
    // the solo watches from above the maze (top edge of the TV)
    entities.push({
      id: `p${s.solo}`,
      kind: 'player',
      player: s.solo,
      x: 0,
      y: 0,
      z: worldZ(TH - 1) + 2.2,
      ry: 0,
      anim: s.won !== null ? 'sad' : s.cooldown > COOLDOWN - 0.4 ? 'jump' : !s.practice && s.t >= s.duration ? 'cheer' : 'idle',
    });
    const left = trioDistance(s, s.hPos, s.vPos);
    return {
      env: 'grass',
      camera: { alpha: -Math.PI / 2, beta: 0.45, radius: 31, target: [0, 0, 0.8] },
      entities,
      hud: {
        timer: s.practice ? undefined : Math.max(0, s.duration - s.t),
        teams: [
          { team: 0, labelKey: 'team.solo', value: s.cooldown > 0 ? '⏳' : '👆' },
          { team: 1, labelKey: 'team.trio', value: `🏁 ${left}` },
        ],
        message: s.won !== null ? { key: 'mg.wandLabyrinth.escaped' } : undefined,
      },
    };
  },
};
