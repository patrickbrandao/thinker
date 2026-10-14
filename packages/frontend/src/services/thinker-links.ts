/**
 * Thinker's own outbound links and brand asset URLs, kept in one place.
 *
 * Every external URL here is a plain link the user clicks; the dashboard never
 * fetches any of them.
 */

export const THINKER_REPO_URL = 'https://github.com/patrickbrandao/thinker';

/** User documentation lives in the repository under `docs/`. */
export const THINKER_DOCS_URL = `${THINKER_REPO_URL}/tree/main/docs`;

/** Provider guides (subscriptions, API keys, local models). */
export const THINKER_PROVIDERS_DOCS_URL = `${THINKER_DOCS_URL}/providers`;

/** Where to report bugs and ask questions. */
export const THINKER_ISSUES_URL = `${THINKER_REPO_URL}/issues`;

/**
 * Brand assets from `public/brand/` (see docs/marca.md). They are served with
 * a one-year immutable cache and no hash in the name, so the `v` query is the
 * cache key: bump BRAND_ASSET_VERSION whenever a drawing changes.
 */
const BRAND_ASSET_VERSION = '1';
const brandAsset = (name: string) => `/brand/${name}?v=${BRAND_ASSET_VERSION}`;

/** Symbol + "Thinker" wordmark, for light backgrounds. */
export const THINKER_LOGO_URL = brandAsset('thinker-logo.svg');
/** Symbol + "Thinker" wordmark, for dark backgrounds. */
export const THINKER_LOGO_DARK_URL = brandAsset('thinker-logo-dark.svg');
/** Symbol only, for light backgrounds. */
export const THINKER_MARK_URL = brandAsset('thinker-mark.svg');
