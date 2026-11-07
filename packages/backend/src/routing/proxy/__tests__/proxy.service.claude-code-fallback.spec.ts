import { ConfigService } from '@nestjs/config';
import type { ModelRoute } from 'thinker-shared';
import { ProxyService } from '../proxy.service';
import type { ResolveService } from '../../resolve/resolve.service';
import type { ProviderKeyService } from '../../routing-core/provider-key.service';
import type { ProxyFallbackService } from '../proxy-fallback.service';
import type { AgentModelParamsService } from '../../routing-core/agent-model-params.service';
import type { ProviderParamSpecService } from '../../routing-core/provider-param-spec.service';
import type { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import type { DiscoveredModel } from '../../../model-discovery/model-fetcher';

/**
 * White Wizard stress finding (2026-11-07): Claude Code harnesses got the
 * local cooldown 429 while Anthropic SDK harnesses on the same chain fell
 * back. The difference is the body's `model`, not the Claude Code headers:
 * the SDK load sent `auto`, the Claude Code load a concrete ID, and a
 * concrete ID is an explicit route without fallbacks. A virtual model with
 * that same name gives the ID a chain.
 */
describe('ProxyService — Claude Code Messages request vs a cooling-down primary', () => {
  const primary: ModelRoute = {
    provider: 'anthropic',
    authType: 'api_key',
    model: 'claude-sonnet-5-5',
    keyLabel: 'falhas',
  };
  const fallbacks: ModelRoute[] = [
    { ...primary, keyLabel: 'instavel' },
    { ...primary, keyLabel: 'perfeito' },
  ];
  const chain = (reason: string) => ({
    tier: 'default' as const,
    route: primary,
    fallback_routes: fallbacks,
    response_mode: 'buffered' as const,
    confidence: 1,
    score: 0,
    reason,
  });
  const cooldown429 = () => ({
    response: new Response(
      JSON.stringify({
        error: {
          message:
            'Provider route temporarily cooling down after an upstream 429: ' +
            'anthropic/claude-sonnet-5-5',
        },
      }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '15' } },
    ),
    isGoogle: false,
    isAnthropic: false,
    isChatGpt: false,
    providerCallStarted: false,
  });
  const claudeCodeHeaders = {
    'x-claude-code-session-id': 'cc-session-1',
    'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
    'anthropic-version': '2023-06-01',
    'user-agent': 'claude-cli/2.1.200 (external, cli)',
  };

  let resolveService: {
    resolveLazy: jest.Mock;
    resolveForTier: jest.Mock;
    resolveVirtualModel: jest.Mock;
    pinRouteKeyLabel: jest.Mock;
  };
  let fallbackService: { tryForwardToProvider: jest.Mock; tryFallbacks: jest.Mock };
  let modelDiscovery: { getModelsForAgent: jest.Mock };
  let svc: ProxyService;

  beforeEach(() => {
    resolveService = {
      resolveLazy: jest.fn().mockResolvedValue(chain('scored')),
      resolveForTier: jest.fn(),
      resolveVirtualModel: jest.fn().mockResolvedValue(null),
      // The tier's connection pin survives an explicit model (see explicitRouting).
      pinRouteKeyLabel: jest.fn(async (_a, _t, route: ModelRoute) => ({
        ...route,
        keyLabel: 'falhas',
      })),
    };
    fallbackService = {
      tryForwardToProvider: jest.fn().mockResolvedValue(cooldown429()),
      tryFallbacks: jest.fn().mockResolvedValue({
        success: {
          forward: {
            response: new Response('{"ok":true}', { status: 200 }),
            isGoogle: false,
            isAnthropic: true,
            isChatGpt: false,
          },
          model: 'claude-sonnet-5-5',
          provider: 'anthropic',
          authType: 'api_key',
          keyLabel: 'instavel',
          fallbackIndex: 0,
        },
        failures: [],
      }),
    };
    const discovered: DiscoveredModel = {
      id: 'claude-sonnet-5-5',
      displayName: 'Claude Sonnet 5.5',
      provider: 'anthropic',
      contextWindow: 200000,
      inputPricePerToken: null,
      outputPricePerToken: null,
      capabilityReasoning: true,
      capabilityCode: true,
      qualityScore: 5,
      authType: 'api_key',
    };
    modelDiscovery = { getModelsForAgent: jest.fn().mockResolvedValue([discovered]) };
    const providerKeyService = {
      getProviderApiKey: jest.fn().mockResolvedValue('decrypted-key'),
      getProviderRegion: jest.fn().mockResolvedValue(null),
      getProviderKeyId: jest.fn().mockResolvedValue('up-falhas'),
      selectProviderKey: jest.fn().mockResolvedValue({
        apiKey: 'decrypted-key',
        id: 'up-falhas',
        region: null,
        label: 'falhas',
        priority: 0,
      }),
      hasRouteCredentials: jest.fn().mockResolvedValue(true),
    };
    const oauth = { unwrapToken: jest.fn().mockResolvedValue(null) };
    svc = new ProxyService(
      resolveService as unknown as ResolveService,
      modelDiscovery as unknown as ModelDiscoveryService,
      providerKeyService as unknown as ProviderKeyService,
      oauth as never,
      oauth as never,
      oauth as never,
      oauth as never,
      oauth as never,
      oauth as never,
      {
        recordTier: jest.fn(),
        recordCategory: jest.fn(),
        getRecentTiers: jest.fn().mockReturnValue([]),
        getRecentCategories: jest.fn().mockReturnValue([]),
      } as never,
      { checkLimits: jest.fn().mockResolvedValue(null) } as never,
      fallbackService as unknown as ProxyFallbackService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      { retrieve: jest.fn().mockReturnValue(null) } as never,
      { retrieve: jest.fn().mockReturnValue(null) } as never,
      {
        get: jest.fn().mockResolvedValue(null),
        list: jest.fn().mockResolvedValue([]),
      } as unknown as AgentModelParamsService,
      {
        getSpecs: jest.fn().mockResolvedValue([]),
        list: jest.fn().mockResolvedValue([]),
      } as unknown as ProviderParamSpecService,
    );
  });

  const claudeCodeRequest = (model: string) =>
    svc.proxyRequest({
      agentId: 'agent-cc',
      userId: 'user-1',
      tenantId: 'tenant-1',
      agentName: 'h-claude-code-1',
      apiMode: 'messages',
      stream: false,
      headers: claudeCodeHeaders,
      sessionKey: 'cc-session-1',
      sessionCacheKey: 'cc-session-1',
      providerCacheKey: 'cc-session-1',
      sessionMomentumKey: 'cc-session-1',
      body: {
        model,
        max_tokens: 1024,
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
      },
    } as Parameters<ProxyService['proxyRequest']>[0]);

  it('walks both fallbacks when the body names auto, Claude Code headers and all', async () => {
    const result = await claudeCodeRequest('auto');

    expect(fallbackService.tryFallbacks).toHaveBeenCalledTimes(1);
    const call = fallbackService.tryFallbacks.mock.calls[0];
    const [models, routes] = [call[2], call[14]];
    expect(models).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5']);
    expect(routes).toEqual(fallbacks);
    expect(result.forward.response.status).toBe(200);
    expect(result.meta).toMatchObject({ fallbackIndex: 0, provider_key_label: 'instavel' });
  });

  it('walks the chain of a virtual model that shadows the concrete ID', async () => {
    resolveService.resolveVirtualModel.mockResolvedValue({
      ...chain('virtual-model'),
      virtual_model_id: 'vm-sonnet',
      virtual_model_name: 'claude-sonnet-5-5',
    });

    const result = await claudeCodeRequest('claude-sonnet-5-5');

    expect(fallbackService.tryFallbacks).toHaveBeenCalledTimes(1);
    expect(result.forward.response.status).toBe(200);
    expect(result.meta.fallbackIndex).toBe(0);
  });

  it('returns the cooldown 429 for a concrete ID: an explicit route has no fallbacks', async () => {
    const result = await claudeCodeRequest('claude-sonnet-5-5');

    expect(resolveService.resolveLazy).not.toHaveBeenCalled();
    expect(fallbackService.tryForwardToProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        hasNextRoute: false,
      }),
    );
    expect(fallbackService.tryFallbacks).not.toHaveBeenCalled();
    expect(result.forward.response.status).toBe(429);
    expect(await result.forward.response.text()).toContain('temporarily cooling down');
    expect(result.meta).toMatchObject({ tier: 'direct', reason: 'direct' });
  });
});
