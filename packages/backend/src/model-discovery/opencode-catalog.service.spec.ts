import {
  OPENCODE_CATALOG_URLS,
  OPENCODE_MODELS_URL,
  OpencodeCatalogService,
  opencodeCatalogProvider,
  parseOpencodeCatalog,
  parseOpencodeModelsDev,
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

// The models.dev v2 document from models.opencode.ai: providers keyed by id.
const record = (models: ReturnType<typeof model>[]) =>
  Object.fromEntries(models.map((m) => [m.id, m]));
const DOC = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    env: [],
    models: record([model('x', 'messages', 1, 2)]),
  },
  opencode: { id: 'opencode', name: 'OpenCode', env: [], models: record(BODY.data) },
  'opencode-go': {
    id: 'opencode-go',
    name: 'OpenCode Go',
    env: [],
    models: record([
      model('glm-5.3-flash', 'chat-completions', 0.15, 0.5),
      model('qwen3.8-max', 'messages', 2, 6),
    ]),
  },
};

describe('parseOpencodeModelsDev', () => {
  it('reads both OpenCode providers from the shared document and ignores the rest', () => {
    const parsed = parseOpencodeModelsDev(DOC);
    expect(parsed.opencode.map((e) => [e.id, e.format])).toEqual([
      ['big-pickle', 'openai'],
      ['gpt-6-luna', 'responses'],
      ['claude-haiku-5-5', 'anthropic'],
      ['gemini-4-argon', 'google'],
      ['deepseek-v4.1-flash', 'openai'],
    ]);
    expect(parsed['opencode-go'].map((e) => [e.id, e.format])).toEqual([
      ['glm-5.3-flash', 'openai'],
      ['qwen3.8-max', 'anthropic'],
    ]);
    expect(parsed.opencode.find((e) => e.id === 'big-pickle')?.free).toBe(true);
  });

  it('takes the first API a model lists that Thinker can serve, like the client', () => {
    const parsed = parseOpencodeModelsDev({
      opencode: {
        models: {
          a: {
            ...model('a', 'systemone', 1, 1),
            api: { realtime: {}, messages: {}, responses: {} },
          },
        },
      },
    });
    expect(parsed.opencode.map((e) => e.format)).toEqual(['anthropic']);
  });

  it('returns empty lists for a document without the providers', () => {
    expect(parseOpencodeModelsDev({ data: [] })).toEqual({ opencode: [], 'opencode-go': [] });
    expect(parseOpencodeModelsDev(null)).toEqual({ opencode: [], 'opencode-go': [] });
  });
});

const response = (status: number, body: unknown = DOC, etag: string | null = '"v1"') =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    text: async () => JSON.stringify(body),
    json: async () => body,
    body: { cancel: async () => undefined },
  }) as unknown as Response;

const repoWith = (count: () => number) =>
  ({
    createQueryBuilder: () => {
      const qb = {
        where: () => qb,
        andWhere: () => qb,
        getCount: async () => count(),
      };
      return qb;
    },
  }) as never;

describe('OpencodeCatalogService', () => {
  let service: OpencodeCatalogService;
  const savedSync = process.env.THINKER_CATALOG_SYNC;

  beforeEach(() => {
    delete process.env.THINKER_CATALOG_SYNC;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(response(200));
    service = new OpencodeCatalogService(null);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    if (savedSync === undefined) delete process.env.THINKER_CATALOG_SYNC;
    else process.env.THINKER_CATALOG_SYNC = savedSync;
  });

  it('fetches the client catalog once for both providers, with the client User-Agent', async () => {
    await service.list('opencode');
    await service.resolveFormat('opencode', 'opencode/gpt-6-luna');
    await service.list('opencode-go');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENCODE_MODELS_URL);
    expect(url).toBe(
      'https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image',
    );
    expect(init?.headers).toEqual({ 'user-agent': 'opencode/latest/2.2.5/cli' });
    expect(await service.resolveFormat('opencode-go', 'opencode-go/qwen3.8-max')).toBe('anthropic');
  });

  it('resolves prefixed model ids to their format and pricing', async () => {
    expect(await service.resolveFormat('opencode', 'opencode/claude-haiku-5-5')).toBe('anthropic');
    expect(await service.resolvePricing('opencode', 'gpt-6-luna')).toMatchObject({
      provider: 'opencode',
      input_price_per_token: 0.1 / 1_000_000,
    });
  });

  it('revalidates with If-None-Match after 5 minutes and keeps the copy on 304', async () => {
    jest.useFakeTimers({ now: 1_760_000_000_000, doNotFake: ['queueMicrotask'] });
    const first = await service.list('opencode');
    jest.advanceTimersByTime(4 * 60_000);
    await service.list('opencode');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    fetchMock.mockResolvedValueOnce(response(304, null));
    expect(await service.list('opencode')).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
      'user-agent': 'opencode/latest/2.2.5/cli',
      'if-none-match': '"v1"',
    });
    // The 304 renewed the window for both providers.
    await service.list('opencode-go');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries transient failures twice, then keeps the last good copy', async () => {
    jest.useFakeTimers({ now: 1_760_000_000_000 });
    fetchMock
      .mockResolvedValueOnce(response(503))
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(response(200));
    const loading = service.list('opencode');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await loading).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockReset().mockResolvedValue(response(502));
    const refreshing = service.refresh('opencode');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await refreshing).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient status', async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValue(response(200, BODY));
    await service.list('opencode');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      OPENCODE_MODELS_URL,
      // No copy yet: the provider's own catalog on its inference host.
      OPENCODE_CATALOG_URLS.opencode,
    ]);
  });

  it('uses only the inference-host catalogs with THINKER_CATALOG_SYNC=false', async () => {
    process.env.THINKER_CATALOG_SYNC = 'false';
    fetchMock.mockResolvedValue(response(200, BODY));
    await service.list('opencode');
    await service.list('opencode-go');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      OPENCODE_CATALOG_URLS.opencode,
      OPENCODE_CATALOG_URLS['opencode-go'],
    ]);
  });

  it('refreshes in the background every 5 minutes only while an OpenCode account exists', async () => {
    jest.useFakeTimers({ now: 1_760_000_000_000 });
    let accounts = 0;
    service = new OpencodeCatalogService(repoWith(() => accounts));
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    accounts = 1;
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(response(304, null));
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'if-none-match': '"v1"' });

    accounts = 0;
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('starts no background refresh with THINKER_CATALOG_SYNC=false, and destroy clears it', async () => {
    jest.useFakeTimers({ now: 1_760_000_000_000 });
    process.env.THINKER_CATALOG_SYNC = 'false';
    service = new OpencodeCatalogService(repoWith(() => 1));
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    delete process.env.THINKER_CATALOG_SYNC;
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('prices OpenCode at list with the reported cost, and Go as quota equivalent', async () => {
    expect(await service.costInputs('opencode', 'opencode/gpt-6-luna')).toMatchObject({
      ignoreReportedCost: false,
      pricing: { input_price_per_token: 0.1 / 1_000_000 },
    });
    expect(await service.costInputs('opencode-go', 'glm-5.3-flash')).toMatchObject({
      ignoreReportedCost: true,
    });
    expect(await service.costInputs('anthropic', 'claude-haiku-5-5')).toBeNull();
  });
});
