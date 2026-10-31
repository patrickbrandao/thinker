jest.mock('../../common/utils/container-host', () => ({
  getContainerHostAlias: () => 'host.docker.internal',
}));
jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: () => 'new-id',
}));

import { LocalServers1804500000000 } from './1804500000000-LocalServers';

type Call = { sql: string; params?: unknown[] };

function runner(responses: { match: RegExp; rows: unknown[] }[]) {
  const calls: Call[] = [];
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    return responses.find((r) => r.match.test(sql))?.rows ?? [];
  });
  return { qr: { query } as never, calls };
}

const updates = (calls: Call[], re: RegExp) => calls.filter((c) => re.test(c.sql));

describe('LocalServers1804500000000', () => {
  const savedHost = process.env['OLLAMA_HOST'];
  afterEach(() => {
    if (savedHost === undefined) delete process.env['OLLAMA_HOST'];
    else process.env['OLLAMA_HOST'] = savedHost;
  });

  it('tags tile-created custom providers and zeroes their prices', async () => {
    const { qr, calls } = runner([
      {
        match: /SELECT "id", "name", "base_url", "models" FROM "custom_providers"/,
        rows: [
          {
            id: 'lm',
            name: 'LM Studio',
            base_url: 'http://host.docker.internal:1234/v1',
            models: JSON.stringify([
              { model_name: 'qwen', input_price_per_million_tokens: 3, price_estimated: true },
            ]),
          },
          { id: 'll', name: 'llama.cpp', base_url: 'http://192.168.1.30:8080/v1', models: '[]' },
          { id: 'groq', name: 'Groq', base_url: 'https://api.groq.com/openai/v1', models: '[]' },
        ],
      },
    ]);
    await new LocalServers1804500000000().up(qr);

    const tagged = updates(calls, /UPDATE "custom_providers"\s+SET "local_type"/);
    expect(tagged.map((c) => c.params?.[0])).toEqual(['lmstudio', 'llamacpp']);
    expect(JSON.parse(tagged[1].params?.[1] as string)).toMatchObject({
      host: '192.168.1.30',
      port: 8080,
    });
    expect(tagged[1].params?.[2]).toBe('http://192.168.1.30:8080/v1');
    expect(JSON.parse(tagged[0].params?.[3] as string)).toEqual([
      { model_name: 'qwen', input_price_per_million_tokens: 0, output_price_per_million_tokens: 0 },
    ]);
    const retag = updates(calls, /UPDATE "tenant_providers" t\s+SET "auth_type" = 'local'/);
    expect(retag.map((c) => c.params?.[0])).toEqual(['custom:lm', 'custom:ll']);
  });

  it('converts the built-in Ollama connection into a server and re-points routes', async () => {
    process.env['OLLAMA_HOST'] = 'http://192.168.1.20:11434';
    const { qr, calls } = runner([
      {
        match: /SELECT "tenant_id", "cached_models" FROM "tenant_providers"/,
        rows: [
          {
            tenant_id: 't1',
            cached_models: JSON.stringify([{ id: 'llama3.2', contextWindow: 131072 }]),
          },
        ],
      },
      {
        match: /SELECT "name", "alias" FROM "custom_providers"/,
        rows: [{ name: 'Ollama', alias: null }],
      },
      { match: /SELECT "id" FROM "agents"/, rows: [{ id: 'a1' }] },
      {
        match: /FROM "tier_assignments"/,
        rows: [
          {
            id: 'tier-1',
            override_route: { provider: 'ollama', authType: 'local', model: 'qwen3:8b' },
            auto_assigned_route: null,
            fallback_routes: [
              { provider: 'ollama', authType: 'local', model: 'ollama/llama3.2' },
              { provider: 'openai', authType: 'api_key', model: 'gpt-5' },
            ],
          },
        ],
      },
      {
        match: /SELECT "id", "model_name" FROM "agent_model_params"/,
        rows: [{ id: 'p1', model_name: 'qwen3:8b' }],
      },
    ]);
    await new LocalServers1804500000000().up(qr);

    const insert = updates(calls, /INSERT INTO "custom_providers"/)[0];
    expect(insert.params?.slice(0, 5)).toEqual([
      'new-id',
      't1',
      'Ollama 2',
      'ollama-2',
      'http://192.168.1.20:11434/v1',
    ]);
    // The routed model the cache missed is listed too.
    expect(
      JSON.parse(insert.params?.[5] as string).map((m: { model_name: string }) => m.model_name),
    ).toEqual(['llama3.2', 'qwen3:8b']);

    const tier = updates(calls, /UPDATE "tier_assignments"/)[0];
    expect(JSON.parse(tier.params?.[0] as string)).toEqual({
      provider: 'custom:new-id',
      authType: 'local',
      model: 'custom:new-id/qwen3:8b',
    });
    expect(JSON.parse(tier.params?.[2] as string)).toEqual([
      { provider: 'custom:new-id', authType: 'local', model: 'custom:new-id/llama3.2' },
      { provider: 'openai', authType: 'api_key', model: 'gpt-5' },
    ]);

    const conn = updates(calls, /UPDATE "tenant_providers" SET "provider" = \$1/)[0];
    expect(conn.params).toEqual(['custom:new-id', 't1']);
    const param = updates(calls, /UPDATE "agent_model_params" SET "provider"/)[0];
    expect(param.params).toEqual(['custom:new-id', 'custom:new-id/qwen3:8b', 'p1']);
  });

  it('does nothing for Ollama when no tenant connected it', async () => {
    const { qr, calls } = runner([]);
    await new LocalServers1804500000000().up(qr);
    expect(updates(calls, /INSERT INTO "custom_providers"/)).toHaveLength(0);
  });
});
