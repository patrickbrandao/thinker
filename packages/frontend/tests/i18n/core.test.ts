import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUserLocale,
  detectBrowserLocale,
  locale,
  resetLocaleForTests,
  setLocale,
  t,
  tMaybe,
} from '../../src/i18n';
import { formatCost, formatNumber, formatStatus } from '../../src/services/formatters';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('i18n core', () => {
  it('detects pt-BR from any Portuguese browser language, English otherwise', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['pt-PT', 'en']);
    expect(detectBrowserLocale()).toBe('pt-BR');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'de']);
    expect(detectBrowserLocale()).toBe('en');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB', 'pt-BR']);
    expect(detectBrowserLocale()).toBe('en');
  });

  it('translates, fills placeholders and updates <html lang>', () => {
    expect(t('common.save')).toBe('Save');
    setLocale('pt-BR', { persist: false });
    expect(t('common.save')).toBe('Salvar');
    expect(t('format.minutesAgo', { n: 5 })).toBe('há 5 min');
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('returns undefined from tMaybe for unknown runtime keys', () => {
    expect(tMaybe('format.status.ok')).toBe('Success');
    expect(tMaybe('format.status.nope')).toBeUndefined();
  });

  it('saves the choice per user and restores it after a new sign-in', () => {
    applyUserLocale('user-a');
    setLocale('pt-BR');
    expect(localStorage.getItem('thinker.locale.user-a')).toBe('pt-BR');

    resetLocaleForTests('en');
    applyUserLocale('user-b'); // no saved choice: keeps the current language
    expect(locale()).toBe('en');
    expect(localStorage.getItem('thinker.locale.user-b')).toBe('en');

    applyUserLocale('user-a');
    expect(locale()).toBe('pt-BR');
  });

  it('formats numbers, currency and statuses with the active locale', () => {
    expect(formatCost(1234.5)).toBe('$1,234.50');
    expect(formatNumber(1500)).toBe('1.5k');
    resetLocaleForTests('pt-BR');
    expect(formatCost(1234.5)?.replace(/\s/g, ' ')).toBe('US$ 1.234,50');
    expect(formatNumber(1500).replace(/\s/g, ' ')).toBe('1,5 mil');
    expect(formatStatus('ok')).toBe('Sucesso');
  });
});
