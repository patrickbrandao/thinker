import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Virtual models (ADR 0004, #176): public model names per harness, each with
 * its own route chain. The table starts empty and no existing row changes.
 *
 * `agent_messages` gains `virtual_model_id` / `virtual_model_name`,
 * denormalized like `header_tier_*` so historical rows keep the name used at
 * the time. Both are nullable with no default, so adding them is a metadata
 * change that does not rewrite the table.
 *
 * Idempotent (`IF NOT EXISTS` / `IF EXISTS`) so a retried boot after a
 * partial run converges. `lock_timeout` makes the `agent_messages` ALTER fail
 * fast instead of queueing behind a long query.
 */
export class AddVirtualModels1803700000000 implements MigrationInterface {
  name = 'AddVirtualModels1803700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "virtual_models" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "agent_id" varchar NOT NULL,
        "name" varchar(64) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "override_route" jsonb,
        "fallback_routes" jsonb,
        "continue_on_default" boolean NOT NULL DEFAULT false,
        "response_mode" varchar NOT NULL DEFAULT 'buffered',
        "output_modality" varchar NOT NULL DEFAULT 'text',
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "updated_at" timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "FK_virtual_models_agent" FOREIGN KEY ("agent_id")
          REFERENCES "agents" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_virtual_models_agent_sort"
        ON "virtual_models" ("agent_id", "sort_order")
    `);
    // Case-insensitive uniqueness lives here, not on the entity (see
    // entities/virtual-model.entity.ts), as for header_tiers.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_virtual_models_agent_name"
        ON "virtual_models" ("agent_id", LOWER("name"))
    `);
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "virtual_model_id" varchar NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "virtual_model_name" varchar NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '10s'`);
    await queryRunner.query(
      `ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "virtual_model_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "virtual_model_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "virtual_models"`);
  }
}
