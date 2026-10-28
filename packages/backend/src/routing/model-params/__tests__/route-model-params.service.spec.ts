import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getProviderParamSpecs, type ProviderParamSpecCatalog } from 'thinker-shared';
import { RouteModelParamsService } from '../route-model-params.service';

const AGENT = 'agent-1';
const catalog: ProviderParamSpecCatalog = [
  {
    provider: 'openai',
    authType: 'api_key',
    model: 'gpt-5',
    params: [
      {
        path: 'reasoning.effort',
        type: 'enum',
        label: 'Reasoning effort',
        description: 'How hard the model thinks.',
        values: ['low', 'medium', 'high'],
        group: 'reasoning',
      },
      {
        path: 'temperature',
        type: 'number',
        label: 'Temperature',
        description: 'Sampling temperature.',
        range: { min: 0, max: 2 },
        group: 'sampling',
      },
      {
        path: 'max_tokens',
        type: 'integer',
        label: 'Max tokens',
        description: 'Output cap.',
        group: 'generation_length',
        applicability: { except: { 'reasoning.effort': 'high' } },
      },
    ],
  },
];
const gpt5Specs = getProviderParamSpecs(catalog, 'openai', 'api_key', 'gpt-5');

const PRIMARY = { provider: 'openai', authType: 'api_key', model: 'gpt-5' };
const FALLBACK = { provider: 'anthropic', authType: 'subscription', model: 'claude-sonnet' };

function setup(
  overrides: {
    tiers?: unknown[];
    virtualModels?: unknown[];
    catalog?: unknown[];
    saved?: Record<string, unknown> | null;
  } = {},
) {
  const tiers = {
    getTiers: jest.fn().mockResolvedValue(
      overrides.tiers ?? [
        {
          tier: 'default',
          override_route: PRIMARY,
          auto_assigned_route: null,
          fallback_routes: [FALLBACK],
        },
      ],
    ),
  };
  const virtualModels = {
    list: jest.fn().mockResolvedValue(
      overrides.virtualModels ?? [
        {
          id: 'vm1',
          name: 'DeepSeek/Flash',
          enabled: true,
          override_route: PRIMARY,
          fallback_routes: [FALLBACK],
        },
        { id: 'vm2', name: 'empty', enabled: false, override_route: null, fallback_routes: null },
      ],
    ),
  };
  const modelParams = {
    get: jest.fn().mockResolvedValue(overrides.saved === undefined ? null : overrides.saved),
    set: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const specs = {
    getSpecs: jest
      .fn()
      .mockImplementation(async (_p: string, _a: string, model: string) =>
        model === 'gpt-5' ? gpt5Specs : [],
      ),
  };
  const discovery = {
    getModelsForAgent: jest.fn().mockResolvedValue(overrides.catalog ?? []),
  };
  const service = new RouteModelParamsService(
    tiers as never,
    virtualModels as never,
    modelParams as never,
    specs as never,
    discovery as never,
  );
  return { service, tiers, virtualModels, modelParams, specs, discovery };
}

describe('RouteModelParamsService.get', () => {
  it('describes the default tier primary route with saved values merged in', async () => {
    const { service, modelParams } = setup({ saved: { reasoning: { effort: 'high' } } });

    const view = await service.get(AGENT, 'default');

    expect(modelParams.get).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'openai',
      'api_key',
      'gpt-5',
    );
    expect(view.tier).toBe('default');
    expect(view.route).toEqual(PRIMARY);
    expect(view.models).toEqual(['gpt-5', 'claude-sonnet']);
    expect(view.params.map((p) => [p.path, p.current])).toEqual([
      ['max_tokens', null],
      ['temperature', null],
      ['reasoning.effort', 'high'],
    ]);
    expect(view.params[0]).not.toHaveProperty('provider');
  });

  it('falls back to the auto-assigned route of the default tier', async () => {
    const { service } = setup({
      tiers: [
        { tier: 'standard', override_route: FALLBACK, fallback_routes: null },
        {
          tier: 'default',
          override_route: null,
          auto_assigned_route: PRIMARY,
          fallback_routes: null,
        },
      ],
    });
    const view = await service.get(AGENT);
    expect(view.route).toEqual(PRIMARY);
    expect(view.models).toEqual(['gpt-5']);
  });

  it('returns an empty param list for a model with no configurable params', async () => {
    const { service } = setup();
    const view = await service.get(AGENT, 'default', 'claude-sonnet');
    expect(view.route).toEqual(FALLBACK);
    expect(view.params).toEqual([]);
  });

  it('rejects an unknown tier and lists the available ones', async () => {
    const { service } = setup();
    await expect(service.get(AGENT, 'nope')).rejects.toThrow(NotFoundException);
    await expect(service.get(AGENT, 'nope')).rejects.toThrow(/Available tiers: default$/);
  });

  it('rejects a missing default tier row as an unknown tier', async () => {
    const { service } = setup({ tiers: [] });
    await expect(service.get(AGENT)).rejects.toThrow(NotFoundException);
  });

  it('rejects a model the tier does not route to and lists the routed ones', async () => {
    const { service } = setup();
    await expect(service.get(AGENT, 'default', 'gpt-4o')).rejects.toThrow(
      /Model "gpt-4o" is not routed by tier "default". Models: gpt-5, claude-sonnet/,
    );
  });

  it('rejects a tier with no route yet when no model is named', async () => {
    const { service } = setup({
      tiers: [
        { tier: 'default', override_route: null, auto_assigned_route: null, fallback_routes: null },
      ],
    });
    await expect(service.get(AGENT)).rejects.toThrow(/Tier "default" has no model yet/);
  });

  it('rejects a model routed through two different connections', async () => {
    const { service } = setup({
      tiers: [
        {
          tier: 'default',
          override_route: PRIMARY,
          auto_assigned_route: null,
          fallback_routes: [{ ...PRIMARY, authType: 'subscription' }],
        },
      ],
    });
    await expect(service.get(AGENT, 'default', 'gpt-5')).rejects.toThrow(BadRequestException);
    await expect(service.get(AGENT, 'default', 'gpt-5')).rejects.toThrow(
      /more than one connection/,
    );
  });

  it('treats the same model twice on the same connection as one route', async () => {
    const { service } = setup({
      tiers: [
        {
          tier: 'default',
          override_route: PRIMARY,
          auto_assigned_route: null,
          fallback_routes: [{ ...PRIMARY, keyLabel: 'backup' }],
        },
      ],
    });
    const view = await service.get(AGENT, 'default', 'gpt-5');
    expect(view.route).toEqual(PRIMARY);
  });
});

describe('RouteModelParamsService Anthropic short ids', () => {
  const DOTTED = { provider: 'anthropic', authType: 'api_key', model: 'claude-sonnet-4.5' };

  it('saves under the configured id, like the dashboard, and reads specs under the dashed id', async () => {
    const { service, modelParams, specs } = setup({
      tiers: [
        { tier: 'default', override_route: DOTTED, auto_assigned_route: null, fallback_routes: [] },
      ],
    });
    const view = await service.get(AGENT);
    expect(view.route.model).toBe('claude-sonnet-4.5');
    expect(specs.getSpecs).toHaveBeenCalledWith('anthropic', 'api_key', 'claude-sonnet-4-5');
    expect(modelParams.get).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'anthropic',
      'api_key',
      'claude-sonnet-4.5',
    );

    modelParams.get.mockResolvedValue({ temperature: 1 });
    await service.update(AGENT, 'default', 'claude-sonnet-4-5', { unset: ['temperature'] });
    expect(modelParams.delete).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'anthropic',
      'api_key',
      'claude-sonnet-4.5',
    );
  });
});

describe('RouteModelParamsService.update', () => {
  it('merges set values into the saved params and persists the sanitized result', async () => {
    const { service, modelParams } = setup({ saved: { temperature: 0.3 } });
    modelParams.get
      .mockResolvedValueOnce({ temperature: 0.3 })
      .mockResolvedValueOnce({ temperature: 0.3, reasoning: { effort: 'low' } });

    const view = await service.update(AGENT, 'default', undefined, {
      set: { 'reasoning.effort': 'low' },
    });

    expect(modelParams.set).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'openai',
      'api_key',
      'gpt-5',
      { temperature: 0.3, reasoning: { effort: 'low' } },
    );
    expect(view.params.find((p) => p.path === 'reasoning.effort')?.current).toBe('low');
  });

  it('removes unset keys and keeps the rest', async () => {
    const { service, modelParams } = setup({
      saved: { temperature: 0.3, reasoning: { effort: 'low' } },
    });
    await service.update(AGENT, 'default', 'gpt-5', { unset: ['reasoning.effort'] });
    expect(modelParams.set).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'openai',
      'api_key',
      'gpt-5',
      { temperature: 0.3 },
    );
  });

  it('deletes the row when the last key is unset', async () => {
    const { service, modelParams } = setup({ saved: { reasoning: { effort: 'low' } } });
    await service.update(AGENT, 'default', undefined, { unset: ['reasoning.effort'] });
    expect(modelParams.set).not.toHaveBeenCalled();
    expect(modelParams.delete).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'openai',
      'api_key',
      'gpt-5',
    );
  });

  it('allows unsetting a saved key the catalog no longer lists', async () => {
    const { service, modelParams } = setup({ saved: { legacy_knob: 1, temperature: 0.5 } });
    await service.update(AGENT, 'default', undefined, { unset: ['legacy_knob'] });
    expect(modelParams.set).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'openai',
      'api_key',
      'gpt-5',
      { temperature: 0.5 },
    );
  });

  it('rejects an empty change', async () => {
    const { service } = setup();
    await expect(service.update(AGENT, 'default', undefined, {})).rejects.toThrow(
      /Nothing to change/,
    );
    await expect(
      service.update(AGENT, 'default', undefined, { set: {}, unset: [] }),
    ).rejects.toThrow(/Nothing to change/);
  });

  it('rejects a param the model does not accept and lists the accepted ones', async () => {
    const { service, modelParams } = setup();
    await expect(
      service.update(AGENT, 'default', undefined, { set: { top_k: 5 } }),
    ).rejects.toThrow(
      /Unknown param "top_k" for gpt-5. Available: max_tokens, temperature, reasoning.effort/,
    );
    expect(modelParams.set).not.toHaveBeenCalled();
  });

  it('says so when the model has no configurable params at all', async () => {
    const { service } = setup();
    await expect(
      service.update(AGENT, 'default', 'claude-sonnet', { set: { temperature: 1 } }),
    ).rejects.toThrow(/claude-sonnet has no configurable params/);
  });

  it('rejects unsetting a param that is neither known nor saved', async () => {
    const { service } = setup();
    await expect(service.update(AGENT, 'default', undefined, { unset: ['top_k'] })).rejects.toThrow(
      /Unknown param "top_k"/,
    );
  });

  it('rejects a malformed or unsafe param path as a client error', async () => {
    const { service, modelParams } = setup({ saved: { temperature: 1 } });
    for (const path of ['__proto__.x', 'a..b', 'constructor']) {
      await expect(service.update(AGENT, 'default', undefined, { unset: [path] })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.update(AGENT, 'default', undefined, { set: { [path]: 1 } }),
      ).rejects.toThrow(/Invalid param path/);
    }
    expect(modelParams.set).not.toHaveBeenCalled();
    expect(modelParams.delete).not.toHaveBeenCalled();
  });

  it('rejects an invalid value', async () => {
    const { service } = setup();
    await expect(
      service.update(AGENT, 'default', undefined, { set: { 'reasoning.effort': 'extreme' } }),
    ).rejects.toThrow(/Invalid value for param "reasoning.effort"/);
  });

  it('rejects a value that does not apply with the other saved settings', async () => {
    const { service, modelParams } = setup({ saved: { reasoning: { effort: 'high' } } });
    await expect(
      service.update(AGENT, 'default', undefined, { set: { max_tokens: 100 } }),
    ).rejects.toThrow(/Param "max_tokens" does not apply with the current settings/);
    expect(modelParams.set).not.toHaveBeenCalled();
  });
});

describe('RouteModelParamsService with a virtual model target', () => {
  it('resolves the virtual model by name ignoring case and reads the virtual:<id> scope', async () => {
    const { service, modelParams } = setup({ saved: { temperature: 0.3 } });

    const view = await service.get(AGENT, { virtual: 'deepseek/flash' });

    expect(modelParams.get).toHaveBeenCalledWith(
      AGENT,
      'virtual:vm1',
      'openai',
      'api_key',
      'gpt-5',
    );
    expect(view.virtual).toBe('DeepSeek/Flash');
    expect(view).not.toHaveProperty('tier');
    expect(view.route).toEqual(PRIMARY);
    expect(view.models).toEqual(['gpt-5', 'claude-sonnet']);
    expect(view.params.find((p) => p.path === 'temperature')?.current).toBe(0.3);
  });

  it('addresses a fallback of the virtual chain by model', async () => {
    const { service, modelParams } = setup();
    await service.get(AGENT, { virtual: 'DeepSeek/Flash' }, 'claude-sonnet');
    expect(modelParams.get).toHaveBeenCalledWith(
      AGENT,
      'virtual:vm1',
      'anthropic',
      'subscription',
      'claude-sonnet',
    );
  });

  it('writes under the virtual:<id> scope, never a tier scope', async () => {
    const { service, modelParams } = setup({
      tiers: [{ tier: 'default', override_route: FALLBACK, fallback_routes: null }],
    });
    const view = await service.update(AGENT, { virtual: 'deepseek/flash' }, undefined, {
      set: { 'reasoning.effort': 'low' },
    });
    expect(modelParams.set).toHaveBeenCalledWith(
      AGENT,
      'virtual:vm1',
      'openai',
      'api_key',
      'gpt-5',
      { reasoning: { effort: 'low' } },
    );
    expect(view.virtual).toBe('DeepSeek/Flash');
  });

  it('404s an unknown virtual model, listing the existing ones', async () => {
    const { service } = setup();
    await expect(service.get(AGENT, { virtual: 'nope' })).rejects.toThrow(NotFoundException);
    await expect(service.get(AGENT, { virtual: 'nope' })).rejects.toThrow(
      /Available virtual models: DeepSeek\/Flash, empty/,
    );
    const none = setup({ virtualModels: [] });
    await expect(none.service.get(AGENT, { virtual: 'x' })).rejects.toThrow(
      /has no virtual models/,
    );
  });

  it('rejects a virtual model with no primary, and a model outside its chain', async () => {
    const { service } = setup();
    await expect(service.get(AGENT, { virtual: 'EMPTY' })).rejects.toThrow(
      /Virtual model "empty" has no model yet; routes it borrows from the Default tier/,
    );
    await expect(service.get(AGENT, { virtual: 'deepseek/flash' }, 'gpt-4o')).rejects.toThrow(
      /Model "gpt-4o" is not routed by virtual model "DeepSeek\/Flash"/,
    );
  });

  it('still accepts an explicit tier target object', async () => {
    const { service, modelParams } = setup();
    const view = await service.get(AGENT, { tier: 'default' });
    expect(view.tier).toBe('default');
    expect(modelParams.get).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'openai',
      'api_key',
      'gpt-5',
    );
  });
});

describe('RouteModelParamsService model names', () => {
  const CUSTOM = { provider: 'custom:abc', authType: 'api_key', model: 'custom:abc/gpt-4o' };
  const OPENAI = { provider: 'openai', authType: 'api_key', model: 'gpt-4o' };
  const CATALOG = [
    {
      id: 'custom:abc/gpt-4o',
      provider: 'custom:abc',
      providerAlias: 'fake2',
      authType: 'api_key',
    },
    { id: 'gpt-4o', provider: 'openai', authType: 'api_key' },
  ];
  const withChain = (primary: unknown, fallbacks: unknown[] = []) =>
    setup({
      catalog: CATALOG,
      virtualModels: [
        {
          id: 'vm1',
          name: 'flash',
          enabled: true,
          override_route: primary,
          fallback_routes: fallbacks,
        },
      ],
    });

  it('accepts the public id, the native id and the stored id of a custom provider route', async () => {
    const { service, modelParams, discovery } = withChain(OPENAI, [CUSTOM]);
    for (const name of ['fake2/gpt-4o', 'custom:abc/gpt-4o']) {
      const view = await service.get(AGENT, { virtual: 'flash' }, name, 'tenant-1');
      expect(view.route).toEqual(CUSTOM);
      expect(view.public_model).toBe('fake2/gpt-4o');
    }
    expect(discovery.getModelsForAgent).toHaveBeenCalledWith('tenant-1', AGENT);
    expect(modelParams.get).toHaveBeenLastCalledWith(
      AGENT,
      'virtual:vm1',
      'custom:abc',
      'api_key',
      'custom:abc/gpt-4o',
    );

    const only = withChain(CUSTOM);
    const view = await only.service.get(AGENT, { virtual: 'flash' }, 'gpt-4o', 'tenant-1');
    expect(view.route).toEqual(CUSTOM);
  });

  it('lists public ids next to the stored ones', async () => {
    const { service } = withChain(OPENAI, [CUSTOM]);
    const view = await service.get(AGENT, { virtual: 'flash' }, undefined, 'tenant-1');
    expect(view.models).toEqual(['gpt-4o', 'custom:abc/gpt-4o']);
    expect(view.public_models).toEqual(['openai/gpt-4o', 'fake2/gpt-4o']);
    expect(view.public_model).toBe('openai/gpt-4o');
  });

  it("prefers the stored id to a custom route's native name, and resolves public ids", async () => {
    const { service } = withChain(OPENAI, [CUSTOM]);
    // "gpt-4o" is OPENAI's stored id (layer 1); CUSTOM only derives it (layer 3).
    expect((await service.get(AGENT, { virtual: 'flash' }, 'gpt-4o', 'tenant-1')).route).toEqual(
      OPENAI,
    );
    const view = await service.get(AGENT, { virtual: 'flash' }, 'openai/gpt-4o', 'tenant-1');
    expect(view.route).toEqual(OPENAI);
    expect(
      (await service.get(AGENT, { virtual: 'flash' }, 'fake2/gpt-4o', 'tenant-1')).route,
    ).toEqual(CUSTOM);
  });

  it('names the public ids in the not-routed error', async () => {
    const { service } = withChain(CUSTOM);
    await expect(service.get(AGENT, { virtual: 'flash' }, 'nope', 'tenant-1')).rejects.toThrow(
      'Model "nope" is not routed by virtual model "flash". Models: custom:abc/gpt-4o (fake2/gpt-4o)',
    );
  });

  it('applies to tiers too, and writes under the stored id', async () => {
    const { service, modelParams } = setup({
      catalog: CATALOG,
      tiers: [{ tier: 'default', override_route: CUSTOM, fallback_routes: [] }],
    });
    await service
      .update(AGENT, 'default', 'fake2/gpt-4o', { unset: ['legacy'] }, 'tenant-1')
      .catch(() => undefined);
    expect(modelParams.get).toHaveBeenCalledWith(
      AGENT,
      'tier:default',
      'custom:abc',
      'api_key',
      'custom:abc/gpt-4o',
    );
  });

  it('without a tenant, an alias cannot resolve but route-derived names still do', async () => {
    const { service, discovery } = withChain(CUSTOM);
    await expect(service.get(AGENT, { virtual: 'flash' }, 'fake2/gpt-4o')).rejects.toThrow(
      BadRequestException,
    );
    expect((await service.get(AGENT, { virtual: 'flash' }, 'gpt-4o')).route).toEqual(CUSTOM);
    expect(discovery.getModelsForAgent).not.toHaveBeenCalled();
  });

  it('keeps working when the catalog cannot be read', async () => {
    const { service, discovery } = withChain(OPENAI);
    discovery.getModelsForAgent.mockRejectedValueOnce(new Error('db down'));
    const view = await service.get(AGENT, { virtual: 'flash' }, 'openai/gpt-4o', 'tenant-1');
    expect(view.route).toEqual(OPENAI);
  });

  it("lets the stored id win over another route's derived name", async () => {
    // B stores the OpenRouter id "openai/gpt-4o"; A's derived name is the same
    // string. The stored id names B alone, as before.
    const A = { provider: 'openai', authType: 'api_key', model: 'gpt-4o' };
    const B = { provider: 'openrouter', authType: 'api_key', model: 'openai/gpt-4o' };
    const catalog = [
      { id: 'gpt-4o', provider: 'openai', authType: 'api_key' },
      { id: 'openai/gpt-4o', provider: 'openrouter', authType: 'api_key' },
    ];
    const virtual = setup({
      catalog,
      virtualModels: [
        { id: 'vm1', name: 'flash', enabled: true, override_route: A, fallback_routes: [B] },
      ],
    });
    expect(
      (await virtual.service.get(AGENT, { virtual: 'flash' }, 'openai/gpt-4o', 'tenant-1')).route,
    ).toEqual(B);
    expect(
      (await virtual.service.get(AGENT, { virtual: 'flash' }, 'gpt-4o', 'tenant-1')).route,
    ).toEqual(A);
    expect(
      (
        await virtual.service.get(
          AGENT,
          { virtual: 'flash' },
          'openrouter/openai/gpt-4o',
          'tenant-1',
        )
      ).route,
    ).toEqual(B);

    const tier = setup({
      catalog,
      tiers: [{ tier: 'default', override_route: A, fallback_routes: [B] }],
    });
    expect((await tier.service.get(AGENT, 'default', 'openai/gpt-4o', 'tenant-1')).route).toEqual(
      B,
    );
    expect((await tier.service.get(AGENT, 'default', 'gpt-4o')).route).toEqual(A);
  });

  it('suggests only names that select a single route', async () => {
    // Two custom providers without alias share the native "gpt-4o"; the
    // public id of each is its stored custom:<id>/gpt-4o, which is unique.
    const C1 = { provider: 'custom:a', authType: 'api_key', model: 'custom:a/gpt-4o' };
    const C2 = { provider: 'custom:b', authType: 'api_key', model: 'custom:b/gpt-4o' };
    const { service } = setup({
      tiers: [{ tier: 'default', override_route: C1, fallback_routes: [C2] }],
    });
    await expect(service.get(AGENT, 'default', 'gpt-4o')).rejects.toThrow(
      /name it by one of: custom:a\/gpt-4o, custom:b\/gpt-4o$/,
    );

    // The same model on two keys of one connection is not ambiguous.
    const keys = setup({
      tiers: [
        {
          tier: 'default',
          override_route: { ...C1, keyLabel: 'one' },
          fallback_routes: [{ ...C1, keyLabel: 'two' }],
        },
      ],
    });
    expect((await keys.service.get(AGENT, 'default', 'gpt-4o')).route).toMatchObject(C1);
  });
});
