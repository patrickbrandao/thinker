import { MigrationInterface, QueryRunner } from 'typeorm';

// Inlined when the billing module that owned it was removed.
const REQUEST_USAGE_CUTOVER_STATE = 'tenant_request_usage_cutover_v1';

/**
 * Historically added Manifest Cloud's monthly request-quota counter
 * (`tenant_request_usage`, `requests.quota_counted` and an `agent_messages`
 * trigger). The counter only ever existed in cloud mode; self-hosted installs
 * skipped it entirely.
 *
 * Thinker has no plan quotas, so only the self-hosted path remains and `up()`
 * is a no-op. Databases that did get the counter have it removed by
 * DropBillingSchema1803200000000. `down()` keeps its idempotent cleanup.
 */
export class AddTenantRequestUsage1801300000000 implements MigrationInterface {
  name = 'AddTenantRequestUsage1801300000000';
  transaction = false;

  public async up(): Promise<void> {
    // Self-hosted path: no quota counter schema.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET lock_timeout = '1s'`);
    try {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "TRG_agent_messages_count_tenant_request_usage" ON "agent_messages"`,
      );
      await queryRunner.query(`DROP FUNCTION IF EXISTS "count_tenant_request_usage"()`);
      await queryRunner.query(
        `DELETE FROM "backfill_state" WHERE "name" = '${REQUEST_USAGE_CUTOVER_STATE}'`,
      );
      await queryRunner.query(`ALTER TABLE "requests" DROP COLUMN IF EXISTS "quota_counted"`);
      await queryRunner.query(`DROP TABLE IF EXISTS "tenant_request_usage"`);
    } finally {
      await queryRunner.query(`RESET lock_timeout`);
    }
  }
}
