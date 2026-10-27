import { intlLocale, locale } from '../i18n/index.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short month name in the active locale ("Mar" in English, "mar" in pt-BR). */
export function monthShort(d: Date): string {
  if (locale() === 'en') return MONTHS[d.getMonth()]!;
  return d.toLocaleDateString(intlLocale(), { month: 'short' }).replace(/\.$/, '');
}

/** Short day + month label: "Mar 5" in English, "5 mar" in pt-BR. */
export function dayMonth(d: Date): string {
  return locale() === 'en' ? `${monthShort(d)} ${d.getDate()}` : `${d.getDate()} ${monthShort(d)}`;
}

/** A 0..1 rate as a percentage with one decimal, in the active locale ("95.5%"). */
export function formatRate(rate: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rate);
}
