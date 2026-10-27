import * as i18n from '@solid-primitives/i18n';
import { createSignal } from 'solid-js';
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
export type Dictionary = i18n.Flatten<RawDictionary>;

const flatEn = i18n.flatten(en);
const dictionaries: Record<Locale, Dictionary> = {
  en: flatEn,
  'pt-BR': { ...flatEn, ...i18n.flatten(ptBR) } as Dictionary,
};

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

const [locale, setLocaleSignal] = createSignal<Locale>(
  readStored(STORAGE_KEY) ?? detectBrowserLocale(),
);
export { locale };

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
  setLocaleSignal(next);
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

/**
 * Translate a key. `{{ name }}` placeholders are filled from the second
 * argument; function entries (plurals) receive the extra arguments. Reading
 * it inside JSX or a memo keeps the text reactive to the language.
 */
export const t = i18n.translator(dict, i18n.resolveTemplate);

/**
 * Untyped lookup for keys built at runtime (e.g. `format.status.${code}`).
 * Returns undefined when the key does not exist, so callers can fall back.
 */
export function tMaybe(key: string, args?: Record<string, string | number>): string | undefined {
  const value = (dict() as Record<string, unknown>)[key];
  if (typeof value !== 'string') return undefined;
  return i18n.resolveTemplate(value, args ?? {});
}

/** BCP 47 tag for `Intl` APIs. English keeps `en-US` formatting. */
export function intlLocale(): string {
  return locale() === 'pt-BR' ? 'pt-BR' : 'en-US';
}
