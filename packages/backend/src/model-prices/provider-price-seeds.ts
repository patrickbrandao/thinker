import type { PricingEntry, PricingTimeTier } from './model-pricing-cache.service';

/**
 * Curated per-provider prices for models whose seller publishes rates the
 * public catalogs (models.dev, OpenRouter) lack or get wrong. Each entry is
 * scoped to one provider: the same model id costs a different amount per
 * seller, and a seed for one must never price another.
 *
 * Values are per million tokens; `scheduled` lists dated price changes (the
 * first one whose window covers the request wins) and `longContext` the rates
 * for a prompt above `threshold` tokens. Source for each block: the entity's
 * dossier in docs/externos/ (Contrato, prices section).
 */
export interface PriceSeed {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  longContext?: { threshold: number; input: number; output: number; cacheRead?: number };
  scheduled?: { from: string; until?: string; input: number; output: number; cacheRead?: number }[];
}

const OPENAI_LONG_CONTEXT = 272_000;

/** OpenAI GPT-6 / GPT-5.6: short and >272K rates; cache write at 1.25x input (api-openai G3). */
function openai(
  input: number,
  cacheRead: number,
  output: number,
  long: [number, number, number],
): PriceSeed {
  return {
    input,
    output,
    cacheRead,
    cacheWrite: input * 1.25,
    longContext: {
      threshold: OPENAI_LONG_CONTEXT,
      input: long[0],
      cacheRead: long[1],
      output: long[2],
    },
  };
}

export const PROVIDER_PRICE_SEEDS: Readonly<Record<string, Readonly<Record<string, PriceSeed>>>> = {
  // api-openai G3 (#442), developers.openai.com/api/docs/pricing 2026-11-04.
  openai: {
    'gpt-6-astra': openai(10, 1, 50, [20, 2, 75]),
    'gpt-6.1-sol': openai(2, 0.1, 10, [4, 0.2, 15]),
    'gpt-6.1-terra': openai(1, 0.05, 5, [2, 0.1, 7.5]),
    'gpt-6-sol': openai(2, 0.2, 10, [4, 0.4, 15]),
    'gpt-6-luna': openai(0.1, 0.01, 0.5, [0.2, 0.02, 0.75]),
    'gpt-5.6-sol': openai(4, 0.4, 20, [8, 0.8, 30]),
    'gpt-5.6-terra': openai(2, 0.2, 12, [4, 0.4, 18]),
    'gpt-5.6-luna': openai(0.2, 0.02, 1.2, [0.4, 0.04, 1.8]),
  },
  // api-gemini G8 (#428), aistudio.google.com/docs/pricing 2026-11-04.
  gemini: {
    'gemini-4-argon': {
      input: 2,
      output: 10,
      cacheRead: 0.1,
      scheduled: [{ from: '2026-12-01', input: 4, output: 20, cacheRead: 0.2 }],
    },
    'gemini-3.8-flash': {
      input: 0.75,
      output: 3.75,
      cacheRead: 0.075,
      scheduled: [{ from: '2027-01-01', input: 1.5, output: 7.5, cacheRead: 0.15 }],
    },
    'gemini-3.6-flash': {
      input: 0.75,
      output: 3.75,
      cacheRead: 0.075,
      scheduled: [{ from: '2027-01-01', input: 1.5, output: 7.5, cacheRead: 0.15 }],
    },
    'gemini-3.1-pro-preview': {
      input: 2,
      output: 12,
      longContext: { threshold: 200_000, input: 4, output: 18 },
    },
    // From 2026-12-01 gemini-2.5-pro is served (and billed) as gemini-3.8-flash.
    'gemini-2.5-pro': {
      input: 1.25,
      output: 10,
      scheduled: [
        { from: '2026-12-01', until: '2027-01-01', input: 0.75, output: 3.75, cacheRead: 0.075 },
        { from: '2027-01-01', input: 1.5, output: 7.5, cacheRead: 0.15 },
      ],
    },
  },
  // api-meta G2 (#407), dev.meta.ai/docs/pricing-rate-limits 2026-11-04.
  meta: {
    'muse-wonder-1.0': { input: 4, output: 20, cacheRead: 0.2 },
    'muse-spark-1.3': { input: 1.25, output: 4.25, cacheRead: 0.15 },
    'muse-spark-1.2': { input: 1.25, output: 4.25, cacheRead: 0.15 },
    'muse-spark-1.1': { input: 1.25, output: 4.25, cacheRead: 0.15 },
    'muse-spark-1.3-contributor': { input: 0.1, output: 0.2, cacheRead: 0.002 },
    'muse-spark-1.2-contributor': { input: 0.1, output: 0.2, cacheRead: 0.002 },
  },
  // api-groq G3 (#415), console.groq.com/docs/models 2026-11-04.
  groq: {
    'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
    'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
    'openai/gpt-oss-safeguard-20b': { input: 0.075, output: 0.3 },
    'qwen/qwen3.8-27b': { input: 0.8, output: 4 },
  },
  // api-moonshot G1 (#419), platform.kimi.ai/docs/pricing/chat 2026-11-04
  // (values from aggregators: the official tables do not render).
  moonshot: {
    'kimi-k3': { input: 3, output: 15, cacheRead: 0.3 },
    'kimi-k3.1-pro': { input: 2, output: 10, cacheRead: 0.2 },
    'kimi-k3.1-pro-highspeed': { input: 4, output: 20, cacheRead: 0.4 },
  },
};

const PER_MILLION = 1_000_000;
const perToken = (value: number | undefined): number | null =>
  value === undefined ? null : value / PER_MILLION;

/** The seed for a provider's model, if any. */
export function lookupPriceSeed(providerId: string, modelId: string): PriceSeed | undefined {
  return PROVIDER_PRICE_SEEDS[providerId.toLowerCase()]?.[modelId];
}

/** A seed as a pricing-cache entry. */
export function priceSeedEntry(
  modelId: string,
  providerDisplayName: string,
  seed: PriceSeed,
): PricingEntry {
  const timeTiers: PricingTimeTier[] | null = seed.scheduled?.length
    ? seed.scheduled.map((tier) => ({
        windows: [],
        from: tier.from,
        until: tier.until ?? null,
        input_price_per_token: tier.input / PER_MILLION,
        output_price_per_token: tier.output / PER_MILLION,
        cache_read_price_per_token: perToken(tier.cacheRead),
        cache_write_price_per_token: null,
      }))
    : null;
  return {
    model_name: modelId,
    provider: providerDisplayName,
    input_price_per_token: seed.input / PER_MILLION,
    output_price_per_token: seed.output / PER_MILLION,
    cache_read_price_per_token: perToken(seed.cacheRead),
    cache_write_price_per_token: perToken(seed.cacheWrite),
    time_tiers: timeTiers,
    long_context: seed.longContext
      ? {
          threshold_tokens: seed.longContext.threshold,
          input_price_per_token: seed.longContext.input / PER_MILLION,
          output_price_per_token: seed.longContext.output / PER_MILLION,
          cache_read_price_per_token: perToken(seed.longContext.cacheRead),
        }
      : null,
    display_name: null,
    validated: true,
    source: 'models.dev',
  };
}

/** The seed's price in effect at `at` (dated changes applied), per token. */
export function effectiveSeedPrice(
  seed: PriceSeed,
  at = new Date(),
): { input: number; output: number; cacheRead?: number } {
  const now = at.getTime();
  const tier = seed.scheduled?.find(
    (t) =>
      now >= Date.parse(`${t.from}T00:00:00Z`) &&
      (!t.until || now < Date.parse(`${t.until}T00:00:00Z`)),
  );
  const rate = tier ?? seed;
  return {
    input: rate.input / PER_MILLION,
    output: rate.output / PER_MILLION,
    ...(rate.cacheRead !== undefined ? { cacheRead: rate.cacheRead / PER_MILLION } : {}),
  };
}
