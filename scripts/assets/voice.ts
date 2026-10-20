// Moderator voice segments via ElevenLabs TTS (AUDIO-03).
//
//   npx tsx scripts/assets/voice.ts --dry   # list segments + character cost
//   npx tsx scripts/assets/voice.ts         # record missing segments
//
// Raw clips: assets-src/voice/<id>.mp3 (post-processed by build-audio into
// apps/web/public/media/audio/voice/), manifest: public/…/voice/manifest.json { text: id }.
// Recording is idempotent: only texts missing from the manifest are sent.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CHARACTERS } from '../../packages/shared/src/config';
import { de } from '../../packages/shared/src/i18n/index';
import { allVoiceSegments } from '../../packages/shared/src/i18n/voice';
// @ts-expect-error plain JS helper
import { secret } from './secrets.mjs';

export const VOICE = {
  // ElevenLabs premade voice "Callum – Husky Trickster" (characters/animation); the free plan
  // cannot use library or designed voices via the API.
  voiceId: 'N2lVS1w4EtoT3dr4eOWO',
  modelId: 'eleven_v3',
  // stability low = more expressive, game-show like
  settings: { stability: 0.5, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true },
};

const OUT = 'assets-src/voice';
const manifestFile = 'apps/web/public/media/audio/voice/manifest.json';
const dry = process.argv.includes('--dry');

const names = CHARACTERS.map((c) => de[`char.${c}`]);
const segments = allVoiceSegments(de, names);
const manifest: Record<string, string> = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
const todo = segments.filter((s) => !manifest[s]);
const cost = todo.reduce((n, s) => n + spoken(s).length, 0);
console.log(`${segments.length} segments, ${todo.length} to record, ~${cost} characters`);
if (dry) {
  for (const s of todo) console.log(' ·', JSON.stringify(spoken(s)));
  process.exit(0);
}

/** What is actually sent (numbers stay digits – the model reads them in German). */
function spoken(s: string): string {
  return s;
}

mkdirSync(OUT, { recursive: true });
mkdirSync('apps/web/public/media/audio/voice', { recursive: true });
const key = secret('ELEVENLABS_API_KEY');
let spent = 0;
for (const s of todo) {
  const id = createHash('sha1').update(s).digest('hex').slice(0, 10);
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.voiceId}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text: spoken(s), model_id: VOICE.modelId, language_code: 'de', voice_settings: VOICE.settings }),
  });
  if (!r.ok) {
    console.error(`✗ ${s}: ${r.status} ${await r.text()}`);
    if (r.status === 401 || r.status === 402 || r.status === 429) break;
    continue;
  }
  spent += Number(r.headers.get('character-cost') ?? 0);
  writeFileSync(`${OUT}/${id}.mp3`, Buffer.from(await r.arrayBuffer()));
  manifest[s] = id;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  console.log(`✓ ${id} ${s}`);
}
console.log(`spent ${spent} characters`);
