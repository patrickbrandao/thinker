import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Many API keys per harness and IP prefix lists.
 *
 * - `agent_api_keys` loses its one-key-per-agent unique constraint. The key
 *   each harness already has becomes its primary key (`is_primary`), keeps
 *   working unchanged and stays recoverable; at most one primary per harness.
 *   Extra keys carry a name, an expiry and, once revoked, `revoked_at`.
 * - `ip_prefix_lists` holds named IPv4/IPv6 address and prefix lists per
 *   organization; `agent_ip_prefix_lists` links a harness to the lists its
 *   keys are accepted from when `agents.ip_restriction_enabled` is on.
 */
export class HarnessKeysAndIpPrefixes1806100000000 implements MigrationInterface {
  name = 'HarnessKeysAndIpPrefixes1806100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The unique constraint on agent_id was named by TypeORM in the initial
    // schema; look it up instead of trusting the generated name.
    const constraints = (await queryRunner.query(
      `SELECT c.conname
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'agent_api_keys' AND c.contype = 'u'
          AND array_length(c.conkey, 1) = 1
          AND (SELECT attname FROM pg_attribute
                WHERE attrelid = t.oid AND attnum = c.conkey[1]) = 'agent_id'`,
    )) as Array<{ conname: string }>;
    for (const { conname } of constraints) {
      await queryRunner.query(`ALTER TABLE "agent_api_keys" DROP CONSTRAINT "${conname}"`);
    }

    await queryRunner.query(
      `ALTER TABLE "agent_api_keys" ADD COLUMN IF NOT EXISTS "name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_api_keys" ADD COLUMN IF NOT EXISTS "is_primary" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_api_keys" ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP`,
    );
    // Every existing row was its harness's only key.
    await queryRunner.query(`UPDATE "agent_api_keys" SET "is_primary" = true`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_agent_api_keys_primary"
         ON "agent_api_keys" ("agent_id") WHERE "is_primary"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_api_keys_agent" ON "agent_api_keys" ("agent_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "ip_restriction_enabled" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ip_prefix_lists" (
         "id" character varying NOT NULL,
         "tenant_id" character varying NOT NULL,
         "name" character varying(100) NOT NULL,
         "description" character varying(500),
         "entries" jsonb NOT NULL DEFAULT '[]'::jsonb,
         "created_by_user_id" character varying,
         "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
         "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
         CONSTRAINT "PK_ip_prefix_lists" PRIMARY KEY ("id"),
         CONSTRAINT "FK_ip_prefix_lists_tenant" FOREIGN KEY ("tenant_id")
           REFERENCES "tenants"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ip_prefix_lists_tenant_name"
         ON "ip_prefix_lists" ("tenant_id", lower("name"))`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_ip_prefix_lists" (
         "agent_id" character varying NOT NULL,
         "list_id" character varying NOT NULL,
         "tenant_id" character varying NOT NULL,
         "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
         CONSTRAINT "PK_agent_ip_prefix_lists" PRIMARY KEY ("agent_id", "list_id"),
         CONSTRAINT "FK_agent_ip_prefix_lists_agent" FOREIGN KEY ("agent_id")
           REFERENCES "agents"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_agent_ip_prefix_lists_list" FOREIGN KEY ("list_id")
           REFERENCES "ip_prefix_lists"("id") ON DELETE RESTRICT
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_ip_prefix_lists_list" ON "agent_ip_prefix_lists" ("list_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_ip_prefix_lists"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ip_prefix_lists"`);
    await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN IF EXISTS "ip_restriction_enabled"`);
    // Back to one key per harness: keep only the primary.
    await queryRunner.query(`DELETE FROM "agent_api_keys" WHERE NOT "is_primary"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_api_keys_agent"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_api_keys_primary"`);
    await queryRunner.query(`ALTER TABLE "agent_api_keys" DROP COLUMN IF EXISTS "revoked_at"`);
    await queryRunner.query(`ALTER TABLE "agent_api_keys" DROP COLUMN IF EXISTS "is_primary"`);
    await queryRunner.query(`ALTER TABLE "agent_api_keys" DROP COLUMN IF EXISTS "name"`);
    await queryRunner.query(
      `ALTER TABLE "agent_api_keys" ADD CONSTRAINT "UQ_agent_api_keys_agent" UNIQUE ("agent_id")`,
    );
  }
}
