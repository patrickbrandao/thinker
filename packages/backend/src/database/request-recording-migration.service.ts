import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { RequestRecordingStorageService } from '../common/services/request-recording-storage.service';

const MOVE_LOCK_KEY = 4011987;
const TRY_LOCK_SQL = `SELECT pg_try_advisory_lock(${MOVE_LOCK_KEY}::bigint) AS acquired`;
const UNLOCK_SQL = `SELECT pg_advisory_unlock(${MOVE_LOCK_KEY}::bigint)`;
const MOVE_BATCH = 200;

/**
 * Recordings that still live in the legacy blob store: their key is on the
 * Provider Attempt but there is no PostgreSQL row for it yet. Keyset paging on
 * the primary key, so a recording that fails to move is skipped, not retried
 * forever within one run.
 */
const SELECT_PENDING_SQL = `
  SELECT m.id AS attempt_id, m.tenant_id, m.request_id, m.recording_key AS storage_key
  FROM agent_messages m
  WHERE m.recording_key IS NOT NULL
    AND m.id > $1
    AND NOT EXISTS (
      SELECT 1 FROM provider_attempt_recordings r WHERE r.storage_key = m.recording_key
    )
  ORDER BY m.id ASC
  LIMIT $2
`;

interface PendingRecording {
  attempt_id: string;
  tenant_id: string;
  request_id: string;
  storage_key: string;
}

/**
 * Moves recordings written to the filesystem or S3 before PostgreSQL became
 * the default storage (ADR 0013): copy into `provider_attempt_recordings`, then
 * delete the blob. Runs once per boot in the background, under an advisory lock
 * so only one replica moves. Until a recording is moved, reads fall back to the
 * legacy store, so the dashboard never loses it.
 */
@Injectable()
export class RequestRecordingMigrationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RequestRecordingMigrationService.name);
  private stopping = false;
  private running: Promise<void> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: RequestRecordingStorageService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.storage.backend !== 'postgres' || !this.storage.legacyBackend) return;
    this.running = this.moveAll()
      .then(() => undefined)
      .catch((error) =>
        this.logger.error(
          `Moving recordings to PostgreSQL failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.running;
  }

  /** Returns how many recordings were moved and how many could not be. */
  async moveAll(): Promise<{ moved: number; failed: number }> {
    const result = { moved: 0, failed: 0 };
    const legacy = this.storage.legacyBackend;
    if (this.storage.backend !== 'postgres' || !legacy) return result;

    const queryRunner: QueryRunner = this.dataSource.createQueryRunner();
    let acquired = false;
    try {
      await queryRunner.connect();
      const lock = (await queryRunner.query(TRY_LOCK_SQL)) as Array<{ acquired?: boolean }>;
      acquired = lock[0]?.acquired === true;
      if (!acquired) return result;

      let after = '';
      while (!this.stopping) {
        const batch = (await queryRunner.query(SELECT_PENDING_SQL, [
          after,
          MOVE_BATCH,
        ])) as PendingRecording[];
        if (batch.length === 0) break;
        for (const row of batch) {
          if (this.stopping) break;
          try {
            await this.storage.moveFromLegacy(row.storage_key, {
              tenantId: row.tenant_id,
              requestId: row.request_id,
              attemptId: row.attempt_id,
            });
            result.moved += 1;
          } catch (error) {
            result.failed += 1;
            this.logger.warn(
              `Could not move Provider Attempt recording ${row.attempt_id} from ${legacy}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        after = batch[batch.length - 1].attempt_id;
        if (batch.length < MOVE_BATCH) break;
      }

      if (result.moved > 0 || result.failed > 0) {
        this.logger.log(
          `Moved ${result.moved} recording(s) from ${legacy} to PostgreSQL` +
            (result.failed > 0
              ? `; ${result.failed} could not be moved and stay in ${legacy}`
              : ''),
        );
      }
      return result;
    } finally {
      if (acquired) await queryRunner.query(UNLOCK_SQL).catch(() => undefined);
      await queryRunner.release().catch(() => undefined);
    }
  }
}
