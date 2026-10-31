import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { HARNESS_TRIGGER_EVENTS, type TriggerEventType } from 'thinker-shared';
import { ThinkerRuntimeService } from '../common/services/thinker-runtime.service';
import type { TemplateVars } from './trigger-template';

/** Pending deliveries a single trigger may hold before new events are dropped. */
export const MAX_PENDING_PER_TRIGGER = 1000;
const BINDING_TTL_MS = 30_000;
const DROP_WARN_INTERVAL_MS = 60_000;

interface Binding {
  triggerId: string;
  events: string[];
}

export interface EmitInput {
  tenantId: string;
  eventType: TriggerEventType;
  agentId?: string | null;
  agentName?: string | null;
  /** Harness display name when the agent row may be gone (harness.deleted). */
  displayName?: string | null;
  title: string;
  message: string;
  vars?: TemplateVars;
  /** Restrict to one trigger (the test button). */
  triggerId?: string;
}

/**
 * Turns an event into queue rows, one per subscribed trigger. Harness events
 * go to the triggers bound to that harness for that event; workspace events
 * to the triggers that subscribed to them on the trigger itself.
 */
@Injectable()
export class TriggerDispatchService {
  private readonly logger = new Logger(TriggerDispatchService.name);
  private readonly bindings = new Map<string, { at: number; list: Binding[] }>();
  private readonly dropped = new Map<string, { count: number; warnedAt: number }>();
  private onQueued: (() => void) | null = null;

  constructor(
    private readonly ds: DataSource,
    private readonly runtime: ThinkerRuntimeService,
  ) {}

  /** The worker registers itself so new rows are delivered without waiting for the poll. */
  setQueuedListener(listener: () => void): void {
    this.onQueued = listener;
  }

  invalidateBindings(agentId?: string): void {
    if (agentId) this.bindings.delete(agentId);
    else this.bindings.clear();
  }

  private async bindingsFor(agentId: string): Promise<Binding[]> {
    const cached = this.bindings.get(agentId);
    if (cached && Date.now() - cached.at < BINDING_TTL_MS) return cached.list;
    const rows = (await this.ds.query(
      `SELECT at.trigger_id, at.events
         FROM agent_triggers at
         JOIN triggers t ON t.id = at.trigger_id
        WHERE at.agent_id = $1 AND t.enabled = true`,
      [agentId],
    )) as Array<{ trigger_id: string; events: string[] | string }>;
    const list = rows.map((r) => ({
      triggerId: r.trigger_id,
      events: typeof r.events === 'string' ? (JSON.parse(r.events) as string[]) : r.events,
    }));
    this.bindings.set(agentId, { at: Date.now(), list });
    if (this.bindings.size > 5000) this.bindings.clear();
    return list;
  }

  /** Cheap check for the hot path: does this harness route the event anywhere? */
  async isSubscribed(agentId: string, eventType: TriggerEventType): Promise<boolean> {
    const list = await this.bindingsFor(agentId);
    return list.some((b) => b.events.includes(eventType));
  }

  harnessUrl(agentName: string): string {
    return `${this.runtime.getAuthBaseUrl()}/harnesses/${encodeURIComponent(agentName)}`;
  }

  requestUrl(requestId: string): string {
    return `${this.runtime.getAuthBaseUrl()}/requests/${encodeURIComponent(requestId)}`;
  }

  /** Queues the event; returns the created queue row ids. */
  async emit(input: EmitInput): Promise<string[]> {
    const targets = await this.targets(input);
    if (targets.length === 0) return [];

    const meta = (await this.ds.query(
      `SELECT t.id, COALESCE(t.organization_name, t.name) AS workspace_name,
              a.display_name, a.name AS agent_name
         FROM tenants t
         LEFT JOIN agents a ON a.id = $2 AND a.tenant_id = t.id
        WHERE t.id = $1`,
      [input.tenantId, input.agentId ?? null],
    )) as Array<{
      workspace_name: string | null;
      display_name: string | null;
      agent_name: string | null;
    }>;
    const agentName = input.agentName ?? meta[0]?.agent_name ?? null;

    const vars: TemplateVars = {
      'event.id': randomUUID(),
      'event.type': input.eventType,
      'event.timestamp': new Date().toISOString(),
      'event.title': input.title,
      'event.message': input.message,
      'workspace.id': input.tenantId,
      'workspace.name': meta[0]?.workspace_name ?? '',
      'harness.id': input.agentId ?? '',
      'harness.name': agentName ?? '',
      'harness.display_name': input.displayName ?? meta[0]?.display_name ?? agentName ?? '',
      'harness.url': agentName ? this.harnessUrl(agentName) : '',
      ...(input.vars ?? {}),
    };

    const ids: string[] = [];
    for (const target of targets) {
      if (target.pending >= MAX_PENDING_PER_TRIGGER) {
        this.noteDrop(target.id, target.name);
        continue;
      }
      const id = randomUUID();
      await this.ds.query(
        `INSERT INTO trigger_events
           (id, tenant_id, trigger_id, trigger_name, trigger_type, agent_id, agent_name, event_type, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          id,
          input.tenantId,
          target.id,
          target.name,
          target.type,
          input.agentId ?? null,
          agentName,
          input.eventType,
          JSON.stringify(vars),
        ],
      );
      ids.push(id);
    }
    // The test button delivers its own row synchronously.
    if (ids.length > 0 && !input.triggerId) this.onQueued?.();
    return ids;
  }

  private async targets(
    input: EmitInput,
  ): Promise<Array<{ id: string; name: string; type: string; pending: number }>> {
    let triggerIds: string[];
    if (input.triggerId) {
      triggerIds = [input.triggerId];
    } else if ((HARNESS_TRIGGER_EVENTS as readonly string[]).includes(input.eventType)) {
      if (!input.agentId) return [];
      triggerIds = (await this.bindingsFor(input.agentId))
        .filter((b) => b.events.includes(input.eventType))
        .map((b) => b.triggerId);
    } else {
      const rows = (await this.ds.query(
        `SELECT id FROM triggers
          WHERE tenant_id = $1 AND enabled = true AND workspace_events ? $2`,
        [input.tenantId, input.eventType],
      )) as Array<{ id: string }>;
      triggerIds = rows.map((r) => r.id);
    }
    if (triggerIds.length === 0) return [];
    const rows = (await this.ds.query(
      `SELECT t.id, t.name, t.type,
              (SELECT COUNT(*) FROM trigger_events e
                WHERE e.trigger_id = t.id AND e.status IN ('pending', 'delivering'))::int AS pending
         FROM triggers t
        WHERE t.tenant_id = $1 AND t.id = ANY($2::varchar[])
          ${input.triggerId ? '' : 'AND t.enabled = true'}`,
      [input.tenantId, triggerIds],
    )) as Array<{ id: string; name: string; type: string; pending: number }>;
    return rows;
  }

  private noteDrop(triggerId: string, name: string): void {
    const now = Date.now();
    const entry = this.dropped.get(triggerId) ?? { count: 0, warnedAt: 0 };
    entry.count++;
    if (now - entry.warnedAt >= DROP_WARN_INTERVAL_MS) {
      this.logger.warn(
        `Trigger "${name}" (${triggerId}) has ${MAX_PENDING_PER_TRIGGER} pending deliveries; dropped ${entry.count} new event(s)`,
      );
      entry.count = 0;
      entry.warnedAt = now;
    }
    this.dropped.set(triggerId, entry);
  }
}
