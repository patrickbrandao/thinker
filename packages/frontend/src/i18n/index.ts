import { signal, useSignal } from '../lib/signal.js';
import en from './locales/en/index.js';
import ptBR from './locales/pt-BR/index.js';

/**
 * Dashboard i18n (#42). English is the reference catalog and the fallback for
 * any key a translation lacks. Catalogs are bundled: nothing is fetched at
 * runtime.
 */
export type Locale = 'en' | 'pt-BR';
export const LOCALES: readonly Locale[] = ['en', 'pt-BR'];
/** Each language's own name, shown in the language selector. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

export type RawDictionary = typeof en;

type Leaf = string | ((...args: never[]) => string);

/** Dot-joined key paths of a nested catalog that end at a string or function. */
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** The catalog value at a dot-joined path. */
type At<T, K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? At<T[Head], Rest>
    : never
  : K extends keyof T
    ? T[K]
    : never;

export type TranslationKey = Paths<RawDictionary>;
export type Dictionary = Record<string, unknown>;

function flatten(
  obj: object,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}${key}`;
    if (typeof value === 'string' || typeof value === 'function') out[path] = value;
    else if (value && typeof value === 'object') flatten(value, `${path}.`, out);
  }
  return out;
}

const flatEn = flatten(en);
const dictionaries: Record<Locale, Record<string, unknown>> = {
  en: flatEn,
  'pt-BR': { ...flatEn, ...flatten(ptBR) },
};

/** Fills `{{ name }}` placeholders from `args`. */
function resolveTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/{{\s*([^{}\s]+)\s*}}/g, (match, name: string) =>
    name in args ? String(args[name]) : match,
  );
}

const STORAGE_KEY = 'thinker.locale';
const userKey = (userId: string) => `${STORAGE_KEY}.${userId}`;

function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'pt-BR';
}

function readStored(key: string): Locale | null {
  try {
    const v = localStorage.getItem(key);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: Locale): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** Browser preference (Accept-Language order): any Portuguese → pt-BR, else English. */
export function detectBrowserLocale(): Locale {
  const langs =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  for (const lang of langs) {
    const l = (lang ?? '').toLowerCase();
    if (l.startsWith('pt')) return 'pt-BR';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

/** The active language. Read it with `useLocale()` in components. */
export const locale = signal<Locale>(readStored(STORAGE_KEY) ?? detectBrowserLocale());

/** Re-renders the component when the language changes and returns it. */
export function useLocale(): Locale {
  return useSignal(locale);
}

let currentUserId: string | null = null;

function applyDocumentLang(l: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}
applyDocumentLang(locale());

/**
 * Switch the dashboard language. The choice is saved for the signed-in user
 * (and as this browser's default for the sign-in screens). There is no backend
 * preference API yet, so "per user" means per user on this browser.
 */
export function setLocale(next: Locale, opts: { persist?: boolean } = {}): void {
  locale.set(next);
  applyDocumentLang(next);
  if (opts.persist === false) return;
  writeStored(STORAGE_KEY, next);
  if (currentUserId) writeStored(userKey(currentUserId), next);
}

/** Called once the signed-in user is known: restores that user's saved language. */
export function applyUserLocale(userId: string | null | undefined): void {
  currentUserId = userId || null;
  if (!currentUserId) return;
  const saved = readStored(userKey(currentUserId));
  if (saved) {
    if (saved !== locale()) setLocale(saved);
  } else {
    writeStored(userKey(currentUserId), locale());
  }
}

/** Test helper: forget the signed-in user and go back to a locale without persisting. */
export function resetLocaleForTests(next: Locale = 'en'): void {
  currentUserId = null;
  setLocale(next, { persist: false });
}

const dict = () => dictionaries[locale()];

type TArgs<K extends TranslationKey> =
  At<RawDictionary, K> extends (...args: infer A) => string
    ? A
    : [args?: Record<string, string | number>];

/**
 * Translate a key. `{{ name }}` placeholders are filled from the second
 * argument; function entries (plurals) receive the extra arguments. The app
 * root remounts when the language changes, so plain calls stay current.
 */
export function t<K extends TranslationKey>(key: K, ...args: TArgs<K>): string {
  const value = dict()[key];
  if (typeof value === 'function') return (value as (...a: unknown[]) => string)(...args);
  if (typeof value !== 'string') return key;
  const first = args[0];
  return first && typeof first === 'object'
    ? resolveTemplate(value, first as Record<string, unknown>)
    : value;
}

/**
 * Untyped lookup for keys built at runtime (e.g. `format.status.${code}`).
 * Returns undefined when the key does not exist, so callers can fall back.
 */
export function tMaybe(key: string, args?: Record<string, string | number>): string | undefined {
  const value = dict()[key];
  if (typeof value !== 'string') return undefined;
  return resolveTemplate(value, args ?? {});
}

/** BCP 47 tag for `Intl` APIs. English keeps `en-US` formatting. */
export function intlLocale(): string {
  return locale() === 'pt-BR' ? 'pt-BR' : 'en-US';
}
