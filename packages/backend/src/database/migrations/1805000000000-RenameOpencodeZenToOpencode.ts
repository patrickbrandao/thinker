import { MigrationInterface, QueryRunner } from 'typeorm';
import { RenameReservedCustomProviderAliases1803610000000 } from './1803610000000-RenameReservedCustomProviderAliases';

const OLD_IDS = `('opencode-zen', 'opencodezen')`;
const OLD_PREFIX = 'opencode-zen/';

/**
 * OpenCode Zen is now just OpenCode: the provider id moves from
 * `opencode-zen` to `opencode` and its model ids from `opencode-zen/<model>`
 * to `opencode/<model>`. Rewrites the connections, every stored route
 * (tiers, specificity, virtual models), the cached catalogs, playground
 * columns, per-model params and the request logs, so history and routing keep
 * one name.
 *
 * `opencode` becomes a built-in id, so a custom provider that took it as its
 * alias is moved off it with the same rule as #101 (re-running that
 * migration, which only renames aliases the current registry reserves).
 *
 * The registry keeps `opencode-zen` as an alias and the proxy still accepts
 * `opencode-zen/<model>`, so `down()` is a no-op.
 */
export class RenameOpencodeZenToOpencode1805000000000 implements MigrationInterface {
  name = 'RenameOpencodeZenToOpencode1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await new RenameReservedCustomProviderAliases1803610000000().up(queryRunner);

    for (const table of [
      'tenant_providers',
      'agent_messages',
      'playground_columns',
      'agent_model_params',
    ]) {
      await queryRunner.query(
        `UPDATE "${table}" SET "provider" = 'opencode' WHERE lower("provider") IN ${OLD_IDS}`,
      );
    }

    const prefixed: [string, string][] = [
      ['agent_messages', 'model'],
      ['agent_messages', 'fallback_from_model'],
      ['requests', 'requested_model'],
      ['playground_columns', 'model'],
      ['agent_model_params', 'model_name'],
    ];
    for (const [table, column] of prefixed) {
      await queryRunner.query(
        `UPDATE "${table}" SET "${column}" = 'opencode/' || substr("${column}", ${OLD_PREFIX.length + 1}) WHERE "${column}" LIKE '${OLD_PREFIX}%'`,
      );
    }

    // `"opencode-zen` covers both `"provider": "opencode-zen"` and
    // `"model": "opencode-zen/<id>"` inside the serialized routes.
    await queryRunner.query(
      `UPDATE "tenant_providers" SET "cached_models" = replace("cached_models", '"opencode-zen', '"opencode') WHERE "cached_models" LIKE '%"opencode-zen%'`,
    );
    const routeColumns: [string, string][] = [
      ['tier_assignments', 'override_route'],
      ['tier_assignments', 'auto_assigned_route'],
      ['tier_assignments', 'fallback_routes'],
      ['specificity_assignments', 'override_route'],
      ['specificity_assignments', 'auto_assigned_route'],
      ['specificity_assignments', 'fallback_routes'],
      ['virtual_models', 'override_route'],
      ['virtual_models', 'fallback_routes'],
    ];
    for (const [table, column] of routeColumns) {
      await queryRunner.query(
        `UPDATE "${table}" SET "${column}" = replace("${column}"::text, '"opencode-zen', '"opencode')::jsonb WHERE "${column}"::text LIKE '%"opencode-zen%'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Intentionally empty: see the class comment.
  }
}
