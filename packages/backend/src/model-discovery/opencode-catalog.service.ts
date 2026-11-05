import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PROVIDER_BY_ID } from '../common/constants/providers';
import { TenantProvider } from '../entities/tenant-provider.entity';
import { isCatalogSyncEnabled } from '../common/utils/catalog-sync';
import { outboundFetch } from '../common/outbound/outbound-proxy';
import { OPENCODE_USER_AGENT } from '../common/constants/subscription-clients';
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
  /** Long-context band from the catalog `overrides` (`when.context.gt`). */
  longContext?: PricingEntry['long_context'];
  /** No input or output price: served without a key on `opencode`. */
  free: boolean;
}

/**
 * The catalog the OpenCode client reads (`anomalyco/opencode`,
 * packages/core/src/models-dev.ts): models.dev v2 as published by OpenCode,
 * limited to the model types the client keeps. One document covers every
 * provider, `opencode` and `opencode-go` included, with each model's protocol,
 * base URL and list prices. Fetched only while an OpenCode account exists
 * (ADR 0009), and never with `THINKER_CATALOG_SYNC=false`.
 */
export const OPENCODE_MODELS_URL =
  'https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image';

/**
 * The provider's per-service catalogs on the inference host. Same model
 * records as `OPENCODE_MODELS_URL`, one provider each. Used only when that
 * source is off (`THINKER_CATALOG_SYNC=false`) or has never answered: the
 * inference host is provider traffic, so protocol routing keeps working.
 */
export const OPENCODE_CATALOG_URLS: Record<OpencodeCatalogProvider, string> = {
  opencode: 'https://opencode.ai/inference/v1/models',
  'opencode-go': 'https://opencode.ai/inference/go/v1/models',
};

/** The client's refresh cadence and freshness window for its catalog. */
export const OPENCODE_CATALOG_REFRESH_MS = 5 * 60 * 1000;
const LEGACY_CACHE_TTL_MS = 60 * 60 * 1000;
// After a fetch failure we reuse the last-known-good list for a shorter window
// so a sustained outage does not turn into a per-call retry storm.
const ERROR_BACKOFF_MS = 5 * 60 * 1000;
/** The client gives the whole fetch, retries and body included, 10 s. */
const FETCH_TIMEOUT_MS = 10_000;
/** The client retries transient errors and responses twice, exponential from 200 ms with jitter. */
const FETCH_RETRIES = 2;
const RETRY_BASE_MS = 200;
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// Catalog `api` keys and the endpoint format each is served on.
const API_FORMATS: Record<string, OpencodeApiFormat> = {
  'chat-completions': 'openai',
  responses: 'responses',
  messages: 'anthropic',
  'generate-content': 'google',
};

const ISO_DAYS: Record<string, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

const CATALOG_PROVIDERS: OpencodeCatalogProvider[] = ['opencode', 'opencode-go'];

/** Every spelling a `tenant_providers.provider` row can carry, lowercased. */
const PROVIDER_KEYS: Record<OpencodeCatalogProvider, string[]> = {
  opencode: ['opencode', ...(PROVIDER_BY_ID.get('opencode')?.aliases ?? [])],
  'opencode-go': ['opencode-go', ...(PROVIDER_BY_ID.get('opencode-go')?.aliases ?? [])],
};

/** Every `tenant_providers.provider` spelling of an OpenCode provider, lowercased. */
export const OPENCODE_PROVIDER_KEYS: readonly string[] = [
  ...PROVIDER_KEYS.opencode,
  ...PROVIDER_KEYS['opencode-go'],
];

/** Canonical OpenCode catalog for a provider id or alias, if it is one. */
export function opencodeCatalogProvider(
  provider: string | null | undefined,
): OpencodeCatalogProvider | null {
  if (!provider) return null;
  const lower = provider.toLowerCase();
  for (const key of CATALOG_PROVIDERS) {
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

/** The shared models.opencode.ai document: one fetch serves both providers. */
interface SharedState {
  etag: string | null;
  /** Last 200 or 304: the copy is current as of then. */
  checkedAt: number;
  /** No retry before this after a failure. */
  retryAt: number;
  inflight: Promise<boolean> | null;
}

/**
 * Model catalogs of OpenCode (pay-as-you-go and free models) and OpenCode Go.
 * They decide the wire protocol of each model, the list prices with their
 * peak-hour multipliers, and which models are free.
 *
 * Like the OpenCode client, the source is the models.dev v2 document on
 * models.opencode.ai, fetched with the client's User-Agent and ETag, a 10 s
 * budget and two retries, and re-checked every 5 minutes in the background,
 * but only while an active OpenCode account (any type) exists. One fetch per
 * instance feeds both providers. With `THINKER_CATALOG_SYNC=false` that
 * domain is never contacted and each catalog loads on the provider's first
 * use from its own inference host, like any provider's /models.
 */
@Injectable()
export class OpencodeCatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpencodeCatalogService.name);
  private states: Record<OpencodeCatalogProvider, CatalogState> = {
    opencode: emptyState(),
    'opencode-go': emptyState(),
  };
  private shared: SharedState = emptySharedState();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    @Optional()
    @Inject(getRepositoryToken(TenantProvider))
    private readonly providerRepo: Repository<TenantProvider> | null = null,
  ) {}

  /**
   * Start the background refresh: once at boot, then 5 minutes after each
   * run completes (the client's `Schedule.spaced`). Each run fetches only
   * while an active OpenCode account exists. Off with `THINKER_CATALOG_SYNC=false`.
   */
  onModuleInit(): void {
    if (!isCatalogSyncEnabled()) return;
    void this.backgroundRefresh();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** One background run; exported for tests. Never throws. */
  async backgroundRefresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      if (isCatalogSyncEnabled() && (await this.hasActiveAccount())) {
        await this.syncShared(false);
      }
    } catch (err) {
      // syncShared logs its own failures; this only guards the timer chain.
      this.logger.debug(`OpenCode catalog background refresh failed: ${errorMessage(err)}`);
    } finally {
      if (!this.destroyed) {
        this.timer = setTimeout(() => void this.backgroundRefresh(), OPENCODE_CATALOG_REFRESH_MS);
        this.timer.unref?.();
      }
    }
  }

  /**
   * Whether any tenant has an active OpenCode or OpenCode Go connection.
   * Without a repository (unit tests) or when the lookup fails, answers
   * false: a skipped run only delays the catalog to its first real use.
   */
  private async hasActiveAccount(): Promise<boolean> {
    if (!this.providerRepo) return false;
    try {
      const count = await this.providerRepo
        .createQueryBuilder('p')
        .where('LOWER(p.provider) IN (:...keys)', { keys: OPENCODE_PROVIDER_KEYS })
        .andWhere('p.is_active = :active', { active: true })
        .getCount();
      return count > 0;
    } catch (err) {
      this.logger.warn(`Could not check for OpenCode providers: ${errorMessage(err)}`);
      return false;
    }
  }

  /** The cached catalog, fetching it when the cache is cold or expired. */
  async list(provider: OpencodeCatalogProvider): Promise<OpencodeCatalogEntry[]> {
    const state = this.states[provider];
    if (state.cache && state.cache.expiresAt > Date.now()) return state.cache.entries;
    if (state.inflight) return state.inflight;
    return this.startFetch(provider, false);
  }

  /** Force a live check even when the cache is warm (manual model refresh). */
  async refresh(provider: OpencodeCatalogProvider): Promise<OpencodeCatalogEntry[]> {
    return this.startFetch(provider, true);
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
      long_context: entry.longContext ?? null,
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
    force: boolean,
  ): Promise<OpencodeCatalogEntry[]> {
    const state = this.states[provider];
    const tracked: Promise<OpencodeCatalogEntry[]> = this.load(provider, force).finally(() => {
      if (state.inflight === tracked) state.inflight = null;
    });
    state.inflight = tracked;
    return tracked;
  }

  /**
   * models.opencode.ai first; the inference host only when that source is
   * off, or failed with no copy of this provider to keep.
   */
  private async load(
    provider: OpencodeCatalogProvider,
    force: boolean,
  ): Promise<OpencodeCatalogEntry[]> {
    const state = this.states[provider];
    if (isCatalogSyncEnabled()) {
      const current = await this.syncShared(force);
      if (current && state.cache) return state.cache.entries;
      if (state.lastGood) return this.cacheFallback(state, Date.now());
    }
    return this.fetchLegacy(provider);
  }

  /**
   * Bring the shared copy up to date: a conditional GET unless it was
   * checked within the refresh window (or `force`), single-flight across
   * providers. Resolves true when the copy is current (200 or 304).
   */
  private syncShared(force: boolean): Promise<boolean> {
    const shared = this.shared;
    if (shared.inflight) return shared.inflight;
    const now = Date.now();
    if (!force && shared.checkedAt > 0 && now - shared.checkedAt < OPENCODE_CATALOG_REFRESH_MS) {
      return Promise.resolve(true);
    }
    if (!force && now < shared.retryAt) return Promise.resolve(false);
    const tracked = this.fetchShared().finally(() => {
      if (shared.inflight === tracked) shared.inflight = null;
    });
    shared.inflight = tracked;
    return tracked;
  }

  private async fetchShared(): Promise<boolean> {
    const shared = this.shared;
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const etag = shared.etag && this.hasSharedCopy() ? shared.etag : null;
    const headers = {
      'user-agent': OPENCODE_USER_AGENT,
      ...(etag ? { 'if-none-match': etag } : {}),
    };
    try {
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await outboundFetch(OPENCODE_MODELS_URL, { headers, signal });
        } catch (err) {
          if (signal.aborted || attempt >= FETCH_RETRIES) throw err;
          await retryDelay(attempt, signal);
          continue;
        }
        if (response.status === 304) {
          this.markSharedCurrent(etag);
          return true;
        }
        if (response.ok) return this.applyShared(await response.text(), response);
        void response.body?.cancel().catch(() => undefined);
        if (!TRANSIENT_STATUSES.has(response.status) || attempt >= FETCH_RETRIES) {
          throw new Error(`returned ${response.status}`);
        }
        await retryDelay(attempt, signal);
      }
    } catch (err) {
      this.logger.warn(
        `OpenCode catalog fetch from models.opencode.ai failed: ${errorMessage(err)}`,
      );
      shared.retryAt = Date.now() + ERROR_BACKOFF_MS;
      return false;
    }
  }

  private applyShared(text: string, response: Response): boolean {
    const now = Date.now();
    let parsed: Record<OpencodeCatalogProvider, OpencodeCatalogEntry[]>;
    try {
      parsed = parseOpencodeModelsDev(JSON.parse(text));
    } catch {
      throw new Error('returned an unreadable body');
    }
    if (parsed.opencode.length === 0 && parsed['opencode-go'].length === 0) {
      throw new Error('parsed zero OpenCode models — format may have changed');
    }
    for (const provider of CATALOG_PROVIDERS) {
      const entries = parsed[provider];
      if (entries.length === 0) {
        this.logger.warn(`${provider} is missing from the models.opencode.ai catalog`);
        continue;
      }
      this.store(provider, entries, now + OPENCODE_CATALOG_REFRESH_MS);
    }
    this.shared.etag = response.headers?.get('etag') ?? null;
    this.shared.checkedAt = now;
    this.shared.retryAt = 0;
    this.logger.log(
      `OpenCode catalog loaded from models.opencode.ai: ${parsed.opencode.length} opencode, ` +
        `${parsed['opencode-go'].length} opencode-go models`,
    );
    return true;
  }

  /** A 304: the copy in memory is still the current one. */
  private markSharedCurrent(etag: string | null): void {
    const now = Date.now();
    this.shared.etag = etag;
    this.shared.checkedAt = now;
    this.shared.retryAt = 0;
    for (const provider of CATALOG_PROVIDERS) {
      const state = this.states[provider];
      if (state.lastGood)
        state.cache = { entries: state.lastGood, expiresAt: now + OPENCODE_CATALOG_REFRESH_MS };
    }
  }

  /** An ETag is only worth sending while that copy is still in memory. */
  private hasSharedCopy(): boolean {
    return CATALOG_PROVIDERS.some((provider) => this.states[provider].lastGood !== null);
  }

  private store(
    provider: OpencodeCatalogProvider,
    entries: OpencodeCatalogEntry[],
    expiresAt: number,
  ) {
    const state = this.states[provider];
    state.cache = { entries, expiresAt };
    state.lastGood = entries;
    state.byId = new Map(entries.map((entry) => [entry.id, entry]));
  }

  /** The provider's own catalog on its inference host (see `OPENCODE_CATALOG_URLS`). */
  private async fetchLegacy(provider: OpencodeCatalogProvider): Promise<OpencodeCatalogEntry[]> {
    const state = this.states[provider];
    const now = Date.now();
    try {
      const response = await outboundFetch(OPENCODE_CATALOG_URLS[provider], {
        headers: { 'user-agent': OPENCODE_USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`${provider} catalog fetch returned ${response.status}`);
        return this.cacheFallback(state, now);
      }
      const entries = parseOpencodeCatalog(await response.json());
      if (entries.length === 0) {
        this.logger.warn(`${provider} catalog parsed zero models — format may have changed`);
        return this.cacheFallback(state, now);
      }
      this.store(provider, entries, now + LEGACY_CACHE_TTL_MS);
      this.logger.log(`${provider} catalog loaded: ${entries.length} models`);
      return entries;
    } catch (err) {
      this.logger.warn(`${provider} catalog fetch failed: ${errorMessage(err)}`);
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
    this.states = { opencode: emptyState(), 'opencode-go': emptyState() };
    this.shared = emptySharedState();
  }
}

function emptyState(): CatalogState {
  return { cache: null, lastGood: null, byId: new Map(), inflight: null };
}

function emptySharedState(): SharedState {
  return { etag: null, checkedAt: 0, retryAt: 0, inflight: null };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Exponential from 200 ms with ±20 % jitter, cut short by the fetch budget. */
function retryDelay(attempt: number, signal: AbortSignal): Promise<void> {
  const ms = RETRY_BASE_MS * 2 ** attempt * (0.8 + Math.random() * 0.4);
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
  });
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
  /** Context-band prices (`when.context.gt`), api-opencode G1. */
  overrides?: {
    when?: { context?: { gt?: unknown } };
    price?: number;
    cache?: { read?: number; write?: number };
  }[];
}

interface RawCondition {
  /** Dated multiplier (`date.gte` / `date.lt`, ISO dates), api-opencode G2. */
  date?: { gte?: string; lt?: string };
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

/**
 * Parse a models.dev v2 document (`OPENCODE_MODELS_URL`): a record of
 * providers, each with a `models` record. Only `opencode` and `opencode-go`
 * are read; their model records have the same shape as the inference-host
 * catalogs.
 */
export function parseOpencodeModelsDev(
  body: unknown,
): Record<OpencodeCatalogProvider, OpencodeCatalogEntry[]> {
  const read = (provider: OpencodeCatalogProvider): OpencodeCatalogEntry[] => {
    const models = (body as Record<string, { models?: unknown } | undefined> | null)?.[provider]
      ?.models;
    if (!models || typeof models !== 'object' || Array.isArray(models)) return [];
    return parseModels(Object.values(models as Record<string, unknown>));
  };
  return { opencode: read('opencode'), 'opencode-go': read('opencode-go') };
}

/** Parse a `/inference[/go]/v1/models` body; skips non-chat and unroutable models. */
export function parseOpencodeCatalog(body: unknown): OpencodeCatalogEntry[] {
  const data = (body as { data?: unknown })?.data;
  return Array.isArray(data) ? parseModels(data) : [];
}

function parseModels(models: unknown[]): OpencodeCatalogEntry[] {
  const entries: OpencodeCatalogEntry[] = [];
  for (const raw of models as RawModel[]) {
    if (typeof raw?.id !== 'string' || !raw.id) continue;
    if (raw.type !== undefined && raw.type !== 'chat') continue;
    // Like the client, the first API listed is the model's default; take the
    // first one Thinker has an endpoint for.
    const format = Object.keys(raw.api ?? {})
      .map((key) => API_FORMATS[key])
      .find((value): value is OpencodeApiFormat => value !== undefined);
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
      longContext: parseOverrides(raw.cost?.text?.input, raw.cost?.text?.output),
      free: input === 0 && output === 0,
    });
  }
  return entries;
}

/**
 * The first context band of the catalog `overrides`: prices for the whole
 * request once the prompt exceeds `when.context.gt` tokens. Output may carry
 * its own band at the same threshold.
 */
function parseOverrides(
  input: RawPrice | undefined,
  output: RawPrice | undefined,
): PricingEntry['long_context'] {
  const band = (input?.overrides ?? []).find(
    (o) => typeof o?.when?.context?.gt === 'number' && typeof o.price === 'number',
  );
  if (!band) return null;
  const threshold = band.when!.context!.gt as number;
  const outputBand = (output?.overrides ?? []).find((o) => o?.when?.context?.gt === threshold);
  const inputPrice = perToken(band.price);
  const outputPrice = perToken(outputBand?.price ?? output?.price);
  if (inputPrice == null || outputPrice == null) return null;
  return {
    threshold_tokens: threshold,
    input_price_per_token: inputPrice,
    output_price_per_token: outputPrice,
    cache_read_price_per_token: perToken(band.cache?.read ?? input?.cache?.read),
    cache_write_price_per_token: perToken(band.cache?.write ?? input?.cache?.write),
  };
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
    const from = when.date?.gte ?? null;
    const until = when.date?.lt ?? null;
    // A dated multiplier (no hours) applies all day from its date.
    if (windows.length === 0 && !from && !until) continue;
    tiers.push({
      windows,
      ...(from ? { from } : {}),
      ...(until ? { until } : {}),
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
