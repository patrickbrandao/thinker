import type { ProviderAttemptRef, ProviderAttemptStart } from './proxy-types';

/**
 * Wall-clock story of one Request, stored on `requests.timeline`: when the
 * caller's HTTP request arrived, when each provider call was sent, when its
 * response headers, first and last body chunk arrived, and when the response
 * to the caller started and finished. Every `at` is epoch milliseconds.
 */
export type RequestTimelineEventType =
  | 'received'
  | 'provider_request'
  | 'provider_skipped'
  | 'provider_response'
  | 'provider_error'
  | 'first_chunk'
  | 'last_chunk'
  | 'response_started'
  | 'response_completed';

export interface RequestTimelineEvent {
  type: RequestTimelineEventType;
  at: number;
  attempt?: number;
  provider?: string;
  model?: string;
  status?: number;
  chunks?: number;
  bytes?: number;
}

export interface RequestTimeline {
  version: 1;
  events: RequestTimelineEvent[];
}

/** Provider-side timing of one attempt, filled by the provider client. */
export interface AttemptTiming {
  sentAtMs?: number;
  responseAtMs?: number;
  status?: number;
  firstChunkAtMs?: number;
  lastChunkAtMs?: number;
  chunks: number;
  bytes: number;
}

/** Marks the moment the provider request leaves (right before fetch). */
export function markProviderSent(attempt: ProviderAttemptRef | undefined): void {
  if (!attempt) return;
  attempt.timing = { sentAtMs: Date.now(), chunks: 0, bytes: 0 };
}

/**
 * Stamps the response-header time and wraps the body so its first and last
 * chunk times are recorded as whoever reads it (warmup, qualifiers, the
 * stream handler) pulls the bytes. Without an attempt it returns the response
 * untouched.
 */
export function timeProviderResponse(
  response: Response,
  attempt: ProviderAttemptRef | undefined,
): Response {
  if (!attempt) return response;
  const timing = (attempt.timing ??= { chunks: 0, bytes: 0 });
  timing.responseAtMs = Date.now();
  timing.status = response.status;
  if (!response.body) return response;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const now = Date.now();
        timing.firstChunkAtMs ??= now;
        timing.lastChunkAtMs = now;
        timing.chunks += 1;
        timing.bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export interface TimelineAttempt {
  ref: ProviderAttemptRef;
  start: ProviderAttemptStart;
}

export interface TimelineInput {
  receivedAtMs: number;
  attempts: TimelineAttempt[];
  responseStartedAtMs?: number;
  responseCompletedAtMs?: number;
}

/** Flattens the collected marks into time-ordered events. */
export function buildRequestTimeline(input: TimelineInput): RequestTimeline {
  const events: RequestTimelineEvent[] = [{ type: 'received', at: input.receivedAtMs }];
  for (const { ref, start } of input.attempts) {
    const who = { attempt: ref.attemptNumber, provider: start.provider, model: start.model };
    if (start.providerCallStarted === false) {
      events.push({ type: 'provider_skipped', at: ref.startedAtMs, ...who });
      continue;
    }
    const timing = ref.timing;
    events.push({ type: 'provider_request', at: timing?.sentAtMs ?? ref.startedAtMs, ...who });
    if (timing?.responseAtMs != null) {
      events.push({
        type: 'provider_response',
        at: timing.responseAtMs,
        ...who,
        status: timing.status,
      });
    } else if (ref.completedAtMs != null) {
      // The fetch itself failed (network, timeout): no response ever arrived.
      events.push({ type: 'provider_error', at: ref.completedAtMs, ...who });
    }
    if (timing?.firstChunkAtMs != null) {
      events.push({ type: 'first_chunk', at: timing.firstChunkAtMs, ...who });
    }
    if (timing?.lastChunkAtMs != null) {
      events.push({
        type: 'last_chunk',
        at: timing.lastChunkAtMs,
        ...who,
        chunks: timing.chunks,
        bytes: timing.bytes,
      });
    }
  }
  if (input.responseStartedAtMs != null) {
    events.push({ type: 'response_started', at: input.responseStartedAtMs });
  }
  if (input.responseCompletedAtMs != null) {
    events.push({ type: 'response_completed', at: input.responseCompletedAtMs });
  }
  // Stable sort keeps the logical order of marks taken in the same millisecond.
  events.sort((a, b) => a.at - b.at);
  return { version: 1, events };
}
