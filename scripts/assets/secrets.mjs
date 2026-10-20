// Reads API tokens from %USERPROFILE%/.wuerfel-bande/secrets.env (written by scripts/set-secrets.ps1)
// or from the environment. Values are never logged.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const file = join(homedir(), '.wuerfel-bande', 'secrets.env');
const fromFile = {};
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) fromFile[m[1]] = m[2].trim();
  }
}

export function secret(name) {
  const v = process.env[name] ?? fromFile[name];
  if (!v) throw new Error(`${name} fehlt – bitte "pwsh scripts/set-secrets.ps1" ausführen`);
  return v;
}
