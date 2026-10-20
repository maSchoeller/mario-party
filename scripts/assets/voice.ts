// Moderator voice clips via ElevenLabs TTS (AUDIO-03, v0.3: sparse, whole lines).
//
//   npx tsx scripts/assets/voice.ts --dry   # list clips to record + character cost
//   npx tsx scripts/assets/voice.ts         # record new/changed clips
//
// Raw clips: assets-src/voice/<file>.mp3 (post-processed by build-audio into
// apps/web/public/media/audio/voice/), manifest: public/…/voice/manifest.json { clipId: textHash }.
// Recording is idempotent: only clips whose text changed are sent again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { de } from '../../packages/shared/src/i18n/index';
import { allVoiceClips, clipFile, voiceHash } from '../../packages/shared/src/i18n/voice';
// @ts-expect-error plain JS helper
import { secret } from './secrets.mjs';

export const VOICE = {
  // ElevenLabs library voice "DiMario – Energetic and Fun" (German moderator, chosen by the
  // product owner in the voice casting, 20.10.2026).
  voiceId: 'DQ4rTqXxHr077oQgsA9D',
  modelId: 'eleven_v3',
  settings: { stability: 0.5, similarity_boost: 0.8, style: 0.5, use_speaker_boost: true },
};

const OUT = 'assets-src/voice';
const manifestFile = 'apps/web/public/media/audio/voice/manifest.json';
const dry = process.argv.includes('--dry');

const clips = allVoiceClips((c) => de[`char.${c}`]);
const manifest: Record<string, string> = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
const todo = Object.entries(clips).filter(([id, text]) => manifest[id] !== voiceHash(text));
const cost = todo.reduce((n, [, text]) => n + text.length, 0);
console.log(`${Object.keys(clips).length} clips, ${todo.length} to record, ~${cost} characters`);
if (dry) {
  for (const [id, text] of todo) console.log(' ·', id, JSON.stringify(text));
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
mkdirSync('apps/web/public/media/audio/voice', { recursive: true });
const key = secret('ELEVENLABS_API_KEY');
let spent = 0;
for (const [id, text] of todo) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: VOICE.modelId, language_code: 'de', voice_settings: VOICE.settings }),
  });
  if (!r.ok) {
    console.error(`✗ ${id}: ${r.status} ${await r.text()}`);
    if (r.status === 401 || r.status === 402 || r.status === 429) break;
    continue;
  }
  spent += Number(r.headers.get('character-cost') ?? 0);
  writeFileSync(`${OUT}/${clipFile(id)}.mp3`, Buffer.from(await r.arrayBuffer()));
  manifest[id] = voiceHash(text);
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  console.log(`✓ ${id} ${text}`);
}
// drop clips that are no longer used
for (const id of Object.keys(manifest)) if (!(id in clips)) delete manifest[id];
writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
console.log(`spent ${spent} characters`);
