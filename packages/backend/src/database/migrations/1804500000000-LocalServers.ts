import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { deriveCustomProviderAlias, isReservedCustomProviderAlias } from 'thinker-shared';
import {
  defaultLocalServerConfig,
  localServerBaseUrl,
  localServerConfigFromBaseUrl,
  type LocalServerConfig,
  type LocalServerType,
} from '../../common/constants/local-servers';

/** Display names the old tiles saved, normalised like the old Local-tab lookup. */
const TYPE_BY_NORMALIZED_NAME: Readonly<Record<string, LocalServerType>> = {
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  llamacpp: 'llamacpp',
};

interface RouteLike {
  provider?: string;
  authType?: string;
  model?: string;
  [key: string]: unknown;
}

const ROUTE_TABLES = ['tier_assignments', 'specificity_assignments', 'virtual_models'] as const;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s._-]+/g, '');
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isOllamaLocalRoute(route: RouteLike | null | undefined): boolean {
  return !!route && route.provider?.toLowerCase() === 'ollama' && route.authType === 'local';
}

/** `ollama/llama3.2` and `llama3.2` both name the bare Ollama model. */
function bareOllamaModel(model: string): string {
  return model.toLowerCase().startsWith('ollama/') ? model.slice('ollama/'.length) : model;
}

/**
 * Local servers: Ollama, LM Studio and llama.cpp become N configurable
 * servers per type, each one a `custom_providers` row with `local_type` and
 * `local_config` (scheme, host, port, path prefix, timeouts).
 *
 * - LM Studio / llama.cpp / Ollama custom providers the old tiles created
 *   (recognised by their display name) get `local_type` and a config parsed
 *   from their `base_url`; their companion connections move to `auth_type
 *   'local'` and their prices to zero.
 * - Each tenant's built-in Ollama connection (`provider 'ollama'`, `auth_type
 *   'local'`, reached through the global `OLLAMA_HOST`) becomes an Ollama
 *   server at that address. The connection rows are re-pointed in place, so
 *   their ids — and every harness that enables them — stay; routes, fallbacks
 *   and per-model params naming `ollama` move to the new provider key.
 */
export class LocalServers1804500000000 implements MigrationInterface {
  name = 'LocalServers1804500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_providers" ADD COLUMN IF NOT EXISTS "local_type" varchar NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "custom_providers" ADD COLUMN IF NOT EXISTS "local_config" jsonb NULL`,
    );

    await this.tagTileProviders(queryRunner);
    await this.convertBuiltInOllama(queryRunner);
  }

  private async tagTileProviders(queryRunner: QueryRunner): Promise<void> {
    const rows: { id: string; name: string; base_url: string; models: unknown }[] =
      await queryRunner.query(
        `SELECT "id", "name", "base_url", "models" FROM "custom_providers" WHERE "local_type" IS NULL`,
      );
    for (const row of rows) {
      const type = TYPE_BY_NORMALIZED_NAME[normalizeName(row.name)];
      if (!type) continue;
      const config = localServerConfigFromBaseUrl(row.base_url, type);
      if (!config) continue;
      const models = (parseJson<Record<string, unknown>[]>(row.models) ?? []).map((m) => {
        const rest = { ...m };
        delete rest.price_estimated;
        return { ...rest, input_price_per_million_tokens: 0, output_price_per_million_tokens: 0 };
      });
      await queryRunner.query(
        `UPDATE "custom_providers"
         SET "local_type" = $1, "local_config" = $2::jsonb, "base_url" = $3, "models" = $4
         WHERE "id" = $5`,
        [type, JSON.stringify(config), localServerBaseUrl(config), JSON.stringify(models), row.id],
      );
      const key = `custom:${row.id}`;
      // Re-tag the companion connections, skipping a label that already has
      // a 'local' twin (unique on tenant, provider, auth_type, label).
      await queryRunner.query(
        `UPDATE "tenant_providers" t
         SET "auth_type" = 'local'
         WHERE t."provider" = $1 AND t."auth_type" = 'api_key'
           AND NOT EXISTS (
             SELECT 1 FROM "tenant_providers" o
             WHERE o."tenant_id" = t."tenant_id" AND o."provider" = t."provider"
               AND o."auth_type" = 'local' AND LOWER(o."label") = LOWER(t."label")
           )`,
        [key],
      );
      for (const table of ROUTE_TABLES) {
        await this.rewriteRoutes(queryRunner, table, null, (route) =>
          route.provider === key && route.authType === 'api_key'
            ? { ...route, authType: 'local' }
            : null,
        );
      }
      await queryRunner.query(
        `UPDATE "agent_model_params" p SET "auth_type" = 'local'
         WHERE p."provider" = $1 AND p."auth_type" = 'api_key'
           AND NOT EXISTS (
             SELECT 1 FROM "agent_model_params" o
             WHERE o."agent_id" = p."agent_id" AND o."scope_key" = p."scope_key"
               AND o."provider" = p."provider" AND o."auth_type" = 'local'
               AND o."model_name" = p."model_name"
           )`,
        [key],
      );
    }
  }

  private async convertBuiltInOllama(queryRunner: QueryRunner): Promise<void> {
    const connections: { tenant_id: string; cached_models: unknown }[] = await queryRunner.query(
      `SELECT "tenant_id", "cached_models" FROM "tenant_providers"
       WHERE LOWER("provider") = 'ollama' AND "auth_type" = 'local'`,
    );
    if (connections.length === 0) return;

    // The address every tenant's Ollama was reached at until now.
    const config: LocalServerConfig = defaultLocalServerConfig('ollama');
    const byTenant = new Map<string, Map<string, number | undefined>>();
    for (const c of connections) {
      const models = byTenant.get(c.tenant_id) ?? new Map<string, number | undefined>();
      for (const m of parseJson<{ id?: string; contextWindow?: number }[]>(c.cached_models) ?? []) {
        if (typeof m?.id === 'string' && m.id) {
          models.set(bareOllamaModel(m.id), m.contextWindow);
        }
      }
      byTenant.set(c.tenant_id, models);
    }

    for (const [tenantId, models] of byTenant) {
      const existing: { name: string; alias: string | null }[] = await queryRunner.query(
        `SELECT "name", "alias" FROM "custom_providers" WHERE "tenant_id" = $1`,
        [tenantId],
      );
      const names = new Set(existing.map((r) => r.name.toLowerCase()));
      const aliases = new Set(existing.map((r) => r.alias?.toLowerCase()).filter(Boolean));
      let name = 'Ollama';
      for (let n = 2; names.has(name.toLowerCase()); n++) name = `Ollama ${n}`;
      const derived = deriveCustomProviderAlias(name);
      const alias =
        derived && !isReservedCustomProviderAlias(derived) && !aliases.has(derived)
          ? derived
          : null;

      const id = randomUUID();
      const key = `custom:${id}`;
      const remap = (route: RouteLike): RouteLike | null =>
        isOllamaLocalRoute(route)
          ? { ...route, provider: key, model: `${key}/${bareOllamaModel(route.model ?? '')}` }
          : null;

      // Routed models must stay listed, even when the cached list missed them.
      const agents: { id: string }[] = await queryRunner.query(
        `SELECT "id" FROM "agents" WHERE "tenant_id" = $1`,
        [tenantId],
      );
      const agentIds = agents.map((a) => a.id);
      for (const table of ROUTE_TABLES) {
        await this.rewriteRoutes(queryRunner, table, agentIds, (route) => {
          if (isOllamaLocalRoute(route) && route.model) {
            const bare = bareOllamaModel(route.model);
            if (!models.has(bare)) models.set(bare, undefined);
          }
          return remap(route);
        });
      }

      const modelRows = [...models].map(([model_name, contextWindow]) => ({
        model_name,
        input_price_per_million_tokens: 0,
        output_price_per_million_tokens: 0,
        ...(contextWindow ? { context_window: contextWindow } : {}),
      }));
      await queryRunner.query(
        `INSERT INTO "custom_providers"
           ("id", "tenant_id", "created_by_user_id", "name", "alias", "base_url", "api_kind",
            "models", "local_type", "local_config")
         VALUES ($1, $2, NULL, $3, $4, $5, 'openai', $6, 'ollama', $7::jsonb)`,
        [
          id,
          tenantId,
          name,
          alias,
          localServerBaseUrl(config),
          JSON.stringify(modelRows),
          JSON.stringify(config),
        ],
      );
      await queryRunner.query(
        `UPDATE "tenant_providers" SET "provider" = $1
         WHERE "tenant_id" = $2 AND LOWER("provider") = 'ollama' AND "auth_type" = 'local'`,
        [key, tenantId],
      );
      if (agentIds.length > 0) {
        const params: { id: string; model_name: string }[] = await queryRunner.query(
          `SELECT "id", "model_name" FROM "agent_model_params"
           WHERE "agent_id" = ANY($1) AND LOWER("provider") = 'ollama' AND "auth_type" = 'local'`,
          [agentIds],
        );
        for (const p of params) {
          await queryRunner.query(
            `UPDATE "agent_model_params" SET "provider" = $1, "model_name" = $2 WHERE "id" = $3`,
            [key, `${key}/${bareOllamaModel(p.model_name)}`, p.id],
          );
        }
      }
    }
  }

  /**
   * Apply `map` to every route of `table` (override, auto-assigned when the
   * table has one, and fallbacks). `map` returns the replacement or null to
   * keep the route. `agentIds` null scans every row.
   */
  private async rewriteRoutes(
    queryRunner: QueryRunner,
    table: (typeof ROUTE_TABLES)[number],
    agentIds: string[] | null,
    map: (route: RouteLike) => RouteLike | null,
  ): Promise<void> {
    if (agentIds && agentIds.length === 0) return;
    const hasAuto = table !== 'virtual_models';
    const cols = `"id", "override_route", "fallback_routes"${hasAuto ? ', "auto_assigned_route"' : ''}`;
    const rows: Record<string, unknown>[] = agentIds
      ? await queryRunner.query(`SELECT ${cols} FROM "${table}" WHERE "agent_id" = ANY($1)`, [
          agentIds,
        ])
      : await queryRunner.query(`SELECT ${cols} FROM "${table}"`);
    for (const row of rows) {
      let changed = false;
      const one = (value: unknown): RouteLike | null => {
        const route = parseJson<RouteLike>(value);
        if (!route) return route;
        const next = map(route);
        if (next) changed = true;
        return next ?? route;
      };
      const override = one(row.override_route);
      const auto = hasAuto ? one(row.auto_assigned_route) : null;
      const fallbacks = parseJson<RouteLike[]>(row.fallback_routes);
      const nextFallbacks = Array.isArray(fallbacks)
        ? fallbacks.map((f) => {
            const next = f ? map(f) : null;
            if (next) changed = true;
            return next ?? f;
          })
        : fallbacks;
      if (!changed) continue;
      const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
      if (hasAuto) {
        await queryRunner.query(
          `UPDATE "${table}" SET "override_route" = $1::jsonb, "auto_assigned_route" = $2::jsonb,
             "fallback_routes" = $3::jsonb WHERE "id" = $4`,
          [json(override), json(auto), json(nextFallbacks), row.id],
        );
      } else {
        await queryRunner.query(
          `UPDATE "${table}" SET "override_route" = $1::jsonb, "fallback_routes" = $2::jsonb
           WHERE "id" = $3`,
          [json(override), json(nextFallbacks), row.id],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Converted Ollama connections stay custom providers; only the columns go.
    await queryRunner.query(`ALTER TABLE "custom_providers" DROP COLUMN IF EXISTS "local_config"`);
    await queryRunner.query(`ALTER TABLE "custom_providers" DROP COLUMN IF EXISTS "local_type"`);
  }
}
