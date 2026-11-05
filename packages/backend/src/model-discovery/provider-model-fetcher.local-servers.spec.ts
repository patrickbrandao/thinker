import { ProviderModelFetcherService, PROVIDER_CONFIGS } from './provider-model-fetcher.service';

// Issue #76: LM Studio and llama.cpp list their loaded models on the
// OpenAI-compatible `/v1/models` of the configured server.
describe('ProviderModelFetcherService — LM Studio and llama.cpp', () => {
  const ENV_KEYS = ['THINKER_LMSTUDIO_BASE_URL', 'THINKER_LLAMACPP_BASE_URL'];
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let service: ProviderModelFetcherService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env['THINKER_LMSTUDIO_BASE_URL'] = 'http://127.0.0.1:41234/v1';
    process.env['THINKER_LLAMACPP_BASE_URL'] = 'http://127.0.0.1:48080/';
    service = new ProviderModelFetcherService();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('has a fetcher config for both servers', () => {
    expect(PROVIDER_CONFIGS['lmstudio']).toBeDefined();
    expect(PROVIDER_CONFIGS['llamacpp']).toBeDefined();
  });

  it.each([
    ['lmstudio', 'http://127.0.0.1:41234/api/v0/models'],
    ['llamacpp', 'http://127.0.0.1:48080/v1/models'],
  ])('lists %s models from %s', async (provider, url) => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'qwen/qwen3-8b', object: 'model', owned_by: 'organization_owner' },
            { id: 'text-embedding-nomic-embed-text-v1.5', object: 'model' },
          ],
        }),
        { status: 200 },
      ),
    );

    const models = await service.fetch(provider, '', 'local');

    expect(fetchSpy).toHaveBeenCalledWith(url, expect.anything());
    expect(fetchSpy.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
    // The embedder is dropped by the universal non-chat filter.
    expect(models.map((m) => m.id)).toEqual(['qwen/qwen3-8b']);
    expect(models[0]).toEqual(expect.objectContaining({ provider }));
  });

  it.each([
    ['404', () => new Response('not found', { status: 404 })],
    ['a network error', () => Promise.reject(new Error('socket hang up'))],
    [
      'a 200 that is not a model list',
      () => new Response(JSON.stringify({ object: 'chat.completion' }), { status: 200 }),
    ],
  ])(
    'falls back to the OpenAI /v1/models when LM Studio /api/v0/models answers %s',
    async (_label, rich) => {
      fetchSpy.mockImplementation(async (url: string) =>
        url.endsWith('/api/v0/models')
          ? rich()
          : new Response(
              JSON.stringify({
                object: 'list',
                data: [
                  { id: 'qwen/qwen3-8b', object: 'model' },
                  { id: 'text-embedding-nomic-embed-text-v1.5', object: 'model' },
                ],
              }),
              { status: 200 },
            ),
      );

      const models = await service.fetch('lmstudio', '', 'local');

      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
        'http://127.0.0.1:41234/api/v0/models',
        'http://127.0.0.1:41234/v1/models',
      ]);
      expect(models.map((m) => m.id)).toEqual(['qwen/qwen3-8b']);
    },
  );

  it('does not fall back when /api/v0/models answers, even with no chat models', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'nomic-embed', type: 'embeddings' }] }), {
        status: 200,
      }),
    );

    await expect(service.fetch('lmstudio', '', 'local')).resolves.toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns no models when the local server is down', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    await expect(service.fetch('lmstudio', '', 'local')).resolves.toEqual([]);
  });
});
