import { BALANCE } from '../config';
import { PASS_FIELDS } from '../maps/types';
import type { FieldDef, MapDef } from '../maps/types';
import type { GameEngine } from './engine';
import type { GameState } from './types';

/**
 * Map gimmick scripts (BOARD-03, MAP-02). Referenced by id from the map data so new
 * maps can reuse or add gimmicks without touching the engine core (MAP-06).
 */
export interface Gimmick {
  init(state: GameState, map: MapDef): void;
  announce?(e: GameEngine): void;
  isBlocked?(e: GameEngine, fieldId: string): boolean;
  onEventField(e: GameEngine, player: number): void;
  onRedField?(e: GameEngine, player: number): void;
  onRoundStart?(e: GameEngine): void;
  onRoundEnd?(e: GameEngine): void;
  /** Pass trigger for map specific fields; return true if a decision is now pending. */
  passTrigger?(e: GameEngine, player: number, field: FieldDef): boolean;
}

function hasTag(f: FieldDef, tag: string): boolean {
  return !!f.tags?.includes(tag);
}

/** Players standing on now-blocked fields are moved to the nearest safe field behind them. */
function washBlocked(e: GameEngine, announceKey: string): void {
  e.state.players.forEach((p, i) => {
    if (!e.isOpen(p.field)) {
      const safe = e.safeFieldBehind(p.field);
      e.emit({ type: 'announce', key: announceKey, player: i });
      e.teleport(i, safe, 'wash');
    }
  });
}

/** Kokos-Kanone: shoot the player to a random (open, landable) field of the island. */
function coconutCannon(e: GameEngine, player: number): void {
  const candidates = e.map.fields.filter(
    (f) => !PASS_FIELDS.includes(f.type) && e.isOpen(f.id) && f.id !== e.player(player).field && f.id !== e.state.starField,
  );
  const target = e.rng.pick(candidates);
  e.emit({ type: 'announce', key: 'mod.cannon', player });
  e.teleport(player, target.id, 'cannon');
}

const tides: Gimmick = {
  init(state) {
    state.gimmick.tide = 'high';
  },
  announce(e) {
    e.emit({ type: 'tide', tide: e.state.gimmick.tide! });
  },
  isBlocked(e, id) {
    // high tide floods the sandbank and fills the river over the ford stones
    return e.state.gimmick.tide === 'high' && (hasTag(e.field(id), 'sandbank') || hasTag(e.field(id), 'ford'));
  },
  onEventField(e, player) {
    coconutCannon(e, player);
  },
  onRoundEnd(e) {
    if (e.state.round % BALANCE.tideInterval !== 0) return;
    const next = e.state.gimmick.tide === 'high' ? 'low' : 'high';
    e.state.gimmick.tide = next;
    e.emit({ type: 'tide', tide: next });
    e.emit({ type: 'announce', key: next === 'low' ? 'mod.tideLow' : 'mod.tideHigh' });
    if (next === 'high') washBlocked(e, 'mod.washed');
  },
};

function erupt(e: GameEngine): void {
  const g = e.state.gimmick;
  const groups = e.map.gimmickParams?.lavaGroups ?? [];
  const group = groups.length ? (g.lavaNext ?? 0) % groups.length : -1;
  g.lavaNext = (group + 1) % Math.max(1, groups.length);
  g.eruption = 0;
  e.emit({ type: 'announce', key: 'mod.eruption' });
  if (group >= 0) {
    g.lava = { group, until: e.state.round + 1 };
    e.emit({ type: 'lava', group, active: true });
    washBlocked(e, 'mod.lavaFlee');
    if (!e.isOpen(e.state.starField)) {
      // the star must stay reachable: it flees from the lava
      e.emit({ type: 'announce', key: 'mod.starFlees' });
      e.moveStar();
    }
  }
  // coin rain on random open fields
  const landable = e.map.fields.filter((f) => !PASS_FIELDS.includes(f.type) && e.isOpen(f.id));
  const bags: string[] = [];
  for (let k = 0; k < 5; k++) {
    const f = e.rng.pick(landable);
    if (bags.includes(f.id) || e.state.coinBags.some((b) => b.field === f.id)) continue;
    bags.push(f.id);
    e.state.coinBags.push({ field: f.id, amount: 5 });
    e.emit({ type: 'coinBag', field: f.id, amount: 5, placed: true });
  }
  // boulders hit two random players
  const hits = e.rng.shuffle(e.all()).slice(0, 2);
  e.emit({ type: 'eruption', lavaGroup: group, bags, hits });
  for (const h of hits) {
    e.changeCoins(h, -BALANCE.boulderPenalty, 'boulder');
  }
  e.emit({ type: 'eruptionCounter', value: 0, max: BALANCE.eruptionThreshold });
}

function bumpEruption(e: GameEngine, amount: number): void {
  const g = e.state.gimmick;
  g.eruption = (g.eruption ?? 0) + amount;
  e.emit({ type: 'eruptionCounter', value: Math.min(g.eruption, BALANCE.eruptionThreshold), max: BALANCE.eruptionThreshold });
  if (g.eruption >= BALANCE.eruptionThreshold) erupt(e);
}

const eruption: Gimmick = {
  init(state) {
    state.gimmick.eruption = 0;
    state.gimmick.lava = null;
    state.gimmick.lavaNext = 0;
  },
  announce(e) {
    e.emit({ type: 'eruptionCounter', value: e.state.gimmick.eruption ?? 0, max: BALANCE.eruptionThreshold });
  },
  isBlocked(e, id) {
    const lava = e.state.gimmick.lava;
    if (!lava) return false;
    return !!e.map.gimmickParams?.lavaGroups?.[lava.group]?.includes(id);
  },
  onEventField(e, player) {
    e.emit({ type: 'announce', key: 'mod.quake', player });
    bumpEruption(e, 2);
  },
  onRedField(e) {
    bumpEruption(e, 1);
  },
  onRoundEnd(e) {
    const lava = e.state.gimmick.lava;
    if (lava && e.state.round >= lava.until) {
      e.state.gimmick.lava = null;
      e.emit({ type: 'lava', group: lava.group, active: false });
      e.emit({ type: 'announce', key: 'mod.lavaCooled' });
    }
  },
  passTrigger(e, player, field) {
    if (field.type !== 'cablecar') return false;
    const target = e.map.gimmickParams?.cableCarTarget;
    if (!target || !e.isOpen(target)) return false;
    if (e.player(player).coins < BALANCE.cableCarPrice) return false;
    e.state.pending = { kind: 'cablecar', player, price: BALANCE.cableCarPrice, target };
    return true;
  },
};

function nextRoutes(e: GameEngine): number[] {
  const n = e.map.gimmickParams?.trainRoutes?.length ?? 0;
  const idx = e.state.gimmick.trainIdx ?? 0;
  return n ? [0, 1, 2].map((k) => (idx + k) % n) : [];
}

const train: Gimmick = {
  init(state) {
    state.gimmick.trainIdx = 0;
  },
  announce(e) {
    e.emit({ type: 'timetable', next: nextRoutes(e) });
  },
  onEventField(e, player) {
    e.player(player).tickets++;
    e.emit({ type: 'announce', key: 'mod.ticketGift', player });
  },
  onRoundEnd(e) {
    const routes = e.map.gimmickParams?.trainRoutes ?? [];
    if (!routes.length) return;
    const g = e.state.gimmick;
    const route = (g.trainIdx ?? 0) % routes.length;
    const hits = e.state.players.map((p, i) => (routes[route].fields.includes(p.field) ? i : -1)).filter((i) => i >= 0);
    e.emit({ type: 'announce', key: 'mod.trainComing' });
    e.emit({ type: 'train', route, hits });
    for (const h of hits) {
      e.changeCoins(h, -BALANCE.trainPenalty, 'train');
      e.emit({ type: 'announce', key: 'mod.trainHit', player: h });
    }
    g.trainIdx = (route + 1) % routes.length;
    e.emit({ type: 'timetable', next: nextRoutes(e) });
  },
  passTrigger(e, player, field) {
    if (field.type !== 'station') return false;
    const p = e.player(player);
    if (p.tickets <= 0 && p.coins < BALANCE.ticketPrice) return false;
    const destinations = e.map.fields.filter((f) => f.type === 'station' && f.id !== field.id).map((f) => f.id);
    e.state.pending = {
      kind: 'station',
      player,
      destinations,
      ticketPrice: BALANCE.ticketPrice,
      hasTicket: p.tickets > 0,
    };
    return true;
  },
};

export const GIMMICKS: Record<string, Gimmick> = { tides, eruption, train };
