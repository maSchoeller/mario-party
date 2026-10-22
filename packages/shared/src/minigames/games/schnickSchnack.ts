import type { BotLevel } from '../../config';
import type { Rng } from '../../rng';
import type { ControllerLayout, MgEntity, MgHud, MinigameDef } from '../types';
import { ageFx, emitFx, viewFx, type FxState } from '../util';

/**
 * #19 Schnick-Schnack-Schnuck Deluxe (Duell, Auswahl): both players secretly pick
 * rock/paper/scissors within a countdown, then the TV reveals both hands. First to 3
 * points wins. No pick until the countdown ends = random pick.
 * Emergency brake: from OVERTIME on, the next decided round ends the game (leader wins);
 * at HARD_CAP a tie is decided by lot (rng).
 */
export type Hand = 'rock' | 'paper' | 'scissors';
export const HANDS: Hand[] = ['rock', 'paper', 'scissors'];
/** hand → hand it beats */
const BEATS: Record<Hand, Hand> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
/** hand → hand that beats it */
const COUNTER: Record<Hand, Hand> = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
const ICON: Record<Hand, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
const HAND_COLOR: Record<Hand, string> = { rock: '#9a8f88', paper: '#f4f1e8', scissors: '#5f8fe0' };

const TARGET = 3;
const CHOOSE = 5; // visible countdown
const GRACE = 0.25; // accept picks that arrive slightly after the countdown
const PRE_REVEAL = 0.4; // short pause once both have picked
const SHAKE = 1.2; // "Schnick … Schnack … Schnuck!"
const SHOW = 1.8; // hands visible, point awarded
const OVERTIME = 45;
const HARD_CAP = 55;
/** decor: deck height, hand height, hand x per side */
const DECK = 0.3;
const HAND_Y = 2.8;
const HAND_X = [-1.5, 1.5];
const PLAYER_X = [-3.2, 3.2];
/** the beach set levels the sand inside the play area to −0.04 (props stand on it) */
const SAND = -0.04;

export interface SchnickSchnackState extends FxState {
  t: number;
  practice: boolean;
  phase: 'choose' | 'reveal' | 'done';
  phaseStart: number;
  /** choose phase: time when the countdown ends */
  deadline: number;
  round: number;
  wins: [number, number];
  picks: [Hand | null, Hand | null];
  /** pick was made randomly because the countdown ran out */
  auto: [boolean, boolean];
  /** picks of all revealed rounds (bots look for patterns) */
  hist: [Hand[], Hand[]];
  roundWinner: number | null;
  suddenDeath: boolean;
  /** set when the hard cap had to decide by lot */
  lotWinner: number | null;
  /** both picked: reveal starts at this time */
  revealAt: number | null;
  /** bots: time of their planned pick */
  botAt: [number | null, number | null];
}

function winnerOf(a: Hand, b: Hand): number | null {
  if (a === b) return null;
  return BEATS[a] === b ? 0 : 1;
}

/** Predicts the opponent's next hand from simple patterns (repeat / favourite). */
export function predictHand(h: Hand[]): Hand | null {
  if (h.length < 2) return null;
  let repeats = 0;
  for (let k = 1; k < h.length; k++) if (h[k] === h[k - 1]) repeats++;
  const repeatRate = repeats / (h.length - 1);
  if (repeatRate >= 0.4) return h[h.length - 1];
  const counts = HANDS.map((x) => h.filter((y) => y === x).length);
  const max = Math.max(...counts);
  if (max / h.length > 0.45) return HANDS[counts.indexOf(max)];
  return null;
}

/** Bot choice: easy has a (exploitable) habit of repeating itself, medium/hard exploit patterns. */
export function botHand(s: SchnickSchnackState, i: number, level: BotLevel, rng: Rng): Hand {
  const own = s.hist[i];
  if (level === 'easy') {
    if (own.length && rng.chance(0.45)) return own[own.length - 1];
    return rng.pick(HANDS);
  }
  const exploit = level === 'hard' ? 0.6 : 0.35;
  if (rng.chance(exploit)) {
    const pred = predictHand(s.hist[1 - i]);
    if (pred) return COUNTER[pred];
  }
  return rng.pick(HANDS);
}

function startChoose(s: SchnickSchnackState): void {
  s.phase = 'choose';
  s.phaseStart = s.t;
  s.deadline = s.t + CHOOSE;
  s.picks = [null, null];
  s.auto = [false, false];
  s.roundWinner = null;
  s.revealAt = null;
  s.botAt = [null, null];
}

function finish(s: SchnickSchnackState, rng: Rng): void {
  if (s.wins[0] === s.wins[1]) {
    s.lotWinner = rng.int(0, 1);
    emitFx(s, { kind: 'sparkle', sfx: 'magic', x: PLAYER_X[s.lotWinner], y: 2.6, z: 0, s: 1.4 }, 0.5);
  }
  s.phase = 'done';
}

/** Hands are shown: the winning hand sparkles, the losing one gets wrapped / cut / smashed. */
function revealFx(s: SchnickSchnackState): void {
  const w = s.roundWinner;
  if (w === null) {
    emitFx(s, { kind: 'ring', sfx: 'ding', x: 0, y: HAND_Y, z: 0, s: 1.2 });
    return;
  }
  const l = 1 - w;
  const lost = s.picks[l];
  emitFx(s, { kind: 'sparkle', sfx: 'correct', x: HAND_X[w], y: HAND_Y, z: 0, s: 1.3 }, 0.45);
  if (lost === 'paper') emitFx(s, { kind: 'pop', sfx: 'crack', x: HAND_X[l], y: HAND_Y, z: 0 }, 0.45);
  else if (lost === 'scissors') emitFx(s, { kind: 'hit', sfx: 'thud', x: HAND_X[l], y: HAND_Y, z: 0, color: '#9fc0f0' }, 0.45);
  else emitFx(s, { kind: 'smoke', sfx: 'whoosh', x: HAND_X[l], y: HAND_Y, z: 0, s: 0.6, color: '#f4f1e8' }, 0.45);
}

export const schnickSchnack: MinigameDef<SchnickSchnackState> = {
  id: 'schnickSchnack',
  format: 'duel',
  control: 'draw',
  theme: 'any',
  duration: 50,
  setup(_players, _rng, opts) {
    const s: SchnickSchnackState = {
      t: 0,
      practice: opts.practice,
      phase: 'choose',
      phaseStart: 0,
      deadline: CHOOSE,
      round: 1,
      wins: [0, 0],
      picks: [null, null],
      auto: [false, false],
      hist: [[], []],
      fx: [],
      fxN: 0,
      roundWinner: null,
      suddenDeath: false,
      lotWinner: null,
      revealAt: null,
      botAt: [null, null],
    };
    startChoose(s);
    return s;
  },
  layout(s, i): ControllerLayout {
    if (s.phase !== 'choose') return { kind: 'wait', labelKey: 'ctrl.watch' };
    return {
      kind: 'choice',
      options: HANDS.map((h) => ({ id: h, labelKey: `ctrl.${h}`, icon: ICON[h], color: HAND_COLOR[h] })),
      locked: s.picks[i],
    };
  },
  input(s, i, input) {
    if (input.type !== 'choice' || s.phase !== 'choose' || s.picks[i] !== null) return;
    if (!(HANDS as string[]).includes(input.id)) return;
    if (s.t > s.deadline + GRACE) return;
    s.picks[i] = input.id as Hand;
    // the marker above the head lights up (the pick itself stays secret)
    emitFx(s, { kind: 'pop', sfx: 'click', x: PLAYER_X[i], y: 2.5 + DECK, z: 0, color: '#5cc08a', s: 0.6 });
    if (s.picks[0] !== null && s.picks[1] !== null) s.revealAt = s.t + PRE_REVEAL;
  },
  tick(s, dt, rng) {
    s.t += dt;
    ageFx(s, dt);
    if (s.phase === 'done') return;
    if (!s.practice && s.t >= HARD_CAP) {
      finish(s, rng);
      return;
    }
    if (s.phase === 'choose') {
      const timeout = s.t >= s.deadline + GRACE;
      if (timeout) {
        for (const i of [0, 1]) {
          if (s.picks[i] === null) {
            s.picks[i] = rng.pick(HANDS);
            s.auto[i] = true;
          }
        }
      }
      // short pause once both picked so the "locked" state is visible
      if ((s.revealAt !== null && s.t >= s.revealAt) || timeout) {
        const a = s.picks[0]!;
        const b = s.picks[1]!;
        s.roundWinner = winnerOf(a, b);
        if (s.roundWinner !== null) s.wins[s.roundWinner]++;
        s.hist[0].push(a);
        s.hist[1].push(b);
        s.phase = 'reveal';
        s.phaseStart = s.t;
        emitFx(s, { kind: 'dust', sfx: 'swing', x: 0, y: HAND_Y, z: 0, s: 0.5 });
      }
      return;
    }
    // reveal: "Schnick … Schnack …" – the fists hit bottom, then "Schnuck!" shows the hands
    const rt = s.t - s.phaseStart;
    for (const beat of [SHAKE / 3, (SHAKE * 2) / 3]) {
      if (rt - dt < beat && rt >= beat) emitFx(s, { kind: 'dust', sfx: 'stomp', x: 0, y: HAND_Y - 0.3, z: 0, s: 0.4 });
    }
    if (rt - dt < SHAKE && rt >= SHAKE) revealFx(s);
    if (rt < SHAKE + SHOW) return;
    if (s.practice) {
      if (s.wins[0] >= TARGET || s.wins[1] >= TARGET) s.wins = [0, 0];
    } else {
      if (s.wins[0] >= TARGET || s.wins[1] >= TARGET) return finish(s, rng);
      if (s.t >= OVERTIME) {
        if (s.wins[0] !== s.wins[1]) return finish(s, rng);
        s.suddenDeath = true;
      }
    }
    s.round++;
    startChoose(s);
  },
  isOver: (s) => s.phase === 'done',
  result(s) {
    if (s.wins[0] !== s.wins[1]) return s.wins[0] > s.wins[1] ? [0, 1] : [1, 0];
    if (s.lotWinner !== null) return s.lotWinner === 0 ? [0, 1] : [1, 0];
    return [0, 0];
  },
  bot(s, i, level, rng) {
    if (s.phase !== 'choose' || s.picks[i] !== null) return [];
    if (s.botAt[i] === null) {
      const [lo, hi] = { easy: [1.5, 3.5], medium: [1, 3], hard: [0.8, 2.5] }[level];
      s.botAt[i] = s.t + rng.range(lo, hi);
    }
    if (s.t < s.botAt[i]!) return [];
    return [{ type: 'choice', id: botHand(s, i, level, rng) }];
  },
  view(s) {
    const entities: MgEntity[] = [
      // beach bar deck with a tiki table in the middle
      { id: 'stage', kind: 'cylinder', x: 0, y: DECK - 0.4, z: 0, sx: 13, sy: 0.8, sz: 8, color: '#c9935e', mat: 'planks', taper: 0.97 },
      { id: 'rim', kind: 'cylinder', x: 0, y: -0.15, z: 0, sx: 13.6, sy: 0.7, sz: 8.5, color: '#8a5a3c', mat: 'wood' },
      { id: 'tableTop', kind: 'cylinder', x: 0, y: DECK + 1.05, z: 0, sx: 2.5, sy: 0.16, sz: 2.5, color: '#b98a5a', mat: 'planks' },
      { id: 'tableLeg', kind: 'cylinder', x: 0, y: DECK + 0.5, z: 0, sx: 0.55, sy: 1, sz: 0.55, color: '#7a5c45', mat: 'wood', taper: 0.8 },
      { id: 'tableFoot', kind: 'cylinder', x: 0, y: DECK + 0.06, z: 0, sx: 1.3, sy: 0.12, sz: 1.3, color: '#7a5c45', mat: 'wood' },
      { id: 'mat0', kind: 'cylinder', x: PLAYER_X[0], y: DECK + 0.02, z: 0, sx: 1.9, sy: 0.04, sz: 1.9, color: '#d9c39a', mat: 'rope' },
      { id: 'mat1', kind: 'cylinder', x: PLAYER_X[1], y: DECK + 0.02, z: 0, sx: 1.9, sy: 0.04, sz: 1.9, color: '#d9c39a', mat: 'rope' },
      // tiki torches on the deck, palms, a parasol and the beach bar around it
      { id: 'torch1', kind: 'prop', prop: 'torch', x: -5.2, y: DECK, z: 1.6 },
      { id: 'torch2', kind: 'prop', prop: 'torch', x: 5.2, y: DECK, z: 1.6 },
      { id: 'torch3', kind: 'prop', prop: 'torch', x: -2, y: DECK, z: 3.2 },
      { id: 'torch4', kind: 'prop', prop: 'torch', x: 2, y: DECK, z: 3.2 },
      { id: 'palm1', kind: 'prop', prop: 'palm', x: -7.6, y: -0.08, z: 4.2, ry: 0.4 },
      { id: 'palm2', kind: 'prop', prop: 'palm2', x: 8.2, y: 0.02, z: 5.4, ry: 2.6 },
      { id: 'bar', kind: 'prop', prop: 'stall', x: 7.7, y: -0.06, z: 3, ry: -0.9, color: '#5fb8d6' },
      { id: 'pole', kind: 'cylinder', x: -7.3, y: 1.19, z: 0.6, sx: 0.12, sy: 2.5, sz: 0.12, color: '#e8e0d0', mat: 'wood' },
      { id: 'shade', kind: 'cone', x: -7.3, y: 2.15, z: 0.6, sx: 2.8, sy: 0.75, sz: 2.8, color: '#e8676b', mat: 'cloth' },
      { id: 'lounger', kind: 'prop', prop: 'bench', x: -7.4, y: SAND, z: -0.9, ry: 0.3 },
      { id: 'barrel', kind: 'prop', prop: 'barrel', x: -4.6, y: DECK, z: 2.4, ry: 0.6 },
      { id: 'crab', kind: 'prop', prop: 'crab', x: 7.2, y: SAND, z: -3, ry: 3.4, sx: 0.6 },
      { id: 'shell1', kind: 'prop', prop: 'shell', x: -5.2, y: SAND - 0.01, z: -4.2 },
      { id: 'shell2', kind: 'prop', prop: 'shell', x: 4.6, y: SAND - 0.01, z: -4.3, ry: 2 },
      { id: 'drift', kind: 'prop', prop: 'driftwood', x: -7.1, y: SAND - 0.01, z: -3.7, ry: 0.5 },
    ];
    const rt = s.t - s.phaseStart;
    const revealing = s.phase === 'reveal' || s.phase === 'done';
    const shaking = s.phase === 'reveal' && rt < SHAKE;
    const shown = revealing && !shaking && s.picks[0] !== null && s.picks[1] !== null;
    const champ = s.phase === 'done' ? leader(s) : null;
    [0, 1].forEach((i) => {
      const side = i === 0 ? -1 : 1;
      const px = PLAYER_X[i];
      const won = shown && s.roundWinner === i;
      const lost = shown && s.roundWinner === 1 - i;
      entities.push({
        id: `p${i}`,
        kind: 'player',
        player: i,
        x: px,
        y: DECK,
        z: 0,
        ry: side < 0 ? -Math.PI / 2 : Math.PI / 2,
        anim: champ === i || won ? 'cheer' : lost || champ === 1 - i ? 'sad' : s.phase === 'choose' && s.picks[i] !== null ? 'jump' : 'idle',
      });
      // "ready" marker above the head: glows once a (secret) pick was made
      if (s.phase === 'choose') {
        const ready = s.picks[i] !== null;
        entities.push({ id: `ready${i}`, kind: 'sphere', x: px, y: 2.5 + DECK, z: 0, sx: 0.5, sy: 0.5, sz: 0.5, color: ready ? '#5cc08a' : '#d8d2cc', glow: ready });
      }
      const hx = HAND_X[i];
      if (shaking) {
        // fists bob three times: "Schnick … Schnack … Schnuck!"
        const bob = Math.abs(Math.sin((rt / SHAKE) * Math.PI * 3)) * 0.9;
        entities.push({ id: `fist${i}`, kind: 'rock', x: hx, y: HAND_Y + bob, z: 0, sx: 0.9, sy: 0.9, sz: 0.9, color: '#f1c7a0' });
      }
      const pick = shown ? s.picks[i] : null;
      if (!pick) return;
      const big = won ? 1.35 : lost ? 0.8 : 1;
      const glow = won;
      if (pick === 'rock') {
        entities.push({ id: `rock${i}`, kind: 'rock', x: hx, y: HAND_Y, z: 0, sx: 1.2 * big, sy: 1.2 * big, sz: 1.2 * big, color: HAND_COLOR.rock, glow, label: ICON.rock });
      } else if (pick === 'paper') {
        // a flat sheet facing the camera (turned a little towards the opponent)
        entities.push({ id: `paper${i}`, kind: 'box', x: hx, y: HAND_Y, z: 0, ry: i === 0 ? -0.5 : 0.5, sx: 1.2 * big, sy: 1.5 * big, sz: 0.12, color: HAND_COLOR.paper, mat: 'paper', glow, label: ICON.paper });
      } else {
        for (const k of [0, 1]) {
          entities.push({
            id: `scissors${i}_${k}`,
            kind: 'box',
            x: hx,
            y: HAND_Y,
            z: 0,
            rx: k === 0 ? 0.45 : -0.45,
            sx: 0.15,
            sy: 1.6 * big,
            sz: 0.25,
            color: HAND_COLOR.scissors,
            mat: 'metal',
            glow,
            label: k === 0 ? ICON.scissors : undefined,
          });
        }
      }
    });
    const hud: MgHud = {
      scores: [0, 1].map((i) => ({ player: i, value: '★'.repeat(s.wins[i]) + '☆'.repeat(Math.max(0, TARGET - s.wins[i])) })),
    };
    if (s.phase === 'choose') {
      hud.timer = Math.max(0, Math.ceil(s.deadline - s.t));
      hud.message = { key: s.suddenDeath ? 'mg.schnickSchnack.sudden' : 'mg.schnickSchnack.choose' };
    } else if (shaking) hud.message = { key: 'mg.schnickSchnack.shake' };
    else if (s.phase === 'done' && s.lotWinner !== null) hud.message = { key: 'mg.schnickSchnack.lot' };
    else if (shown) hud.message = { key: s.roundWinner === null ? 'mg.schnickSchnack.tie' : 'mg.schnickSchnack.point' };
    return {
      env: 'sand',
      // beach set without `ground`: the sand inside r = 8 is levelled to SAND (−0.04)
      scenery: { set: 'beach', clear: { r: 8 } },
      camera: { alpha: -Math.PI / 2, beta: 1.3, radius: 11.5, target: [0, 2.1, 0.2] },
      entities,
      fx: viewFx(s),
      hud,
    };
  },
};

function leader(s: SchnickSchnackState): number | null {
  if (s.wins[0] !== s.wins[1]) return s.wins[0] > s.wins[1] ? 0 : 1;
  return s.lotWinner;
}
