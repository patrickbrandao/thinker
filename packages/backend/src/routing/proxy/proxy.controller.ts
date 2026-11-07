import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseFilters,
  UseInterceptors,
  Logger,
  HttpException,
  Optional,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { outboundFetch, runWithOutboundScope } from '../../common/outbound/outbound-proxy';
import { estimateRequestTokens } from './context-window-fit';
import { applyParamPolicy } from './param-policy';
import {
  countTokensBody,
  passthroughUrl,
  resolvePassthroughTarget,
  type PassthroughKind,
} from './passthrough';
import { Request, Response as ExpressResponse } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ProxyService, type RoutingMeta } from './proxy.service';
import { ProxyRateLimiter } from './proxy-rate-limiter';
import { ProviderClient } from './provider-client';
import { ProxyMessageRecorder, type ThinkerBlockedRequestReason } from './proxy-message-recorder';
import { ThoughtSignatureCache } from './thought-signature-cache';
import { ThinkingBlockCache } from './thinking-block-cache';
import { ReasoningContentCache } from './reasoning-content-cache';
import { ModelDiscoveryService } from '../../model-discovery/model-discovery.service';
import { ModelsDevSyncService } from '../../database/models-dev-sync.service';
import { ProviderParamSpecService } from '../routing-core/provider-param-spec.service';
import { resolveModelCapabilityMetadata } from '../../model-discovery/model-capabilities';
import { classifyCaller } from './caller-classifier';
import { clientIpInfo } from '../../common/utils/client-ip';
import { requestReceivedAtMs } from '../../common/utils/request-received';
import { buildRequestTimeline, type TimelineAttempt } from './request-timeline';
import { recordedRequestHeaders } from './request-headers';
import { detectHarnessSession, stripHarnessPrivateFields } from './harness-session';
import { EgressAffinityInterceptor } from '../../proxy-servers/egress-affinity.interceptor';
import { buildProxySessionScope } from './proxy-session-scope';
import {
  buildMetaHeaders,
  buildOpenAiCompatibleError,
  PRIMARY_ATTEMPT_NUMBER,
  handleProviderError,
  recordFallbackFailures,
  handleStreamResponse,
  handleNonStreamResponse,
  nextResponsesSequenceNumber,
  recordSuccess,
} from './proxy-response-handler';
import { ProxyExceptionFilter, isChatRenderingClient } from './proxy-exception.filter';
import { sendFriendlyResponse } from './proxy-friendly-response';
import { formatThinkerError, type ThinkerErrorCode } from '../../common/errors/error-codes';
import {
  THINKER_CODE_TO_REASON,
  ThinkerError,
  isRecordableThinkerCode,
} from '../../common/errors/thinker-error';
import type {
  ProviderAttemptRef,
  ProviderAttemptStart,
  ProxyApiMode,
  StartProviderAttempt,
} from './proxy-types';
import { ResponsesSseError } from './chatgpt-adapter';
import { redactInlineImageDataUrls } from './inline-image-redaction';
import { scrubSecrets } from '../../common/utils/secret-scrub';
import { openAiModelCapabilities, type OpenAiModelCapabilities } from './openai-model-capabilities';
import { publishedContextWindow } from '../virtual-models/published-context';
import { StreamFailure, partialUsageOf } from './stream-writer';
import { AgentRecordingConfigService } from '../../common/services/agent-recording-config.service';
import { AttemptRecordingService } from './attempt-recording.service';
import { safeJsonStringify } from '../../common/utils/safe-json';
import {
  createAttemptRecordingCapture,
  recordingResponseFromText,
} from './attempt-recording-capture';
import {
  ModelListRoutingService,
  type ModelListRouting,
} from '../virtual-models/model-list-routing.service';
import { listedCatalogModels } from '../virtual-models/model-list';

const MAX_SEEN_TENANTS = 10_000;
const SEEN_TENANT_TTL_MS = 24 * 60 * 60 * 1000;
const MODEL_CREATED_UNKNOWN = 0;

interface OpenAiModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  /**
   * Context window (tokens). For `auto` and virtual models, the smallest
   * among the routes the entry can be served by, omitted when any of those
   * windows is unknown (ADR 0004, section 7). For a real model, its own
   * window, omitted when only a stand-in default is known.
   */
  context_length?: number;
  provider_model_id?: string;
  auth_type?: string;
  capabilities?: OpenAiModelCapabilities;
  cost?: OpenAiModelCost;
}

interface OpenAiModelCost {
  /** USD per million input tokens. */
  input?: number;
  /** USD per million output tokens. */
  output?: number;
}

interface OpenAiModelList {
  object: 'list';
  data: OpenAiModelObject[];
}

function openAiModelCost(
  inputPricePerToken: number | null,
  outputPricePerToken: number | null,
): OpenAiModelCost | undefined {
  const input =
    inputPricePerToken != null && Number.isFinite(inputPricePerToken) && inputPricePerToken >= 0
      ? inputPricePerToken * 1_000_000
      : undefined;
  const output =
    outputPricePerToken != null && Number.isFinite(outputPricePerToken) && outputPricePerToken >= 0
      ? outputPricePerToken * 1_000_000
      : undefined;
  if (input === undefined && output === undefined) return undefined;
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

/** The virtual model a Thinker-authored row should name, when the request named one. */
function virtualModelRouting(meta: RoutingMeta | undefined): {
  routing?: { virtualModelId: string; virtualModelName?: string };
} {
  return meta?.virtual_model_id
    ? {
        routing: {
          virtualModelId: meta.virtual_model_id,
          virtualModelName: meta.virtual_model_name,
        },
      }
    : {};
}

/** OpenAI-style error body for the passthrough routes. */
function passthroughError(message: string, status: number) {
  return {
    error: {
      message,
      type: status >= 500 ? 'server_error' : 'invalid_request_error',
      code: null,
    },
  };
}

/** The Anthropic SDKs send `anthropic-version` on every call. */
function isAnthropicCaller(req: Request): boolean {
  return typeof req.headers['anthropic-version'] === 'string';
}

/** One `/v1/models` entry in Anthropic's `ModelInfo` shape. */
function toAnthropicModel(model: OpenAiModelObject) {
  return {
    type: 'model',
    id: model.id,
    display_name: model.id,
    created_at: new Date(model.created * 1000).toISOString(),
  };
}

/** `/v1/models` in Anthropic's list shape (harness-anthropic-sdk G2). */
function toAnthropicModelList(data: OpenAiModelObject[]) {
  const models = data.map(toAnthropicModel);
  return {
    data: models,
    has_more: false,
    first_id: models[0]?.id ?? null,
    last_id: models[models.length - 1]?.id ?? null,
  };
}

/** Upper bound for a passthrough call (embeddings, transcription, count_tokens). */
export const PASSTHROUGH_TIMEOUT_MS = 300_000;

/**
 * Abort signal for a passthrough call: fires when the client disconnects or
 * after PASSTHROUGH_TIMEOUT_MS, so an abandoned request never pins the
 * upstream connection.
 */
function passthroughAbort(res: ExpressResponse): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', onClose);
  const timer = setTimeout(() => controller.abort(), PASSTHROUGH_TIMEOUT_MS);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      res.off('close', onClose);
    },
  };
}

@Controller('v1')
@Public()
@UseGuards(AgentKeyAuthGuard)
@UseInterceptors(EgressAffinityInterceptor)
@UseFilters(ProxyExceptionFilter)
@SkipThrottle()
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);
  private readonly seenTenants = new Map<string, number>();

  constructor(
    private readonly proxyService: ProxyService,
    private readonly rateLimiter: ProxyRateLimiter,
    private readonly providerClient: ProviderClient,
    private readonly recorder: ProxyMessageRecorder,
    private readonly signatureCache: ThoughtSignatureCache,
    private readonly thinkingCache: ThinkingBlockCache,
    private readonly reasoningCache: ReasoningContentCache,
    private readonly modelDiscovery: ModelDiscoveryService,
    private readonly providerParamSpecs: ProviderParamSpecService,
    private readonly modelsDevSync: ModelsDevSyncService,
    @Optional()
    private readonly recordingConfig?: AgentRecordingConfigService,
    @Optional()
    private readonly attemptRecording?: AttemptRecordingService,
    // Always provided by ProxyModule (VirtualModelsModule). Optional only so
    // unit tests that build the controller by hand keep the plain listing.
    @Optional()
    private readonly modelListRouting?: ModelListRoutingService,
  ) {}

  @Get('models')
  async models(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Query('capabilities') capabilities?: string,
    @Query('cost') cost?: string,
    @Query('route_metadata') routeMetadata?: string,
  ): Promise<OpenAiModelList> {
    const includeCapabilities = capabilities === 'true';
    const includeCost = cost === 'true';
    const includeRouteMetadata = routeMetadata === 'true';
    const { tenantId, agentId } = req.ingestionContext;
    // One catalog snapshot per request: the real models and every
    // context_length below are judged from it (ADR 0004, section 7).
    const models = await this.modelDiscovery.getModelsForAgent(tenantId, agentId);
    const routing: ModelListRouting = this.modelListRouting
      ? await this.modelListRouting.forAgent(agentId, tenantId, models)
      : { autoContextLength: null, virtuals: [] };

    // The synthetic `auto` route and the agent's virtual models never carry
    // capabilities, cost or route metadata: they resolve to a different
    // concrete model per request (availability, fallbacks), so any claim
    // would be wrong. Only the smallest context window is safe to publish.
    const routed = (id: string, contextLength: number | null): OpenAiModelObject => ({
      id,
      object: 'model',
      created: MODEL_CREATED_UNKNOWN,
      owned_by: 'thinker',
      ...(contextLength !== null ? { context_length: contextLength } : {}),
    });
    const data: OpenAiModelObject[] = [
      routed('auto', routing.autoContextLength),
      ...routing.virtuals.map((v) => routed(v.name, v.context_length)),
    ];
    for (const { id, model } of listedCatalogModels(models, routing)) {
      const entry: OpenAiModelObject = {
        id,
        object: 'model',
        created: MODEL_CREATED_UNKNOWN,
        // Custom providers own their models under the name the user gave
        // them, not the internal `custom:<uuid>` key.
        owned_by: model.providerName ?? model.provider,
      };
      // Every real model publishes its window (harness-hermes G3), judged from
      // the same snapshot as `auto`: a stand-in default is never published.
      const contextLength = publishedContextWindow(model, models);
      if (contextLength !== null) entry.context_length = contextLength;
      if (includeRouteMetadata) {
        entry.provider_model_id = model.id;
        entry.auth_type = model.authType;
      }
      if (includeCapabilities) {
        // Same resolution as the dashboard's model picker, so agents and the
        // routing UI report identical capability facts.
        const resolved = await resolveModelCapabilityMetadata(
          model,
          this.providerParamSpecs,
          this.modelsDevSync,
        );
        const modelCapabilities = openAiModelCapabilities({ ...model, ...resolved });
        if (modelCapabilities) entry.capabilities = modelCapabilities;
      }
      if (includeCost) {
        const modelCost = openAiModelCost(model.inputPricePerToken, model.outputPricePerToken);
        if (modelCost) entry.cost = modelCost;
      }
      data.push(entry);
    }

    if (isAnthropicCaller(req) && req.method === 'GET' && !req.params?.id) {
      return toAnthropicModelList(data) as unknown as OpenAiModelList;
    }
    return {
      object: 'list',
      data,
    };
  }

  /**
   * `GET /v1/models/{id}` (harness-anthropic-sdk G2): one entry of the list,
   * in Anthropic shape when the caller sends `anthropic-version`.
   */
  @Get('models/:id')
  async model(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('id') id: string,
  ): Promise<void> {
    const list = await this.models(req);
    const entry = list.data.find((model) => model.id === id);
    if (!entry) {
      res.status(404).json(passthroughError(`Model "${id}" is not available for this agent.`, 404));
      return;
    }
    res.json(isAnthropicCaller(req) ? toAnthropicModel(entry) : entry);
  }

  /** `POST /v1/embeddings`: passthrough to the provider the model names. */
  @Post('embeddings')
  async embeddings(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    await this.passthrough(req, res, 'embeddings', body.model, (target) =>
      JSON.stringify({ ...body, model: target.model }),
    );
  }

  /** `POST /v1/audio/transcriptions` (multipart): passthrough like embeddings. */
  @Post('audio/transcriptions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async transcriptions(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @UploadedFile() file?: { buffer: Buffer; originalname?: string; mimetype?: string },
  ): Promise<void> {
    const fields = (req.body ?? {}) as Record<string, unknown>;
    if (!file) {
      res.status(400).json(passthroughError('A `file` part is required.', 400));
      return;
    }
    await this.passthrough(req, res, 'transcriptions', fields.model, (target) => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(file.buffer)], {
          type: file.mimetype || 'application/octet-stream',
        }),
        file.originalname || 'audio',
      );
      for (const [key, value] of Object.entries(fields)) {
        if (key === 'model' || value === undefined) continue;
        if (Array.isArray(value)) value.forEach((v) => form.append(key, String(v)));
        else form.append(key, String(value));
      }
      form.append('model', target.model);
      return form;
    });
  }

  /**
   * `POST /v1/messages/count_tokens` (harness-anthropic-sdk G1): forwarded to
   * Anthropic when the model is a Claude the agent can reach, estimated for
   * everything else (`auto`, virtual models, other providers).
   */
  @Post('messages/count_tokens')
  @HttpCode(200)
  async countTokens(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const target = resolvePassthroughTarget(body.model);
    const url = target ? passthroughUrl(target, 'count_tokens') : null;
    const { agentId, tenantId } = req.ingestionContext;
    const credentials =
      target && url
        ? await this.proxyService.resolvePassthroughCredentials(agentId, tenantId, target.provider)
        : null;
    if (!target || !url || !credentials) {
      res.json({ input_tokens: estimateRequestTokens(body) });
      return;
    }
    const upstreamBody = countTokensBody(body, target.model);
    applyParamPolicy(upstreamBody, {
      endpointKey: target.provider,
      format: target.endpoint.format,
      model: target.model,
    });
    const abort = passthroughAbort(res);
    try {
      const upstream = await runWithOutboundScope(credentials.egressScope, () =>
        outboundFetch(url, {
          method: 'POST',
          headers: target.endpoint.buildHeaders(credentials.apiKey, credentials.authType),
          body: JSON.stringify(upstreamBody),
          signal: abort.signal,
        }),
      );
      if (!upstream.ok) {
        // An estimate beats a failed count: clients use it to plan compaction.
        res.json({ input_tokens: estimateRequestTokens(body) });
        return;
      }
      res
        .status(upstream.status)
        .type('application/json')
        .send(await upstream.text());
    } catch {
      if (!res.headersSent && !res.writableEnded) {
        res.json({ input_tokens: estimateRequestTokens(body) });
      }
    } finally {
      abort.dispose();
    }
  }

  private async passthrough(
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    kind: PassthroughKind,
    model: unknown,
    buildBody: (
      target: NonNullable<ReturnType<typeof resolvePassthroughTarget>>,
    ) => string | FormData,
  ): Promise<void> {
    const target = resolvePassthroughTarget(model);
    if (!target) {
      res
        .status(400)
        .json(
          passthroughError(
            'Name the model with its provider (for example `openai/text-embedding-3-small`).',
            400,
          ),
        );
      return;
    }
    const url = passthroughUrl(target, kind);
    if (!url) {
      res
        .status(400)
        .json(
          passthroughError(`Provider ${target.provider} has no ${kind} route in Thinker.`, 400),
        );
      return;
    }
    const { agentId, tenantId } = req.ingestionContext;
    // Embeddings and transcriptions cost money like chat: same per-tenant,
    // per-IP and concurrency limits (M201/M202/M203, rendered by the filter).
    this.rateLimiter.checkLimit(tenantId);
    this.rateLimiter.checkIpLimit(req.ip ?? '');
    const credentials = await this.proxyService.resolvePassthroughCredentials(
      agentId,
      tenantId,
      target.provider,
    );
    if (!credentials) {
      res
        .status(400)
        .json(passthroughError(`This agent has no connection for ${target.provider}.`, 400));
      return;
    }
    const body = buildBody(target);
    const headers: Record<string, string> = {
      ...target.endpoint.buildHeaders(credentials.apiKey, credentials.authType),
    };
    // fetch sets the multipart boundary itself.
    if (typeof body !== 'string') {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-type') delete headers[key];
      }
    }
    this.rateLimiter.acquireSlot(tenantId);
    const abort = passthroughAbort(res);
    try {
      const upstream = await runWithOutboundScope(credentials.egressScope, () =>
        outboundFetch(url, { method: 'POST', headers, body, signal: abort.signal }),
      );
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      res
        .status(upstream.status)
        .type(contentType)
        .send(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      this.logger.warn(`Passthrough ${kind} to ${target.provider} failed: ${String(err)}`);
      if (!res.headersSent && !res.writableEnded) {
        res.status(502).json(passthroughError(`Provider ${target.provider} did not answer.`, 502));
      }
    } finally {
      abort.dispose();
      this.rateLimiter.releaseSlot(tenantId);
    }
  }

  @Post('chat/completions')
  async chatCompletions(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    await this.handleProxyRequest(req, res, 'chat_completions');
  }

  @Post('responses')
  async responses(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    await this.handleProxyRequest(req, res, 'responses');
  }

  @Post('messages')
  async messages(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    await this.handleProxyRequest(req, res, 'messages');
  }

  private async handleProxyRequest(
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    apiMode: ProxyApiMode,
  ): Promise<void> {
    const { agentId, tenantId } = req.ingestionContext;
    const body = req.body as Record<string, unknown>;
    stripHarnessPrivateFields(body);
    const sessionScope = buildProxySessionScope(
      tenantId,
      agentId,
      detectHarnessSession(req.headers)?.id,
    );
    const { sessionKey } = sessionScope;
    const traceId = this.extractTraceId(req);
    const requestId = randomUUID();
    const { clientIp, source: clientIpSource, peerIp } = clientIpInfo(req);
    const callerAttribution = {
      ...classifyCaller(req.headers),
      clientIp,
      clientIpSource,
      peerIp,
      peerPort: req.socket?.remotePort,
    };
    const requestHeaders = recordedRequestHeaders(req);
    const isStream = body.stream === true;
    let routingBody = body;
    let headersSent = false;
    let slotAcquired = false;
    let currentMeta: RoutingMeta | undefined;
    let recordingEnabled = false;
    let currentAttempt: ProviderAttemptRef | undefined;
    let currentAttemptStart: ProviderAttemptStart | undefined;

    const startTime = Date.now();
    const timelineAttempts: TimelineAttempt[] = [];
    const saveTimeline = this.trackTimeline(
      req,
      res,
      requestId,
      tenantId,
      startTime,
      timelineAttempts,
    );
    const clientAbort = new AbortController();
    res.once('close', () => {
      clientAbort.abort();
      saveTimeline();
    });

    // The Request exists as pending from ingress, before Thinker routes it or
    // starts any provider call. A recording failure must not reject user traffic.
    await this.recorder
      .recordPendingRequest(req.ingestionContext, {
        requestId,
        timestamp: new Date(startTime).toISOString(),
        traceId,
        sessionKey,
        requestedModel: this.extractRequestedModel(body),
        callerAttribution,
        requestHeaders,
        apiMode,
      })
      .catch((e) => this.logger.warn(`Failed to record pending Request: ${e}`));

    if (this.recordingConfig && this.attemptRecording) {
      try {
        recordingEnabled =
          this.attemptRecording.available &&
          (await this.recordingConfig.isRecording(req.ingestionContext.agentId));
      } catch (e) {
        recordingEnabled = false;
        this.logger.warn(`Failed to resolve attempt recording config: ${e}`);
      }
    }

    let attemptSequence = 0;
    // Every attempt that inserted a pending row, so a caller disconnect can
    // finish the ones no terminal writer will reach.
    const startedAttempts: ProviderAttemptRef[] = [];
    const startProviderAttempt: StartProviderAttempt = (start) => {
      const startedAtMs = Date.now();
      const attempt: ProviderAttemptRef = {
        id: randomUUID(),
        attemptNumber: ++attemptSequence,
        startedAtMs,
        startedAt: new Date(startedAtMs).toISOString(),
        pendingWrite: Promise.resolve(false),
      };
      currentAttempt = attempt;
      currentAttemptStart = start;
      timelineAttempts.push({ ref: attempt, start });
      // Cooldown skips still need a unique position in the routing chain, but
      // must not look like an in-flight provider call or trigger provider-call
      // accounting before their terminal policy row is written.
      if (start.providerCallStarted === false) return attempt;

      let recordingFinished = false;
      // The request half is stored as soon as it is known, so the dashboard
      // shows the request while the provider is still answering. The final
      // save waits for it, so the complete recording always lands last.
      let requestSaved: Promise<void> = Promise.resolve();
      attempt.startRecording = ({ requestBody, wireFormat }) => {
        if (!recordingEnabled || !this.attemptRecording || attempt.recordingCapture) {
          return;
        }
        const capture = createAttemptRecordingCapture(requestBody, wireFormat);
        attempt.recordingCapture = capture;
        const recordingService = this.attemptRecording;
        requestSaved = attempt.pendingWrite
          .catch(() => false)
          .then(async (written) => {
            if (!written || recordingFinished) return;
            await recordingService.save(tenantId, requestId, attempt.id, capture.buildRecording());
          })
          .catch((e) => this.logger.warn(`Failed to save Provider Attempt request: ${e}`));
      };
      attempt.finishRecording = async (response) => {
        if (recordingFinished) return;
        const capture = attempt.recordingCapture;
        if (!capture || !this.attemptRecording) return;
        if (response?.type === 'stream') {
          capture.setRaw(response.raw_sse ?? '');
        } else if (response?.type === 'json') {
          capture.setJson(response.body);
        }
        recordingFinished = true;
        await requestSaved;
        if (!(await attempt.pendingWrite.catch(() => false))) return;
        await this.attemptRecording
          .save(tenantId, requestId, attempt.id, capture.buildRecording())
          .catch((e) => this.logger.warn(`Failed to finish Provider Attempt recording: ${e}`));
      };
      attempt.pendingWrite = this.recorder
        .recordPendingProviderAttempt(req.ingestionContext, requestId, attempt, start)
        .catch((e) => {
          this.logger.warn(`Failed to record pending Provider Attempt: ${e}`);
          return false;
        });
      startedAttempts.push(attempt);
      attempt.completeFailure = ({ status, errorBody, superseded }) =>
        this.recorder
          .completePendingProviderFailure(attempt, status, errorBody, superseded)
          .catch((e) => this.logger.warn(`Failed to complete Provider Attempt: ${e}`));
      return attempt;
    };

    try {
      // Each of these throws its own ThinkerError (M201 per-user, M202 per-IP,
      // M203 concurrency), so handleProxyError records which limit actually
      // fired instead of collapsing all three into one reason.
      this.rateLimiter.checkLimit(tenantId);
      this.rateLimiter.checkIpLimit(req.ip ?? '');
      this.rateLimiter.acquireSlot(tenantId);
      slotAcquired = true;
      routingBody = redactInlineImageDataUrls(body);
      const specificityOverride = req.headers['x-thinker-specificity'] as string | undefined;
      const { forward, meta, failedFallbacks } = await this.proxyService.proxyRequest({
        agentId: req.ingestionContext.agentId,
        tenantId,
        // Attribution only — the recorder writes it to agent_messages.user_id.
        userId: req.ingestionContext.userId,
        body,
        routingBody,
        sessionKey,
        sessionCacheKey: sessionScope.cacheKey,
        providerCacheKey: sessionScope.providerCacheKey,
        sessionMomentumKey: sessionScope.momentumKey,
        agentName: req.ingestionContext.agentName,
        signal: clientAbort.signal,
        specificityOverride,
        headers: req.headers,
        apiMode,
        startProviderAttempt,
      });
      currentMeta = meta;

      this.trackFirstProxyRequest(tenantId);

      const metaHeaders = buildMetaHeaders(meta);
      const providerResponse = forward.response;
      const responseCapture = forward.attempt?.recordingCapture;

      if (!providerResponse.ok) {
        const errorBody = await providerResponse.text();
        await forward.attempt?.finishRecording?.(recordingResponseFromText(errorBody));
        await handleProviderError(
          res,
          req.ingestionContext,
          meta,
          metaHeaders,
          providerResponse.status,
          errorBody,
          failedFallbacks,
          this.recorder,
          traceId,
          callerAttribution,
          requestHeaders,
          requestId,
          Date.now() - startTime,
          apiMode,
        );
        return;
      }

      const fallbackSuccessTs = recordFallbackFailures(
        req.ingestionContext,
        meta,
        failedFallbacks,
        this.recorder,
        callerAttribution,
        requestHeaders,
        requestId,
      );

      let streamUsage = null;

      const shouldStreamResponse = isStream || meta.response_mode === 'stream';

      if (shouldStreamResponse && providerResponse.body) {
        headersSent = true;
        streamUsage = await handleStreamResponse(
          res,
          forward,
          meta,
          metaHeaders,
          this.providerClient,
          this.signatureCache,
          sessionScope.cacheKey,
          this.thinkingCache,
          apiMode,
          this.reasoningCache,
          responseCapture,
        );
      } else {
        streamUsage = await handleNonStreamResponse(
          res,
          forward,
          meta,
          metaHeaders,
          this.providerClient,
          this.signatureCache,
          sessionScope.cacheKey,
          this.thinkingCache,
          apiMode,
          this.reasoningCache,
          responseCapture,
        );
      }

      await forward.attempt?.finishRecording?.();

      // A friendly stub (no provider key, no providers, usage limit) leaves the
      // proxy as an HTTP 200 assistant message, so it lands here — but it is a
      // Thinker failure, not a completion. Record it as one.
      if (meta.thinker_error_code) {
        this.recordThinkerStub(
          req,
          meta,
          requestId,
          traceId,
          sessionKey,
          callerAttribution,
          requestHeaders,
          Date.now() - startTime,
          apiMode,
        );
      } else {
        recordSuccess(
          req.ingestionContext,
          meta,
          streamUsage,
          fallbackSuccessTs,
          this.recorder,
          traceId,
          sessionKey,
          startTime,
          callerAttribution,
          requestHeaders,
          requestId,
          PRIMARY_ATTEMPT_NUMBER +
            (meta.fallbackFromModel ? (failedFallbacks?.length ?? 0) + 1 : 0),
          apiMode,
        );
      }
    } catch (err: unknown) {
      await this.handleProxyError(
        err,
        req,
        res,
        clientAbort,
        headersSent,
        requestId,
        traceId,
        callerAttribution,
        requestHeaders,
        apiMode,
        currentMeta,
        startTime,
        currentAttempt,
        currentAttemptStart,
      );
      await (currentMeta?.attempt ?? currentAttempt)?.finishRecording?.();
      if (clientAbort.signal.aborted) {
        // recordCancelledRequest completes only the last attempt. Earlier ones
        // (a failed primary, failed fallback hops) were
        // carried in the chain's local state, which the abort threw away. The
        // last one is included too: the pending guard makes it a no-op unless
        // recordCancelledRequest failed to write it.
        await this.recorder.cancelPendingProviderAttempts(startedAttempts);
      }
    } finally {
      if (slotAcquired) this.rateLimiter.releaseSlot(tenantId);
    }
  }

  /**
   * Collects the response-side marks (headers written, last byte flushed) and
   * returns the writer the close handler calls to store the whole Request
   * timeline. Writing at close means every provider mark is already final.
   */
  private trackTimeline(
    req: Request,
    res: ExpressResponse,
    requestId: string,
    tenantId: string,
    startTime: number,
    attempts: TimelineAttempt[],
  ): () => void {
    let responseStartedAtMs: number | undefined;
    let responseCompletedAtMs: number | undefined;
    const writeHead = res.writeHead;
    if (typeof writeHead === 'function') {
      res.writeHead = function (this: ExpressResponse, ...args: unknown[]) {
        responseStartedAtMs ??= Date.now();
        return (writeHead as (...a: unknown[]) => ExpressResponse).apply(this, args);
      } as typeof res.writeHead;
    }
    res.once('finish', () => {
      responseCompletedAtMs = Date.now();
    });
    return () => {
      const timeline = buildRequestTimeline({
        receivedAtMs: requestReceivedAtMs(req, startTime),
        attempts,
        responseStartedAtMs,
        responseCompletedAtMs,
      });
      void this.recorder
        .recordRequestTimeline(tenantId, requestId, timeline)
        .catch((e) => this.logger.warn(`Failed to record Request timeline: ${e}`));
    };
  }

  /**
   * Record the HTTP-200 friendly stub Thinker returned in place of a completion.
   * `meta.thinker_error_message` is the rendered `[🦚 Thinker M100] …` text the
   * caller actually saw — persisting it verbatim (rather than a generic
   * "Provider API key missing") is what makes the row debuggable.
   */
  private recordThinkerStub(
    req: Request & { ingestionContext: IngestionContext },
    meta: RoutingMeta,
    requestId: string,
    traceId: string | undefined,
    sessionKey: string | undefined,
    callerAttribution: ReturnType<typeof classifyCaller>,
    requestHeaders: ReturnType<typeof recordedRequestHeaders>,
    durationMs: number,
    apiMode: ProxyApiMode,
  ): void {
    const code = meta.thinker_error_code;
    if (!code || !isRecordableThinkerCode(code)) return;
    this.recorder
      .recordThinkerBlockedRequest(req.ingestionContext, {
        requestId,
        errorMessage: meta.thinker_error_message ?? formatThinkerError(code),
        errorCode: code,
        reason: THINKER_CODE_TO_REASON[code],
        model: this.extractRequestedModel(req.body as Record<string, unknown> | undefined),
        traceId,
        sessionKey,
        callerAttribution,
        requestHeaders,
        durationMs,
        apiMode,
        // Stubs carry no routing decision, but a stub raised for a virtual
        // model (M301, or a credential failure in its chain) names it.
        ...virtualModelRouting(meta),
      })
      .catch((e) => this.logger.warn(`Failed to record Thinker stub: ${e}`));
  }

  private async handleProxyError(
    err: unknown,
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    clientAbort: AbortController,
    headersSent: boolean,
    requestId: string,
    traceId: string | undefined,
    callerAttribution: ReturnType<typeof classifyCaller>,
    requestHeaders: ReturnType<typeof recordedRequestHeaders>,
    apiMode: ProxyApiMode,
    meta?: RoutingMeta,
    startTime?: number,
    currentAttempt?: ProviderAttemptRef,
    currentAttemptStart?: ProviderAttemptStart,
  ): Promise<void> {
    const capture = (meta?.attempt ?? currentAttempt)?.recordingCapture;
    if (clientAbort.signal.aborted) {
      await this.recorder
        .recordCancelledRequest(req.ingestionContext, {
          requestId,
          attempt: meta?.attempt ?? currentAttempt,
          attemptStart: currentAttemptStart,
          requestDurationMs: startTime == null ? undefined : Date.now() - startTime,
          traceId,
          apiMode,
          usage: partialUsageOf(err),
        })
        .catch((e) => this.logger.warn(`Failed to record cancelled Request: ${e}`));
      if (!res.writableEnded) res.end();
      return;
    }

    const message = this.extractErrorMessage(err);
    const status =
      err instanceof StreamFailure
        ? err.status
        : err instanceof ResponsesSseError
          ? err.status
          : err instanceof HttpException
            ? err.getStatus()
            : 500;
    const providerErrorBody = err instanceof ResponsesSseError ? err.body : message;
    // `message` is the raw upstream body for a ResponsesSseError, so scrub it
    // before it reaches stdout (the recorded/returned copies already are).
    this.logger.error(`Proxy error: ${scrubSecrets(message)}`);

    // Who failed? A ThinkerError says so explicitly. Pre-response dead sockets
    // and timeouts become synthetic 503/504 responses in proxy-transport. A
    // socket that dies after streaming starts is thrown as StreamFailure.
    // Other non-HTTP throws are Thinker's own bugs (M500).
    //
    // An unrecordable ThinkerError (M001–M003, M005, M006) writes NOTHING: it has no
    // tenant to attribute, and falling through to recordProviderError would blame
    // the provider for someone presenting a bad key.
    if (err instanceof ThinkerError) {
      if (isRecordableThinkerCode(err.code)) {
        this.recordThinkerBlockedRequest(
          err,
          req,
          requestId,
          traceId,
          callerAttribution,
          requestHeaders,
          THINKER_CODE_TO_REASON[err.code],
          apiMode,
          status,
          err.code,
          startTime == null ? undefined : Date.now() - startTime,
          meta,
        );
      }
    } else if (
      !(err instanceof StreamFailure) &&
      !(err instanceof ResponsesSseError) &&
      !(err instanceof HttpException)
    ) {
      // A non-HTTP throw is Thinker's own bug, never a provider fault.
      this.recordThinkerBlockedRequest(
        err,
        req,
        requestId,
        traceId,
        callerAttribution,
        requestHeaders,
        THINKER_CODE_TO_REASON.M500,
        apiMode,
        status,
        'M500',
        startTime == null ? undefined : Date.now() - startTime,
        meta,
      );
    } else {
      this.recorder
        .recordProviderError(req.ingestionContext, status, providerErrorBody, {
          requestId,
          ...(meta
            ? {
                attempt: meta.attempt,
                attemptNumber: meta.attempt?.attemptNumber,
                skipAttempt: meta.providerCallStarted === false,
                model: meta.model,
                provider: meta.provider,
                tier: meta.tier,
                fallbackFromModel: meta.fallbackFromModel,
                fallbackIndex: meta.fallbackIndex,
                authType: meta.auth_type,
                reason: meta.reason,
                specificityCategory: meta.specificity_category,
                providerKeyLabel: meta.provider_key_label,
                tenantProviderId: meta.tenantProviderId,
                requestParams: meta.request_params,
                virtualModelId: meta.virtual_model_id,
                virtualModelName: meta.virtual_model_name,
              }
            : {}),
          traceId,
          callerAttribution,
          requestHeaders,
          requestDurationMs: startTime == null ? undefined : Date.now() - startTime,
          apiMode,
        })
        .catch((e) => this.logger.warn(`Failed to record provider error: ${e}`));
    }

    if (headersSent) {
      if (!res.writableEnded) {
        if (err instanceof StreamFailure) {
          this.writeStreamError(res, apiMode, err, meta);
        } else {
          res.end();
        }
      }
      return;
    }

    if (err instanceof ResponsesSseError) {
      const responseBody = {
        error: buildOpenAiCompatibleError(
          err.status,
          err.body,
          meta ? { provider: meta.provider, model: meta.model } : {},
        ),
      };
      capture?.setJson(responseBody);
      res.status(err.status).json(responseBody);
      return;
    }

    // Rate limit errors stay as HTTP 429 so clients can backoff
    if (status === 429) {
      // Never return the exception response object itself: framework and
      // provider exceptions can carry stack traces or markup. Thinker's
      // rate-limit messages come from our static catalogue; provider failures
      // use a stable public message.
      const rateLimitMessage =
        err instanceof ThinkerError
          ? formatThinkerError(err.code)
          : 'Rate limited by upstream provider';
      const responseBody = {
        error: { message: rateLimitMessage, type: 'rate_limit_error' },
      };
      capture?.setJson(responseBody);
      res.status(429).json(responseBody);
      return;
    }

    const isStream = (req.body as Record<string, unknown>)?.stream === true;
    if (isChatRenderingClient(req)) {
      const clientMessage = status >= 500 ? formatThinkerError('M500') : message;
      sendFriendlyResponse(res, clientMessage, isStream);
      return;
    }

    // Tool/monitor caller — surface the real HTTP status with a structured
    // envelope so CI pipelines can detect failures instead of treating the
    // friendly stub as success.
    const errorMessage =
      status >= 500 ? 'Thinker encountered an internal error. Try again shortly.' : message;
    const responseBody = {
      error: {
        message: errorMessage,
        type: status >= 500 ? 'server_error' : 'invalid_request_error',
      },
    };
    capture?.setJson(responseBody);
    res.status(status).json(responseBody);
  }

  private writeStreamError(
    res: ExpressResponse,
    apiMode: ProxyApiMode,
    streamError: StreamFailure,
    meta: RoutingMeta | undefined,
  ): void {
    const error = buildOpenAiCompatibleError(streamError.status, streamError.message, {
      source: 'provider',
      code: streamError.reason,
      provider: meta?.provider,
      model: meta?.model,
    });
    error.message = streamError.message;

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    if (apiMode === 'messages') {
      res.write(
        `event: error\ndata: ${safeJsonStringify({
          type: 'error',
          error: { type: 'api_error', message: streamError.message },
        })}\n\n`,
      );
    } else if (apiMode === 'responses') {
      res.write(
        `event: error\ndata: ${safeJsonStringify({
          type: 'error',
          code: error.code ?? 'server_error',
          message: streamError.message,
          param: null,
          sequence_number: nextResponsesSequenceNumber(res),
        })}\n\n`,
      );
    } else {
      res.write(`data: ${safeJsonStringify({ error })}\n\ndata: [DONE]\n\n`);
    }
    res.end();
  }

  private extractTraceId(req: Request): string | undefined {
    const header = req.headers['traceparent'] as string | undefined;
    if (!header) return undefined;
    const parts = header.split('-');
    return parts.length >= 2 ? parts[1] : undefined;
  }

  private extractSessionKey(req: Request & { ingestionContext: IngestionContext }): string {
    return buildProxySessionScope(
      req.ingestionContext.tenantId,
      req.ingestionContext.agentId,
      detectHarnessSession(req.headers)?.id,
    ).sessionKey;
  }

  private extractRequestedModel(body: Record<string, unknown> | undefined): string | undefined {
    const model = body?.model;
    return typeof model === 'string' && model.length > 0 ? model : undefined;
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof ResponsesSseError) return err.body;
    if (err instanceof HttpException) {
      const response = err.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object') {
        const record = response as Record<string, unknown>;
        const message = record.message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join(', ');
        const error = record.error;
        if (typeof error === 'string') return error;
        if (error && typeof error === 'object') {
          const nested = (error as Record<string, unknown>).message;
          if (typeof nested === 'string') return nested;
        }
        const code = record.code;
        if (typeof code === 'string') return code;
      }
    }
    return err instanceof Error ? err.message : String(err);
  }

  private recordThinkerBlockedRequest(
    err: unknown,
    req: Request & { ingestionContext: IngestionContext },
    requestId: string,
    traceId: string | undefined,
    callerAttribution: ReturnType<typeof classifyCaller>,
    requestHeaders: ReturnType<typeof recordedRequestHeaders>,
    reason: ThinkerBlockedRequestReason,
    apiMode: ProxyApiMode,
    httpStatus?: number,
    errorCode?: ThinkerErrorCode,
    durationMs?: number,
    meta?: RoutingMeta,
  ): void {
    const body = req.body as Record<string, unknown> | undefined;
    this.recorder
      .recordThinkerBlockedRequest(req.ingestionContext, {
        requestId,
        httpStatus: httpStatus ?? (err instanceof HttpException ? err.getStatus() : 500),
        // The raw internal message, not the friendly M500 text the caller saw —
        // the dashboard row is where you go to find out what actually broke.
        errorMessage: this.extractErrorMessage(err),
        errorCode,
        reason,
        model: this.extractRequestedModel(body),
        traceId,
        sessionKey: this.extractSessionKey(req),
        callerAttribution,
        requestHeaders,
        durationMs,
        apiMode,
        // A friendly stub's meta is a placeholder (provider 'thinker', tier
        // 'simple'), not a routing decision, so only a real route stamps tiers.
        // The virtual model the caller named is real either way.
        ...(meta && meta.provider !== 'thinker'
          ? {
              routing: {
                tier: meta.tier,
                specificityCategory: meta.specificity_category,
                virtualModelId: meta.virtual_model_id,
                virtualModelName: meta.virtual_model_name,
              },
            }
          : virtualModelRouting(meta)),
      })
      .catch((e) => this.logger.warn(`Failed to record Thinker-blocked request: ${e}`));
  }

  private trackFirstProxyRequest(tenantId: string): void {
    const now = Date.now();
    if (this.seenTenants.has(tenantId)) return;
    this.evictExpiredTenants(now);
    if (this.seenTenants.size >= MAX_SEEN_TENANTS) {
      const oldest = this.seenTenants.keys().next().value as string;
      this.seenTenants.delete(oldest);
    }
    this.seenTenants.set(tenantId, now);
  }

  private evictExpiredTenants(now: number): void {
    for (const [key, timestamp] of this.seenTenants) {
      if (now - timestamp > SEEN_TENANT_TTL_MS) {
        this.seenTenants.delete(key);
      } else {
        break;
      }
    }
  }
}
