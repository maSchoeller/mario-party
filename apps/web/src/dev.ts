import './common/base.css';
import { h } from './common/dom';

/**
 * Local test view: TV + up to four simulated phones in one browser window. Phones are
 * iframes on /play with their own storage partition key (?dev=n) so they get separate
 * session tokens.
 */
const app = document.getElementById('app')!;
document.body.style.cssText = 'margin:0;background:#2b2b3a;height:100vh;overflow:hidden';
const params = new URLSearchParams(location.search);
const phones = Math.max(1, Math.min(4, Number(params.get('phones') ?? 2)));
const relay = params.get('relay') === '1' ? '&relay=1' : '';
const host = h('iframe', { src: `/host?dev=1${relay}`, style: 'border:0;width:100%;height:100%;background:#000', allow: 'autoplay' });
const phoneFrames = Array.from({ length: phones }, (_, i) =>
  h(
    'div',
    { style: 'display:flex;flex-direction:column;gap:4px;min-height:0;flex:1' },
    h('div', { style: 'color:#fff;font:700 12px Nunito,sans-serif' }, `📱 ${i + 1}`),
    h('iframe', { id: `phone${i}`, src: '', style: 'border:0;border-radius:12px;flex:1;background:#fff;min-height:0' }),
  ),
);
const codeInput = h('input', { placeholder: 'Code', maxlength: 4, style: 'width:90px;text-transform:uppercase' });
const joinAll = h('button', {}, 'Alle Handys verbinden');
joinAll.addEventListener('click', () => {
  const code = codeInput.value.toUpperCase();
  phoneFrames.forEach((_, i) => {
    const f = document.getElementById(`phone${i}`) as HTMLIFrameElement;
    f.src = `/play?code=${code}&dev=${i}${relay}`;
  });
});
// pick up the room code from the host iframe automatically (same origin)
setInterval(() => {
  try {
    const code = (host.contentWindow as unknown as { __wb?: { session: { net: { code: string | null } } } })?.__wb?.session.net.code;
    if (code && !codeInput.value) codeInput.value = code;
  } catch {
    /* ignore */
  }
}, 1000);
app.append(
  h(
    'div',
    { style: 'display:grid;grid-template-columns:1fr 360px;height:100vh;gap:8px;padding:8px;box-sizing:border-box' },
    host,
    h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-height:0' }, h('div', { style: 'display:flex;gap:6px' }, codeInput, joinAll), ...phoneFrames),
  ),
);
