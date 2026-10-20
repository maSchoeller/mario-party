import { hasKey, t, type Params } from './index';

/**
 * Moderator voice lines (AUDIO-03) are pre-recorded as *segments*: the literal parts of
 * each `mod.*` template plus every value a placeholder can take (character names,
 * numbers, item/map/minigame names …). At runtime a line is spoken by chaining its
 * segments. Player nicknames are free text and cannot be recorded, so the moderator
 * says the player's character name instead (the subtitle still shows the nickname).
 *
 * The same function drives the generator (scripts/assets/voice.ts) and the host, so
 * the recorded set always matches what the host asks for.
 */
export const VOICE_PLAYER_PARAMS = new Set(['player', 'leader', 'players']);
export const VOICE_MAX_NUMBER = 40;

/** Segment texts for a line, or null when a part cannot be voiced (→ fallback). */
export function voiceSegments(key: string, params: Params | undefined, characterName: (player: string) => string | null): string[] | null {
  if (!hasKey(key)) return null;
  const raw = t(key);
  const out: string[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    pushLiteral(out, raw.slice(last, m.index));
    last = m.index + m[0].length;
    const name = m[1];
    const v = params?.[name];
    if (v === undefined) return null;
    if (VOICE_PLAYER_PARAMS.has(name)) {
      const parts = String(v).split(` ${t('voice.and')} `);
      for (const [i, p] of parts.entries()) {
        if (i > 0) out.push(t('voice.and'));
        const c = characterName(p);
        if (c === null) {
          // "bonus.nobody" etc. is a key, not a player
          if (hasKey(p)) out.push(clean(t(p)));
          else return null;
        } else out.push(c);
      }
    } else if (typeof v === 'number') {
      if (!Number.isInteger(v) || v < 0 || v > VOICE_MAX_NUMBER) return null;
      out.push(String(v));
    } else if (hasKey(v)) {
      out.push(clean(t(v)));
    } else {
      return null;
    }
  }
  pushLiteral(out, raw.slice(last));
  return out;
}

function pushLiteral(out: string[], s: string) {
  const c = clean(s);
  if (/\p{L}/u.test(c)) out.push(c);
}

/** Normalized text as used for recording + lookup. */
export function clean(s: string): string {
  return s
    .replace(/[★●▲■◆]/g, '')
    .replace(/^[\s,.;:!?–-]+/, '')
    .replace(/[\s,;:–-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every segment that may be requested (for the generator). */
export function allVoiceSegments(dict: Record<string, string>, characterNames: string[]): string[] {
  const set = new Set<string>();
  const valueKeys = Object.keys(dict).filter((k) => /^(item\.\w+\.name|map\.\w+\.name|format\.\w+|bonus\.\w+\.name|mg\.\w+\.name|station\.\w+)$/.test(k));
  for (const key of Object.keys(dict).filter((k) => k.startsWith('mod.'))) {
    const raw = dict[key];
    for (const lit of raw.split(/\{\w+\}/)) {
      const c = clean(lit);
      if (/\p{L}/u.test(c)) set.add(c);
    }
  }
  for (const k of valueKeys) set.add(clean(dict[k]));
  for (const c of characterNames) set.add(c);
  for (let n = 0; n <= VOICE_MAX_NUMBER; n++) set.add(String(n));
  set.add(clean(dict['voice.and']));
  if (dict['bonus.nobody']) set.add(clean(dict['bonus.nobody']));
  return [...set];
}
