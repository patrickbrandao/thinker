import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { toLocalSqlTimestamp } from '../../common/utils/postgres-sql';
import { BackfillState } from '../../entities/backfill-state.entity';
import {
  runRequestBackfill,
  type RequestBackfillOptions,
  type RequestBackfillResult,
} from './backfill-requests';
import { DEFAULT_BACKFILL_OPTIONS } from './backfill-message-providers';
import { TypeOrmRequestBackfillGateway } from './backfill-requests.gateway';
import { BootBackfillConnection } from './boot-backfill-connection';
import { MESSAGE_PROVIDER_BACKFILL_LOCK_KEY } from './message-provider-backfill.boot.service';

/** Initial historical pass marker; legacy-writer delta is tracked by unlinked rows. */
export const REQUEST_BACKFILL_NAME = 'requests_agent_messages_v1';
/** Post-reader cleanup and deferred constraint-validation marker. */
export const REQUEST_TRANSITION_FINALIZATION_NAME = 'requests_agent_messages_v2';
// Both post-deploy jobs update agent_messages. Sharing the lock guarantees
// that their batches never run concurrently; a contending job releases
// its connection and retries until both completion markers exist.
export const REQUEST_BACKFILL_LOCK_KEY = MESSAGE_PROVIDER_BACKFILL_LOCK_KEY;

type RequestBackfillRunner = (
  dataSource: DataSource,
  logger: Pick<Logger, 'log'>,
  options: Pick<RequestBackfillOptions, 'analyze' | 'before' | 'fallbackBefore' | 'finalize'>,
) => Promise<RequestBackfillResult>;

type RequestTransitionFinalizer = (
  dataSource: DataSource,
  logger: Pick<Logger, 'log'>,
) => Promise<{ rejections: number }>;

const defaultRunner: RequestBackfillRunner = (dataSource, logger, options) =>
  runRequestBackfill(new TypeOrmRequestBackfillGateway(dataSource), { logger, ...options });

export const REQUEST_BACKFILL_LOCK_RETRY_MS = 30_000;
export const REQUEST_BACKFILL_TAIL_INTERVAL_MS = 60_000;
export const REQUEST_BACKFILL_FALLBACK_GRACE_MS = 5 * 60_000;
export const REQUEST_BACKFILL_GENERIC_GRACE_MS = 10 * 60_000;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  });

const defaultTransitionFinalizer: RequestTransitionFinalizer = async (dataSource, logger) => {
  const gateway = new TypeOrmRequestBackfillGateway(dataSource);
  const rejections = await gateway.finalizeTransition(
    DEFAULT_BACKFILL_OPTIONS.batchSize,
    {
      lockTimeoutMs: DEFAULT_BACKFILL_OPTIONS.lockTimeoutMs,
      statementTimeoutMs: DEFAULT_BACKFILL_OPTIONS.statementTimeoutMs,
    },
    (deleted) => logger.log(`request transition: removed ${deleted} staged rejection(s)`),
  );
  return { rejections };
};

/**
 * Runs historical regrouping without blocking application readiness. The
 * advisory lock and the backfill SQL run on a direct connection when one is
 * configured (`MIGRATION_DATABASE_URL`, `DATABASE_UNPOOLED_URL` or
 * `BACKFILL_DATABASE_URL`), and on the application's DATABASE_URL-backed
 * connection otherwise (see `BootBackfillConnection`). The standalone worker
 * in `request-backfill.cli.ts` remains available.
 */
@Injectable()
export class RequestBackfillBootService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RequestBackfillBootService.name);
  private tailTimer: ReturnType<typeof setInterval> | undefined;
  private stopping = false;
  private readonly transitionReadyAt = Date.now() + REQUEST_BACKFILL_GENERIC_GRACE_MS;
  /** Where the lock and the backfill SQL run. Replaceable in tests. */
  connection: BootBackfillConnection;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(BackfillState)
    private readonly stateRepo: Repository<BackfillState>,
  ) {
    this.connection = new BootBackfillConnection(dataSource);
  }

  onApplicationBootstrap(): void {
    if (process.env['NODE_ENV'] !== 'production') return;
    this.stopping = false;
    void this.runManagedBackfill();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.stopTailSweep();
    await this.connection.close();
  }

  private async runManagedBackfill(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.runUntilComplete();
        if (this.stopping) return;
        if (!(await this.startTailSweep())) await this.connection.close();
        return;
      } catch (error) {
        if (this.stopping) return;
        this.logger.error(
          `post-deploy request backfill failed: ${error instanceof Error ? error.message : String(error)}; retrying in ${REQUEST_BACKFILL_LOCK_RETRY_MS / 1000}s`,
        );
        await wait(REQUEST_BACKFILL_LOCK_RETRY_MS);
      }
    }
  }

  private stopTailSweep(): void {
    if (this.tailTimer) clearInterval(this.tailTimer);
    this.tailTimer = undefined;
  }

  async runUntilComplete(): Promise<void> {
    while (!(await this.runOnce())) {
      await wait(REQUEST_BACKFILL_LOCK_RETRY_MS);
    }
  }

  async runOnce(runner: RequestBackfillRunner = defaultRunner): Promise<boolean> {
    if (await this.isCompleted()) return true;
    const db = await this.connection.get();
    const lock = db.createQueryRunner();
    await lock.connect();
    let acquired = false;
    try {
      const rows = (await lock.query('SELECT pg_try_advisory_lock($1) AS locked', [
        REQUEST_BACKFILL_LOCK_KEY,
      ])) as { locked: boolean }[];
      acquired = rows[0]?.locked === true;
      if (!acquired) {
        this.logger.log('another backfill is running; retrying request backfill later');
        return false;
      }
      if (await this.isCompleted()) return true;
      this.logger.log('running post-deploy request/provider-attempt backfill…');
      const result = await runner(db, this.logger, this.runOptions(true));
      await this.stateRepo
        .createQueryBuilder()
        .insert()
        .into(BackfillState)
        .values({ name: REQUEST_BACKFILL_NAME })
        .orIgnore()
        .execute();
      this.logger.log(
        `request backfill complete: ${result.attempts} attempt(s), ${result.rejections} rejection(s), ${result.windows} window(s)`,
      );
      return true;
    } finally {
      if (acquired) {
        await lock
          .query('SELECT pg_advisory_unlock($1)', [REQUEST_BACKFILL_LOCK_KEY])
          .catch(() => undefined);
      }
      await lock.release();
    }
  }

  /**
   * Old replicas write their unchanged column set without request_id.
   * Revisit those rows after a grace period, using a larger delay for generic
   * linking so a fallback terminal always gets another reconstruction pass.
   */
  async runTailOnce(runner: RequestBackfillRunner = defaultRunner): Promise<boolean> {
    const options = this.runOptions(false);
    if (!(await this.hasEligibleAttempts(options.fallbackBefore!))) return true;

    const db = await this.connection.get();
    const lock = db.createQueryRunner();
    await lock.connect();
    let acquired = false;
    try {
      const rows = (await lock.query('SELECT pg_try_advisory_lock($1) AS locked', [
        REQUEST_BACKFILL_LOCK_KEY,
      ])) as { locked: boolean }[];
      acquired = rows[0]?.locked === true;
      if (!acquired) return false;
      if (!(await this.hasEligibleAttempts(options.fallbackBefore!))) return true;

      const result = await runner(db, this.logger, options);
      this.logger.log(
        `request backfill tail sweep: ${result.attempts} attempt(s), ${result.rejections} rejection(s), ${result.windows} window(s)`,
      );
      return true;
    } finally {
      if (acquired) {
        await lock
          .query('SELECT pg_advisory_unlock($1)', [REQUEST_BACKFILL_LOCK_KEY])
          .catch(() => undefined);
      }
      await lock.release();
    }
  }

  async hasUnlinkedAttempts(): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM "agent_messages"
         WHERE "request_id" IS NULL
         LIMIT 1
       ) AS pending`,
    )) as { pending: boolean }[];
    return rows[0]?.pending === true;
  }

  /** Returns whether a sweep was scheduled. */
  private async startTailSweep(): Promise<boolean> {
    if (!(await this.hasAttemptTable())) return false;
    if (await this.isTransitionFinalized()) return false;
    this.tailTimer = setInterval(() => {
      void this.runMaintenanceOnce().catch((error) => {
        this.logger.error(
          `request backfill tail sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, REQUEST_BACKFILL_TAIL_INTERVAL_MS);
    if (typeof this.tailTimer === 'object' && 'unref' in this.tailTimer) this.tailTimer.unref();
    return true;
  }

  private async runMaintenanceOnce(): Promise<void> {
    if (!(await this.runTailOnce())) return;
    if (Date.now() < this.transitionReadyAt) return;
    if (await this.runTransitionFinalizeOnce()) {
      this.stopTailSweep();
      await this.connection.close();
    }
  }

  async runTransitionFinalizeOnce(
    runner: RequestTransitionFinalizer = defaultTransitionFinalizer,
  ): Promise<boolean> {
    if (await this.isTransitionFinalized()) return true;
    if (await this.hasUnlinkedAttempts()) return false;

    const db = await this.connection.get();
    const lock = db.createQueryRunner();
    await lock.connect();
    let acquired = false;
    try {
      const rows = (await lock.query('SELECT pg_try_advisory_lock($1) AS locked', [
        REQUEST_BACKFILL_LOCK_KEY,
      ])) as { locked: boolean }[];
      acquired = rows[0]?.locked === true;
      if (!acquired) return false;
      if (await this.isTransitionFinalized()) return true;
      if (await this.hasUnlinkedAttempts()) return false;

      const result = await runner(db, this.logger);
      await this.stateRepo
        .createQueryBuilder()
        .insert()
        .into(BackfillState)
        .values({ name: REQUEST_TRANSITION_FINALIZATION_NAME })
        .orIgnore()
        .execute();
      this.logger.log(
        `request transition complete: removed ${result.rejections} staged rejection(s) and validated constraints`,
      );
      return true;
    } finally {
      if (acquired) {
        await lock
          .query('SELECT pg_advisory_unlock($1)', [REQUEST_BACKFILL_LOCK_KEY])
          .catch(() => undefined);
      }
      await lock.release();
    }
  }

  private runOptions(
    initial: boolean,
  ): Pick<RequestBackfillOptions, 'analyze' | 'before' | 'fallbackBefore' | 'finalize'> {
    const now = Date.now();
    return {
      analyze: initial,
      finalize: true,
      fallbackBefore: toLocalSqlTimestamp(new Date(now - REQUEST_BACKFILL_FALLBACK_GRACE_MS)),
      before: toLocalSqlTimestamp(new Date(now - REQUEST_BACKFILL_GENERIC_GRACE_MS)),
    };
  }

  private async hasEligibleAttempts(before: string): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1 FROM "agent_messages"
         WHERE "request_id" IS NULL AND timestamp < $1
         LIMIT 1
       ) AS pending`,
      [before],
    )) as { pending: boolean }[];
    return rows[0]?.pending === true;
  }

  private async hasAttemptTable(): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'agent_messages'
           AND c.relkind IN ('r', 'p')
       ) AS present`,
    )) as { present: boolean }[];
    return rows[0]?.present === true;
  }

  private async isCompleted(): Promise<boolean> {
    return (await this.stateRepo.countBy({ name: REQUEST_BACKFILL_NAME })) > 0;
  }

  private async isTransitionFinalized(): Promise<boolean> {
    return (await this.stateRepo.countBy({ name: REQUEST_TRANSITION_FINALIZATION_NAME })) > 0;
  }
}
