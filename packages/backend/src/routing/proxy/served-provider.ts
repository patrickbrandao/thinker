import type { ProviderAttemptRef } from './proxy-types';

/**
 * Who actually served an attempt (report from NOC Norte, P6). Aggregators
 * such as OpenRouter pick the upstream endpoint per request and name it in
 * the `provider` field of the body and of each stream chunk; on failure,
 * `error.metadata.provider_name`. The response `id` and `model` are kept too.
 * Read-only: the bytes sent to the client never change.
 *
 * THINKER_SERVED_PROVIDER_CAPTURE=false turns it off.
 */

export interface ServedIdentity {
  provider?: string;
  generationId?: string;
  model?: string;
}

/** Stop scanning a stream after this many characters. */
const STREAM_SCAN_LIMIT = 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

export function isServedCaptureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(0|false|off|no)$/i.test((env.THINKER_SERVED_PROVIDER_CAPTURE ?? '').trim());
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, max)
    : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The identity fields of one response object or stream chunk. */
export function servedIdentityOf(obj: unknown): ServedIdentity {
  const root = record(obj);
  if (!root) return {};
  const metadata = record(record(root.error)?.metadata);
  // Responses API wraps the response in `response` on its lifecycle events.
  const response = record(root.response);
  return {
    provider: str(root.provider, 120) ?? str(metadata?.provider_name, 120),
    generationId: str(root.id, 128) ?? str(response?.id, 128),
    model: str(root.model, 200) ?? str(response?.model, 200),
  };
}

/** Fill what the attempt does not know yet; never overwrite. */
export function noteServed(
  attempt: ProviderAttemptRef | undefined,
  identity: ServedIdentity,
): void {
  if (!attempt) return;
  const served = (attempt.served ??= {});
  served.provider ??= identity.provider;
  served.generationId ??= identity.generationId;
  served.model ??= identity.model;
}

function complete(attempt: ProviderAttemptRef): boolean {
  return !!attempt.served?.provider && !!attempt.served.generationId && !!attempt.served.model;
}

/** Note the identity from a buffered JSON body (success or error). */
export function noteServedFromBody(
  attempt: ProviderAttemptRef | undefined,
  payload: ArrayBuffer | string,
): void {
  if (!attempt || !isServedCaptureEnabled()) return;
  const size = typeof payload === 'string' ? payload.length : payload.byteLength;
  if (size === 0 || size > MAX_JSON_BYTES) return;
  const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
  if (!text.trimStart().startsWith('{')) return;
  try {
    noteServed(attempt, servedIdentityOf(JSON.parse(text)));
  } catch {
    // not JSON
  }
}

/**
 * Pass-through stream that reads the identity off the first SSE events
 * (the field may be split across chunks, so whole events are parsed).
 */
export function servedSniffer(
  attempt: ProviderAttemptRef | undefined,
): TransformStream<Uint8Array, Uint8Array> | null {
  if (!attempt || !isServedCaptureEnabled()) return null;
  const decoder = new TextDecoder();
  let buffer = '';
  let scanned = 0;
  let done = false;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      if (done) return;
      const text = decoder.decode(chunk, { stream: true });
      scanned += text.length;
      buffer += text;
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data || data.trim() === '[DONE]') continue;
        try {
          noteServed(attempt, servedIdentityOf(JSON.parse(data)));
        } catch {
          // not JSON
        }
        if (complete(attempt)) break;
      }
      if (complete(attempt) || scanned > STREAM_SCAN_LIMIT) {
        done = true;
        buffer = '';
      }
    },
  });
}
