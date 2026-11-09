import { MigrationInterface, QueryRunner } from 'typeorm';

/** Labels the old naming schemes generated: 'Default' and 'Key N'. */
const LEGACY_LABEL = /^(default|key \d+)$/i;

interface ConnectionRow {
  id: string;
  tenant_id: string;
  provider: string;
  auth_type: string;
  label: string;
}

interface RouteLike {
  provider?: string;
  authType?: string;
  keyLabel?: string | null;
}

interface Rename {
  provider: string;
  authType: string;
  from: string;
  to: string;
}

/**
 * Connections are now named `<provider>-N` (`custom-N` for custom providers),
 * N being the lowest number free among that provider's connections across
 * auth types. This renames the connections still carrying an old generated
 * name ('Default', 'Key N') the same way, oldest connection first, keeping
 * every name a connection already has in the new pattern.
 *
 * A route pinned to a renamed connection (tiers, specificity rules, virtual
 * models) is rewritten with it, and so is the request history stamped with
 * the connection's id, so analytics keep one name per connection.
 *
 * Local runners (auth_type 'local') keep 'Default': they hold one row and
 * the service refuses other names for them.
 *
 * `down()` is a no-op: the new names are valid labels and the old ones carry
 * no meaning the code still needs.
 */
export class RenameDefaultConnectionLabels1805300000000 implements MigrationInterface {
  name = 'RenameDefaultConnectionLabels1805300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: ConnectionRow[] = await queryRunner.query(
      `SELECT "id", "tenant_id", "provider", "auth_type", "label" FROM "tenant_providers"
       ORDER BY "tenant_id", "provider", "connected_at", "priority", "id"`,
    );

    const byProvider = new Map<string, ConnectionRow[]>();
    for (const row of rows) {
      const key = `${row.tenant_id}\0${row.provider.toLowerCase()}`;
      const list = byProvider.get(key) ?? [];
      list.push(row);
      byProvider.set(key, list);
    }

    const renamesByTenant = new Map<string, Rename[]>();
    for (const list of byProvider.values()) {
      const lower = list[0].provider.toLowerCase();
      const prefix = lower.startsWith('custom:') ? 'custom' : lower;
      const taken = new Set(list.map((r) => r.label.toLowerCase()));
      let n = 1;
      for (const row of list) {
        if (row.auth_type === 'local' || !LEGACY_LABEL.test(row.label.trim())) continue;
        while (taken.has(`${prefix}-${n}`)) n++;
        const to = `${prefix}-${n}`;
        taken.add(to);
        await queryRunner.query(`UPDATE "tenant_providers" SET "label" = $1 WHERE "id" = $2`, [
          to,
          row.id,
        ]);
        // NULL labels in history read as 'Default'.
        await queryRunner.query(
          `UPDATE "agent_messages" SET "provider_key_label" = $1
           WHERE "tenant_provider_id" = $2
             AND (LOWER("provider_key_label") = LOWER($3)
                  OR ("provider_key_label" IS NULL AND LOWER($3) = 'default'))`,
          [to, row.id, row.label],
        );
        const renames = renamesByTenant.get(row.tenant_id) ?? [];
        renames.push({ provider: lower, authType: row.auth_type, from: row.label, to });
        renamesByTenant.set(row.tenant_id, renames);
      }
    }

    for (const [tenantId, renames] of renamesByTenant) {
      await this.relabelRoutes(queryRunner, tenantId, renames);
    }
  }

  public async down(): Promise<void> {
    // Intentionally empty: see the class comment.
  }

  private async relabelRoutes(
    queryRunner: QueryRunner,
    tenantId: string,
    renames: Rename[],
  ): Promise<void> {
    const relabel = (route: RouteLike | null): [RouteLike | null, boolean] => {
      if (!route || !route.keyLabel || !route.provider) return [route, false];
      const match = renames.find(
        (r) =>
          r.provider === route.provider!.toLowerCase() &&
          r.authType === route.authType &&
          r.from.toLowerCase() === route.keyLabel!.trim().toLowerCase(),
      );
      return match ? [{ ...route, keyLabel: match.to }, true] : [route, false];
    };
    const relabelAll = (routes: RouteLike[] | null): [RouteLike[] | null, boolean] => {
      if (!Array.isArray(routes)) return [routes, false];
      let changed = false;
      const next = routes.map((r) => {
        const [out, c] = relabel(r);
        changed ||= c;
        return out as RouteLike;
      });
      return [next, changed];
    };

    const targets: { table: string; scope: string; single: string[]; lists: string[] }[] = [
      {
        table: 'tier_assignments',
        scope: `"agent_id" IN (SELECT "id" FROM "agents" WHERE "tenant_id" = $1)`,
        single: ['override_route', 'auto_assigned_route'],
        lists: ['fallback_routes'],
      },
      {
        table: 'specificity_assignments',
        scope: `"agent_id" IN (SELECT "id" FROM "agents" WHERE "tenant_id" = $1)`,
        single: ['override_route', 'auto_assigned_route'],
        lists: ['fallback_routes'],
      },
      {
        table: 'virtual_models',
        scope: `"tenant_id" = $1`,
        single: ['override_route'],
        lists: ['fallback_routes'],
      },
    ];

    for (const { table, scope, single, lists } of targets) {
      const columns = [...single, ...lists];
      const rows: Record<string, unknown>[] = await queryRunner.query(
        `SELECT "id", ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}" WHERE ${scope}`,
        [tenantId],
      );
      for (const row of rows) {
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const column of columns) {
          const value = parseJson(row[column]);
          const [next, changed] = single.includes(column)
            ? relabel(value as RouteLike | null)
            : relabelAll(value as RouteLike[] | null);
          if (!changed) continue;
          params.push(JSON.stringify(next));
          sets.push(`"${column}" = $${params.length}::jsonb`);
        }
        if (sets.length === 0) continue;
        params.push(row.id);
        await queryRunner.query(
          `UPDATE "${table}" SET ${sets.join(', ')} WHERE "id" = $${params.length}`,
          params,
        );
      }
    }
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
