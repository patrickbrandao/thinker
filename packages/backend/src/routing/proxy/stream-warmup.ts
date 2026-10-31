/**
 * Stream warm-up: peek at the first bytes of a streaming response before
 * committing it to the client.  If the provider returned HTTP 200 but the
 * stream stalls or dies before producing any data, we can still fall back
 * to another provider instead of sending the client a truncated response.
 *
 * @see https://github.com/mnfst/llm-gateway/issues/1656
 */

import { isLocalOnlyProvider } from '../../common/utils/provider-availability';

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
  reason: 'timeout' | 'error' | 'empty';
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
): Promise<WarmupResult> {
  const reader = source.getReader();

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([
      reader.read(),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
    clearTimeout(timer);

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
