import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Editable base URL for API-key connections. NULL keeps the official URL of
 * the provider type (and region); a value replaces the base, the API paths
 * stay the same. Subscriptions keep their fixed hosts.
 */
export class AddTenantProviderBaseUrl1805400000000 implements MigrationInterface {
  name = 'AddTenantProviderBaseUrl1805400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_providers" ADD COLUMN IF NOT EXISTS "base_url" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenant_providers" DROP COLUMN IF EXISTS "base_url"`);
  }
}
