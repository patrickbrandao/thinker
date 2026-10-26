import { createKeyv } from 'cacheable';
// `@nestjs/cache-manager` 12 is ESM-only, so its typings resolve keyv through
// the `import` condition while this CommonJS build resolves it through
// `require`: the same Keyv class is declared twice and TypeScript treats the two
// as unrelated. Name the store with the ESM-side declaration that CacheModule
// expects; at runtime there is a single object, which CacheModule accepts by
// duck typing (`isKeyvInstance`), not `instanceof`.
import type { Keyv } from 'cacheable' with { 'resolution-mode': 'import' };
import {
  DASHBOARD_CACHE_MAX_ENTRIES,
  DASHBOARD_CACHE_SWEEP_MS,
  DASHBOARD_CACHE_TTL_MS,
} from '../constants/cache.constants';

/**
 * Builds the bounded in-memory store for the global response cache
 * (`CacheModule`).
 *
 * cache-manager@7's default store is an unbounded `Keyv` Map with lazy-only
 * expiry: it has no size cap and never sweeps, so an entry is dropped only when
 * its exact key is read again. The dashboard interceptors key by full request
 * URL, so high-cardinality query strings (ranges, cursors, filters, timestamps)
 * are written once and rarely re-read with an identical URL — their entries are
 * never evicted and heap climbs monotonically across the process lifetime.
 *
 * `createKeyv` returns a `Keyv` backed by `CacheableMemory`, adding a hard LRU
 * cap (`lruSize`) plus an active, `unref`'d sweep of expired entries
 * (`checkInterval`). Using the helper (rather than a hand-built `new Keyv()`)
 * yields a full `Keyv` instance that `@nestjs/cache-manager` recognises and
 * uses as-is instead of wrapping it in a fresh, unbounded `Keyv`.
 */
export function buildDashboardCacheStore(): Keyv {
  const store = createKeyv({
    ttl: DASHBOARD_CACHE_TTL_MS,
    lruSize: DASHBOARD_CACHE_MAX_ENTRIES,
    checkInterval: DASHBOARD_CACHE_SWEEP_MS,
  });
  return store as unknown as Keyv;
}
