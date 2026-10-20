// Builds all generated assets that need Blender (models + audio post-processing).
//   node scripts/assets/build.mjs [models|compress|audio]
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
  // raw exports go to assets-src/models; compress.mjs packs them (meshopt) into public/media/models
  run('characters.py', '--out', 'assets-src/models');
  // prop libraries: shared/field buildings + one file per map theme
  for (const lib of ['props', 'props_island', 'props_volcano', 'props_city']) run(`${lib}.py`, '--out', 'assets-src/models');
}
if (what === 'all' || what === 'models' || what === 'compress') execFileSync(process.execPath, ['scripts/assets/compress.mjs'], { stdio: 'inherit' });
if (what === 'all' || what === 'audio') run('audio.py', '--root', process.cwd());
