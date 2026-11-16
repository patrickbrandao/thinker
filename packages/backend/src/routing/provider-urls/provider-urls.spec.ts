jest.mock('../../common/utils/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: jest.fn((url: string, init?: RequestInit) => globalThis.fetch(url, init)),
}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProviderClient } from '../proxy/provider-client';
import { resolveForwardEndpoint } from '../proxy/forward-endpoint-resolver';
import { ProviderModelFetcherService } from '../../model-discovery/provider-model-fetcher.service';
import { OpenaiOauthService } from '../oauth/openai/openai-oauth.service';
import { MinimaxOauthService } from '../oauth/minimax/minimax-oauth.service';
import { CopilotController } from '../oauth/copilot/copilot.controller';
import { CopilotDeviceAuthService } from '../oauth/copilot/copilot-device-auth.service';
import { TenantProvidersController } from '../tenant-providers.controller';
import { setAlertSink } from '../../common/services/alert-sink';
import type { SystemEventInput } from '../../common/services/system-events.service';
import type { TenantProvider } from '../../entities/tenant-provider.entity';
import {
  checkUrlOverrides,
  connectionUrlViews,
  defaultProviderUrl,
  flowUrlConnection,
  parseUrlOverridesInput,
  resolveProviderUrl,
  urlSlotViews,
  type ProviderUrlConnection,
} from './provider-urls';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ssrfSafeFetch } = require('../../common/utils/ssrf-safe-fetch');

const ok = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const mockFetch = jest.fn(async (..._args: unknown[]) => ok({ data: [] }));
(globalThis as unknown as { fetch: unknown }).fetch = mockFetch;
const hits = () => mockFetch.mock.calls.map((call) => String(call[0]));

const config = {
  get: (key: string) => (key === 'app.nodeEnv' ? 'production' : undefined),
} as never;

const owner = { role: 'owner' as const };
const admin = { role: 'admin' as const };

async function forward(conn: ProviderUrlConnection, model: string, apiMode?: 'responses') {
  const customEndpoint = resolveForwardEndpoint({
    provider: conn.provider,
    authType: conn.authType ?? 'api_key',
    model,
    providerRegion: conn.region ?? null,
  }).customEndpoint;
  await new ProviderClient()
    .forward({
      provider: conn.provider,
      apiKey: 'k',
      model,
      body: { messages: [{ role: 'user', content: 'hi' }] },
      stream: false,
      authType: conn.authType ?? 'api_key',
      customEndpoint,
      urls: conn,
      ...(apiMode ? { apiMode } : {}),
    })
    .catch(() => undefined);
  return hits();
}

beforeEach(() => {
  mockFetch.mockClear();
  mockFetch.mockImplementation(async () => ok({ data: [] }));
  (ssrfSafeFetch as jest.Mock).mockClear();
});

describe('inference base override (ADR 0012 regressions)', () => {
  it('keeps the per-model variant: OpenAI Responses on the overridden base', async () => {
    const conn = { provider: 'openai', authType: 'api_key', baseUrl: 'https://gw.test' };
    expect(await forward(conn, 'gpt-5-codex')).toEqual(['https://gw.test/v1/responses']);
    mockFetch.mockClear();
    expect(await forward(conn, 'gpt-4o')).toEqual(['https://gw.test/v1/chat/completions']);
  });

  it('keeps the OpenCode protocol per model on a legacy `…/openai` base URL', async () => {
    const conn = {
      provider: 'opencode-go',
      authType: 'api_key',
      baseUrl: 'http://wwz.test/opencode/inference/go/openai',
    };
    expect(await forward(conn, 'opencode-go/claude-sonnet-4-5')).toEqual([
      'http://wwz.test/opencode/inference/go/anthropic/v1/messages',
    ]);
    mockFetch.mockClear();
    expect(await forward(conn, 'opencode-go/glm-5.3')).toEqual([
      'http://wwz.test/opencode/inference/go/openai/v1/chat/completions',
    ]);
    // The catalog prefix is stripped as on the native endpoint.
    const body = JSON.parse(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    expect(body.model).toBe('glm-5.3');
  });

  it('keeps Command Code on Anthropic for Claude models', async () => {
    const conn = {
      provider: 'commandcode',
      authType: 'api_key',
      urlOverrides: { inference: 'https://cc.test/provider' },
    };
    expect(await forward(conn, 'claude-sonnet-4-5')).toEqual([
      'https://cc.test/provider/v1/messages',
    ]);
  });

  it('keeps a `/v1` the base needs (Atlas Cloud, Requesty) and never doubles it', async () => {
    expect(
      await forward(
        { provider: 'atlascloud', authType: 'api_key', baseUrl: 'https://atlas.test/v1' },
        'm',
      ),
    ).toEqual(['https://atlas.test/v1/chat/completions']);
    mockFetch.mockClear();
    expect(
      await forward(
        { provider: 'requesty', authType: 'api_key', baseUrl: 'https://rq.test/v1' },
        'm',
      ),
    ).toEqual(['https://rq.test/v1/chat/completions']);
    mockFetch.mockClear();
    expect(
      await forward(
        { provider: 'openai', authType: 'api_key', baseUrl: 'https://gw.test/v1' },
        'gpt-4o',
      ),
    ).toEqual(['https://gw.test/v1/chat/completions']);
  });

  it('moves Bedrock Mantle and Runtime separately; a legacy base URL still moves both', async () => {
    const mantleOnly = {
      provider: 'bedrock',
      authType: 'api_key',
      region: 'eu-west-1',
      urlOverrides: { inference_mantle: 'https://mantle.test' },
    };
    expect(await forward(mantleOnly, 'us.anthropic.claude-opus-5-5')).toEqual([
      'https://bedrock-runtime.eu-west-1.amazonaws.com/anthropic/v1/messages',
    ]);
    mockFetch.mockClear();
    expect(await forward(mantleOnly, 'mistral.mistral-large')).toEqual([
      'https://mantle.test/v1/chat/completions',
    ]);
    mockFetch.mockClear();
    const legacy = { provider: 'bedrock', authType: 'api_key', baseUrl: 'https://bedrock.test' };
    expect(await forward(legacy, 'us.anthropic.claude-opus-5-5')).toEqual([
      'https://bedrock.test/anthropic/v1/messages',
    ]);
  });

  it('beats the region', async () => {
    const conn = {
      provider: 'minimax',
      authType: 'api_key',
      region: 'cn',
      urlOverrides: { inference: 'https://mirror.test' },
    };
    expect(await forward(conn, 'MiniMax-M2')).toEqual(['https://mirror.test/v1/chat/completions']);
  });

  it('never sends a Qwen Token Plan connection to the API-key regional template', async () => {
    expect(
      resolveForwardEndpoint({
        provider: 'qwen',
        authType: 'subscription',
        model: 'qwen3-coder-plus',
        providerRegion: 'singapore',
      }).customEndpoint,
    ).toBeUndefined();
    const sent = await forward(
      { provider: 'qwen', authType: 'subscription', region: 'singapore' },
      'qwen3-coder-plus',
    );
    expect(sent[0]).toMatch(/^https:\/\/token-plan\.ap-southeast-1\.maas\.aliyuncs\.com\//);
  });
});

describe('model listing', () => {
  it('lists Bedrock CRIS profiles in the connection region, not the overridden host', async () => {
    const conn = {
      provider: 'bedrock',
      authType: 'api_key',
      region: 'eu-west-1',
      urlOverrides: { inference_mantle: 'https://mantle.test' },
    };
    const models = resolveProviderUrl(conn, 'models')!;
    expect(models).toEqual(
      expect.objectContaining({ url: 'https://mantle.test/v1/models', overridden: true }),
    );
    await new ProviderModelFetcherService().fetch('bedrock', 'k', 'api_key', undefined, {
      urls: { models },
      region: 'eu-west-1',
    });
    expect(hits()).toEqual(
      expect.arrayContaining([
        'https://mantle.test/v1/models',
        'https://bedrock.eu-west-1.amazonaws.com/inference-profiles?type=SYSTEM_DEFINED&maxResults=1000',
      ]),
    );
  });

  it('follows an overridden inference base unless the listing has its own URL', () => {
    const conn = {
      provider: 'deepseek',
      authType: 'api_key',
      urlOverrides: { inference: 'https://ds.test' },
    };
    expect(resolveProviderUrl(conn, 'models')?.url).toBe('https://ds.test/models');
    expect(
      resolveProviderUrl(
        { ...conn, urlOverrides: { ...conn.urlOverrides, models: 'https://list.test/m' } },
        'models',
      )?.url,
    ).toBe('https://list.test/m');
    expect(resolveProviderUrl({ provider: 'deepseek', authType: 'api_key' }, 'models')).toEqual({
      url: 'https://api.deepseek.com/models',
      overridden: false,
      allowPrivate: true,
    });
  });
});

describe('writing overrides', () => {
  afterEach(() => {
    delete process.env.SKIP_SSRF_VALIDATION;
    delete process.env.THINKER_PROVIDER_PRIVATE_URLS;
  });

  it('refuses an unknown slot and bad shapes', async () => {
    const conn = { provider: 'openai', authType: 'api_key' };
    await expect(
      checkUrlOverrides(conn, {}, { oauth_token: 'https://x.test' }, admin),
    ).rejects.toThrow(BadRequestException);
    await expect(
      checkUrlOverrides(conn, {}, { inference: 'https://x.test/?a=1' }, admin),
    ).rejects.toThrow('query');
    await expect(
      checkUrlOverrides(conn, {}, { inference: 'https://u:p@x.test' }, admin),
    ).rejects.toThrow('credentials');
    // A url slot whose default carries a query keeps one.
    const sub = await checkUrlOverrides(
      { provider: 'openai', authType: 'subscription' },
      {},
      { models: 'https://m.test/models?client_version=1' },
      owner,
    );
    expect(sub.overrides.models).toBe('https://m.test/models?client_version=1');
  });

  it('stores only what differs, keeps `/v1`, and null goes back to the default', async () => {
    const conn = { provider: 'atlascloud', authType: 'api_key' };
    const set = await checkUrlOverrides(
      conn,
      {},
      { inference: 'https://atlas.test/v1/', models: 'https://api.atlascloud.ai/v1/models' },
      admin,
    );
    expect(set.overrides).toEqual({ inference: 'https://atlas.test/v1' });
    expect(set.changed).toEqual(['inference']);
    const cleared = await checkUrlOverrides(conn, set.overrides, { inference: null }, admin);
    expect(cleared.overrides).toEqual({});
  });

  it('needs the owner or an instance admin for a subscription (member/admin get 403)', async () => {
    const conn = { provider: 'openai', authType: 'subscription' };
    const change = { oauth_token: 'https://token.test/oauth/token' };
    await expect(checkUrlOverrides(conn, {}, change, admin)).rejects.toThrow(ForbiddenException);
    await expect(checkUrlOverrides(conn, {}, change, { role: 'member' as never })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(checkUrlOverrides(conn, {}, change, owner)).resolves.toEqual(
      expect.objectContaining({ changed: ['oauth_token'] }),
    );
    await expect(
      checkUrlOverrides(conn, {}, change, { role: 'admin', isInstanceAdmin: true }),
    ).resolves.toBeDefined();
    await expect(flowUrlConnection('openai', null, JSON.stringify(change), admin)).rejects.toThrow(
      ForbiddenException,
    );
    // API-key accounts keep the usual rule (whoever connects providers).
    await expect(
      checkUrlOverrides(
        { provider: 'openai', authType: 'api_key' },
        {},
        { inference: 'https://gw.test' },
        admin,
      ),
    ).resolves.toBeDefined();
  });

  it('applies the private-destination policy', async () => {
    process.env.SKIP_SSRF_VALIDATION = 'false';
    const conn = { provider: 'openai', authType: 'api_key' };
    const lan = { inference: 'http://10.0.0.5:8000' };
    await expect(checkUrlOverrides(conn, {}, lan, admin)).rejects.toThrow(BadRequestException);
    await expect(checkUrlOverrides(conn, {}, lan, owner)).resolves.toEqual(
      expect.objectContaining({ allowPrivate: true }),
    );
    await expect(
      checkUrlOverrides(conn, {}, { inference: 'http://169.254.169.254' }, owner),
    ).rejects.toThrow('metadata');
  });

  it('parses the JSON query form of urlOverrides', () => {
    expect(parseUrlOverridesInput('{"inference":"https://x.test"}')).toEqual({
      inference: 'https://x.test',
    });
    expect(parseUrlOverridesInput(undefined)).toBeUndefined();
    expect(() => parseUrlOverridesInput('nope')).toThrow(BadRequestException);
    expect(() => parseUrlOverridesInput({ inference: 3 })).toThrow(BadRequestException);
  });

  it('describes slots with their defaults, region included', () => {
    const slots = urlSlotViews('minimax', 'api_key', 'cn');
    expect(slots.find((s) => s.id === 'inference')?.default).toContain('minimaxi.com');
    const views = connectionUrlViews({
      provider: 'openai',
      authType: 'api_key',
      baseUrl: 'https://gw.test',
    });
    expect(views.find((v) => v.id === 'inference')).toEqual(
      expect.objectContaining({
        value: 'https://gw.test',
        default: 'https://api.openai.com',
        credential: 'access',
      }),
    );
    expect(views.find((v) => v.id === 'inference_responses')?.value).toBeNull();
    expect(defaultProviderUrl('bedrock', 'api_key', 'eu-west-1', 'cris_profiles')).toContain(
      'eu-west-1',
    );
  });
});

describe('overridden token calls', () => {
  it('refuse redirects on refresh and never fall back to the built-in host', async () => {
    (ssrfSafeFetch as jest.Mock).mockImplementationOnce(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe('error');
      throw new TypeError('fetch failed: unexpected redirect');
    });
    const service = new OpenaiOauthService({} as never, config, {} as never);
    const { runWithProviderUrls } = await import('./provider-urls');
    await expect(
      runWithProviderUrls(
        {
          provider: 'openai',
          authType: 'subscription',
          urlOverrides: { oauth_token: 'https://evil.test/token' },
        },
        () => service.refreshAccessToken('refresh-1'),
      ),
    ).rejects.toThrow();
    expect(hits()).toEqual([]);
  });
});

describe('login flows with start-time overrides', () => {
  const saved = {
    id: 'conn-1',
    tenant_id: 't',
    provider: 'openai',
    auth_type: 'subscription',
    label: 'openai-1',
  };
  const providerService = () => ({
    nextOAuthLabel: jest.fn().mockResolvedValue('x-1'),
    upsertProvider: jest.fn().mockResolvedValue({ provider: saved }),
    setUrlOverrides: jest.fn().mockResolvedValue(saved),
  });

  it('OpenAI: authorize and token exchange use them, and the account keeps them', async () => {
    const ps = providerService();
    const discovery = { discoverModels: jest.fn() };
    const service = new OpenaiOauthService(ps as never, config, discovery as never);
    const urls = await flowUrlConnection(
      'openai',
      null,
      { oauth_authorize: 'https://auth.test/authorize', oauth_token: 'https://auth.test/token' },
      owner,
    );
    const url = await service.generateAuthorizationUrl('ag', 't', undefined, 'u', urls);
    expect(url.startsWith('https://auth.test/authorize?')).toBe(true);
    mockFetch.mockImplementation(async () =>
      ok({ access_token: 'a', refresh_token: 'r', expires_in: 60 }),
    );
    await service.exchangeCode(new URL(url).searchParams.get('state')!, 'code-1');
    expect(hits()).toEqual(['https://auth.test/token']);
    expect(ps.setUrlOverrides).toHaveBeenCalledWith(
      't',
      'conn-1',
      { oauth_authorize: 'https://auth.test/authorize', oauth_token: 'https://auth.test/token' },
      true,
    );
    expect(discovery.discoverModels).toHaveBeenCalled();
  });

  it('MiniMax: code and token requests go to the overridden OAuth base', async () => {
    const ps = providerService();
    const service = new MinimaxOauthService(ps as never, config, {
      discoverModels: jest.fn(),
    } as never);
    const urls = await flowUrlConnection('minimax', 'global', { oauth: 'https://mm.test' }, owner);
    mockFetch.mockImplementation(async (input: unknown) =>
      String(input).endsWith('/oauth/code')
        ? ok({
            user_code: 'U',
            verification_uri: 'https://www.minimax.io/x',
            expired_in: Date.now() + 60_000,
            state: JSON.parse('null'),
          })
        : ok({
            status: 'success',
            access_token: 'a',
            refresh_token: 'r',
            expired_in: Date.now() + 60_000,
          }),
    );
    // The state echo must match the flow id; capture it from the request body.
    mockFetch.mockImplementationOnce(async (_input: unknown, init?: unknown) => {
      const state = new URLSearchParams(String((init as RequestInit).body)).get('state');
      return ok({
        user_code: 'U',
        verification_uri: 'https://www.minimax.io/x',
        expired_in: Date.now() + 60_000,
        state,
      });
    });
    const started = await service.startAuthorization('ag', 't', 'global', 'u', urls);
    await service.pollAuthorization(started.flowId, 't');
    expect(hits()).toEqual(['https://mm.test/oauth/code', 'https://mm.test/oauth/token']);
    expect(ps.setUrlOverrides).toHaveBeenCalledWith(
      't',
      'conn-1',
      { oauth: 'https://mm.test' },
      true,
    );
  });

  it('Copilot: device code, token poll and the created account use them', async () => {
    const ps = providerService();
    const auth = new CopilotDeviceAuthService();
    const controller = new CopilotController(
      ps as never,
      { resolve: jest.fn().mockResolvedValue({ id: 'ag', tenant_id: 't' }) } as never,
      auth,
      { discoverModels: jest.fn() } as never,
    );
    const overrides = {
      device_code: 'https://gh.test/code',
      device_token: 'https://gh.test/token',
    };
    mockFetch.mockImplementation(async () =>
      ok({
        device_code: 'dc',
        user_code: 'U',
        verification_uri: 'v',
        expires_in: 900,
        interval: 5,
      }),
    );
    await controller.copilotDeviceCode(owner as never, { agentName: 'a' } as never, overrides);
    mockFetch.mockImplementation(async () => ok({ access_token: 'gho_1' }));
    await controller.copilotPollToken(
      owner as never,
      { agentName: 'a' } as never,
      { deviceCode: 'dc' } as never,
    );
    expect(hits()).toEqual(['https://gh.test/code', 'https://gh.test/token']);
    expect(ps.setUrlOverrides).toHaveBeenCalledWith('t', 'conn-1', overrides, true);
  });
});

describe('PATCH /providers/connections/:id/urls', () => {
  const events: SystemEventInput[] = [];
  beforeAll(() => setAlertSink((e) => events.push(e)));
  afterAll(() => setAlertSink(null));

  function build(row: Partial<TenantProvider>) {
    const updated = { ...row, url_overrides: { inference: 'https://gw.test' } } as TenantProvider;
    const providerService = {
      setUrlOverrides: jest.fn().mockResolvedValue(updated),
      listOwnedAgentIds: jest.fn().mockResolvedValue([]),
    };
    const controller = new TenantProvidersController(
      { findOne: jest.fn().mockResolvedValue(row) } as never,
      {} as never,
      {} as never,
      providerService as never,
      { discoverModels: jest.fn() } as never,
      { invalidateAgent: jest.fn(), invalidateTenant: jest.fn() } as never,
      {} as never,
      {} as never,
    );
    return { controller, providerService };
  }

  it('saves, rediscovers and emits provider.urls_changed without URL values', async () => {
    events.length = 0;
    const row = {
      id: 'c1',
      tenant_id: 't',
      provider: 'openai',
      auth_type: 'api_key',
      label: 'Work',
      url_overrides: null,
      base_url: null,
      allow_private_destination: true,
    } as TenantProvider;
    const { controller, providerService } = build(row);
    const out = await controller.setUrls({ tenantId: 't', userId: 'u1', role: 'admin' }, 'c1', {
      overrides: { inference: 'https://gw.test' },
    });
    expect(providerService.setUrlOverrides).toHaveBeenCalledWith(
      't',
      'c1',
      { inference: 'https://gw.test' },
      false,
    );
    expect(out.urls.find((u) => u.id === 'inference')?.value).toBe('https://gw.test');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'provider.urls_changed',
        tenantId: 't',
        actorUserId: 'u1',
        entityId: 'c1',
        metadata: expect.objectContaining({ slots: ['inference'] }),
      }),
    );
    expect(JSON.stringify(events[0])).not.toContain('gw.test');
  });

  it('answers 403 to an admin changing a subscription', async () => {
    const row = {
      id: 'c2',
      tenant_id: 't',
      provider: 'anthropic',
      auth_type: 'subscription',
      label: 'claude-1',
      url_overrides: null,
    } as TenantProvider;
    const { controller, providerService } = build(row);
    await expect(
      controller.setUrls({ tenantId: 't', userId: 'u1', role: 'admin' }, 'c2', {
        overrides: { oauth_token: 'https://evil.test/token' },
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(providerService.setUrlOverrides).not.toHaveBeenCalled();
  });
});
