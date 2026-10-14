import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * A direct (non-pooled) PostgreSQL URL for the post-deploy backfills, or null.
 * Same precedence as the standalone request backfill worker, and blank values
 * do not count.
 */
export function resolveDirectBackfillDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  return (
    env['MIGRATION_DATABASE_URL']?.trim() ||
    env['DATABASE_UNPOOLED_URL']?.trim() ||
    env['BACKFILL_DATABASE_URL']?.trim() ||
    null
  );
}

export type DirectDataSourceFactory = (url: string) => DataSource;

/**
 * Two connections: one holds the session-level advisory lock, one runs the
 * backfill SQL. The backfills are raw SQL, so no entity metadata is needed.
 */
const defaultFactory: DirectDataSourceFactory = (url) =>
  new DataSource({ type: 'postgres', url, extra: { max: 2 } });

/**
 * The connection the boot backfills take their advisory lock and run their SQL
 * on (#74). When the operator set a direct URL (`MIGRATION_DATABASE_URL`,
 * `DATABASE_UNPOOLED_URL` or `BACKFILL_DATABASE_URL`), the app's DATABASE_URL
 * may go through PgBouncer in transaction mode, where a session advisory lock
 * does not hold and long backfill statements tie up the pool. A dedicated
 * DataSource on the direct URL is opened lazily on first use. Without one, the
 * app's own DataSource is used, as before.
 *
 * The URL is never logged.
 */
export class BootBackfillConnection {
  private readonly logger = new Logger(BootBackfillConnection.name);
  private direct: DataSource | undefined;
  private opening: Promise<DataSource> | undefined;
  private closed = false;

  constructor(
    private readonly appDataSource: DataSource,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly factory: DirectDataSourceFactory = defaultFactory,
  ) {}

  /** True when a direct URL is configured. */
  get usesDirectUrl(): boolean {
    return resolveDirectBackfillDatabaseUrl(this.env) !== null;
  }

  async get(): Promise<DataSource> {
    const url = resolveDirectBackfillDatabaseUrl(this.env);
    if (!url) return this.appDataSource;
    // After shutdown began, never open a fresh pool that nothing would close.
    if (this.closed) throw new Error('Boot backfill connection is closed');
    if (this.direct?.isInitialized) return this.direct;
    const opening = (this.opening ??= this.open(url));
    try {
      return await opening;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    // A close() racing an open() still in flight must not leak the pool that
    // open() is about to hand back: wait for it, then destroy it.
    const opening = this.opening;
    this.opening = undefined;
    if (opening) await opening.catch(() => undefined);
    const direct = this.direct;
    this.direct = undefined;
    if (direct?.isInitialized) await direct.destroy().catch(() => undefined);
  }

  private async open(url: string): Promise<DataSource> {
    const dataSource = this.factory(url);
    await dataSource.initialize();
    this.direct = dataSource;
    this.logger.log('post-deploy backfills use the direct database URL');
    return dataSource;
  }
}
