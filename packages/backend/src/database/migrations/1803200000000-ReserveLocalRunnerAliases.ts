import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LM Studio and llama.cpp gained native routes (`lmstudio/<model>`,
 * `llamacpp/<model>`), so their ids became reserved custom-provider aliases.
 * A custom provider that already holds one of them would publish the same
 * public ids as the built-in connection, and the proxy would silently pick
 * whichever came first in the catalog.
 *
 * This moves each such provider to `<id>-custom` (`-custom-2`, `-custom-3`,
 * ... when the tenant already uses that name) and keeps the old alias in the
 * new `legacy_alias` column. The proxy still accepts `<legacy_alias>/<model>`
 * for that provider when no published id matches, so client configs written
 * against the old alias keep routing; `/v1/models` lists only the new alias.
 *
 * Nothing else changes: stored routes (tier, specificity and header-tier
 * overrides, fallbacks) reference the internal `custom:<uuid>` key, never the
 * alias. Rerunning is a no-op, since no row holds a reserved alias anymore.
 *
 * The ids are hard-coded on purpose: a migration must keep doing the same
 * thing when the shared registry changes later.
 */
const RESERVED_LOCAL_RUNNER_ALIASES = ['lmstudio', 'llamacpp'] as const;

interface AliasRow {
  id: string;
  tenant_id: string;
  alias: string;
}

export class ReserveLocalRunnerAliases1803200000000 implements MigrationInterface {
  name = 'ReserveLocalRunnerAliases1803200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_providers" ADD COLUMN IF NOT EXISTS "legacy_alias" varchar`,
    );

    const rows: AliasRow[] = await queryRunner.query(
      `SELECT "id", "tenant_id", "alias" FROM "custom_providers" WHERE "alias" IS NOT NULL ORDER BY "created_at" ASC, "id" ASC`,
    );

    const taken = new Set(rows.map((row) => aliasKey(row.tenant_id, row.alias)));
    const reserved = new Set<string>(RESERVED_LOCAL_RUNNER_ALIASES);

    for (const row of rows) {
      const old = row.alias.toLowerCase();
      if (!reserved.has(old)) continue;
      const next = freeAlias(row.tenant_id, old, taken);
      taken.add(aliasKey(row.tenant_id, next));
      await queryRunner.query(
        `UPDATE "custom_providers" SET "alias" = $1, "legacy_alias" = $2 WHERE "id" = $3`,
        [next, row.alias, row.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasColumn: unknown[] = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_providers' AND column_name = 'legacy_alias'`,
    );
    if (hasColumn.length === 0) return;

    // Give each renamed provider its old alias back, unless another provider
    // of the tenant took it in the meantime (the unique index would reject
    // it); that row keeps its current alias.
    await queryRunner.query(
      `UPDATE "custom_providers" cp
         SET "alias" = cp."legacy_alias"
         WHERE cp."legacy_alias" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM "custom_providers" other
             WHERE other."tenant_id" = cp."tenant_id"
               AND other."id" <> cp."id"
               AND LOWER(other."alias") = LOWER(cp."legacy_alias")
           )`,
    );
    await queryRunner.query(`ALTER TABLE "custom_providers" DROP COLUMN IF EXISTS "legacy_alias"`);
  }
}

function aliasKey(tenantId: string, alias: string): string {
  return `${tenantId} ${alias.toLowerCase()}`;
}

/** First of `<id>-custom`, `<id>-custom-2`, ... the tenant does not use yet. */
function freeAlias(tenantId: string, id: string, taken: ReadonlySet<string>): string {
  const base = `${id}-custom`;
  if (!taken.has(aliasKey(tenantId, base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(aliasKey(tenantId, candidate))) return candidate;
  }
}
