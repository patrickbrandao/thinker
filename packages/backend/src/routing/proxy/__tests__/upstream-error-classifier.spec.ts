import {
  embeddedUpstreamError,
  isContextLengthBody,
  scanSseStart,
} from '../upstream-error-classifier';

const buf = (value: unknown) =>
  new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
    .buffer as ArrayBuffer;

describe('embeddedUpstreamError', () => {
  it('turns an OpenRouter 503 inside a 200 into that status', () => {
    const body = {
      error: { code: 503, message: 'overloaded', metadata: { provider_name: 'Nvidia' } },
    };
    expect(embeddedUpstreamError(buf(body))).toEqual({
      status: 503,
      body: JSON.stringify(body),
      contextLength: false,
    });
  });

  it('reads a 3-digit string code and falls back to 502 without one', () => {
    expect(
      embeddedUpstreamError(buf({ error: { code: '429', message: 'slow down' } }))?.status,
    ).toBe(429);
    expect(embeddedUpstreamError(buf({ error: { message: 'boom' } }))?.status).toBe(502);
    expect(embeddedUpstreamError(buf({ error: 'plain string' }))?.status).toBe(502);
  });

  it('maps an uncoded context overflow to 400', () => {
    const result = embeddedUpstreamError(
      buf({ error: { message: "This model's maximum context length is 65536 tokens" } }),
    );
    expect(result).toMatchObject({ status: 400, contextLength: true });
  });

  it('leaves real successes, mixed bodies, non-JSON and oversized bodies alone', () => {
    expect(embeddedUpstreamError(buf({ choices: [], error: { code: 500 } }))).toBeNull();
    expect(embeddedUpstreamError(buf({ id: 'x', content: [] }))).toBeNull();
    expect(embeddedUpstreamError(buf('not json'))).toBeNull();
    expect(embeddedUpstreamError(buf({ ok: true }))).toBeNull();
    const big = JSON.stringify({ error: { message: 'x'.repeat(2 * 1024 * 1024) } });
    expect(embeddedUpstreamError(buf(big))).toBeNull();
  });
});

describe('isContextLengthBody', () => {
  it.each([
    '{"error":{"code":"context_length_exceeded","message":"too long"}}',
    '{"error":{"message":"the request exceeds the available context size, try increasing it","type":"exceed_context_size_error"}}',
    '{"error":{"message":"Input is too long for requested model."}}',
    '{"error":{"message":"prompt is too long: 210000 tokens > 200000 maximum"}}',
    '{"error":{"message":"Provider returned error","metadata":{"raw":"input length exceeds the context window"}}}',
  ])('detects %s', (body) => {
    expect(isContextLengthBody(body)).toBe(true);
  });

  it('ignores errors that only echo the prompt outside structured fields', () => {
    const body = JSON.stringify({
      error: { message: 'Invalid tool schema' },
      echo: 'maximum context length is 10 tokens',
    });
    expect(isContextLengthBody(body)).toBe(false);
  });
});

describe('scanSseStart', () => {
  it('stays pending on keepalives, comments and preamble events', () => {
    expect(scanSseStart(': OPENROUTER PROCESSING\n\n: OPENROUTER PROCESSING\n\n')).toEqual({
      state: 'pending',
    });
    expect(
      scanSseStart('event: message_start\ndata: {"type":"message_start","message":{}}\n\n'),
    ).toEqual({ state: 'pending' });
    expect(
      scanSseStart('data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n'),
    ).toEqual({ state: 'pending' });
  });

  it('reports an OpenRouter error after keepalives', () => {
    const verdict = scanSseStart(
      ': OPENROUTER PROCESSING\n\ndata: {"error":{"code":503,"message":"overloaded"},"choices":[{"delta":{"content":""},"finish_reason":"error"}]}\n\n',
    );
    expect(verdict).toMatchObject({ state: 'error', status: 503, contextLength: false });
  });

  it('reports Anthropic error events and Responses response.failed', () => {
    expect(
      scanSseStart(
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      ),
    ).toMatchObject({ state: 'error', status: 502 });
    expect(
      scanSseStart(
        'data: {"type":"response.created","response":{}}\n\ndata: {"type":"response.failed","response":{"error":{"code":"context_length_exceeded","message":"Your input exceeds the context window"}}}\n\n',
      ),
    ).toMatchObject({ state: 'error', status: 400, contextLength: true });
  });

  it('treats a finish_reason "error" alone as no content', () => {
    expect(scanSseStart('data: {"choices":[{"delta":{},"finish_reason":"error"}]}\n\n')).toEqual({
      state: 'pending',
    });
  });

  it('sees content, usage, [DONE] and unknown payloads as content', () => {
    expect(scanSseStart('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')).toEqual({
      state: 'content',
    });
    expect(scanSseStart('data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n')).toEqual({
      state: 'content',
    });
    expect(scanSseStart('data: {"choices":[],"usage":{"prompt_tokens":1}}\n\n')).toEqual({
      state: 'content',
    });
    expect(scanSseStart('data: [DONE]\n\n')).toEqual({ state: 'content' });
    expect(scanSseStart('data: not-json\n\n')).toEqual({ state: 'content' });
    expect(
      scanSseStart('event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n'),
    ).toEqual({
      state: 'content',
    });
  });

  it('ignores an incomplete trailing event', () => {
    expect(scanSseStart('data: {"error":{"code":500')).toEqual({ state: 'pending' });
  });
});
