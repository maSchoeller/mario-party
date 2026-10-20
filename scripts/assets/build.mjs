// Builds all generated assets that need Blender (models + audio post-processing).
//   node scripts/assets/build.mjs [models|audio]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const blender =
  process.env.BLENDER ??
  ['C:/Program Files/Blender Foundation/Blender 5.2/blender.exe', '/Applications/Blender.app/Contents/MacOS/Blender', 'blender'].find(
    (p) => p === 'blender' || existsSync(p),
  );
const what = process.argv[2] ?? 'all';
const run = (script, ...args) => execFileSync(blender, ['-b', '--factory-startup', '-P', `scripts/assets/blender/${script}`, '--', ...args], { stdio: 'inherit' });

if (what === 'all' || what === 'models') {
  run('characters.py', '--out', 'apps/web/public/media/models');
  run('props.py', '--out', 'apps/web/public/media/models');
}
if (what === 'all' || what === 'audio') run('audio.py', '--root', process.cwd());
