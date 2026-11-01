import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, QueryRunner } from 'typeorm';
import { RequestRecordingStorageService } from '../common/services/request-recording-storage.service';
import {
  DEFAULT_RECORDING_RETENTION_DAYS,
  legacyRecordingEnvWarning,
} from '../config/recording-retention';
const RETENTION_LOCK_KEY = 4011986;

const TRY_LOCK_SQL = `
  SELECT pg_try_advisory_lock(${RETENTION_LOCK_KEY}::bigint) AS acquired
`;

const UNLOCK_SQL = `SELECT pg_advisory_unlock(${RETENTION_LOCK_KEY}::bigint)`;

/**
 * Effective retention of a row, in days: the harness override, then the
 * organization's value, then the environment default ($1).
 */
const RETENTION_DAYS_SQL = `COALESCE(a.log_retention_days, t.log_retention_days, $1)`;

const SELECT_EXPIRED_SQL = `
  SELECT m.id AS attempt_id, m.recording_key AS storage_key
  FROM agent_messages m
  LEFT JOIN agents a ON a.id = m.agent_id
  LEFT JOIN tenants t ON t.id = m.tenant_id
  WHERE m.recording_key IS NOT NULL
    AND m.timestamp < CURRENT_TIMESTAMP - (${RETENTION_DAYS_SQL} * INTERVAL '1 day')
  ORDER BY m.timestamp ASC
  LIMIT $2
`;

const LOG_PURGE_BATCH = 5000;
/** Recordings handled per pass: each one is a storage call, so keep memory flat. */
const RECORDING_PURGE_BATCH = 1000;

/**
 * Expired logs are stripped, not deleted: the row keeps its status, tokens and
 * cost so dashboards and totals stay whole, and loses the captured headers,
 * parameters and timeline. Batched so a first run over a long history never
 * holds one huge transaction.
 */
const STRIP_REQUEST_LOGS_SQL = `
  UPDATE requests SET request_headers = NULL, request_params = NULL, timeline = NULL
  WHERE id IN (
    SELECT r.id FROM requests r
    LEFT JOIN agents a ON a.id = r.agent_id
    LEFT JOIN tenants t ON t.id = r.tenant_id
    WHERE (r.request_headers IS NOT NULL OR r.request_params IS NOT NULL OR r.timeline IS NOT NULL)
      AND r.timestamp < CURRENT_TIMESTAMP - (${RETENTION_DAYS_SQL} * INTERVAL '1 day')
    LIMIT ${LOG_PURGE_BATCH}
  )
  RETURNING id
`;

const STRIP_ATTEMPT_LOGS_SQL = `
  UPDATE agent_messages SET request_headers = NULL, request_params = NULL
  WHERE id IN (
    SELECT m.id FROM agent_messages m
    LEFT JOIN agents a ON a.id = m.agent_id
    LEFT JOIN tenants t ON t.id = m.tenant_id
    WHERE (m.request_headers IS NOT NULL OR m.request_params IS NOT NULL)
      AND m.timestamp < CURRENT_TIMESTAMP - (${RETENTION_DAYS_SQL} * INTERVAL '1 day')
    LIMIT ${LOG_PURGE_BATCH}
  )
  RETURNING id
`;

/**
 * Finished trigger deliveries follow the same retention as request logs
 * (harness → organization → environment). Their attempt logs cascade.
 * Queued rows are never removed here.
 */
const DELETE_TRIGGER_EVENTS_SQL = `
  DELETE FROM trigger_events
  WHERE id IN (
    SELECT e.id FROM trigger_events e
    LEFT JOIN agents a ON a.id = e.agent_id
    LEFT JOIN tenants t ON t.id = e.tenant_id
    WHERE e.status IN ('delivered', 'failed')
      AND e.created_at < CURRENT_TIMESTAMP - (${RETENTION_DAYS_SQL} * INTERVAL '1 day')
    LIMIT ${LOG_PURGE_BATCH}
  )
  RETURNING id
`;

/**
 * Proxy logs follow the proxy's own retention, then the workspace's, then the
 * environment default. The daily statistics are never removed here.
 */
const DELETE_PROXY_LOGS_SQL = `
  DELETE FROM proxy_logs
  WHERE id IN (
    SELECT l.id FROM proxy_logs l
    LEFT JOIN proxy_servers p ON p.id = l.proxy_id
    LEFT JOIN tenants t ON t.id = l.tenant_id
    WHERE l.started_at < CURRENT_TIMESTAMP
      - (COALESCE(p.log_retention_days, t.log_retention_days, $1) * INTERVAL '1 day')
    LIMIT ${LOG_PURGE_BATCH}
  )
  RETURNING id
`;

const DELETE_METADATA_SQL = `
  UPDATE agent_messages
  SET recording_key = NULL
  WHERE id = $1 AND recording_key = $2
  RETURNING id
`;

interface ExpiredRecording {
  attempt_id: string;
  storage_key: string;
}

/** Rows returned by an UPDATE ... RETURNING, whichever shape the driver uses. */
function affectedRows(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  const rows: unknown = Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(rows) ? rows.length : 0;
}

@Injectable()
export class RequestRecordingRetentionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RequestRecordingRetentionService.name);
  readonly retentionDays: number;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
    private readonly storage: RequestRecordingStorageService,
  ) {
    this.retentionDays =
      config.get<number>('app.requestRecordingRetentionDays') ?? DEFAULT_RECORDING_RETENTION_DAYS;
  }

  /** Runs after every onModuleInit, so the storage backend is already prepared. */
  onApplicationBootstrap(): void {
    const legacy = legacyRecordingEnvWarning(process.env);
    if (legacy) this.logger.warn(legacy);
    this.logger.log(
      `Request recordings: retention ${this.retentionDays} days, storage ${
        this.storage.backend ?? 'unavailable'
      }`,
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'request-recording-retention',
    waitForCompletion: true,
  })
  async deleteExpiredRecordings(): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    let acquired = false;
    try {
      await queryRunner.connect();
      const lockRows = (await queryRunner.query(TRY_LOCK_SQL)) as Array<{ acquired?: boolean }>;
      acquired = lockRows[0]?.acquired === true;
      if (!acquired) return 0;

      let deleted = 0;
      for (;;) {
        const recordings = await this.findExpiredBatch(queryRunner, this.retentionDays);
        const batchDeleted = await this.deleteRecordings(queryRunner, recordings);
        deleted += batchDeleted;
        // A failed delete keeps its row, so a batch with no progress means
        // only failures are left: stop instead of retrying them forever.
        if (recordings.length < RECORDING_PURGE_BATCH || batchDeleted === 0) break;
      }

      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} expired Provider Attempt recording(s)`);
      }
      const requests = await this.stripLogs(queryRunner, STRIP_REQUEST_LOGS_SQL);
      const attempts = await this.stripLogs(queryRunner, STRIP_ATTEMPT_LOGS_SQL);
      if (requests + attempts > 0) {
        this.logger.log(
          `Cleared expired logs of ${requests} Request(s) and ${attempts} Provider Attempt(s)`,
        );
      }
      const triggerEvents = await this.stripLogs(queryRunner, DELETE_TRIGGER_EVENTS_SQL);
      if (triggerEvents > 0) {
        this.logger.log(`Deleted ${triggerEvents} expired trigger delivery event(s)`);
      }
      const proxyLogs = await this.stripLogs(queryRunner, DELETE_PROXY_LOGS_SQL);
      if (proxyLogs > 0) {
        this.logger.log(`Deleted ${proxyLogs} expired proxy log(s)`);
      }
      return deleted;
    } catch (error) {
      this.logger.error(
        `Request recording retention failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    } finally {
      if (acquired) await queryRunner.query(UNLOCK_SQL).catch(() => undefined);
      await queryRunner.release().catch(() => undefined);
    }
  }

  private async findExpiredBatch(
    queryRunner: QueryRunner,
    retentionDays: number,
  ): Promise<ExpiredRecording[]> {
    return queryRunner.query(SELECT_EXPIRED_SQL, [retentionDays, RECORDING_PURGE_BATCH]) as Promise<
      ExpiredRecording[]
    >;
  }

  private async stripLogs(queryRunner: QueryRunner, sql: string): Promise<number> {
    let total = 0;
    for (;;) {
      const count = affectedRows(await queryRunner.query(sql, [this.retentionDays]));
      total += count;
      if (count < LOG_PURGE_BATCH) return total;
    }
  }

  private async deleteRecordings(
    queryRunner: QueryRunner,
    recordings: ExpiredRecording[],
  ): Promise<number> {
    let deleted = 0;
    for (const recording of recordings) {
      try {
        await this.storage.delete(recording.storage_key);
        deleted += affectedRows(
          await queryRunner.query(DELETE_METADATA_SQL, [
            recording.attempt_id,
            recording.storage_key,
          ]),
        );
      } catch (error) {
        this.logger.warn(
          `Could not delete Provider Attempt recording ${recording.attempt_id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return deleted;
  }
}
