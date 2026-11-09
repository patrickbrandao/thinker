import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Alerts: one row per system event (model changes, credential and OAuth
 * failures, limits, trigger failures, audit, authentication, catalog sync).
 * `tenant_id` NULL marks an instance event (catalog). Read state is shared:
 * the first reader marks it for everyone (`read_at`, `read_by_user_id`).
 */
export class AddSystemEvents1805600000000 implements MigrationInterface {
  name = 'AddSystemEvents1805600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "system_events" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NULL,
        "level" varchar(16) NOT NULL,
        "category" varchar(32) NOT NULL,
        "type" varchar(64) NOT NULL,
        "title" varchar(300) NOT NULL,
        "message" text NOT NULL DEFAULT '',
        "entity_type" varchar(64) NULL,
        "entity_id" varchar(255) NULL,
        "entity_name" varchar(300) NULL,
        "actor_user_id" varchar NULL,
        "actor_ip" varchar(64) NULL,
        "actor_user_agent" varchar(500) NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "dedupe_key" varchar(500) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "read_at" timestamptz NULL,
        "read_by_user_id" varchar NULL
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_system_events_tenant_created" ON "system_events" ("tenant_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_system_events_tenant_category" ON "system_events" ("tenant_id", "category")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_system_events_dedupe" ON "system_events" ("dedupe_key", "created_at" DESC) WHERE "dedupe_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "system_events"`);
  }
}
