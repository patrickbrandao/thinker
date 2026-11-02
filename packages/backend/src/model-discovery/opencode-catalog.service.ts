import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PROVIDER_BY_ID } from '../common/constants/providers';
import { TenantProvider } from '../entities/tenant-provider.entity';
import { isCatalogSyncEnabled } from '../common/utils/catalog-sync';
import { outboundFetch } from '../common/outbound/outbound-proxy';
import type { PricingEntry, PricingTimeTier } from '../model-prices/model-pricing-cache.service';

export type OpencodeCatalogProvider = 'opencode' | 'opencode-go';

/** Wire protocol a model is served on, named after Thinker's endpoint formats. */
export type OpencodeApiFormat = 'openai' | 'responses' | 'anthropic' | 'google';

export interface OpencodeCatalogEntry {
  /** Bare model id (e.g. "glm-5.3-flash"). */
  id: string;
  name: string;
  format: OpencodeApiFormat;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  reasoning: boolean;
  tools: boolean;
  inputModalities: string[];
  inputPricePerToken: number | null;
  outputPricePerToken: number | null;
  cacheReadPricePerToken: number | null;
  cacheWritePricePerToken: number | null;
  /** Peak-hour bands from the catalog `multipliers` (base prices × factor). */
  timeTiers: PricingTimeTier[] | null;
  /** No input or output price: served without a key on `opencode`. */
  free: boolean;
}

/**
 * The provider's own public catalog: model list, wire protocol, base URL and
 * list prices, no auth. Same host as inference, so it is provider traffic,
 * not a phone-home (ADR 0009).
 */
export const OPENCODE_CATALOG_URLS: Record<OpencodeCatalogProvider, string> = {
  opencode: 'https://opencode.ai/inference/v1/models',
  'opencode-go': 'https://opencode.ai/inference/go/v1/models',
};

const CACHE_TTL_MS = 60 * 60 * 1000;
// After a fetch failure we reuse the last-known-good list for a shorter window
// so a sustained outage does not turn into a per-call retry storm.
const ERROR_BACKOFF_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

// Catalog `api` keys in the order a model offering several is routed.
const API_FORMATS: [string, OpencodeApiFormat][] = [
  ['chat-completions', 'openai'],
  ['responses', 'responses'],
  ['messages', 'anthropic'],
  ['generate-content', 'google'],
];

const ISO_DAYS: Record<string, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

/** Every spelling a `tenant_providers.provider` row can carry, lowercased. */
const PROVIDER_KEYS: Record<OpencodeCatalogProvider, string[]> = {
  opencode: ['opencode', ...(PROVIDER_BY_ID.get('opencode')?.aliases ?? [])],
  'opencode-go': ['opencode-go', ...(PROVIDER_BY_ID.get('opencode-go')?.aliases ?? [])],
};

/** Canonical OpenCode catalog for a provider id or alias, if it is one. */
export function opencodeCatalogProvider(
  provider: string | null | undefined,
): OpencodeCatalogProvider | null {
  if (!provider) return null;
  const lower = provider.toLowerCase();
  for (const key of Object.keys(PROVIDER_KEYS) as OpencodeCatalogProvider[]) {
    if (PROVIDER_KEYS[key].includes(lower)) return key;
  }
  return null;
}

interface CatalogState {
  cache: { entries: OpencodeCatalogEntry[]; expiresAt: number } | null;
  lastGood: OpencodeCatalogEntry[] | null;
  byId: Map<string, OpencodeCatalogEntry>;
  inflight: Promise<OpencodeCatalogEntry[]> | null;
}

/**
 * Model catalogs of OpenCode (pay-as-you-go and free models) and OpenCode Go,
 * read from `opencode.ai/inference[/go]/v1/models` and cached for an hour.
 * They decide the wire protocol of each model, the list prices with their
 * peak-hour multipliers, and which models are free.
 *
 * A catalog is fetched only for an instance that has that provider
 * registered: every caller but the boot warmup is already scoped to such a
 * provider, and the warmup checks the database first (and is skipped with
 * `THINKER_CATALOG_SYNC=false`).
 */
@Injectable()
export class OpencodeCatalogService implements OnModuleInit {
  private readonly logger = new Logger(OpencodeCatalogService.name);
  private readonly states: Record<OpencodeCatalogProvider, CatalogState> = {
    opencode: emptyState(),
    'opencode-go': emptyState(),
  };

  constructor(
    @Optional()
    @Inject(getRepositoryToken(TenantProvider))
    private readonly providerRepo: Repository<TenantProvider> | null = null,
  ) {}

  /**
   * Warm the registered catalogs in the background so the first proxied
   * request already knows its protocol and price. Fire-and-forget; failures
   * fall through to the fetch-on-demand path in `list()`.
   */
  onModuleInit(): void {
    for (const provider of Object.keys(this.states) as OpencodeCatalogProvider[]) {
      void this.warmIfRegistered(provider).catch(() => {
        // `list()` already logs failures and arms the error-backoff window.
      });
    }
  }

  private async warmIfRegistered(provider: OpencodeCatalogProvider): Promise<void> {
    // `THINKER_CATALOG_SYNC=false` keeps the boot silent; the catalog then
    // loads on the provider's first use, like any provider's /models.
    if (!isCatalogSyncEnabled()) return;
    if (!(await this.isRegistered(provider))) return;
    await this.list(provider);
  }

  /**
   * Whether any tenant has this provider registered, active or not. Without
   * a repository (unit tests) or when the lookup fails, answers false: a
   * skipped warmup only delays the catalog to its first real use.
   */
  private async isRegistered(provider: OpencodeCatalogProvider): Promise<boolean> {
    if (!this.providerRepo) return false;
    try {
      const count = await this.providerRepo
        .createQueryBuilder('p')
        .where('LOWER(p.provider) IN (:...keys)', { keys: PROVIDER_KEYS[provider] })
        .getCount();
      return count > 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not check for ${provider} providers, skipping warmup: ${message}`);
      return false;
    }
  }

  /** The cached catalog, fetching it when the cache is cold or expired. */
  async list(provider: OpencodeCatalogProvider): Promise<OpencodeCatalogEntry[]> {
    const state = this.states[provider];
    const now = Date.now();
    if (state.cache && state.cache.expiresAt > now) return state.cache.entries;
    if (state.inflight) return state.inflight;
    return this.startFetch(provider, now);
  }

  /** Force a live fetch even when the cache is warm (manual model refresh). */
  async refresh(provider: OpencodeCatalogProvider): Promise<OpencodeCatalogEntry[]> {
    return this.startFetch(provider, Date.now());
  }

  /**
   * Catalog entry for a model id, bare (`glm-5.3`) or prefixed
   * (`opencode-go/glm-5.3`). Waits on the first fetch of a cold catalog.
   */
  async resolve(
    provider: OpencodeCatalogProvider,
    modelId: string | null | undefined,
  ): Promise<OpencodeCatalogEntry | null> {
    const bare = bareModelId(modelId);
    if (!bare) return null;
    const state = this.states[provider];
    if (state.byId.size === 0) await this.list(provider);
    return state.byId.get(bare) ?? null;
  }

  async resolveFormat(
    provider: OpencodeCatalogProvider,
    modelId: string | null | undefined,
  ): Promise<OpencodeApiFormat | null> {
    return (await this.resolve(provider, modelId))?.format ?? null;
  }

  /** List prices of a model as a pricing entry the cost calculator accepts. */
  async resolvePricing(
    provider: OpencodeCatalogProvider,
    modelId: string | null | undefined,
  ): Promise<PricingEntry | undefined> {
    const entry = await this.resolve(provider, modelId);
    if (!entry || entry.inputPricePerToken == null || entry.outputPricePerToken == null) {
      return undefined;
    }
    return {
      model_name: entry.id,
      provider,
      input_price_per_token: entry.inputPricePerToken,
      output_price_per_token: entry.outputPricePerToken,
      cache_read_price_per_token: entry.cacheReadPricePerToken,
      cache_write_price_per_token: entry.cacheWritePricePerToken,
      time_tiers: entry.timeTiers,
      display_name: entry.name,
    };
  }

  /**
   * How an OpenCode request is priced, or null for any other provider.
   * OpenCode bills list price (its `usage.cost`, when reported, still wins).
   * OpenCode Go is a subscription whose quota is metered in dollars at list
   * price, so it records that equivalent and ignores the reported cost, which
   * is $0 inside the allowance.
   */
  async costInputs(
    provider: string | null | undefined,
    model: string | null | undefined,
  ): Promise<{ pricing: PricingEntry | undefined; ignoreReportedCost: boolean } | null> {
    const catalog = opencodeCatalogProvider(provider);
    if (!catalog) return null;
    return {
      pricing: await this.resolvePricing(catalog, model).catch(() => undefined),
      ignoreReportedCost: catalog === 'opencode-go',
    };
  }

  private startFetch(
    provider: OpencodeCatalogProvider,
    now: number,
  ): Promise<OpencodeCatalogEntry[]> {
    const state = this.states[provider];
    const tracked: Promise<OpencodeCatalogEntry[]> = this.fetchAndCache(provider, now).finally(
      () => {
        if (state.inflight === tracked) state.inflight = null;
      },
    );
    state.inflight = tracked;
    return tracked;
  }

  private async fetchAndCache(
    provider: OpencodeCatalogProvider,
    now: number,
  ): Promise<OpencodeCatalogEntry[]> {
    const state = this.states[provider];
    const url = OPENCODE_CATALOG_URLS[provider];
    try {
      const response = await outboundFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        this.logger.warn(`${provider} catalog fetch returned ${response.status}`);
        return this.cacheFallback(state, now);
      }
      const entries = parseOpencodeCatalog(await response.json());
      if (entries.length === 0) {
        this.logger.warn(`${provider} catalog parsed zero models — format may have changed`);
        return this.cacheFallback(state, now);
      }
      state.cache = { entries, expiresAt: now + CACHE_TTL_MS };
      state.lastGood = entries;
      state.byId = new Map(entries.map((entry) => [entry.id, entry]));
      this.logger.log(`${provider} catalog loaded: ${entries.length} models`);
      return entries;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${provider} catalog fetch failed: ${message}`);
      return this.cacheFallback(state, now);
    }
  }

  private cacheFallback(state: CatalogState, now: number): OpencodeCatalogEntry[] {
    const entries = state.lastGood ?? [];
    state.cache = { entries, expiresAt: now + ERROR_BACKOFF_MS };
    return entries;
  }

  /** Test hook: clear in-memory state. */
  resetCache(): void {
    this.states.opencode = emptyState();
    this.states['opencode-go'] = emptyState();
  }
}

function emptyState(): CatalogState {
  return { cache: null, lastGood: null, byId: new Map(), inflight: null };
}

function bareModelId(modelId: string | null | undefined): string | null {
  if (!modelId) return null;
  const slash = modelId.indexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

/* ── Catalog parsing ─────────────────────────────── */

interface RawPrice {
  price?: number;
  cache?: { read?: number; write?: number };
}

interface RawCondition {
  utc_days?: { in?: string[] };
  utc_hours?: { gte?: string; lt?: string };
  any?: RawCondition[];
  all?: RawCondition[];
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  modalities?: { input?: unknown };
  capabilities?: { tools?: { supported?: boolean }; reasoning?: { supported?: boolean } };
  limit?: { context?: unknown; output?: unknown };
  cost?: {
    text?: { input?: RawPrice; output?: RawPrice };
    multipliers?: { when?: RawCondition; factor?: unknown }[];
  };
  api?: Record<string, unknown>;
}

/** Parse a `/inference[/go]/v1/models` body; skips non-chat and unroutable models. */
export function parseOpencodeCatalog(body: unknown): OpencodeCatalogEntry[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const entries: OpencodeCatalogEntry[] = [];
  for (const raw of data as RawModel[]) {
    if (typeof raw?.id !== 'string' || !raw.id) continue;
    if (raw.type !== undefined && raw.type !== 'chat') continue;
    const format = API_FORMATS.find(([key]) => raw.api && key in raw.api)?.[1];
    if (!format) continue;
    const input = perToken(raw.cost?.text?.input?.price);
    const output = perToken(raw.cost?.text?.output?.price);
    const cacheRead = perToken(raw.cost?.text?.input?.cache?.read);
    const cacheWrite = perToken(raw.cost?.text?.input?.cache?.write);
    entries.push({
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id,
      format,
      contextWindow: positiveInt(raw.limit?.context),
      maxOutputTokens: positiveInt(raw.limit?.output),
      reasoning: raw.capabilities?.reasoning?.supported === true,
      tools: raw.capabilities?.tools?.supported !== false,
      inputModalities: Array.isArray(raw.modalities?.input)
        ? (raw.modalities.input as unknown[]).filter((m): m is string => typeof m === 'string')
        : ['text'],
      inputPricePerToken: input,
      outputPricePerToken: output,
      cacheReadPricePerToken: cacheRead,
      cacheWritePricePerToken: cacheWrite,
      timeTiers: parseMultipliers(raw.cost?.multipliers, input, output, cacheRead, cacheWrite),
      free: input === 0 && output === 0,
    });
  }
  return entries;
}

function perToken(perMillion: unknown): number | null {
  return typeof perMillion === 'number' && Number.isFinite(perMillion) && perMillion >= 0
    ? perMillion / 1_000_000
    : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Turn catalog multipliers (`{when: {utc_days, any: [{all: [{utc_hours}]}]},
 * factor}`) into time tiers priced at base × factor. A condition the tier
 * shape cannot express is skipped, leaving the base price.
 */
function parseMultipliers(
  multipliers: { when?: RawCondition; factor?: unknown }[] | undefined,
  input: number | null,
  output: number | null,
  cacheRead: number | null,
  cacheWrite: number | null,
): PricingTimeTier[] | null {
  if (!Array.isArray(multipliers)) return null;
  const scale = (price: number | null, factor: number) => (price == null ? null : price * factor);
  const tiers: PricingTimeTier[] = [];
  for (const multiplier of multipliers) {
    const factor = multiplier.factor;
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) continue;
    const when = multiplier.when ?? {};
    const days = (when.utc_days?.in ?? [])
      .map((day) => ISO_DAYS[day.toLowerCase()])
      .filter((day): day is number => day !== undefined);
    const windows = (when.any ?? [when])
      .map((clause) => hoursWindow(clause.all ?? [clause]))
      .filter((window): window is string => window !== null);
    if (windows.length === 0) continue;
    tiers.push({
      windows,
      days: days.length ? days : null,
      input_price_per_token: scale(input, factor),
      output_price_per_token: scale(output, factor),
      cache_read_price_per_token: scale(cacheRead, factor),
      cache_write_price_per_token: scale(cacheWrite, factor),
    });
  }
  return tiers.length ? tiers : null;
}

/** `HH:MM-HH:MM` from `utc_hours` bounds; an open end runs to midnight. */
function hoursWindow(conditions: RawCondition[]): string | null {
  let start: string | undefined;
  let end: string | undefined;
  for (const condition of conditions) {
    start = condition.utc_hours?.gte ?? start;
    end = condition.utc_hours?.lt ?? end;
  }
  if (!start && !end) return null;
  return `${start ?? '00:00'}-${end ?? '00:00'}`;
}
