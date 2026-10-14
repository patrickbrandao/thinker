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
const ENABLED_VALUES = new Set(['', 'true', '1', 'yes', 'on']);

/** The accepted values, for log messages. */
export const CATALOG_SYNC_ACCEPTED_VALUES = 'true, 1, yes, on (default) or false, 0, no, off';

function normalized(env: NodeJS.ProcessEnv): string | undefined {
  return env[CATALOG_SYNC_ENV]?.trim().toLowerCase();
}

export function isCatalogSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = normalized(env);
  if (value === undefined) return true;
  return !DISABLED_VALUES.has(value);
}

/**
 * True when the variable is set to something that is neither an on nor an off
 * value (`disabled`, a typo). Sync then stays on, which an operator who meant
 * to turn it off would not notice without a warning.
 */
export function isCatalogSyncValueUnrecognized(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = normalized(env);
  if (value === undefined) return false;
  return !DISABLED_VALUES.has(value) && !ENABLED_VALUES.has(value);
}

/**
 * `THINKER_CATALOG_SYNC=<value>` as configured, for the "sync disabled" log
 * lines. The value is echoed only when it is one of the known off values.
 */
export function describeCatalogSyncSetting(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[CATALOG_SYNC_ENV]?.trim();
  return `${CATALOG_SYNC_ENV}=${raw && DISABLED_VALUES.has(raw.toLowerCase()) ? raw : 'false'}`;
}

/**
 * The boot warning for an unrecognized value, or null. It does not echo the
 * value: an operator may have pasted something that is not meant for logs.
 */
export function catalogSyncBootWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isCatalogSyncValueUnrecognized(env)) return null;
  return (
    `${CATALOG_SYNC_ENV} has an unrecognized value, so catalog sync stays on. ` +
    `Accepted values: ${CATALOG_SYNC_ACCEPTED_VALUES}.`
  );
}
