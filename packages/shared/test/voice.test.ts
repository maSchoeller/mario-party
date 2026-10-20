import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { de, hasKey } from '../src/i18n/index';
import { allVoiceClips, numberClip, numberWord, VOICE_LINES, VOICE_NUMBERS, voiceClips, voiceHash } from '../src/i18n/voice';

const MANIFEST = new URL('../../../apps/web/public/media/audio/voice/manifest.json', import.meta.url);
const charOf = (n: string) => (n === 'Marvin' ? ('foxy' as const) : null);

describe('moderator voice (AUDIO-03, sparse whole lines)', () => {
  it('speaks numbers as German words', () => {
    expect(numberWord(7)).toBe('Sieben');
    expect(numberWord(21)).toBe('Einundzwanzig');
    expect(numberWord(26)).toBe('Sechsundzwanzig');
    expect(numberWord(-2)).toBe('Minus zwei');
    expect(numberClip(12)).toBe('num.12');
    expect(numberClip(99)).toBeNull();
  });

  it('maps lines to whole clips and never stitches nicknames', () => {
    expect(voiceClips('mod.intro', { map: 'map.vulkan.name' }, charOf)).toEqual(['intro.vulkan']);
    expect(voiceClips('mod.winner', { player: 'Marvin' }, charOf)).toEqual(['mod.winner', 'char.foxy']);
    expect(voiceClips('mod.turn', { player: 'Marvin' }, charOf)).toEqual([]);
    expect(voiceClips('mod.blue', { player: 'Marvin' }, charOf)).toEqual([]);
  });

  it('every voiced line belongs to a real moderator text', () => {
    for (const k of Object.keys(VOICE_LINES)) if (k.startsWith('mod.')) expect(hasKey(k), k).toBe(true);
  });

  it('dice totals stay within the recorded range', () => {
    expect(VOICE_NUMBERS.min).toBeLessThanOrEqual(-1);
    expect(VOICE_NUMBERS.max).toBeGreaterThanOrEqual(6 + 8 + 6 + 6);
  });

  it.runIf(existsSync(MANIFEST))('every clip is recorded', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>;
    const clips = allVoiceClips((c) => de[`char.${c}`]);
    const missing = Object.entries(clips).filter(([id, text]) => manifest[id] !== voiceHash(text)).map(([id]) => id);
    expect(missing).toEqual([]);
  });
});
