import type { ProviderAttemptRef } from '../proxy-types';
import { noteServedFromBody, servedIdentityOf, servedSniffer } from '../served-provider';

const attempt = () => ({ id: 'a' }) as unknown as ProviderAttemptRef;
const enc = new TextEncoder();

describe('served provider capture', () => {
  it('reads provider, id and model from a body, and provider_name from an error', () => {
    expect(
      servedIdentityOf({ id: 'gen-1', provider: 'DeepInfra', model: 'deepseek/deepseek-v4' }),
    ).toEqual({ provider: 'DeepInfra', generationId: 'gen-1', model: 'deepseek/deepseek-v4' });
    expect(
      servedIdentityOf({ error: { code: 503, metadata: { provider_name: 'Nvidia' } } }).provider,
    ).toBe('Nvidia');
  });

  it('notes a buffered body without overwriting what is known', () => {
    const a = attempt();
    noteServedFromBody(a, enc.encode('{"id":"gen-1","provider":"Together"}').buffer as ArrayBuffer);
    noteServedFromBody(a, '{"id":"gen-2","provider":"Other","model":"m"}');
    expect(a.served).toEqual({ provider: 'Together', generationId: 'gen-1', model: 'm' });
    const b = attempt();
    noteServedFromBody(b, 'not json');
    expect(b.served).toBeUndefined();
  });

  it('sniffs a stream with the field split across chunks and passes bytes through', async () => {
    const a = attempt();
    const sniffer = servedSniffer(a)!;
    const parts = [
      ': OPENROUTER PROCESSING\n\n',
      'data: {"id":"gen-9","provider":"Deep',
      'Infra","model":"x/y","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    const out = await new Response(source.pipeThrough(sniffer)).text();
    expect(out).toBe(parts.join(''));
    expect(a.served).toEqual({ provider: 'DeepInfra', generationId: 'gen-9', model: 'x/y' });
  });

  it('is off with THINKER_SERVED_PROVIDER_CAPTURE=false', () => {
    const saved = process.env.THINKER_SERVED_PROVIDER_CAPTURE;
    process.env.THINKER_SERVED_PROVIDER_CAPTURE = 'false';
    try {
      expect(servedSniffer(attempt())).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.THINKER_SERVED_PROVIDER_CAPTURE;
      else process.env.THINKER_SERVED_PROVIDER_CAPTURE = saved;
    }
  });
});
