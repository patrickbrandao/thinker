import './load-env-file';
import { DataSource } from 'typeorm';
import { entities, INVALID_WHERE_VALUES_BEHAVIOR, migrations } from './data-source-definitions';
import { pinSessionTimeZoneToUtc } from '../common/utils/utc-clock';

function createDataSource(): DataSource {
  // Prefer a direct (non-pooled) connection for migrations: the advisory lock in
  // migrate.ts is session-scoped and won't hold over PgBouncer, so overlapping
  // deploys could still deadlock if migrations ran through the pool. Fall back to
  // DATABASE_URL only for local/self-hosted, where it's already a direct
  // connection (no PgBouncer in front).
  // `||` (not `??`) so an empty or blank override does not win over DATABASE_URL.
  const databaseUrl =
    process.env['MIGRATION_DATABASE_URL']?.trim() ||
    process.env['DATABASE_UNPOOLED_URL']?.trim() ||
    process.env['DATABASE_URL']?.trim();
  // No default URL: migrations must never silently target whatever happens to
  // listen on localhost:5432 (issue #67).
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL (or MIGRATION_DATABASE_URL) is required. Set it in your .env file.',
    );
  }

  return new DataSource({
    type: 'postgres',
    url: databaseUrl,
    // Explicit arrays (not globs): the pre-deploy `node dist/database/migrate.js`
    // must run exactly the committed migration set. A dist glob would also pick up
    // stale compiled .js from deleted migrations (deleteOutDir is off), so this
    // stays in lockstep with the boot path in database.module.
    entities,
    migrations,
    invalidWhereValuesBehavior: INVALID_WHERE_VALUES_BEHAVIOR,
    extra: { onConnect: pinSessionTimeZoneToUtc },
  });
}

export default createDataSource();
