/**
 * Stream warm-up: peek at the first bytes of a streaming response before
 * committing it to the client.  If the provider returned HTTP 200 but the
 * stream stalls or dies before producing any data, we can still fall back
 * to another provider instead of sending the client a truncated response.
 *
 * @see https://github.com/mnfst/llm-gateway/issues/1656
 */

import { isLocalOnlyProvider } from '../../common/utils/provider-availability';
import { scanSseStart } from './upstream-error-classifier';

export const DEFAULT_STREAM_WARMUP_MS = 15_000;
/** Cold local models (Ollama, LM Studio, llama.cpp) can take 30-60s to load (#128). */
export const DEFAULT_LOCAL_STREAM_WARMUP_MS = 60_000;

export function parseStreamWarmupMs(
  rawValue = process.env.STREAM_WARMUP_MS,
  fallback = DEFAULT_STREAM_WARMUP_MS,
): number {
  const value = rawValue ?? '';
  if (!/^\d+$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const STREAM_WARMUP_MS = parseStreamWarmupMs();

/**
 * Warm-up for local providers: THINKER_LOCAL_STREAM_WARMUP_MS, else 60s, and
 * never shorter than the global STREAM_WARMUP_MS.
 */
export const LOCAL_STREAM_WARMUP_MS = Math.max(
  STREAM_WARMUP_MS,
  parseStreamWarmupMs(process.env.THINKER_LOCAL_STREAM_WARMUP_MS, DEFAULT_LOCAL_STREAM_WARMUP_MS),
);

/** Bounds for the per-connection override (#244). */
export const MIN_STREAM_WARMUP_OVERRIDE_MS = 1_000;
export const MAX_STREAM_WARMUP_OVERRIDE_MS = 600_000;

/** Stored overrides; null or undefined means "inherit the next level". */
export interface StreamWarmupOverrides {
  /** `tenant_providers.stream_warmup_ms` of the connection serving the hop. */
  connectionMs?: number | null;
  /** The hop is a local server connection (`auth_type 'local'`, e.g. a `custom:<uuid>` Ollama). */
  local?: boolean;
}

function validOverride(value: number | null | undefined): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_STREAM_WARMUP_OVERRIDE_MS &&
    value <= MAX_STREAM_WARMUP_OVERRIDE_MS
    ? value
    : undefined;
}

/**
 * The first-chunk wait for a provider hop. Precedence (#244): provider
 * connection override > local-runner default (#128) > global STREAM_WARMUP_MS. An out-of-range stored value is ignored.
 */
export function streamWarmupMsFor(provider: string, overrides?: StreamWarmupOverrides): number {
  return (
    validOverride(overrides?.connectionMs) ??
    (overrides?.local || isLocalOnlyProvider(provider) ? LOCAL_STREAM_WARMUP_MS : STREAM_WARMUP_MS)
  );
}

export interface WarmupSuccess {
  ok: true;
  /** A new ReadableStream that yields the buffered chunk first, then the rest. */
  stream: ReadableStream<Uint8Array>;
}

export interface WarmupFailure {
  ok: false;
  reason: 'timeout' | 'error' | 'empty' | 'aborted';
  message: string;
}

export type WarmupResult = WarmupSuccess | WarmupFailure;

/**
 * Read the first chunk from `source`.  If data arrives within `timeoutMs`,
 * return a new stream that replays the buffered chunk followed by the
 * remaining data.  If the stream stalls, errors, or ends with no data,
 * return a failure so the caller can try a fallback.
 */
export async function peekStream(
  source: ReadableStream<Uint8Array>,
  timeoutMs: number = STREAM_WARMUP_MS,
  signal?: AbortSignal,
): Promise<WarmupResult> {
  const reader = source.getReader();

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    // A client that hangs up stops the wait at once, so its concurrency slot
    // is not held until the warm-up timeout.
    const first = await Promise.race([
      reader.read(),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
      new Promise<{ aborted: true }>((resolve) => {
        if (!signal) return;
        if (signal.aborted) return resolve({ aborted: true });
        onAbort = () => resolve({ aborted: true });
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);

    if ('aborted' in first) {
      reader.cancel().catch(() => {});
      reader.releaseLock();
      return { ok: false, reason: 'aborted', message: 'Client disconnected during warm-up' };
    }

    if ('timedOut' in first) {
      reader.cancel().catch(() => {});
      reader.releaseLock();
      return { ok: false, reason: 'timeout', message: `No data within ${timeoutMs}ms` };
    }

    const { done, value } = first as ReadableStreamReadResult<Uint8Array>;

    if (done || !value || value.length === 0) {
      reader.releaseLock();
      return { ok: false, reason: 'empty', message: 'Stream ended with no data' };
    }

    // Build a new stream: buffered chunk first, then pipe the rest.
    const buffered = value;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(buffered);
      },
      async pull(controller) {
        try {
          const { done: nextDone, value: nextValue } = await reader.read();
          if (nextDone) {
            controller.close();
            reader.releaseLock();
          } else if (nextValue) {
            controller.enqueue(nextValue);
          }
        } catch (err) {
          reader.releaseLock();
          controller.error(err);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
        reader.releaseLock();
      },
    });

    return { ok: true, stream };
  } catch (err) {
    reader.cancel().catch(() => {});
    reader.releaseLock();
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'error', message };
  }
}

/* ── Error peek (report from NOC Norte, P5) ── */

export type StreamErrorPeekMode = 'all' | 'context' | 'off';

export function parseStreamErrorPeekMode(
  raw = process.env.THINKER_STREAM_ERROR_PEEK,
): StreamErrorPeekMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (/^(0|false|off|no)$/.test(value)) return 'off';
  return value === 'context' ? 'context' : 'all';
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : fallback;
}

export const STREAM_ERROR_PEEK_MODE = parseStreamErrorPeekMode();
/** Longest wait for the first content event after the first byte. */
export const STREAM_PEEK_MS = boundedInt(process.env.THINKER_STREAM_PEEK_MS, 20_000, 0, 600_000);
/** Most bytes held while waiting for the first content event. */
export const STREAM_PEEK_MAX_BYTES = boundedInt(
  process.env.THINKER_STREAM_PEEK_MAX_BYTES,
  262_144,
  1_024,
  8 * 1024 * 1024,
);

export interface StreamStartOptions {
  /** First-byte wait (the warm-up). */
  warmupMs: number;
  signal?: AbortSignal;
  mode?: StreamErrorPeekMode;
  peekMs?: number;
  maxBytes?: number;
  /**
   * Upstream content type. Only SSE is scanned: a binary event stream
   * (Bedrock) or NDJSON would never show an SSE boundary and be held for the
   * whole peek window. Omitted: scanned.
   */
  contentType?: string | null;
}

export interface StreamStartError {
  ok: false;
  reason: 'upstream_error';
  message: string;
  status: number;
  /** The error event's JSON, for the synthetic error response. */
  body: string;
  contextLength: boolean;
}

export type StreamStartResult = WarmupResult | StreamStartError;

/**
 * Warm-up plus error peek: after the first byte arrives (within `warmupMs`),
 * keep reading while the stream holds only SSE comments, keepalives and
 * preamble events, until the first content event (replay everything, byte
 * for byte), an error event (report it, so the hop fails before the client
 * sees a byte), the end of the stream, `peekMs` or `maxBytes` (pass through as
 * read). An error after the first content still reaches the client as SSE.
 */
export async function peekStreamStart(
  source: ReadableStream<Uint8Array>,
  opts: StreamStartOptions,
): Promise<StreamStartResult> {
  const mode = opts.mode ?? STREAM_ERROR_PEEK_MODE;
  const first = await peekStream(source, opts.warmupMs, opts.signal);
  if (!first.ok || mode === 'off') return first;
  if (opts.contentType != null && !opts.contentType.toLowerCase().includes('event-stream')) {
    return first;
  }

  const reader = first.stream.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let text = '';
  let bytes = 0;
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  let done = false;
  let readError: unknown = null;
  const peekMs = opts.peekMs ?? STREAM_PEEK_MS;
  const maxBytes = opts.maxBytes ?? STREAM_PEEK_MAX_BYTES;
  const deadline = Date.now() + peekMs;

  const passThrough = (): WarmupSuccess => ({
    ok: true,
    stream: replayStream(chunks, reader, pending, done, readError),
  });

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || bytes >= maxBytes) return passThrough();
    const read = pending ?? reader.read();
    pending = read;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let outcome: ReadableStreamReadResult<Uint8Array> | 'timeout' | 'aborted';
    try {
      outcome = await Promise.race([
        read,
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), remaining);
        }),
        new Promise<'aborted'>((resolve) => {
          if (!opts.signal) return;
          if (opts.signal.aborted) return resolve('aborted');
          onAbort = () => resolve('aborted');
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } catch (err) {
      pending = null;
      readError = err;
      return passThrough();
    } finally {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    }
    if (outcome === 'aborted') {
      reader.cancel().catch(() => {});
      return { ok: false, reason: 'aborted', message: 'Client disconnected during warm-up' };
    }
    if (outcome === 'timeout') return passThrough();
    pending = null;
    if (outcome.done) {
      done = true;
      return passThrough();
    }
    const value = outcome.value;
    if (!value || value.length === 0) continue;
    chunks.push(value);
    bytes += value.length;
    text += decoder.decode(value, { stream: true });
    const verdict = scanSseStart(text);
    if (verdict.state === 'content') return passThrough();
    if (verdict.state === 'error') {
      if (mode === 'context' && !verdict.contextLength) return passThrough();
      reader.cancel().catch(() => {});
      return {
        ok: false,
        reason: 'upstream_error',
        message: `Upstream error before the first content (status ${verdict.status})`,
        status: verdict.status,
        body: verdict.body,
        contextLength: verdict.contextLength,
      };
    }
  }
}

/** Everything read so far, then the rest of the upstream stream. */
function replayStream(
  chunks: readonly Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null,
  ended: boolean,
  readError: unknown,
): ReadableStream<Uint8Array> {
  let index = 0;
  let pending = pendingRead;
  let done = ended;
  const release = () => {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      if (readError) {
        release();
        controller.error(readError);
        return;
      }
      if (done) {
        release();
        controller.close();
        return;
      }
      try {
        for (;;) {
          const next = pending ?? reader.read();
          pending = null;
          const { done: nextDone, value } = await next;
          if (nextDone) {
            done = true;
            release();
            controller.close();
            return;
          }
          if (value && value.length > 0) {
            controller.enqueue(value);
            return;
          }
        }
      } catch (err) {
        release();
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {});
    },
  });
}
