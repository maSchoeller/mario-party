// Compresses the Blender GLBs with meshopt (EXT_meshopt_compression + quantization) for delivery.
//
//   node scripts/assets/compress.mjs
//
// Input:  assets-src/models/*.glb  (raw Blender export, see build.mjs)
// Output: apps/web/public/media/models/*.glb
// Flags: -cc stronger compression · -kn/-km keep the node/material names the host relies on
// ("<group>__<material>", see apps/web/src/host/render/assets.ts) · 14-bit positions, 8-bit
// normals and vertex colors (baked AO) – visually lossless for the low-poly style.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'assets-src/models';
const OUT = 'apps/web/public/media/models';
mkdirSync(OUT, { recursive: true });
let before = 0;
let after = 0;
for (const f of readdirSync(SRC).filter((n) => n.endsWith('.glb'))) {
  const src = join(SRC, f);
  const out = join(OUT, f);
  execFileSync(process.execPath, ['node_modules/gltfpack/cli.js', '-i', src, '-o', out, '-cc', '-kn', '-km', '-vp', '14', '-vn', '8', '-vc', '8'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const a = statSync(src).size;
  const b = statSync(out).size;
  before += a;
  after += b;
  console.log(`${f.padEnd(20)} ${(a / 1024).toFixed(0).padStart(6)} KB -> ${(b / 1024).toFixed(0).padStart(5)} KB`);
}
console.log(`total ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB (${Math.round((1 - after / before) * 100)} % kleiner)`);
