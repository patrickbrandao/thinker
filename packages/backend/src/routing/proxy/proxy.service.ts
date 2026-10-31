import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResolveService } from '../resolve/resolve.service';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { ProviderKeyService } from '../routing-core/provider-key.service';
import { OpenaiOauthService } from '../oauth/openai/openai-oauth.service';
import { MinimaxOauthService } from '../oauth/minimax/minimax-oauth.service';
import { AnthropicOauthService } from '../oauth/anthropic/anthropic-oauth.service';
import { GeminiOauthService } from '../oauth/gemini/gemini-oauth.service';
import { KiroOauthService } from '../oauth/kiro/kiro-oauth.service';
import { XaiOauthService } from '../oauth/xai/xai-oauth.service';
import { ForwardResult } from './provider-client';
import { SessionMomentumService } from './session-momentum.service';
import { LimitCheckService } from '../../notifications/services/limit-check.service';
import { shouldTriggerFallback } from './fallback-status-codes';
import { Tier, TIERS, ScorerMessage } from '../../scoring/types';
import type {
  AuthType,
  ModelRoute,
  RequestParamDefaults,
  ResponseMode,
  OutputModality,
  SpecificityCategory,
  TierSlot,
} from 'thinker-shared';
import {
  DEFAULT_RESPONSE_MODE,
  DEFAULT_TIER_SLOT,
  SPECIFICITY_CATEGORIES,
  modelParamsScopeForRouting,
  routeEquals,
  snapshotRequestParams,
} from 'thinker-shared';
import type { ParamMergeContext } from './proxy-fallback.service';
import {
  ProxyFallbackService,
  FailedFallback,
  normalizeProviderModel,
} from './proxy-fallback.service';
import {
  ProxyApiMode,
  ProxyRequestOptions,
  SignatureLookup,
  ThinkingBlockLookup,
  ResolveChatBody,
  ProviderAttemptRef,
  StartProviderAttempt,
} from './proxy-types';
import { ThoughtSignatureCache } from './thought-signature-cache';
import { ThinkingBlockCache } from './thinking-block-cache';
import { AgentModelParamsService } from '../routing-core/agent-model-params.service';
import { ProviderParamSpecService } from '../routing-core/provider-param-spec.service';
import { buildFriendlyResponse, getDashboardUrl } from './proxy-friendly-response';
import { formatThinkerError, type ThinkerErrorCode } from '../../common/errors/error-codes';
import { ThinkerError } from '../../common/errors/thinker-error';
import {
  buildCredentialFailureForward,
  presentCredentialFailure,
  resolveRouteCredentials,
  type ResolvedRouteCredentials,
  type RouteCredentialDeps,
} from './route-credentials';
import { peekStream, streamWarmupMsFor } from './stream-warmup';
import { toChatCompletionsRequest } from './responses-adapter';
import { messagesToChatCompletionsRequest } from './anthropic-messages-adapter';
import { effectiveRoutesForResponseMode } from '../routing-core/response-mode-guard';
import { subscriptionPreferredRoute } from '../routing-core/route-helpers';
import {
  explicitModelRouteCandidate,
  OPENAI_MODEL_ID_AUTO,
  routeForOpenAiModelId,
  SUBSCRIPTION_MODEL_SUFFIX,
} from './openai-model-id';
import { recordingResponseFromText } from './attempt-recording-capture';
import {
  estimateRequestTokens,
  mayExceedContextWindows,
  planContextFit,
} from './context-window-fit';
import { snapshotRouteState, type RouteSnapshot } from '../virtual-models/virtual-model-chain';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';

type ResolvedRouting = Awaited<ReturnType<ResolveService['resolve']>> & {
  explicit_model_override?: boolean;
  explicit_model_unavailable?: string;
  /** Models dropped from the chain because the request overflows their context window. */
  context_skipped_models?: string[];
};

/**
 * One route snapshot per catalog array. getModelsForAgent returns the same
 * cached array until it refreshes, so the per-provider index snapshotRouteState
 * builds is reused across requests instead of rebuilt on each one.
 */
const contextSnapshots = new WeakMap<readonly DiscoveredModel[], RouteSnapshot>();

/**
 * Roles excluded from scoring. AI agents (OpenClaw, Hermes, and
 * similar tools) inject a large, keyword-rich system prompt with every
 * request. Scoring it inflates every request to the most expensive tier.
 * We strip these before the scorer sees them, but forward the full
 * unmodified body to the real provider.
 */
const SCORING_EXCLUDED_ROLES = new Set(['system', 'developer']);
const SCORING_RECENT_MESSAGES = 10;

export interface RoutingMeta {
  tier: TierSlot | 'direct';
  model: string;
  provider: string;
  confidence: number;
  reason: string;
  /**
   * Present when the "response" is really a Thinker error rendered as an
   * assistant message (no provider was contacted). See buildFriendlyResponse.
   */
  thinker_error_code?: ThinkerErrorCode;
  thinker_error_message?: string;
  auth_type?: AuthType;
  specificity_category?: string;
  /** Virtual model the request named (ADR 0004); stamped on every recorded row. */
  virtual_model_id?: string;
  virtual_model_name?: string;
  provider_key_label?: string;
  /**
   * The `tenant_providers` row id that served this attempt. Stamped on
   * `agent_messages.tenant_provider_id` so per-connection analytics scope by the
   * exact key rather than the non-unique (provider, auth_type, label) tuple.
   * In a fallback-success flow this holds the winning fallback's connection.
   * NULL for local/Ollama and resolution-failure paths.
   */
  tenantProviderId?: string | null;
  fallbackFromModel?: string;
  fallbackIndex?: number;
  primaryErrorStatus?: number;
  primaryErrorBody?: string;
  /**
   * Provider of the primary model when a fallback ultimately succeeded.
   * Distinct from `provider`, which in a fallback-success flow holds the
   * fallback model's provider. Used to attribute the recorded primary
   * failure row to the correct vendor.
   */
  primaryProvider?: string;
  /**
   * Auth type of the primary model when a fallback ultimately succeeded.
   * In a fallback-success flow, `auth_type` holds the fallback's auth so
   * the recorder costs the success row correctly; this field preserves the
   * primary's auth so the primary-failure row stays accurate too. See #1173.
   */
  primaryAuthType?: string;
  /**
   * The primary's `tenant_provider_id` when a fallback ultimately succeeded.
   * Mirrors primaryProvider/primaryAuthType: `tenantProviderId` then holds the
   * winning fallback's connection, so the recorded primary-failure row reads
   * this to stay attributed to the connection that actually failed.
   */
  primaryTenantProviderId?: string | null;
  /**
   * The primary's connection label when a fallback ultimately succeeded.
   * Same reason as primaryTenantProviderId: `provider_key_label` then names the
   * winning fallback's connection, and the primary-failure row must not inherit
   * a label belonging to a different key.
   */
  primaryKeyLabel?: string;
  /**
   * Effective request body parameters for this attempt: client body values,
   * route-scoped `agent_model_params`, and MPS provider param defaults.
   * Persisted on `agent_messages.request_params` so the dashboard can show
   * which model params were in play for the recorded request.
   */
  request_params?: RequestParamDefaults | null;
  /** Effective output modality configured on the resolved routing chain. */
  output_modality?: OutputModality;
  /** Effective response transport configured on the resolved routing chain. */
  response_mode?: ResponseMode;
  /** Models skipped before any attempt because the request overflows their context window. */
  context_skipped_models?: string[];
  /** Internal persisted identity of the response-producing Attempt. */
  attempt?: ProviderAttemptRef;
  /** False when the response was produced without invoking provider transport. */
  providerCallStarted?: boolean;
  /** Internal identity of the failed primary/retry that triggered fallback. */
  primaryAttempt?: ProviderAttemptRef;
  /** Whether the primary/retry actually crossed the provider transport boundary. */
  primaryProviderCallStarted?: boolean;
  /**
   * Params snapshot of the failed primary when a fallback succeeded.
   * `request_params` then holds the winner's, which can differ in model and,
   * for a virtual chain, in scope.
   */
  primaryRequestParams?: RequestParamDefaults | null;
}

export interface ProxyResult {
  forward: ForwardResult;
  meta: RoutingMeta;
  failedFallbacks?: FailedFallback[];
}

/**
 * The `agent_model_params` scope of each route of a resolved chain (ADR 0004,
 * section 9). A virtual model carries one scope per route: `virtual:<id>` for
 * its own routes and `tier:default` for the ones appended from the Default
 * tier. Every other origin (tier, specificity) has one scope for
 * all of its routes. A route outside the resolved chain (the legacy
 * fallback-inference path) takes the scope of the chain's primary.
 */
export function paramsScopeLookup(
  resolved: Pick<ResolvedRouting, 'tier' | 'specificity_category' | 'route_params_scopes'>,
): (route: ModelRoute | null | undefined) => string {
  const scopes = resolved.route_params_scopes;
  if (!scopes || scopes.length === 0) {
    const scopeKey = modelParamsScopeForRouting({
      tier: resolved.tier,
      specificityCategory: resolved.specificity_category,
    });
    return () => scopeKey;
  }
  return (route) => {
    if (!route) return scopes[0].paramsScope;
    const entry =
      scopes.find((s) => s.route === route) ?? scopes.find((s) => routeEquals(s.route, route));
    return (entry ?? scopes[0]).paramsScope;
  };
}

/** Fields that tie every row of a request to the virtual model it named. */
function virtualModelFields(
  resolved: Pick<ResolvedRouting, 'virtual_model_id' | 'virtual_model_name'>,
): Pick<RoutingMeta, 'virtual_model_id' | 'virtual_model_name'> {
  return resolved.virtual_model_id
    ? {
        virtual_model_id: resolved.virtual_model_id,
        virtual_model_name: resolved.virtual_model_name,
      }
    : {};
}

/** Stamps the virtual model on a Thinker-authored response (M100/M102/M301 stubs). */
function withVirtualModel(result: ProxyResult, resolved: ResolvedRouting): ProxyResult {
  if (!resolved.virtual_model_id) return result;
  return { ...result, meta: { ...result.meta, ...virtualModelFields(resolved) } };
}

/**
 * Stand-in for a streaming 200 whose body never produced a byte. Keeps the
 * attempt and wire fields so fallback and recording treat it as a failed
 * provider response.
 */
function warmupFailureForward(forward: ForwardResult, message: string): ForwardResult {
  return {
    ...forward,
    response: new Response(
      JSON.stringify({ error: { message: `Stream warmup failed: ${message}` } }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    ),
  };
}

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    private readonly resolveService: ResolveService,
    private readonly modelDiscovery: ModelDiscoveryService,
    private readonly providerKeyService: ProviderKeyService,
    private readonly openaiOauth: OpenaiOauthService,
    private readonly minimaxOauth: MinimaxOauthService,
    private readonly anthropicOauth: AnthropicOauthService,
    private readonly geminiOauth: GeminiOauthService,
    private readonly kiroOauth: KiroOauthService,
    private readonly xaiOauth: XaiOauthService,
    private readonly momentum: SessionMomentumService,
    private readonly limitCheck: LimitCheckService,
    private readonly fallbackService: ProxyFallbackService,
    private readonly config: ConfigService,
    private readonly signatureCache: ThoughtSignatureCache,
    private readonly thinkingCache: ThinkingBlockCache,
    private readonly modelParamsService: AgentModelParamsService,
    private readonly providerParamSpecs: ProviderParamSpecService,
  ) {}

  async proxyRequest(opts: ProxyRequestOptions): Promise<ProxyResult> {
    const {
      agentId,
      tenantId,
      body,
      sessionKey,
      sessionCacheKey,
      providerCacheKey,
      sessionMomentumKey,
      agentName,
      signal,
      specificityOverride,
      headers,
    } = opts;
    const apiMode = opts.apiMode ?? 'chat_completions';
    const routingSource = opts.routingBody ?? body;
    const resolveChatBody = this.createChatBodyResolver(apiMode, body);
    const resolveRoutingChatBody =
      routingSource === body
        ? resolveChatBody
        : this.createChatBodyResolver(apiMode, routingSource);
    this.validatePayload(body, apiMode);
    if (routingSource !== body) this.validatePayload(routingSource, apiMode);

    const limitMessage = await this.enforceLimits(tenantId, agentName);
    if (limitMessage) {
      return buildFriendlyResponse(limitMessage, body.stream === true, 'limit_exceeded', 'M200');
    }

    const resolved = await this.fitChainToContext(
      agentId,
      tenantId,
      body,
      await this.resolveRouting(
        agentId,
        tenantId,
        routingSource,
        resolveRoutingChatBody,
        sessionMomentumKey,
        specificityOverride,
        apiMode,
      ),
    );
    const responseMode = resolved.response_mode ?? DEFAULT_RESPONSE_MODE;
    const stream = body.stream === true || responseMode === 'stream';
    // Pending and cancelled attempt rows are written before any terminal
    // writer sees the meta, so the virtual model rides on each attempt start.
    const startProviderAttempt: StartProviderAttempt | undefined =
      opts.startProviderAttempt && resolved.virtual_model_id
        ? (start) =>
            opts.startProviderAttempt!({
              ...start,
              virtualModelId: resolved.virtual_model_id,
              virtualModelName: resolved.virtual_model_name,
            })
        : opts.startProviderAttempt;
    if (!resolved.route) {
      this.logger.warn(
        `No route available for agent=${agentId}: ` +
          `tier=${resolved.tier} confidence=${resolved.confidence} reason=${resolved.reason}`,
      );
      if (resolved.virtual_model_unavailable) {
        return withVirtualModel(
          this.buildVirtualModelUnavailableResult(
            stream,
            agentName,
            resolved.virtual_model_unavailable,
            resolved.virtual_model_continues_on_default === true,
          ),
          resolved,
        );
      }
      const unavailableModel =
        resolved.explicit_model_unavailable ?? resolved.override_model_unavailable;
      if (unavailableModel) {
        return this.buildModelUnavailableResult(stream, agentName, unavailableModel);
      }
      return this.buildNoProviderResult(stream, agentName, resolved.no_route_detail, resolved.tier);
    }

    const route = resolved.route;
    const credentials = await this.resolveCredentials(agentId, tenantId, {
      provider: route.provider,
      auth_type: route.authType,
      provider_key_label: route.keyLabel ?? undefined,
    });

    const primaryModel = normalizeProviderModel(route.provider, route.model);
    this.logger.log(
      `Proxy: tier=${resolved.tier} model=${primaryModel} provider=${route.provider} auth_type=${route.authType} confidence=${resolved.confidence}`,
    );

    const { signatureLookup, thinkingLookup } = this.buildCacheLookups(sessionCacheKey);

    // Per-attempt param-defaults merge happens inside the fallback service
    // so each forward (primary + every fallback iteration) looks up its
    // own (provider, auth_type, model) tuple in the model-params service.
    // Pass the agentId here as a thin context bag; the storage is already
    // route-scoped, so no per-provider filter is needed downstream.
    // A virtual model is not an explicit route: its params apply, one scope
    // per route of its chain (ADR 0004, section 9).
    const explicitModelOverride = resolved.explicit_model_override === true;
    const scopeFor = paramsScopeLookup(resolved);
    const paramMergeContext: ParamMergeContext | undefined = explicitModelOverride
      ? undefined
      : { agentId, scopeFor };

    // Snapshot of which known param keys are *effectively in play* for the
    // primary attempt. Stored on every `agent_messages` row recorded for
    // this request so the dashboard can display the effective parameters
    // (today: DeepSeek's `thinking` toggle) in the expanded message detail.
    // Re-derived for fallback successes against the actual fallback
    // provider so the persisted snapshot matches what was sent on that row.
    // Independent reads — the params row and the provider spec list don't
    // depend on each other, so fetch them concurrently to shave a round-trip
    // off the cold path before forwarding.
    const [primaryModelParams, primarySpecs] = explicitModelOverride
      ? ([null, []] as const)
      : await Promise.all([
          this.modelParamsService.get(
            agentId,
            scopeFor(route),
            route.provider,
            route.authType,
            primaryModel,
          ),
          this.providerParamSpecs.getSpecs(route.provider, route.authType, primaryModel),
        ]);
    const primaryRequestParams = explicitModelOverride
      ? null
      : snapshotRequestParams({
          body,
          modelParams: primaryModelParams,
          specs: primarySpecs,
        });

    const dashboardUrl = getDashboardUrl(this.config, agentName, 'routing');

    // Credential resolution can fail before any provider HTTP call (missing
    // key, or a subscription OAuth blob whose refresh token is dead). Treat
    // that as a failed primary attempt with a real error body, then enter the
    // same fallback chain as HTTP failures — do not silently promote a
    // fallback to primary.
    if (!credentials.ok) {
      const credentialFailure = presentCredentialFailure(
        credentials.reason,
        route.provider,
        dashboardUrl,
      );
      this.logger.warn(
        `Primary ${route.provider}/${primaryModel} credentials unusable for ` +
          `agent=${agentId} reason=${credentials.reason}`,
      );
      // A synthetic provider attempt is only recorded by the fallback chain
      // (recordPrimaryFailure completes it). When no chain will run — explicit
      // model override, no merge context, or zero fallback routes — the Thinker
      // stub is the sole record (a Thinker rejection has zero provider
      // attempts), so DON'T start one here: it would INSERT a pending
      // agent_messages row that nothing ever completes (orphan).
      const willRunChain =
        !explicitModelOverride &&
        !!paramMergeContext &&
        this.effectiveFallbackRoutes(resolved).length > 0;
      const forward = buildCredentialFailureForward({
        provider: route.provider,
        model: primaryModel,
        authType: route.authType,
        tenantProviderId: credentials.tenantProviderId,
        keyLabel: route.keyLabel ?? undefined,
        presentation: credentialFailure,
        startProviderAttempt: willRunChain ? startProviderAttempt : undefined,
      });

      if (willRunChain && paramMergeContext) {
        const fallbackResult = await this.tryFallbackChain({
          agentId,
          tenantId,
          resolved,
          primaryModel,
          forward,
          body,
          resolveChatBody,
          stream,
          sessionKey,
          sessionCacheKey,
          providerCacheKey,
          sessionMomentumKey,
          signal,
          signatureLookup,
          thinkingLookup,
          apiMode,
          paramMergeContext,
          primaryTenantProviderId: credentials.tenantProviderId,
          primaryKeyLabel: route.keyLabel ?? undefined,
          startProviderAttempt,
          credentialDashboardUrl: dashboardUrl,
          clientAnthropicBeta: headers?.['anthropic-beta'],
        });
        if (fallbackResult) return fallbackResult;
      }

      return withVirtualModel(
        buildFriendlyResponse(
          credentialFailure.message,
          stream,
          credentialFailure.reason,
          credentialFailure.code,
        ),
        resolved,
      );
    }

    const forward = await this.fallbackService.tryForwardToProvider({
      provider: route.provider,
      apiKey: credentials.apiKey,
      model: primaryModel,
      body,
      resolveChatBody,
      stream,
      sessionKey,
      reasoningCacheKey: sessionCacheKey,
      providerCacheKey,
      signal,
      agentId,
      tenantId,
      rawApiKey: credentials.rawApiKey,
      // Always the selected row's label (see resolveRouteCredentials), so the
      // forwarded connection and the recorded one can never diverge.
      providerKeyLabel: credentials.keyLabel,
      authType: route.authType,
      apiMode,
      resourceUrl: credentials.resourceUrl,
      providerRegion: credentials.providerRegion,
      signatureLookup,
      thinkingLookup,
      clientAnthropicBeta: headers?.['anthropic-beta'],
      paramMergeContext,
      paramsRoute: route,
      tenantProviderId: credentials.tenantProviderId,
      startProviderAttempt,
    });
    // A custom provider's key pool may have rotated to another key; stamp the
    // connection that actually served the call.
    const servedTenantProviderId =
      forward.servedByKey?.tenantProviderId ?? credentials.tenantProviderId;
    const servedKeyLabel = forward.servedByKey?.keyLabel ?? credentials.keyLabel;
    if (
      !explicitModelOverride &&
      !forward.response.ok &&
      shouldTriggerFallback(forward.response.status) &&
      paramMergeContext
    ) {
      const fallbackResult = await this.tryFallbackChain({
        agentId,
        tenantId,
        resolved,
        primaryModel,
        forward,
        body,
        resolveChatBody,
        stream,
        sessionKey,
        sessionCacheKey,
        providerCacheKey,
        sessionMomentumKey,
        signal,
        signatureLookup,
        thinkingLookup,
        apiMode,
        paramMergeContext,
        primaryTenantProviderId: servedTenantProviderId,
        primaryKeyLabel: servedKeyLabel,
        startProviderAttempt,
        credentialDashboardUrl: dashboardUrl,
        clientAnthropicBeta: headers?.['anthropic-beta'],
      });
      if (fallbackResult) return fallbackResult;
    }

    // Stream warm-up: for streaming 200 responses, verify the provider
    // actually starts delivering data before committing to the client.
    // If the stream stalls or dies, we can still try fallback providers.
    if (forward.response.ok && stream && forward.response.body) {
      const warmup = await peekStream(
        forward.response.body,
        streamWarmupMsFor(route.provider, {
          connectionMs: credentials.streamWarmupMs,
          local: route.authType === 'local',
        }),
      );
      if (warmup.ok) {
        const peeked: ForwardResult = {
          response: new Response(warmup.stream, {
            status: forward.response.status,
            statusText: forward.response.statusText,
            headers: forward.response.headers,
          }),
          attempt: forward.attempt,
          isGoogle: forward.isGoogle,
          isAnthropic: forward.isAnthropic,
          isChatGpt: forward.isChatGpt,
          isResponses: forward.isResponses,
          isCodeAssist: forward.isCodeAssist,
          responsesTextFormat: forward.responsesTextFormat,
          responsesToolNames: forward.responsesToolNames,
          wireFormat: forward.wireFormat,
          providerCallStarted: forward.providerCallStarted,
        };
        this.recordTierIfScoring(sessionMomentumKey, resolved.tier);
        this.recordCategoryIfValid(sessionMomentumKey, resolved.specificity_category);
        return {
          forward: peeked,
          meta: this.buildBaseMeta(resolved, primaryModel, {
            request_params: primaryRequestParams,
            tenantProviderId: servedTenantProviderId,
            // Label of the row actually selected — a stale pin resolves to the
            // default key, and the recorded label must follow the key used.
            provider_key_label: servedKeyLabel,
            attempt: forward.attempt,
            providerCallStarted: forward.providerCallStarted,
          }),
        };
      }

      this.logger.warn(
        `Stream warmup failed: provider=${route.provider} model=${primaryModel} reason=${warmup.reason} message=${warmup.message}`,
      );

      const syntheticForward = warmupFailureForward(forward, warmup.message);
      if (!explicitModelOverride && paramMergeContext) {
        const fallbackResult = await this.tryFallbackChain({
          agentId,
          tenantId,
          resolved,
          primaryModel,
          forward: syntheticForward,
          body,
          resolveChatBody,
          stream,
          sessionKey,
          sessionCacheKey,
          providerCacheKey,
          sessionMomentumKey,
          signal,
          signatureLookup,
          thinkingLookup,
          apiMode,
          paramMergeContext,
          primaryTenantProviderId: servedTenantProviderId,
          primaryKeyLabel: servedKeyLabel,
          startProviderAttempt,
          credentialDashboardUrl: dashboardUrl,
          clientAnthropicBeta: headers?.['anthropic-beta'],
        });
        if (fallbackResult) return fallbackResult;
      }

      // Warmup failed and no fallbacks available: return the synthetic 502
      // instead of the original forward (whose body was consumed by peekStream).
      this.recordTierIfScoring(sessionMomentumKey, resolved.tier);
      this.recordCategoryIfValid(sessionMomentumKey, resolved.specificity_category);
      return {
        forward: syntheticForward,
        meta: this.buildBaseMeta(resolved, primaryModel, {
          request_params: primaryRequestParams,
          tenantProviderId: servedTenantProviderId,
          provider_key_label: servedKeyLabel,
          attempt: forward.attempt,
          providerCallStarted: forward.providerCallStarted,
        }),
      };
    }

    this.recordTierIfScoring(sessionMomentumKey, resolved.tier);
    this.recordCategoryIfValid(sessionMomentumKey, resolved.specificity_category);
    return {
      forward,
      meta: this.buildBaseMeta(resolved, primaryModel, {
        request_params: primaryRequestParams,
        tenantProviderId: servedTenantProviderId,
        provider_key_label: servedKeyLabel,
        attempt: forward.attempt,
        providerCallStarted: forward.providerCallStarted,
      }),
    };
  }

  private recordTierIfScoring(sessionKey: string | undefined, tier: TierSlot): void {
    if (!sessionKey) return;
    if ((TIERS as readonly string[]).includes(tier)) {
      this.momentum.recordTier(sessionKey, tier as Tier);
    }
  }

  /**
   * Convert a native Responses / Anthropic-Messages body into the internal
   * chat-completions shape used for routing and forwarding. Returns undefined
   * for `chat_completions` mode (the body is already in the target shape).
   */
  private toChatBody(
    apiMode: ProxyApiMode,
    body: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (apiMode === 'responses') return toChatCompletionsRequest(body);
    if (apiMode === 'messages') return messagesToChatCompletionsRequest(body);
    return undefined;
  }

  private validatePayload(body: ProxyRequestOptions['body'], apiMode: ProxyApiMode): void {
    if (apiMode === 'responses') {
      const hasInstructions =
        typeof body.instructions === 'string' && body.instructions.trim().length > 0;
      const hasInput =
        typeof body.input === 'string' ||
        (Array.isArray(body.input) &&
          body.input.some(
            (item) =>
              typeof item === 'string' ||
              (!!item && typeof item === 'object' && !Array.isArray(item)),
          ));
      if (hasInstructions || hasInput) return;
      throw new ThinkerError('M300', HttpStatus.BAD_REQUEST);
    }

    const messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      // A ThinkerError, not a bare BadRequestException: the proxy needs to tell
      // "Thinker refused this body" from "the provider returned a 400", or the
      // row lands in agent_messages blamed on the provider.
      throw new ThinkerError('M300', HttpStatus.BAD_REQUEST);
    }
    if (apiMode === 'chat_completions') {
      sanitizeNullContent(messages as Record<string, unknown>[]);
    }
  }

  private createChatBodyResolver(
    apiMode: ProxyApiMode,
    body: ProxyRequestOptions['body'],
  ): ResolveChatBody | undefined {
    if (apiMode === 'chat_completions') return undefined;
    let resolved: Promise<Record<string, unknown>> | undefined;
    return () => {
      resolved ??= Promise.resolve(this.toChatBody(apiMode, body)!);
      return resolved;
    };
  }

  /**
   * Routing precedence for the three proxy surfaces (ADR 0004, section 5):
   *
   * 1. an enabled virtual model whose name equals `model`, ignoring case;
   * 2. `auto` → automatic routing; a real ID → explicit route; an unknown
   *    name → M302.
   *
   * A heartbeat (`auto` only) goes straight to the simple tier, as it always
   * has.
   */
  /**
   * Context-window aware routing (#134): drops the routes of the resolved
   * chain (primary and fallbacks) whose known context window the request
   * clearly overflows, so the first route that fits becomes the primary.
   * Unknown windows are kept, and when no route fits the chain is left as is.
   */
  private async fitChainToContext(
    agentId: string,
    tenantId: string,
    body: ProxyRequestOptions['body'],
    resolved: ResolvedRouting,
  ): Promise<ResolvedRouting> {
    if (!resolved.route || !resolved.fallback_routes?.length) return resolved;
    const chain = [resolved.route, ...resolved.fallback_routes];
    const estimate = estimateRequestTokens(body as Record<string, unknown>);
    if (!mayExceedContextWindows(estimate)) return resolved;
    const catalog = await this.modelDiscovery.getModelsForAgent(tenantId, agentId);
    if (!Array.isArray(catalog) || catalog.length === 0) return resolved;
    let snapshot = contextSnapshots.get(catalog);
    if (!snapshot) {
      snapshot = { catalog, providers: [] };
      contextSnapshots.set(catalog, snapshot);
    }
    const routeSnapshot = snapshot;
    const plan = planContextFit(chain, estimate, (route) => {
      const state = snapshotRouteState(route, routeSnapshot);
      return state.state === 'available' ? state.contextWindow : null;
    });
    if (plan.skipped.length === 0) return resolved;

    const skippedModels = plan.skipped.map((route) => route.model);
    this.logger.log(
      `Context fit: agent=${agentId} estimate=${estimate} skipped=${skippedModels.join(',')} ` +
        `primary=${plan.routes[0].model}`,
    );
    const [primary, ...fallbacks] = plan.routes;
    return {
      ...resolved,
      route: primary,
      fallback_routes: fallbacks.length > 0 ? fallbacks : null,
      context_skipped_models: skippedModels,
    };
  }

  private async resolveRouting(
    agentId: string,
    tenantId: string,
    body: ProxyRequestOptions['body'],
    resolveChatBody: ResolveChatBody | undefined,
    sessionMomentumKey: string | undefined,
    specificityOverride: ProxyRequestOptions['specificityOverride'],
    apiMode: ProxyApiMode,
  ): Promise<ResolvedRouting> {
    const requestedModel = typeof body.model === 'string' ? body.model : undefined;
    const isAuto = !requestedModel || requestedModel === OPENAI_MODEL_ID_AUTO;

    // `auto` is reserved in any spelling, so no virtual model can match it.
    if (requestedModel && !isAuto) {
      const virtual = await this.resolveService.resolveVirtualModel(
        agentId,
        tenantId,
        requestedModel,
      );
      if (virtual) return virtual;
    }

    // Every public proxy surface treats a concrete model as an explicit route.
    // The resolver accepts both provider-qualified /v1/models IDs and the
    // unambiguous provider-native IDs required by Anthropic clients.
    if (requestedModel && !isAuto) {
      const explicit = await this.resolveExplicitModel(agentId, tenantId, requestedModel);
      if (explicit) return explicit;
      return {
        tier: 'default' as const,
        route: null,
        fallback_routes: null,
        response_mode: DEFAULT_RESPONSE_MODE,
        confidence: 0,
        score: 0,
        reason: 'default' as const,
        explicit_model_unavailable: requestedModel,
      };
    }

    if (isAuto && this.detectHeartbeatBody(body, apiMode)) {
      return this.resolveService.resolveForTier(agentId, tenantId, 'simple');
    }

    const recentTiers = sessionMomentumKey
      ? this.momentum.getRecentTiers(sessionMomentumKey)
      : undefined;
    const recentCategories = sessionMomentumKey
      ? this.momentum.getRecentCategories(sessionMomentumKey)
      : undefined;

    return this.resolveService.resolveLazy(
      agentId,
      tenantId,
      async () => {
        const scoringBody = resolveChatBody ? await resolveChatBody() : body;
        // Not guaranteed to be an array: the scorer must tolerate a body
        // whose `messages` field is missing or malformed.
        const messages = (
          Array.isArray(scoringBody.messages) ? scoringBody.messages : []
        ) as ScorerMessage[];
        return {
          messages: this.filterScoringMessages(messages),
          tools: Array.isArray(scoringBody.tools) ? scoringBody.tools : undefined,
          tool_choice: scoringBody.tool_choice,
          max_tokens: scoringBody.max_tokens as number | undefined,
        };
      },
      recentTiers,
      specificityOverride,
      recentCategories,
    );
  }

  /**
   * Route the `model` a proxy client named in the body. Virtual models were
   * already tried by resolveRouting, so a request that reaches this path is
   * routed by its `model` alone.
   *
   * Exact catalog matches retain their published provider/auth identity. When
   * discovery has not learned the model yet, a provider-qualified or
   * provider-inferable ID may still route through credentials enabled on this
   * harness; the provider is the authority on whether that model exists.
   *
   * Returns null when no unambiguous connected provider applies. The caller
   * turns that into M302 instead of falling back to automatic routing, because
   * a concrete `model` is a request for that model.
   */
  private async resolveExplicitModel(
    agentId: string,
    tenantId: string,
    requestedModel: string,
  ): Promise<ResolvedRouting | null> {
    const models = await this.modelDiscovery.getModelsForAgent(tenantId, agentId);
    const catalogRoute = routeForOpenAiModelId(requestedModel, models);
    if (catalogRoute) return this.explicitRouting(agentId, tenantId, catalogRoute);

    // A bare ID served by both the subscription and api_key connections of
    // one provider is not ambiguous: the flat-fee subscription already covers
    // the request, so route it there instead of silently metering the key.
    if (!requestedModel.includes('/')) {
      const preferred = subscriptionPreferredRoute(requestedModel, models);
      if (preferred) return this.explicitRouting(agentId, tenantId, preferred);
    }

    // A bare ID already present under multiple connections is ambiguous, not
    // undiscovered. Preserve M302 instead of silently picking an auth type.
    const hasAmbiguousCatalogMatch =
      !requestedModel.includes('/') && models.some((model) => model.id === requestedModel);
    const route = hasAmbiguousCatalogMatch
      ? null
      : await this.resolveConnectedExplicitModel(agentId, tenantId, requestedModel);
    if (!route) {
      this.logger.warn(
        `Requested model "${requestedModel}" matches no connected provider route for ` +
          `agent=${agentId} — ` +
          `returning model-not-available`,
      );
      return null;
    }

    return this.explicitRouting(agentId, tenantId, route);
  }

  /**
   * Resolve an uncatalogued explicit model through usable credentials attached
   * to this harness. Provider-qualified IDs have deterministic auth precedence;
   * bare IDs must identify exactly one connected auth route.
   */
  private async resolveConnectedExplicitModel(
    agentId: string,
    tenantId: string,
    requestedModel: string,
  ): Promise<ResolvedRouting['route']> {
    const candidate = explicitModelRouteCandidate(requestedModel);
    if (!candidate) return null;

    if (candidate.providerQualified && candidate.model.endsWith(SUBSCRIPTION_MODEL_SUFFIX)) {
      const subscriptionRoute = {
        provider: candidate.provider,
        authType: 'subscription' as const,
        model: candidate.model.slice(0, -SUBSCRIPTION_MODEL_SUFFIX.length),
      };
      return (await this.providerKeyService.hasRouteCredentials(
        tenantId,
        subscriptionRoute,
        agentId,
      ))
        ? subscriptionRoute
        : null;
    }

    const authTypes: readonly AuthType[] = ['api_key', 'local', 'subscription'];
    const routes = authTypes.map((authType) => ({
      provider: candidate.provider,
      authType,
      model: candidate.model,
    }));
    const connected = (
      await Promise.all(
        routes.map(async (route) => ({
          route,
          available: await this.providerKeyService.hasRouteCredentials(tenantId, route, agentId),
        })),
      )
    ).filter(({ available }) => available);

    if (candidate.providerQualified) return connected[0]?.route ?? null;
    return connected.length === 1 ? connected[0].route : null;
  }

  /**
   * The single funnel for both explicit-model branches (catalog match and
   * uncatalogued passthrough). Neither branch knows about connections, so the
   * route arrives without a `keyLabel` and would resolve to the first key of
   * the provider. Pin it here — through the same logic tier routing uses — so
   * an operator's connection choice survives a request that names a model.
   */
  private async explicitRouting(
    agentId: string,
    tenantId: string,
    route: NonNullable<ResolvedRouting['route']>,
  ): Promise<ResolvedRouting> {
    return {
      tier: 'default' as const,
      route: await this.resolveService.pinRouteKeyLabel(agentId, tenantId, route),
      fallback_routes: null,
      response_mode: DEFAULT_RESPONSE_MODE,
      confidence: 1,
      score: 0,
      reason: 'default' as const,
      explicit_model_override: true,
    };
  }

  private routeCredentialDeps(): RouteCredentialDeps {
    return {
      providerKeyService: this.providerKeyService,
      oauth: {
        openaiOauth: this.openaiOauth,
        minimaxOauth: this.minimaxOauth,
        anthropicOauth: this.anthropicOauth,
        geminiOauth: this.geminiOauth,
        kiroOauth: this.kiroOauth,
        xaiOauth: this.xaiOauth,
      },
    };
  }

  private resolveCredentials(
    agentId: string,
    tenantId: string,
    resolved: { provider: string; auth_type?: AuthType; provider_key_label?: string },
  ): Promise<ResolvedRouteCredentials> {
    return resolveRouteCredentials(this.routeCredentialDeps(), {
      agentId,
      tenantId,
      provider: resolved.provider,
      authType: resolved.auth_type,
      providerKeyLabel: resolved.provider_key_label,
    });
  }

  /**
   * The effective fallback routes `tryFallbackChain` will actually attempt,
   * after response-mode filtering. Empty when nothing remains. Callers use this
   * to decide whether a chain will run *before* starting work that only the
   * chain would record (see the credential-failure primary path).
   */
  private effectiveFallbackRoutes(
    resolved: ResolvedRouting,
  ): NonNullable<ResolvedRouting['fallback_routes']> {
    let fallbackRoutes = resolved.fallback_routes ?? null;
    if ((resolved.response_mode ?? DEFAULT_RESPONSE_MODE) === 'stream') {
      const effectiveRoutes = effectiveRoutesForResponseMode(
        resolved.response_mode,
        resolved.route,
        fallbackRoutes,
      );
      fallbackRoutes = (effectiveRoutes.fallbackRoutes ?? []).filter(
        (route) => !routeEquals(route, resolved.route),
      );
    }
    return fallbackRoutes ?? [];
  }

  private async tryFallbackChain(args: {
    agentId: string;
    tenantId: string;
    resolved: ResolvedRouting;
    primaryModel: string;
    forward: ForwardResult;
    body: ProxyRequestOptions['body'];
    resolveChatBody?: ResolveChatBody;
    stream: boolean;
    sessionKey: string;
    sessionCacheKey?: string;
    providerCacheKey?: string;
    sessionMomentumKey?: string;
    signal?: AbortSignal;
    signatureLookup: SignatureLookup;
    thinkingLookup: ThinkingBlockLookup;
    apiMode: ProxyApiMode;
    paramMergeContext: ParamMergeContext;
    /** Primary connection id, carried so a fallback-success flow can attribute
     * its recorded primary-failure row to the connection that actually failed. */
    primaryTenantProviderId: string | null;
    /** Label of that same primary connection, for the same attribution reason. */
    primaryKeyLabel?: string;
    startProviderAttempt?: StartProviderAttempt;
    /** Dashboard URL embedded in mid-chain M100/M102 credential failure bodies. */
    credentialDashboardUrl?: string;
    /** The caller's raw `anthropic-beta` header, forwarded on an Anthropic hop. */
    clientAnthropicBeta?: string | string[];
  }): Promise<ProxyResult | null> {
    const {
      agentId,
      tenantId,
      resolved,
      primaryModel,
      forward,
      body,
      resolveChatBody,
      stream,
      sessionKey,
      sessionCacheKey,
      providerCacheKey,
      sessionMomentumKey,
      signal,
      apiMode,
    } = args;
    // The resolver owns the effective route chain. Null is a definitive
    // "nothing remains", including when the only configured fallback was
    // promoted to primary. Reloading the persisted tier here would retry that
    // promoted route as its own fallback and could resurrect routes the
    // resolver deliberately skipped.
    const fallbackRoutes = this.effectiveFallbackRoutes(resolved);
    if (fallbackRoutes.length === 0) return null;
    const fallbackModels = fallbackRoutes.map((r) => r.model);

    const primaryStatus = forward.response.status;
    const primaryErrorBody = await forward.response.text();
    await forward.attempt?.finishRecording?.(recordingResponseFromText(primaryErrorBody));
    const primaryProvider = resolved.route?.provider;
    const primaryAuth = resolved.route?.authType;
    const { success, failures } = await this.fallbackService.tryFallbacks(
      agentId,
      tenantId,
      fallbackModels,
      body,
      stream,
      sessionKey,
      primaryModel,
      signal,
      primaryProvider,
      primaryAuth,
      args.signatureLookup,
      args.thinkingLookup,
      apiMode,
      resolveChatBody,
      fallbackRoutes,
      args.paramMergeContext,
      args.startProviderAttempt,
      args.credentialDashboardUrl,
      providerCacheKey,
      sessionCacheKey,
      args.clientAnthropicBeta,
    );

    this.recordTierIfScoring(sessionMomentumKey, resolved.tier);
    this.recordCategoryIfValid(sessionMomentumKey, resolved.specificity_category);

    // Every row records the params of its own attempt (ADR 0004, section 9):
    // the primary under its scope, each hop under the scope of its route. A
    // virtual chain mixes two scopes, so no row may borrow another's snapshot.
    const primaryRequestParams =
      primaryProvider && primaryAuth && resolved.route
        ? await this.attemptRequestParams(
            args.paramMergeContext,
            resolved.route,
            primaryProvider,
            primaryAuth,
            primaryModel,
            body,
          )
        : snapshotRequestParams({
            body: body as Record<string, unknown>,
            modelParams: null,
            specs: [],
          });
    const scopedFailures: FailedFallback[] = await Promise.all(
      failures.map(async (failure) => ({
        ...failure,
        requestParams: failure.authType
          ? await this.attemptRequestParams(
              args.paramMergeContext,
              fallbackRoutes[failure.fallbackIndex] ?? null,
              failure.provider,
              failure.authType,
              failure.model,
              body,
            )
          : null,
      })),
    );

    if (success) {
      // Re-snapshot for the fallback's actual provider — its model-scoped
      // params row (if any) is what was actually applied. The scope is the
      // winning route's own.
      const fallbackRequestParams = success.authType
        ? await this.attemptRequestParams(
            args.paramMergeContext,
            fallbackRoutes[success.fallbackIndex] ?? null,
            success.provider,
            success.authType,
            success.model,
            body,
          )
        : snapshotRequestParams({
            body: body as Record<string, unknown>,
            modelParams: null,
            specs: [],
          });
      return {
        forward: success.forward,
        meta: this.buildBaseMeta(resolved, success.model, {
          provider: success.provider,
          auth_type: success.authType,
          // The label of the connection that actually served the fallback —
          // buildBaseMeta would otherwise stamp the PRIMARY route's label
          // next to the fallback's tenant_provider_id.
          provider_key_label: success.keyLabel,
          primaryKeyLabel: args.primaryKeyLabel,
          fallbackFromModel: primaryModel,
          fallbackIndex: success.fallbackIndex,
          primaryErrorStatus: primaryStatus,
          primaryErrorBody,
          primaryProvider,
          primaryAuthType: primaryAuth,
          primaryTenantProviderId: args.primaryTenantProviderId,
          primaryAttempt: forward.attempt,
          primaryProviderCallStarted: forward.providerCallStarted,
          primaryRequestParams,
          attempt: success.forward.attempt,
          providerCallStarted: success.forward.providerCallStarted,
          tenantProviderId: success.tenantProviderId,
          request_params: fallbackRequestParams,
        }),
        failedFallbacks: scopedFailures,
      };
    }

    // All fallbacks exhausted — preserve the primary provider's real HTTP status.
    // The gateway uses the X-Thinker-Fallback-Exhausted header (set by the
    // response handler) to detect this case.
    const safeHeaders = new Headers(forward.response.headers);
    safeHeaders.delete('content-encoding');
    safeHeaders.delete('content-length');
    safeHeaders.delete('transfer-encoding');
    const rebuilt = new Response(primaryErrorBody, { status: primaryStatus, headers: safeHeaders });

    // Fallback exhausted — recorded against the primary provider, so the
    // row carries the primary's snapshot.
    const exhaustedRequestParams = primaryRequestParams;
    return {
      forward: {
        response: rebuilt,
        isGoogle: forward.isGoogle,
        isAnthropic: forward.isAnthropic,
        isChatGpt: forward.isChatGpt,
        isResponses: forward.isResponses,
        isCodeAssist: forward.isCodeAssist,
      },
      meta: this.buildBaseMeta(resolved, primaryModel, {
        request_params: exhaustedRequestParams,
        // Exhausted chain is recorded against the primary connection.
        tenantProviderId: args.primaryTenantProviderId,
        provider_key_label: args.primaryKeyLabel ?? resolved.route?.keyLabel ?? undefined,
        primaryAttempt: forward.attempt,
        primaryProviderCallStarted: forward.providerCallStarted,
        attempt: failures[failures.length - 1]?.attempt ?? forward.attempt,
        providerCallStarted:
          failures[failures.length - 1]?.providerCallStarted ?? forward.providerCallStarted,
      }),
      failedFallbacks: scopedFailures,
    };
  }

  /** Snapshot of the params one attempt sent, under the scope of its own route. */
  private async attemptRequestParams(
    ctx: ParamMergeContext,
    route: ModelRoute | null,
    provider: string,
    authType: AuthType | string,
    model: string,
    body: ProxyRequestOptions['body'],
  ): Promise<RequestParamDefaults | null> {
    const [modelParams, specs] = await Promise.all([
      this.modelParamsService.get(
        ctx.agentId,
        ctx.scopeFor(route),
        provider,
        authType as AuthType,
        model,
      ),
      this.providerParamSpecs.getSpecs(provider, authType as AuthType, model),
    ]);
    return snapshotRequestParams({ body: body as Record<string, unknown>, modelParams, specs });
  }

  private buildBaseMeta(
    resolved: ResolvedRouting,
    model: string,
    overrides: Partial<RoutingMeta> = {},
  ): RoutingMeta {
    const directOverride = resolved.explicit_model_override === true;
    return {
      tier: directOverride ? 'direct' : resolved.tier,
      model,
      provider: overrides.provider ?? resolved.route?.provider ?? '',
      confidence: resolved.confidence,
      reason: directOverride ? 'direct' : resolved.reason,
      auth_type: resolved.route?.authType,
      specificity_category: resolved.specificity_category,
      provider_key_label: resolved.route?.keyLabel ?? undefined,
      ...virtualModelFields(resolved),
      output_modality: resolved.output_modality,
      response_mode: resolved.response_mode ?? DEFAULT_RESPONSE_MODE,
      ...(resolved.context_skipped_models
        ? { context_skipped_models: resolved.context_skipped_models }
        : {}),
      ...overrides,
    };
  }

  private recordCategoryIfValid(
    sessionKey: string | undefined,
    category: string | undefined,
  ): void {
    if (!sessionKey) return;
    if (!category) return;
    if (!(SPECIFICITY_CATEGORIES as readonly string[]).includes(category)) return;
    this.momentum.recordCategory(sessionKey, category as SpecificityCategory);
  }

  private async enforceLimits(tenantId: string, agentName?: string): Promise<string | null> {
    if (!agentName) return null;
    const exceeded = await this.limitCheck.checkLimits(tenantId, agentName);
    if (!exceeded) return null;

    const fmt =
      exceeded.metricType === 'cost'
        ? `$${Number(exceeded.actual).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : Number(exceeded.actual).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const threshFmt =
      exceeded.metricType === 'cost'
        ? `$${Number(exceeded.threshold).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : Number(exceeded.threshold).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const dashboardUrl = getDashboardUrl(this.config, agentName, 'guardrails');
    return formatThinkerError('M200', {
      metric: exceeded.metricType,
      used: fmt,
      threshold: threshFmt,
      period: exceeded.period,
      dashboardUrl,
    });
  }

  private filterScoringMessages(messages: ScorerMessage[]): ScorerMessage[] {
    return messages
      .filter((m) => !SCORING_EXCLUDED_ROLES.has(m.role))
      .slice(-SCORING_RECENT_MESSAGES);
  }

  private detectHeartbeatBody(body: ProxyRequestOptions['body'], apiMode: ProxyApiMode): boolean {
    if (apiMode !== 'responses') {
      const messages = (Array.isArray(body.messages) ? body.messages : []) as ScorerMessage[];
      return this.detectHeartbeat(this.filterScoringMessages(messages));
    }

    if (typeof body.input === 'string') return body.input.includes('HEARTBEAT_OK');
    if (!Array.isArray(body.input)) return false;
    for (let i = body.input.length - 1; i >= 0; i--) {
      const item = body.input[i];
      if (typeof item === 'string') return item.includes('HEARTBEAT_OK');
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      if (record.type === 'function_call' || record.type === 'function_call_output') continue;
      const role = typeof record.role === 'string' ? record.role : 'user';
      if (role !== 'user') continue;
      if (typeof record.content === 'string') {
        return record.content.includes('HEARTBEAT_OK');
      }
      if (!Array.isArray(record.content)) return false;
      return record.content.some(
        (part) =>
          !!part &&
          typeof part === 'object' &&
          !Array.isArray(part) &&
          typeof (part as Record<string, unknown>).text === 'string' &&
          ((part as Record<string, unknown>).text as string).includes('HEARTBEAT_OK'),
      );
    }
    return false;
  }

  private detectHeartbeat(scoringMessages: ScorerMessage[]): boolean {
    const lastUser = [...scoringMessages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return false;
    if (typeof lastUser.content === 'string') return lastUser.content.includes('HEARTBEAT_OK');
    if (Array.isArray(lastUser.content)) {
      return (lastUser.content as { type?: string; text?: string }[]).some(
        (p) => p.type === 'text' && typeof p.text === 'string' && p.text.includes('HEARTBEAT_OK'),
      );
    }
    return false;
  }

  private buildNoProviderResult(
    stream: boolean,
    agentName?: string,
    detail?: string,
    tier?: TierSlot,
  ): ProxyResult {
    const dashboardUrl = getDashboardUrl(this.config, agentName, 'routing');
    const content = formatThinkerError('M101', {
      dashboardUrl,
      detail: detail ? ` ${detail}` : '',
    });
    // The header names the tier the request resolved to: `default` when the
    // message is about the default tier, the scored tier otherwise.
    return buildFriendlyResponse(content, stream, 'no_provider', 'M101', tier);
  }

  private buildModelUnavailableResult(
    stream: boolean,
    agentName: string | undefined,
    model: string,
  ): ProxyResult {
    const dashboardUrl = getDashboardUrl(this.config, agentName, 'routing');
    const content = formatThinkerError('M302', { model, dashboardUrl });
    return buildFriendlyResponse(content, stream, 'model_not_available', 'M302');
  }

  private buildVirtualModelUnavailableResult(
    stream: boolean,
    agentName: string | undefined,
    name: string,
    continuesOnDefault: boolean,
  ): ProxyResult {
    const dashboardUrl = getDashboardUrl(this.config, agentName, 'routing');
    // With "Continue on Default" already on, the Default came up empty too,
    // so suggesting the option would send the operator in a circle.
    const detail = continuesOnDefault
      ? ', and the Default tier it continues on has no available route either. Fix its chain or the Default tier'
      : '. Fix its chain, or turn on "Continue on Default"';
    const content = formatThinkerError('M301', { name, detail, dashboardUrl });
    return buildFriendlyResponse(
      content,
      stream,
      'virtual_model_unavailable',
      'M301',
      DEFAULT_TIER_SLOT,
    );
  }

  /** Session-scoped cache lookups threaded into every provider forward. */
  private buildCacheLookups(sessionKey: string): {
    signatureLookup: SignatureLookup;
    thinkingLookup: ThinkingBlockLookup;
  } {
    return {
      signatureLookup: (toolCallId) => this.signatureCache.retrieve(sessionKey, toolCallId),
      thinkingLookup: (firstToolUseId, routeContext) =>
        routeContext
          ? this.thinkingCache.retrieve(sessionKey, firstToolUseId, routeContext)
          : this.thinkingCache.retrieve(sessionKey, firstToolUseId),
    };
  }
}

/** Replace null content fields with empty string to avoid upstream rejections. */
function sanitizeNullContent(messages: Record<string, unknown>[]): void {
  for (const msg of messages) {
    if (msg && typeof msg === 'object' && msg.content === null) msg.content = '';
  }
}
