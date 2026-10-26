/**
 * Safety guard for the backend e2e suite (issue #67).
 *
 * The e2e helpers and the migration specs open TypeORM connections with
 * `dropSchema: true`, which wipes the target database. They must never run
 * against a database that is not an explicit, disposable test database, so
 * before anything connects we require all of:
 *
 *   - `DATABASE_URL` is set (there is no fallback to a default URL);
 *   - its database name contains "test" as a whole token (e.g.
 *     `thinker_e2e_test`, `test_db`; not `latest` or `contest`);
 *   - `THINKER_E2E_ALLOW_DROP=1` is set.
 *
 * `checkE2eDatabaseEnv` is a pure function over the environment so it can be
 * unit-tested; `resolveE2eDatabaseUrl` throws with instructions when the check
 * fails and is what the e2e code calls.
 */

export const E2E_ALLOW_DROP_ENV = 'THINKER_E2E_ALLOW_DROP';

// "test" must be a whole token (optionally "tests"/"testing") delimited by
// the start/end of the name or a non-alphanumeric character, so names such as
// "latest", "contest" or "attestation" do not pass.
const TEST_DATABASE_NAME = /(^|[^a-z0-9])test(s|ing)?([^a-z0-9]|$)/i;
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

export type E2eDatabaseCheck =
  { ok: true; url: string; database: string } | { ok: false; reason: string };

type Env = Readonly<Record<string, string | undefined>>;

export function checkE2eDatabaseEnv(env: Env): E2eDatabaseCheck {
  const url = env['DATABASE_URL']?.trim();
  if (!url) {
    return {
      ok: false,
      reason: 'DATABASE_URL is not set. The e2e suite has no default database.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'DATABASE_URL is not a valid URL.' };
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `DATABASE_URL must be a postgres:// or postgresql:// URL (got "${parsed.protocol}").`,
    };
  }

  // A `?database=`/`?dbname=` query parameter could make some clients connect
  // to a different database than the path names, so refuse it outright.
  for (const key of parsed.searchParams.keys()) {
    if (/^(database|dbname|db)$/i.test(key)) {
      return {
        ok: false,
        reason: `DATABASE_URL must name the database only in its path (found "?${key}=").`,
      };
    }
  }

  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    return { ok: false, reason: 'DATABASE_URL has an invalid database name.' };
  }
  if (!database) {
    return { ok: false, reason: 'DATABASE_URL does not name a database.' };
  }
  if (!TEST_DATABASE_NAME.test(database)) {
    return {
      ok: false,
      reason: `Database "${database}" does not look like a test database (its name must contain "test" as a separate word, e.g. "thinker_e2e_test" or "test_db").`,
    };
  }

  if (env[E2E_ALLOW_DROP_ENV] !== '1') {
    return {
      ok: false,
      reason: `${E2E_ALLOW_DROP_ENV}=1 is not set. The e2e suite drops the whole schema of "${database}" and needs explicit consent.`,
    };
  }

  return { ok: true, url, database };
}

export function e2eGuardMessage(reason: string): string {
  return [
    `Refusing to run the backend e2e suite: ${reason}`,
    '',
    'The e2e tests DROP the schema of the database they connect to.',
    'Run them against a disposable PostgreSQL instead:',
    '',
    '  npm run test:e2e:docker --workspace=packages/backend',
    '',
    'That starts a throwaway postgres:18-alpine container on a free port, runs the',
    'migrations and the suite, and removes the container afterwards.',
    '',
    'To use a database you manage yourself, it must be dedicated to tests:',
    '',
    '  DATABASE_URL=postgresql://user:pass@host:port/thinker_e2e_test \\',
    `  ${E2E_ALLOW_DROP_ENV}=1 npm run test:e2e --workspace=packages/backend`,
  ].join('\n');
}

export class E2eDatabaseGuardError extends Error {
  constructor(reason: string) {
    super(e2eGuardMessage(reason));
    this.name = 'E2eDatabaseGuardError';
  }
}

/** Returns the guarded e2e database URL, or throws before anything connects. */
export function resolveE2eDatabaseUrl(env: Env = process.env): string {
  const check = checkE2eDatabaseEnv(env);
  if (!check.ok) throw new E2eDatabaseGuardError(check.reason);
  return check.url;
}
