import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build-time pricing snapshot (#73): the OpenRouter and models.dev catalogs as
 * of the day the image was built, written to `dist/pricing-snapshot.json` by
 * `docker/pricing-snapshot.mjs`. The catalog syncs fall back to it when
 * THINKER_CATALOG_SYNC=false or when their startup fetch fails, so request
 * costs stay priced (if dated) instead of NULL. Absent outside the image.
 */
export interface PricingSnapshot {
  generatedAt: Date;
  /** OpenRouter `/api/v1/models` entries, trimmed to the fields the sync reads. */
  openrouter: unknown[];
  /** models.dev `api.json`, trimmed the same way. */
  modelsDev: Record<string, unknown>;
}

export const DEFAULT_PRICING_SNAPSHOT_PATH = join(__dirname, '..', 'pricing-snapshot.json');

let cached: { path: string; snapshot: PricingSnapshot | null } | undefined;

/** Reads the snapshot once per path; null when it is missing or unreadable. */
export function loadPricingSnapshot(
  path: string = DEFAULT_PRICING_SNAPSHOT_PATH,
): PricingSnapshot | null {
  if (cached?.path === path) return cached.snapshot;
  let snapshot: PricingSnapshot | null = null;
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as {
        generatedAt?: string;
        openrouter?: unknown;
        modelsDev?: unknown;
      };
      const generatedAt = new Date(raw.generatedAt ?? '');
      if (
        !Number.isNaN(generatedAt.getTime()) &&
        Array.isArray(raw.openrouter) &&
        raw.modelsDev &&
        typeof raw.modelsDev === 'object'
      ) {
        snapshot = {
          generatedAt,
          openrouter: raw.openrouter,
          modelsDev: raw.modelsDev as Record<string, unknown>,
        };
      }
    }
  } catch {
    snapshot = null;
  }
  cached = { path, snapshot };
  return snapshot;
}
