import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Custom header tiers (header-based routing rules) are discontinued.
 *
 * - `agent_model_params` rows scoped to a header tier (`header:<id>`) are
 *   deleted: nothing reads them any more.
 * - `header_tiers` is dropped with its indexes.
 * - `agent_messages.header_tier_{id,name,color}` are dropped. Dropping a
 *   column is a metadata change on PostgreSQL, so the large fact table is not
 *   rewritten.
 *
 * Idempotent, with a short lock_timeout. `down` recreates the final schema of
 * the table and columns (data is not restored).
 */
export class DropHeaderTiers1804100000000 implements MigrationInterface {
  name = 'DropHeaderTiers1804100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(`DELETE FROM "agent_model_params" WHERE "scope_key" LIKE 'header:%'`);
    await queryRunner.query(`DROP TABLE IF EXISTS "header_tiers"`);
    await queryRunner.query(
      `ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "header_tier_color"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "header_tier_name"`,
    );
    await queryRunner.query(`ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "header_tier_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "header_tier_id" varchar DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "header_tier_name" varchar DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "header_tier_color" varchar DEFAULT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "header_tiers" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "agent_id" varchar NOT NULL,
        "name" varchar NOT NULL,
        "header_key" varchar NOT NULL,
        "header_value" varchar NOT NULL,
        "badge_color" varchar NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "override_route" jsonb DEFAULT NULL,
        "fallback_routes" jsonb DEFAULT NULL,
        "output_modality" varchar NOT NULL DEFAULT 'text',
        "response_mode" varchar NOT NULL DEFAULT 'buffered',
        "stream_warmup_ms" integer NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "updated_at" timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_header_tiers_agent_sort"
        ON "header_tiers" ("agent_id", "sort_order")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_header_tiers_agent_name"
        ON "header_tiers" ("agent_id", LOWER("name"))
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_header_tiers_override_route" ON "header_tiers" USING GIN ("override_route")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_header_tiers_fallback_routes" ON "header_tiers" USING GIN ("fallback_routes")`,
    );
  }
}
