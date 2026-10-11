import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the schema left behind by the removed billing layer (Stripe plans,
 * request quotas and billing emails):
 *
 * - `tenant_request_usage`, plus the `agent_messages` trigger, its function,
 *   the `requests.quota_counted` flag and the cutover row that fed it. These
 *   only exist on databases that ran the old cloud-mode quota migration
 *   (1801300000000), and the trigger must go before the table it writes to,
 *   or every attempt insert would fail.
 * - `billing_email_logs` (its indexes go with the table).
 * - `tenants.limit_overrides` and `tenants.billing_email_preferences`.
 *
 * Better Auth's Stripe plugin tables (`subscription`, `user.stripeCustomerId`)
 * were only created when `STRIPE_*` was configured; they are not managed by
 * TypeORM and are left alone.
 *
 * Every statement is idempotent, so the migration is safe on any schema.
 * `down()` restores what the earlier migrations create on the self-hosted path
 * (the quota counter was never part of it), not the rows.
 */
export class DropBillingSchema1803200000000 implements MigrationInterface {
  name = 'DropBillingSchema1803200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_agent_messages_count_tenant_request_usage" ON "agent_messages"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "count_tenant_request_usage"()`);
    await queryRunner.query(
      `DELETE FROM "backfill_state" WHERE "name" = 'tenant_request_usage_cutover_v1'`,
    );
    await queryRunner.query(`ALTER TABLE "requests" DROP COLUMN IF EXISTS "quota_counted"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_request_usage"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_email_logs"`);
    await queryRunner.query(
      `ALTER TABLE "tenants" DROP COLUMN IF EXISTS "limit_overrides", DROP COLUMN IF EXISTS "billing_email_preferences"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "limit_overrides" jsonb, ADD COLUMN IF NOT EXISTS "billing_email_preferences" jsonb`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_email_logs" (
        "id" varchar NOT NULL,
        "dedupe_key" varchar NOT NULL,
        "kind" varchar NOT NULL,
        "tenant_id" varchar,
        "user_id" varchar,
        "stripe_subscription_id" varchar,
        "period_start" TIMESTAMP,
        "period_end" TIMESTAMP,
        "metadata" jsonb,
        "sent_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_billing_email_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_email_logs_dedupe_key" ON "billing_email_logs" ("dedupe_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_email_logs_tenant_period" ON "billing_email_logs" ("tenant_id", "period_start") WHERE "tenant_id" IS NOT NULL`,
    );
  }
}
