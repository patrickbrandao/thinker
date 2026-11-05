import { buildProviderModels } from './provider-models';

const row = (over: Record<string, unknown>) =>
  ({
    id: 'c1',
    provider: 'openai',
    auth_type: 'api_key',
    label: 'work',
    is_active: true,
    models_fetched_at: '2026-11-05T00:00:00Z',
    cached_models: [],
    ...over,
  }) as never;

const model = (id: string, input: number | null, ctx = 128000) => ({
  id,
  displayName: id.toUpperCase(),
  provider: 'openai',
  contextWindow: ctx,
  inputPricePerToken: input,
  outputPricePerToken: input === null ? null : input * 4,
  capabilityReasoning: false,
  capabilityCode: true,
  qualityScore: 1,
});

describe('buildProviderModels', () => {
  it('groups a model across accounts, each with its own price', () => {
    const models = buildProviderModels(
      [
        row({ id: 'c1', label: 'work', cached_models: [model('gpt-4o', 0.000002)] }),
        row({
          id: 'c2',
          label: 'plus',
          auth_type: 'subscription',
          cached_models: [model('gpt-4o', null, 200000), model('o3', null)],
        }),
      ],
      [],
      false,
    );
    expect(models.map((m) => m.id)).toEqual(['gpt-4o', 'o3']);
    const gpt = models[0];
    expect(gpt.context_window).toBe(200000);
    expect(gpt.accounts.map((a) => [a.label, a.kind, a.input_price_per_token])).toEqual([
      ['work', 'api_key', 0.000002],
      ['plus', 'subscription', null],
    ]);
  });

  it('skips inactive accounts unless asked', () => {
    const rows = [row({ is_active: false, cached_models: [model('gpt-4o', 1)] })];
    expect(buildProviderModels(rows, [], false)).toEqual([]);
    expect(buildProviderModels(rows, [], true)).toHaveLength(1);
  });

  it('reads custom and local providers from their definition', () => {
    const models = buildProviderModels(
      [row({ id: 'c3', provider: 'custom:abc', label: 'lab', auth_type: 'api_key' })],
      [
        {
          id: 'abc',
          name: 'Lab',
          local_type: 'ollama',
          models: [
            { model_name: 'llama3', input_price_per_million_tokens: 0, context_window: 8192 },
          ],
        } as never,
      ],
      false,
    );
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: 'llama3', provider_name: 'Lab', context_window: 8192 });
    expect(models[0].accounts[0]).toMatchObject({ kind: 'local', input_price_per_token: 0 });
  });
});
