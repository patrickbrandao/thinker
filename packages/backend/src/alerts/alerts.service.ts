import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ADMIN_EVENT_CATEGORIES,
  INSTANCE_EVENT_CATEGORIES,
  OPERATIONAL_EVENT_CATEGORIES,
  SYSTEM_EVENT_CATEGORIES,
  SYSTEM_EVENT_LEVELS,
  type SystemEventCategory,
  type SystemEventView,
} from 'thinker-shared';
import type { TenantContext } from '../common/decorators/tenant-context.decorator';

export interface AlertFilters {
  level?: string;
  category?: string;
  unread?: boolean;
  page?: number;
  limit?: number;
}

const MAX_LIMIT = 100;

/** Categories a viewer may see in the active workspace. */
export function workspaceCategories(ctx: Pick<TenantContext, 'role'>): SystemEventCategory[] {
  const admin = ctx.role === 'owner' || ctx.role === 'admin';
  return [...OPERATIONAL_EVENT_CATEGORIES, ...(admin ? ADMIN_EVENT_CATEGORIES : [])];
}

/**
 * WHERE clause of the alerts a context may see: the active workspace's
 * operational events for every member, audit and authentication for owners
 * and admins, and instance events (catalog, and authentication of unknown
 * accounts) for instance administrators.
 * Appends its parameters to `params`.
 */
export function visibilityWhere(
  ctx: Pick<TenantContext, 'tenantId' | 'role' | 'isInstanceAdmin'>,
  params: unknown[],
): string {
  const parts: string[] = [];
  if (ctx.tenantId) {
    params.push(ctx.tenantId, workspaceCategories(ctx));
    parts.push(`(e.tenant_id = $${params.length - 1} AND e.category = ANY($${params.length}))`);
  }
  if (ctx.isInstanceAdmin) {
    // Instance events, plus failed logins for e-mails with no account.
    params.push([...INSTANCE_EVENT_CATEGORIES, 'auth']);
    parts.push(`(e.tenant_id IS NULL AND e.category = ANY($${params.length}))`);
  }
  return parts.length ? `(${parts.join(' OR ')})` : 'false';
}

function filterWhere(filters: AlertFilters, params: unknown[]): string {
  const parts: string[] = [];
  if (filters.level && (SYSTEM_EVENT_LEVELS as readonly string[]).includes(filters.level)) {
    params.push(filters.level);
    parts.push(`e.level = $${params.length}`);
  }
  if (
    filters.category &&
    (SYSTEM_EVENT_CATEGORIES as readonly string[]).includes(filters.category)
  ) {
    params.push(filters.category);
    parts.push(`e.category = $${params.length}`);
  }
  if (filters.unread) parts.push('e.read_at IS NULL');
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

@Injectable()
export class AlertsService {
  constructor(private readonly ds: DataSource) {}

  async list(
    ctx: TenantContext,
    filters: AlertFilters,
  ): Promise<{
    events: SystemEventView[];
    total: number;
    unread: number;
    page: number;
    limit: number;
  }> {
    const limit = Math.min(Math.max(1, Math.floor(filters.limit ?? 25)), MAX_LIMIT);
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const params: unknown[] = [];
    const visible = visibilityWhere(ctx, params);
    const where = `${visible}${filterWhere(filters, params)}`;
    const unreadParams: unknown[] = [];
    const unreadWhere = `${visibilityWhere(ctx, unreadParams)} AND e.read_at IS NULL`;
    const [rows, count, unread] = await Promise.all([
      this.ds.query(
        `SELECT e.*, au.email AS actor_email, ru.email AS read_by_email, ru.name AS read_by_name
           FROM system_events e
           LEFT JOIN "user" au ON au.id = e.actor_user_id
           LEFT JOIN "user" ru ON ru.id = e.read_by_user_id
          WHERE ${where}
          ORDER BY e.created_at DESC
          LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        params,
      ) as Promise<Array<Record<string, unknown>>>,
      this.ds.query(`SELECT count(*)::int AS n FROM system_events e WHERE ${where}`, params),
      this.ds.query(
        `SELECT count(*)::int AS n FROM system_events e WHERE ${unreadWhere}`,
        unreadParams,
      ),
    ]);
    return {
      events: rows.map((r) => this.view(r)),
      total: (count as Array<{ n: number }>)[0]?.n ?? 0,
      unread: (unread as Array<{ n: number }>)[0]?.n ?? 0,
      page,
      limit,
    };
  }

  /** Marks one visible alert as read, for everyone; the first reader wins. */
  async markRead(ctx: TenantContext, id: string): Promise<{ ok: true }> {
    const params: unknown[] = [id];
    const where = visibilityWhere(ctx, params);
    const found = (await this.ds.query(
      `SELECT e.id FROM system_events e WHERE e.id = $1 AND ${where}`,
      params,
    )) as Array<{ id: string }>;
    if (!found[0]) throw new NotFoundException('Alert not found');
    await this.ds.query(
      `UPDATE system_events SET read_at = now(), read_by_user_id = $2
        WHERE id = $1 AND read_at IS NULL`,
      [id, ctx.userId],
    );
    return { ok: true };
  }

  /** Marks every unread alert the user can see (optionally filtered) as read. */
  async markAllRead(ctx: TenantContext, filters: AlertFilters): Promise<{ updated: number }> {
    const params: unknown[] = [ctx.userId];
    const where = `${visibilityWhere(ctx, params)}${filterWhere(filters, params)}`;
    const result = (await this.ds.query(
      `UPDATE system_events e SET read_at = now(), read_by_user_id = $1
        WHERE e.read_at IS NULL AND ${where}`,
      params,
    )) as unknown;
    const updated = Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
    return { updated };
  }

  private view(r: Record<string, unknown>): SystemEventView {
    const metadata =
      typeof r.metadata === 'string'
        ? (JSON.parse(r.metadata) as Record<string, unknown>)
        : ((r.metadata as Record<string, unknown>) ?? {});
    return {
      id: String(r.id),
      tenant_id: (r.tenant_id as string | null) ?? null,
      level: r.level as SystemEventView['level'],
      category: r.category as SystemEventView['category'],
      type: String(r.type),
      title: String(r.title),
      message: String(r.message ?? ''),
      entity_type: (r.entity_type as string | null) ?? null,
      entity_id: (r.entity_id as string | null) ?? null,
      entity_name: (r.entity_name as string | null) ?? null,
      actor_user_id: (r.actor_user_id as string | null) ?? null,
      actor_email: (r.actor_email as string | null) ?? null,
      actor_ip: (r.actor_ip as string | null) ?? null,
      actor_user_agent: (r.actor_user_agent as string | null) ?? null,
      metadata,
      created_at: iso(r.created_at) ?? '',
      read_at: iso(r.read_at),
      read_by_user_id: (r.read_by_user_id as string | null) ?? null,
      read_by_email: (r.read_by_email as string | null) ?? null,
      read_by_name: (r.read_by_name as string | null) ?? null,
    };
  }
}
