/** Room codes without ambiguous characters (no 0/O, 1/I/L) – LOBBY-01. */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length: number, random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  return out;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCode(code: string, length: number): boolean {
  return code.length === length && [...code].every((c) => ROOM_ALPHABET.includes(c));
}
