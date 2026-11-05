import type { ModelRoute } from 'thinker-shared';
import type { TenantProvider } from '../../entities/tenant-provider.entity';
import {
  AGENT_DISABLE_BLOCKED_MESSAGE,
  agentDisableBlockedMessage,
  collectAffectedVirtualModels,
  makeAgentProviderRouteMatcher,
  type AffectedVirtualModel,
} from './agent-provider-impact';

function provider(overrides: Partial<TenantProvider> = {}): TenantProvider {
  return {
    provider: 'OpenAI',
    auth_type: 'api_key',
    label: 'Default',
    priority: 0,
    cached_models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }],
    ...overrides,
  } as unknown as TenantProvider;
}

const route = (overrides: Partial<ModelRoute>): ModelRoute => ({
  provider: 'openai',
  authType: 'api_key',
  model: 'gpt-5',
  ...overrides,
});

describe('makeAgentProviderRouteMatcher', () => {
  it('rejects a missing route', () => {
    const matches = makeAgentProviderRouteMatcher(provider());
    expect(matches(null)).toBe(false);
    expect(matches(undefined)).toBe(false);
  });

  it('matches a route naming the provider, case-insensitively', () => {
    const matches = makeAgentProviderRouteMatcher(provider());
    expect(matches(route({ provider: 'OPENAI' }))).toBe(true);
  });

  it('rejects a route naming another provider', () => {
    const matches = makeAgentProviderRouteMatcher(provider());
    expect(matches(route({ provider: 'anthropic' }))).toBe(false);
  });

  it('rejects a route with a different auth type', () => {
    const matches = makeAgentProviderRouteMatcher(provider());
    expect(matches(route({ authType: 'subscription' }))).toBe(false);
  });

  it('matches a route that carries no auth type', () => {
    const matches = makeAgentProviderRouteMatcher(provider());
    expect(matches({ provider: 'openai', model: 'x' } as ModelRoute)).toBe(true);
  });

  it('checks the key label case-insensitively when both sides have one', () => {
    const matches = makeAgentProviderRouteMatcher(provider({ label: 'Work' }));
    expect(matches(route({ keyLabel: 'work' }))).toBe(true);
    expect(matches(route({ keyLabel: 'personal' }))).toBe(false);
  });

  it('matches any key label when the provider has no label', () => {
    const matches = makeAgentProviderRouteMatcher(provider({ label: null as never }));
    expect(matches(route({ keyLabel: 'anything' }))).toBe(true);
  });

  it('without a key label, only the primary or default-labelled connection matches', () => {
    expect(makeAgentProviderRouteMatcher(provider({ priority: 0, label: 'Work' }))(route({}))).toBe(
      true,
    );
    expect(makeAgentProviderRouteMatcher(provider({ priority: 1, label: 'Work' }))(route({}))).toBe(
      false,
    );
    expect(
      makeAgentProviderRouteMatcher(provider({ priority: 1, label: 'Default' }))(route({})),
    ).toBe(true);
    expect(
      makeAgentProviderRouteMatcher(provider({ priority: 1, label: null as never }))(route({})),
    ).toBe(false);
  });

  it('matches a provider-less route by the cached model list', () => {
    const matches = makeAgentProviderRouteMatcher(provider());
    expect(matches(route({ provider: '', model: 'gpt-5-mini' }))).toBe(true);
    expect(matches(route({ provider: '', model: 'claude-x' }))).toBe(false);
  });

  it('tolerates a provider without a cached model list', () => {
    const matches = makeAgentProviderRouteMatcher(provider({ cached_models: null as never }));
    expect(matches(route({ provider: '', model: 'gpt-5' }))).toBe(false);
  });
});

describe('collectAffectedVirtualModels', () => {
  const belongs = (r: ModelRoute | null | undefined) => r?.provider === 'openai';

  it('returns nothing for no virtual models', () => {
    expect(collectAffectedVirtualModels([], 'agent-a', belongs)).toEqual([]);
  });

  it('reports the primary override and numbers fallbacks from 1', () => {
    const affected = collectAffectedVirtualModels(
      [
        {
          id: 'v1',
          name: 'fast',
          override_route: route({ model: 'gpt-5' }),
          fallback_routes: [
            route({ provider: 'anthropic', model: 'claude' }),
            route({ model: 'gpt-5-mini' }),
          ],
        },
      ],
      'agent-a',
      belongs,
    );
    expect(affected).toEqual([
      { id: 'v1', name: 'fast', agent: 'agent-a', position: 'primary', model: 'gpt-5' },
      { id: 'v1', name: 'fast', agent: 'agent-a', position: 'fallback 2', model: 'gpt-5-mini' },
    ]);
  });

  it('skips virtual models with null override and null fallbacks', () => {
    expect(
      collectAffectedVirtualModels(
        [{ id: 'v1', name: 'x', override_route: null, fallback_routes: null }],
        'agent-a',
        belongs,
      ),
    ).toEqual([]);
  });

  it('lists several virtual models in order', () => {
    const affected = collectAffectedVirtualModels(
      [
        { id: 'v1', name: 'a', override_route: route({}), fallback_routes: null },
        { id: 'v2', name: 'b', override_route: null, fallback_routes: [route({})] },
      ],
      'agent-a',
      belongs,
    );
    expect(affected.map((a) => `${a.id}:${a.position}`)).toEqual(['v1:primary', 'v2:fallback 1']);
  });
});

describe('agentDisableBlockedMessage', () => {
  const virtual: AffectedVirtualModel = {
    id: 'v1',
    name: 'fast',
    agent: 'agent-a',
    position: 'fallback 1',
    model: 'gpt-5',
  };

  it('uses the historical message when tiers are involved', () => {
    expect(agentDisableBlockedMessage(2, [virtual])).toBe(AGENT_DISABLE_BLOCKED_MESSAGE);
    expect(agentDisableBlockedMessage(1, [])).toBe(AGENT_DISABLE_BLOCKED_MESSAGE);
  });

  it('uses the historical message when nothing is affected', () => {
    expect(agentDisableBlockedMessage(0, [])).toBe(AGENT_DISABLE_BLOCKED_MESSAGE);
  });

  it('names the first virtual model when only virtuals block', () => {
    const message = agentDisableBlockedMessage(0, [
      virtual,
      { ...virtual, name: 'other', position: 'primary' },
    ]);
    expect(message).toContain(AGENT_DISABLE_BLOCKED_MESSAGE.replace(/\.$/, ''));
    expect(message).toContain('agent "agent-a"');
    expect(message).toContain('virtual model "fast"');
    expect(message).toContain('fallback 1: gpt-5');
    expect(message).not.toContain('other');
  });
});
