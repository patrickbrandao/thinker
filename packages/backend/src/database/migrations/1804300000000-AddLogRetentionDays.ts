import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Log retention in days: `tenants.log_retention_days` is the organization-wide
 * value (NULL = THINKER_RECORDING_RETENTION_DAYS) and
 * `agents.log_retention_days` overrides it per harness (NULL = organization).
 * Nullable with no default, so both ADD COLUMNs are metadata changes.
 */
export class AddLogRetentionDays1804300000000 implements MigrationInterface {
  name = 'AddLogRetentionDays1804300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "log_retention_days" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "log_retention_days" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN IF EXISTS "log_retention_days"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "log_retention_days"`);
  }
}
