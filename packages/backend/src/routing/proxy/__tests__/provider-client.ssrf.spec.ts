// Pinned fetch goes through the mocked global fetch here; its own behavior is covered by ssrf-safe-fetch.spec.ts.
jest.mock('../../../common/utils/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: jest.fn((url: string, init?: RequestInit) => globalThis.fetch(url, init)),
}));
// SSRF revalidation tests for ProviderClient.
//
// The provider-client.ts implements a defense-in-depth check
// (`requiresSsrfRevalidation` → validatePublicUrl at forward time) so
// that user-supplied custom-provider URLs can't be flipped to private /
// metadata addresses via DNS rebinding *after* registration. The real
// validator is a no-op when NODE_ENV === 'test' (see
// `common/utils/url-validation.ts`), so we jest.mock it to force the
// security branch to execute.

jest.mock('../../../common/utils/url-validation', () => ({
  validatePublicUrl: jest.fn(),
}));

import { ProviderClient } from '../provider-client';
import { buildCustomEndpoint, ProviderEndpoint } from '../provider-endpoints';
import {
  buildTransportErrorResponse,
  isTransportError,
  ProviderUrlBlockedError,
} from '../proxy-transport';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validatePublicUrl } = require('../../../common/utils/url-validation');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ssrfSafeFetch } = require('../../../common/utils/ssrf-safe-fetch');

const mockFetch = jest.fn();
(globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch;

const body = {
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.7,
};

describe('ProviderClient — SSRF revalidation for custom endpoints', () => {
  let client: ProviderClient;

  beforeEach(() => {
    client = new ProviderClient();
    mockFetch.mockReset();
    (validatePublicUrl as jest.Mock).mockReset();
    (ssrfSafeFetch as jest.Mock).mockClear();
  });

  it('re-validates URL through validatePublicUrl when endpoint requires revalidation', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    (validatePublicUrl as jest.Mock).mockResolvedValue(undefined);

    // buildCustomEndpoint sets requiresSsrfRevalidation: true.
    const customEndpoint = buildCustomEndpoint('https://upstream.example.com/v1');

    await client.forward({
      provider: 'custom:abc',
      apiKey: 'sk-cust',
      model: 'my-model',
      body,
      stream: false,
      customEndpoint,
    });

    expect(validatePublicUrl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = (validatePublicUrl as jest.Mock).mock.calls[0];
    // normalizeProviderBaseUrl strips trailing /v1, then buildPath adds /v1/chat/completions.
    expect(calledUrl).toBe('https://upstream.example.com/v1/chat/completions');
    // LAN destinations are a feature; cloud metadata stays blocked inside the
    // validator regardless of allowPrivate.
    expect(calledOpts).toEqual({ allowPrivate: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('allows a local endpoint with no deployment mode configured', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    (validatePublicUrl as jest.Mock).mockResolvedValue(undefined);

    const customEndpoint = buildCustomEndpoint('http://localhost:8000');

    await client.forward({
      provider: 'custom:local',
      apiKey: 'k',
      model: 'm',
      body,
      stream: false,
      customEndpoint,
    });

    const [, calledOpts] = (validatePublicUrl as jest.Mock).mock.calls[0];
    expect(calledOpts).toEqual({ allowPrivate: true });
  });

  it('refuses to forward and never calls fetch when revalidation throws (DNS rebinding sim)', async () => {
    // Simulates the URL passing initial registration but the hostname
    // rebinding to a private/metadata address by the time we forward.
    (validatePublicUrl as jest.Mock).mockRejectedValue(
      new Error('URLs pointing to cloud metadata endpoints are not allowed'),
    );

    const customEndpoint = buildCustomEndpoint('https://victim.example.com');

    await expect(
      client.forward({
        provider: 'custom:rebound',
        apiKey: 'sk-cust',
        model: 'm',
        body,
        stream: false,
        customEndpoint,
      }),
    ).rejects.toThrow(
      /Refusing to forward to disallowed URL.*cloud metadata endpoints are not allowed/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('wraps non-Error rejections from validatePublicUrl with Refusing-to-forward prefix', async () => {
    (validatePublicUrl as jest.Mock).mockRejectedValue('private-network-blocked');

    const customEndpoint = buildCustomEndpoint('https://rebound.example.com');

    await expect(
      client.forward({
        provider: 'custom:x',
        apiKey: 'k',
        model: 'm',
        body,
        stream: false,
        customEndpoint,
      }),
    ).rejects.toThrow('Refusing to forward to disallowed URL: private-network-blocked');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does NOT call validatePublicUrl for built-in endpoints (no revalidation flag)', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await client.forward({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      body,
      stream: false,
    });

    expect(validatePublicUrl).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT call validatePublicUrl when a custom endpoint omits requiresSsrfRevalidation', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    // Hand-built endpoint without the revalidation flag — exercises the
    // `!endpoint.requiresSsrfRevalidation` branch.
    const customEndpoint: ProviderEndpoint = {
      baseUrl: 'https://trusted-template.example.com',
      buildHeaders: (key: string) => ({
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      }),
      buildPath: () => '/chat/completions',
      format: 'openai',
    };

    await client.forward({
      provider: 'custom:no-revalidate',
      apiKey: 'sk',
      model: 'm',
      body,
      stream: false,
      customEndpoint,
    });

    expect(validatePublicUrl).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends a user-supplied endpoint through the pinned ssrfSafeFetch (DNS rebinding)', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    (validatePublicUrl as jest.Mock).mockResolvedValue(undefined);

    await client.forward({
      provider: 'custom:abc',
      apiKey: 'sk-cust',
      model: 'm',
      body,
      stream: false,
      customEndpoint: buildCustomEndpoint('https://upstream.example.com/v1'),
    });

    expect(ssrfSafeFetch).toHaveBeenCalledTimes(1);
    expect((ssrfSafeFetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://upstream.example.com/v1/chat/completions',
    );
    expect((ssrfSafeFetch as jest.Mock).mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('keeps built-in provider endpoints on the plain fetch', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await client.forward({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      body,
      stream: false,
    });

    expect(ssrfSafeFetch).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  describe('blocked provider URLs surface as a 502 with their own code (#74)', () => {
    const forwardCustom = () =>
      client.forward({
        provider: 'custom:x',
        apiKey: 'k',
        model: 'm',
        body,
        stream: false,
        customEndpoint: buildCustomEndpoint('https://rebound.example.com'),
      });

    it('throws ProviderUrlBlockedError when revalidation refuses the URL', async () => {
      (validatePublicUrl as jest.Mock).mockRejectedValue(new Error('cloud metadata'));
      const error = await forwardCustom().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderUrlBlockedError);
      expect(isTransportError(error)).toBe(true);
    });

    it('maps a connect-time SSRF refusal (the cause of fetch failed) the same way', async () => {
      (validatePublicUrl as jest.Mock).mockResolvedValue(undefined);
      mockFetch.mockRejectedValue(
        new TypeError('fetch failed', {
          cause: Object.assign(
            new Error('rebound.example.com resolved to a cloud metadata address'),
            {
              code: 'ESSRFBLOCKED',
            },
          ),
        }),
      );
      const error = await forwardCustom().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderUrlBlockedError);

      const response = buildTransportErrorResponse(error);
      expect(response.status).toBe(502);
      const json = (await response.json()) as { error: Record<string, string> };
      expect(json.error.code).toBe('provider_url_blocked');
      expect(json.error.message).toContain('Provider URL blocked by the SSRF policy');
      expect(json.error.message).toContain('cloud metadata address');
    });

    it('keeps the sanitized cause of any other fetch failure', async () => {
      (validatePublicUrl as jest.Mock).mockResolvedValue(undefined);
      mockFetch.mockRejectedValue(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect ECONNREFUSED https://h/?key=SECRET'), {
            code: 'ECONNREFUSED',
          }),
        }),
      );
      const error = (await forwardCustom().catch((e: unknown) => e)) as Error;
      expect(error.message).toBe('fetch failed');
      const cause = error.cause as Error & { code?: string };
      expect(cause.code).toBe('ECONNREFUSED');
      expect(cause.message).toContain('key=***');
      expect(cause.message).not.toContain('SECRET');
    });
  });
});
