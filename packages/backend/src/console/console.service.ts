import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ERROR_MESSAGE_STATUSES } from '../analytics/services/query-helpers';

export type SearchResultType =
  'harness' | 'connection' | 'custom_provider' | 'virtual_model' | 'model' | 'member';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface AlertItem {
  id: string;
  timestamp: string;
  agentName: string | null;
  model: string | null;
  status: string;
  errorMessage: string | null;
  errorHttpStatus: number | null;
  errorClass: string | null;
}

/** Per-type cap, so one noisy type cannot crowd out the others. */
const PER_TYPE_LIMIT = 6;
const ALERT_LIMIT = 30;
const ALERT_WINDOW_HOURS = 24;

const harnessHref = (name: string, sub = '') => `/harnesses/${encodeURIComponent(name)}${sub}`;

/** Escapes LIKE wildcards so a query is matched literally. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Backs the console's ⌘K search and the alerts bell. Every query is scoped to
 * the active organization (tenant); nothing here crosses organizations.
 */
@Injectable()
export class ConsoleService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async search(tenantId: string, rawQuery: string): Promise<SearchResult[]> {
    const query = rawQuery.trim();
    if (query.length < 2) return [];
    const pattern = likePattern(query.slice(0, 100));
    const params = [tenantId, pattern, PER_TYPE_LIMIT];

    const [harnesses, connections, customProviders, virtuals, models, members] = await Promise.all([
      this.ds.query(
        `SELECT id, name, display_name, description, agent_platform
             FROM agents
            WHERE tenant_id = $1 AND deleted_at IS NULL AND is_playground = false
              AND (name ILIKE $2 OR display_name ILIKE $2 OR description ILIKE $2
                   OR agent_platform ILIKE $2)
            ORDER BY name LIMIT $3`,
        params,
      ),
      this.ds.query(
        `SELECT id, provider, label, auth_type
             FROM tenant_providers
            WHERE tenant_id = $1 AND (provider ILIKE $2 OR label ILIKE $2)
            ORDER BY provider, label LIMIT $3`,
        params,
      ),
      this.ds.query(
        `SELECT id, name, alias, base_url
             FROM custom_providers
            WHERE tenant_id = $1 AND (name ILIKE $2 OR alias ILIKE $2 OR base_url ILIKE $2)
            ORDER BY name LIMIT $3`,
        params,
      ),
      this.ds.query(
        `SELECT v.id, v.name, a.name AS agent_name
             FROM virtual_models v JOIN agents a ON a.id = v.agent_id AND a.deleted_at IS NULL
            WHERE v.tenant_id = $1 AND v.name ILIKE $2
            ORDER BY v.name LIMIT $3`,
        params,
      ),
      this.ds.query(
        `SELECT DISTINCT ON (m->>'id', tp.provider) tp.id AS connection_id, tp.provider,
                  m->>'id' AS model_id, m->>'displayName' AS display_name
             FROM tenant_providers tp,
                  jsonb_array_elements(COALESCE(NULLIF(tp.cached_models, '')::jsonb, '[]'::jsonb)) m
            WHERE tp.tenant_id = $1 AND tp.is_active = true
              AND (m->>'id' ILIKE $2 OR m->>'displayName' ILIKE $2)
            ORDER BY m->>'id', tp.provider LIMIT $3`,
        params,
      ),
      this.searchMembers(params),
    ]);

    return [
      ...harnesses.map(
        (r: {
          id: string;
          name: string;
          display_name: string | null;
          agent_platform: string | null;
        }) => ({
          type: 'harness' as const,
          id: r.id,
          title: r.display_name || r.name,
          subtitle: r.agent_platform,
          href: harnessHref(r.name),
        }),
      ),
      ...connections.map(
        (r: { id: string; provider: string; label: string; auth_type: string }) => ({
          type: 'connection' as const,
          id: r.id,
          title: r.label ? `${r.provider} · ${r.label}` : r.provider,
          subtitle: r.auth_type,
          href: `/providers/connections/${encodeURIComponent(r.id)}`,
        }),
      ),
      ...customProviders.map(
        (r: { id: string; name: string; alias: string | null; base_url: string }) => ({
          type: 'custom_provider' as const,
          id: r.id,
          title: r.name,
          subtitle: r.base_url,
          href: '/providers/usage-based',
        }),
      ),
      ...virtuals.map((r: { id: string; name: string; agent_name: string }) => ({
        type: 'virtual_model' as const,
        id: r.id,
        title: r.name,
        subtitle: r.agent_name,
        href: harnessHref(r.agent_name, '/routing'),
      })),
      ...models.map(
        (r: {
          connection_id: string;
          provider: string;
          model_id: string;
          display_name: string | null;
        }) => ({
          type: 'model' as const,
          id: `${r.provider}/${r.model_id}`,
          title: r.display_name || r.model_id,
          subtitle: `${r.provider}/${r.model_id}`,
          href: `/providers/connections/${encodeURIComponent(r.connection_id)}`,
        }),
      ),
      ...members.map((r: { id: string; name: string; email: string; role: string }) => ({
        type: 'member' as const,
        id: r.id,
        title: r.name || r.email,
        subtitle: `${r.email} · ${r.role}`,
        href: '/organization',
      })),
    ];
  }

  private userTableExists: boolean | undefined;

  /**
   * Members by name or email. Better Auth creates its `user` table outside
   * the TypeORM migrations, so the query is skipped where it does not exist.
   */
  private async searchMembers(
    params: unknown[],
  ): Promise<Array<{ id: string; name: string; email: string; role: string }>> {
    if (this.userTableExists === undefined) {
      const [row] = await this.ds.query(`SELECT to_regclass('"user"') IS NOT NULL AS ok`);
      this.userTableExists = row?.ok === true;
    }
    if (!this.userTableExists) return [];
    return this.ds.query(
      `SELECT u.id, u.name, u.email, om.role
         FROM organization_members om JOIN "user" u ON u.id = om.user_id
        WHERE om.tenant_id = $1 AND (u.name ILIKE $2 OR u.email ILIKE $2)
        ORDER BY u.name LIMIT $3`,
      params,
    );
  }

  /** Failed requests of the last 24 hours, newest first, plus the window total. */
  async alerts(tenantId: string): Promise<{ items: AlertItem[]; total: number }> {
    const params = [tenantId, [...ERROR_MESSAGE_STATUSES], ALERT_WINDOW_HOURS];
    const where = `tenant_id = $1 AND status = ANY($2)
                   AND timestamp >= now() - make_interval(hours => $3)`;
    const [rows, count] = await Promise.all([
      this.ds.query(
        `SELECT id, timestamp, agent_name, requested_model, status, error_message,
                error_http_status, error_class
           FROM requests WHERE ${where}
          ORDER BY timestamp DESC LIMIT ${ALERT_LIMIT}`,
        params,
      ),
      this.ds.query(`SELECT count(*)::int AS total FROM requests WHERE ${where}`, params),
    ]);
    return {
      total: count[0]?.total ?? 0,
      items: rows.map(
        (r: {
          id: string;
          timestamp: string | Date;
          agent_name: string | null;
          requested_model: string | null;
          status: string;
          error_message: string | null;
          error_http_status: number | null;
          error_class: string | null;
        }) => ({
          id: r.id,
          timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
          agentName: r.agent_name,
          model: r.requested_model,
          status: r.status,
          errorMessage: r.error_message ? r.error_message.slice(0, 300) : null,
          errorHttpStatus: r.error_http_status,
          errorClass: r.error_class,
        }),
      ),
    };
  }
}
