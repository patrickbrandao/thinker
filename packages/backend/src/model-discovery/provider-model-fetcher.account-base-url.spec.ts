import * as ssrf from '../common/utils/ssrf-safe-fetch';
import * as outbound from '../common/outbound/outbound-proxy';
import { ProviderModelFetcherService } from './provider-model-fetcher.service';

const modelsResponse = () =>
  new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('ProviderModelFetcherService with a connection base URL', () => {
  afterEach(() => jest.restoreAllMocks());

  it('pins the destination and refuses redirects on a base URL the user typed', async () => {
    const safe = jest.spyOn(ssrf, 'ssrfSafeFetch').mockResolvedValue(modelsResponse());
    const plain = jest.spyOn(outbound, 'outboundFetch');
    const service = new ProviderModelFetcherService();

    const models = await service.fetch('deepseek', 'sk-test', 'api_key', undefined, {
      accountBaseUrl: { base: 'https://203.0.113.10', official: 'https://api.deepseek.com' },
    });

    expect(models.map((m) => m.id)).toEqual(['deepseek-chat']);
    expect(safe).toHaveBeenCalledWith(
      'https://203.0.113.10/models',
      expect.objectContaining({ redirect: 'error' }),
      { allowPrivate: true },
    );
    expect(plain).not.toHaveBeenCalled();
  });

  it('refuses private addresses at connect time when the base URL was saved without private access', async () => {
    const safe = jest.spyOn(ssrf, 'ssrfSafeFetch').mockResolvedValue(modelsResponse());
    const service = new ProviderModelFetcherService();
    await service.fetch('deepseek', 'sk-test', 'api_key', undefined, {
      accountBaseUrl: {
        base: 'https://203.0.113.10',
        official: 'https://api.deepseek.com',
        allowPrivate: false,
      },
    });
    expect(safe).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
      allowPrivate: false,
    });
  });

  it('keeps the plain outbound fetch for the official endpoint', async () => {
    const safe = jest.spyOn(ssrf, 'ssrfSafeFetch');
    const plain = jest.spyOn(outbound, 'outboundFetch').mockResolvedValue(modelsResponse());
    const service = new ProviderModelFetcherService();

    await service.fetch('deepseek', 'sk-test', 'api_key');

    expect(plain).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.anything());
    expect(safe).not.toHaveBeenCalled();
  });
});
