import { stripGatewayMarker } from './proxy-transport';
import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  classifyMessageError,
  FAILED_STATUS,
  normalizeStatus,
  CANCELLED_STATUS,
  PENDING_STATUS,
  type RequestParamDefaults,
} from 'thinker-shared';
import { AgentMessage } from '../../entities/agent-message.entity';
import { ThinkerRequest } from '../../entities/request.entity';
import type { RequestTimeline } from './request-timeline';
import {
  ModelPricingCacheService,
  type PricingEntry,
} from '../../model-prices/model-pricing-cache.service';
import { IngestEventBusService } from '../../common/services/ingest-event-bus.service';
import { TriggerSignalService } from '../../common/services/trigger-signal.service';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { FailedFallback } from './proxy-fallback.service';
import { StreamUsage } from './stream-writer';
import { computeTokenCost } from '../../common/utils/cost-calculator';
import { scrubSecrets } from '../../common/utils/secret-scrub';
import { CallerAttribution } from './caller-classifier';
import type { ProviderAttemptRef, ProviderAttemptStart, ProxyApiMode } from './proxy-types';
import { CustomProviderService } from '../custom-provider/custom-provider.service';
import { OpencodeGoCatalogService } from '../../model-discovery/opencode-go-catalog.service';
import { PROVIDER_BY_ID_OR_ALIAS } from '../../common/constants/providers';
import { isLocalOnlyProvider } from '../../common/utils/provider-availability';
import { ProviderService } from '../routing-core/provider.service';
import { extractThinkerErrorCode, type ThinkerErrorCode } from '../../common/errors/error-codes';
import {
  THINKER_CODE_TO_REASON,
  isRecordableThinkerCode,
  type ThinkerBlockedRequestReason,
} from '../../common/errors/thinker-error';
import { normalizeProviderErrorForStorage } from './proxy-error-sanitizer';

export const FAILED_WITHOUT_MESSAGE = 'Request failed without an error message.';

/**
 * The virtual model a request named (ADR 0004). Stamped on every row of the
 * request, with the name as spelled at the time, so renames and deletes keep
 * old rows readable.
 */
export interface VirtualModelRef {
  virtualModelId?: string | null;
  virtualModelName?: string | null;
}

export interface ProviderErrorOpts extends VirtualModelRef {
  requestId?: string;
  attemptNumber?: number;
  attempt?: ProviderAttemptRef;
  /** The route failed locally before provider transport started. */
  skipAttempt?: boolean;
  requestDurationMs?: number;
  model?: string;
  provider?: string;
  tier?: string;
  traceId?: string;
  fallbackFromModel?: string;
  fallbackIndex?: number;
  authType?: string;
  /**
   * Why the tier was selected (e.g. 'specificity', 'scored').
   * Persisted to agent_messages.routing_reason so single-shot upstream errors
   * keep the same audit context as their successful siblings.
   */
  reason?: string;
  specificityCategory?: string;
  providerKeyLabel?: string;
  /**
   * The tenant_providers row (connection/key) that served this message.
   * Persisted to agent_messages.tenant_provider_id so per-connection analytics
   * scope by the exact key rather than the non-unique provider/auth/label tuple.
   */
  tenantProviderId?: string | null;
  callerAttribution?: CallerAttribution | null;
  requestHeaders?: Record<string, string> | null;
  /**
   * Snapshot of effective request body parameters merged into the outbound
   * provider request. Persisted to `agent_messages.request_params`.
   */
  requestParams?: RequestParamDefaults | null;
  /** API surface to retain when this terminal write creates the Request. */
  apiMode?: ProxyApiMode;
}

export type { ThinkerBlockedRequestReason };

export interface ThinkerBlockedRequestOpts {
  requestId?: string;
  /**
   * The status the caller saw, when there was one. Omitted for the HTTP-200
   * friendly stubs (no provider was contacted, so there is no upstream status
   * to record) — `error_http_status` then stays NULL, as it always has.
   */
  httpStatus?: number | null;
  errorMessage: string;
  /** The documented `M###` code, persisted so the UI can link to its doc page. */
  errorCode?: ThinkerErrorCode;
  reason: ThinkerBlockedRequestReason;
  model?: string;
  traceId?: string;
  sessionKey?: string;
  callerAttribution?: CallerAttribution | null;
  requestHeaders?: Record<string, string> | null;
  /** End-to-end time until Thinker returned the rejection. */
  durationMs?: number;
  /**
   * The Thinker API surface the caller used. Stamped so a rejection that never
   * got a pending row (the guard-level M004 path writes the terminal row first)
   * still names its surface.
   */
  apiMode?: ProxyApiMode;
  /**
   * How the request was classified, when Thinker failed after routing ran (a
   * post-routing M500). Keeps tier filters matching the row.
   * Provider stays null (the row still claims no provider attempt); the
   * requested model is still recorded in the model field.
   */
  routing?: ThinkerBlockedRouting;
}

export interface ThinkerBlockedRouting {
  tier?: string;
  specificityCategory?: string;
  virtualModelId?: string;
  virtualModelName?: string;
}

export interface PendingRequestOpts {
  requestId: string;
  timestamp: string;
  traceId?: string;
  sessionKey?: string;
  requestedModel?: string;
  callerAttribution?: CallerAttribution | null;
  requestHeaders?: Record<string, string> | null;
  /** The Thinker API surface the caller used. Persisted to requests.api_mode. */
  apiMode?: ProxyApiMode;
}

export interface CancelledRequestOpts {
  requestId: string;
  attempt?: ProviderAttemptRef;
  attemptStart?: ProviderAttemptStart;
  requestDurationMs?: number;
  traceId?: string;
  /** API surface to retain when cancellation creates or repairs the Request. */
  apiMode?: ProxyApiMode;
}

export interface FallbackSuccessOpts extends VirtualModelRef {
  requestId?: string;
  attemptNumber?: number;
  attempt?: ProviderAttemptRef;
  requestDurationMs?: number;
  traceId?: string;
  provider?: string;
  fallbackFromModel?: string;
  fallbackIndex?: number;
  timestamp?: string;
  authType?: string;
  /**
   * Why the primary tier was selected (e.g. 'specificity', 'scored'). Persisted to agent_messages.routing_reason so fallback rows
   * keep the same audit context as their non-fallback siblings.
   */
  reason?: string;
  providerKeyLabel?: string;
  /**
   * The tenant_providers row (connection/key) that served this message.
   * Persisted to agent_messages.tenant_provider_id so per-connection analytics
   * scope by the exact key rather than the non-unique provider/auth/label tuple.
   */
  tenantProviderId?: string | null;
  usage?: StreamUsage;
  callerAttribution?: CallerAttribution | null;
  requestHeaders?: Record<string, string> | null;
  /**
   * Snapshot of effective request body parameters (today: DeepSeek
   * `thinking`) merged into the outbound provider request. `null` when no
   * known params apply. Persisted to `agent_messages.request_params`.
   */
  requestParams?: RequestParamDefaults | null;
  /** API surface to retain when this terminal write creates the Request. */
  apiMode?: ProxyApiMode;
}

export interface SuccessMessageOpts extends VirtualModelRef {
  requestId?: string;
  attemptNumber?: number;
  attempt?: ProviderAttemptRef;
  traceId?: string;
  provider?: string;
  authType?: string;
  sessionKey?: string;
  durationMs?: number;
  specificityCategory?: string;
  providerKeyLabel?: string;
  /**
   * The tenant_providers row (connection/key) that served this message.
   * Persisted to agent_messages.tenant_provider_id so per-connection analytics
   * scope by the exact key rather than the non-unique provider/auth/label tuple.
   */
  tenantProviderId?: string | null;
  callerAttribution?: CallerAttribution | null;
  requestHeaders?: Record<string, string> | null;
  requestParams?: RequestParamDefaults | null;
  /** API surface to retain when this terminal write creates the Request. */
  apiMode?: ProxyApiMode;
}

function buildMessageRow(
  ctx: IngestionContext,
  overrides: Partial<AgentMessage>,
): Partial<AgentMessage> {
  const row: Partial<AgentMessage> = {
    id: randomUUID(),
    tenant_id: ctx.tenantId,
    agent_id: ctx.agentId,
    agent_name: ctx.agentName,
    // Informational attribution only — never filtered on (see IngestionContext).
    user_id: ctx.userId,
    trace_id: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    ...overrides,
  };
  // Stamp the orthogonal error axes from this row's own signals so every insert
  // site is classified identically (and identically to the backfill migration).
  // classifyRow reads the *rich* status (`rate_limited` / `fallback_error`) to
  // derive error_class + superseded, then the stored status is
  // collapsed onto the canonical `success`/`failed` vocabulary — the reason it
  // failed now lives entirely on those orthogonal columns.
  const classified = classifyRow(row);
  const status = normalizeStatus(row.status);
  const errorMessage =
    status === FAILED_STATUS &&
    (typeof row.error_message !== 'string' || row.error_message.trim().length === 0)
      ? FAILED_WITHOUT_MESSAGE
      : row.error_message;
  return { ...row, ...classified, status, error_message: errorMessage };
}

/** `default` is the placeholder the proxy sends when the caller names no session. */
function normalizeSessionKey(sessionKey?: string | null): string | null {
  if (!sessionKey || sessionKey === 'default') return null;
  return sessionKey;
}

function attemptIdentity(
  attempt: ProviderAttemptRef | undefined,
  attemptNumber: number | undefined,
): Partial<AgentMessage> {
  return attempt
    ? {
        id: attempt.id,
        attempt_number: attempt.attemptNumber,
        timestamp: attempt.startedAt,
      }
    : { attempt_number: attemptNumber ?? null };
}

function buildRequestRow(
  ctx: IngestionContext,
  requestId: string,
  attempt: Partial<AgentMessage>,
  terminal: boolean,
  apiMode?: ProxyApiMode,
): ThinkerRequest {
  const classified = classifyRow(attempt);
  // classifyRow above reads the rich attempt status; the request row stores the
  // collapsed canonical outcome. A non-terminal request is still `pending`.
  const status = terminal ? normalizeStatus(attempt.status) : PENDING_STATUS;
  const errorMessage =
    terminal && status === FAILED_STATUS
      ? typeof attempt.error_message === 'string' && attempt.error_message.trim().length > 0
        ? attempt.error_message
        : FAILED_WITHOUT_MESSAGE
      : null;
  const timestamp = attempt.timestamp ?? new Date().toISOString();
  return {
    id: requestId,
    tenant_id: ctx.tenantId,
    agent_id: ctx.agentId,
    user_id: ctx.userId,
    agent_name: ctx.agentName,
    trace_id: attempt.trace_id ?? null,
    session_key: attempt.session_key ?? null,
    session_id: attempt.session_id ?? null,
    timestamp,
    duration_ms: attempt.duration_ms ?? null,
    status,
    error_message: errorMessage,
    error_http_status: terminal ? (attempt.error_http_status ?? null) : null,
    error_code: terminal ? (attempt.error_code ?? null) : null,
    error_origin: terminal ? classified.error_origin : null,
    error_class: terminal ? classified.error_class : null,
    requested_model: attempt.fallback_from_model ?? attempt.model ?? null,
    api_mode: apiMode ?? null,
    caller_attribution: attempt.caller_attribution ?? null,
    request_headers: attempt.request_headers ?? null,
    request_params: attempt.request_params ?? null,
    feedback_rating: attempt.feedback_rating ?? null,
    feedback_tags: attempt.feedback_tags ?? null,
    feedback_details: attempt.feedback_details ?? null,
  };
}

/**
 * Derive `{ error_origin, error_class, superseded }` for a row from the same
 * signals the backfill reads, via the shared classifyMessageError source of
 * truth. A row with no explicit status is a success ('ok').
 */
function classifyRow(row: Partial<AgentMessage>): {
  error_origin: string | null;
  error_class: string | null;
  superseded: boolean;
} {
  if (normalizeStatus(row.status) === PENDING_STATUS) {
    return { error_origin: null, error_class: null, superseded: false };
  }
  // A stamped Thinker error_code is the authoritative origin signal. A
  // credential-hop failure (M100/M102) carries a synthetic 401 and rides the
  // fallback recorder, whose routing_reason is the *tier* reason ('scored',
  // 'default', …) — classifying off that alone would bucket a Thinker config
  // error as a provider 401 and inflate provider_error_rate / billing. Derive
  // the reason from the code so it classifies as config even though
  // routing_reason keeps the tier reason for display.
  const code = row.error_code as ThinkerErrorCode | null | undefined;
  const codeReason =
    code && isRecordableThinkerCode(code) ? THINKER_CODE_TO_REASON[code] : undefined;
  return classifyMessageError({
    status: row.status ?? 'ok',
    errorHttpStatus: row.error_http_status,
    routingReason: codeReason ?? row.routing_reason,
    provider: row.provider,
    errorMessage: row.error_message,
  });
}

@Injectable()
export class ProxyMessageRecorder implements OnModuleDestroy {
  private readonly logger = new Logger(ProxyMessageRecorder.name);
  private readonly rateLimitCooldown = new Map<string, number>();
  private readonly RATE_LIMIT_COOLDOWN_MS = 60_000;
  private readonly MAX_COOLDOWN_ENTRIES = 1_000;
  private readonly cooldownCleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(AgentMessage)
    private readonly messageRepo: Repository<AgentMessage>,
    private readonly pricingCache: ModelPricingCacheService,
    private readonly eventBus: IngestEventBusService,
    private readonly customProviders: CustomProviderService,
    private readonly opencodeGoCatalog: OpencodeGoCatalogService,
    @Optional()
    private readonly providerService?: ProviderService,
    @Optional()
    private readonly triggerSignals?: TriggerSignalService,
  ) {
    this.cooldownCleanupTimer = setInterval(() => this.evictExpiredCooldowns(), 60_000);
    if (typeof this.cooldownCleanupTimer === 'object' && 'unref' in this.cooldownCleanupTimer) {
      this.cooldownCleanupTimer.unref();
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.cooldownCleanupTimer);
  }

  private isCopilotSubscription(provider?: string, authType?: string): boolean {
    if (authType !== 'subscription' || !provider) return false;
    return PROVIDER_BY_ID_OR_ALIAS.get(provider.toLowerCase())?.id === 'copilot';
  }

  private async copilotTokenPricing(
    ctx: IngestionContext,
    tenantProviderId: string | null | undefined,
    model: string,
    promptTokens: number,
  ): Promise<PricingEntry | undefined> {
    if (!tenantProviderId || !this.providerService) return undefined;

    let providers;
    try {
      providers = await this.providerService.getProviders(ctx.tenantId);
    } catch {
      return undefined;
    }

    const connection = providers.find((candidate) => candidate.id === tenantProviderId);
    const bareModel = model.toLowerCase().replace(/^copilot\//, '');
    const cached = Array.isArray(connection?.cached_models)
      ? connection.cached_models.find(
          (candidate) => candidate.id.toLowerCase().replace(/^copilot\//, '') === bareModel,
        )
      : undefined;
    const validPrice = (price: number | null): price is number =>
      typeof price === 'number' && Number.isFinite(price) && price >= 0;
    if (
      !cached ||
      !validPrice(cached.inputPricePerToken) ||
      !validPrice(cached.outputPricePerToken)
    ) {
      return undefined;
    }

    const longContext = cached.longContextPricing;
    const useLongContext =
      longContext != null &&
      Number.isSafeInteger(longContext.thresholdTokens) &&
      longContext.thresholdTokens > 0 &&
      promptTokens > longContext.thresholdTokens &&
      validPrice(longContext.inputPricePerToken) &&
      validPrice(longContext.outputPricePerToken) &&
      (longContext.inputPricePerToken > 0 || longContext.outputPricePerToken > 0);
    const effective = useLongContext ? longContext : cached;
    if (effective.inputPricePerToken === 0 && effective.outputPricePerToken === 0) {
      return undefined;
    }

    return {
      model_name: cached.id,
      provider: connection?.provider ?? 'copilot',
      input_price_per_token: effective.inputPricePerToken,
      output_price_per_token: effective.outputPricePerToken,
      cache_read_price_per_token: effective.cacheReadPricePerToken,
      cache_write_price_per_token: effective.cacheWritePricePerToken,
      display_name: cached.displayName || null,
    };
  }

  private async computeCost(
    ctx: IngestionContext,
    model: string,
    provider: string | undefined,
    authType: string | undefined,
    usage: StreamUsage | undefined,
    tenantProviderId?: string | null,
    canonicalProvider?: string | null,
    at?: Date,
  ): Promise<number | null> {
    const isCopilot = this.isCopilotSubscription(provider, authType);
    const copilotPricing =
      isCopilot && usage
        ? await this.copilotTokenPricing(ctx, tenantProviderId, model, usage.prompt_tokens)
        : undefined;

    return computeTokenCost({
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_tokens ?? 0,
      model,
      // Priced on the raw keys: a custom provider's rates are stored under
      // `custom:<uuid>/<model>`, which is exactly what canonicalization strips.
      pricing:
        copilotPricing ??
        (!isCopilot && usage ? this.pricingCache.getByModel(model, provider) : undefined),
      isSubscription: authType === 'subscription' && !copilotPricing,
      isLocalProvider: isLocalOnlyProvider(canonicalProvider ?? provider ?? ''),
      perRequestCostUsd: copilotPricing
        ? null
        : await this.perRequestSubscriptionCost(provider, authType, model),
      // Copilot's usage.cost is a premium-request multiplier, not USD.
      reportedCostUsd: isCopilot ? undefined : usage?.reported_cost_usd,
      at,
    });
  }

  /**
   * Insert the parent before its attempts. Intermediate hops only insert the
   * initial pending row; the one terminal writer replaces it with the outcome
   * observed by the caller. This prevents a late fallback-error write from
   * downgrading a request that already succeeded.
   */
  private async persistRequest(
    ctx: IngestionContext,
    requestId: string,
    attempt: Partial<AgentMessage>,
    terminal: boolean,
    apiMode?: ProxyApiMode,
  ): Promise<boolean> {
    // Unit-test repository doubles predate the request table. Production
    // repositories always expose manager.getRepository().
    const getRepository = this.messageRepo.manager?.getRepository?.bind(this.messageRepo.manager);
    if (!getRepository) return false;
    const repo = getRepository(ThinkerRequest);
    if (typeof repo.createQueryBuilder !== 'function') return false;
    const row = buildRequestRow(ctx, requestId, attempt, terminal, apiMode);
    const insert = repo.createQueryBuilder().insert().into(ThinkerRequest).values(row);
    if (terminal) {
      // Most terminal writers do not need to repeat the ingress surface. When
      // they do have it, let them repair a missing/failed pending write without
      // allowing an undefined surface to erase an existing value.
      const updatedColumns = [
        'user_id',
        'agent_name',
        'trace_id',
        'session_key',
        'session_id',
        'duration_ms',
        'status',
        'error_message',
        'error_http_status',
        'error_code',
        'error_origin',
        'error_class',
        'caller_attribution',
        'request_headers',
        'request_params',
        ...(apiMode == null ? [] : ['api_mode']),
      ];
      await insert.orUpdate(updatedColumns, ['id']).execute();
      this.triggerSignals?.emit({
        kind: 'request',
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        agentName: ctx.agentName,
        requestId,
      });
    } else {
      await insert.orIgnore().execute();
    }
    return true;
  }

  /** Update the pending row when present; retain insert-only legacy/test paths. */
  private async persistAttempt(
    row: Partial<AgentMessage>,
    attempt?: ProviderAttemptRef,
  ): Promise<void> {
    await this.persistAttemptRow(row, attempt);
    this.signalAttempt(row);
  }

  /** Tells event triggers how a provider connection answered (credential checks). */
  private signalAttempt(row: Partial<AgentMessage>): void {
    if (!this.triggerSignals || !row.tenant_id || !row.agent_id) return;
    const status = normalizeStatus(row.status);
    if (status === PENDING_STATUS || status === CANCELLED_STATUS) return;
    this.triggerSignals.emit({
      kind: 'attempt',
      tenantId: row.tenant_id,
      agentId: row.agent_id,
      agentName: row.agent_name ?? '',
      tenantProviderId: row.tenant_provider_id ?? null,
      provider: row.provider ?? null,
      keyLabel: row.provider_key_label ?? null,
      ok: normalizeStatus(row.status ?? 'ok') === 'success',
      httpStatus: row.error_http_status ?? null,
      errorCode: row.error_code ?? null,
      errorMessage: row.error_message ?? null,
    });
  }

  private async persistAttemptRow(
    row: Partial<AgentMessage>,
    attempt?: ProviderAttemptRef,
  ): Promise<void> {
    const terminalRow = attempt
      ? {
          ...row,
          ...attemptIdentity(attempt, attempt.attemptNumber),
          duration_ms: Math.max(0, (attempt.completedAtMs ?? Date.now()) - attempt.startedAtMs),
        }
      : row;
    if (!attempt || !(await attempt.pendingWrite.catch(() => false))) {
      await this.messageRepo.insert(terminalRow);
      return;
    }
    const payload = { ...terminalRow };
    delete payload.id;
    await this.messageRepo.update({ id: attempt.id }, payload);
  }

  private shouldSkipRateLimitRecord(ctx: IngestionContext, scope?: string): boolean {
    const key = scope
      ? `${scope}:${ctx.tenantId}:${ctx.agentId}`
      : `${ctx.tenantId}:${ctx.agentId}`;
    const now = Date.now();
    const lastRecorded = this.rateLimitCooldown.get(key) ?? 0;
    if (now - lastRecorded < this.RATE_LIMIT_COOLDOWN_MS) return true;
    this.rateLimitCooldown.set(key, now);

    if (this.rateLimitCooldown.size > this.MAX_COOLDOWN_ENTRIES) {
      for (const [k, v] of this.rateLimitCooldown) {
        if (now - v >= this.RATE_LIMIT_COOLDOWN_MS) this.rateLimitCooldown.delete(k);
      }
    }
    return false;
  }

  /**
   * Store the Request timeline. The pending row is written at ingress, so it
   * normally exists; when that write failed, a terminal writer may still be
   * creating the row, so one delayed retry covers it.
   */
  async recordRequestTimeline(
    tenantId: string,
    requestId: string,
    timeline: RequestTimeline,
  ): Promise<void> {
    const getRepository = this.messageRepo.manager?.getRepository?.bind(this.messageRepo.manager);
    if (!getRepository) return;
    const repo = getRepository(ThinkerRequest);
    if (typeof repo.update !== 'function') return;
    const write = () =>
      repo.update({ id: requestId, tenant_id: tenantId }, { timeline: timeline as never });
    const result = await write();
    if (result.affected === 0) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await write();
    }
  }

  /** Persist the accepted Request before routing or provider work begins. */
  async recordPendingRequest(ctx: IngestionContext, opts: PendingRequestOpts): Promise<void> {
    await this.persistRequest(
      ctx,
      opts.requestId,
      {
        trace_id: opts.traceId ?? null,
        session_key: opts.sessionKey ?? null,
        timestamp: opts.timestamp,
        status: PENDING_STATUS,
        model: opts.requestedModel ?? null,
        caller_attribution: opts.callerAttribution ?? null,
        request_headers: opts.requestHeaders ?? null,
      },
      false,
      opts.apiMode,
    );
  }

  /** Insert the Attempt as pending at the provider-call boundary. */
  async recordPendingProviderAttempt(
    ctx: IngestionContext,
    requestId: string,
    attempt: ProviderAttemptRef,
    start: ProviderAttemptStart,
  ): Promise<boolean> {
    const canonical = await this.customProviders.canonicalizeAgentMessageKeys(
      ctx.tenantId,
      start.provider,
      start.model,
    );
    await this.messageRepo.insert(
      buildMessageRow(ctx, {
        id: attempt.id,
        request_id: requestId,
        attempt_number: attempt.attemptNumber,
        timestamp: attempt.startedAt,
        status: PENDING_STATUS,
        model: canonical.model,
        provider: canonical.provider,
        auth_type: start.authType ?? null,
        tenant_provider_id: start.tenantProviderId ?? null,
        // Stamped from the start so an attempt that never reaches a terminal
        // writer still names the connection it used.
        provider_key_label: start.keyLabel ?? null,
        virtual_model_id: start.virtualModelId ?? null,
        virtual_model_name: start.virtualModelName ?? null,
      }),
    );
    return true;
  }

  /** Finish caller-disconnected work without attributing an error to Thinker or the provider. */
  async recordCancelledRequest(ctx: IngestionContext, opts: CancelledRequestOpts): Promise<void> {
    const row = buildMessageRow(ctx, {
      request_id: opts.requestId,
      ...attemptIdentity(opts.attempt, opts.attempt?.attemptNumber),
      timestamp: new Date().toISOString(),
      duration_ms: opts.requestDurationMs ?? null,
      status: CANCELLED_STATUS,
      trace_id: opts.traceId ?? null,
      provider: opts.attemptStart?.provider ?? null,
      model: opts.attemptStart?.model ?? null,
      auth_type: opts.attemptStart?.authType ?? null,
      tenant_provider_id: opts.attemptStart?.tenantProviderId ?? null,
      provider_key_label: opts.attemptStart?.keyLabel ?? null,
      virtual_model_id: opts.attemptStart?.virtualModelId ?? null,
      virtual_model_name: opts.attemptStart?.virtualModelName ?? null,
      error_message: null,
      error_http_status: null,
    });
    await this.persistRequest(ctx, opts.requestId, row, true, opts.apiMode);
    if (opts.attempt) await this.persistAttempt(row, opts.attempt);
    this.eventBus.emit(ctx.tenantId, 'message', ctx.userId);
  }

  /**
   * Cancel Provider Attempts the caller disconnected under. A disconnect in the
   * middle of the fallback chain throws out of the chain before its local
   * failure list reaches a terminal writer, so these rows would otherwise stay
   * `pending` forever. Only rows still pending are touched: a terminal write
   * that already landed keeps its real outcome. Updates run in parallel and a
   * failed one never stops the rest.
   */
  async cancelPendingProviderAttempts(attempts: ProviderAttemptRef[]): Promise<void> {
    await Promise.all(
      attempts.map(async (attempt) => {
        if (!(await attempt.pendingWrite.catch(() => false))) return;
        await this.messageRepo
          .update(
            { id: attempt.id, status: PENDING_STATUS },
            {
              status: CANCELLED_STATUS,
              error_message: null,
              error_code: null,
              error_http_status: null,
              duration_ms: Math.max(0, (attempt.completedAtMs ?? Date.now()) - attempt.startedAtMs),
            },
          )
          .catch((e) => this.logger.warn(`Failed to cancel Provider Attempt ${attempt.id}: ${e}`));
      }),
    );
  }

  /** Complete an intermediate provider call that is retried below the proxy layer. */
  async completePendingProviderFailure(
    attempt: ProviderAttemptRef,
    status: number,
    errorBody: string,
    superseded: boolean,
  ): Promise<void> {
    if (!(await attempt.pendingWrite.catch(() => false))) return;
    const richStatus = superseded ? 'fallback_error' : status === 429 ? 'rate_limited' : 'error';
    const classified = classifyRow({
      status: richStatus,
      error_http_status: status,
    });
    const errorMessage =
      scrubSecrets(stripGatewayMarker(errorBody)).trim().slice(0, 2000) || FAILED_WITHOUT_MESSAGE;
    await this.messageRepo.update(
      { id: attempt.id },
      {
        status: normalizeStatus(richStatus),
        error_message: errorMessage,
        error_code: extractThinkerErrorCode(errorMessage),
        error_http_status: status,
        duration_ms: Math.max(0, (attempt.completedAtMs ?? Date.now()) - attempt.startedAtMs),
        ...classified,
      },
    );
  }

  async recordProviderError(
    ctx: IngestionContext,
    httpStatus: number,
    errorMessage: string,
    opts?: ProviderErrorOpts,
  ): Promise<void> {
    const {
      requestId = randomUUID(),
      attemptNumber,
      attempt,
      skipAttempt = false,
      requestDurationMs,
      model,
      provider,
      tier,
      traceId,
      fallbackFromModel,
      fallbackIndex,
      authType,
      reason,
      specificityCategory,
      providerKeyLabel,
      tenantProviderId,
      callerAttribution,
      requestHeaders,
      requestParams,
      virtualModelId,
      virtualModelName,
      apiMode,
    } = opts ?? {};
    if (httpStatus === 429 && !attempt && !skipAttempt && this.shouldSkipRateLimitRecord(ctx)) {
      return;
    }

    const messageStatus = httpStatus === 429 ? 'rate_limited' : 'error';

    const canonical = await this.customProviders.canonicalizeAgentMessageKeys(
      ctx.tenantId,
      provider,
      model,
    );

    const row = buildMessageRow(ctx, {
      request_id: requestId,
      ...attemptIdentity(attempt, attemptNumber),
      trace_id: traceId ?? null,
      timestamp: new Date().toISOString(),
      duration_ms: requestDurationMs ?? null,
      status: messageStatus,
      error_message: scrubSecrets(normalizeProviderErrorForStorage(httpStatus, errorMessage)).slice(
        0,
        2000,
      ),
      error_http_status: httpStatus,
      model: canonical.model,
      provider: canonical.provider,
      routing_tier: tier ?? null,
      routing_reason: skipAttempt ? 'provider_cooldown' : (reason ?? null),
      fallback_from_model: fallbackFromModel ?? null,
      fallback_index: fallbackIndex ?? null,
      auth_type: authType ?? null,
      specificity_category: specificityCategory ?? null,
      provider_key_label: providerKeyLabel ?? null,
      tenant_provider_id: tenantProviderId ?? null,
      caller_attribution: callerAttribution ?? null,
      request_headers: requestHeaders ?? null,
      request_params: requestParams ?? null,
      virtual_model_id: virtualModelId ?? null,
      virtual_model_name: virtualModelName ?? null,
    });
    await this.persistRequest(ctx, requestId, row, true, apiMode);
    await this.persistAttempt(row, attempt);
    this.eventBus.emit(ctx.tenantId, 'message', ctx.userId);
  }

  /**
   * The single writer for every Thinker-authored failure row: setup errors
   * (M100/M101), limits (M200), rate limits (M201–M203), malformed requests
   * (M300), internal errors (M500), and expired keys (M004).
   *
   * `provider` and `routing_tier` are deliberately left NULL — no provider was
   * contacted and no tier was chosen. (The old canned-stub path wrote a
   * placeholder `provider='thinker'` / `routing_tier='simple'`, which put a
   * meaningless SIMPLE badge on setup errors and a phantom "thinker" entry in
   * the Messages provider dropdown.) `model` keeps the model the caller asked
   * for, which is real information.
   */
  async recordThinkerBlockedRequest(
    ctx: IngestionContext,
    opts: ThinkerBlockedRequestOpts,
  ): Promise<void> {
    const {
      requestId = randomUUID(),
      httpStatus,
      errorMessage,
      errorCode,
      reason,
      model,
      traceId,
      sessionKey,
      callerAttribution,
      requestHeaders,
      durationMs,
      apiMode,
      routing,
    } = opts;

    const canonical = await this.customProviders.canonicalizeAgentMessageKeys(
      ctx.tenantId,
      null,
      model ?? null,
    );

    const row = buildMessageRow(ctx, {
      request_id: requestId,
      trace_id: traceId ?? null,
      session_key: sessionKey ?? null,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs ?? null,
      status: httpStatus === 429 ? 'rate_limited' : 'error',
      error_message: scrubSecrets(errorMessage).slice(0, 2000),
      error_code: errorCode ?? null,
      error_http_status: httpStatus ?? null,
      model: canonical.model,
      provider: null,
      routing_tier: routing?.tier ?? null,
      routing_reason: reason,
      fallback_from_model: null,
      fallback_index: null,
      auth_type: null,
      specificity_category: routing?.specificityCategory ?? null,
      provider_key_label: null,
      tenant_provider_id: null,
      caller_attribution: callerAttribution ?? null,
      request_headers: requestHeaders ?? null,
      request_params: null,
      virtual_model_id: routing?.virtualModelId ?? null,
      virtual_model_name: routing?.virtualModelName ?? null,
    });
    await this.persistRequest(ctx, requestId, row, true, apiMode);
    await this.persistAttempt(row);
    this.eventBus.emit(ctx.tenantId, 'message', ctx.userId);
  }

  async recordFailedFallbacks(
    ctx: IngestionContext,
    tier: string,
    primaryModel: string,
    failures: FailedFallback[],
    opts?: {
      traceId?: string;
      requestId?: string;
      firstAttemptNumber?: number;
      baseTimeMs?: number;
      markHandled?: boolean;
      lastAsError?: boolean;
      authType?: string;
      /** Primary connection label, used only for failures with no label of their own. */
      providerKeyLabel?: string;
      reason?: string;
      callerAttribution?: CallerAttribution | null;
      requestHeaders?: Record<string, string> | null;
      requestParams?: RequestParamDefaults | null;
      virtualModelId?: string | null;
      virtualModelName?: string | null;
    },
  ): Promise<void> {
    const {
      traceId,
      requestId = randomUUID(),
      firstAttemptNumber,
      baseTimeMs,
      markHandled = false,
      lastAsError = false,
      authType,
      providerKeyLabel,
      reason,
      callerAttribution,
      requestHeaders,
      requestParams,
      virtualModelId,
      virtualModelName,
    } = opts ?? {};
    if (failures.length === 0) return;
    // primaryModel is loop-invariant — canonicalize once.
    const canonicalPrimary = await this.customProviders.canonicalizeAgentMessageKeys(
      ctx.tenantId,
      null,
      primaryModel,
    );
    const canonicalFailures = await Promise.all(
      failures.map((f) =>
        this.customProviders.canonicalizeAgentMessageKeys(ctx.tenantId, f.provider, f.model),
      ),
    );
    const rows: Partial<AgentMessage>[] = [];
    for (let i = 0; i < failures.length; i++) {
      const f = failures[i];
      const ts = baseTimeMs
        ? new Date(baseTimeMs + (failures.length - i) * 100).toISOString()
        : new Date().toISOString();
      const isLast = i === failures.length - 1;
      const useHandledStatus = markHandled && !(lastAsError && isLast);
      const status = useHandledStatus
        ? 'fallback_error'
        : f.status === 429
          ? 'rate_limited'
          : 'error';
      const canonical = canonicalFailures[i];
      // Prefer the per-failure auth_type when the proxy was able to record
      // it (fallback came from a structured ModelRoute, or the legacy
      // inference path tried a different credential than the primary).
      // Falling back to the primary auth keeps behavior identical for rows
      // that haven't been backfilled with routes.
      const recordedAuth = f.authType ?? authType ?? null;
      const errorMessage = scrubSecrets(
        normalizeProviderErrorForStorage(f.status, f.errorBody),
      ).slice(0, 2000);
      rows.push(
        buildMessageRow(ctx, {
          request_id: requestId,
          ...attemptIdentity(
            f.attempt,
            firstAttemptNumber == null ? undefined : firstAttemptNumber + i,
          ),
          trace_id: traceId ?? null,
          timestamp: ts,
          status,
          error_message: errorMessage,
          // Credential hop failures embed M100/M102 in the body; stamp the
          // code so filters/analytics do not have to parse error_message.
          error_code: extractThinkerErrorCode(errorMessage) ?? extractThinkerErrorCode(f.errorBody),
          error_http_status: f.status,
          model: canonical.model,
          provider: canonical.provider,
          routing_tier: tier,
          routing_reason: f.providerCallStarted === false ? 'provider_cooldown' : (reason ?? null),
          fallback_from_model: canonicalPrimary.model,
          fallback_index: f.fallbackIndex,
          auth_type: recordedAuth,
          // Per-failure connection: each failed fallback carries its own key id.
          tenant_provider_id: f.tenantProviderId ?? null,
          // Same rule for the label: the hop's own connection first, the
          // primary's only for rows that predate per-failure labels.
          provider_key_label: f.keyLabel ?? providerKeyLabel ?? null,
          caller_attribution: callerAttribution ?? null,
          request_headers: requestHeaders ?? null,
          // Each hop's own snapshot when the proxy computed one.
          request_params: (f.requestParams !== undefined ? f.requestParams : requestParams) ?? null,
          virtual_model_id: virtualModelId ?? null,
          virtual_model_name: virtualModelName ?? null,
        }),
      );
    }
    // Fallback attempts never define the caller-visible outcome themselves.
    // Exhausted chains persist the rebuilt primary response as the terminal
    // parent in recordPrimaryFailure; recovered chains finish on success.
    await this.persistRequest(ctx, requestId, rows[rows.length - 1], false);
    if (failures.every((failure) => !failure.attempt)) {
      await this.messageRepo.insert(rows);
    } else {
      await Promise.all(
        rows.map((row, index) => this.persistAttempt(row, failures[index].attempt)),
      );
    }
    this.eventBus.emit(ctx.tenantId, 'message', ctx.userId);
  }

  async recordPrimaryFailure(
    ctx: IngestionContext,
    tier: string,
    model: string,
    errorBody: string,
    timestamp: string,
    authType?: string,
    opts?: {
      provider?: string;
      requestId?: string;
      attemptNumber?: number;
      attempt?: ProviderAttemptRef;
      /** The route failed locally before provider transport started. */
      skipAttempt?: boolean;
      requestDurationMs?: number;
      reason?: string;
      tenantProviderId?: string | null;
      /** Label of that same connection, so the failed primary names the key it used. */
      providerKeyLabel?: string;
      callerAttribution?: CallerAttribution | null;
      requestHeaders?: Record<string, string> | null;
      requestParams?: RequestParamDefaults | null;
      virtualModelId?: string | null;
      virtualModelName?: string | null;
      /** Provider status for the superseded primary. */
      httpStatus?: number | null;
      /** HTTP status returned to the caller when every fallback was exhausted. */
      terminalHttpStatus?: number;
      /** API surface to retain when the exhausted chain creates the Request. */
      apiMode?: ProxyApiMode;
    },
  ): Promise<void> {
    const canonical = await this.customProviders.canonicalizeAgentMessageKeys(
      ctx.tenantId,
      opts?.provider,
      model,
    );
    const requestId = opts?.requestId ?? randomUUID();
    const errorMessage = scrubSecrets(
      normalizeProviderErrorForStorage(opts?.httpStatus, errorBody),
    ).slice(0, 2000);
    const row = buildMessageRow(ctx, {
      request_id: requestId,
      ...attemptIdentity(opts?.attempt, opts?.attemptNumber),
      timestamp,
      duration_ms: opts?.requestDurationMs ?? null,
      status: 'fallback_error',
      error_message: errorMessage,
      // Credential failures (M100/M102) land here with a peacock body; stamp
      // error_code so Messages filters and analytics can group on it.
      error_code: extractThinkerErrorCode(errorMessage) ?? extractThinkerErrorCode(errorBody),
      error_http_status: opts?.httpStatus ?? null,
      model: canonical.model,
      provider: canonical.provider,
      routing_tier: tier,
      routing_reason: opts?.skipAttempt ? 'provider_cooldown' : (opts?.reason ?? null),
      fallback_from_model: null,
      fallback_index: null,
      auth_type: authType ?? null,
      tenant_provider_id: opts?.tenantProviderId ?? null,
      provider_key_label: opts?.providerKeyLabel ?? null,
      caller_attribution: opts?.callerAttribution ?? null,
      request_headers: opts?.requestHeaders ?? null,
      request_params: opts?.requestParams ?? null,
      virtual_model_id: opts?.virtualModelId ?? null,
      virtual_model_name: opts?.virtualModelName ?? null,
    });
    const requestOutcome = opts?.terminalHttpStatus
      ? {
          ...row,
          status: opts.terminalHttpStatus === 429 ? 'rate_limited' : 'error',
          error_http_status: opts.terminalHttpStatus,
        }
      : row;
    await this.persistRequest(
      ctx,
      requestId,
      requestOutcome,
      Boolean(opts?.terminalHttpStatus),
      opts?.apiMode,
    );
    await this.persistAttempt(row, opts?.attempt);
    this.eventBus.emit(ctx.tenantId, 'message', ctx.userId);
  }

  async recordFallbackSuccess(
    ctx: IngestionContext,
    model: string,
    tier: string,
    opts?: FallbackSuccessOpts,
  ): Promise<void> {
    const {
      requestId = randomUUID(),
      attemptNumber,
      attempt,
      requestDurationMs,
      traceId,
      provider,
      fallbackFromModel,
      fallbackIndex,
      timestamp,
      authType,
      reason,
      providerKeyLabel,
      tenantProviderId,
      usage,
      callerAttribution,
      requestHeaders,
      requestParams,
      virtualModelId,
      virtualModelName,
      apiMode,
    } = opts ?? {};

    const inputTokens = usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? 0;

    const canonical = await this.customProviders.canonicalizeAgentMessageKeys(
      ctx.tenantId,
      provider,
      model,
    );

    const costUsd = await this.computeCost(
      ctx,
      model,
      provider,
      authType,
      usage,
      tenantProviderId,
      canonical.provider,
      // Bill the hour the provider attempt actually ran: `timestamp` is the
      // synthetic ordering stamp from recordFallbackFailures, not the attempt
      // start, so it can cross a peak boundary on delayed writes.
      attempt ? new Date(attempt.startedAt) : timestamp ? new Date(timestamp) : undefined,
    );

    const canonicalFallbackFrom = await this.customProviders.canonicalizeAgentMessageKeys(
      ctx.tenantId,
      null,
      fallbackFromModel,
    );

    const row = buildMessageRow(ctx, {
      request_id: requestId,
      ...attemptIdentity(attempt, attemptNumber),
      trace_id: traceId ?? null,
      timestamp: timestamp ?? new Date().toISOString(),
      duration_ms: requestDurationMs ?? null,
      status: 'ok',
      model: canonical.model,
      provider: canonical.provider,
      routing_tier: tier,
      routing_reason: reason ?? null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: usage?.cache_read_tokens ?? 0,
      cache_creation_tokens: usage?.cache_creation_tokens ?? 0,
      cost_usd: costUsd,
      auth_type: authType ?? null,
      fallback_from_model: canonicalFallbackFrom.model,
      fallback_index: fallbackIndex ?? null,
      provider_key_label: providerKeyLabel ?? null,
      tenant_provider_id: tenantProviderId ?? null,
      caller_attribution: callerAttribution ?? null,
      request_headers: requestHeaders ?? null,
      request_params: requestParams ?? null,
      virtual_model_id: virtualModelId ?? null,
      virtual_model_name: virtualModelName ?? null,
    });
    await this.persistRequest(ctx, requestId, row, true, apiMode);
    await this.persistAttempt(row, attempt);
    this.eventBus.emit(ctx.tenantId, 'message', ctx.userId);
  }

  async recordSuccessMessage(
    ctx: IngestionContext,
    model: string,
    tier: string,
    reason: string,
    usage: StreamUsage,
    opts?: SuccessMessageOpts,
  ): Promise<void> {
    const {
      requestId: providedRequestId,
      attemptNumber,
      attempt,
      traceId,
      provider,
      authType,
      sessionKey,
      durationMs,
      specificityCategory,
      providerKeyLabel,
      tenantProviderId,
      callerAttribution,
      requestHeaders,
      requestParams,
      virtualModelId,
      virtualModelName,
      apiMode,
    } = opts ?? {};
    const requestId = providedRequestId ?? randomUUID();

    // `model` is a required string, so the overload on
    // `canonicalizeAgentMessageKeys` keeps `canonical.model` non-null.
    const canonical = await this.customProviders.canonicalizeAgentMessageKeys(
      ctx.tenantId,
      provider,
      model,
    );

    const costUsd = await this.computeCost(
      ctx,
      model,
      provider,
      authType,
      usage,
      tenantProviderId,
      canonical.provider,
      // Bill a peak/off-peak model on when the attempt started, not on when
      // this row is written: a long stream that opens at 09:59 and records at
      // 10:01 is a peak request, and the fallback path already reads it this
      // way. Falls back to now when the caller tracked no attempt.
      attempt ? new Date(attempt.startedAt) : undefined,
    );

    const canonicalModel = canonical.model;
    const canonicalProvider = canonical.provider;

    const normalizedSessionKey = normalizeSessionKey(sessionKey);

    // Thinker's own canned stubs never reach here — the controller routes them
    // to recordThinkerBlockedRequest, which is the sole writer of Thinker rows.
    const status = 'ok';
    const errorMessage = null;

    const requestRow = buildMessageRow(ctx, {
      request_id: requestId,
      ...attemptIdentity(attempt, attemptNumber),
      trace_id: traceId ?? null,
      session_key: normalizedSessionKey,
      timestamp: new Date().toISOString(),
      status,
      error_message: errorMessage,
      model: canonicalModel,
      provider: canonicalProvider,
      routing_tier: tier,
      routing_reason: reason,
      duration_ms: durationMs ?? null,
      caller_attribution: callerAttribution ?? null,
      request_headers: requestHeaders ?? null,
      request_params: requestParams ?? null,
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      cache_read_tokens: usage.cache_read_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_tokens ?? 0,
      cost_usd: costUsd,
      auth_type: authType ?? null,
      specificity_category: specificityCategory ?? null,
      provider_key_label: providerKeyLabel ?? null,
      tenant_provider_id: tenantProviderId ?? null,
      virtual_model_id: virtualModelId ?? null,
      virtual_model_name: virtualModelName ?? null,
    });
    await this.persistRequest(ctx, requestId, requestRow, true, apiMode);
    await this.persistAttempt(requestRow, attempt);
    this.eventBus.emit(ctx.tenantId, 'message', ctx.userId);
  }

  /**
   * Resolve the per-request USD cost for subscription providers that bill
   * against a dollar quota (today: OpenCode Go). Returns `null` for every
   * other provider, leaving the existing "subscription → $0" path intact.
   * Canonicalizes the provider through the registry so aliases (e.g.
   * `opencodego`, `OpenCode-Go`) resolve identically. Awaits the catalog
   * `list()` once if its in-memory index is still cold so the first request
   * after a process restart doesn't undercount as $0.
   */
  private async perRequestSubscriptionCost(
    provider: string | null | undefined,
    authType: string | null | undefined,
    model: string | null | undefined,
  ): Promise<number | null> {
    if (authType !== 'subscription') return null;
    if (!provider) return null;
    const canonical = PROVIDER_BY_ID_OR_ALIAS.get(provider.toLowerCase())?.id;
    if (canonical !== 'opencode-go') return null;
    return this.opencodeGoCatalog.resolveCostPerRequest(model);
  }

  private evictExpiredCooldowns(): void {
    const now = Date.now();
    for (const [k, v] of this.rateLimitCooldown) {
      if (now - v >= this.RATE_LIMIT_COOLDOWN_MS) this.rateLimitCooldown.delete(k);
    }
  }
}
