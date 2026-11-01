import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  HARNESS_TRIGGER_EVENTS,
  TRIGGER_EVENT_STATUSES,
  TRIGGER_EVENT_TYPES,
  type TriggerEventType,
  type TriggerType,
} from 'thinker-shared';
import { encrypt, getEncryptionSecret } from '../common/utils/crypto.util';
import { validatePublicUrl } from '../common/utils/url-validation';
import type { TenantContext } from '../common/decorators/tenant-context.decorator';
import { TenantCacheService } from '../common/services/tenant-cache.service';
import {
  normalizeTrigger,
  publicView,
  type NormalizedTrigger,
  type TriggerConfig,
  type TriggerInput,
} from './trigger-config';
import { TriggerDispatchService } from './trigger-dispatch.service';
import { TriggerWorkerService, decryptSecrets } from './trigger-worker.service';

export interface TriggerTestInput {
  event_type?: unknown;
  vars?: unknown;
}

/** Variables the gateway always computes itself; a simulated test cannot set them. */
const COMPUTED_TEST_VARS = new Set([
  'event.id',
  'event.type',
  'event.json',
  'trigger.name',
  'delivery.attempt',
  'workspace.id',
]);
const MAX_TEST_VARS = 100;
const MAX_TEST_VALUE = 4000;

/** Validates the simulated event of a test: its type and the variable values to use. */
export function parseTestInput(input: TriggerTestInput): {
  eventType: TriggerEventType;
  vars: Record<string, string>;
} {
  const eventType = input.event_type ?? 'test';
  if (
    typeof eventType !== 'string' ||
    !(TRIGGER_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    throw new BadRequestException(`event_type must be one of: ${TRIGGER_EVENT_TYPES.join(', ')}`);
  }
  const vars: Record<string, string> = {};
  if (input.vars !== undefined && input.vars !== null) {
    if (typeof input.vars !== 'object' || Array.isArray(input.vars)) {
      throw new BadRequestException('vars must be an object of strings');
    }
    const entries = Object.entries(input.vars as Record<string, unknown>);
    if (entries.length > MAX_TEST_VARS) {
      throw new BadRequestException(`vars accepts at most ${MAX_TEST_VARS} variables`);
    }
    for (const [name, value] of entries) {
      if (!/^[a-z][a-z0-9_.]{0,63}$/.test(name)) {
        throw new BadRequestException(`Invalid variable name "${name}"`);
      }
      if (typeof value !== 'string' || value.length > MAX_TEST_VALUE) {
        throw new BadRequestException(
          `vars.${name} must be a string of at most ${MAX_TEST_VALUE} characters`,
        );
      }
      if (!COMPUTED_TEST_VARS.has(name)) vars[name] = value;
    }
  }
  return { eventType: eventType as TriggerEventType, vars };
}

interface TriggerRow {
  id: string;
  name: string;
  type: TriggerType;
  enabled: boolean;
  config: TriggerConfig | string;
  secrets_encrypted: string | null;
  max_retries: number;
  retry_delay_seconds: number;
  timeout_seconds: number;
  workspace_events: string[] | string;
  harness_count?: number;
  created_at: string;
  updated_at: string;
}

const EVENT_COLUMNS = `e.id, e.trigger_id, e.trigger_name, e.trigger_type, e.event_type, e.agent_name,
  e.status, e.attempts, e.next_attempt_at, e.last_error, e.created_at, e.delivered_at`;

function json<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function toNormalized(row: TriggerRow): NormalizedTrigger {
  return {
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    config: json(row.config),
    secrets: decryptSecrets(row.secrets_encrypted),
    max_retries: row.max_retries,
    retry_delay_seconds: row.retry_delay_seconds,
    timeout_seconds: row.timeout_seconds,
    workspace_events: json(row.workspace_events),
  };
}

function view(row: TriggerRow) {
  const normalized = toNormalized(row);
  const pub = publicView(normalized.config, normalized.secrets, row.type);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    config: pub.config,
    secrets: pub.secrets,
    max_retries: row.max_retries,
    retry_delay_seconds: row.retry_delay_seconds,
    timeout_seconds: row.timeout_seconds,
    workspace_events: normalized.workspace_events,
    harness_count: Number(row.harness_count ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function unwrap<T>(result: unknown): T[] {
  return (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];
}

@Injectable()
export class TriggersService {
  constructor(
    private readonly ds: DataSource,
    private readonly tenantCache: TenantCacheService,
    private readonly dispatch: TriggerDispatchService,
    private readonly worker: TriggerWorkerService,
  ) {}

  private async rows(tenantId: string, id?: string): Promise<TriggerRow[]> {
    return (await this.ds.query(
      `SELECT t.*, (SELECT COUNT(*) FROM agent_triggers at
                     JOIN agents a ON a.id = at.agent_id AND a.deleted_at IS NULL
                    WHERE at.trigger_id = t.id)::int AS harness_count
         FROM triggers t
        WHERE t.tenant_id = $1 ${id ? 'AND t.id = $2' : ''}
        ORDER BY LOWER(t.name)`,
      id ? [tenantId, id] : [tenantId],
    )) as TriggerRow[];
  }

  private async row(tenantId: string | null, id: string): Promise<TriggerRow> {
    const found = tenantId ? (await this.rows(tenantId, id))[0] : undefined;
    if (!found) throw new NotFoundException('Trigger not found');
    return found;
  }

  async list(tenantId: string | null) {
    if (!tenantId) return { triggers: [] };
    return { triggers: (await this.rows(tenantId)).map(view) };
  }

  private async assertUniqueName(tenantId: string, name: string, exceptId?: string) {
    const rows = (await this.ds.query(
      `SELECT id FROM triggers WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)`,
      [tenantId, name],
    )) as Array<{ id: string }>;
    if (rows.some((r) => r.id !== exceptId)) {
      throw new BadRequestException([`A trigger named "${name}" already exists`]);
    }
  }

  private encryptSecrets(normalized: NormalizedTrigger): string | null {
    const secrets = normalized.secrets;
    const empty =
      !secrets.apiKey &&
      !secrets.botToken &&
      !secrets.hmacSecret &&
      Object.keys(secrets.headers ?? {}).length === 0;
    return empty ? null : encrypt(JSON.stringify(secrets), getEncryptionSecret());
  }

  /**
   * Webhook destinations follow the provider private-URL policy: without it
   * the URL must be an https address on the public internet. Metadata
   * endpoints are refused again at delivery time (ssrfSafeFetch).
   */
  private async assertWebhookDestination(t: NormalizedTrigger, allowPrivate: boolean) {
    if (t.type !== 'webhook' || allowPrivate) return;
    try {
      await validatePublicUrl(String(t.config.url ?? ''));
    } catch (err) {
      throw new BadRequestException([`config.url: ${(err as Error).message}`]);
    }
  }

  async create(ctx: TenantContext, input: TriggerInput, allowPrivate = false) {
    let tenantId = ctx.tenantId;
    if (!tenantId) {
      if (!ctx.userId) throw new NotFoundException('Tenant not found');
      tenantId = await this.tenantCache.ensureForUser(ctx.userId);
    }
    const result = normalizeTrigger(input);
    if ('errors' in result) throw new BadRequestException(result.errors);
    const t = result.value;
    await this.assertWebhookDestination(t, allowPrivate);
    await this.assertUniqueName(tenantId, t.name);
    const id = randomUUID();
    await this.ds.query(
      `INSERT INTO triggers
         (id, tenant_id, name, type, enabled, config, secrets_encrypted, max_retries,
          retry_delay_seconds, timeout_seconds, workspace_events, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12)`,
      [
        id,
        tenantId,
        t.name,
        t.type,
        t.enabled,
        JSON.stringify(t.config),
        this.encryptSecrets(t),
        t.max_retries,
        t.retry_delay_seconds,
        t.timeout_seconds,
        JSON.stringify(t.workspace_events),
        ctx.userId,
      ],
    );
    return view(await this.row(tenantId, id));
  }

  async update(tenantId: string | null, id: string, input: TriggerInput, allowPrivate = false) {
    const existing = await this.row(tenantId, id);
    if (input.type !== undefined && input.type !== existing.type) {
      throw new BadRequestException(['type cannot be changed']);
    }
    const result = normalizeTrigger(input, toNormalized(existing));
    if ('errors' in result) throw new BadRequestException(result.errors);
    const t = result.value;
    await this.assertWebhookDestination(t, allowPrivate);
    await this.assertUniqueName(tenantId!, t.name, id);
    await this.ds.query(
      `UPDATE triggers
          SET name = $3, enabled = $4, config = $5::jsonb, secrets_encrypted = $6,
              max_retries = $7, retry_delay_seconds = $8, timeout_seconds = $9,
              workspace_events = $10::jsonb, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [
        id,
        tenantId,
        t.name,
        t.enabled,
        JSON.stringify(t.config),
        this.encryptSecrets(t),
        t.max_retries,
        t.retry_delay_seconds,
        t.timeout_seconds,
        JSON.stringify(t.workspace_events),
      ],
    );
    this.dispatch.invalidateBindings();
    return view(await this.row(tenantId, id));
  }

  async remove(tenantId: string | null, id: string) {
    await this.row(tenantId, id);
    // Bindings cascade; queued rows keep their trigger_name snapshot and fail
    // on their next attempt with "Trigger was deleted".
    await this.ds.query(`DELETE FROM triggers WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    this.dispatch.invalidateBindings();
    return { deleted: true };
  }

  async userEmail(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const rows = (await this.ds.query(`SELECT email FROM "user" WHERE id = $1`, [
      userId,
    ])) as Array<{
      email: string | null;
    }>;
    return rows[0]?.email ?? null;
  }

  async test(
    tenantId: string | null,
    id: string,
    userId: string | null,
    input: TriggerTestInput = {},
  ) {
    const trigger = await this.row(tenantId, id);
    const actorEmail = await this.userEmail(userId);
    const { eventType, vars } = parseTestInput(input);
    const { 'event.title': title, 'event.message': message, ...rest } = vars;
    const [eventId] = await this.dispatch.emit({
      tenantId: tenantId!,
      eventType,
      triggerId: trigger.id,
      title: title ?? `Test from trigger ${trigger.name}`,
      message:
        message ??
        `This is a test event sent from Thinker${actorEmail ? ` by ${actorEmail}` : ''}.`,
      vars: { ...(actorEmail ? { 'actor.email': actorEmail } : {}), ...rest },
    });
    const started = Date.now();
    const result = eventId ? await this.worker.deliverNow(eventId, tenantId!) : null;
    if (!result) {
      return {
        success: false,
        status_code: null,
        error: 'The trigger has too many pending deliveries',
        response: null,
        duration_ms: 0,
      };
    }
    return {
      success: result.success,
      status_code: result.statusCode,
      error: result.error,
      response: result.response,
      duration_ms: Date.now() - started,
    };
  }

  private async agentId(tenantId: string | null, agentName: string): Promise<string> {
    const rows = tenantId
      ? ((await this.ds.query(
          `SELECT id FROM agents WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
          [tenantId, agentName],
        )) as Array<{ id: string }>)
      : [];
    if (!rows[0]) throw new NotFoundException(`Agent "${agentName}" not found`);
    return rows[0].id;
  }

  async getBindings(tenantId: string | null, agentName: string) {
    const agentId = await this.agentId(tenantId, agentName);
    const rows = (await this.ds.query(
      `SELECT trigger_id, events FROM agent_triggers WHERE agent_id = $1 ORDER BY created_at`,
      [agentId],
    )) as Array<{ trigger_id: string; events: string[] | string }>;
    return { bindings: rows.map((r) => ({ trigger_id: r.trigger_id, events: json(r.events) })) };
  }

  async setBindings(tenantId: string | null, agentName: string, body: unknown) {
    const agentId = await this.agentId(tenantId, agentName);
    const list = (body as { bindings?: unknown })?.bindings;
    if (!Array.isArray(list)) throw new BadRequestException(['bindings must be a list']);
    const bindings: Array<{ trigger_id: string; events: string[] }> = [];
    for (const entry of list as Array<Record<string, unknown>>) {
      const triggerId = typeof entry?.trigger_id === 'string' ? entry.trigger_id : '';
      const events = entry?.events;
      if (
        !triggerId ||
        !Array.isArray(events) ||
        events.some((e) => !(HARNESS_TRIGGER_EVENTS as readonly unknown[]).includes(e))
      ) {
        throw new BadRequestException([
          `each binding needs a trigger_id and events from ${HARNESS_TRIGGER_EVENTS.join(', ')}`,
        ]);
      }
      if (!bindings.some((b) => b.trigger_id === triggerId)) {
        bindings.push({ trigger_id: triggerId, events: [...new Set(events as string[])] });
      }
    }
    if (bindings.length > 0) {
      const known = (await this.ds.query(
        `SELECT id FROM triggers WHERE tenant_id = $1 AND id = ANY($2::varchar[])`,
        [tenantId, bindings.map((b) => b.trigger_id)],
      )) as Array<{ id: string }>;
      if (known.length !== bindings.length) throw new BadRequestException(['unknown trigger']);
    }
    await this.ds.transaction(async (manager) => {
      await manager.query(`DELETE FROM agent_triggers WHERE agent_id = $1`, [agentId]);
      for (const b of bindings) {
        await manager.query(
          `INSERT INTO agent_triggers (agent_id, trigger_id, tenant_id, events) VALUES ($1, $2, $3, $4::jsonb)`,
          [agentId, b.trigger_id, tenantId, JSON.stringify(b.events)],
        );
      }
    });
    this.dispatch.invalidateBindings(agentId);
    return { bindings };
  }

  async listEvents(
    tenantId: string | null,
    q: {
      trigger_id?: string;
      status?: string;
      event_type?: string;
      agent_name?: string;
      before?: string;
      limit?: string;
    },
  ) {
    if (!tenantId) return { events: [] };
    const where = ['e.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.trigger_id) add('e.trigger_id = ?', q.trigger_id);
    if (q.status && (TRIGGER_EVENT_STATUSES as readonly string[]).includes(q.status)) {
      add('e.status = ?', q.status);
    }
    if (q.event_type && (TRIGGER_EVENT_TYPES as readonly string[]).includes(q.event_type)) {
      add('e.event_type = ?', q.event_type);
    }
    if (q.agent_name) add('e.agent_name = ?', q.agent_name);
    if (q.before && !Number.isNaN(Date.parse(q.before))) add('e.created_at < ?', q.before);
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const events = await this.ds.query(
      `SELECT ${EVENT_COLUMNS} FROM trigger_events e
        WHERE ${where.join(' AND ')}
        ORDER BY e.created_at DESC
        LIMIT ${limit}`,
      params,
    );
    return { events };
  }

  async getEvent(tenantId: string | null, id: string) {
    const rows = tenantId
      ? ((await this.ds.query(
          `SELECT ${EVENT_COLUMNS}, e.payload FROM trigger_events e WHERE e.id = $1 AND e.tenant_id = $2`,
          [id, tenantId],
        )) as Array<Record<string, unknown>>)
      : [];
    if (!rows[0]) throw new NotFoundException('Event not found');
    const logs = await this.ds.query(
      `SELECT id, attempt, started_at, duration_ms, success, status_code, error, response,
              egress, egress_hops
         FROM trigger_event_logs WHERE event_id = $1 ORDER BY attempt, started_at`,
      [id],
    );
    return { event: { ...rows[0], payload: json(rows[0].payload as string) }, logs };
  }

  async retryEvent(tenantId: string | null, id: string) {
    const updated = unwrap<{ id: string }>(
      await this.ds.query(
        `UPDATE trigger_events
            SET status = 'pending', next_attempt_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2 AND status = 'failed' AND trigger_id IS NOT NULL
          RETURNING id`,
        [id, tenantId],
      ),
    );
    if (!updated?.length)
      throw new BadRequestException(['Only failed events of an existing trigger can be retried']);
    this.worker.kick();
    return { ok: true };
  }
}
