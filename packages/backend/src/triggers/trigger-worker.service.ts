import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import type { TriggerType } from 'thinker-shared';
import { decryptWithAny, getDecryptionSecrets } from '../common/utils/crypto.util';
import { deliver, type DeliveryResult } from './trigger-senders';
import { TriggerDispatchService } from './trigger-dispatch.service';
import type { TriggerConfig, TriggerSecrets } from './trigger-config';
import type { TemplateVars } from './trigger-template';

const POLL_MS = 10_000;
const BATCH = 50;
const CONCURRENCY = 10;
/** A row left in `delivering` this long belonged to a replica that died mid-send. */
const STALE_DELIVERING = `INTERVAL '5 minutes'`;

interface QueueRow {
  id: string;
  tenant_id: string;
  trigger_id: string | null;
  event_type: string;
  payload: TemplateVars | string;
  attempts: number;
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
}

export function decryptSecrets(stored: string | null): TriggerSecrets {
  if (!stored) return {};
  return JSON.parse(decryptWithAny(stored, getDecryptionSecrets()).plaintext) as TriggerSecrets;
}

function parseJson<T>(value: T | string): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

/**
 * Delivers queued trigger events. Rows are claimed with SKIP LOCKED, so any
 * number of replicas can poll the same table. Every failure is retried until
 * the trigger's max_retries runs out, with a fixed delay between attempts.
 */
@Injectable()
export class TriggerWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TriggerWorkerService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private kickTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private rerun = false;
  private readonly defaultFrom: string;

  constructor(
    private readonly ds: DataSource,
    private readonly dispatch: TriggerDispatchService,
    config: ConfigService,
  ) {
    this.defaultFrom =
      config.get<string>('app.emailFrom') ||
      config.get<string>('app.notificationFromEmail', 'noreply@thinker.example.com');
  }

  onApplicationBootstrap(): void {
    this.dispatch.setQueuedListener(() => this.kick());
    this.timer = setInterval(() => void this.run(), POLL_MS);
    this.timer.unref?.();
    this.kick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
  }

  /** Runs the queue soon, coalescing bursts of new events. */
  kick(): void {
    if (this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = undefined;
      void this.run();
    }, 250);
    this.kickTimer.unref?.();
  }

  async run(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        const rows = await this.claim();
        for (let i = 0; i < rows.length; i += CONCURRENCY) {
          await Promise.all(rows.slice(i, i + CONCURRENCY).map((row) => this.process(row)));
        }
        if (rows.length === BATCH) this.rerun = true;
      } while (this.rerun);
    } catch (err) {
      this.logger.error(`Trigger queue run failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<QueueRow[]> {
    const result = (await this.ds.query(
      `UPDATE trigger_events SET status = 'delivering', updated_at = NOW()
        WHERE id IN (
          SELECT id FROM trigger_events
           WHERE (status = 'pending' AND next_attempt_at <= NOW())
              OR (status = 'delivering' AND updated_at < NOW() - ${STALE_DELIVERING})
           ORDER BY next_attempt_at
           LIMIT ${BATCH}
           FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id, trigger_id, event_type, payload, attempts`,
    )) as unknown;
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    return (rows ?? []) as QueueRow[];
  }

  /** One attempt for a claimed row; records the log and the next state. */
  async process(row: QueueRow): Promise<DeliveryResult> {
    const attempt = row.attempts + 1;
    const startedAt = new Date();
    const trigger = row.trigger_id
      ? (
          (await this.ds.query(
            `SELECT id, name, type, enabled, config, secrets_encrypted, max_retries,
                  retry_delay_seconds, timeout_seconds
             FROM triggers WHERE id = $1 AND tenant_id = $2`,
            [row.trigger_id, row.tenant_id],
          )) as TriggerRow[]
        )[0]
      : undefined;

    let result: DeliveryResult;
    let final = false;
    if (!trigger) {
      result = { success: false, statusCode: null, error: 'Trigger was deleted', response: null };
      final = true;
    } else if (!trigger.enabled && row.event_type !== 'test') {
      result = { success: false, statusCode: null, error: 'Trigger is disabled', response: null };
      final = true;
    } else {
      try {
        const vars: TemplateVars = {
          ...parseJson<TemplateVars>(row.payload),
          'trigger.name': trigger.name,
          'delivery.attempt': String(attempt),
        };
        result = await deliver({
          type: trigger.type,
          config: parseJson<TriggerConfig>(trigger.config),
          secrets: decryptSecrets(trigger.secrets_encrypted),
          eventType: row.event_type,
          vars,
          timeoutMs: trigger.timeout_seconds * 1000,
          defaultFrom: this.defaultFrom,
          fallbackRecipient: () => this.ownerEmail(row.tenant_id),
        });
      } catch (err) {
        result = {
          success: false,
          statusCode: null,
          error: err instanceof Error ? err.message : String(err),
          response: null,
        };
      }
    }

    await this.ds.query(
      `INSERT INTO trigger_event_logs
         (id, event_id, tenant_id, attempt, started_at, duration_ms, success, status_code, error, response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        randomUUID(),
        row.id,
        row.tenant_id,
        attempt,
        startedAt.toISOString(),
        Date.now() - startedAt.getTime(),
        result.success,
        result.statusCode,
        result.error,
        result.response,
      ],
    );

    if (result.success) {
      await this.ds.query(
        `UPDATE trigger_events
            SET status = 'delivered', attempts = $2, last_error = NULL,
                delivered_at = NOW(), next_attempt_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [row.id, attempt],
      );
    } else if (final || !trigger || attempt > trigger.max_retries) {
      await this.ds.query(
        `UPDATE trigger_events
            SET status = 'failed', attempts = $2, last_error = $3, next_attempt_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [row.id, attempt, result.error],
      );
    } else {
      await this.ds.query(
        `UPDATE trigger_events
            SET status = 'pending', attempts = $2, last_error = $3, updated_at = NOW(),
                next_attempt_at = NOW() + ($4::int * INTERVAL '1 second')
          WHERE id = $1`,
        [row.id, attempt, result.error, trigger.retry_delay_seconds],
      );
    }
    return result;
  }

  /** Claims and delivers one specific row now (the test button). */
  async deliverNow(eventId: string): Promise<DeliveryResult | null> {
    const result = (await this.ds.query(
      `UPDATE trigger_events SET status = 'delivering', updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING id, tenant_id, trigger_id, event_type, payload, attempts`,
      [eventId],
    )) as unknown;
    const rows = (
      Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
    ) as QueueRow[];
    return rows?.[0] ? this.process(rows[0]) : null;
  }

  private async ownerEmail(tenantId: string): Promise<string | null> {
    const rows = (await this.ds.query(
      `SELECT COALESCE(
                (SELECT ou.email FROM organization_members om
                   JOIN "user" ou ON ou.id = om.user_id
                  WHERE om.tenant_id = t.id AND om.role = 'owner'
                  ORDER BY om.created_at ASC LIMIT 1),
                u.email, t.email) AS email
         FROM tenants t
         LEFT JOIN "user" u ON u.id = t.owner_user_id
        WHERE t.id = $1`,
      [tenantId],
    )) as Array<{ email: string | null }>;
    return rows[0]?.email ?? null;
  }
}
