import './common/base.css';
import { t } from '@wb/shared/i18n/index';
import { h } from './common/dom';

/** Landing page: host on the TV laptop, players on their phones. */
const app = document.getElementById('app')!;
document.title = t('app.title');
document.body.style.cssText = 'min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#9fd3ec,#e8f4fa);margin:0';
app.append(
  h(
    'div',
    { class: 'card', style: 'padding:2.5rem;text-align:center;display:flex;flex-direction:column;gap:1rem;max-width:520px;margin:1rem' },
    h('h1', { style: 'margin:0;font-size:2.6rem' }, '🎲 ', t('app.title')),
    h('p', { style: 'margin:0;color:var(--ink-soft)' }, t('app.tagline')),
    h('a', { href: '/host' }, h('button', { class: 'primary', style: 'width:100%;font-size:1.3rem;background:#5cc08a;color:#fff' }, '📺 ', t('host.createLobby'))),
    h('a', { href: '/play' }, h('button', { style: 'width:100%;font-size:1.3rem' }, '📱 ', t('play.join'))),
    h('a', { href: '/dev', style: 'color:var(--ink-soft)' }, t('host.devPanel')),
    h(
      'p',
      { style: 'margin:0;font-size:.85rem' },
      h('a', { href: '/impressum.html', style: 'color:var(--ink-soft)' }, t('legal.imprint')),
      ' · ',
      h('a', { href: '/datenschutz.html', style: 'color:var(--ink-soft)' }, t('legal.privacy')),
    ),
  ),
);
