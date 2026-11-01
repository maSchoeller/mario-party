import './common/base.css';
import './landing.css';
import { t } from '@wb/shared/i18n/index';
import { LOGO_URL } from './common/brand';
import { h } from './common/dom';

/** Landing page: host on the TV laptop, players on their phones. */
const app = document.getElementById('app')!;
document.title = t('app.title');
document.body.classList.add('landing', 'bg-night');
app.append(
  h(
    'main',
    { class: 'landing-wrap' },
    h('h1', { class: 'logo' }, h('img', { src: LOGO_URL, alt: t('app.title') })),
    h(
      'div',
      { class: 'card landing-card' },
      h('p', { class: 'tagline' }, t('app.tagline')),
      h(
        'div',
        { class: 'roles' },
        h('a', { href: '/host', class: 'btn' }, h('button', { class: 'primary', tabindex: -1 }, '📺 ', t('host.createLobby'), h('span', { class: 'role-hint' }, t('landing.hostHint')))),
        h('a', { href: '/play', class: 'btn' }, h('button', { class: 'secondary', tabindex: -1 }, '📱 ', t('play.join'), h('span', { class: 'role-hint' }, t('landing.playHint')))),
      ),
    ),
    h(
      'nav',
      { class: 'landing-links' },
      h('a', { href: '/dev' }, t('host.devPanel')),
      h('a', { href: '/impressum.html' }, t('legal.imprint')),
      h('a', { href: '/datenschutz.html' }, t('legal.privacy')),
    ),
  ),
);
