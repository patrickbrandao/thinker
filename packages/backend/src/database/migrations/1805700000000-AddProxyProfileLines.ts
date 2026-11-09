import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outbound profile lines (balanced egress).
 *
 * A profile is an ordered list of lines; each line is a single proxy,
 * "Direct", or several proxies balanced by session affinity or per request.
 * - `proxy_profile_lines`: one row per line with its mode and options.
 * - `proxy_bindings.line`: the line a profile item belongs to (`position`
 *   stays the total order inside the profile).
 *
 * Every existing item becomes a line of its own, so behavior is unchanged.
 */
export class AddProxyProfileLines1805700000000 implements MigrationInterface {
  name = 'AddProxyProfileLines1805700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "proxy_bindings" ADD COLUMN IF NOT EXISTS "line" integer`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proxy_profile_lines" (
        "tenant_id" varchar NOT NULL,
        "profile_id" varchar NOT NULL,
        "line" integer NOT NULL,
        "mode" varchar(10) NOT NULL,
        "on_failure" varchar(12) NOT NULL DEFAULT 'next_member',
        "no_session" varchar(8) NOT NULL DEFAULT 'request',
        CONSTRAINT "PK_proxy_profile_lines" PRIMARY KEY ("tenant_id", "profile_id", "line"),
        CONSTRAINT "FK_proxy_profile_lines_profile" FOREIGN KEY ("profile_id")
          REFERENCES "proxy_profiles" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `UPDATE proxy_bindings SET line = position WHERE target_type = 'profile' AND line IS NULL`,
    );
    await queryRunner.query(`
      INSERT INTO proxy_profile_lines (tenant_id, profile_id, line, mode)
      SELECT b.tenant_id, b.target_id, b.line,
             CASE WHEN b.proxy_id IS NULL THEN 'direct' ELSE 'proxy' END
        FROM proxy_bindings b
        JOIN proxy_profiles p ON p.id = b.target_id AND p.tenant_id = b.tenant_id
       WHERE b.target_type = 'profile'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "proxy_profile_lines"`);
    await queryRunner.query(`ALTER TABLE "proxy_bindings" DROP COLUMN IF EXISTS "line"`);
  }
}
