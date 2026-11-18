import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Provider Attempt recordings stored in PostgreSQL, the new default storage
 * backend (ADR 0013). One row per recording, keyed by the same storage key that
 * `agent_messages.recording_key` points to, so filesystem and S3 keys stay
 * valid and the move from those backends is a plain copy.
 *
 * The payload is the recording itself (request body, response body, wire
 * format) as readable JSON, so it can be queried with SQL. It is not encrypted.
 * The name differs from the dropped `request_recordings` table so the old
 * migrations' `down` steps never touch it.
 */
export class AddProviderAttemptRecordings1806200000000 implements MigrationInterface {
  name = 'AddProviderAttemptRecordings1806200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "provider_attempt_recordings" (
        "storage_key" varchar NOT NULL,
        "tenant_id" varchar NOT NULL,
        "request_id" varchar NOT NULL,
        "attempt_id" varchar NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_provider_attempt_recordings" PRIMARY KEY ("storage_key")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_provider_attempt_recordings_attempt" ON "provider_attempt_recordings" ("attempt_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "provider_attempt_recordings"`);
  }
}
