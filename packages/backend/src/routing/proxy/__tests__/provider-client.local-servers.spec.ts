import { ProviderClient } from '../provider-client';
import { PROVIDER_ENDPOINTS, resolveEndpointKey } from '../provider-endpoints';

const mockFetch = jest.fn();
(globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch;

// Issue #76: LM Studio and llama.cpp connected as built-in local providers,
// but every chat failed with "No endpoint configured for provider".
describe('built-in local OpenAI-compatible servers (LM Studio, llama.cpp)', () => {
  const ENV_KEYS = ['MANIFEST_MODE', 'THINKER_LMSTUDIO_BASE_URL', 'THINKER_LLAMACPP_BASE_URL'];
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let client: ProviderClient;

  beforeEach(() => {
    process.env['MANIFEST_MODE'] = 'selfhosted';
    process.env['THINKER_LMSTUDIO_BASE_URL'] = 'http://127.0.0.1:41234/v1';
    process.env['THINKER_LLAMACPP_BASE_URL'] = 'http://127.0.0.1:48080';
    client = new ProviderClient();
    mockFetch.mockReset();
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('endpoint registry', () => {
    it.each([
      ['lmstudio', 'lmstudio'],
      ['LMStudio', 'lmstudio'],
      ['lm-studio', 'lmstudio'],
      ['lm studio', 'lmstudio'],
      ['llamacpp', 'llamacpp'],
      ['llama.cpp', 'llamacpp'],
      ['llama-cpp', 'llamacpp'],
    ])('resolves %s to the %s endpoint', (provider, key) => {
      expect(resolveEndpointKey(provider)).toBe(key);
    });

    it.each(['lmstudio', 'llamacpp'])('%s speaks OpenAI chat completions', (key) => {
      const endpoint = PROVIDER_ENDPOINTS[key];
      expect(endpoint.format).toBe('openai');
      expect(endpoint.buildPath('any')).toBe('/v1/chat/completions');
      expect(endpoint.streamUsageReporting).toBe('openai_stream_options');
      // Operator-configured (env), like OLLAMA_HOST, not user-supplied.
      expect(endpoint.requiresSsrfRevalidation).toBeUndefined();
    });

    it('reads the base URL when the request is forwarded', () => {
      expect(PROVIDER_ENDPOINTS['lmstudio'].baseUrl).toBe('http://127.0.0.1:41234');
      process.env['THINKER_LMSTUDIO_BASE_URL'] = 'http://127.0.0.1:45555/';
      expect(PROVIDER_ENDPOINTS['lmstudio'].baseUrl).toBe('http://127.0.0.1:45555');
      expect(PROVIDER_ENDPOINTS['llamacpp'].baseUrl).toBe('http://127.0.0.1:48080');
    });
  });

  describe('forward', () => {
    const body = { messages: [{ role: 'user', content: 'Hello' }] };

    it.each([
      ['lmstudio', 'http://127.0.0.1:41234/v1/chat/completions'],
      ['llamacpp', 'http://127.0.0.1:48080/v1/chat/completions'],
    ])('sends %s chat to the configured server', async (provider, url) => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      await client.forward({ provider, apiKey: '', model: 'qwen3-8b', body, stream: false });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe(url);
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      const sent = JSON.parse(init.body);
      expect(sent).toEqual(expect.objectContaining({ model: 'qwen3-8b', messages: body.messages }));
      expect(sent.stream).toBeFalsy();
    });

    it('keeps LM Studio hub ids and llama.cpp aliases with slashes intact', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      await client.forward({
        provider: 'lmstudio',
        apiKey: '',
        model: 'qwen/qwen3-8b',
        body,
        stream: false,
      });
      await client.forward({
        provider: 'llamacpp',
        apiKey: '',
        model: 'models/gemma-3-4b-it-Q4_K_M.gguf',
        body,
        stream: false,
      });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).model).toBe('qwen/qwen3-8b');
      expect(JSON.parse(mockFetch.mock.calls[1][1].body).model).toBe(
        'models/gemma-3-4b-it-Q4_K_M.gguf',
      );
    });

    it.each(['lmstudio', 'llamacpp'])(
      'asks %s for a final usage chunk when streaming',
      async (provider) => {
        mockFetch.mockResolvedValue(new Response('', { status: 200 }));

        await client.forward({ provider, apiKey: '', model: 'qwen3-8b', body, stream: true });

        const sent = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(sent.stream).toBe(true);
        expect(sent.stream_options).toEqual({ include_usage: true });
      },
    );

    it('forwards a stored server token as a bearer header', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

      await client.forward({
        provider: 'llamacpp',
        apiKey: 'llama-server-key',
        model: 'qwen3-8b',
        body,
        stream: false,
      });

      expect(mockFetch.mock.calls[0][1].headers).toEqual({
        Authorization: 'Bearer llama-server-key',
        'Content-Type': 'application/json',
      });
    });
  });
});
