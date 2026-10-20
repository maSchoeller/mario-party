import '../common/base.css';
import './play.css';
import { BALANCE } from '@wb/shared/config';
import { t } from '@wb/shared/i18n/index';
import { ClockSync } from '@wb/shared/net/clock';
import type { HostToPhone, PhoneToHost, ViewEnvelope } from '@wb/shared/net/protocol';
import { isNicknameAllowed, sanitizeNickname } from '@wb/shared/nickname';
import { isValidCode, normalizeCode } from '@wb/shared/roomcode';
import { clear, h } from '../common/dom';
import type { LinkMode } from '../net/peerLink';
import { PhoneNetwork } from '../net/phoneNetwork';
import { layoutKey, mountController, type MountedController } from './controllers';
import { renderScreen, renderHeader, screenKey } from './screens';
import { requestMotionPermission, vibrate, wantWakeLock } from './sensors';

/**
 * Phone controller (/play). Pure DOM, no 3D (CTRL-07). The host sends complete view
 * envelopes; the phone renders them and sends inputs back (TECH-03).
 */
export interface PlayApp {
  send(msg: PhoneToHost, unreliable?: boolean): void;
  hostNow(): number;
  env: ViewEnvelope | null;
  mode: LinkMode;
  token: string;
  rerender(): void;
}

const params = new URLSearchParams(location.search);
const root = document.getElementById('app')!;
const clock = new ClockSync();
let env: ViewEnvelope | null = null;
let joined = false;
let errorKey: string | null = null;
let currentKey = '';
let mounted: MountedController | null = null;
let screenEl: HTMLElement | null = null;
let headerEl: HTMLElement | null = null;
let code = normalizeCode(params.get('code') ?? localStorage.getItem('wb.lastCode') ?? '');
let name = localStorage.getItem('wb.name') ?? '';
let hostOnline = true;

// the dev view (/dev) runs several simulated phones in one browser: keep their tokens apart
const devSuffix = params.get('dev') ? `.dev${params.get('dev')}` : '';
const tokenKey = (c: string) => `wb.token.${c}${devSuffix}`;

const net = new PhoneNetwork({
  onJoined(token) {
    localStorage.setItem(tokenKey(code), token);
    localStorage.setItem('wb.lastCode', code);
    joined = true;
    errorKey = null;
    app.token = token;
    hello();
    startClockSync();
    wantWakeLock();
    render();
  },
  onHostMessage(msg: HostToPhone) {
    switch (msg.t) {
      case 'view':
        env = msg.v;
        app.env = env;
        render();
        break;
      case 'time':
        clock.addSample(msg.c, msg.h, performance.now());
        break;
      case 'vibrate':
        vibrate(msg.ms);
        break;
      case 'reject':
        errorKey = { full: 'play.roomFull', running: 'play.gameRunning', nickname: 'play.nicknameBlocked', kicked: 'play.kicked' }[msg.reason];
        joined = false;
        env = null;
        render();
        break;
      case 'welcome':
        break;
    }
  },
  onError(c) {
    errorKey = c === 'room_not_found' ? 'play.roomNotFound' : c === 'room_full' ? 'play.roomFull' : c === 'kicked' ? 'play.kicked' : null;
    if (c === 'kicked') localStorage.removeItem(tokenKey(code));
    if (errorKey) {
      joined = false;
      env = null;
    }
    render();
  },
  onHostLeft() {
    hostOnline = false;
    render();
  },
  onHostBack() {
    hostOnline = true;
    hello();
    render();
  },
  onMode(m) {
    app.mode = m;
    if (headerEl) updateHeader();
    if (m === 'p2p') hello();
  },
  onServerStatus() {
    if (headerEl) updateHeader();
  },
});

const app: PlayApp = {
  send: (msg, unreliable) => net.send(msg, unreliable),
  hostNow: () => clock.toHost(performance.now()),
  env: null,
  mode: 'connecting',
  token: '',
  rerender: () => render(true),
};

let motionOk = false;
function hello() {
  net.send({ t: 'hello', token: app.token, name, motion: motionOk });
}

let syncTimer: ReturnType<typeof setInterval> | null = null;
let syncId = 0;
function startClockSync() {
  if (syncTimer) return;
  let n = 0;
  const ping = () => net.send({ t: 'time', id: ++syncId, c: performance.now() });
  syncTimer = setInterval(() => {
    ping();
    n++;
  }, 400);
  // fast at the start, then every 3 s
  setTimeout(() => {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(ping, 3000);
  }, 4000);
  void n;
}

async function join(inputCode: string, inputName: string) {
  const c = normalizeCode(inputCode);
  const n = sanitizeNickname(inputName);
  if (!n) return showError('play.nicknameEmpty');
  if (!isNicknameAllowed(n)) return showError('play.nicknameBlocked');
  if (!isValidCode(c, BALANCE.roomCodeLength)) return showError('play.roomNotFound');
  code = c;
  name = n;
  localStorage.setItem('wb.name', n);
  // CTRL-06: ask for gyro permission once, right here in the join gesture
  motionOk = (await requestMotionPermission()) === 'granted';
  errorKey = null;
  net.join(c, localStorage.getItem(tokenKey(c)) ?? undefined);
  render(true);
}

function showError(key: string) {
  errorKey = key;
  render(true);
}

function joinScreen(): HTMLElement {
  const codeInput = h('input', { id: 'code', maxlength: 4, value: code, autocomplete: 'off', autocapitalize: 'characters', inputmode: 'text', placeholder: 'ABCD' });
  const nameInput = h('input', { id: 'name', maxlength: BALANCE.nicknameMaxLength, value: name, autocomplete: 'nickname', placeholder: t('play.nickname') });
  const btn = h('button', { class: 'primary big', id: 'join' }, t('play.join'));
  const form = h(
    'form',
    { class: 'join card', onsubmit: (e: Event) => (e.preventDefault(), void join(codeInput.value, nameInput.value)) },
    h('h1', {}, t('app.title')),
    h('label', {}, t('play.code'), codeInput),
    h('label', {}, t('play.nickname'), nameInput),
    errorKey ? h('p', { class: 'error' }, t(errorKey)) : null,
    btn,
    h('p', { class: 'hint' }, t('play.motionHint')),
  );
  return h('div', { class: 'screen center' }, form);
}

function updateHeader() {
  if (!headerEl) return;
  const fresh = renderHeader(app, hostOnline);
  headerEl.replaceWith(fresh);
  headerEl = fresh;
}

function render(force = false) {
  if (!joined || (!env && errorKey)) {
    mounted?.destroy();
    mounted = null;
    clear(root);
    currentKey = 'join';
    if (joined && !env) root.append(h('div', { class: 'screen center' }, h('div', { class: 'card pad' }, t('play.joining'))));
    else root.append(joinScreen());
    return;
  }
  if (!env) {
    if (currentKey !== 'connecting') {
      clear(root);
      currentKey = 'connecting';
      root.append(h('div', { class: 'screen center' }, h('div', { class: 'card pad' }, t('play.joining'))));
    }
    return;
  }
  const key = screenKey(env) + (env.view.screen === 'mg' || env.view.screen === 'mgIntro' ? `|${layoutKey(env.view.layout)}` : '');
  if (!force && key === currentKey && screenEl) {
    // same screen: update header + dynamic controller parts only
    updateHeader();
    if (mounted?.update && (env.view.screen === 'mg' || env.view.screen === 'mgIntro')) mounted.update(env.view.layout);
    const dyn = screenEl.querySelector('[data-dynamic]');
    if (dyn) {
      const fresh = renderScreen(app, env, { mountController: () => null });
      const freshDyn = fresh.querySelector('[data-dynamic]');
      if (freshDyn) dyn.replaceWith(freshDyn);
    }
    return;
  }
  currentKey = key;
  mounted?.destroy();
  mounted = null;
  clear(root);
  headerEl = renderHeader(app, hostOnline);
  screenEl = renderScreen(app, env, {
    mountController: (layout) => {
      mounted = mountController(layout, {
        send: (input, unreliable) => net.send({ t: 'mg', input }, unreliable),
        hostNow: app.hostNow,
      });
      return mounted.el;
    },
  });
  root.append(headerEl, screenEl);
}

// auto-join with a stored token (reconnect, LOBBY-05); QR links prefill the code
const storedToken = code ? localStorage.getItem(tokenKey(code)) : null;
if (code && name && storedToken) net.join(code, storedToken);
render();
