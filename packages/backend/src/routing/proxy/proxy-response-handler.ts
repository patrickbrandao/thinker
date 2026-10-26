import { stripGatewayMarker } from './proxy-transport';
import { Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { Response as ExpressResponse } from 'express';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { RoutingMeta } from './proxy.service';
import { FailedFallback } from './proxy-fallback.service';
import { ForwardResult } from './provider-client';
import { ProxyMessageRecorder } from './proxy-message-recorder';
import { ProviderClient } from './provider-client';
import {
  initSseHeaders,
  parseUsageObject,
  pipePassthrough,
  pipeStream,
  StreamUsage,
} from './stream-writer';
import { createSsePayloadParser } from './sse-parser';
import {
  classifyProviderError,
  openAiErrorTypeForStatus,
  parseStructuredProviderError,
  sanitizeProviderError,
} from './proxy-error-sanitizer';
import { scrubSecrets } from '../../common/utils/secret-scrub';
import {
  collectResponsesSseResponse,
  createResponsesStreamTransformer,
  fromChatCompletionResponse,
} from './responses-adapter';
import {
  chatCompletionsResponseToMessages,
  createMessagesStreamTransformer,
} from './anthropic-messages-adapter';
import type { ProxyApiMode } from './proxy-types';
import type { ThoughtSignatureCache } from './thought-signature-cache';
import type {
  ThinkingBlockCache,
  ThinkingBlock,
  ThinkingBlockRouteContext,
} from './thinking-block-cache';
import type { ReasoningContentCache } from './reasoning-content-cache';
import {
  createGoogleStreamState,
  finishGoogleStream,
  type ExtractedSignature,
} from './google-adapter';
import {
  extractThinkingBlocksFromMessagesResponse,
  type ExtractedThinkingBlocks,
} from './anthropic-adapter';
import { getOpenAiReasoningStreamFormat, supportsReasoningContent } from './reasoning-format';
import type { CallerAttribution } from './caller-classifier';
import {
  unwrapCodeAssistResponse,
  unwrapCodeAssistStreamPayload,
} from '../oauth/gemini/codeassist-envelope';
import type { AttemptRecordingCapture } from './attempt-recording-capture';

const logger = new Logger('ProxyResponseHandler');

/** The primary provider call is always the request's first attempt. */
export const PRIMARY_ATTEMPT_NUMBER = 1;

interface ResponsesSequenceTracker {
  feed(chunk: string): void;
  next(): number;
}

function createResponsesSequenceTracker(): ResponsesSequenceTracker {
  const parser = createSsePayloadParser();
  let nextSequenceNumber = 0;

  const feed = (chunk: string): void => {
    for (const event of parser.feed(chunk)) {
      const payload = event
        .split('\n')
        .filter((line) => !line.startsWith('event:') && !line.startsWith('id:'))
        .join('\n');
      try {
        const data = JSON.parse(payload) as { sequence_number?: unknown };
        const sequenceNumber = data.sequence_number;
        if (
          typeof sequenceNumber === 'number' &&
          Number.isInteger(sequenceNumber) &&
          sequenceNumber >= 0
        ) {
          nextSequenceNumber = Math.max(nextSequenceNumber, sequenceNumber + 1);
        } else {
          nextSequenceNumber += 1;
        }
      } catch {
        nextSequenceNumber += 1;
      }
    }
  };

  return { feed, next: () => nextSequenceNumber };
}

const responsesSequenceTrackers = new WeakMap<ExpressResponse, ResponsesSequenceTracker>();

export function nextResponsesSequenceNumber(res: ExpressResponse): number {
  return responsesSequenceTrackers.get(res)?.next() ?? 0;
}

function recordSafely(promise: Promise<unknown>, label: string): void {
  promise.catch((e) => logger.warn(`Failed to record ${label}: ${e}`));
}

function thinkingRouteContext(meta: RoutingMeta): ThinkingBlockRouteContext {
  return {
    provider: meta.provider,
    authType: meta.auth_type,
    model: meta.model,
  };
}

export function buildMetaHeaders(meta: RoutingMeta): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Thinker-Tier': meta.tier,
    'X-Thinker-Model': meta.model,
    'X-Thinker-Provider': meta.provider,
    'X-Thinker-Confidence': String(meta.confidence),
    'X-Thinker-Reason': meta.reason,
    'X-Thinker-Output-Modality': meta.output_modality ?? 'text',
    'X-Thinker-Response-Mode': meta.response_mode ?? 'buffered',
  };
  if (meta.specificity_category) {
    headers['X-Thinker-Specificity'] = meta.specificity_category;
  }
  // Virtual model names are restricted to header-safe characters (ADR 0004,
  // section 3), so the spelling the operator chose goes out as is.
  if (meta.virtual_model_name) {
    headers['X-Thinker-Virtual-Model'] = meta.virtual_model_name;
  }
  if (meta.fallbackFromModel) {
    headers['X-Thinker-Fallback-From'] = meta.fallbackFromModel;
    headers['X-Thinker-Fallback-Index'] = String(meta.fallbackIndex ?? 0);
  }
  return headers;
}

function setHeaders(res: ExpressResponse, headers: Record<string, string>): void {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
}

type OpenAiErrorSource = 'provider' | 'thinker';

export function buildOpenAiCompatibleError(
  status: number,
  errorBody: string,
  opts: {
    source?: OpenAiErrorSource;
    code?: string | null;
    provider?: string;
    model?: string;
    apiMode?: ProxyApiMode;
    extra?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const classified = classifyProviderError(status, errorBody);
  const structured = parseStructuredProviderError(status, errorBody);
  return {
    message:
      classified?.message ??
      structured?.message ??
      sanitizeProviderError(status, errorBody, process.env.NODE_ENV),
    type:
      classified?.type ??
      structured?.type ??
      (opts.apiMode === 'messages' && status >= 500
        ? status === 529
          ? 'overloaded_error'
          : 'api_error'
        : openAiErrorTypeForStatus(status)),
    param: structured?.param ?? null,
    code: opts.code !== undefined ? opts.code : (classified?.code ?? structured?.code ?? null),
    status,
    source: opts.source ?? classified?.source ?? 'provider',
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.extra ?? {}),
  };
}

export async function handleProviderError(
  res: ExpressResponse,
  ctx: IngestionContext,
  meta: RoutingMeta,
  metaHeaders: Record<string, string>,
  errorStatus: number,
  errorBody: string,
  failedFallbacks: FailedFallback[] | undefined,
  recorder: ProxyMessageRecorder,
  traceId?: string,
  callerAttribution?: CallerAttribution | null,
  requestHeaders?: Record<string, string> | null,
  requestId: string = uuid(),
  requestDurationMs?: number,
  apiMode?: ProxyApiMode,
): Promise<void> {
  if (failedFallbacks && failedFallbacks.length > 0 && !meta.fallbackFromModel) {
    await handleFallbackExhausted(
      res,
      ctx,
      meta,
      metaHeaders,
      errorStatus,
      errorBody,
      failedFallbacks,
      recorder,
      traceId,
      callerAttribution,
      requestHeaders,
      requestId,
      requestDurationMs,
      apiMode,
    );
    return;
  }

  recordSafely(
    recorder.recordProviderError(ctx, errorStatus, errorBody, {
      requestId,
      attemptNumber: PRIMARY_ATTEMPT_NUMBER,
      attempt: meta.attempt,
      skipAttempt: meta.providerCallStarted === false,
      requestDurationMs,
      model: meta.model,
      provider: meta.provider,
      tier: meta.tier,
      traceId,
      fallbackFromModel: meta.fallbackFromModel,
      fallbackIndex: meta.fallbackIndex,
      authType: meta.auth_type,
      reason: meta.reason,
      specificityCategory: meta.specificity_category,
      providerKeyLabel: meta.provider_key_label,
      tenantProviderId: meta.tenantProviderId,
      callerAttribution,
      requestHeaders,
      requestParams: meta.request_params,
      headerTierId: meta.header_tier_id,
      headerTierName: meta.header_tier_name,
      headerTierColor: meta.header_tier_color,
      virtualModelId: meta.virtual_model_id,
      virtualModelName: meta.virtual_model_name,
      apiMode,
    }),
    'provider error',
  );

  // Scrub BEFORE slicing: a credential straddling the 500-char cut would
  // otherwise survive in fragments. Some providers (Anthropic 401s) echo the
  // caller's Authorization / x-api-key header back inside the error body.
  logger.warn(
    `Upstream error ${errorStatus}: provider=${meta.provider} model=${meta.model} tier=${meta.tier} body=${scrubSecrets(stripGatewayMarker(errorBody)).slice(0, 500)}`,
  );
  res.status(errorStatus);
  setHeaders(res, metaHeaders);
  const responseBody = {
    ...(apiMode === 'messages' ? { type: 'error' } : {}),
    error: buildOpenAiCompatibleError(errorStatus, errorBody, {
      source: 'provider',
      provider: meta.provider,
      model: meta.model,
      apiMode,
    }),
  };
  res.json(responseBody);
}

function handleFallbackExhausted(
  res: ExpressResponse,
  ctx: IngestionContext,
  meta: RoutingMeta,
  metaHeaders: Record<string, string>,
  errorStatus: number,
  errorBody: string,
  failedFallbacks: FailedFallback[],
  recorder: ProxyMessageRecorder,
  traceId: string | undefined,
  callerAttribution: CallerAttribution | null | undefined,
  requestHeaders: Record<string, string> | null | undefined,
  requestId: string,
  requestDurationMs?: number,
  apiMode?: ProxyApiMode,
): void {
  const baseTime = Date.now();
  const primaryAttemptNumber = PRIMARY_ATTEMPT_NUMBER;
  recordSafely(
    recorder.recordFailedFallbacks(ctx, meta.tier, meta.model, failedFallbacks, {
      requestId,
      firstAttemptNumber: primaryAttemptNumber + 1,
      traceId,
      baseTimeMs: baseTime,
      markHandled: true,
      lastAsError: true,
      authType: meta.auth_type,
      providerKeyLabel: meta.provider_key_label,
      reason: meta.reason,
      callerAttribution,
      requestHeaders,
      requestParams: meta.request_params,
      headerTierId: meta.header_tier_id,
      headerTierName: meta.header_tier_name,
      headerTierColor: meta.header_tier_color,
      virtualModelId: meta.virtual_model_id,
      virtualModelName: meta.virtual_model_name,
    }),
    'fallback errors',
  );

  const primaryTs = new Date(baseTime + (failedFallbacks.length + 1) * 100).toISOString();
  recordSafely(
    recorder.recordPrimaryFailure(
      ctx,
      meta.tier,
      meta.model,
      errorBody,
      primaryTs,
      meta.auth_type,
      {
        requestId,
        attemptNumber: primaryAttemptNumber,
        attempt: meta.primaryAttempt,
        skipAttempt: meta.primaryProviderCallStarted === false,
        requestDurationMs,
        provider: meta.provider,
        reason: meta.reason,
        // Exhausted chain: primary connection (meta.tenantProviderId holds it here).
        tenantProviderId: meta.tenantProviderId,
        providerKeyLabel: meta.provider_key_label,
        callerAttribution,
        requestHeaders,
        requestParams: meta.request_params,
        headerTierId: meta.header_tier_id,
        headerTierName: meta.header_tier_name,
        headerTierColor: meta.header_tier_color,
        virtualModelId: meta.virtual_model_id,
        virtualModelName: meta.virtual_model_name,
        httpStatus: errorStatus,
        terminalHttpStatus: errorStatus,
        apiMode,
      },
    ),
    'primary failure',
  );

  logger.warn(
    `Fallback chain exhausted: ${scrubSecrets(stripGatewayMarker(errorBody)).slice(0, 200)}`,
  );
  res.status(errorStatus);
  setHeaders(res, metaHeaders);
  res.setHeader('X-Thinker-Fallback-Exhausted', 'true');
  const attempted = attemptedFallbackEntries(failedFallbacks, apiMode);
  // Every attempt reached a provider, so the error is provider-authored: the
  // exhaustion is a routing outcome (the boolean + header), not an error class,
  // and `code` keeps whatever the primary provider sent (null when nothing).
  const primary = buildOpenAiCompatibleError(errorStatus, errorBody, {
    source: 'provider',
    provider: meta.provider,
    model: meta.model,
    apiMode,
    extra: {
      auth_type: meta.auth_type ?? null,
      fallback_exhausted: true,
      primary_model: meta.model,
      primary_provider: meta.provider,
      attempted_fallbacks: attempted,
    },
  });
  const responseBody = {
    ...(apiMode === 'messages' ? { type: 'error' } : {}),
    error: {
      ...primary,
      message: exhaustedMessage(primary.message as string, [
        { provider: meta.provider, model: meta.model, status: errorStatus },
        ...attempted,
      ]),
    },
  };
  res.json(responseBody);
}

/** One wire entry per fallback hop, each with the same sanitized message/code the primary gets. */
function attemptedFallbackEntries(
  failedFallbacks: FailedFallback[],
  apiMode?: ProxyApiMode,
): Array<Record<string, unknown> & { provider: string; model: string; status: number }> {
  return failedFallbacks.map((f) => {
    const hop = buildOpenAiCompatibleError(f.status, f.errorBody, { apiMode });
    return {
      model: f.model,
      provider: f.provider,
      auth_type: f.authType ?? null,
      status: f.status,
      code: hop.code ?? null,
      message: hop.message,
    };
  });
}

/** Lead with the primary provider's own sentence, then list the chain. */
function exhaustedMessage(
  primaryMessage: string,
  attempts: Array<{ provider: string; model: string; status: number }>,
): string {
  const lead = /[.!?]$/.test(primaryMessage) ? primaryMessage : `${primaryMessage}.`;
  const list = attempts.map((a) => `${a.provider}/${a.model} ${a.status}`).join(', ');
  return `${lead} Every attempt failed: ${list}.`;
}

export function recordFallbackFailures(
  ctx: IngestionContext,
  meta: RoutingMeta,
  failedFallbacks: FailedFallback[] | undefined,
  recorder: ProxyMessageRecorder,
  callerAttribution?: CallerAttribution | null,
  requestHeaders?: Record<string, string> | null,
  requestId: string = uuid(),
): string | undefined {
  if (!meta.fallbackFromModel) return undefined;

  const fallbackBaseTime = Date.now();
  const failures = failedFallbacks ?? [];
  const primaryAttemptNumber = PRIMARY_ATTEMPT_NUMBER;

  // The primary's auth_type is preserved separately on a fallback-success flow
  // (see RoutingMeta.primaryAuthType / #1173). Older meta shapes only carry
  // `auth_type`, so fall back to it when primaryAuthType is absent.
  const primaryAuthType = meta.primaryAuthType ?? meta.auth_type;
  recordSafely(
    recorder.recordPrimaryFailure(
      ctx,
      meta.tier,
      meta.fallbackFromModel,
      meta.primaryErrorBody ?? `Provider returned HTTP ${meta.primaryErrorStatus ?? 500}`,
      new Date(fallbackBaseTime).toISOString(),
      primaryAuthType,
      {
        requestId,
        attemptNumber: primaryAttemptNumber,
        attempt: meta.primaryAttempt,
        skipAttempt: meta.primaryProviderCallStarted === false,
        // Use the primary provider explicitly — meta.provider holds the
        // succeeding fallback's provider in this flow, not the primary's.
        provider: meta.primaryProvider,
        reason: meta.reason,
        // meta.tenantProviderId holds the winning fallback here; the primary's id
        // is preserved separately (mirrors primaryProvider / primaryAuthType).
        // Compare against undefined, not ??, so an explicit null primary
        // connection (e.g. Ollama) stays null rather than being misattributed
        // to the fallback's connection.
        tenantProviderId:
          meta.primaryTenantProviderId === undefined
            ? meta.tenantProviderId
            : meta.primaryTenantProviderId,
        // meta.provider_key_label holds the winning fallback's label in this
        // flow, so prefer the preserved primary label (mirrors the id above).
        providerKeyLabel: meta.primaryKeyLabel ?? meta.provider_key_label,
        callerAttribution,
        requestHeaders,
        // meta.request_params is the winning fallback's snapshot in this flow.
        requestParams:
          meta.primaryRequestParams !== undefined ? meta.primaryRequestParams : meta.request_params,
        headerTierId: meta.header_tier_id,
        headerTierName: meta.header_tier_name,
        headerTierColor: meta.header_tier_color,
        virtualModelId: meta.virtual_model_id,
        virtualModelName: meta.virtual_model_name,
        httpStatus: meta.primaryErrorStatus,
      },
    ),
    'primary failure',
  );

  if (failures.length > 0) {
    recordSafely(
      recorder.recordFailedFallbacks(ctx, meta.tier, meta.fallbackFromModel, failures, {
        requestId,
        firstAttemptNumber: primaryAttemptNumber + 1,
        baseTimeMs: fallbackBaseTime,
        markHandled: true,
        authType: primaryAuthType,
        providerKeyLabel: meta.primaryKeyLabel ?? meta.provider_key_label,
        reason: meta.reason,
        callerAttribution,
        requestHeaders,
        requestParams: meta.request_params,
        headerTierId: meta.header_tier_id,
        headerTierName: meta.header_tier_name,
        headerTierColor: meta.header_tier_color,
        virtualModelId: meta.virtual_model_id,
        virtualModelName: meta.virtual_model_name,
      }),
      'fallback errors',
    );
  }

  return new Date(fallbackBaseTime + (failures.length + 1) * 100).toISOString();
}

export async function handleStreamResponse(
  res: ExpressResponse,
  forward: ForwardResult,
  meta: RoutingMeta,
  metaHeaders: Record<string, string>,
  providerClient: ProviderClient,
  signatureCache?: ThoughtSignatureCache,
  sessionKey?: string,
  thinkingCache?: ThinkingBlockCache,
  apiMode: ProxyApiMode = 'chat_completions',
  reasoningCache?: ReasoningContentCache,
  capture?: AttemptRecordingCapture,
): Promise<StreamUsage | null> {
  initSseHeaders(res, metaHeaders, 200);

  const responsesSequenceTracker =
    apiMode === 'responses' ? createResponsesSequenceTracker() : null;
  if (responsesSequenceTracker) responsesSequenceTrackers.set(res, responsesSequenceTracker);
  const onClient = responsesSequenceTracker
    ? (chunk: string) => responsesSequenceTracker.feed(chunk)
    : undefined;
  const relayOptions = {
    protocol:
      forward.wireFormat ??
      (forward.isGoogle
        ? forward.isCodeAssist
          ? ('google_code_assist' as const)
          : ('google_generate_content' as const)
        : forward.isAnthropic
          ? ('anthropic_messages' as const)
          : forward.isChatGpt || forward.isResponses
            ? ('openai_responses' as const)
            : ('openai_chat_completions' as const)),
    ...(capture ? { onUpstreamChunk: (chunk: string) => capture.appendRaw(chunk) } : {}),
  };

  const messagesTransformer =
    apiMode === 'messages' ? createMessagesStreamTransformer(meta.model) : null;
  // Responses inbound over a Chat Completions upstream needs a stateful
  // converter so the message-item lifecycle events frame the text deltas
  // (issue #2064). It shares the messages transformer's {transform, finalize}
  // shape, and likewise owns stream termination via `finalize` (which emits
  // the trailing `[DONE]` that pipeStream then skips).
  const responsesTransformer =
    apiMode === 'responses'
      ? createResponsesStreamTransformer(meta.model, {
          textFormat: forward.responsesTextFormat,
          toolNames: forward.responsesToolNames,
        })
      : null;
  const streamTransformer = messagesTransformer ?? responsesTransformer;
  const finalize = streamTransformer ? () => streamTransformer.finalize() : undefined;
  const toClientChunk = streamTransformer
    ? (chunk: string) => streamTransformer.transform(chunk)
    : (chunk: string) => chunk;

  if (apiMode === 'responses' && forward.isResponses) {
    return pipeStream(forward.response.body!, res, undefined, undefined, onClient, relayOptions);
  }

  if (forward.isGoogle) {
    const googleState = createGoogleStreamState();
    return pipeStream(
      forward.response.body!,
      res,
      (chunk) => {
        const innerChunk = forward.isCodeAssist ? unwrapCodeAssistStreamPayload(chunk) : chunk;
        const { chunk: out, signatures } = providerClient.convertGoogleStreamChunk(
          innerChunk,
          meta.model,
          googleState,
        );
        if (signatureCache && sessionKey) {
          for (const s of signatures) {
            signatureCache.store(sessionKey, s.toolCallId, s.signature);
          }
        }
        return out ? toClientChunk(out) : null;
      },
      () => {
        // A truncated stream still reports its last cumulative usage. A
        // finalize hook makes pipeStream skip its own [DONE], so add it here.
        const tail = finishGoogleStream(googleState, meta.model);
        const tailOut = tail ? toClientChunk(tail) : null;
        const end = finalize ? finalize() : 'data: [DONE]\n\n';
        return (tailOut ?? '') + (end ?? '') || null;
      },
      onClient,
      relayOptions,
    );
  }
  if (forward.isAnthropic) {
    const onThinkingBlocks =
      thinkingCache && sessionKey
        ? (firstToolUseId: string, blocks: ThinkingBlock[]) => {
            thinkingCache.store(sessionKey, firstToolUseId, blocks, thinkingRouteContext(meta));
          }
        : undefined;
    const anthropicTransformer = providerClient.createAnthropicStreamTransformer(
      meta.model,
      onThinkingBlocks,
    );
    // Anthropic Messages inbound + Anthropic upstream: forward the upstream
    // SSE bytes byte-for-byte so Anthropic SSE framing (`event:` headers,
    // multi-line `data:` payloads, blank-line separators) reaches the
    // client intact, and Anthropic-only content blocks (`server_tool_use`,
    // `web_search_tool_result`, etc.) are not lost to translation. The
    // transformer runs purely as a tap — thinking-block cache via callback
    // and OpenAI-shape usage parsed off its return value by pipePassthrough.
    if (apiMode === 'messages') {
      return pipePassthrough(
        forward.response.body!,
        res,
        anthropicTransformer,
        onClient,
        relayOptions,
      );
    }
    return pipeStream(
      forward.response.body!,
      res,
      (chunk) => {
        const out = anthropicTransformer(chunk);
        return out ? toClientChunk(out) : null;
      },
      finalize,
      onClient,
      relayOptions,
    );
  }
  // A native Responses upstream speaks the same Responses SSE the ChatGPT
  // transformer converts.
  if (forward.isChatGpt || forward.isResponses) {
    // Stateful: must be created once per stream and fed events in order.
    const chatGptTransformer = providerClient.createChatGptStreamTransformer(meta.model);
    return pipeStream(
      forward.response.body!,
      res,
      (chunk) => {
        const out = chatGptTransformer(chunk);
        if (!messagesTransformer) return out;
        return out ? toClientChunk(out) : null;
      },
      finalize,
      onClient,
      relayOptions,
    );
  }
  const reasoningStreamFormat = getOpenAiReasoningStreamFormat(
    meta.provider,
    meta.model,
    reasoningCache?.modelCatalog,
  );
  if (reasoningStreamFormat) {
    const onReasoningContent =
      reasoningCache && sessionKey
        ? (firstToolCallId: string, content: string) => {
            reasoningCache.store(sessionKey, firstToolCallId, content);
          }
        : undefined;
    const transformer = providerClient.createReasoningContentStreamTransformer(
      onReasoningContent,
      reasoningStreamFormat,
    );
    return pipeStream(
      forward.response.body!,
      res,
      (chunk) => {
        const out = transformer(chunk);
        return out ? toClientChunk(out) : null;
      },
      finalize,
      onClient,
      relayOptions,
    );
  }
  if (apiMode === 'responses' || apiMode === 'messages') {
    return pipeStream(forward.response.body!, res, toClientChunk, finalize, onClient, relayOptions);
  }
  return pipeStream(forward.response.body!, res, undefined, undefined, onClient, relayOptions);
}

function cacheReasoningContent(
  responseBody: unknown,
  cache: ReasoningContentCache | undefined,
  sessionKey: string | undefined,
): void {
  if (!cache || !sessionKey) return;
  const body = responseBody as Record<string, unknown> | undefined;
  const choices = body?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return;
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== 'object' || Array.isArray(firstChoice)) return;
  const message = (firstChoice as Record<string, unknown>).message as
    Record<string, unknown> | undefined;
  if (!message) return;
  const reasoningContent = message.reasoning_content;
  if (typeof reasoningContent !== 'string' || !reasoningContent) return;
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const firstToolCall = toolCalls[0];
    const firstToolCallId =
      firstToolCall && typeof firstToolCall === 'object' && !Array.isArray(firstToolCall)
        ? (firstToolCall as Record<string, unknown>).id
        : undefined;
    if (typeof firstToolCallId === 'string' && firstToolCallId) {
      cache.store(sessionKey, firstToolCallId, reasoningContent);
      return;
    }
  }
}

export async function handleNonStreamResponse(
  res: ExpressResponse,
  forward: ForwardResult,
  meta: RoutingMeta,
  metaHeaders: Record<string, string>,
  providerClient: ProviderClient,
  signatureCache?: ThoughtSignatureCache,
  sessionKey?: string,
  thinkingCache?: ThinkingBlockCache,
  apiMode: ProxyApiMode = 'chat_completions',
  reasoningCache?: ReasoningContentCache,
  capture?: AttemptRecordingCapture,
): Promise<StreamUsage | null> {
  let responseBody: unknown;
  const recordedResponse = capture ? forward.response.clone() : null;

  if (apiMode === 'responses' && forward.isResponses) {
    responseBody = await readNativeResponsesBody(forward.response);
  } else if (forward.isGoogle) {
    const rawData = (await forward.response.json()) as Record<string, unknown>;
    const googleData = forward.isCodeAssist ? unwrapCodeAssistResponse(rawData) : rawData;
    responseBody = providerClient.convertGoogleResponse(googleData, meta.model);
    const sigs = (responseBody as Record<string, unknown>)?._extractedSignatures as
      ExtractedSignature[] | undefined;
    if (sigs && signatureCache && sessionKey) {
      for (const s of sigs) signatureCache.store(sessionKey, s.toolCallId, s.signature);
    }
    // Always strip the internal side-channel — it must never reach the client,
    // even if the cache wasn't provided for this request.
    delete (responseBody as Record<string, unknown>)._extractedSignatures;
  } else if (apiMode === 'messages' && forward.isAnthropic) {
    // Anthropic Messages inbound + Anthropic upstream: pass the response
    // body through unchanged so Anthropic-only content blocks
    // (`server_tool_use`, `web_search_tool_result`, etc.) survive. The
    // OpenAI-shaped converter only knows `text` / `thinking` / `tool_use`
    // and would silently drop the rest.
    const anthropicData = (await forward.response.json()) as Record<string, unknown>;
    const extracted = extractThinkingBlocksFromMessagesResponse(anthropicData);
    if (extracted && thinkingCache && sessionKey) {
      thinkingCache.store(
        sessionKey,
        extracted.firstToolUseId,
        extracted.blocks,
        thinkingRouteContext(meta),
      );
    }
    responseBody = anthropicData;
  } else if (forward.isAnthropic) {
    const anthropicData = (await forward.response.json()) as Record<string, unknown>;
    responseBody = providerClient.convertAnthropicResponse(anthropicData, meta.model);
    const extracted = (responseBody as Record<string, unknown>)?._extractedThinkingBlocks as
      ExtractedThinkingBlocks | undefined;
    if (extracted && thinkingCache && sessionKey) {
      thinkingCache.store(
        sessionKey,
        extracted.firstToolUseId,
        extracted.blocks,
        thinkingRouteContext(meta),
      );
    }
    delete (responseBody as Record<string, unknown>)._extractedThinkingBlocks;
  } else if (forward.isChatGpt || forward.isResponses) {
    // Responses-format upstreams differ on their non-streaming shape. The
    // ChatGPT Codex subscription backend always returns SSE even when
    // stream:false, but the Bedrock mantle /openai/v1/responses endpoint (and
    // other API-key /responses backends) return a plain JSON Responses object.
    // Sniff the shape — same triple-signal check as readNativeResponsesBody —
    // and convert accordingly. Assuming SSE unconditionally made non-streaming
    // Bedrock GPT-5.x responses come back empty (content: null, zero usage).
    const contentType = forward.response.headers.get('content-type') ?? '';
    const text = await forward.response.text();
    const trimmed = text.trimStart();
    if (
      contentType.includes('text/event-stream') ||
      trimmed.startsWith('event:') ||
      trimmed.startsWith('data:')
    ) {
      responseBody = providerClient.collectChatGptSseResponse(text, meta.model);
    } else {
      responseBody = providerClient.convertChatGptResponse(
        JSON.parse(text) as Record<string, unknown>,
        meta.model,
      );
    }
  } else {
    responseBody = await forward.response.json();
    if (supportsReasoningContent(meta.provider, meta.model, reasoningCache?.modelCatalog)) {
      cacheReasoningContent(responseBody, reasoningCache, sessionKey);
    }
  }

  if (apiMode === 'responses' && !forward.isResponses) {
    responseBody = fromChatCompletionResponse(responseBody as Record<string, unknown>, meta.model, {
      textFormat: forward.responsesTextFormat,
      toolNames: forward.responsesToolNames,
    });
  } else if (apiMode === 'messages' && !forward.isAnthropic) {
    // Anthropic upstreams already returned a Messages-shaped body via the
    // passthrough branch above. Skip the round-trip translation that would
    // strip Anthropic-only content blocks.
    responseBody = chatCompletionsResponseToMessages(
      responseBody as Record<string, unknown>,
      meta.model,
    );
  }

  const body = responseBody as Record<string, unknown> | undefined;
  const streamUsage = parseUsageObject(body?.usage);

  if (recordedResponse && capture) {
    const raw = await recordedResponse.text();
    const contentType = recordedResponse.headers.get('content-type') ?? '';
    const trimmed = raw.trimStart();
    if (
      contentType.includes('text/event-stream') ||
      trimmed.startsWith('event:') ||
      trimmed.startsWith('data:')
    ) {
      capture.setRaw(raw);
    } else {
      try {
        capture.setJson(JSON.parse(raw) as unknown);
      } catch {
        capture.setJson(raw);
      }
    }
  }
  res.status(200);
  setHeaders(res, metaHeaders);
  res.json(responseBody);
  return streamUsage;
}

async function readNativeResponsesBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  const trimmed = text.trimStart();

  if (
    contentType.includes('text/event-stream') ||
    trimmed.startsWith('event:') ||
    trimmed.startsWith('data:')
  ) {
    return collectResponsesSseResponse(text);
  }

  return JSON.parse(text);
}

export function recordSuccess(
  ctx: IngestionContext,
  meta: RoutingMeta,
  streamUsage: StreamUsage | null,
  fallbackSuccessTs: string | undefined,
  recorder: ProxyMessageRecorder,
  traceId?: string,
  sessionKey?: string,
  startTime?: number,
  callerAttribution?: CallerAttribution | null,
  requestHeaders?: Record<string, string> | null,
  requestId: string = uuid(),
  attemptNumber: number = PRIMARY_ATTEMPT_NUMBER,
  apiMode?: ProxyApiMode,
): void {
  if (meta.fallbackFromModel && fallbackSuccessTs) {
    const requestDurationMs = startTime == null ? undefined : Date.now() - startTime;
    recordSafely(
      recorder.recordFallbackSuccess(ctx, meta.model, meta.tier, {
        requestId,
        attemptNumber,
        attempt: meta.attempt,
        requestDurationMs,
        traceId,
        provider: meta.provider,
        fallbackFromModel: meta.fallbackFromModel,
        fallbackIndex: meta.fallbackIndex ?? 0,
        timestamp: fallbackSuccessTs,
        authType: meta.auth_type,
        reason: meta.reason,
        providerKeyLabel: meta.provider_key_label,
        tenantProviderId: meta.tenantProviderId,
        usage: streamUsage ?? undefined,
        callerAttribution,
        requestHeaders,
        requestParams: meta.request_params,
        headerTierId: meta.header_tier_id,
        headerTierName: meta.header_tier_name,
        headerTierColor: meta.header_tier_color,
        virtualModelId: meta.virtual_model_id,
        virtualModelName: meta.virtual_model_name,
        apiMode,
      }),
      'fallback success',
    );
  } else {
    const usage = streamUsage ?? { prompt_tokens: 0, completion_tokens: 0 };
    const durationMs = startTime ? Date.now() - startTime : undefined;
    recordSafely(
      recorder.recordSuccessMessage(ctx, meta.model, meta.tier, meta.reason, usage, {
        requestId,
        attemptNumber,
        attempt: meta.attempt,
        traceId,
        provider: meta.provider,
        authType: meta.auth_type,
        sessionKey,
        durationMs,
        specificityCategory: meta.specificity_category,
        providerKeyLabel: meta.provider_key_label,
        tenantProviderId: meta.tenantProviderId,
        callerAttribution,
        requestHeaders,
        requestParams: meta.request_params,
        headerTierId: meta.header_tier_id,
        headerTierName: meta.header_tier_name,
        headerTierColor: meta.header_tier_color,
        virtualModelId: meta.virtual_model_id,
        virtualModelName: meta.virtual_model_name,
        apiMode,
      }),
      'success message',
    );
  }
}
