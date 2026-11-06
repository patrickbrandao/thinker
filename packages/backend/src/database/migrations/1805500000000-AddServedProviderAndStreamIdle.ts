import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Report from NOC Norte (P6) and per-connection stream idle timeout.
 *
 * - `agent_messages.served_provider`, `upstream_generation_id`, `served_model`:
 *   what an aggregator (OpenRouter) says actually served the attempt (its
 *   `provider` field, the upstream response id, the model it answered with).
 * - `tenant_providers.stream_idle_timeout_ms`: per-connection override of
 *   STREAM_IDLE_TIMEOUT_MS, like `stream_warmup_ms` (#244).
 *
 * All nullable with no default (null = unknown / inherit): a metadata-only
 * change, no table rewrite, no backfill. Idempotent, with a short
 * `lock_timeout` so the ALTERs fail fast instead of queueing.
 */
export class AddServedProviderAndStreamIdle1805500000000 implements MigrationInterface {
  name = 'AddServedProviderAndStreamIdle1805500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "served_provider" varchar(120) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "upstream_generation_id" varchar(128) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "served_model" varchar(200) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" ADD COLUMN IF NOT EXISTS "stream_idle_timeout_ms" integer NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" DROP COLUMN IF EXISTS "stream_idle_timeout_ms"`,
    );
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "served_model"`);
    await queryRunner.query(
      `ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "upstream_generation_id"`,
    );
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "served_provider"`);
  }
}
