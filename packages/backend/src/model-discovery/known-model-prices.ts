/**
 * Hand-curated, per-provider authoritative pricing.
 *
 * **Priority:** entries here win over models.dev and the OpenRouter cache
 * during model discovery. The reason: the same model id can exist on
 * multiple inference providers at different prices (e.g. `qwen/qwen3-32b`
 * appears in Qwen's OR listing at one price and is also served by Groq at
 * a different price), and a connection's reported pricing must reflect
 * *that connection's provider*, not whatever is cheapest in upstream
 * catalogs.
 *
 * Keep this list minimal. Add an entry only when:
 *  1. The provider's native API does not return pricing, AND
 *  2. The model id either isn't in upstream catalogs, OR is in them under
 *     a different inference provider with different pricing.
 *
 * Prices are per-token (not per-million).
 *
 * Sources:
 *  - Moonshot v1: https://platform.moonshot.cn/docs/pricing (¥12/1M ≈ $1.66/1M at 2025 rates)
 *  - gemma-3-1b-it: Free on Google AI Studio
 */

import { effectiveSeedPrice, lookupPriceSeed } from '../model-prices/provider-price-seeds';

interface KnownPrice {
  input: number;
  output: number;
  cacheRead?: number;
}

const PER_MILLION = 1_000_000;

/**
 * Map of model ID prefixes → per-token pricing.
 * Prefix matching allows one entry to cover multiple context-window variants
 * (e.g. "moonshot-v1-" covers moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k).
 */
const KNOWN_PRICES: ReadonlyArray<{ prefix: string; price: KnownPrice }> = [
  { prefix: 'moonshot-v1-', price: { input: 1.66 / PER_MILLION, output: 1.66 / PER_MILLION } },
  { prefix: 'gemma-3-1b-it', price: { input: 0, output: 0 } },
];

/**
 * Curated price for a model: the provider's own seed first (exact id, dated
 * changes applied, see model-prices/provider-price-seeds.ts), then the
 * provider-agnostic prefixes above.
 */
export function lookupKnownPrice(modelId: string, providerId?: string): KnownPrice | null {
  const seed = providerId ? lookupPriceSeed(providerId, modelId) : undefined;
  if (seed) return effectiveSeedPrice(seed);
  for (const entry of KNOWN_PRICES) {
    if (modelId.startsWith(entry.prefix) || modelId === entry.prefix) {
      return entry.price;
    }
  }
  return null;
}
