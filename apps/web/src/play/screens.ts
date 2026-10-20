import { BOT_LEVELS, CHARACTERS, PLAYER_COLOR_HEX, PLAYER_SHAPE, ROUND_OPTIONS } from '@wb/shared/config';
import type { ItemId } from '@wb/shared/game/items';
import { t } from '@wb/shared/i18n/index';
import type { ControllerLayout } from '@wb/shared/minigames/types';
import { EMOJIS, type ControllerView, type LobbySettings, type PhoneDecision, type ViewEnvelope } from '@wb/shared/net/protocol';
import { DICE, type DiceId } from '@wb/shared/game/dice';
import { CHAR_EMOJI, ITEM_EMOJI, WHEEL_EMOJI } from '../common/characters';
import { h } from '../common/dom';
import type { PlayApp } from './main';
import { vibrate } from './sensors';

interface RenderOpts {
  mountController(layout: ControllerLayout): HTMLElement | null;
}

export function screenKey(env: ViewEnvelope): string {
  const v = env.view;
  switch (v.screen) {
    case 'lobby':
      return `lobby:${env.chief}:${JSON.stringify(v.players)}:${JSON.stringify(v.settings)}:${v.canStart}:${env.me?.character}`;
    case 'claim':
      return `claim:${JSON.stringify(v.options)}`;
    case 'wait':
      return `wait:${env.chief}:${env.paused}`;
    case 'decide':
      return `decide:${JSON.stringify(v.decision)}:${JSON.stringify(env.me?.items)}:${!!env.afk}`;
    case 'mgIntro':
      return `mgIntro:${v.game}:${env.paused}`;
    case 'mg':
      return `mg:${v.game}:${v.ended ?? false}:${env.paused}`;
    case 'over':
      return `over:${env.chief}:${JSON.stringify(v.ranking)}`;
  }
}

export function renderHeader(app: PlayApp, hostOnline: boolean): HTMLElement {
  const env = app.env;
  const me = env?.me;
  const color = me ? PLAYER_COLOR_HEX[me.color] : '#999';
  return h(
    'header',
    { class: 'phone-header', style: `--pc:${color}` },
    me
      ? h(
          'div',
          { class: 'who' },
          h('span', { class: 'shape', style: `color:${color}` }, PLAYER_SHAPE[me.color]),
          me.character ? h('span', { class: 'char' }, CHAR_EMOJI[me.character]) : null,
          h('span', { class: 'name' }, me.name),
        )
      : h('div', { class: 'who' }, t('app.title')),
    me ? h('div', { class: 'stats' }, h('span', {}, `★ ${me.stars}`), h('span', {}, `● ${me.coins}`)) : null,
    env?.round ? h('div', { class: 'round' }, t('common.round', env.round)) : null,
    h('div', { class: `link ${app.mode}`, title: app.mode }, !hostOnline ? '⏳' : app.mode === 'p2p' ? 'P2P' : app.mode === 'relay' ? t('play.relayMode') : '…'),
  );
}

export function renderScreen(app: PlayApp, env: ViewEnvelope, opts: RenderOpts): HTMLElement {
  const v = env.view;
  let body: HTMLElement;
  switch (v.screen) {
    case 'lobby':
      body = lobby(app, env, v);
      break;
    case 'claim':
      body = claim(app, v);
      break;
    case 'wait':
      body = wait(app, env, v);
      break;
    case 'decide':
      body = decide(app, env, v.decision);
      if (env.afk) body.prepend(h('div', { class: 'afk card pad', 'data-dynamic': true }, '⏰ ', t('play.afkWarning', { sec: env.afk.secondsLeft })));
      break;
    case 'mgIntro':
      body = mgIntro(app, env, v, opts);
      break;
    case 'mg':
      body = mg(app, env, v, opts);
      break;
    case 'over':
      body = over(app, env, v);
      break;
  }
  const screen = h('main', { class: `screen s-${v.screen}` }, body);
  if (env.paused) screen.append(pauseOverlay(app, env));
  return screen;
}

// ------------------------------------------------------------------ lobby

function lobby(app: PlayApp, env: ViewEnvelope, v: Extract<ControllerView, { screen: 'lobby' }>): HTMLElement {
  const me = env.me!;
  const chars = h(
    'div',
    { class: 'char-grid' },
    CHARACTERS.map((c) => {
      const taken = v.takenCharacters.includes(c) && me.character !== c;
      return h(
        'button',
        {
          class: `char-card ${me.character === c ? 'selected' : ''}`,
          disabled: taken,
          onclick: () => app.send({ t: 'pickChar', character: c }),
        },
        h('span', { class: 'emoji' }, CHAR_EMOJI[c]),
        h('strong', {}, t(`char.${c}`)),
        h('small', {}, taken ? t('play.taken') : t(`char.${c}.animal`)),
        diceStrip(c),
        h('small', { class: 'dice-desc' }, t(`dice.${c}.desc`)),
      );
    }),
  );
  const players = h(
    'ul',
    { class: 'player-list' },
    v.players.map((p) =>
      h(
        'li',
        { style: `--pc:${PLAYER_COLOR_HEX[p.color]}` },
        h('span', { class: 'shape' }, PLAYER_SHAPE[p.color]),
        p.character ? CHAR_EMOJI[p.character] : '❔',
        h('span', { class: 'pname' }, p.name, p.chief ? ' 👑' : '', p.connected ? '' : ' ⏳'),
        env.chief && p.slot !== me.slot
          ? h(
              'span',
              { class: 'actions' },
              h('button', { class: 'small', onclick: () => app.send({ t: 'transferChief', slot: p.slot }), title: t('play.makeChief') }, '👑'),
              h('button', { class: 'small', onclick: () => app.send({ t: 'kick', slot: p.slot }), title: t('play.kick') }, '✖'),
            )
          : null,
      ),
    ),
  );
  return h(
    'div',
    { class: 'lobby' },
    h('section', { class: 'card pad' }, h('h2', {}, t('play.chooseCharacter')), chars),
    h('section', { class: 'card pad' }, h('h2', {}, t('play.players')), players),
    env.chief ? settings(app, v) : h('section', { class: 'card pad muted' }, t('play.waitForChief')),
  );
}

function settings(app: PlayApp, v: Extract<ControllerView, { screen: 'lobby' }>): HTMLElement {
  const s = v.settings;
  const patch = (p: Partial<LobbySettings>) => app.send({ t: 'settings', patch: p });
  const seg = <T extends string | number>(label: string, options: { value: T; label: string }[], current: T, on: (v: T) => void) =>
    h(
      'div',
      { class: 'setting' },
      h('span', { class: 'label' }, label),
      h(
        'div',
        { class: 'seg' },
        options.map((o) => h('button', { class: o.value === current ? 'on' : '', onclick: () => on(o.value) }, o.label)),
      ),
    );
  const humans = v.players.length;
  const mgList = h(
    'details',
    { class: 'mg-list' },
    h('summary', {}, t('play.minigames')),
    v.minigames.map((m) =>
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: !s.disabledMinigames.includes(m.id),
          onchange: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            patch({ disabledMinigames: on ? s.disabledMinigames.filter((x) => x !== m.id) : [...s.disabledMinigames, m.id] });
          },
        }),
        `${t(`mg.${m.id}.name`)} · ${t(`format.${m.format}`)}${m.motion ? ' 📳' : ''}`,
      ),
    ),
  );
  return h(
    'section',
    { class: 'card pad settings' },
    h('h2', {}, `👑 ${t('play.settings')}`),
    seg(t('play.mode'), [{ value: 'board' as const, label: t('play.mode.board') }, { value: 'marathon' as const, label: t('play.mode.marathon') }], s.mode, (mode) => patch({ mode })),
    s.mode === 'board'
      ? h(
          'div',
          { class: 'setting' },
          h('span', { class: 'label' }, t('play.map')),
          h(
            'div',
            { class: 'maps' },
            v.maps.map((m) =>
              h('button', { class: `map ${m.id === s.mapId ? 'on' : ''}`, onclick: () => patch({ mapId: m.id }) }, h('strong', {}, t(m.nameKey)), h('small', {}, t(m.descKey))),
            ),
          ),
        )
      : null,
    s.mode === 'board' ? seg(t('play.rounds'), ROUND_OPTIONS.map((r) => ({ value: r, label: String(r) })), s.rounds, (rounds) => patch({ rounds })) : null,
    humans >= 3 ? seg(t('play.bots'), [{ value: 'on', label: t('play.botsOn') }, { value: 'off', label: t('play.botsOff') }], s.bots ? 'on' : 'off', (b) => patch({ bots: b === 'on' })) : null,
    seg(t('play.botLevel'), BOT_LEVELS.map((l) => ({ value: l, label: t(`play.botLevel.${l}`) })), s.botLevel, (botLevel) => patch({ botLevel })),
    s.mode === 'board' ? seg(t('play.teamMode'), [{ value: 'fields' as const, label: t('play.teamMode.fields') }, { value: 'random' as const, label: t('play.teamMode.random') }], s.teamMode, (teamMode) => patch({ teamMode })) : null,
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.noMotion, onchange: (e: Event) => patch({ noMotion: (e.target as HTMLInputElement).checked }) }), t('play.noMotion')),
    mgList,
    h('button', { class: 'primary big', disabled: !v.canStart, onclick: () => app.send({ t: 'start' }) }, v.canStart ? t('play.start') : t('play.needPlayers')),
  );
}

function claim(app: PlayApp, v: Extract<ControllerView, { screen: 'claim' }>): HTMLElement {
  return h(
    'div',
    { class: 'card pad' },
    h('h2', {}, t('play.resumePickFigure')),
    h(
      'div',
      { class: 'char-grid' },
      v.options.map((o) =>
        h(
          'button',
          { class: 'char-card', disabled: o.taken, onclick: () => app.send({ t: 'claim', slot: o.slot }) },
          h('span', { class: 'emoji' }, CHAR_EMOJI[o.character]),
          h('strong', {}, o.name),
          h('small', {}, o.taken ? t('play.taken') : t(`char.${o.character}`)),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------ waiting & board decisions

function inventory(env: ViewEnvelope): HTMLElement {
  const me = env.me!;
  return h(
    'div',
    { class: 'inventory', 'data-dynamic': true },
    me.items.length
      ? me.items.map((it) => h('span', { class: 'item-chip', title: t(`item.${it}.desc`) }, ITEM_EMOJI[it], ' ', t(`item.${it}.name`)))
      : h('span', { class: 'muted' }, t('play.noItems')),
    me.tickets ? h('span', { class: 'item-chip' }, '🎟️ ', t('play.tickets', { count: me.tickets })) : null,
    me.starDiscount ? h('span', { class: 'item-chip' }, '⭐ ', t('wheel.starDiscount')) : null,
  );
}

function chiefTools(app: PlayApp, env: ViewEnvelope): HTMLElement | null {
  if (!env.chief) return null;
  const ff = h('button', { class: 'ff' }, t('host.fastForward'));
  ff.addEventListener('pointerdown', () => app.send({ t: 'ff', on: true }));
  const off = () => app.send({ t: 'ff', on: false });
  ff.addEventListener('pointerup', off);
  ff.addEventListener('pointercancel', off);
  ff.addEventListener('pointerleave', off);
  return h('div', { class: 'chief-tools' }, h('button', { onclick: () => app.send({ t: 'pause', paused: true }) }, `⏸ ${t('play.pause')}`), ff);
}

function emojiBar(app: PlayApp): HTMLElement {
  return h(
    'div',
    { class: 'emoji-bar' },
    EMOJIS.map((e) => h('button', { onclick: () => (vibrate(10), app.send({ t: 'emoji', emoji: e })) }, e)),
  );
}

function wait(app: PlayApp, env: ViewEnvelope, v: Extract<ControllerView, { screen: 'wait' }>): HTMLElement {
  const msg = v.message ? t(v.message.key, v.message.params) : v.activeName ? t('play.waitingFor', { player: v.activeName }) : t('ctrl.watch');
  return h(
    'div',
    { class: 'wait' },
    h('div', { class: 'card pad big-msg', 'data-dynamic': true }, msg),
    env.me ? h('section', { class: 'card pad' }, inventory(env)) : null,
    h('section', { class: 'card pad' }, h('h3', {}, t('play.emojis')), emojiBar(app)),
    chiefTools(app, env),
  );
}

function decide(app: PlayApp, env: ViewEnvelope, d: PhoneDecision): HTMLElement {
  const act = (action: Parameters<PlayApp['send']>[0]) => {
    vibrate(15);
    app.send(action);
  };
  const me = env.me!;
  switch (d.kind) {
    case 'orderRoll':
      return h('div', { class: 'decide' }, h('h2', {}, t('play.rollOrder')), h('button', { class: 'ctrl-big roll', onclick: () => act({ t: 'action', action: { type: 'roll' } }) }, '🎲 ', t('play.roll')));
    case 'turnMenu':
      return h(
        'div',
        { class: 'decide' },
        h('h2', {}, t('play.yourTurn')),
        dicePicker(d.dice),
        h('button', { class: 'ctrl-big roll', onclick: () => act({ t: 'action', action: { type: 'roll', dice: pickedDie(d.dice) } }) }, '🎲 ', t('play.roll')),
        d.canUseItem && d.items.some((i) => i.usable)
          ? h(
              'section',
              { class: 'card pad' },
              h('h3', {}, t('play.useItem')),
              h(
                'div',
                { class: 'item-grid' },
                d.items.map((it) =>
                  h(
                    'button',
                    { class: 'item-btn', disabled: !it.usable, onclick: () => act({ t: 'action', action: { type: 'useItem', item: it.id } }) },
                    h('span', { class: 'emoji' }, ITEM_EMOJI[it.id]),
                    h('strong', {}, t(`item.${it.id}.name`)),
                    h('small', {}, t(`item.${it.id}.desc`)),
                  ),
                ),
              ),
            )
          : h('section', { class: 'card pad' }, inventory(env)),
      );
    case 'miniPick':
      return h(
        'div',
        { class: 'decide' },
        h('h2', {}, '🎯 ', t('play.miniPick')),
        h('div', { class: 'yes-no' }, d.options.map((n) => h('button', { class: 'ctrl-big roll', onclick: () => act({ t: 'action', action: { type: 'pickSteps', steps: n } }) }, String(n)))),
      );
    case 'branch':
      return h(
        'div',
        { class: 'decide' },
        h('h2', {}, t('play.chooseDirection')),
        h(
          'div',
          { class: 'branch' },
          d.options.map((o) =>
            h(
              'button',
              { class: 'arrow', onclick: () => act({ t: 'action', action: { type: 'branch', to: o.id } }) },
              h('span', { style: `display:inline-block;transform:rotate(${o.angle}deg)` }, '⬆'),
              o.labelKey ? h('small', {}, t(o.labelKey)) : null,
              o.starDistance !== undefined && o.starDistance < 900 ? h('small', {}, t('play.starDistance', { n: o.starDistance })) : null,
            ),
          ),
        ),
      );
    case 'shop': {
      let replaceIdx: number | null = null;
      const replaceRow = d.full
        ? h(
            'div',
            { class: 'replace-row' },
            h('p', {}, t('play.inventoryFullBuy')),
            me.items.map((it, i) => {
              const b = h('button', { class: 'item-chip' }, ITEM_EMOJI[it], ' ', t(`item.${it}.name`));
              b.addEventListener('click', () => {
                replaceIdx = i;
                b.parentElement?.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
                b.classList.add('on');
                // buying is possible only after an item to replace was picked
                b.closest('.decide')?.querySelectorAll<HTMLButtonElement>('.item-btn[data-affordable]').forEach((x) => (x.disabled = false));
              });
              return b;
            }),
          )
        : null;
      return h(
        'div',
        { class: 'decide' },
        h('h2', {}, '🦀 ', t(d.titleKey)),
        h(
          'div',
          { class: 'item-grid' },
          d.offer.map((o) =>
            h(
              'button',
              {
                class: 'item-btn',
                disabled: !o.affordable || d.full,
                'data-affordable': o.affordable ? '1' : undefined,
                onclick: () => act({ t: 'action', action: { type: 'buy', item: o.id, replace: replaceIdx ?? undefined } }),
              },
              h('span', { class: 'emoji' }, ITEM_EMOJI[o.id]),
              h('strong', {}, t(`item.${o.id}.name`)),
              h('small', {}, t(`item.${o.id}.desc`)),
              h('span', { class: 'price' }, t('play.buy', { price: o.price })),
            ),
          ),
        ),
        replaceRow,
        d.full ? h('p', { class: 'muted' }, t('play.pickReplace')) : null,
        h('button', { class: 'secondary', onclick: () => act({ t: 'action', action: { type: 'buy', item: null } }) }, t('play.leaveShop')),
      );
    }
    case 'buyStar':
      return yesNo(t('play.buyStar', { price: d.price }), '⭐', (yes) => act({ t: 'action', action: { type: 'buyStar', accept: yes } }));
    case 'cablecar':
      return yesNo(t('play.cablecar', { price: d.price }), '🚡', (yes) => act({ t: 'action', action: { type: 'cablecar', accept: yes } }));
    case 'station':
      return h(
        'div',
        { class: 'decide' },
        h('h2', {}, '🚉 ', t('play.station')),
        h('p', {}, d.hasTicket ? t('play.stationTicket') : t('play.stationBuy', { price: d.ticketPrice })),
        d.destinations.map((s) => h('button', { class: 'primary', onclick: () => act({ t: 'action', action: { type: 'station', dest: s.id } }) }, t(s.labelKey))),
        h('button', { class: 'secondary', onclick: () => act({ t: 'action', action: { type: 'station', dest: null } }) }, t('play.stationStay')),
      );
    case 'itemReplace':
      return h(
        'div',
        { class: 'decide' },
        h('h2', {}, t('play.itemReplace', { item: `item.${d.newItem}.name` })),
        h('p', { class: 'new-item' }, ITEM_EMOJI[d.newItem], ' ', t(`item.${d.newItem}.desc`)),
        me.items.map((it, i) =>
          h('button', { class: 'item-btn wide', onclick: () => act({ t: 'action', action: { type: 'replaceItem', index: i } }) }, `${t('play.replace')}: ${ITEM_EMOJI[it]} ${t(`item.${it}.name`)}`),
        ),
        h('button', { class: 'secondary', onclick: () => act({ t: 'action', action: { type: 'replaceItem', index: null } }) }, t('play.discard')),
      );
    case 'duelPick':
      return h(
        'div',
        { class: 'decide' },
        h('h2', {}, '⚔️ ', t('play.duelPick')),
        d.options.map((o) =>
          h('button', { class: 'item-btn wide', onclick: () => act({ t: 'action', action: { type: 'duelPick', target: o.player } }) }, `${CHAR_EMOJI[o.character]} ${o.name} · ● ${o.coins}`),
        ),
      );
    case 'wheel':
      return h(
        'div',
        { class: 'decide' },
        h('div', { class: 'wheel-preview' }, d.segments.map((s) => h('span', {}, WHEEL_EMOJI[s] ?? '?', h('small', {}, t(`wheel.${s}`))))),
        h('button', { class: 'ctrl-big roll', onclick: () => act({ t: 'action', action: { type: 'stopWheel' } }) }, t('play.wheelStop')),
      );
  }
}

// ------------------------------------------------------------------ dice

/** The six faces of a die as a small strip (lobby + turn menu). */
function diceStrip(id: DiceId): HTMLElement {
  const def = DICE[id];
  return h(
    'div',
    { class: 'dice-strip', style: `--dc:${def.color};--di:${def.ink}` },
    def.faces.map((f) => h('span', { class: `face${f.steps < 0 ? ' neg' : ''}` }, String(f.steps), f.coins ? h('i', {}, `+${f.coins}●`) : null)),
  );
}

let diceChoice: { options: string; id: DiceId } | null = null;

/** Remembered choice for the current set of options (re-renders keep the selection). */
function pickedDie(options: DiceId[]): DiceId {
  const key = options.join(',');
  if (!diceChoice || diceChoice.options !== key || !options.includes(diceChoice.id)) diceChoice = { options: key, id: options[options.length - 1] };
  return diceChoice.id;
}

function dicePicker(options: DiceId[]): HTMLElement {
  const current = pickedDie(options);
  const cards = options.map((id) =>
    h(
      'button',
      {
        class: `dice-card${id === current ? ' selected' : ''}`,
        'aria-pressed': String(id === current),
        onclick: (ev: Event) => {
          vibrate(8);
          diceChoice = { options: options.join(','), id };
          const wrap = (ev.currentTarget as HTMLElement).parentElement!;
          wrap.querySelectorAll('.dice-card').forEach((el, k) => {
            el.classList.toggle('selected', options[k] === id);
            el.setAttribute('aria-pressed', String(options[k] === id));
          });
        },
      },
      h('strong', {}, t(`dice.${id}.name`)),
      diceStrip(id),
      h('small', {}, t(`dice.${id}.desc`)),
    ),
  );
  return h(
    'section',
    { class: 'card pad dice-pick' },
    h('h3', {}, t('play.secondDie')),
    h('div', { class: `dice-cards n${options.length}` }, cards),
    h('small', { class: 'muted' }, t('play.secondDieHint')),
  );
}

function yesNo(question: string, icon: string, on: (yes: boolean) => void): HTMLElement {
  return h(
    'div',
    { class: 'decide' },
    h('div', { class: 'big-icon' }, icon),
    h('h2', {}, question),
    h('div', { class: 'yes-no' }, h('button', { class: 'primary big', onclick: () => on(true) }, t('common.yes')), h('button', { class: 'secondary big', onclick: () => on(false) }, t('common.no'))),
  );
}

// ------------------------------------------------------------------ minigames

function teamBadge(format: string, team: number): string {
  if (format === '2v2') return t(team === 0 ? 'team.red' : 'team.blue');
  if (format === '1v3') return t(team === 0 ? 'team.solo' : 'team.trio');
  return t(`format.${format}`);
}

function orientationHint(layout: ControllerLayout): HTMLElement | null {
  const landscape = layout.kind === 'joystick' && (layout.buttons?.length ?? 0) > 0;
  return h('div', { class: `rotate-hint ${landscape ? 'want-landscape' : 'want-portrait'}` }, landscape ? t('play.rotateLandscape') : t('play.rotatePortrait'));
}

function mgIntro(app: PlayApp, env: ViewEnvelope, v: Extract<ControllerView, { screen: 'mgIntro' }>, opts: RenderOpts): HTMLElement {
  return h(
    'div',
    { class: 'mg-intro' },
    h('div', { class: 'card pad' }, h('h2', {}, t(`mg.${v.game}.name`)), h('p', { class: 'team' }, teamBadge(v.format, v.team)), h('p', {}, t(`mg.${v.game}.controls`))),
    h('div', { class: 'practice-label' }, t('play.practice')),
    h('div', { class: 'controller' }, opts.mountController(v.layout)),
    orientationHint(v.layout),
    h(
      'div',
      { 'data-dynamic': true, class: 'ready-row' },
      h('button', { class: `primary big ${v.ready ? 'done' : ''}`, disabled: v.ready, onclick: () => (vibrate(20), app.send({ t: 'ready' })) }, v.ready ? t('play.readyDone') : t('play.ready')),
    ),
  );
  void env;
}

function mg(app: PlayApp, env: ViewEnvelope, v: Extract<ControllerView, { screen: 'mg' }>, opts: RenderOpts): HTMLElement {
  void app;
  void env;
  if (v.ended) return h('div', { class: 'card pad big-msg' }, t('play.minigameOver'));
  return h('div', { class: 'mg' }, h('div', { class: 'controller full' }, opts.mountController(v.layout)), orientationHint(v.layout));
}

// ------------------------------------------------------------------ end

function over(app: PlayApp, env: ViewEnvelope, v: Extract<ControllerView, { screen: 'over' }>): HTMLElement {
  return h(
    'div',
    { class: 'over' },
    h('div', { class: 'card pad big-msg' }, h('div', { class: 'big-icon' }, v.place === 1 ? '🏆' : v.place === 2 ? '🥈' : v.place === 3 ? '🥉' : '🎈'), t('play.yourPlace', { place: v.place })),
    h(
      'ol',
      { class: 'card pad ranking' },
      v.ranking.map((r) => h('li', {}, h('strong', {}, r.name), v.mode === 'board' ? ` ★ ${r.stars} · ● ${r.coins}` : ` ${r.points} ${t('stats.points')}`)),
    ),
    v.saveCode ? h('p', { class: 'muted' }, t('play.saveCode', { code: v.saveCode })) : null,
    env.chief
      ? h(
          'div',
          { class: 'yes-no' },
          h('button', { class: 'primary big', onclick: () => app.send({ t: 'postgame', choice: 'rematch' }) }, t('play.rematch')),
          h('button', { class: 'secondary big', onclick: () => app.send({ t: 'postgame', choice: 'lobby' }) }, t('play.backToLobby')),
        )
      : null,
  );
}

function pauseOverlay(app: PlayApp, env: ViewEnvelope): HTMLElement {
  return h(
    'div',
    { class: 'pause-overlay' },
    h('div', { class: 'card pad big-msg' }, '⏸ ', t('host.paused'), env.chief ? h('button', { class: 'primary big', onclick: () => app.send({ t: 'pause', paused: false }) }, t('play.resume')) : h('p', {}, t('host.pausedHint'))),
  );
}

export type { ItemId };
