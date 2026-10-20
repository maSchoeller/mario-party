import { CHARACTERS, type CharacterId } from '../config';
import type { Params } from './index';

/**
 * Moderator voice (AUDIO-03, v0.3). Deliberately sparse: the moderator only speaks at
 * the big moments, always as one whole, naturally recorded line – never stitched
 * together from snippets and never with player nicknames. Everything else is shown as
 * subtitle only.
 *
 * Clip ids → spoken text (eleven_v3 audio tags in brackets steer the delivery). The
 * same table drives the generator (scripts/assets/voice.ts) and the host.
 */
export const VOICE_LINES: Record<string, string> = {
  'mod.welcome': '[excited] Ahoi, Bande! Ich bin Käpt’n Plapperschnabel. Scannt den Code und rein ins Vergnügen!',
  'intro.kokosnuss': '[excited] Willkommen an der Kokosnuss-Küste! Achtet auf Ebbe und Flut!',
  'intro.vulkan': '[excited] Willkommen am Vulkan-Gipfel! Hier wird’s richtig heiß!',
  'intro.bimmelbahn': '[excited] Willkommen in Bimmelbahn-Stadt! Einsteigen, bitte!',
  'mod.orderRoll': 'Würfelt die Reihenfolge aus!',
  'mod.tideHigh': '[shouting] Flut! Der Fluss ist voll!',
  'mod.tideLow': 'Ebbe! Die Wege sind wieder frei!',
  'mod.cannon': '[excited] Kokos-Kanone!',
  'mod.eruption': '[shouting] Ausbruch!',
  'mod.trainComing': '[excited] Tuut tuut! Die Bimmelbahn kommt!',
  'mod.starBought': '[excited] Ein Stern!',
  'mod.duel': '[excited] Duell!',
  'mod.lucky': 'Ab ans Glücksrad!',
  'mod.minigameTime': '[excited] Minispiel-Zeit!',
  'mod.draw': 'Unentschieden!',
  'mod.catchup': 'Halbzeit! Zeit für eine Aufholjagd!',
  'mod.finale': '[excited] Das Finale beginnt! Ab jetzt zählt alles doppelt!',
  'mod.bonusIntro': 'Die Partie ist vorbei! Jetzt kommen die Bonus-Sterne!',
  'mod.winner': '[dramatic] Und die Bande wird angeführt von …',
  'mod.marathonIntro': '[excited] Minispiel-Marathon!',
};

/** Range of dice totals the moderator calls out (risk die −2 … four dice). */
export const VOICE_NUMBERS = { min: -2, max: 26 };

const WORDS = ['Null', 'Eins', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun', 'Zehn', 'Elf', 'Zwölf', 'Dreizehn', 'Vierzehn', 'Fünfzehn', 'Sechzehn', 'Siebzehn', 'Achtzehn', 'Neunzehn', 'Zwanzig'];

/** German number word as it should be spoken ("Siebenundzwanzig", "Minus zwei"). */
export function numberWord(n: number): string {
  if (n < 0) return `Minus ${numberWord(-n).toLowerCase()}`;
  if (n <= 20) return WORDS[n];
  const ones = n % 10;
  const tens = ['', '', 'zwanzig', 'dreißig'][Math.floor(n / 10)];
  return ones ? `${ones === 1 ? 'Ein' : WORDS[ones]}und${tens}` : tens[0].toUpperCase() + tens.slice(1);
}

/** Every clip the generator records: lines, numbers and the 8 character names. */
export function allVoiceClips(charName: (c: CharacterId) => string): Record<string, string> {
  const out: Record<string, string> = { ...VOICE_LINES };
  for (let n = VOICE_NUMBERS.min; n <= VOICE_NUMBERS.max; n++) out[`num.${n}`] = `[excited] ${numberWord(n)}!`;
  for (const c of CHARACTERS) out[`char.${c}`] = `[excited] ${charName(c)}!`;
  return out;
}

/**
 * Clips to play for a moderator line, or [] (subtitle only). `character` resolves the
 * player param to a character id (winner announcement).
 */
export function voiceClips(key: string, params: Params | undefined, character: (player: string) => CharacterId | null): string[] {
  if (key === 'mod.intro') {
    const id = /^map\.(\w+)\.name$/.exec(String(params?.map ?? ''))?.[1];
    return id && VOICE_LINES[`intro.${id}`] ? [`intro.${id}`] : [];
  }
  if (key === 'mod.winner') {
    const c = params?.player !== undefined ? character(String(params.player)) : null;
    return c ? ['mod.winner', `char.${c}`] : ['mod.winner'];
  }
  return VOICE_LINES[key] ? [key] : [];
}

export function numberClip(n: number): string | null {
  return Number.isInteger(n) && n >= VOICE_NUMBERS.min && n <= VOICE_NUMBERS.max ? `num.${n}` : null;
}

/** File name of a clip (public/media/audio/voice/<file>.mp3). */
export function clipFile(id: string): string {
  return id.replace(/\./g, '_');
}

/** The manifest stores per clip id the hash of the recorded text (re-record on change). */
export function voiceHash(text: string): string {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return h.toString(16);
}
