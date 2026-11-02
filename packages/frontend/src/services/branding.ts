import { signal } from '../lib/signal.js';
import { THINKER_MARK_512_URL } from './thinker-links.js';

/**
 * Instance branding from THINKER_TITLE, THINKER_LOGO_URL and THINKER_HIDE_INFO
 * (GET /api/v1/branding). Until it loads, or if it fails, the defaults apply,
 * except hideInfo, which starts true so the version never flashes in.
 */
export interface Branding {
  title: string;
  logoUrl: string;
  hideInfo: boolean;
}

export const brandingSignal = signal<Branding>({
  title: 'Thinker',
  logoUrl: THINKER_MARK_512_URL,
  hideInfo: true,
});

let loading: Promise<void> | null = null;

export function loadBranding(): Promise<void> {
  loading ??= fetch('/api/v1/branding', { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { title?: string; logoUrl?: string | null; hideInfo?: boolean } | null) => {
      brandingSignal.set({
        title: data?.title || 'Thinker',
        logoUrl: data?.logoUrl || THINKER_MARK_512_URL,
        hideInfo: data?.hideInfo === true,
      });
    })
    .catch(() => {
      brandingSignal.set({ ...brandingSignal(), hideInfo: false });
    });
  return loading;
}
