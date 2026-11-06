import type { DiscoveredModel } from './model-fetcher';
import { LiveContextService, type LiveContextFetch } from './live-context';

const model = (overrides: Partial<DiscoveredModel> = {}): DiscoveredModel => ({
  id: 'custom:cp-1/qwen',
  displayName: 'qwen',
  provider: 'custom:cp-1',
  contextWindow: 65536,
  inputPricePerToken: 0,
  outputPricePerToken: 0,
  capabilityReasoning: false,
  capabilityCode: false,
  qualityScore: 3,
  ...overrides,
});

const props = (nCtx: unknown, status = 200) =>
  new Response(JSON.stringify({ default_generation_settings: { n_ctx: nCtx } }), { status });

function setup(responses: Array<Response | Error | (() => Promise<Response>)>) {
  let clock = 1_000_000;
  const fetchImpl = jest.fn<ReturnType<LiveContextFetch>, Parameters<LiveContextFetch>>(
    async () => {
      const next = responses.shift();
      if (!next) throw new Error('no more responses');
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next() : next;
    },
  );
  const service = LiveContextService.withDeps(fetchImpl, () => clock);
  service.setTarget('custom:cp-1', { rootUrl: 'http://llama:9931' });
  return { service, fetchImpl, advance: (ms: number) => (clock += ms) };
}

describe('LiveContextService', () => {
  it('lowers the window to the live n_ctx and never raises it', async () => {
    const { service, fetchImpl } = setup([props(32768)]);
    const [lowered] = await service.apply([model()]);
    expect(lowered.contextWindow).toBe(32768);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://llama:9931/props',
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('headers');

    const higher = setup([props(131072)]);
    const [kept] = await higher.service.apply([model()]);
    expect(kept.contextWindow).toBe(65536);
  });

  it('uses the live value when only a stand-in window was registered', async () => {
    const { service } = setup([props(131072)]);
    const [m] = await service.apply([
      model({ contextWindow: 1_000_000, contextWindowSource: 'default' }),
    ]);
    expect(m).toMatchObject({ contextWindow: 131072 });
    expect(m.contextWindowSource).toBeUndefined();
  });

  it('caches a good read for the TTL and shares one fetch across callers', async () => {
    const { service, fetchImpl, advance } = setup([props(32768), props(16384)]);
    await Promise.all([service.apply([model()]), service.apply([model()])]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(59_000);
    expect((await service.apply([model()]))[0].contextWindow).toBe(32768);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(2_000);
    expect((await service.apply([model()]))[0].contextWindow).toBe(16384);
  });

  it('keeps a recent value through a transient failure, then falls back', async () => {
    const { service, advance } = setup([props(32768), new Error('ECONNREFUSED'), props(0, 503)]);
    await service.apply([model()]);
    advance(61_000);
    expect((await service.apply([model()]))[0].contextWindow).toBe(32768);
    advance(10 * 60_000);
    expect((await service.apply([model()]))[0].contextWindow).toBe(65536);
  });

  it('falls back to the registered window on a definitive failure', async () => {
    for (const reply of [
      props(0, 404),
      new Response('<html>', { status: 200 }),
      props(undefined), // router mode: no n_ctx
    ]) {
      const { service } = setup([reply]);
      expect((await service.apply([model()]))[0].contextWindow).toBe(65536);
    }
  });

  it('passes a timeout signal and treats an abort as transient', async () => {
    const abort = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const { service, fetchImpl } = setup([abort]);
    expect((await service.apply([model()]))[0].contextWindow).toBe(65536);
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('leaves other providers and cleared targets alone', async () => {
    const { service, fetchImpl } = setup([props(1024)]);
    const other = model({ provider: 'openai', id: 'gpt-4o' });
    expect(await service.apply([other])).toEqual([other]);
    service.setTarget('custom:cp-1', null);
    expect((await service.apply([model()]))[0].contextWindow).toBe(65536);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is off with THINKER_LIVE_CONTEXT=false', async () => {
    const saved = process.env.THINKER_LIVE_CONTEXT;
    process.env.THINKER_LIVE_CONTEXT = 'false';
    try {
      const { service, fetchImpl } = setup([props(1024)]);
      expect((await service.apply([model()]))[0].contextWindow).toBe(65536);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (saved === undefined) delete process.env.THINKER_LIVE_CONTEXT;
      else process.env.THINKER_LIVE_CONTEXT = saved;
    }
  });
});
