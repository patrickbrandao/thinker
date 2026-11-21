import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The source-IP restriction moves from the harness to each API key.
 *
 * - `agent_api_keys.ip_restriction_enabled` and `agent_api_key_ip_prefix_lists`
 *   (key ↔ IP prefix list) replace `agents.ip_restriction_enabled` and
 *   `agent_ip_prefix_lists`.
 * - Every key of a harness that had a restriction (or linked lists) inherits
 *   it, so nothing that was blocked becomes reachable.
 */
export class KeyIpRestriction1806300000000 implements MigrationInterface {
  name = 'KeyIpRestriction1806300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_api_keys" ADD COLUMN IF NOT EXISTS "ip_restriction_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_api_key_ip_prefix_lists" (
         "key_id" character varying NOT NULL,
         "list_id" character varying NOT NULL,
         "tenant_id" character varying NOT NULL,
         "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
         CONSTRAINT "PK_agent_api_key_ip_prefix_lists" PRIMARY KEY ("key_id", "list_id"),
         CONSTRAINT "FK_agent_api_key_ip_prefix_lists_key" FOREIGN KEY ("key_id")
           REFERENCES "agent_api_keys"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_agent_api_key_ip_prefix_lists_list" FOREIGN KEY ("list_id")
           REFERENCES "ip_prefix_lists"("id") ON DELETE RESTRICT
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agent_api_key_ip_prefix_lists_list"
         ON "agent_api_key_ip_prefix_lists" ("list_id")`,
    );

    const hasOld = (await queryRunner.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_ip_prefix_lists'`,
    )) as unknown[];
    if (hasOld.length > 0) {
      await queryRunner.query(
        `INSERT INTO "agent_api_key_ip_prefix_lists" ("key_id", "list_id", "tenant_id", "created_at")
         SELECT k.id, al.list_id, al.tenant_id, al.created_at
           FROM "agent_ip_prefix_lists" al
           JOIN "agent_api_keys" k ON k.agent_id = al.agent_id AND k.revoked_at IS NULL
         ON CONFLICT DO NOTHING`,
      );
      await queryRunner.query(
        `UPDATE "agent_api_keys" k SET "ip_restriction_enabled" = true
           FROM "agents" a
          WHERE a.id = k.agent_id AND a.ip_restriction_enabled AND k.revoked_at IS NULL`,
      );
      await queryRunner.query(`DROP TABLE "agent_ip_prefix_lists"`);
    }
    await queryRunner.query(`ALTER TABLE "agents" DROP COLUMN IF EXISTS "ip_restriction_enabled"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "ip_restriction_enabled" boolean NOT NULL DEFAULT false`,
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
    // A harness is restricted if any of its keys was: the union of their lists.
    await queryRunner.query(
      `INSERT INTO "agent_ip_prefix_lists" ("agent_id", "list_id", "tenant_id")
       SELECT DISTINCT k.agent_id, kl.list_id, kl.tenant_id
         FROM "agent_api_key_ip_prefix_lists" kl
         JOIN "agent_api_keys" k ON k.id = kl.key_id
       ON CONFLICT DO NOTHING`,
    );
    await queryRunner.query(
      `UPDATE "agents" a SET "ip_restriction_enabled" = true
        WHERE EXISTS (SELECT 1 FROM "agent_api_keys" k
                       WHERE k.agent_id = a.id AND k.ip_restriction_enabled)`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_api_key_ip_prefix_lists"`);
    await queryRunner.query(
      `ALTER TABLE "agent_api_keys" DROP COLUMN IF EXISTS "ip_restriction_enabled"`,
    );
  }
}
