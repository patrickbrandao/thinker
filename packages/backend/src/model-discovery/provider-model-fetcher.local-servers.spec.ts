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
    ['lmstudio', 'http://127.0.0.1:41234/v1/models'],
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

  it('returns no models when the local server is down', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    await expect(service.fetch('lmstudio', '', 'local')).resolves.toEqual([]);
  });
});
