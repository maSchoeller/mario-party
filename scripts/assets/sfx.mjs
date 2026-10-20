// Sound effects + character babble via ElevenLabs sound generation (AUDIO-02, AUDIO-04).
//
//   node scripts/assets/sfx.mjs            # missing ones
//   node scripts/assets/sfx.mjs coin dice  # (re)generate these
//
// Raw output: assets-src/sfx/<key>.mp3 (post-processed by build-audio); log for the license register in
// assets-src/sfx-log.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { secret } from './secrets.mjs';

export const SFX = {
  dice: { d: 0.8, p: 'a few plastic dice rattling in a cup and tumbling onto a wooden board game table, short' },
  step: { d: 0.5, p: 'single soft cartoon footstep hop, tiny wooden board game piece hopping one space, cute boing' },
  coin: { d: 0.6, p: 'bright cartoon video game coin pickup chime, sparkly, single coin' },
  coinLoss: { d: 0.9, p: 'cartoon losing coins, descending sad blips with coins scattering, video game penalty' },
  star: { d: 1.5, p: 'magical sparkling star collected, shimmering chimes rising, video game reward' },
  item: { d: 0.8, p: 'cheerful video game item pickup, quick rising pop with sparkle' },
  ui: { d: 0.5, p: 'soft rounded UI click pop, friendly menu button' },
  whoosh: { d: 0.7, p: 'fast cartoon whoosh swish, character zooming past' },
  boom: { d: 1.8, p: 'cartoon volcano eruption boom with rumble and rocks, comedic not scary' },
  train: { d: 2.0, p: 'toy steam train whistle toot toot with chugging, cheerful' },
  buzz: { d: 0.7, p: 'game show wrong answer buzzer, short, comedic' },
  ding: { d: 0.8, p: 'single bright bell ding, game show ready signal' },
  fanfare: { d: 2.5, p: 'short triumphant brass fanfare, winner announcement, cheerful video game' },
  splash: { d: 1.0, p: 'cartoon water splash, character falls into the sea, playful' },
  babble_rocco: { d: 1.2, p: 'cute cartoon raccoon character speaking short gibberish nonsense syllables, mischievous chuckle, no real words' },
  babble_quaki: { d: 1.2, p: 'cute cartoon frog character speaking short gibberish nonsense syllables, croaky proud voice, no real words' },
  babble_pingo: { d: 1.2, p: 'cute cartoon penguin character speaking short gibberish nonsense syllables, squeaky happy voice, no real words' },
  babble_foxy: { d: 1.2, p: 'cute cartoon fox character speaking short gibberish nonsense syllables, sly playful voice, no real words' },
  clack: { d: 0.5, p: 'single chunky plastic board game die hitting a wooden table once, one short clack, dry, no reverb' },
  babble_bruno: { d: 1.2, p: 'cute cartoon bear character speaking short gibberish nonsense syllables, deep cozy friendly rumble, no real words' },
  babble_hoppla: { d: 1.2, p: 'cute cartoon bunny character speaking short fast gibberish nonsense syllables, hyper energetic high voice, no real words' },
  babble_schildi: { d: 1.2, p: 'cute cartoon turtle character speaking short slow gibberish nonsense syllables, calm drawling voice, no real words' },
  babble_zippy: { d: 1.2, p: 'cute cartoon squirrel character speaking short very fast squeaky gibberish nonsense syllables, excited chatter, no real words' },
  babble_moderator: { d: 1.2, p: 'cartoon parrot squawking short gibberish chatter, funny pirate parrot, no real words' },
};

const OUT = 'assets-src/sfx';
const LOG = 'assets-src/sfx-log.json';
mkdirSync(OUT, { recursive: true });
mkdirSync('assets-src', { recursive: true });
const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : [];
const args = process.argv.slice(2);
const keys = args.length ? args : Object.keys(SFX).filter((k) => !existsSync(`${OUT}/${k}.mp3`));
const apiKey = secret('ELEVENLABS_API_KEY');

for (const k of keys) {
  const s = SFX[k];
  const r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_64', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ text: s.p, duration_seconds: s.d, prompt_influence: 0.6 }),
  });
  if (!r.ok) {
    console.error(`✗ ${k}: ${r.status} ${await r.text()}`);
    if ([401, 402, 429].includes(r.status)) break;
    continue;
  }
  writeFileSync(`${OUT}/${k}.mp3`, Buffer.from(await r.arrayBuffer()));
  log.push({ key: k, prompt: s.p, duration: s.d, cost: r.headers.get('character-cost'), date: new Date().toISOString() });
  writeFileSync(LOG, JSON.stringify(log, null, 2));
  console.log(`✓ ${k} (cost ${r.headers.get('character-cost')})`);
}
