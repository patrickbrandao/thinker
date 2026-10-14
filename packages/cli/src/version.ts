/**
 * Kept in sync with package.json — pinned by the "matches package.json" test in
 * index.spec.ts. Do not hand-edit for a release: `npm run set-version -- <v>`
 * rewrites this file and package.json together, and CI runs it before packing.
 */
export const VERSION = '0.1.0';

/**
 * The one User-Agent every CLI-originated HTTP request carries — management
 * API and gateway alike — so the server's caller attribution sees one client.
 *
 * Decoupled from the package name on purpose, even though both read
 * `thinker-cli` today: this string is user-visible in request details and
 * nothing server-side matches on it, so a future package rename must not
 * silently split one client into two in the caller attribution history.
 */
export const CLI_USER_AGENT = `thinker-cli/${VERSION}`;
