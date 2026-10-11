import {
  ProviderParamSpecService,
  parseModelParametersCatalog,
} from '../provider-param-spec.service';

describe('ProviderParamSpecService', () => {
  it('loads model parameter specs from the modelparams package without network fetches', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const service = new ProviderParamSpecService();

    await expect(service.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'openai',
          authType: 'api_key',
          model: 'gpt-4o',
        }),
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('filters specs by provider, auth type, and model', async () => {
    const service = new ProviderParamSpecService();

    const apiSpecs = await service.getSpecs('openai', 'api_key', 'gpt-4o');
    const localSpecs = await service.getSpecs('openai', 'local', 'gpt-4o');

    expect(apiSpecs.map((spec) => spec.path)).toEqual(['max_tokens', 'temperature', 'top_p']);
    expect(localSpecs.map((spec) => spec.path)).toEqual([]);
  });

  it('lists model identities without param details and canonicalizes provider aliases', async () => {
    const service = new ProviderParamSpecService();

    expect(await service.listModelIds()).toEqual(
      expect.arrayContaining([
        { provider: 'openai', authType: 'api_key', model: 'gpt-4o' },
        { provider: 'zai', authType: 'api_key', model: 'glm-4.6' },
      ]),
    );
  });

  it('loads providerless subscription specs for prefixed Copilot models', async () => {
    const service = new ProviderParamSpecService();

    const specs = await service.getSpecs('copilot', 'subscription', 'copilot/gpt-5.5');

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'copilot',
          authType: 'subscription',
          model: 'copilot/gpt-5.5',
          path: 'reasoning.effort',
        }),
        expect.objectContaining({
          provider: 'copilot',
          authType: 'subscription',
          model: 'copilot/gpt-5.5',
          path: 'text.verbosity',
        }),
      ]),
    );
  });

  it('accepts Copilot subscription route ids that already include the subscription suffix', async () => {
    const service = new ProviderParamSpecService();

    const specs = await service.getSpecs('copilot', 'subscription', 'copilot/gpt-5.5-subscription');

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'copilot',
          authType: 'subscription',
          model: 'copilot/gpt-5.5-subscription',
          path: 'reasoning.effort',
        }),
      ]),
    );
  });

  it('normalizes Copilot Claude dotted minor versions before providerless lookup', async () => {
    const service = new ProviderParamSpecService();

    const specs = await service.getSpecs('copilot', 'subscription', 'copilot/claude-sonnet-4.6');

    expect(specs.map((spec) => spec.path)).toEqual(
      expect.arrayContaining([
        'max_tokens',
        'output_config.effort',
        'thinking.budget_tokens',
        'thinking.type',
      ]),
    );
    expect(specs[0]).toEqual(
      expect.objectContaining({
        provider: 'copilot',
        authType: 'subscription',
        model: 'copilot/claude-sonnet-4.6',
      }),
    );
  });

  it('resolves Bedrock Claude model ids through the underlying Anthropic provider for params', async () => {
    const service = new ProviderParamSpecService();

    const specs = await service.getSpecs('bedrock', 'api_key', 'us.anthropic.claude-opus-4.8');

    expect(specs.map((spec) => spec.path)).toEqual(
      expect.arrayContaining(['max_tokens', 'output_config.effort', 'thinking.type']),
    );
    expect(specs[0]).toEqual(
      expect.objectContaining({
        provider: 'bedrock',
        authType: 'api_key',
        model: 'us.anthropic.claude-opus-4.8',
      }),
    );
  });

  it.each([
    [
      'k3',
      [
        'max_completion_tokens',
        'stop',
        'reasoning_effort',
        'thinking.type',
        'tool_choice',
        'response_format.type',
      ],
    ],
    [
      'k3-256k',
      [
        'max_completion_tokens',
        'stop',
        'reasoning_effort',
        'thinking.type',
        'tool_choice',
        'response_format.type',
      ],
    ],
    ['kimi-for-coding', ['max_completion_tokens', 'thinking.type', 'response_format.type']],
    [
      'kimi-for-coding-highspeed',
      ['max_completion_tokens', 'thinking.type', 'response_format.type'],
    ],
  ])('resolves Moonshot wire id %s through its metadata model', async (model, paths) => {
    const service = new ProviderParamSpecService();

    const specs = await service.getSpecs('moonshot', 'subscription', model);

    expect(specs.map((spec) => spec.path)).toEqual(paths);
    expect(specs[0]).toEqual(
      expect.objectContaining({
        provider: 'moonshot',
        authType: 'subscription',
        model,
      }),
    );
  });

  it('strips dated Bedrock model ids for providerless params while preserving the route identity', async () => {
    const service = new ProviderParamSpecService();

    const specs = await service.getSpecs('bedrock', 'api_key', 'openai.gpt-5.4-2026-03-05');

    expect(specs.map((spec) => spec.path)).toEqual(['max_completion_tokens', 'reasoning_effort']);
    expect(specs[0]).toEqual(
      expect.objectContaining({
        provider: 'bedrock',
        authType: 'api_key',
        model: 'openai.gpt-5.4-2026-03-05',
      }),
    );
  });

  it('falls back to package API-key specs for subscription routes without subscription specs', async () => {
    const service = new ProviderParamSpecService();

    const specs = await service.getSpecs('copilot', 'subscription', 'copilot/gpt-4o-mini');

    expect(specs.map((spec) => spec.path)).toEqual(['max_tokens', 'temperature', 'top_p']);
    expect(specs[0]).toEqual(
      expect.objectContaining({
        provider: 'copilot',
        authType: 'subscription',
        model: 'copilot/gpt-4o-mini',
      }),
    );
  });

  it('returns no specs for local or missing model routes', async () => {
    const service = new ProviderParamSpecService();

    await expect(service.getSpecs('openai', 'local', 'gpt-4o')).resolves.toEqual([]);
    await expect(service.getSpecs('openai', 'api_key', 'missing-model')).resolves.toEqual([]);
    await expect(service.getSpecs('moonshot', 'api_key', 'missing-model')).resolves.toEqual([]);
    await expect(service.getCapabilities('openai', 'api_key', 'missing-model')).resolves.toBeNull();
  });
});

describe('ProviderParamSpecService bundled snapshot only (#17)', () => {
  it('never fetches the catalog: no boot hook, no scheduled refresh, no network call', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    try {
      const service = new ProviderParamSpecService() as unknown as Record<string, unknown>;

      expect(service['onModuleInit']).toBeUndefined();
      expect(service['scheduledRefresh']).toBeUndefined();
      expect(service['refreshCatalog']).toBeUndefined();
      await (service as unknown as ProviderParamSpecService).list();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('parseModelParametersCatalog', () => {
  const validParam = {
    path: 'max_tokens',
    type: 'integer',
    label: 'Max tokens',
    description: 'Maximum number of tokens.',
    group: 'generation_length',
  };
  const entry = (overrides: Record<string, unknown> = {}) => ({
    provider: 'openai',
    authType: 'api_key',
    model: 'gpt-test',
    params: [validParam],
    ...overrides,
  });

  it.each([
    ['a non-object body', 'wat'],
    ['an array body', []],
    ['a body without models', {}],
    ['a non-array models field', { models: 'wat' }],
    ['a body with no usable entry', { models: [entry({ authType: 'bogus' })] }],
  ])('rejects %s', (_label, raw) => {
    expect(parseModelParametersCatalog(raw)).toBeNull();
  });

  it('keeps valid entries and drops malformed ones', () => {
    const catalog = parseModelParametersCatalog({
      models: [
        entry(),
        entry({ model: '' }),
        entry({ provider: 42 }),
        entry({ params: 'wat' }),
        entry({ model: 'only-bad-params', params: [{ ...validParam, type: 'nope' }] }),
        entry({ model: 'bad-capability', capabilities: ['not-a-capability'] }),
      ],
    });
    expect(catalog?.map((e) => e.model)).toEqual(['gpt-test']);
  });

  it('drops API-level params, enums without values and invalid defaults', () => {
    const catalog = parseModelParametersCatalog({
      models: [
        entry({
          params: [
            validParam,
            { ...validParam, path: 'stream', type: 'boolean' },
            { ...validParam, path: 'reasoning_effort', type: 'enum', group: 'reasoning' },
            {
              ...validParam,
              path: 'temperature',
              type: 'number',
              range: { min: 0, max: 2 },
              default: 5,
            },
            { ...validParam, path: 'top_p', type: 'number', range: { step: 0 } },
          ],
        }),
      ],
    });
    expect(catalog?.[0].params.map((p) => p.path)).toEqual(['max_tokens']);
  });

  it('accepts a capability-only entry', () => {
    const catalog = parseModelParametersCatalog({
      models: [entry({ params: undefined, capabilities: ['tools', 'tools'] })],
    });
    expect(catalog?.[0].capabilities).toEqual(['tools']);
    expect(catalog?.[0].params).toEqual([]);
  });
});
