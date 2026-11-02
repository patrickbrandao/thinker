import {
  OPENCODE_CATALOG_URLS,
  OpencodeCatalogService,
  opencodeCatalogProvider,
  parseOpencodeCatalog,
} from './opencode-catalog.service';
import { outboundFetch } from '../common/outbound/outbound-proxy';

jest.mock('../common/outbound/outbound-proxy', () => ({ outboundFetch: jest.fn() }));

const fetchMock = outboundFetch as jest.MockedFunction<typeof outboundFetch>;

const model = (id: string, api: string, input: number, output: number, extra = {}) => ({
  id,
  name: id.toUpperCase(),
  type: 'chat',
  capabilities: { tools: { supported: true }, reasoning: { supported: true } },
  limit: { context: 200000, output: 32000 },
  cost: {
    text: { input: { price: input, cache: { read: input / 10 } }, output: { price: output } },
  },
  api: { [api]: { base_url: 'https://opencode.ai/inference/openai/v1' } },
  ...extra,
});

const BODY = {
  object: 'list',
  data: [
    model('big-pickle', 'chat-completions', 0, 0),
    model('gpt-6-luna', 'responses', 0.1, 0.5),
    model('claude-haiku-5-5', 'messages', 0.1, 0.5),
    model('gemini-4-argon', 'generate-content', 2, 10),
    model('deepseek-v4.1-flash', 'chat-completions', 0.15, 0.6, {
      cost: {
        text: { input: { price: 0.15 }, output: { price: 0.6 } },
        multipliers: [
          {
            when: {
              utc_days: { in: ['mon', 'fri'] },
              any: [
                { all: [{ utc_hours: { gte: '01:00' } }, { utc_hours: { lt: '04:00' } }] },
                { all: [{ utc_hours: { gte: '06:00' } }, { utc_hours: { lt: '10:00' } }] },
              ],
            },
            factor: 2,
          },
        ],
      },
    }),
    { ...model('jev-1.13', 'systemone', 0.042, 0), type: 'decision' },
  ],
};

describe('parseOpencodeCatalog', () => {
  const entries = parseOpencodeCatalog(BODY);
  const byId = new Map(entries.map((e) => [e.id, e]));

  it('maps each catalog protocol to an endpoint format and skips decision models', () => {
    expect(entries.map((e) => [e.id, e.format])).toEqual([
      ['big-pickle', 'openai'],
      ['gpt-6-luna', 'responses'],
      ['claude-haiku-5-5', 'anthropic'],
      ['gemini-4-argon', 'google'],
      ['deepseek-v4.1-flash', 'openai'],
    ]);
  });

  it('converts prices to per-token and flags free models', () => {
    expect(byId.get('big-pickle')).toMatchObject({ free: true, inputPricePerToken: 0 });
    expect(byId.get('gpt-6-luna')).toMatchObject({
      free: false,
      inputPricePerToken: 0.1 / 1_000_000,
      outputPricePerToken: 0.5 / 1_000_000,
      contextWindow: 200000,
    });
  });

  it('turns peak multipliers into weekday time tiers at base × factor', () => {
    const [tier] = byId.get('deepseek-v4.1-flash')!.timeTiers!;
    expect(tier.windows).toEqual(['01:00-04:00', '06:00-10:00']);
    expect(tier.days).toEqual([1, 5]);
    expect(tier.input_price_per_token).toBeCloseTo((0.15 * 2) / 1_000_000);
    expect(tier.output_price_per_token).toBeCloseTo((0.6 * 2) / 1_000_000);
  });

  it('returns nothing for a body without a data array', () => {
    expect(parseOpencodeCatalog({ error: 'x' })).toEqual([]);
  });
});

describe('opencodeCatalogProvider', () => {
  it('resolves the ids and their aliases, including the former OpenCode Zen', () => {
    expect(opencodeCatalogProvider('opencode')).toBe('opencode');
    expect(opencodeCatalogProvider('OpenCode-Zen')).toBe('opencode');
    expect(opencodeCatalogProvider('opencodego')).toBe('opencode-go');
    expect(opencodeCatalogProvider('anthropic')).toBeNull();
  });
});

describe('OpencodeCatalogService', () => {
  let service: OpencodeCatalogService;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => BODY } as Response);
    service = new OpencodeCatalogService(null);
  });

  it('fetches each provider catalog once per cache window', async () => {
    await service.list('opencode');
    await service.resolveFormat('opencode', 'opencode/gpt-6-luna');
    await service.list('opencode-go');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      OPENCODE_CATALOG_URLS.opencode,
      OPENCODE_CATALOG_URLS['opencode-go'],
    ]);
  });

  it('resolves prefixed model ids to their format and pricing', async () => {
    expect(await service.resolveFormat('opencode', 'opencode/claude-haiku-5-5')).toBe('anthropic');
    expect(await service.resolvePricing('opencode', 'gpt-6-luna')).toMatchObject({
      provider: 'opencode',
      input_price_per_token: 0.1 / 1_000_000,
    });
  });

  it('keeps the last good catalog when a refresh fails', async () => {
    await service.list('opencode');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    expect(await service.refresh('opencode')).toHaveLength(5);
  });

  it('prices OpenCode at list with the reported cost, and Go as quota equivalent', async () => {
    expect(await service.costInputs('opencode', 'opencode/gpt-6-luna')).toMatchObject({
      ignoreReportedCost: false,
      pricing: { input_price_per_token: 0.1 / 1_000_000 },
    });
    expect(await service.costInputs('opencode-go', 'gpt-6-luna')).toMatchObject({
      ignoreReportedCost: true,
    });
    expect(await service.costInputs('anthropic', 'claude-haiku-5-5')).toBeNull();
  });
});
