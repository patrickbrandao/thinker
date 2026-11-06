import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { from, Observable, switchMap, tap } from 'rxjs';
import type { Request } from 'express';
import { SystemEventsService } from '../common/services/system-events.service';
import { clientIpInfo } from '../common/utils/client-ip';
import type { RequestWithTenantContext } from '../common/decorators/tenant-context.decorator';
import { AUDIT_KEY, type AuditSpec } from './audit.decorator';

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

/** Field names of a body (top level only); values are never read. */
export function auditFields(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body as Record<string, unknown>)
    .filter((k) => k.length <= 64)
    .slice(0, 50);
}

/** A display name from a handler result (or the request body). */
export function nameFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  for (const key of ['display_name', 'displayName', 'name', 'label', 'email', 'agent_name']) {
    if (typeof v[key] === 'string' && v[key]) return v[key] as string;
  }
  for (const nested of ['agent', 'trigger', 'connection', 'user', 'provider', 'profile']) {
    const inner = v[nested];
    if (inner && typeof inner === 'object') {
      const found = nameFrom(inner);
      if (found) return found;
    }
  }
  return null;
}

function idFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id === 'string' || typeof v.id === 'number') return String(v.id);
  for (const nested of ['agent', 'trigger', 'connection', 'user', 'profile']) {
    const inner = v[nested] as Record<string, unknown> | undefined;
    if (inner && (typeof inner.id === 'string' || typeof inner.id === 'number'))
      return String(inner.id);
  }
  return null;
}

/**
 * Records `audit.<action>` for handlers marked with `@Audit`, after they
 * succeed. Runs off the response: the insert is fire-and-forget.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly alerts: SystemEventsService,
    private readonly ds: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<AuditSpec | undefined>(AUDIT_KEY, context.getHandler());
    if (!spec || context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & RequestWithTenantContext>();
    const params = (req.params ?? {}) as Record<string, string>;
    const id = params[spec.idParam ?? 'id'] ?? null;
    const before =
      spec.lookup && id && spec.action !== 'created'
        ? this.lookupName(spec, id, req.tenantContext?.tenantId ?? null)
        : Promise.resolve(null);
    return from(before).pipe(
      switchMap((previousName) =>
        next.handle().pipe(
          tap((result) => {
            try {
              this.record(spec, req, params, id, previousName, result);
            } catch (err) {
              this.logger.warn(`Audit failed: ${err instanceof Error ? err.message : err}`);
            }
          }),
        ),
      ),
    );
  }

  private async lookupName(spec: AuditSpec, id: string, tenantId: string | null) {
    const l = spec.lookup!;
    const idColumn = l.idColumn ?? 'id';
    if (![l.table, l.nameColumn, idColumn].every((x) => SAFE_IDENT.test(x))) return null;
    const scoped = l.tenantScoped !== false && tenantId;
    try {
      const rows = (await this.ds.query(
        `SELECT "${l.nameColumn}" AS name FROM "${l.table}" WHERE "${idColumn}" = $1${scoped ? ' AND tenant_id = $2' : ''} LIMIT 1`,
        scoped ? [id, tenantId] : [id],
      )) as Array<{ name: string | null }>;
      return rows[0]?.name ?? null;
    } catch {
      return null;
    }
  }

  private record(
    spec: AuditSpec,
    req: Request & RequestWithTenantContext,
    params: Record<string, string>,
    id: string | null,
    previousName: string | null,
    result: unknown,
  ): void {
    const ctx = req.tenantContext;
    if (!ctx?.tenantId && !ctx?.userId) return;
    const fields = spec.action === 'deleted' ? [] : auditFields(req.body);
    const fromParams = (spec.nameParams ?? [])
      .map((p) => params[p])
      .filter(Boolean)
      .join(' / ');
    const entityName =
      previousName ?? nameFrom(result) ?? nameFrom(req.body) ?? (fromParams || null);
    const entityId = id ?? idFrom(result) ?? (fromParams || null);
    const verb = { created: 'created', updated: 'updated', deleted: 'deleted' }[spec.action];
    const shown = entityName ?? entityId ?? spec.entity;
    const ua = req.headers['user-agent'];
    const input = {
      level: spec.action === 'deleted' ? 'warning' : 'info',
      type: `audit.${spec.action}`,
      title: `${capitalize(spec.entity)} ${shown} ${verb}`,
      message: fields.length ? `Fields: ${fields.join(', ')}` : '',
      entityType: spec.entity,
      entityId,
      entityName,
      actorUserId: ctx.userId ?? null,
      actorIp: clientIpInfo(req).clientIp,
      actorUserAgent: typeof ua === 'string' ? ua : null,
      metadata: { fields, method: req.method, path: req.route?.path ?? null },
      vars: { 'audit.fields': fields.join(', ') },
    } as const;
    if (ctx.tenantId) {
      this.alerts.record({ ...input, tenantId: ctx.tenantId });
      return;
    }
    // A first mutation creates the user's workspace: record into the
    // workspaces they belong to now.
    void this.alerts
      .writeForUser({ userId: ctx.userId }, input)
      .catch((err) =>
        this.logger.warn(`Audit failed: ${err instanceof Error ? err.message : err}`),
      );
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, ' ');
}
