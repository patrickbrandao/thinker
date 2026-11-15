import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editable URLs per account (ADR 0012): slot id → URL, NULL = every slot on
 * its default. Nothing is copied: `base_url` keeps meaning the inference slot
 * and is read as such when `url_overrides` does not set it. Pending OAuth
 * logins (`oauth_pending_flows`) keep the overrides they were started with.
 */
export class AddTenantProviderUrlOverrides1806000000000 implements MigrationInterface {
  name = 'AddTenantProviderUrlOverrides1806000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" ADD COLUMN IF NOT EXISTS "url_overrides" jsonb`,
    );
    // A pending login keeps the overrides it was started with until it completes.
    await queryRunner.query(
      `ALTER TABLE "oauth_pending_flows" ADD COLUMN IF NOT EXISTS "url_overrides" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "oauth_pending_flows" DROP COLUMN IF EXISTS "url_overrides"`,
    );
    await queryRunner.query(`ALTER TABLE "tenant_providers" DROP COLUMN IF EXISTS "url_overrides"`);
  }
}
