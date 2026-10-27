/**
 * Thinker's clock convention (#58): every timestamp is UTC.
 *
 * The timestamp columns are `timestamp without time zone` and receive values
 * from three places: the Node process (the pg driver serialises a JS Date in
 * the process's local time zone), Postgres (`NOW()` / `CURRENT_TIMESTAMP` in
 * defaults and comparisons, evaluated in the session's TimeZone), and
 * `toSqlTimestamp` (UTC). They only agree when the process and the session
 * both run in UTC, so Thinker pins both instead of trusting the environment:
 *
 *   - the process: `pinProcessTimeZoneToUtc()` runs before anything else in
 *     every entry point (server, migration and backfill CLIs, e2e app);
 *   - each Postgres session: `pinSessionTimeZoneToUtc` is the pg pool's
 *     `onConnect` hook for the TypeORM pools and Better Auth's pool.
 *
 * An operator's `TZ` is therefore ignored, with a startup warning.
 */

export const THINKER_TIME_ZONE = 'UTC';

/**
 * Forces the process time zone to UTC. Node re-reads `process.env.TZ` on
 * assignment, so this takes effect for every Date created afterwards.
 *
 * @returns the time zone the environment asked for when it was not UTC (to
 *   warn about it), otherwise null.
 */
export function pinProcessTimeZoneToUtc(env: NodeJS.ProcessEnv = process.env): string | null {
  const requested = env['TZ']?.trim();
  env['TZ'] = THINKER_TIME_ZONE;
  if (!requested || isUtcName(requested)) return null;
  return requested;
}

/** Pins one Postgres session to UTC (pg pool `onConnect` hook). */
export async function pinSessionTimeZoneToUtc(client: {
  query: (sql: string) => Promise<unknown>;
}): Promise<void> {
  await client.query(`SET TIME ZONE '${THINKER_TIME_ZONE}'`);
}

/** Startup warning for an operator `TZ` that was overridden, or null. */
export function overriddenTimeZoneWarning(requested: string | null): string | null {
  if (!requested) return null;
  return `TZ=${requested} is ignored: Thinker stores and compares every timestamp in UTC.`;
}

function isUtcName(tz: string): boolean {
  return /^(:?(Etc\/)?(UTC|UCT|Universal|Zulu|GMT|GMT0|GMT[+-]0|Greenwich)|UTC0|Z)$/i.test(tz);
}
