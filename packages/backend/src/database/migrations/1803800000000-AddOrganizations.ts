import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Organizations, roles and accounts (ADR 0006). A tenant is an organization;
 * `organization_members` replaces `tenants.owner_user_id` as the user→tenant
 * link, and `user_profiles` holds the instance-admin and forced
 * password-change flags. Backfill: every existing owner becomes `owner` of
 * its tenant, and the oldest user becomes the instance admin. Idempotent.
 */
export class AddOrganizations1803800000000 implements MigrationInterface {
  name = 'AddOrganizations1803800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_members" (
        "tenant_id" varchar NOT NULL,
        "user_id" varchar NOT NULL,
        "role" varchar NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_organization_members" PRIMARY KEY ("tenant_id", "user_id"),
        CONSTRAINT "FK_organization_members_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_organization_members_role"
          CHECK ("role" IN ('viewer', 'member', 'admin', 'owner'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_organization_members_user" ON "organization_members" ("user_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_profiles" (
        "user_id" varchar PRIMARY KEY,
        "is_instance_admin" boolean NOT NULL DEFAULT false,
        "must_change_password" boolean NOT NULL DEFAULT false,
        "active_tenant_id" varchar
      )
    `);
    await queryRunner.query(`
      INSERT INTO "organization_members" ("tenant_id", "user_id", "role")
      SELECT "id", "owner_user_id", 'owner' FROM "tenants"
      WHERE "owner_user_id" IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
    // Better Auth creates "user" after the TypeORM migrations on a fresh
    // install; there is nobody to promote then (the setup wizard does it).
    const [{ exists }] = (await queryRunner.query(
      `SELECT to_regclass('"user"') IS NOT NULL AS "exists"`,
    )) as Array<{ exists: boolean }>;
    if (!exists) return;
    // Legacy tenants were named after their owner's id; show the owner instead.
    await queryRunner.query(`
      UPDATE "tenants" t
         SET "organization_name" = COALESCE(NULLIF(TRIM(u."name"), ''), u."email")
        FROM "user" u
       WHERE u."id" = t."owner_user_id"
         AND (t."organization_name" IS NULL OR TRIM(t."organization_name") = '')
    `);
    await queryRunner.query(`
      INSERT INTO "user_profiles" ("user_id", "is_instance_admin")
      SELECT "id", true FROM "user"
      WHERE NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "is_instance_admin")
      ORDER BY "createdAt" ASC
      LIMIT 1
      ON CONFLICT ("user_id") DO UPDATE SET "is_instance_admin" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_members"`);
  }
}
