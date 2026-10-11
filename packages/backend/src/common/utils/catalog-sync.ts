/**
 * ADR 0003: the public model and price catalogs (openrouter.ai, models.dev and
 * the OpenCode Go doc on raw.githubusercontent.com) are the only outbound
 * destinations Thinker may reach on its own. `THINKER_CATALOG_SYNC=false`
 * turns all three off; the bundled data is then the only source.
 *
 * Read at call time, not cached, so the value an operator sets is the value
 * every boot hook, cron and refresh endpoint sees.
 */
export const CATALOG_SYNC_ENV = 'THINKER_CATALOG_SYNC';

const DISABLED_VALUES = new Set(['false', '0', 'no', 'off']);

export function isCatalogSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[CATALOG_SYNC_ENV];
  if (raw === undefined) return true;
  return !DISABLED_VALUES.has(raw.trim().toLowerCase());
}
