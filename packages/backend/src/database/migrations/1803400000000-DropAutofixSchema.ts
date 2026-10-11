import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the schema of the removed Autofix feature (#16). Autofix sent failing
 * requests to Manifest's hosted healing service and is gone from the product;
 * the local self-heal planned for v0.6 will bring its own schema.
 *
 * - `agents.autofix_enabled`, the per-harness opt-in.
 * - `agent_messages.autofix_applied`, `autofix_group_id`, `autofix_role`,
 *   `autofix_operations` and `autofix_phoenix` (the healing service's decision),
 *   with the two indexes that only served them: `IDX_agent_messages_autofix_group`
 *   (1799000100000) and `IDX_agent_messages_autofix_request` (1802700000000).
 * - `requests.autofix_status` and its `CHK_requests_autofix_status` constraint,
 *   plus `IDX_requests_autofix_healed` (1802200000000), which 1803300000000
 *   already drops; repeating it here is a no-op.
 * - `install_metadata.autofix_consented_at`, the self-hosted consent stamp.
 *
 * Dropping a column also drops the indexes and constraints that reference it,
 * but each one is named here so the intent survives a future reader, and every
 * statement is idempotent (`IF EXISTS`). `lock_timeout` makes the migration fail
 * fast instead of queueing behind a long-running query while it holds up writes
 * to `agent_messages` and `requests`; a failed run is retried on the next boot.
 * `DROP COLUMN` only touches the catalog, so no table is rewritten.
 *
 * `down()` restores the columns, constraint and indexes as the earlier
 * migrations created them on the self-hosted path, empty. The cloud-only
 * `IDX_requests_autofix_healed` was never part of that path.
 */
export class DropAutofixSchema1803400000000 implements MigrationInterface {
  name = 'DropAutofixSchema1803400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_messages_autofix_request"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_messages_autofix_group"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_requests_autofix_healed"`);
    await queryRunner.query(`
      ALTER TABLE "agent_messages"
        DROP COLUMN IF EXISTS "autofix_applied",
        DROP COLUMN IF EXISTS "autofix_group_id",
        DROP COLUMN IF EXISTS "autofix_role",
        DROP COLUMN IF EXISTS "autofix_operations",
        DROP COLUMN IF EXISTS "autofix_phoenix"
    `);
    await queryRunner.query(
      `ALTER TABLE "requests" DROP CONSTRAINT IF EXISTS "CHK_requests_autofix_status"`,
    );
    await queryRunner.query(`ALTER TABLE "requests" DROP COLUMN IF EXISTS "autofix_status"`);
    await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN IF EXISTS "autofix_enabled"`);
    await queryRunner.query(
      `ALTER TABLE "install_metadata" DROP COLUMN IF EXISTS "autofix_consented_at"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "install_metadata" ADD COLUMN IF NOT EXISTS "autofix_consented_at" timestamp DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "autofix_enabled" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "autofix_status" varchar`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CHK_requests_autofix_status'
        ) THEN
          ALTER TABLE "requests" ADD CONSTRAINT "CHK_requests_autofix_status" CHECK (
            "autofix_status" IN (
              'no_patch', 'resolving', 'retry_succeeded', 'retry_failed', 'service_error'
            )
          );
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_messages"
        ADD COLUMN IF NOT EXISTS "autofix_applied" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "autofix_group_id" character varying,
        ADD COLUMN IF NOT EXISTS "autofix_role" character varying,
        ADD COLUMN IF NOT EXISTS "autofix_operations" jsonb,
        ADD COLUMN IF NOT EXISTS "autofix_phoenix" jsonb
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_messages_autofix_group" ON "agent_messages" ("tenant_id", "autofix_group_id") WHERE "autofix_group_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_messages_autofix_request" ON "agent_messages" ("request_id") WHERE "autofix_applied" = true`,
    );
  }
}
