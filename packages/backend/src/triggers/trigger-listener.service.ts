import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Subscription } from 'rxjs';
import {
  TriggerSignalService,
  type TriggerSignal,
} from '../common/services/trigger-signal.service';
import { TriggerDispatchService } from './trigger-dispatch.service';

/** Request rows are written before their attempts; wait for those to land. */
const REQUEST_SETTLE_MS = 2_000;
/** At most one provider.failure per harness and provider per window. */
export const PROVIDER_FAILURE_WINDOW_MS = 5 * 60_000;
const MAX_TRACKED = 5_000;

type Signal<K extends TriggerSignal['kind']> = Extract<TriggerSignal, { kind: K }>;

interface RequestFacts {
  status: string;
  error_message: string | null;
  error_http_status: number | null;
  error_origin: string | null;
  requested_model: string | null;
  duration_ms: number | null;
  model: string | null;
  provider: string | null;
  routing_tier: string | null;
  input_tokens: string | number | null;
  output_tokens: string | number | null;
  cost_usd: string | number | null;
}

function fmt(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Turns raw signals into trigger events. Runs entirely off the request path:
 * signals are fire-and-forget and every failure here is only logged.
 */
@Injectable()
export class TriggerListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TriggerListenerService.name);
  private subscription: Subscription | undefined;
  /** `${agentId}|${provider}` → window start and failures since the last event. */
  private readonly failureWindows = new Map<string, { since: number; count: number }>();
  /** Connections reported as expired, cleared on their next success. */
  private readonly expired = new Set<string>();

  constructor(
    private readonly signals: TriggerSignalService,
    private readonly dispatch: TriggerDispatchService,
    private readonly ds: DataSource,
  ) {}

  onModuleInit(): void {
    this.subscription = this.signals.signals().subscribe((signal) => {
      this.handle(signal).catch((err) =>
        this.logger.error(
          `Trigger signal ${signal.kind} failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  async handle(signal: TriggerSignal): Promise<void> {
    switch (signal.kind) {
      case 'request':
        return this.onRequest(signal);
      case 'attempt':
        return this.onAttempt(signal);
      case 'limit':
        return this.onLimit(signal);
      case 'harness':
        return this.onHarness(signal);
    }
  }

  private async onRequest(signal: Signal<'request'>): Promise<void> {
    const [debug, failure] = await Promise.all([
      this.dispatch.isSubscribed(signal.agentId, 'request.debug'),
      this.dispatch.isSubscribed(signal.agentId, 'provider.failure'),
    ]);
    if (!debug && !failure) return;

    await new Promise((resolve) => setTimeout(resolve, REQUEST_SETTLE_MS).unref?.());
    const facts = await this.requestFacts(signal.tenantId, signal.requestId);
    if (!facts) return;

    const tokensIn = Number(facts.input_tokens ?? 0);
    const tokensOut = Number(facts.output_tokens ?? 0);
    const ok = facts.status === 'success';
    const vars = {
      'request.id': signal.requestId,
      'request.status': facts.status,
      'request.model': fmt(facts.model),
      'request.requested_model': fmt(facts.requested_model),
      'request.provider': fmt(facts.provider),
      'request.tier': fmt(facts.routing_tier),
      'request.input_tokens': String(tokensIn),
      'request.output_tokens': String(tokensOut),
      'request.tokens': String(tokensIn + tokensOut),
      'request.cost': facts.cost_usd === null ? '' : Number(facts.cost_usd).toFixed(6),
      'request.latency_ms': fmt(facts.duration_ms),
      'request.error': fmt(facts.error_message),
      'request.http_status': fmt(facts.error_http_status),
      'request.url': this.dispatch.requestUrl(signal.requestId),
    };

    if (debug) {
      await this.dispatch.emit({
        tenantId: signal.tenantId,
        eventType: 'request.debug',
        agentId: signal.agentId,
        agentName: signal.agentName,
        title:
          `${signal.agentName}: ${ok ? 'request' : 'failed request'} ${facts.model ?? facts.requested_model ?? ''}`.trim(),
        message: ok
          ? `${facts.provider ?? 'provider'} answered ${facts.model ?? ''} in ${fmt(facts.duration_ms)} ms, ${tokensIn + tokensOut} tokens, $${vars['request.cost'] || '0'}.`
          : `Request failed (${facts.status}): ${facts.error_message ?? 'no error message'}.`,
        vars,
      });
    }

    const providerFault = facts.error_origin === 'provider' || facts.error_origin === 'transport';
    if (failure && !ok && providerFault) {
      const key = `${signal.agentId}|${facts.provider ?? ''}`;
      const now = Date.now();
      const window = this.failureWindows.get(key);
      if (window && now - window.since < PROVIDER_FAILURE_WINDOW_MS) {
        window.count++;
        return;
      }
      const count = (window?.count ?? 0) + 1;
      this.failureWindows.set(key, { since: now, count: 0 });
      this.trim(this.failureWindows);
      await this.dispatch.emit({
        tenantId: signal.tenantId,
        eventType: 'provider.failure',
        agentId: signal.agentId,
        agentName: signal.agentName,
        title: `${signal.agentName}: provider failure${facts.provider ? ` (${facts.provider})` : ''}`,
        message:
          `All routes failed for a request to ${facts.requested_model ?? facts.model ?? 'a model'}: ` +
          `${facts.error_message ?? 'no error message'}` +
          (count > 1 ? ` (${count} failures since the last notice)` : '') +
          '.',
        vars: { ...vars, 'failure.count': String(count) },
      });
    }
  }

  private async requestFacts(tenantId: string, requestId: string): Promise<RequestFacts | null> {
    const rows = (await this.ds.query(
      `SELECT r.status, r.error_message, r.error_http_status, r.error_origin, r.requested_model,
              r.duration_ms, last.model, last.provider, last.routing_tier,
              totals.input_tokens, totals.output_tokens, totals.cost_usd
         FROM requests r
         LEFT JOIN LATERAL (
           SELECT m.model, m.provider, m.routing_tier FROM agent_messages m
            WHERE m.request_id = r.id
            ORDER BY m.attempt_number DESC NULLS LAST, m.timestamp DESC LIMIT 1) last ON true
         LEFT JOIN LATERAL (
           SELECT SUM(m.input_tokens) AS input_tokens, SUM(m.output_tokens) AS output_tokens,
                  SUM(m.cost_usd) AS cost_usd
             FROM agent_messages m WHERE m.request_id = r.id) totals ON true
        WHERE r.id = $1 AND r.tenant_id = $2`,
      [requestId, tenantId],
    )) as RequestFacts[];
    return rows[0] ?? null;
  }

  private async onAttempt(signal: Signal<'attempt'>): Promise<void> {
    if (!signal.tenantProviderId) return;
    if (signal.ok) {
      this.expired.delete(signal.tenantProviderId);
      return;
    }
    // A Thinker error code (M100/M102 credential hops) is our own config
    // error carrying a synthetic 401, not the provider rejecting the key.
    if (signal.errorCode || (signal.httpStatus !== 401 && signal.httpStatus !== 403)) return;
    if (this.expired.has(signal.tenantProviderId)) return;
    if (!(await this.dispatch.isSubscribed(signal.agentId, 'credential.expired'))) return;
    this.expired.add(signal.tenantProviderId);
    if (this.expired.size > MAX_TRACKED) this.expired.clear();
    const label = signal.keyLabel ? ` "${signal.keyLabel}"` : '';
    await this.dispatch.emit({
      tenantId: signal.tenantId,
      eventType: 'credential.expired',
      agentId: signal.agentId,
      agentName: signal.agentName,
      title: `Credential rejected: ${signal.provider ?? 'provider'}${label}`,
      message:
        `${signal.provider ?? 'The provider'} rejected the connection${label} with HTTP ${signal.httpStatus}` +
        ` while serving ${signal.agentName}. Reconnect or replace the key.`,
      vars: {
        'connection.id': signal.tenantProviderId,
        'connection.provider': fmt(signal.provider),
        'connection.label': fmt(signal.keyLabel),
        'connection.http_status': fmt(signal.httpStatus),
        'connection.error': fmt(signal.errorMessage),
      },
    });
  }

  private async onLimit(signal: Signal<'limit'>): Promise<void> {
    const agents = (await this.ds.query(
      `SELECT id FROM agents WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [signal.tenantId, signal.agentName],
    )) as Array<{ id: string }>;
    if (!agents[0]) return;
    const soft = signal.alertType === 'soft';
    const value = (n: number) =>
      signal.metric === 'cost' ? `$${Number(n).toFixed(2)}` : `${Math.round(Number(n))} tokens`;
    await this.dispatch.emit({
      tenantId: signal.tenantId,
      eventType: soft ? 'limit.alert' : 'limit.block',
      agentId: agents[0].id,
      agentName: signal.agentName,
      title: soft
        ? `${signal.agentName} exceeded the ${signal.metric} threshold`
        : `${signal.agentName} has been blocked`,
      message: soft
        ? `${signal.agentName} used ${value(signal.actual)} this ${signal.period}, over the ${value(signal.threshold)} threshold. Requests are still being processed.`
        : `${signal.agentName} reached the ${value(signal.threshold)} ${signal.metric} limit per ${signal.period} (${value(signal.actual)}). New requests are blocked until the period resets${signal.periodReset ? ` on ${signal.periodReset}` : ''}.`,
      vars: {
        'rule.id': signal.ruleId,
        'rule.metric': signal.metric,
        'rule.threshold': String(signal.threshold),
        'rule.period': signal.period,
        'value.actual': String(signal.actual),
        'period.start': signal.periodStart,
        'period.end': signal.periodEnd,
        'period.reset': signal.periodReset ?? '',
      },
    });
  }

  private async onHarness(signal: Signal<'harness'>): Promise<void> {
    const rows = signal.userId
      ? ((await this.ds.query(`SELECT email FROM "user" WHERE id = $1`, [signal.userId])) as Array<{
          email: string | null;
        }>)
      : [];
    const actor = rows[0]?.email ?? '';
    const created = signal.action === 'created';
    await this.dispatch.emit({
      tenantId: signal.tenantId,
      eventType: created ? 'harness.created' : 'harness.deleted',
      agentId: signal.agentId,
      agentName: signal.agentName,
      displayName: signal.displayName,
      title: `Harness ${signal.displayName} ${created ? 'created' : 'deleted'}`,
      message: `The harness ${signal.displayName} (${signal.agentName}) was ${created ? 'created' : 'deleted'}${actor ? ` by ${actor}` : ''}.`,
      vars: { 'actor.email': actor },
    });
  }

  private trim(map: Map<string, unknown>): void {
    if (map.size <= MAX_TRACKED) return;
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
}
