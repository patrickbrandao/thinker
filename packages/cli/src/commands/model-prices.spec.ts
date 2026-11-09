import { modelPrices } from './model-prices';
import { fetchStub, makeIo } from '../../test/helpers';

const HOST = 'http://localhost:2099';

function setup(
  replies: Array<{ status: number; body: unknown }>,
  env: Record<string, string> = {},
) {
  const stub = fetchStub(replies);
  const io = makeIo({
    env: { THINKER_URL: HOST, THINKER_API_KEY: 'secret-key', ...env },
    fetchImpl: stub.impl,
  });
  return { io, calls: stub.calls };
}

const ROWS = {
  models: [
    {
      model_name: 'gpt-5',
      provider: 'OpenAI',
      input_price_per_million: 1.25,
      output_price_per_million: 10,
      display_name: 'GPT-5',
      validated: true,
    },
    {
      model_name: 'gemini-3-pro',
      provider: 'Google',
      input_price_per_million: 2,
      output_price_per_million: 12,
    },
    {
      model_name: 'claude-sonnet',
      provider: 'Anthropic',
      input_price_per_million: 3,
      output_price_per_million: 15,
    },
  ],
  lastSyncedAt: '2026-08-02T09:00:00.000Z',
};

describe('modelPrices', () => {
  it('requests the install-wide list with the API key and no agent', async () => {
    const { io, calls } = setup([{ status: 200, body: ROWS }]);
    await modelPrices(io, []);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${HOST}/api/v1/model-prices`);
    expect(calls[0].headers['X-API-Key']).toBe('secret-key');
  });

  it('prints trimmed rows: only model, provider and the two prices', async () => {
    const { io } = setup([{ status: 200, body: ROWS }]);
    await modelPrices(io, []);
    const out = io.lastJson() as { count: number; models: Array<Record<string, unknown>> };
    expect(out.count).toBe(3);
    expect(out.models[0]).toEqual({
      model: 'gpt-5',
      provider: 'OpenAI',
      input_price_per_million: 1.25,
      output_price_per_million: 10,
    });
    expect(out).not.toHaveProperty('provider');
  });

  it('never prints the API key', async () => {
    const { io } = setup([{ status: 200, body: ROWS }]);
    await modelPrices(io, []);
    expect(io.lines.join('\n')).not.toContain('secret-key');
  });

  it('passes the sync time through, or null', async () => {
    const withTime = setup([{ status: 200, body: ROWS }]);
    await modelPrices(withTime.io, []);
    expect(withTime.io.lastJson()).toMatchObject({ last_synced_at: '2026-08-02T09:00:00.000Z' });

    const without = setup([{ status: 200, body: { models: [] } }]);
    await modelPrices(without.io, []);
    expect(without.io.lastJson()).toEqual({ count: 0, last_synced_at: null, models: [] });
  });

  it('collapses IEEE noise but keeps non-numbers untouched', async () => {
    const { io } = setup([
      {
        status: 200,
        body: {
          models: [
            {
              model_name: 'a',
              provider: 'X',
              input_price_per_million: 0.09999999999999999,
              output_price_per_million: 0.30000000000000004,
            },
            { model_name: 'b', provider: 'X', input_price_per_million: null },
            {
              model_name: 'c',
              provider: 'X',
              input_price_per_million: '1.5',
              output_price_per_million: Number.MAX_VALUE,
            },
          ],
        },
      },
    ]);
    await modelPrices(io, []);
    const models = (io.lastJson() as { models: Array<Record<string, unknown>> }).models;
    expect(models[0]).toMatchObject({
      input_price_per_million: 0.1,
      output_price_per_million: 0.3,
    });
    expect(models[1].input_price_per_million).toBeNull();
    expect(models[1].output_price_per_million).toBeUndefined();
    expect(models[2].input_price_per_million).toBe('1.5');
  });

  describe('--provider', () => {
    it('matches the catalog id against the display name the API returns', async () => {
      const { io } = setup([{ status: 200, body: ROWS }]);
      await modelPrices(io, ['--provider', 'openai']);
      const out = io.lastJson() as {
        provider: string;
        count: number;
        models: Array<{ model: string }>;
      };
      expect(out.provider).toBe('openai');
      expect(out.count).toBe(1);
      expect(out.models.map((m) => m.model)).toEqual(['gpt-5']);
    });

    it('resolves an alias to the canonical provider', async () => {
      const { io } = setup([{ status: 200, body: ROWS }]);
      await modelPrices(io, ['--provider', 'google']);
      const out = io.lastJson() as { provider: string; models: Array<{ model: string }> };
      expect(out.provider).toBe('gemini');
      expect(out.models.map((m) => m.model)).toEqual(['gemini-3-pro']);
    });

    it('is case-insensitive on the flag and on the row provider', async () => {
      const { io } = setup([
        {
          status: 200,
          body: { models: [{ model_name: 'm', provider: 'ANTHROPIC' }] },
        },
      ]);
      await modelPrices(io, ['--provider=ANTHROPIC']);
      expect((io.lastJson() as { count: number }).count).toBe(1);
    });

    it('returns an empty list when nothing matches', async () => {
      const { io } = setup([{ status: 200, body: ROWS }]);
      await modelPrices(io, ['--provider', 'deepseek']);
      expect(io.lastJson()).toEqual({
        provider: 'deepseek',
        count: 0,
        last_synced_at: '2026-08-02T09:00:00.000Z',
        models: [],
      });
    });

    it('rejects an unknown provider before any request', async () => {
      const { io, calls } = setup([{ status: 200, body: ROWS }]);
      await expect(modelPrices(io, ['--provider', 'not-a-provider'])).rejects.toMatchObject({
        code: 'unknown_provider',
      });
      expect(calls).toHaveLength(0);
    });
  });

  describe('defensive parsing', () => {
    it.each([
      ['null body', null],
      ['array body', []],
      ['models not an array', { models: 'nope' }],
      ['models missing', {}],
    ])('treats %s as an empty list', async (_label, body) => {
      const { io } = setup([{ status: 200, body }]);
      await modelPrices(io, []);
      expect(io.lastJson()).toMatchObject({ count: 0, models: [] });
    });

    it('drops rows that are not objects', async () => {
      const { io } = setup([
        {
          status: 200,
          body: { models: ['x', 3, null, { model_name: 'ok', provider: 'OpenAI' }] },
        },
      ]);
      await modelPrices(io, []);
      expect((io.lastJson() as { count: number }).count).toBe(1);
    });

    it('does not match rows with no provider when filtering', async () => {
      const { io } = setup([{ status: 200, body: { models: [{ model_name: 'm' }] } }]);
      await modelPrices(io, ['--provider', 'openai']);
      expect((io.lastJson() as { count: number }).count).toBe(0);
    });
  });

  describe('errors', () => {
    it('rejects positionals and unknown flags', async () => {
      const { io } = setup([{ status: 200, body: ROWS }]);
      await expect(modelPrices(io, ['extra'])).rejects.toMatchObject({
        code: 'unexpected_argument',
      });
      await expect(modelPrices(io, ['--nope'])).rejects.toMatchObject({ code: 'unknown_flag' });
    });

    it('requires a value for --provider', async () => {
      const { io } = setup([{ status: 200, body: ROWS }]);
      await expect(modelPrices(io, ['--provider'])).rejects.toMatchObject({
        code: 'missing_value',
      });
    });

    it('fails without a credential', async () => {
      const io = makeIo({ env: { THINKER_URL: HOST } });
      await expect(modelPrices(io, [])).rejects.toMatchObject({ code: 'not_authenticated' });
    });

    it('surfaces an HTTP error from the server', async () => {
      const { io } = setup([{ status: 401, body: { message: 'Invalid API key' } }]);
      await expect(modelPrices(io, [])).rejects.toMatchObject({ status: 401 });
    });
  });
});
