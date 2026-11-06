import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ALERTS_RETENTION_DAYS,
  SYSTEM_EVENT_CATEGORY,
  WORKSPACE_TRIGGER_EVENTS,
  type SystemEventLevel,
  type SystemEventType,
} from 'thinker-shared';
import { TriggerSignalService } from './trigger-signal.service';
import { setAlertSink, setUserAlertSink, type UserRef } from './alert-sink';

export interface SystemEventInput {
  /** NULL: an instance event (catalog). */
  tenantId: string | null;
  level: SystemEventLevel;
  type: SystemEventType;
  title: string;
  message?: string;
  entityType?: string | null;
  entityId?: string | null;
  entityName?: string | null;
  actorUserId?: string | null;
  actorIp?: string | null;
  actorUserAgent?: string | null;
  metadata?: Record<string, unknown>;
  /** Same key within `dedupeWindowMs` is dropped (or counted, with `aggregate`). */
  dedupeKey?: string;
  dedupeWindowMs?: number;
  /** Repeats inside the window add to `metadata.count` of the first row instead of dropping. */
  aggregate?: boolean;
  /** Trigger that must not receive this event (a trigger never hears about its own failure). */
  excludeTriggerId?: string | null;
  /** Extra trigger template variables. */
  vars?: Record<string, string>;
}

const MAX_DEDUPE_KEYS = 10_000;

export function alertsRetentionDays(env = process.env): number {
  const raw = Number(env['THINKER_ALERTS_RETENTION_DAYS']);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_ALERTS_RETENTION_DAYS;
}

/**
 * Records alerts (`system_events`). `record` never blocks or throws: the
 * insert runs in the background and its errors are only logged. Workspace
 * events that are also trigger events are handed to the triggers module as a
 * `system` signal.
 */
@Injectable()
export class SystemEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemEventsService.name);
  private readonly recent = new Map<string, { at: number; id: string | null }>();

  constructor(
    private readonly ds: DataSource,
    private readonly signals: TriggerSignalService,
  ) {}

  onModuleInit(): void {
    setAlertSink((input) => this.record(input));
    setUserAlertSink((user, input) => {
      void this.writeForUser(user, input).catch((err) =>
        this.logger.warn(
          `Could not record ${input.type}: ${err instanceof Error ? err.message : err}`,
        ),
      );
    });
  }

  onModuleDestroy(): void {
    setAlertSink(null);
    setUserAlertSink(null);
  }

  /**
   * An authentication event lands in every workspace the user belongs to; an
   * unknown user (a failed login for an e-mail with no account) becomes an
   * instance event, seen by instance administrators.
   */
  async writeForUser(user: UserRef, input: Omit<SystemEventInput, 'tenantId'>): Promise<void> {
    let userId = user.userId ?? null;
    if (!userId && user.email) {
      const rows = (await this.ds.query(`SELECT id FROM "user" WHERE lower(email) = lower($1)`, [
        user.email,
      ])) as Array<{ id: string }>;
      userId = rows[0]?.id ?? null;
    }
    const tenants = userId
      ? ((await this.ds.query(
          `SELECT DISTINCT tenant_id FROM organization_members WHERE user_id = $1`,
          [userId],
        )) as Array<{ tenant_id: string }>)
      : [];
    const base = { ...input, actorUserId: input.actorUserId ?? userId };
    if (tenants.length === 0) {
      await this.write({ ...base, tenantId: null });
      return;
    }
    for (const t of tenants) {
      await this.write({
        ...base,
        tenantId: t.tenant_id,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${t.tenant_id}` : undefined,
      });
    }
  }

  record(input: SystemEventInput): void {
    void this.write(input).catch((err) =>
      this.logger.warn(
        `Could not record ${input.type}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  /** Same as `record`, awaited (tests and callers that already run off the request path). */
  async write(input: SystemEventInput): Promise<string | null> {
    const now = Date.now();
    if (input.dedupeKey) {
      const seen = this.recent.get(input.dedupeKey);
      if (seen && now - seen.at < (input.dedupeWindowMs ?? 0)) {
        if (input.aggregate && seen.id) {
          await this.ds.query(
            `UPDATE system_events
                SET metadata = jsonb_set(metadata, '{count}',
                      to_jsonb(COALESCE((metadata->>'count')::int, 1) + 1)),
                    message = $2
              WHERE id = $1`,
            [seen.id, input.message ?? ''],
          );
        }
        return null;
      }
    }
    const id = randomUUID();
    if (input.dedupeKey) {
      this.recent.set(input.dedupeKey, { at: now, id });
      if (this.recent.size > MAX_DEDUPE_KEYS) {
        const first = this.recent.keys().next().value;
        if (first !== undefined) this.recent.delete(first);
      }
    }
    const metadata = { ...(input.metadata ?? {}), ...(input.aggregate ? { count: 1 } : {}) };
    await this.ds.query(
      `INSERT INTO system_events
         (id, tenant_id, level, category, type, title, message, entity_type, entity_id,
          entity_name, actor_user_id, actor_ip, actor_user_agent, metadata, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)`,
      [
        id,
        input.tenantId,
        input.level,
        SYSTEM_EVENT_CATEGORY[input.type],
        input.type,
        input.title.slice(0, 300),
        input.message ?? '',
        input.entityType ?? null,
        input.entityId ? String(input.entityId).slice(0, 255) : null,
        input.entityName ? input.entityName.slice(0, 300) : null,
        input.actorUserId ?? null,
        input.actorIp ? input.actorIp.slice(0, 64) : null,
        input.actorUserAgent ? input.actorUserAgent.slice(0, 500) : null,
        JSON.stringify(metadata),
        input.dedupeKey ? input.dedupeKey.slice(0, 500) : null,
      ],
    );
    if (input.tenantId && (WORKSPACE_TRIGGER_EVENTS as readonly string[]).includes(input.type)) {
      this.signals.emit({
        kind: 'system',
        tenantId: input.tenantId,
        eventId: id,
        type: input.type,
        level: input.level,
        title: input.title,
        message: input.message ?? '',
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        entityName: input.entityName ?? null,
        actorUserId: input.actorUserId ?? null,
        actorIp: input.actorIp ?? null,
        excludeTriggerId: input.excludeTriggerId ?? null,
        vars: input.vars ?? {},
      });
    }
    return id;
  }

  /** Daily cleanup past `THINKER_ALERTS_RETENTION_DAYS` (default 90). */
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { name: 'alerts-retention' })
  async purge(): Promise<void> {
    try {
      await this.ds.query(
        `DELETE FROM system_events WHERE created_at < now() - make_interval(days => $1)`,
        [alertsRetentionDays()],
      );
    } catch (err) {
      this.logger.warn(`Alerts cleanup failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
