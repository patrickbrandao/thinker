import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-agent `/v1/models` listing mode: `closed` (auto and virtual models),
 * `restricted` (plus the models their routes and fallbacks reach) or `open`
 * (every model, the previous behavior and the default).
 *
 * A constant default makes the ADD COLUMN a metadata change on PostgreSQL 11+,
 * so existing agents need no backfill. Idempotent, with a short lock_timeout,
 * like the other column additions.
 */
export class AddAgentModelListing1804000000000 implements MigrationInterface {
  name = 'AddAgentModelListing1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "model_listing" varchar NOT NULL DEFAULT 'open'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN IF EXISTS "model_listing"`);
  }
}
