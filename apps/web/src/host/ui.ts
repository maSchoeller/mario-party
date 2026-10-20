import { PLAYER_COLOR_HEX, PLAYER_SHAPE, type CharacterId, type PlayerColor } from '@wb/shared/config';
import { t, type Params } from '@wb/shared/i18n/index';
import type { MgHud, MgPlayer } from '@wb/shared/minigames/types';
import QRCode from 'qrcode';
import { CHAR_EMOJI, ITEM_EMOJI, WHEEL_EMOJI } from '../common/characters';
import { clear, h } from '../common/dom';

/**
 * TV overlay UI (ART-06: rounded translucent cards, Nunito, big type). Everything is
 * readable from the couch (3 m) and needs no mouse during the game (GAME-03).
 */
export interface HudPlayer {
  slot: number;
  name: string;
  character: CharacterId | null;
  color: PlayerColor;
  stars: number;
  coins: number;
  items: string[];
  isBot: boolean;
  connected: boolean;
  chief: boolean;
  active?: boolean;
  points?: number;
  link?: string;
}

export class HostUI {
  readonly root: HTMLElement;
  private layers: Record<string, HTMLElement> = {};
  private cards: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    for (const name of ['hud', 'gimmick', 'center', 'mg', 'subtitle', 'overlay', 'toast', 'transition', 'system']) {
      const el = h('div', { class: `layer layer-${name}` });
      this.layers[name] = el;
      root.append(el);
    }
  }

  layer(name: string): HTMLElement {
    return this.layers[name];
  }

  // ------------------------------------------------------------------ start & lobby

  showStart(onCreate: () => void, onResume: (code: string) => void, error?: string): void {
    const code = h('input', { maxlength: 6, placeholder: 'ABC123', class: 'resume-code', autocapitalize: 'characters' });
    const el = h(
      'div',
      { class: 'start card' },
      h('h1', {}, '🎲 ', t('app.title')),
      h('p', { class: 'tagline' }, t('app.tagline')),
      h('button', { class: 'primary huge', id: 'create-lobby', onclick: onCreate }, t('host.createLobby')),
      h(
        'form',
        { class: 'resume', onsubmit: (e: Event) => (e.preventDefault(), onResume(code.value)) },
        h('label', {}, t('host.resumeCodePrompt')),
        h('div', { class: 'row' }, code, h('button', { type: 'submit' }, t('host.resumeGame'))),
        error ? h('p', { class: 'error' }, error) : null,
      ),
      h('a', { href: '/dev', class: 'dev-link' }, t('host.devPanel')),
    );
    this.setOverlay(el);
  }

  async showLobby(code: string, joinUrl: string, players: HudPlayer[], info: { mapKey?: string; modeKey?: string; saveCode?: string | null; resuming?: boolean }): Promise<void> {
    const qr = h('canvas', { class: 'qr' });
    await QRCode.toCanvas(qr, joinUrl, { width: 300, margin: 1, color: { dark: '#3d3a55', light: '#ffffff' } }).catch(() => {});
    const slots = [0, 1, 2, 3].map((i) => {
      const p = players.find((x) => x.slot === i);
      if (!p) return h('div', { class: 'slot empty' }, h('span', { class: 'emoji' }, '➕'), t('host.playerSlotFree'));
      return h(
        'div',
        { class: `slot ${p.connected ? '' : 'offline'}`, style: `--pc:${PLAYER_COLOR_HEX[p.color]}` },
        h('span', { class: 'emoji' }, p.character ? CHAR_EMOJI[p.character] : '❔'),
        h('span', { class: 'shape' }, PLAYER_SHAPE[p.color]),
        h('strong', {}, p.name),
        p.chief ? h('small', {}, '👑 ', t('host.chief')) : null,
      );
    });
    const el = h(
      'div',
      { class: 'lobby' },
      h(
        'div',
        { class: 'card join' },
        h('h2', {}, t('host.roomCode')),
        h('div', { class: 'code', id: 'room-code' }, code),
        qr,
        h('p', { class: 'url' }, t('host.joinHint', { url: joinUrl.replace(/\?.*$/, '') })),
      ),
      h(
        'div',
        { class: 'card players' },
        h('h2', {}, info.resuming ? t('play.resumePickFigure') : t('host.waitingPlayers')),
        h('div', { class: 'slots' }, slots),
        h('p', { class: 'hint' }, t('host.chiefHint')),
        info.modeKey ? h('p', { class: 'mode' }, t(info.modeKey), info.mapKey ? ` · ${t(info.mapKey)}` : '') : null,
        info.saveCode ? h('p', { class: 'mode' }, t('host.saveCode', { code: info.saveCode })) : null,
      ),
    );
    this.setOverlay(el);
  }

  setOverlay(el: HTMLElement | null): void {
    clear(this.layers.overlay);
    if (el) this.layers.overlay.append(el);
  }

  // ------------------------------------------------------------------ game HUD

  setHud(title: string | null, players: HudPlayer[], mode: 'board' | 'marathon' | 'none' = 'board'): void {
    const hud = this.layers.hud;
    clear(hud);
    this.cards = [];
    if (mode === 'none') return;
    if (title) hud.append(h('div', { class: 'title pill' }, title));
    const corners = ['tl', 'tr', 'bl', 'br'];
    players.forEach((p, i) => {
      const card = h(
        'div',
        { class: `pcard ${corners[i]} ${p.active ? 'active' : ''} ${p.connected ? '' : 'offline'}`, style: `--pc:${PLAYER_COLOR_HEX[p.color]}`, 'data-slot': p.slot },
        h(
          'div',
          { class: 'pname' },
          h('span', { class: 'shape' }, PLAYER_SHAPE[p.color]),
          p.character ? h('span', { class: 'emoji' }, CHAR_EMOJI[p.character]) : null,
          h('span', { class: 'n' }, p.name),
          p.isBot ? h('span', { class: 'tag' }, t('common.bot')) : null,
          !p.connected ? h('span', { class: 'tag warn', title: t('host.disconnected') }, '📵') : null,
          p.chief ? h('span', { class: 'tag' }, '👑') : null,
        ),
        mode === 'board'
          ? h('div', { class: 'pstats' }, h('span', { class: 'stars' }, '★ ', String(p.stars)), h('span', { class: 'coins' }, '● ', String(p.coins)), h('span', { class: 'items' }, p.items.map((it) => ITEM_EMOJI[it] ?? '').join('')))
          : h('div', { class: 'pstats' }, h('span', { class: 'stars' }, `${p.points ?? 0} ${t('stats.points')}`)),
      );
      this.cards[p.slot] = card;
      hud.append(card);
    });
  }

  popAtPlayer(slot: number, text: string, kind: 'good' | 'bad' | 'neutral' = 'neutral'): void {
    const card = this.cards[slot];
    if (!card) return;
    const pop = h('div', { class: `pop ${kind}` }, text);
    card.append(pop);
    setTimeout(() => pop.remove(), 1800);
  }

  emoji(slot: number, emoji: string): void {
    const card = this.cards[slot];
    if (!card) return;
    const e = h('div', { class: 'emoji-pop' }, emoji);
    card.append(e);
    setTimeout(() => e.remove(), 2200);
  }

  subtitle(text: string | null): void {
    const el = this.layers.subtitle;
    clear(el);
    if (text) el.append(h('div', { class: 'sub card' }, h('span', { class: 'parrot' }, '🦜'), h('span', {}, text)));
  }

  banner(text: string, ms = 1800, cls = ''): Promise<void> {
    const el = h('div', { class: `banner ${cls}` }, text);
    this.layers.center.append(el);
    return new Promise((r) =>
      setTimeout(() => {
        el.remove();
        r();
      }, ms),
    );
  }

  toast(text: string, ms = 2500): void {
    const el = h('div', { class: 'toast card' }, text);
    this.layers.toast.append(el);
    setTimeout(() => el.remove(), ms);
  }

  /** Result card after the 3D dice have landed: the dice values and the big total. */
  diceResult(rolls: { steps: number; coins: number }[], total: number, ms = 1700): void {
    // "3 + 5 − 2": the first value keeps its sign, later ones show it as the operator
    const sum: HTMLElement[] = [];
    rolls.forEach((r, i) => {
      if (i) sum.push(h('span', { class: 'op' }, r.steps < 0 ? '−' : '+'));
      sum.push(h('span', { class: `dv${r.steps < 0 ? ' neg' : ''}` }, String(i ? Math.abs(r.steps) : r.steps)));
    });
    const coins = rolls.reduce((a, x) => a + x.coins, 0);
    const el = h(
      'div',
      { class: `dice-result card${total < 0 ? ' back' : ''}` },
      rolls.length > 1 ? h('div', { class: 'sum' }, sum) : null,
      h('div', { class: 'total' }, String(total)),
      total < 0 ? h('div', { class: 'hint' }, t('host.diceBack')) : null,
      coins ? h('div', { class: 'coins' }, `+${coins} ●`) : null,
    );
    this.layers.center.append(el);
    setTimeout(() => el.classList.add('out'), ms - 250);
    setTimeout(() => el.remove(), ms);
  }

  wheel(segments: string[], result: number, ms = 2600): Promise<void> {
    const n = segments.length;
    const segs = segments.map((s, i) =>
      h('div', { class: 'wseg', style: `transform: rotate(${(360 / n) * i}deg)` }, h('span', { style: `transform: rotate(${180 / n}deg)` }, WHEEL_EMOJI[s] ?? '?')),
    );
    const disc = h('div', { class: 'wdisc', style: `--n:${n}` }, segs);
    const label = h('div', { class: 'wlabel' }, '');
    const el = h('div', { class: 'wheel card' }, h('div', { class: 'pointer' }, '▼'), disc, label);
    this.layers.center.append(el);
    const target = 360 * 5 + (360 - (360 / n) * result - 180 / n);
    requestAnimationFrame(() => {
      disc.style.transition = `transform ${ms * 0.75}ms cubic-bezier(.15,.7,.2,1)`;
      disc.style.transform = `rotate(${target}deg)`;
    });
    return new Promise((r) => {
      setTimeout(() => (label.textContent = t(`wheel.${segments[result]}`)), ms * 0.78);
      setTimeout(() => {
        el.remove();
        r();
      }, ms);
    });
  }

  setGimmick(content: HTMLElement | null): void {
    clear(this.layers.gimmick);
    if (content) this.layers.gimmick.append(content);
  }

  // ------------------------------------------------------------------ minigames

  minigameIntro(
    game: string,
    format: string,
    players: MgPlayer[],
    names: string[],
    ready: boolean[],
    remaining: number,
    teamLabels: string[],
    controls: string[] = [],
  ): void {
    // side panel so the practice game stays visible (MINI-04)
    const el = h(
      'div',
      { class: 'mg-intro card' },
      h('div', { class: 'format pill' }, t(`format.${format}`)),
      h('h1', {}, t(`mg.${game}.name`)),
      controls.length ? h('div', { class: 'pictos' }, controls.map((c) => h('span', { class: 'picto' }, CONTROL_PICTO[c] ?? '🎮'))) : null,
      h('p', { class: 'desc' }, t(`mg.${game}.desc`)),
      h('p', { class: 'controls' }, '🎮 ', t(`mg.${game}.controls`)),
      h(
        'div',
        { class: 'ready-row' },
        players.map((p, k) =>
          h(
            'div',
            { class: `rp ${ready[k] ? 'ready' : ''}`, style: `--pc:${PLAYER_COLOR_HEX[p.color]}` },
            h('span', { class: 'shape' }, PLAYER_SHAPE[p.color]),
            CHAR_EMOJI[p.character],
            ' ',
            names[k],
            teamLabels[k] ? h('small', {}, teamLabels[k]) : null,
            h('span', { class: 'check' }, ready[k] ? '✓' : '…'),
          ),
        ),
      ),
      h('p', { class: 'practice' }, t('host.practice'), ' · ', t('host.startsIn', { sec: Math.ceil(remaining) })),
    );
    this.setOverlay(el);
  }

  countdown(n: number | string | null, cls = ''): void {
    clear(this.layers.center);
    if (n !== null) this.layers.center.append(h('div', { class: `countdown ${typeof n === 'number' ? `n${n}` : 'go'} ${cls}` }, h('span', {}, String(n))));
  }

  /**
   * Iris transition (v0.4): `close` shrinks a hole to black-violet with a little star in the
   * middle, `open` widens it again. Resolves when the animation is done.
   */
  iris(mode: 'close' | 'open', ms = 520): Promise<void> {
    const layer = this.layers.transition;
    let el = layer.querySelector<HTMLElement>('.iris');
    if (!el) {
      el = h('div', { class: 'iris' }, h('div', { class: 'iris-star' }, '★'));
      layer.append(el);
    }
    el.style.setProperty('--iris-ms', `${ms}ms`);
    el.classList.remove('closing', 'opening', 'closed');
    void el.offsetWidth;
    el.classList.add(mode === 'close' ? 'closing' : 'opening');
    return new Promise((res) =>
      setTimeout(() => {
        if (mode === 'close') el!.classList.add('closed');
        else el!.remove();
        res();
      }, ms),
    );
  }

  mgHud(hud: MgHud | null, players: MgPlayer[], title: string): void {
    const el = this.layers.mg;
    clear(el);
    if (!hud) return;
    el.append(h('div', { class: 'title pill' }, title));
    if (hud.timer !== undefined) el.append(h('div', { class: 'timer pill' }, formatTime(hud.timer)));
    const rows: HTMLElement[] = [];
    for (const s of hud.scores ?? []) {
      const p = players[s.player];
      if (!p) continue;
      rows.push(h('div', { class: 'score', style: `--pc:${PLAYER_COLOR_HEX[p.color]}` }, h('span', { class: 'shape' }, PLAYER_SHAPE[p.color]), CHAR_EMOJI[p.character], ' ', s.value));
    }
    for (const b of hud.bars ?? []) {
      const p = players[b.player];
      if (!p) continue;
      rows.push(
        h(
          'div',
          { class: 'bar', style: `--pc:${PLAYER_COLOR_HEX[p.color]}` },
          h('span', { class: 'shape' }, PLAYER_SHAPE[p.color]),
          h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round(Math.max(0, Math.min(1, b.value)) * 100)}%` })),
        ),
      );
    }
    for (const tm of hud.teams ?? []) rows.push(h('div', { class: `team team${tm.team}` }, t(tm.labelKey), ': ', tm.value));
    if (rows.length) el.append(h('div', { class: 'scores card' }, rows));
    if (hud.message) el.append(h('div', { class: 'mg-message' }, t(hud.message.key, hud.message.params as Params)));
  }

  results(title: string, rows: { name: string; color: PlayerColor; character: CharacterId; rank: number; reward: string }[], ms = 3500): Promise<void> {
    const el = h(
      'div',
      { class: 'results card' },
      h('h2', {}, title),
      rows
        .sort((a, b) => a.rank - b.rank)
        .map((r) =>
          h(
            'div',
            { class: `rrow rank${r.rank}`, style: `--pc:${PLAYER_COLOR_HEX[r.color]}` },
            h('span', { class: 'place' }, `${r.rank + 1}.`),
            h('span', { class: 'shape' }, PLAYER_SHAPE[r.color]),
            CHAR_EMOJI[r.character],
            h('strong', {}, r.name),
            h('span', { class: 'reward' }, r.reward),
          ),
        ),
    );
    this.setOverlay(el);
    return new Promise((res) =>
      setTimeout(() => {
        this.setOverlay(null);
        res();
      }, ms),
    );
  }

  pause(on: boolean, saveCode?: string | null): void {
    clear(this.layers.system);
    if (on)
      this.layers.system.append(
        h('div', { class: 'pause' }, h('div', { class: 'card' }, h('h1', {}, '⏸ ', t('host.paused')), h('p', {}, t('host.pausedHint')), saveCode ? h('p', {}, t('host.saveCode', { code: saveCode })) : null)),
      );
  }

  /** Gear button with separate volumes for music / effects / voice (AUDIO-06). */
  volumeControls(get: () => Record<'music' | 'sfx' | 'voice', number>, set: (k: 'music' | 'sfx' | 'voice', v: number) => void): void {
    const panel = h('div', { class: 'volume card hidden' });
    const render = () => {
      clear(panel);
      const v = get();
      for (const k of ['music', 'sfx', 'voice'] as const) {
        const input = h('input', { type: 'range', min: 0, max: 100, value: Math.round(v[k] * 100) });
        input.addEventListener('input', () => set(k, Number(input.value) / 100));
        panel.append(h('label', {}, t(`host.volume${k === 'sfx' ? 'Sfx' : k[0].toUpperCase() + k.slice(1)}`), input));
      }
    };
    const gear = h('button', { class: 'gear', title: t('host.settings'), onclick: () => (render(), panel.classList.toggle('hidden')) }, '⚙️');
    this.root.append(h('div', { class: 'settings-dock' }, panel, gear));
  }

  serverStatus(text: string | null): void {
    const id = 'server-status';
    this.root.querySelector(`#${id}`)?.remove();
    if (text) this.root.append(h('div', { id, class: 'server-status card' }, text));
  }
}

/** Controller pictograms per layout kind for the explanation screen (MINI-04). */
export const CONTROL_PICTO: Record<string, string> = {
  joystick: '🕹️',
  mash: '👆💨',
  button: '🔴👆',
  tilt: '📱↔️',
  shake: '📳',
  draw: '✍️',
  swipe: '👉',
  choice: '🔘',
  number: '🔢',
  pads: '🟥🟦',
  wait: '👀',
};

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
