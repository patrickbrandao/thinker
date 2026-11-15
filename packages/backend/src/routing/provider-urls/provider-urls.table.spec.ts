// Pinned fetch goes through the mocked global fetch; ssrf-safe-fetch.spec.ts covers the pinning.
jest.mock('../../common/utils/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: jest.fn((url: string, init?: RequestInit) => globalThis.fetch(url, init)),
}));

import { PROVIDER_URL_SLOTS } from 'thinker-shared';
import { ProviderClient } from '../proxy/provider-client';
import { ProviderModelFetcherService } from '../../model-discovery/provider-model-fetcher.service';
import { OpencodeCatalogService } from '../../model-discovery/opencode-catalog.service';
import { OpenaiOauthService } from '../oauth/openai/openai-oauth.service';
import { GeminiOauthService } from '../oauth/gemini/gemini-oauth.service';
import { XaiOauthService } from '../oauth/xai/xai-oauth.service';
import { AnthropicOauthService } from '../oauth/anthropic/anthropic-oauth.service';
import { MinimaxOauthService } from '../oauth/minimax/minimax-oauth.service';
import { KiroOauthService } from '../oauth/kiro/kiro-oauth.service';
import { OpencodeOauthService } from '../oauth/opencode/opencode-oauth.service';
import { CopilotDeviceAuthService } from '../oauth/copilot/copilot-device-auth.service';
import { CopilotTokenService } from '../proxy/copilot-token.service';
import { CodeAssistClientService } from '../oauth/gemini/codeassist-client.service';
import { detectQwenRegion } from '../qwen-region';
import type { ModelUrlOverrides } from '../../model-discovery/provider-model-fetcher.service';
import {
  defaultProviderUrl,
  resolveProviderUrl,
  runWithProviderUrls,
  type ProviderUrlConnection,
} from './provider-urls';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ssrfSafeFetch } = require('../../common/utils/ssrf-safe-fetch');

/**
 * ADR 0012 table test: every slot of PROVIDER_URL_SLOTS has a default, the
 * call that uses it goes to that default without an override, and to the
 * override (through the pinned, no-redirect fetch) with one.
 */
const OVERRIDE = 'https://sim.example.test/acct';

const PERMISSIVE_BODY = {
  data: [],
  models: [],
  token: 'tid=1',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  device_code: 'dev-1',
  user_code: 'UC',
  verification_uri: 'https://github.com/login/device',
  verification_uri_complete: 'https://opencode.ai/console/device?c=1',
  expires_in: 900,
  interval: 5,
  error: 'authorization_pending',
};

const mockFetch = jest.fn(
  async (..._args: unknown[]) =>
    new Response(JSON.stringify(PERMISSIVE_BODY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
);
(globalThis as unknown as { fetch: unknown }).fetch = mockFetch;

const config = {
  get: (key: string) => (key === 'app.nodeEnv' ? 'production' : undefined),
} as never;
const providerService = {} as never;
const discovery = {} as never;

const hits = () => mockFetch.mock.calls.map((call) => String(call[0]));
const swallow = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch {
    // The permissive body does not satisfy every flow; the URL was hit already.
  }
};

/** A model that makes ProviderClient pick the variant of each inference slot. */
function modelFor(provider: string, slot: string): string {
  if (slot === 'inference_responses')
    return provider === 'xai' ? 'grok-4-multi-agent' : 'gpt-5-codex';
  if (slot === 'inference_anthropic') return 'claude-sonnet-4-5';
  if (slot === 'inference_google') return 'gemini-3-pro';
  if (slot === 'inference_mantle') return 'mistral.mistral-large';
  if (slot === 'inference_runtime') return 'us.anthropic.claude-opus-5-5';
  return 'test-model';
}

const LISTING_SLOTS = ['models', 'models_base_catalog', 'models_recommended', 'cris_profiles'];

type Driver = (provider: string, auth: string, conn: ProviderUrlConnection) => Promise<string[]>;

const inference: Driver = async (provider, auth, conn) => {
  await swallow(() =>
    new ProviderClient().forward({
      provider,
      apiKey: 'k',
      model: modelFor(provider, slotUnderTest),
      body: { messages: [{ role: 'user', content: 'hi' }] },
      stream: false,
      authType: auth,
      urls: conn,
      providerResource: 'project-1',
    }),
  );
  return hits();
};

const listing: Driver = async (provider, auth, conn) => {
  const urls: ModelUrlOverrides = {};
  for (const slot of LISTING_SLOTS) {
    const resolved = resolveProviderUrl(conn, slot);
    if (resolved?.overridden) urls[slot as keyof ModelUrlOverrides] = resolved;
  }
  process.env.THINKER_CATALOG_SYNC = 'false';
  const fetcher = new ProviderModelFetcherService(new OpencodeCatalogService());
  await swallow(() => fetcher.fetch(provider, 'k', auth, undefined, { urls }));
  delete process.env.THINKER_CATALOG_SYNC;
  return hits();
};

const redirectPkce = (provider: string) => {
  if (provider === 'openai') return new OpenaiOauthService(providerService, config, discovery);
  if (provider === 'xai') return new XaiOauthService(providerService, config, discovery);
  return new GeminiOauthService(providerService, config, discovery, {} as never);
};

const anthropic = () =>
  new AnthropicOauthService(providerService, discovery, { create: jest.fn() } as never);

const DRIVERS: Record<string, Driver> = {
  inference,
  inference_responses: inference,
  inference_anthropic: inference,
  inference_openai: inference,
  inference_google: inference,
  inference_mantle: inference,
  inference_runtime: inference,
  models: listing,
  models_base_catalog: listing,
  models_recommended: listing,
  cris_profiles: listing,
  region_probe_singapore: async (_p, _a, conn) => {
    mockFetch.mockImplementation(async () => new Response('', { status: 401 }));
    await runWithProviderUrls(conn, () => detectQwenRegion('k'));
    return hits();
  },
  usage: async (_p, _a, conn) => {
    const blob = JSON.stringify({ t: 'a', r: 'r', e: Date.now() + 3_600_000, u: 'org-1' });
    await swallow(() =>
      runWithProviderUrls(conn, () =>
        new OpencodeOauthService(providerService, discovery).readGoUsage(blob, 'ag', 't'),
      ),
    );
    return hits();
  },
  console: async (provider, _a, conn) => {
    await swallow(() =>
      new OpencodeOauthService(providerService, discovery).startAuthorization(
        'ag',
        't',
        null,
        provider as 'opencode' | 'opencode-go',
        conn,
      ),
    );
    return hits();
  },
  oauth_authorize: async (provider, _a, conn) => {
    if (provider === 'anthropic')
      return [(await anthropic().generateAuthorizationUrl('a', 't', conn)).url];
    return [await redirectPkce(provider).generateAuthorizationUrl('a', 't', undefined, null, conn)];
  },
  oauth_redirect: async (_p, _a, conn) => {
    const { url } = await anthropic().generateAuthorizationUrl('a', 't', conn);
    return [new URL(url).searchParams.get('redirect_uri') ?? ''];
  },
  oauth_token: async (provider, _a, conn) => {
    await swallow(() =>
      runWithProviderUrls(conn, () =>
        provider === 'anthropic'
          ? anthropic().refreshAccessToken('r')
          : redirectPkce(provider).refreshAccessToken('r'),
      ),
    );
    return hits();
  },
  oauth_revoke: async (provider, _a, conn) => {
    await redirectPkce(provider).revokeToken('t', conn);
    return hits();
  },
  oauth: async (_p, _a, conn) => {
    await swallow(() =>
      runWithProviderUrls(conn, () =>
        new MinimaxOauthService(providerService, config, discovery).refreshAccessToken('r'),
      ),
    );
    return hits();
  },
  device_code: async (_p, _a, conn) => {
    await swallow(() => new CopilotDeviceAuthService().requestDeviceCode(conn, 't'));
    return hits();
  },
  device_token: async (_p, _a, conn) => {
    const auth = new CopilotDeviceAuthService();
    await swallow(() => auth.requestDeviceCode(conn, 't'));
    mockFetch.mockClear();
    await swallow(() => auth.pollForToken('dev-1', 't'));
    return hits();
  },
  token_exchange: async (_p, _a, conn) => {
    await swallow(() =>
      new CopilotTokenService().getCopilotToken(
        'gho',
        resolveProviderUrl(conn, 'token_exchange') ?? undefined,
      ),
    );
    return hits();
  },
  code_assist: async (_p, _a, conn) => {
    await swallow(() =>
      runWithProviderUrls(conn, () => new CodeAssistClientService().onboard('t')),
    );
    return hits();
  },
  oidc: async (_p, _a, conn) => {
    await swallow(() =>
      new KiroOauthService(providerService, config, discovery).startAuthorization(
        'a',
        't',
        null,
        {},
        conn,
      ),
    );
    return hits();
  },
  start_url: async (_p, _a, conn) => {
    mockFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ clientId: 'c', clientSecret: 's' }), { status: 200 }),
    );
    await swallow(() =>
      new KiroOauthService(providerService, config, discovery).startAuthorization(
        'a',
        't',
        null,
        {},
        conn,
      ),
    );
    const device = mockFetch.mock.calls.find((call) =>
      String(call[0]).endsWith('/device_authorization'),
    );
    const init = device?.[1] as RequestInit | undefined;
    return [JSON.parse(String(init?.body ?? '{}')).startUrl ?? ''];
  },
};
DRIVERS.region_probe_us = DRIVERS.region_probe_singapore;
DRIVERS.region_probe_beijing = DRIVERS.region_probe_singapore;

let slotUnderTest = '';

const cases = Object.entries(PROVIDER_URL_SLOTS).flatMap(([provider, slots]) =>
  slots.flatMap((slot) => slot.authTypes.map((auth) => [provider, auth, slot.id] as const)),
);

describe('PROVIDER_URL_SLOTS: every slot override reaches its call (ADR 0012)', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify(PERMISSIVE_BODY), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    (ssrfSafeFetch as jest.Mock).mockClear();
  });

  it('has a driver for every slot id', () => {
    const ids = new Set(cases.map(([, , id]) => id));
    expect([...ids].filter((id) => !DRIVERS[id])).toEqual([]);
  });

  it.each(cases)('%s (%s) %s', async (provider, auth, slotId) => {
    slotUnderTest = slotId;
    const fallback = defaultProviderUrl(provider, auth, null, slotId);
    expect(fallback).toBeTruthy();
    const base: ProviderUrlConnection = { provider, authType: auth, region: null };

    // No override: today's URL, through the plain outbound fetch.
    const before = await DRIVERS[slotId](provider, auth, base);
    expect(before.some((url) => url.startsWith(fallback!))).toBe(true);
    expect(ssrfSafeFetch).not.toHaveBeenCalled();

    mockFetch.mockClear();
    const override = slotId === 'start_url' ? 'https://my.awsapps.com/start' : OVERRIDE;
    const after = await DRIVERS[slotId](provider, auth, {
      ...base,
      urlOverrides: { [slotId]: override },
      allowPrivate: false,
    });
    expect(after.some((url) => url.startsWith(override))).toBe(true);
    const sent = (ssrfSafeFetch as jest.Mock).mock.calls.filter(([url]) =>
      String(url).startsWith(override),
    );
    if (!['oauth_authorize', 'oauth_redirect', 'start_url'].includes(slotId)) {
      // Pinned, private refused as stored, and never following a redirect.
      expect(sent.length).toBeGreaterThan(0);
      for (const [, init, opts] of sent) {
        expect(init).toEqual(expect.objectContaining({ redirect: 'error' }));
        expect(opts).toEqual({ allowPrivate: false });
      }
    }
  });
});
