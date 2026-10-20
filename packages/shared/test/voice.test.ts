import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/config';
import { de, t } from '../src/i18n/index';
import { allVoiceSegments, voiceSegments } from '../src/i18n/voice';

const MANIFEST = new URL('../../../apps/web/public/media/audio/voice/manifest.json', import.meta.url);
const names = CHARACTERS.map((c) => de[`char.${c}`]);
const charOf = (n: string) => (n === 'Marvin' ? 'Foxy' : n === 'Lea' ? 'Pingo' : null);

/** Typical params per placeholder (as emitted by engine/session). */
const SAMPLE: Record<string, string | number> = {
  player: 'Marvin',
  leader: 'Lea',
  players: `Marvin ${t('voice.and')} Lea`,
  round: 7,
  total: 12,
  coins: 5,
  price: 20,
  stars: 3,
  count: 10,
  item: 'item.shield.name',
  map: 'map.vulkan.name',
  format: 'format.2v2',
  game: 'mg.gipfelsturm.name',
  category: 'bonus.coinMagnet.name',
  station: 'station.north',
};

describe('moderator voice segments (AUDIO-03)', () => {
  it('splits a line into literal parts and placeholder values, speaking character names', () => {
    expect(voiceSegments('mod.dice', { player: 'Marvin', total: 12 }, charOf)).toEqual(['Foxy', 'würfelt eine', '12']);
    expect(voiceSegments('mod.bonusStar', { category: 'bonus.coinMagnet.name', players: SAMPLE.players }, charOf)).toEqual([
      'Bonus-Stern',
      'Münzen-Magnet',
      'geht an',
      'Foxy',
      'und',
      'Pingo',
    ]);
    expect(voiceSegments('mod.bonusStar', { category: 'bonus.coinMagnet.name', players: 'bonus.nobody' }, charOf)?.at(-1)).toBe('Niemand – leer ausgegangen!');
  });

  it('falls back (null) for unknown players or numbers outside the recorded range', () => {
    expect(voiceSegments('mod.turn', { player: 'Unbekannt' }, charOf)).toBeNull();
    expect(voiceSegments('mod.steal', { coins: 999 }, charOf)).toBeNull();
  });

  it('every requested segment is part of the generator set', () => {
    const all = new Set(allVoiceSegments(de, names));
    for (const key of Object.keys(de).filter((k) => k.startsWith('mod.'))) {
      const segs = voiceSegments(key, SAMPLE, charOf);
      expect(segs, key).not.toBeNull();
      for (const s of segs!) expect(all.has(s), `${key}: "${s}"`).toBe(true);
    }
  });

  it.runIf(existsSync(MANIFEST))('every generator segment is recorded', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>;
    const missing = allVoiceSegments(de, names).filter((s) => !manifest[s]);
    expect(missing).toEqual([]);
  });
});
