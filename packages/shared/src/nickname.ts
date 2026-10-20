import { BALANCE } from './config';

/**
 * Simple nickname filter (LOBBY-07). Not meant to be complete – just enough so a later
 * public release does not show the most obvious insults on the TV.
 */
const BLOCKLIST = [
  'arsch', 'fick', 'fotze', 'hure', 'nazi', 'hitler', 'wichser', 'schlampe', 'spast', 'missgeburt',
  'neger', 'schwuchtel', 'penis', 'vagina', 'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'whore', 'sieg heil',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

export function sanitizeNickname(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BALANCE.nicknameMaxLength);
}

export function isNicknameAllowed(name: string): boolean {
  const n = name
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('')
    .replace(/[^a-zäöüß ]/g, '');
  const compact = n.replace(/\s/g, '');
  return name.trim().length > 0 && !BLOCKLIST.some((w) => compact.includes(w.replace(/\s/g, '')));
}
