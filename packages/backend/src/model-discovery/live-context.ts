import { Injectable, Logger } from '@nestjs/common';
import type { DiscoveredModel } from './model-fetcher';
import { ssrfSafeFetch } from '../common/utils/ssrf-safe-fetch';

/**
 * Live `n_ctx` of llama.cpp servers (report from NOC Norte, P7). The
 * registered context window is read once, at probe time; when the operator
 * restarts llama-server with another `-c` or GGUF, the catalog keeps the old
 * value. This reads `GET /props` → `default_generation_settings.n_ctx` and
 * publishes `min(registered, live)` everywhere the catalog snapshot is used
 * (`/v1/models`, `auto`/virtual windows, context-window fit). Never multiplied by
 * `total_slots` (NOC Norte's finding: the per-request window is `n_ctx`).
 *
 * Env: THINKER_LIVE_CONTEXT (default on), THINKER_LIVE_CONTEXT_TTL_MS (60000),
 * THINKER_LIVE_CONTEXT_FAIL_TTL_MS (30000), THINKER_LIVE_CONTEXT_TIMEOUT_MS
 * (1500), THINKER_LIVE_CONTEXT_STALE_MS (600000: last good value kept through
 * transient failures).
 */

export type LiveContextFetch = (url: string, init: RequestInit) => Promise<Response>;

interface LiveContextConfig {
  enabled: boolean;
  ttlMs: number;
  failTtlMs: number;
  timeoutMs: number;
  staleMs: number;
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = (raw ?? '').trim();
  if (!/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= min && n <= max ? n : fallback;
}

export function liveContextConfig(env: NodeJS.ProcessEnv = process.env): LiveContextConfig {
  return {
    enabled: !/^(0|false|off|no)$/i.test((env.THINKER_LIVE_CONTEXT ?? '').trim()),
    ttlMs: boundedInt(env.THINKER_LIVE_CONTEXT_TTL_MS, 60_000, 1_000, 3_600_000),
    failTtlMs: boundedInt(env.THINKER_LIVE_CONTEXT_FAIL_TTL_MS, 30_000, 1_000, 3_600_000),
    timeoutMs: boundedInt(env.THINKER_LIVE_CONTEXT_TIMEOUT_MS, 1_500, 100, 30_000),
    staleMs: boundedInt(env.THINKER_LIVE_CONTEXT_STALE_MS, 600_000, 0, 86_400_000),
  };
}

const MAX_PROPS_BYTES = 1024 * 1024;
const DIVERGENCE_WARN_INTERVAL_MS = 60 * 60 * 1000;

interface Entry {
  /** Last good n_ctx and when it was read. */
  value: number | null;
  valueAt: number;
  /** When the next read is due. */
  nextAt: number;
  /** A definitive failure (4xx, bad JSON, router mode): fall back to the registered value. */
  definitive: boolean;
  inflight: Promise<void> | null;
}

/** A llama.cpp connection whose window can be read live. */
export interface LiveContextTarget {
  /** Root of the server (no `/v1`). */
  rootUrl: string;
}

class DefinitiveFailure extends Error {}

@Injectable()
export class LiveContextService {
  private readonly logger = new Logger(LiveContextService.name);
  private readonly entries = new Map<string, Entry>();
  /** `custom:<uuid>` → target, refreshed whenever the catalog is rebuilt. */
  private readonly targets = new Map<string, LiveContextTarget>();
  private readonly warnedAt = new Map<string, number>();

  private fetchImpl: LiveContextFetch = (url, init) => ssrfSafeFetch(url, init);
  private now: () => number = Date.now;

  /** Test seam: a service with its own fetch and clock. */
  static withDeps(fetchImpl: LiveContextFetch, now: () => number = Date.now): LiveContextService {
    const service = new LiveContextService();
    service.fetchImpl = fetchImpl;
    service.now = now;
    return service;
  }

  /** Register (or clear, with null) the llama.cpp server behind a custom provider. */
  setTarget(providerKey: string, target: LiveContextTarget | null): void {
    if (target) this.targets.set(providerKey, target);
    else this.targets.delete(providerKey);
  }

  /**
   * The catalog with each llama.cpp model's window lowered to the server's
   * live `n_ctx` when that is smaller. Waits at most the fetch timeout for a
   * due read; concurrent callers share it.
   */
  async apply(models: DiscoveredModel[]): Promise<DiscoveredModel[]> {
    const config = liveContextConfig();
    if (!config.enabled || this.targets.size === 0) return models;
    const urls = new Map<string, string>();
    for (const model of models) {
      const target = this.targets.get(model.provider);
      if (target) urls.set(model.provider, propsUrl(target.rootUrl));
    }
    if (urls.size === 0) return models;
    const live = new Map<string, number | null>();
    await Promise.all(
      [...urls].map(async ([provider, url]) => live.set(provider, await this.nCtx(url, config))),
    );
    let changed = false;
    const out = models.map((model) => {
      const nCtx = live.get(model.provider);
      if (nCtx == null) return model;
      const registered = model.contextWindowSource === 'default' ? null : model.contextWindow;
      const effective = registered === null ? nCtx : Math.min(registered, nCtx);
      if (registered !== null && registered !== nCtx) this.warnDivergence(model, registered, nCtx);
      if (effective === model.contextWindow && model.contextWindowSource !== 'default')
        return model;
      changed = true;
      const { contextWindowSource: _source, ...rest } = model;
      void _source;
      return { ...rest, contextWindow: effective };
    });
    return changed ? out : models;
  }

  /** The live n_ctx for a props URL, from cache or one shared read. */
  async nCtx(url: string, config: LiveContextConfig = liveContextConfig()): Promise<number | null> {
    let entry = this.entries.get(url);
    if (!entry) {
      entry = { value: null, valueAt: 0, nextAt: 0, definitive: false, inflight: null };
      this.entries.set(url, entry);
    }
    if (this.now() >= entry.nextAt) {
      entry.inflight ??= this.refresh(url, entry, config).finally(() => {
        entry!.inflight = null;
      });
      await entry.inflight;
    }
    if (entry.definitive || entry.value === null) return null;
    return this.now() - entry.valueAt <= Math.max(config.staleMs, config.ttlMs)
      ? entry.value
      : null;
  }

  private async refresh(url: string, entry: Entry, config: LiveContextConfig): Promise<void> {
    try {
      const value = await this.read(url, config.timeoutMs);
      entry.value = value;
      entry.valueAt = this.now();
      entry.definitive = false;
      entry.nextAt = this.now() + config.ttlMs;
    } catch (err) {
      entry.nextAt = this.now() + config.failTtlMs;
      if (err instanceof DefinitiveFailure) {
        entry.definitive = true;
        entry.value = null;
      }
      this.logger.debug(`Live n_ctx read failed for ${url}: ${(err as Error).message}`);
    }
  }

  private async read(url: string, timeoutMs: number): Promise<number> {
    const res = await this.fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 400 && res.status < 500) throw new DefinitiveFailure(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const length = Number(res.headers.get('content-length') ?? '0');
    if (length > MAX_PROPS_BYTES) throw new DefinitiveFailure('props body too large');
    const text = await res.text();
    if (text.length > MAX_PROPS_BYTES) throw new DefinitiveFailure('props body too large');
    let body: { default_generation_settings?: { n_ctx?: unknown } };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new DefinitiveFailure('props is not JSON');
    }
    const nCtx = body?.default_generation_settings?.n_ctx;
    // Router mode answers /props without a model, or with no n_ctx.
    if (typeof nCtx !== 'number' || !Number.isInteger(nCtx) || nCtx <= 0) {
      throw new DefinitiveFailure('props has no n_ctx');
    }
    return nCtx;
  }

  private warnDivergence(model: DiscoveredModel, registered: number, live: number): void {
    const key = `${model.provider}::${model.id}`;
    const last = this.warnedAt.get(key) ?? 0;
    if (this.now() - last < DIVERGENCE_WARN_INTERVAL_MS) return;
    this.warnedAt.set(key, this.now());
    this.logger.warn(
      `llama.cpp context differs: provider=${model.provider} model=${model.id} registered=${registered} server n_ctx=${live}; using ${Math.min(registered, live)}`,
    );
  }
}

function propsUrl(rootUrl: string): string {
  return `${rootUrl.replace(/\/+$/, '')}/props`;
}
