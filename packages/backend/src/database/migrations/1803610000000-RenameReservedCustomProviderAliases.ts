import { Logger } from '@nestjs/common';
import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  CUSTOM_PROVIDER_ALIAS_MAX_LENGTH,
  CUSTOM_PROVIDER_ALIAS_PATTERN,
  isReservedCustomProviderAlias,
} from 'thinker-shared';

const SUFFIX = 'custom';

/**
 * Moves custom providers off aliases that are now reserved for a built-in
 * provider (#101). Before #103 the native local runner ids (`lmstudio`,
 * `llamacpp`) were not reserved, so a custom provider named "LMStudio" could
 * take `lmstudio` and publish the same `lmstudio/<model>` ids as the built-in
 * connection: `/v1/models` listed them twice and the first match won.
 *
 * Each such row is renamed to `<alias>-custom` (then `<alias>-custom-2`, ...),
 * the first candidate that is valid, not reserved and free in its tenant.
 * Routes, tier assignments and request logs key custom providers by
 * `custom:<uuid>`, never by alias, so they keep working; the internal
 * `custom:<uuid>/<model>` id keeps resolving too. Only a client that sent the
 * old `<alias>/<model>` id must switch to the new alias, which is why each
 * rename is logged (ids only, never names).
 *
 * The check uses the current reservation rule, so it also covers any other
 * built-in id an alias might have taken. A re-run finds nothing to rename.
 * `down()` is a no-op: the old alias is reserved, and restoring it would bring
 * the shadowing back.
 */
export class RenameReservedCustomProviderAliases1803610000000 implements MigrationInterface {
  name = 'RenameReservedCustomProviderAliases1803610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; tenant_id: string; alias: string }[] = await queryRunner.query(
      `SELECT "id", "tenant_id", "alias" FROM "custom_providers" WHERE "alias" IS NOT NULL ORDER BY "created_at" ASC, "id" ASC`,
    );

    const taken = new Set(rows.map((row) => `${row.tenant_id} ${row.alias.toLowerCase()}`));
    const logger = new Logger(this.name);

    for (const row of rows) {
      const current = row.alias.toLowerCase();
      if (!isReservedCustomProviderAlias(current)) continue;
      const next = freeAlias(current, row.tenant_id, taken);
      if (next) taken.add(`${row.tenant_id} ${next}`);
      await queryRunner.query(`UPDATE "custom_providers" SET "alias" = $1 WHERE "id" = $2`, [
        next,
        row.id,
      ]);
      logger.warn(
        `Custom provider ${row.id} used the reserved alias "${current}"; ` +
          (next
            ? `renamed to "${next}". Clients must use ${next}/<model> or custom:${row.id}/<model>.`
            : `alias cleared. Clients must use custom:${row.id}/<model>.`),
      );
    }
  }

  public async down(): Promise<void> {
    // Intentionally empty: see the class comment.
  }
}

/** First free `<alias>-custom[-n]` candidate, or null if none fits. */
function freeAlias(alias: string, tenantId: string, taken: ReadonlySet<string>): string | null {
  for (let n = 1; n <= 100; n++) {
    const suffix = n === 1 ? `-${SUFFIX}` : `-${SUFFIX}-${n}`;
    const candidate = `${alias.slice(0, CUSTOM_PROVIDER_ALIAS_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!CUSTOM_PROVIDER_ALIAS_PATTERN.test(candidate)) continue;
    if (isReservedCustomProviderAlias(candidate)) continue;
    if (taken.has(`${tenantId} ${candidate}`)) continue;
    return candidate;
  }
  return null;
}
