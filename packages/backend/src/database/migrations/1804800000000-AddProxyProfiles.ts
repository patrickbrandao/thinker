import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

/**
 * Outbound profiles and assignments.
 *
 * - `proxy_profiles`: named, ordered chains of proxy servers and "Direct".
 *   Their items live in `proxy_bindings` with `target_type = 'profile'`, so
 *   the proxy removal flow keeps rewriting them.
 * - `proxy_assignments`: how a provider default (`api_key:<provider>` or
 *   `subscription:<provider>`), a connection, a trigger or an e-mail config
 *   leaves: `global`, `direct` or a `profile`. No row = inherit (connection →
 *   provider default → global).
 *
 * Every chain bound directly to an object becomes a profile assigned to it.
 */
export class AddProxyProfiles1804800000000 implements MigrationInterface {
  name = 'AddProxyProfiles1804800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proxy_profiles" (
        "id" varchar PRIMARY KEY,
        "tenant_id" varchar NOT NULL,
        "name" varchar(100) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        "updated_at" timestamp NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_proxy_profiles_tenant_name"
        ON "proxy_profiles" ("tenant_id", LOWER("name"))
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proxy_assignments" (
        "tenant_id" varchar NOT NULL,
        "target_type" varchar(20) NOT NULL,
        "target_id" varchar NOT NULL,
        "mode" varchar(10) NOT NULL,
        "profile_id" varchar NULL,
        "updated_at" timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_proxy_assignments" PRIMARY KEY ("tenant_id", "target_type", "target_id"),
        CONSTRAINT "FK_proxy_assignments_profile" FOREIGN KEY ("profile_id")
          REFERENCES "proxy_profiles" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_proxy_assignments_profile" ON "proxy_assignments" ("profile_id")
    `);

    const chains = (await queryRunner.query(
      `SELECT DISTINCT tenant_id, target_type, target_id FROM proxy_bindings
        WHERE target_type <> 'profile' ORDER BY tenant_id, target_type, target_id`,
    )) as Array<{ tenant_id: string; target_type: string; target_id: string }>;
    const counters = new Map<string, number>();
    for (const c of chains) {
      const n = (counters.get(c.tenant_id) ?? 0) + 1;
      counters.set(c.tenant_id, n);
      const profileId = randomUUID();
      await queryRunner.query(
        `INSERT INTO proxy_profiles (id, tenant_id, name) VALUES ($1, $2, $3)`,
        [profileId, c.tenant_id, `Migrated profile ${n}`],
      );
      await queryRunner.query(
        `UPDATE proxy_bindings SET target_type = 'profile', target_id = $4
          WHERE tenant_id = $1 AND target_type = $2 AND target_id = $3`,
        [c.tenant_id, c.target_type, c.target_id, profileId],
      );
      // Provider chains used to cover every connection of the provider.
      const targets =
        c.target_type === 'provider'
          ? [`api_key:${c.target_id}`, `subscription:${c.target_id}`]
          : [c.target_id];
      for (const target of targets) {
        await queryRunner.query(
          `INSERT INTO proxy_assignments (tenant_id, target_type, target_id, mode, profile_id)
           VALUES ($1, $2, $3, 'profile', $4) ON CONFLICT DO NOTHING`,
          [c.tenant_id, c.target_type, target, profileId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM proxy_bindings WHERE target_type = 'profile'`);
    await queryRunner.query(`DROP TABLE IF EXISTS "proxy_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "proxy_profiles"`);
  }
}
