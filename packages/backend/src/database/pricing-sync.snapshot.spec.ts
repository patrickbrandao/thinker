import { PricingSyncService } from './pricing-sync.service';
import { ModelsDevSyncService } from './models-dev-sync.service';
import { loadPricingSnapshot } from '../model-prices/pricing-snapshot';

jest.mock('../model-prices/pricing-snapshot', () => ({ loadPricingSnapshot: jest.fn() }));

const generatedAt = new Date('2026-10-26T12:00:00.000Z');
const snapshot = {
  generatedAt,
  openrouter: [
    {
      id: 'openai/gpt-x',
      name: 'OpenAI: GPT X',
      pricing: { prompt: '0.000001', completion: '0.000002' },
    },
  ],
  modelsDev: {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      models: { 'gpt-x': { id: 'gpt-x', name: 'GPT X', cost: { input: 1, output: 2 } } },
    },
  },
};

describe('catalog syncs fall back to the build snapshot (#73)', () => {
  const env = process.env['THINKER_CATALOG_SYNC'];

  beforeEach(() => {
    (loadPricingSnapshot as jest.Mock).mockReturnValue(snapshot);
  });
  afterEach(() => {
    if (env === undefined) delete process.env['THINKER_CATALOG_SYNC'];
    else process.env['THINKER_CATALOG_SYNC'] = env;
    jest.restoreAllMocks();
  });

  it('loads OpenRouter prices from the snapshot when sync is disabled', () => {
    process.env['THINKER_CATALOG_SYNC'] = 'false';
    const service = new PricingSyncService();
    service.onModuleInit();
    expect(service.lookupPricing('openai/gpt-x')).toMatchObject({
      input: 0.000001,
      output: 0.000002,
    });
    expect(service.getLastFetchedAt()).toEqual(generatedAt);
  });

  it('loads models.dev prices from the snapshot when sync is disabled', () => {
    process.env['THINKER_CATALOG_SYNC'] = 'false';
    const service = new ModelsDevSyncService();
    service.onModuleInit();
    expect(service.lookupModel('openai', 'gpt-x')).toMatchObject({ id: 'gpt-x' });
    expect(service.getLastFetchedAt()).toEqual(generatedAt);
  });

  it('uses the snapshot when the first OpenRouter fetch fails', async () => {
    process.env['THINKER_CATALOG_SYNC'] = 'true';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const service = new PricingSyncService();
    await service.refreshCache();
    expect(service.lookupPricing('openai/gpt-x')).not.toBeNull();
  });
});
