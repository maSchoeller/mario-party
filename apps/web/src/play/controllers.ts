import type { ControllerLayout, MgInput } from '@wb/shared/minigames/types';
import { t } from '@wb/shared/i18n/index';
import { h } from '../common/dom';
import { motionAvailable, startShake, startTilt, vibrate } from './sensors';

/**
 * Minigame controller layouts (SPEC 7.2, MINI-05). Every layout produces MgInputs.
 * Press timestamps are taken on the phone and converted to host time (NET-05).
 */
export interface ControllerCtx {
  send(input: MgInput, unreliable?: boolean): void;
  hostNow(): number;
}

export interface MountedController {
  el: HTMLElement;
  /** update dynamic parts without rebuilding (e.g. locked choice, active pads) */
  update?(layout: ControllerLayout): void;
  destroy(): void;
}

export function layoutKey(l: ControllerLayout): string {
  switch (l.kind) {
    case 'choice':
      return `choice:${l.options.map((o) => o.id).join(',')}`;
    case 'pads':
      return `pads:${l.count}`;
    case 'draw':
      return `draw:${JSON.stringify(l.shape).length}:${l.shape[0]?.join(',')}`;
    case 'number':
      return `number:${l.min}:${l.max}`;
    case 'joystick':
      return `joystick:${(l.buttons ?? []).map((b) => b.id).join(',')}`;
    case 'button':
    case 'mash':
      // label changes (e.g. "your turn"/"partner") are applied via update()
      return l.kind;
    default:
      return `${l.kind}:${'labelKey' in l ? l.labelKey ?? '' : ''}`;
  }
}

export function mountController(layout: ControllerLayout, ctx: ControllerCtx): MountedController {
  switch (layout.kind) {
    case 'joystick':
      return joystick(layout, ctx);
    case 'mash':
      return mash(layout, ctx);
    case 'button':
      return pressButton(layout, ctx);
    case 'tilt':
      return tilt(ctx, layout.labelKey);
    case 'shake':
      return shake(ctx, layout.labelKey);
    case 'draw':
      return draw(layout, ctx);
    case 'swipe':
      return swipe(ctx, layout.labelKey);
    case 'choice':
      return choice(layout, ctx);
    case 'number':
      return numberInput(layout, ctx);
    case 'pads':
      return pads(layout, ctx);
    case 'wait':
    default:
      return { el: h('div', { class: 'ctrl-wait' }, t('labelKey' in layout && layout.labelKey ? layout.labelKey : 'ctrl.watch')), destroy() {} };
  }
}

// ---------------------------------------------------------------- joystick

function stickPad(onMove: (x: number, y: number) => void, label?: string): { el: HTMLElement; destroy(): void } {
  const knob = h('div', { class: 'stick-knob' });
  const base = h('div', { class: 'stick-base' }, knob);
  const zone = h('div', { class: 'stick-zone' }, base, label ? h('div', { class: 'stick-label' }, label) : null);
  let pointer: number | null = null;
  let center = { x: 0, y: 0 };
  let last = 0;
  let pending: { x: number; y: number } | null = null;
  const radius = () => base.clientWidth / 2;
  const emit = (x: number, y: number, force = false) => {
    pending = { x, y };
    const now = performance.now();
    if (force || now - last > 33) {
      last = now;
      onMove(pending.x, pending.y);
      pending = null;
    }
  };
  const timer = setInterval(() => {
    if (pending) emit(pending.x, pending.y, true);
  }, 40);
  zone.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return;
    pointer = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    const r = base.getBoundingClientRect();
    center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    move(e);
  });
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    const R = radius();
    let dx = e.clientX - center.x;
    let dy = e.clientY - center.y;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx *= R / len;
      dy *= R / len;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    emit(dx / R, -dy / R);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    knob.style.transform = '';
    emit(0, 0, true);
  };
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  return { el: zone, destroy: () => clearInterval(timer) };
}

function joystick(layout: Extract<ControllerLayout, { kind: 'joystick' }>, ctx: ControllerCtx): MountedController {
  const pad = stickPad((x, y) => ctx.send({ type: 'stick', x: round(x), y: round(y) }, true));
  const buttons = (layout.buttons ?? []).map((b) => {
    const btn = h('button', { class: 'ctrl-action' }, t(b.labelKey));
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      vibrate(15);
      ctx.send({ type: 'button', id: b.id, down: true });
    });
    const up = () => ctx.send({ type: 'button', id: b.id, down: false });
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    return btn;
  });
  const el = h('div', { class: `ctrl-joystick ${buttons.length ? 'with-buttons' : ''}` }, pad.el, buttons.length ? h('div', { class: 'ctrl-buttons' }, buttons) : null);
  return { el, destroy: pad.destroy };
}

// ---------------------------------------------------------------- tap / timing

function mash(layout: Extract<ControllerLayout, { kind: 'mash' }>, ctx: ControllerCtx): MountedController {
  const btn = h('button', { class: 'ctrl-big mash' }, t(layout.labelKey));
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    vibrate(8);
    ctx.send({ type: 'tap' });
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
  });
  return {
    el: h('div', { class: 'ctrl-center' }, btn),
    update(l) {
      if (l.kind === 'mash') btn.textContent = t(l.labelKey);
    },
    destroy() {},
  };
}

function pressButton(layout: Extract<ControllerLayout, { kind: 'button' }>, ctx: ControllerCtx): MountedController {
  const btn = h('button', { class: 'ctrl-big press' }, t(layout.labelKey));
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // timestamp taken immediately on the phone, converted to host clock (NET-05)
    ctx.send({ type: 'press', t: ctx.hostNow() });
    vibrate(20);
  });
  return {
    el: h('div', { class: 'ctrl-center' }, btn),
    update(l) {
      if (l.kind === 'button') btn.textContent = t(l.labelKey);
    },
    destroy() {},
  };
}

// ---------------------------------------------------------------- motion (with fallbacks)

function tilt(ctx: ControllerCtx, labelKey?: string): MountedController {
  if (motionAvailable()) {
    const ball = h('div', { class: 'tilt-ball' });
    const el = h('div', { class: 'ctrl-tilt' }, h('div', { class: 'tilt-dish' }, ball), h('p', {}, t(labelKey ?? 'ctrl.tilt')));
    let last = 0;
    const stop = startTilt((x, y) => {
      ball.style.transform = `translate(${x * 60}px, ${-y * 60}px)`;
      const now = performance.now();
      if (now - last > 33) {
        last = now;
        ctx.send({ type: 'tilt', x: round(x), y: round(y) }, true);
      }
    });
    return { el, destroy: stop };
  }
  // fallback: on-screen pad (A11Y, desktop testing, denied permission)
  const pad = stickPad((x, y) => ctx.send({ type: 'tilt', x: round(x), y: round(y) }, true));
  return { el: h('div', { class: 'ctrl-tilt fallback' }, pad.el, h('p', {}, labelKey ? `${t(labelKey)} – ` : '', t('ctrl.tiltFallback'))), destroy: pad.destroy };
}

function shake(ctx: ControllerCtx, labelKey?: string): MountedController {
  const meter = h('div', { class: 'shake-meter' });
  const bump = (p: number) => {
    meter.style.transform = `scale(${1 + p * 0.4})`;
    setTimeout(() => (meter.style.transform = ''), 90);
  };
  if (motionAvailable()) {
    const stop = startShake((power) => {
      ctx.send({ type: 'shake', power: round(power) });
      bump(power);
    });
    return { el: h('div', { class: 'ctrl-shake' }, meter, h('p', {}, t(labelKey ?? 'ctrl.shake'))), destroy: stop };
  }
  const btn = h('button', { class: 'ctrl-big mash' }, t('ctrl.shake'));
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ctx.send({ type: 'shake', power: 0.6 });
    bump(0.6);
    vibrate(8);
  });
  return { el: h('div', { class: 'ctrl-shake fallback' }, btn, h('p', {}, t('ctrl.shakeFallback'))), destroy() {} };
}

// ---------------------------------------------------------------- draw / swipe / choice

function draw(layout: Extract<ControllerLayout, { kind: 'draw' }>, ctx: ControllerCtx): MountedController {
  const canvas = h('canvas', { class: 'draw-canvas' });
  const el = h('div', { class: 'ctrl-draw' }, h('p', {}, t('ctrl.draw')), canvas);
  const g = canvas.getContext('2d')!;
  let points: [number, number][] = [];
  let started = 0;
  let drawing = false;
  const size = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    paint();
  };
  const paint = () => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.lineCap = g.lineJoin = 'round';
    g.lineWidth = 14 * devicePixelRatio;
    g.strokeStyle = 'rgba(110,118,175,0.25)';
    g.beginPath();
    layout.shape.forEach(([x, y], i) => (i ? g.lineTo(x * canvas.width, y * canvas.height) : g.moveTo(x * canvas.width, y * canvas.height)));
    g.stroke();
    g.lineWidth = 6 * devicePixelRatio;
    g.strokeStyle = '#e8676b';
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x * canvas.width, y * canvas.height) : g.moveTo(x * canvas.width, y * canvas.height)));
    g.stroke();
  };
  const pos = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [round((e.clientX - r.left) / r.width), round((e.clientY - r.top) / r.height)];
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    points = [pos(e)];
    started = performance.now();
    paint();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    const lp = points[points.length - 1];
    if (Math.hypot(p[0] - lp[0], p[1] - lp[1]) > 0.008) points.push(p);
    paint();
  });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    if (points.length > 2) ctx.send({ type: 'draw', points: points.slice(0, 400), duration: (performance.now() - started) / 1000 });
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  requestAnimationFrame(size);
  window.addEventListener('resize', size);
  return {
    el,
    update(l) {
      if (l.kind === 'draw' && JSON.stringify(l.shape) !== JSON.stringify(layout.shape)) {
        layout = l;
        points = [];
        paint();
      }
    },
    destroy: () => window.removeEventListener('resize', size),
  };
}

function swipe(ctx: ControllerCtx, labelKey?: string): MountedController {
  const zone = h('div', { class: 'swipe-zone' }, h('span', {}, '⬆️'), h('p', {}, t(labelKey ?? 'ctrl.swipe')));
  let start: { x: number; y: number } | null = null;
  const fire = (dir: 'up' | 'down' | 'left' | 'right') => {
    ctx.send({ type: 'swipe', dir });
    vibrate(12);
    zone.dataset.dir = dir;
    setTimeout(() => delete zone.dataset.dir, 150);
  };
  zone.addEventListener('pointerdown', (e) => {
    zone.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
  });
  zone.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
    fire(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });
  const arrows = h(
    'div',
    { class: 'swipe-arrows' },
    (['left', 'up', 'down', 'right'] as const).map((d) => h('button', { onclick: () => fire(d), 'aria-label': d }, { left: '⬅️', up: '⬆️', down: '⬇️', right: '➡️' }[d])),
  );
  return { el: h('div', { class: 'ctrl-swipe' }, zone, arrows), destroy() {} };
}

function choice(layout: Extract<ControllerLayout, { kind: 'choice' }>, ctx: ControllerCtx): MountedController {
  const buttons = new Map<string, HTMLButtonElement>();
  const el = h(
    'div',
    { class: `ctrl-choice n${layout.options.length}` },
    layout.options.map((o) => {
      const b = h('button', { style: o.color ? `background:${o.color};color:#fff` : '' }, o.icon ? h('span', { class: 'icon' }, o.icon) : null, h('span', {}, t(o.labelKey)));
      b.addEventListener('click', () => {
        vibrate(15);
        ctx.send({ type: 'choice', id: o.id });
      });
      buttons.set(o.id, b);
      return b;
    }),
  );
  const update = (l: ControllerLayout) => {
    if (l.kind !== 'choice') return;
    for (const [id, b] of buttons) {
      b.classList.toggle('locked', l.locked === id);
      b.disabled = !!l.locked && l.locked !== id;
    }
  };
  update(layout);
  return { el, update, destroy() {} };
}

function numberInput(layout: Extract<ControllerLayout, { kind: 'number' }>, ctx: ControllerCtx): MountedController {
  let value = layout.value ?? Math.round((layout.min + layout.max) / 4);
  let sent = layout.value !== null && layout.value !== undefined;
  const display = h('div', { class: 'num-display' }, String(value));
  const send = h('button', { class: 'ctrl-big send' }, t('ctrl.send'));
  const set = (v: number) => {
    if (sent) return;
    value = Math.max(layout.min, Math.min(layout.max, v));
    display.textContent = String(value);
  };
  const step = (d: number) => h('button', { class: 'num-step', onclick: () => set(value + d) }, d > 0 ? `+${d}` : String(d));
  send.addEventListener('click', () => {
    if (sent) return;
    sent = true;
    send.disabled = true;
    ctx.send({ type: 'number', value });
    vibrate(20);
  });
  const el = h('div', { class: 'ctrl-number' }, h('p', {}, t('ctrl.number')), h('div', { class: 'num-row' }, step(-5), step(-1), display, step(1), step(5)), send);
  return {
    el,
    update(l) {
      if (l.kind === 'number' && (l.value === null || l.value === undefined) && sent) {
        sent = false;
        send.disabled = false;
      }
    },
    destroy() {},
  };
}

function pads(layout: Extract<ControllerLayout, { kind: 'pads' }>, ctx: ControllerCtx): MountedController {
  const list = Array.from({ length: layout.count }, (_, i) => {
    const b = h('button', { class: 'pad', style: `background:${layout.colors[i] ?? '#ccc'}` });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (b.disabled) return;
      vibrate(12);
      ctx.send({ type: 'pad', idx: i });
      b.classList.add('flash');
      setTimeout(() => b.classList.remove('flash'), 120);
    });
    return b;
  });
  const el = h('div', { class: `ctrl-pads n${layout.count}` }, list);
  const update = (l: ControllerLayout) => {
    if (l.kind !== 'pads') return;
    const active = l.active !== false;
    list.forEach((b) => (b.disabled = !active));
    el.classList.toggle('inactive', !active);
  };
  update(layout);
  return { el, update, destroy() {} };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
