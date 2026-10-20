import { de } from './de';

export type Dict = Record<string, string>;
export type Params = Record<string, string | number>;

const dictionaries: Record<string, Dict> = { de };
let current: Dict = de;
let currentLocale = 'de';

export function setLocale(locale: string): void {
  if (!dictionaries[locale]) throw new Error(`unknown locale ${locale}`);
  current = dictionaries[locale];
  currentLocale = locale;
}

export function getLocale(): string {
  return currentLocale;
}

export function hasKey(key: string): boolean {
  return key in current;
}

/**
 * Translate a key. Missing keys render as the key itself (and are caught by tests).
 * Param values that are keys themselves are translated recursively (e.g. item names).
 */
export function t(key: string, params?: Params): string {
  const raw = current[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) return `{${name}}`;
    if (typeof v === 'string' && v in current) return current[v];
    return String(v);
  });
}

export { de };
