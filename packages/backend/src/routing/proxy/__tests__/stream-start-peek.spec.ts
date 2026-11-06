import { peekStreamStart } from '../stream-warmup';

const enc = new TextEncoder();

function streamOf(
  parts: Array<string | { delayMs: number }>,
  opts: { endless?: boolean } = {},
): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (i < parts.length) {
        const part = parts[i++];
        if (typeof part === 'string') {
          controller.enqueue(enc.encode(part));
          return;
        }
        await new Promise((r) => setTimeout(r, part.delayMs));
      }
      if (opts.endless) {
        await new Promise((r) => setTimeout(r, 2_000).unref?.());
        return;
      }
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

const KEEPALIVE = ': OPENROUTER PROCESSING\n\n';
const CONTENT = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n';
const ERROR = 'data: {"error":{"code":503,"message":"overloaded"}}\n\n';

describe('peekStreamStart', () => {
  it('fails the hop on keepalives followed by an error', async () => {
    const result = await peekStreamStart(streamOf([KEEPALIVE, KEEPALIVE, ERROR]), {
      warmupMs: 1000,
    });
    expect(result).toMatchObject({ ok: false, reason: 'upstream_error', status: 503 });
  });

  it('replays keepalives and content byte for byte', async () => {
    const parts = [
      KEEPALIVE,
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      CONTENT,
      'data: [DONE]\n\n',
    ];
    const result = await peekStreamStart(streamOf(parts), { warmupMs: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(await readAll(result.stream)).toBe(parts.join(''));
  });

  it('passes an error that arrives after content through to the client', async () => {
    const result = await peekStreamStart(streamOf([CONTENT, ERROR]), { warmupMs: 1000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(await readAll(result.stream)).toBe(CONTENT + ERROR);
  });

  it('keeps peeking past a lone finish_reason "error" chunk', async () => {
    const lone = 'data: {"choices":[{"delta":{},"finish_reason":"error"}]}\n\n';
    const result = await peekStreamStart(streamOf([lone, ERROR]), { warmupMs: 1000 });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it('passes an immediate [DONE] through', async () => {
    const result = await peekStreamStart(streamOf(['data: [DONE]\n\n']), { warmupMs: 1000 });
    expect(result.ok).toBe(true);
  });

  it('passes the stream through as read when the peek window ends', async () => {
    const result = await peekStreamStart(streamOf([KEEPALIVE, { delayMs: 80 }, CONTENT]), {
      warmupMs: 1000,
      peekMs: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(await readAll(result.stream)).toBe(KEEPALIVE + CONTENT);
  });

  it('passes through after maxBytes of keepalives', async () => {
    const big = ': ' + 'x'.repeat(2048) + '\n\n';
    const result = await peekStreamStart(streamOf([big, ERROR]), {
      warmupMs: 1000,
      maxBytes: 1024,
    });
    expect(result.ok).toBe(true);
  });

  it('only reports context errors in context mode', async () => {
    const ctx =
      'data: {"error":{"message":"This model\'s maximum context length is 8192 tokens"}}\n\n';
    expect(
      await peekStreamStart(streamOf([ERROR]), { warmupMs: 1000, mode: 'context' }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await peekStreamStart(streamOf([ctx]), { warmupMs: 1000, mode: 'context' }),
    ).toMatchObject({
      ok: false,
      status: 400,
      contextLength: true,
    });
  });

  it('does not scan in off mode', async () => {
    const result = await peekStreamStart(streamOf([ERROR]), { warmupMs: 1000, mode: 'off' });
    expect(result.ok).toBe(true);
  });

  it('stops at once when the client aborts during the peek', async () => {
    const controller = new AbortController();
    const pending = peekStreamStart(streamOf([KEEPALIVE], { endless: true }), {
      warmupMs: 1000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toMatchObject({ ok: false, reason: 'aborted' });
  });

  it('still reports a first-byte timeout as the warm-up failure', async () => {
    const result = await peekStreamStart(streamOf([], { endless: true }), { warmupMs: 20 });
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });
});
