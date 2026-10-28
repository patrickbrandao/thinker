import { buildRequestTimeline, markProviderSent, timeProviderResponse } from '../request-timeline';
import type { ProviderAttemptRef } from '../proxy-types';

function attemptRef(n: number, startedAtMs: number): ProviderAttemptRef {
  return {
    id: `a${n}`,
    attemptNumber: n,
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    pendingWrite: Promise.resolve(true),
  };
}

describe('request timeline', () => {
  it('records header, first and last chunk marks as the body is read', async () => {
    const attempt = attemptRef(1, Date.now());
    markProviderSent(attempt);
    const upstream = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'));
          c.enqueue(new TextEncoder().encode('data: {"b":2}\n\n'));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
    const timed = timeProviderResponse(upstream, attempt);
    expect(timed.status).toBe(200);
    expect(timed.headers.get('content-type')).toBe('text/event-stream');
    expect(await timed.text()).toBe('data: {"a":1}\n\ndata: {"b":2}\n\n');
    expect(attempt.timing).toMatchObject({ status: 200, chunks: 2, bytes: 30 });
    expect(attempt.timing!.firstChunkAtMs).toBeGreaterThanOrEqual(attempt.timing!.sentAtMs!);
    expect(attempt.timing!.lastChunkAtMs).toBeGreaterThanOrEqual(attempt.timing!.firstChunkAtMs!);
  });

  it('orders events across attempts and marks a failed fetch', () => {
    const failed = attemptRef(1, 1_010);
    failed.timing = { sentAtMs: 1_012, chunks: 0, bytes: 0 };
    failed.completedAtMs = 1_200;
    const ok = attemptRef(2, 1_210);
    ok.timing = {
      sentAtMs: 1_211,
      responseAtMs: 1_400,
      status: 200,
      firstChunkAtMs: 1_401,
      lastChunkAtMs: 1_900,
      chunks: 12,
      bytes: 3_000,
    };
    const timeline = buildRequestTimeline({
      receivedAtMs: 1_000,
      attempts: [
        { ref: ok, start: { provider: 'anthropic', model: 'claude' } },
        { ref: failed, start: { provider: 'openai', model: 'gpt' } },
      ],
      responseStartedAtMs: 1_402,
      responseCompletedAtMs: 1_905,
    });
    expect(timeline.events.map((e) => [e.type, e.at, e.attempt])).toEqual([
      ['received', 1_000, undefined],
      ['provider_request', 1_012, 1],
      ['provider_error', 1_200, 1],
      ['provider_request', 1_211, 2],
      ['provider_response', 1_400, 2],
      ['first_chunk', 1_401, 2],
      ['response_started', 1_402, undefined],
      ['last_chunk', 1_900, 2],
      ['response_completed', 1_905, undefined],
    ]);
  });
});
