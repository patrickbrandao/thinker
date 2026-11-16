import type { Logger } from '@nestjs/common';
import { classifyMessageError, type LiveWireFormat } from 'thinker-shared';
import type { AttemptRecordingCapture } from '../routing/proxy/attempt-recording-capture';
import type { RecordingResponseBody } from '../routing/proxy/attempt-recording.types';
import { redactInlineImageDataUrls } from '../routing/proxy/inline-image-redaction';
import type {
  ProviderAttemptRecordingStart,
  ProviderAttemptRef,
  ProviderAttemptStart,
  ProxyApiMode,
} from '../routing/proxy/proxy-types';
import type { StreamUsage } from '../routing/proxy/stream-writer';
import { normalizeConversation } from './live-conversation';
import type {
  LiveSessionEntry,
  LiveSessionHubService,
  OpenLiveRequest,
} from './live-session-hub.service';
import { LiveStreamNormalizer, type LiveBlockOp } from './live-stream-normalizer';
import {
  displayModel,
  errorMessageFrom,
  maskHeaders,
  maskUrl,
  providerDisplayName,
  toLiveUsage,
} from './live-wire';

/** One `block.delta` per block per window (docs: "agregado em janelas de 50 ms"). */
export const LIVE_DELTA_WINDOW_MS = 50;
/** Bodies above this size travel as a marker instead of the JSON. */
export const LIVE_MAX_BODY_BYTES = 1024 * 1024;
/** Longest wait for the attempt cost before `request.completed` goes without it. */
const COST_TIMEOUT_MS = 2000;

const INBOUND_FORMAT: Record<ProxyApiMode, LiveWireFormat> = {
  messages: 'anthropic_messages',
  chat_completions: 'openai_chat_completions',
  responses: 'openai_responses',
};

/**
 * The live capture of one harness request: its conversation diff and one
 * {@link LiveAttemptTap} per provider attempt. Every public method is safe to
 * call from the proxy: it never throws, and the first internal failure turns
 * the capture off for the rest of the request with one warning.
 */
export class LiveRequestCapture {
  private readonly taps = new Map<ProviderAttemptRef, LiveAttemptTap>();
  private attemptCount = 0;
  private disabled = false;
  private closed = false;

  constructor(
    private readonly hub: LiveSessionHubService,
    readonly entry: LiveSessionEntry,
    private readonly input: OpenLiveRequest,
    private readonly logger: Logger,
  ) {
    entry.inFlight += 1;
  }

  get requestId(): string {
    return this.input.requestId;
  }

  get recording(): boolean {
    return this.input.recording;
  }

  /** Runs `fn`, turning the capture off on the first error. */
  guard<T>(fn: () => T): T | undefined {
    if (this.disabled) return undefined;
    try {
      return fn();
    } catch (error) {
      this.disabled = true;
      for (const tap of this.taps.values()) tap.dispose();
      this.logger.warn(
        `Live session capture disabled for request ${this.input.requestId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  emit(type: Parameters<LiveSessionHubService['emit']>[1], data: Record<string, unknown>): void {
    this.hub.emit(this.entry, type, data);
  }

  /** Messages new in this request's history (attempt 1 only, inbound body). */
  recordConversation(body: Record<string, unknown>, apiMode: ProxyApiMode): void {
    this.guard(() => {
      const diff = this.entry.conversation.diff(
        normalizeConversation(body, INBOUND_FORMAT[apiMode]),
      );
      if (diff.kind === 'reset') {
        this.emit('conversation.reset', { messages: diff.messages });
      } else if (diff.kind === 'append') {
        let seq = this.entry.conversation.visibleCount - diff.messages.length;
        for (const m of diff.messages) this.emit('message.appended', { seq: seq++, ...m });
      }
    });
  }

  /** A provider call begins (local skips get no tap). */
  attemptStarted(ref: ProviderAttemptRef, start: ProviderAttemptStart): void {
    this.guard(() => {
      if (start.providerCallStarted === false) return;
      // Attempts are sequential: an earlier one still open failed and the
      // chain moved on.
      for (const tap of this.taps.values()) tap.fail(null, null, 'fallback');
      const tap = new LiveAttemptTap(this, ref, start, ++this.attemptCount, this.customNames());
      this.taps.set(ref, tap);
    });
  }

  private customNames() {
    return this.hub.customProviderNames(this.input.tenantId);
  }

  tapFor(ref: ProviderAttemptRef | undefined): LiveAttemptTap | undefined {
    return ref ? this.taps.get(ref) : undefined;
  }

  /** The provider-facing request is ready (provider-client `startRecording`). */
  attemptRequest(ref: ProviderAttemptRef, start: ProviderAttemptRecordingStart): void {
    this.guard(() => this.taps.get(ref)?.begin(start));
  }

  /** A recorded response body for the attempt (error bodies end up here). */
  attemptResponse(
    ref: ProviderAttemptRef,
    response: RecordingResponseBody | null | undefined,
  ): void {
    this.guard(() => this.taps.get(ref)?.noteResponse(response));
  }

  /**
   * The capture handed to the response handlers in place of the recording
   * capture: it forwards to the recording (when on) and feeds the tap.
   */
  responseCapture(
    ref: ProviderAttemptRef | undefined,
    recording: AttemptRecordingCapture | undefined,
  ): AttemptRecordingCapture | undefined {
    const tap = this.tapFor(ref);
    if (!tap || this.disabled) return recording;
    return {
      appendRaw: (text) => {
        recording?.appendRaw(text);
        this.guard(() => tap.appendRaw(text));
      },
      setJson: (body) => {
        recording?.setJson(body);
        this.guard(() => tap.setBody(body));
      },
      setRaw: (text) => {
        recording?.setRaw(text);
        this.guard(() => tap.setBody(text));
      },
      buildResponseBody: () => recording?.buildResponseBody() ?? null,
      buildRecording: () => {
        if (!recording) throw new Error('No attempt recording');
        return recording.buildRecording();
      },
    };
  }

  completed(
    ref: ProviderAttemptRef | undefined,
    usage: StreamUsage | null,
    cost: Promise<number | null> | null,
  ): void {
    this.guard(() => this.tapFor(ref)?.complete(usage, cost));
  }

  failed(ref: ProviderAttemptRef | undefined, status: number | null, message: string | null): void {
    this.guard(() => {
      const tap = this.tapFor(ref) ?? this.lastOpenTap();
      tap?.fail(status, message, 'give_up');
    });
  }

  cancelled(ref: ProviderAttemptRef | undefined, usage: StreamUsage | null | undefined): void {
    this.guard(() => {
      const tap = this.tapFor(ref) ?? this.lastOpenTap();
      tap?.cancel(usage ?? null);
    });
  }

  /** End of the request: anything still open failed without a next route. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.entry.inFlight = Math.max(0, this.entry.inFlight - 1);
    this.guard(() => {
      for (const tap of this.taps.values()) tap.fail(null, null, 'give_up');
    });
  }

  private lastOpenTap(): LiveAttemptTap | undefined {
    let last: LiveAttemptTap | undefined;
    for (const tap of this.taps.values()) if (tap.isOpen) last = tap;
    return last;
  }
}

type TapState = 'created' | 'started' | 'ending' | 'ended';

/**
 * One provider attempt. The chunk path ({@link appendRaw}) only queues text:
 * parsing and normalization run on `setImmediate`, deltas are throttled to
 * one event per block per {@link LIVE_DELTA_WINDOW_MS}, and nothing here
 * touches the bytes relayed to the harness.
 */
export class LiveAttemptTap {
  private state: TapState = 'created';
  private request: ProviderAttemptRecordingStart | null = null;
  private normalizer: LiveStreamNormalizer | null = null;
  private readonly pendingRaw: string[] = [];
  private drainScheduled: ReturnType<typeof setImmediate> | null = null;
  private startScheduled: ReturnType<typeof setImmediate> | null = null;
  private readonly pendingDeltas = new Map<number, string>();
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private errorBody: unknown = undefined;
  private blocksStarted = false;
  readonly attemptId: string;

  constructor(
    private readonly capture: LiveRequestCapture,
    private readonly ref: ProviderAttemptRef,
    private readonly start: ProviderAttemptStart,
    private readonly attempt: number,
    private readonly customNames: ReadonlyMap<string, string> | undefined,
  ) {
    this.attemptId = `${capture.requestId}.${attempt}`;
  }

  get isOpen(): boolean {
    return this.state === 'created' || this.state === 'started';
  }

  /** Stores the provider-facing request; `request.started` follows off the hot path. */
  begin(request: ProviderAttemptRecordingStart): void {
    if (this.state !== 'created' || this.request) return;
    this.request = request;
    this.startScheduled = setImmediate(() => {
      this.startScheduled = null;
      this.capture.guard(() => this.ensureStarted());
    });
  }

  private ensureStarted(): void {
    if (this.state !== 'created') return;
    if (this.startScheduled) {
      clearImmediate(this.startScheduled);
      this.startScheduled = null;
    }
    this.state = 'started';
    const request = this.request;
    const wireFormat = (request?.wireFormat ?? null) as LiveWireFormat | null;
    this.normalizer = new LiveStreamNormalizer(wireFormat, (op) => this.onOp(op));
    const route = [
      this.start.routeLabel ??
        (this.start.virtualModelName ? `virtual model: ${this.start.virtualModelName}` : null),
      this.attempt > 1 ? `fallback #${this.attempt - 1}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const data: Record<string, unknown> = {
      requestId: this.capture.requestId,
      attemptId: this.attemptId,
      attempt: this.attempt,
      model: displayModel(this.start.model),
      provider: providerDisplayName(this.start.provider, this.customNames),
      route: route || null,
      upstream: wireFormat,
      endpoint: maskUrl(request?.url),
    };
    if (this.capture.recording && request) {
      if (request.headers) data.headers = maskHeaders(request.headers);
      data.body = liveBody(request.requestBody);
    }
    this.capture.emit('request.started', data);
  }

  appendRaw(text: string): void {
    if (!this.isOpen || !text) return;
    this.pendingRaw.push(text);
    if (!this.drainScheduled) {
      this.drainScheduled = setImmediate(() => {
        this.drainScheduled = null;
        this.capture.guard(() => this.drain());
      });
    }
  }

  /** A whole response body (non-stream success). */
  setBody(body: unknown): void {
    if (!this.isOpen) return;
    this.ensureStarted();
    this.normalizer?.feedBody(body);
  }

  /** A body recorded through `finishRecording`: kept as the error, if any. */
  noteResponse(response: RecordingResponseBody | null | undefined): void {
    if (!response || !this.isOpen) return;
    if (response.type === 'json') this.errorBody = response.body;
  }

  private drain(): void {
    if (this.drainScheduled) {
      clearImmediate(this.drainScheduled);
      this.drainScheduled = null;
    }
    if (this.pendingRaw.length === 0) return;
    this.ensureStarted();
    const chunks = this.pendingRaw.splice(0);
    for (const text of chunks) this.normalizer?.feedSse(text);
  }

  private onOp(op: LiveBlockOp): void {
    const ids = { requestId: this.capture.requestId, attemptId: this.attemptId, index: op.index };
    if (op.op === 'delta') {
      this.pendingDeltas.set(op.index, (this.pendingDeltas.get(op.index) ?? '') + op.delta);
      if (!this.deltaTimer) {
        // Leading edge: the first piece goes now, the rest once per window.
        this.flushDeltas();
        this.armDeltaTimer();
      }
      return;
    }
    this.flushDeltas();
    if (op.op === 'start') {
      this.blocksStarted = true;
      this.capture.emit('block.started', {
        ...ids,
        type: op.type,
        ...(op.name !== undefined ? { name: op.name } : {}),
        ...(op.toolCallId !== undefined ? { toolCallId: op.toolCallId } : {}),
        ...(op.redacted ? { redacted: true } : {}),
      });
    } else {
      this.capture.emit('block.stopped', ids);
    }
  }

  private armDeltaTimer(): void {
    this.deltaTimer = setTimeout(() => {
      this.deltaTimer = null;
      this.capture.guard(() => {
        if (this.pendingDeltas.size === 0) return;
        this.flushDeltas();
        this.armDeltaTimer();
      });
    }, LIVE_DELTA_WINDOW_MS);
    this.deltaTimer.unref?.();
  }

  private flushDeltas(): void {
    for (const [index, delta] of this.pendingDeltas) {
      this.capture.emit('block.delta', {
        requestId: this.capture.requestId,
        attemptId: this.attemptId,
        index,
        delta,
      });
    }
    this.pendingDeltas.clear();
  }

  /** Everything received so far, out to the subscribers. */
  private settleStream(closeBlocks: boolean): void {
    this.ensureStarted();
    this.drain();
    this.normalizer?.endSse();
    if (closeBlocks) this.normalizer?.finish();
    this.flushDeltas();
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
  }

  private timing() {
    const timing = this.ref.timing;
    const sent = timing?.sentAtMs ?? this.ref.startedAtMs;
    return {
      ttftMs: timing?.firstChunkAtMs != null ? timing.firstChunkAtMs - sent : null,
      latencyMs: Date.now() - sent,
    };
  }

  complete(usage: StreamUsage | null, cost: Promise<number | null> | null): void {
    if (!this.isOpen) return;
    this.settleStream(true);
    this.state = 'ending';
    const { ttftMs, latencyMs } = this.timing();
    const stopReason = this.normalizer?.stopReason ?? null;
    const liveUsage = toLiveUsage(usage, this.normalizer?.reasoningTokens ?? 0);
    const finish = (costUsd: number | null) =>
      this.capture.guard(() => {
        if (this.state !== 'ending') return;
        this.state = 'ended';
        this.capture.emit('request.completed', {
          requestId: this.capture.requestId,
          attemptId: this.attemptId,
          stopReason,
          usage: liveUsage,
          costUsd,
          ttftMs,
          latencyMs,
        });
      });
    if (!cost) {
      finish(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), COST_TIMEOUT_MS);
      timer.unref?.();
    });
    void Promise.race([cost.catch(() => null), timeout]).then((value) => {
      if (timer) clearTimeout(timer);
      finish(typeof value === 'number' && Number.isFinite(value) ? value : null);
    });
  }

  fail(status: number | null, message: string | null, next: 'fallback' | 'give_up'): void {
    if (!this.isOpen) return;
    this.settleStream(false);
    this.state = 'ended';
    const httpStatus = status ?? this.ref.timing?.status ?? null;
    const text =
      message !== null
        ? errorMessageFrom(message)
        : this.errorBody !== undefined
          ? errorMessageFrom(this.errorBody)
          : httpStatus
            ? `Provider returned HTTP ${httpStatus}`
            : 'Provider attempt failed';
    const errorClass = classifyMessageError({
      status: 'error',
      errorHttpStatus: httpStatus,
      provider: this.start.provider,
      errorMessage: text,
    }).error_class;
    this.capture.emit('request.failed', {
      requestId: this.capture.requestId,
      attemptId: this.attemptId,
      status: httpStatus,
      message: text,
      errorClass,
      interrupted: this.blocksStarted,
      next,
      latencyMs: this.timing().latencyMs,
    });
  }

  cancel(usage: StreamUsage | null): void {
    if (!this.isOpen) return;
    this.settleStream(false);
    this.state = 'ended';
    const liveUsage = toLiveUsage(usage, this.normalizer?.reasoningTokens ?? 0);
    this.capture.emit('request.cancelled', {
      requestId: this.capture.requestId,
      attemptId: this.attemptId,
      reason: 'client_closed',
      latencyMs: this.timing().latencyMs,
      ...(liveUsage ? { usage: liveUsage } : {}),
    });
  }

  /** Stops every timer (the capture was turned off). */
  dispose(): void {
    if (this.drainScheduled) clearImmediate(this.drainScheduled);
    if (this.startScheduled) clearImmediate(this.startScheduled);
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.drainScheduled = null;
    this.startScheduled = null;
    this.deltaTimer = null;
    this.pendingRaw.length = 0;
    this.state = 'ended';
  }
}

/** The provider-facing body for the Inspector: images redacted, size capped. */
function liveBody(body: Record<string, unknown>): unknown {
  const redacted = redactInlineImageDataUrls(body);
  const json = JSON.stringify(redacted);
  if (json.length > LIVE_MAX_BODY_BYTES) {
    return {
      _thinker: 'Body too large for the live view; see the attempt recording.',
      bytes: json.length,
    };
  }
  // A copy, so later changes to the proxy's object never reach the buffer.
  return JSON.parse(json) as unknown;
}
