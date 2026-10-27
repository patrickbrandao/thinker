import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-header-tier and per-connection stream warm-up overrides in ms (#244).
 *
 * Both columns are nullable with no default: null means "inherit", so the
 * proxy keeps resolving header tier > connection > local-runner default >
 * STREAM_WARMUP_MS, existing rows need no backfill, and adding them is a
 * metadata change that does not rewrite either table.
 *
 * Idempotent (`IF NOT EXISTS` / `IF EXISTS`) so a retried boot after a
 * partial run converges. `lock_timeout` makes the ALTERs fail fast instead of
 * queueing behind a long query.
 */
export class AddStreamWarmupMs1803900000000 implements MigrationInterface {
  name = 'AddStreamWarmupMs1803900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `ALTER TABLE "header_tiers" ADD COLUMN IF NOT EXISTS "stream_warmup_ms" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" ADD COLUMN IF NOT EXISTS "stream_warmup_ms" integer NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" DROP COLUMN IF EXISTS "stream_warmup_ms"`,
    );
    await queryRunner.query(`ALTER TABLE "header_tiers" DROP COLUMN IF EXISTS "stream_warmup_ms"`);
  }
}
