// CTRL-07: the phone controller must load < 2 MB initially and must not contain a 3D engine.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../apps/web/dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'play.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="\/([^"]+)"/g)].map((m) => m[1]);
const seen = new Set();
let total = statSync(join(dist, 'play.html')).size;
const queue = [...refs];
while (queue.length) {
  const f = queue.shift();
  if (seen.has(f) || !/\.(js|css)$/.test(f)) continue;
  seen.add(f);
  const content = readFileSync(join(dist, f), 'utf8');
  total += statSync(join(dist, f)).size;
  if (/babylon/i.test(content) && /WebGL/.test(content)) throw new Error(`controller bundle ${f} contains the 3D engine`);
  for (const m of content.matchAll(/["'(]\.?\/?(assets\/[^"')]+\.(?:js|css|woff2?))/g)) queue.push(m[1]);
}
console.log(`controller initial load: ${(total / 1024).toFixed(1)} KB (${seen.size} files)`);
if (total > 2 * 1024 * 1024) throw new Error('controller exceeds 2 MB');
