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

const SELECT_ALL_EXPIRED_SQL = `
  SELECT id AS attempt_id, recording_key AS storage_key
  FROM agent_messages
  WHERE recording_key IS NOT NULL
    AND timestamp < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
  ORDER BY timestamp ASC
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

      const recordings = await this.findAllExpired(queryRunner, this.retentionDays);
      const deleted = await this.deleteRecordings(queryRunner, recordings);

      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} expired Provider Attempt recording(s)`);
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

  private async findAllExpired(
    queryRunner: QueryRunner,
    retentionDays: number,
  ): Promise<ExpiredRecording[]> {
    return queryRunner.query(SELECT_ALL_EXPIRED_SQL, [retentionDays]) as Promise<
      ExpiredRecording[]
    >;
  }

  private async deleteRecordings(
    queryRunner: QueryRunner,
    recordings: ExpiredRecording[],
  ): Promise<number> {
    let deleted = 0;
    for (const recording of recordings) {
      try {
        await this.storage.delete(recording.storage_key);
        const result = (await queryRunner.query(DELETE_METADATA_SQL, [
          recording.attempt_id,
          recording.storage_key,
        ])) as Array<{ id: string }> | [Array<{ id: string }>, number];
        const rows = Array.isArray(result[0]) ? result[0] : result;
        deleted += rows.length;
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
