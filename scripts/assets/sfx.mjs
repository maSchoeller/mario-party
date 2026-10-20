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
  // v0.4: minigame effects
  mg_splash2: { d: 0.8, p: 'small cartoon splash, round object plopping into water, playful, short' },
  mg_swish: { d: 0.5, p: 'quick light swish of an arm swinging through the air, cartoon, short' },
  mg_thud: { d: 0.5, p: 'cartoon bonk, a coconut bouncing off a character head, comedic soft hollow thud' },
  mg_thud2: { d: 0.5, p: 'soft cartoon body bump thump, two cute characters bumping into each other, comedic' },
  mg_pop: { d: 0.5, p: 'single balloon pop, crisp and bright, cartoon party' },
  mg_jump: { d: 0.5, p: 'cartoon jump boing, cute springy hop, video game' },
  mg_land: { d: 0.5, p: 'soft dull thump of a heavy object landing on sand, short, no reverb' },
  mg_cheer: { d: 2.5, p: 'small cheerful crowd cheering and clapping, short celebration, family party game' },
  mg_aww: { d: 1.5, p: 'small crowd going aww in disappointment, comedic, short' },
  mg_crack: { d: 0.8, p: 'ice cracking, sharp crunchy crack of an ice floe breaking apart' },
  mg_sizzle: { d: 1.0, p: 'cartoon lava sizzle, something falling into hot lava with a hiss and a bubble pop' },
  mg_cannon: { d: 1.0, p: 'cartoon cannon shot, puffy boom with a whoosh, comedic, not violent' },
  mg_catch: { d: 0.5, p: 'soft satisfying catch, a coconut caught in two hands, woody plop with a tiny sparkle' },
  mg_correct: { d: 0.8, p: 'positive quiz correct answer chime, two bright rising notes, game show' },
  mg_click: { d: 0.5, p: 'mechanical railway switch lever thrown, metal click clunk, short' },
  mg_magic: { d: 1.0, p: 'magic wand shimmer, short sparkling twinkle, fairy dust' },
  mg_scribble: { d: 1.0, p: 'pencil scribbling quickly on paper, short' },
  mg_creak: { d: 0.8, p: 'wooden plank creaking, wobbly rope bridge sway creak' },
  mg_paddle: { d: 0.8, p: 'pedal boat paddle wheel churning water, short rhythmic splashes' },
  mg_stomp: { d: 0.5, p: 'quick cartoon footstep stomp on a stone stair step, climbing' },
  mg_swing: { d: 0.6, p: 'jump rope whooshing through the air, single swing swish' },
  mg_slide: { d: 0.8, p: 'cartoon character sliding on ice, slippery whoosh with a little skid' },
  // v0.4: match flow
  mg_tick: { d: 0.5, p: 'single clean countdown tick beep, game show, short, no reverb' },
  mg_go: { d: 1.2, p: 'energetic start signal, short game show horn blast with a sparkle, go' },
  mg_whistle: { d: 1.0, p: 'referee whistle, one long blow, end of the match' },
  mg_transition: { d: 1.0, p: 'cartoon scene transition swoosh, magical whoosh with a sparkle tail' },
  mg_reveal: { d: 2.0, p: 'results reveal stinger, short snare drumroll ending in a cymbal crash and sparkle' },
  // v0.4: ambience beds of the minigame backdrops (seamless loops)
  amb_sea: { d: 12, loop: true, p: 'gentle tropical lagoon ambience, soft waves lapping on a sandy beach, distant seagulls, calm, no music' },
  amb_lava: { d: 12, loop: true, p: 'volcano ambience, deep low rumble, slow bubbling lava, occasional soft hiss, not scary, no music' },
  amb_meadow: { d: 12, loop: true, p: 'sunny meadow ambience, songbirds chirping, light breeze in the grass, no music' },
  amb_city: { d: 12, loop: true, p: 'pleasant small town square ambience, distant friendly chatter, pigeons, faint bicycle bell, no music' },
  amb_ice: { d: 12, loop: true, p: 'arctic sea ambience, cold wind, gentle water, faint ice creaking, no music' },
  amb_wind: { d: 12, loop: true, p: 'high in the sky above the clouds, soft airy wind gusts, calm, no music' },
  amb_studio: { d: 12, loop: true, p: 'game show studio, excited audience murmur waiting, indoor room tone, no music' },
  amb_desert: { d: 12, loop: true, p: 'desert ambience, dry warm wind, faint insects buzzing, no music' },
  amb_night: { d: 12, loop: true, p: 'night forest ambience, crickets chirping, a soft owl hoot far away, gentle, no music' },
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
    body: JSON.stringify({ text: s.p, duration_seconds: s.d, prompt_influence: 0.6, ...(s.loop ? { loop: true, model_id: 'eleven_text_to_sound_v2' } : {}) }),
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
