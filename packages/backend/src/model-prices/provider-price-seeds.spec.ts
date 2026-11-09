import { computeTokenCost } from '../common/utils/cost-calculator';
import { PROVIDER_PRICE_SEEDS, priceSeedEntry } from './provider-price-seeds';

const M = 1_000_000;
const entry = (provider: string, model: string) =>
  priceSeedEntry(model, provider, PROVIDER_PRICE_SEEDS[provider][model]);

describe('provider price seeds in the cost calculator', () => {
  it('bills a whole OpenAI request at the >272K rates', () => {
    const pricing = entry('openai', 'gpt-6.1-sol');
    const short = computeTokenCost({ inputTokens: 100_000, outputTokens: 0, model: 'm', pricing });
    const long = computeTokenCost({ inputTokens: 300_000, outputTokens: 0, model: 'm', pricing });
    expect(short).toBeCloseTo((100_000 * 2) / M, 9);
    expect(long).toBeCloseTo((300_000 * 4) / M, 9);
  });

  it('applies the dated Gemini Argon price from 2026-12-01', () => {
    const pricing = entry('gemini', 'gemini-4-argon');
    const before = computeTokenCost({
      inputTokens: M,
      outputTokens: 0,
      model: 'm',
      pricing,
      at: new Date('2026-11-30T23:00:00Z'),
    });
    const after = computeTokenCost({
      inputTokens: M,
      outputTokens: 0,
      model: 'm',
      pricing,
      at: new Date('2026-12-01T00:00:00Z'),
    });
    expect(before).toBeCloseTo(2, 9);
    expect(after).toBeCloseTo(4, 9);
  });

  it('bills Anthropic one-hour cache writes at 2x input', () => {
    const pricing = {
      model_name: 'claude',
      provider: 'Anthropic',
      input_price_per_token: 3 / M,
      output_price_per_token: 15 / M,
      cache_write_price_per_token: 3.75 / M,
      display_name: null,
    };
    const cost = computeTokenCost({
      inputTokens: 1000,
      outputTokens: 0,
      cacheCreationTokens: 1000,
      cacheCreation1hTokens: 400,
      model: 'claude',
      pricing,
    });
    expect(cost).toBeCloseTo((600 * 3.75 + 400 * 6) / M, 12);
  });
});
