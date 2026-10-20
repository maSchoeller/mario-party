// Music + jingles via sunoapi.org (AUDIO-01). Prompt guide = TRACKS below (spec 17, item 5).
//
//   node scripts/assets/music.mjs              # generates every missing track
//   node scripts/assets/music.mjs island lobby # only these
//
// Raw downloads go to assets-src/music/<key>.mp3 (not committed); transcode them with
// `node scripts/assets/build-audio.mjs`. Generation metadata (task/audio id, model, prompt,
// date) is appended to assets-src/music/log.json for the license register (AUDIO-07).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { secret } from './secrets.mjs';

const API = 'https://api.sunoapi.org/api/v1';
const MODEL = 'V6';
const OUT = new URL('../../assets-src/music/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

const COMMON = 'instrumental, family-friendly party board game soundtrack, catchy, playful, clean mix, no vocals, seamless loop feel';
export const TRACKS = {
  lobby: { duration: 90, title: 'Würfel-Bande Lobby', style: `bouncy menu theme, ukulele, marimba, whistling melody, light hand percussion, pizzicato strings, major key, 104 bpm, ${COMMON}` },
  island: { duration: 120, title: 'Kokosnuss-Küste', style: `sunny tropical calypso, steel drums, ukulele, marimba, shakers, bass guitar, beach vibe, major key, 112 bpm, ${COMMON}` },
  island_finale: { duration: 90, title: 'Kokosnuss-Küste Finale', style: `exciting final-rounds version of a tropical calypso theme, steel drums, driving congas, brass stabs, rising tension, faster, 132 bpm, ${COMMON}` },
  volcano: { duration: 120, title: 'Vulkan-Gipfel', style: `adventurous jungle volcano theme, tribal tom drums, marimba, tuba bass, brass stabs, mysterious but fun, minor key, 120 bpm, ${COMMON}` },
  volcano_finale: { duration: 90, title: 'Vulkan-Gipfel Finale', style: `intense final-rounds volcano theme, pounding taiko drums, brass, rumbling bass, urgent and exciting, minor key, 140 bpm, ${COMMON}` },
  city: { duration: 120, title: 'Bimmelbahn-Stadt', style: `cheerful swing big band, toy train town, clarinet, muted trumpet, walking upright bass, brushed drums, glockenspiel, train whistle accents, 126 bpm, ${COMMON}` },
  city_finale: { duration: 90, title: 'Bimmelbahn-Stadt Finale', style: `fast exciting final-rounds swing, hot big band brass, galloping drums, energetic, 150 bpm, ${COMMON}` },
  minigame: { duration: 60, title: 'Minispiel Turbo', style: `energetic chiptune pop, square lead, punchy drums, competitive, upbeat, 140 bpm, ${COMMON}` },
  minigame2: { duration: 60, title: 'Minispiel Spannung', style: `funky surf rock, twangy guitar, tense groove, organ, minor key, 132 bpm, ${COMMON}` },
  minigame3: { duration: 60, title: 'Minispiel Zirkus', style: `zany circus polka, accordion, tuba, slide whistle, comedic chase, 150 bpm, ${COMMON}` },
  victory: { duration: 45, title: 'Siegerehrung', style: `triumphant celebration fanfare, orchestral brass, timpani, glockenspiel, warm and joyful, major key, 96 bpm, ${COMMON}` },
  jingle_star: { duration: 10, title: 'Stern Jingle', style: 'very short triumphant magical sparkle fanfare jingle, harp glissando, bells, brass hit, video game star collected, instrumental, 3 seconds then silence' },
  jingle_item: { duration: 10, title: 'Item Jingle', style: 'very short cheerful item-get jingle, xylophone arpeggio, pizzicato, video game, instrumental, 2 seconds then silence' },
  jingle_eruption: { duration: 10, title: 'Ausbruch Jingle', style: 'very short dramatic comedic danger sting, timpani roll, low brass, cymbal crash, cartoon volcano eruption, instrumental, 4 seconds then silence' },
  jingle_train: { duration: 10, title: 'Zug Jingle', style: 'very short happy toy train arrival jingle, train whistle, bells, swing brass, instrumental, 4 seconds then silence' },
};

const headers = { Authorization: `Bearer ${secret('SUNO_API_KEY')}`, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(key) {
  const t = TRACKS[key];
  const body = { customMode: true, instrumental: true, model: MODEL, style: t.style, title: t.title, duration: t.duration, callBackUrl: 'https://example.invalid/suno-callback' };
  const r = await fetch(`${API}/generate`, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.code !== 200) throw new Error(`${key}: ${r.status} ${JSON.stringify(j)}`);
  const taskId = j.data.taskId;
  console.log(`${key}: task ${taskId}`);
  for (let i = 0; i < 120; i++) {
    await sleep(10_000);
    const s = await (await fetch(`${API}/generate/record-info?taskId=${taskId}`, { headers })).json();
    const d = s.data ?? {};
    if (/FAILED|ERROR/.test(d.status ?? '')) throw new Error(`${key}: ${d.status} ${d.errorMessage}`);
    if (d.status === 'SUCCESS') {
      const tracks = d.response?.sunoData ?? [];
      const saved = [];
      for (const [k, tr] of tracks.entries()) {
        const url = tr.audioUrl ?? tr.audio_url ?? tr.sourceAudioUrl ?? tr.source_audio_url;
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const file = join(OUT, k === 0 ? `${key}.mp3` : `${key}.alt${k}.mp3`);
        writeFileSync(file, buf);
        saved.push({ id: tr.id, duration: tr.duration, model: tr.modelName ?? tr.model_name, file });
      }
      log({ key, taskId, model: MODEL, style: t.style, title: t.title, date: new Date().toISOString(), tracks: saved });
      console.log(`${key}: ✓ ${saved.map((x) => `${x.duration?.toFixed?.(0)}s`).join(', ')}`);
      return;
    }
  }
  throw new Error(`${key}: timeout`);
}

function log(entry) {
  const f = join(OUT, 'log.json');
  const all = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  all.push(entry);
  writeFileSync(f, JSON.stringify(all, null, 2));
}

mkdirSync(OUT, { recursive: true });
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TRACKS);
const todo = wanted.filter((k) => process.argv.length > 2 || !existsSync(join(OUT, `${k}.mp3`)));
// a few in parallel (sunoapi.org allows concurrent tasks; 430 = too frequent)
const queue = [...todo];
await Promise.all(
  [0, 1, 2].map(async (lane) => {
    await sleep(lane * 3000);
    while (queue.length) {
      const k = queue.shift();
      try {
        await generate(k);
      } catch (e) {
        console.error(String(e));
      }
    }
  }),
);
