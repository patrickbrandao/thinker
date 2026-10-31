import {
  buildLocalServerHeaders,
  localServerRootUrl,
  type LocalServerConfig,
  type LocalServerType,
} from '../../common/constants/local-servers';
import type { LocalModelCapability } from '../../entities/custom-provider.entity';
import { classifyProbeError } from './probe-error';

/** One chat-capable model a local server reported. */
export interface LocalProbeModel {
  model_name: string;
  context_window?: number;
  capabilities?: LocalModelCapability[];
  /** True when the server reports the model resident in memory; undefined when unknown. */
  loaded?: boolean;
}

export interface LocalProbeResult {
  /** Server version or build, when the server reports one. */
  version?: string;
  models: LocalProbeModel[];
}

export type ProbeFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Thrown with a user-facing message; the controller maps it to a 400. */
export class LocalProbeError extends Error {}

const EMBEDDING_NAME = /(?:^|[/_\-:])embed(?:ding|dings|ed)?(?:[/_\-:.]|$)|embedder|reranker/i;
/** Ollama `/api/show` calls per probe; the rest are listed without details. */
const OLLAMA_SHOW_LIMIT = 40;
const OLLAMA_SHOW_CONCURRENCY = 4;

interface ProbeCtx {
  root: string;
  headers: Record<string, string>;
  timeoutMs: number;
  fetch: ProbeFetch;
}

/**
 * Read one JSON endpoint of the server. `optional` endpoints return null on a
 * non-2xx answer instead of failing the probe (version, details, fallbacks).
 */
async function getJson<T>(
  ctx: ProbeCtx,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; optional?: boolean } = {},
): Promise<T | null> {
  const url = `${ctx.root}${path}`;
  let res: Response;
  try {
    res = await ctx.fetch(url, {
      method: opts.method ?? 'GET',
      headers: ctx.headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: AbortSignal.timeout(ctx.timeoutMs),
      redirect: 'error',
    });
  } catch (err) {
    if (opts.optional) return null;
    const e = err as Error;
    // AbortSignal.timeout aborts with a TimeoutError; report it as a timeout.
    const error =
      e?.name === 'TimeoutError' ? Object.assign(new Error(e.message), { name: 'AbortError' }) : e;
    throw new LocalProbeError(timeoutAware(classifyProbeError({ url, error }).message, ctx));
  }
  if (!res.ok) {
    if (opts.optional) return null;
    throw new LocalProbeError(classifyProbeError({ url, status: res.status }).message);
  }
  try {
    return (await res.json()) as T;
  } catch {
    if (opts.optional) return null;
    throw new LocalProbeError(
      classifyProbeError({ url, contentType: res.headers.get('content-type') ?? '' }).message,
    );
  }
}

function timeoutAware(message: string, ctx: ProbeCtx): string {
  return message.replace('within 5 s', `within ${Math.round(ctx.timeoutMs / 1000)} s`);
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function caps(flags: Record<LocalModelCapability, boolean>): LocalModelCapability[] | undefined {
  const list = (Object.keys(flags) as LocalModelCapability[]).filter((k) => flags[k]);
  return list.length ? list : undefined;
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ── Ollama ─────────────────────────────────────────────────────────────── */

interface OllamaTags {
  models?: { name?: string; model?: string }[];
}
interface OllamaShow {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

/** Ollama tags `:latest` implicitly; the bare name is what users type and route on. */
export function ollamaModelName(name: string): string {
  return name.endsWith(':latest') ? name.slice(0, -':latest'.length) : name;
}

async function probeOllama(ctx: ProbeCtx): Promise<LocalProbeResult> {
  const version = await getJson<{ version?: string }>(ctx, '/api/version', { optional: true });
  const tags = await getJson<OllamaTags>(ctx, '/api/tags');
  const ps = await getJson<OllamaTags>(ctx, '/api/ps', { optional: true });
  const loaded = new Set(
    (ps?.models ?? []).map((m) => ollamaModelName(m.name ?? m.model ?? '')).filter(Boolean),
  );
  const names = (tags?.models ?? [])
    .map((m) => m.name ?? m.model)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);

  const detailed = await mapLimited(
    names.slice(0, OLLAMA_SHOW_LIMIT),
    OLLAMA_SHOW_CONCURRENCY,
    (name) =>
      getJson<OllamaShow>(ctx, '/api/show', {
        method: 'POST',
        body: { model: name },
        optional: true,
      }),
  );

  const models: LocalProbeModel[] = [];
  names.forEach((rawName, i) => {
    const show = detailed[i] ?? null;
    const capabilities = show?.capabilities;
    // `/api/show` says what the model can do; without it, fall back on the name.
    if (capabilities ? !capabilities.includes('completion') : EMBEDDING_NAME.test(rawName)) return;
    const ctxKey = Object.keys(show?.model_info ?? {}).find((k) => k.endsWith('.context_length'));
    const model_name = ollamaModelName(rawName);
    models.push({
      model_name,
      context_window: ctxKey ? positiveInt(show?.model_info?.[ctxKey]) : undefined,
      capabilities: capabilities
        ? caps({
            tools: capabilities.includes('tools'),
            vision: capabilities.includes('vision'),
            reasoning: capabilities.includes('thinking'),
          })
        : undefined,
      loaded: ps ? loaded.has(model_name) : undefined,
    });
  });
  return { version: version?.version, models };
}

/* ── LM Studio ──────────────────────────────────────────────────────────── */

interface LmStudioV1Models {
  models?: {
    type?: string;
    key?: string;
    max_context_length?: number | null;
    loaded_instances?: { id?: string; config?: { context_length?: number } }[];
    capabilities?: { vision?: boolean; trained_for_tool_use?: boolean; reasoning?: unknown };
  }[];
}
interface LmStudioV0Models {
  data?: {
    id?: string;
    type?: string;
    state?: string;
    max_context_length?: number;
    capabilities?: string[];
  }[];
}
interface OpenAiModels {
  data?: { id?: string }[];
}

async function probeLmStudio(ctx: ProbeCtx): Promise<LocalProbeResult> {
  // Native REST API v1 (LM Studio 0.4+), then v0 (0.3.x), then the plain
  // OpenAI-compatible list, which says nothing about context or load state.
  const v1 = await getJson<LmStudioV1Models>(ctx, '/api/v1/models', { optional: true });
  if (v1?.models) {
    return {
      models: v1.models
        .filter((m) => m.type === 'llm' && typeof m.key === 'string' && m.key)
        .map((m) => {
          const instance = m.loaded_instances?.[0];
          return {
            model_name: m.key!,
            context_window:
              positiveInt(instance?.config?.context_length) ?? positiveInt(m.max_context_length),
            capabilities: caps({
              tools: m.capabilities?.trained_for_tool_use === true,
              vision: m.capabilities?.vision === true,
              reasoning: m.capabilities?.reasoning != null,
            }),
            loaded: Array.isArray(m.loaded_instances) ? m.loaded_instances.length > 0 : undefined,
          };
        }),
    };
  }
  const v0 = await getJson<LmStudioV0Models>(ctx, '/api/v0/models', { optional: true });
  if (v0?.data) {
    return {
      models: v0.data
        .filter((m) => (m.type === 'llm' || m.type === 'vlm') && typeof m.id === 'string' && m.id)
        .map((m) => ({
          model_name: m.id!,
          context_window: positiveInt(m.max_context_length),
          capabilities: caps({
            tools: m.capabilities?.includes('tool_use') === true,
            vision: m.type === 'vlm',
            reasoning: false,
          }),
          loaded: m.state ? m.state === 'loaded' : undefined,
        })),
    };
  }
  return { models: await probeOpenAiList(ctx) };
}

async function probeOpenAiList(ctx: ProbeCtx): Promise<LocalProbeModel[]> {
  const list = await getJson<OpenAiModels>(ctx, '/v1/models');
  return (list?.data ?? [])
    .map((m) => m.id)
    .filter(
      (id): id is string => typeof id === 'string' && id.length > 0 && !EMBEDDING_NAME.test(id),
    )
    .map((model_name) => ({ model_name }));
}

/* ── llama.cpp ──────────────────────────────────────────────────────────── */

interface LlamaModels {
  data?: {
    id?: string;
    status?: { value?: string };
    meta?: { n_ctx_train?: number };
    architecture?: { input_modalities?: string[] };
  }[];
}
interface LlamaProps {
  build_info?: string;
  default_generation_settings?: { n_ctx?: number };
  modalities?: { vision?: boolean };
}

async function probeLlamaCpp(ctx: ProbeCtx): Promise<LocalProbeResult> {
  // `/health` is public (no API key) and answers 503 while a model loads, so
  // it only gates on reachability; `/v1/models` checks the key.
  await getJson(ctx, '/health', { optional: true });
  const list = await getJson<LlamaModels>(ctx, '/v1/models');
  const entries = (list?.data ?? []).filter(
    (m): m is NonNullable<LlamaModels['data']>[number] & { id: string } =>
      typeof m.id === 'string' && m.id.length > 0 && !EMBEDDING_NAME.test(m.id),
  );
  // Router mode (several models) answers `/props` per model; a single-model
  // server answers it directly with the runtime context size.
  const props =
    entries.length === 1 ? await getJson<LlamaProps>(ctx, '/props', { optional: true }) : null;
  return {
    version: props?.build_info,
    models: entries.map((m) => ({
      model_name: m.id,
      context_window:
        positiveInt(props?.default_generation_settings?.n_ctx) ?? positiveInt(m.meta?.n_ctx_train),
      capabilities: caps({
        tools: false,
        vision:
          props?.modalities?.vision === true ||
          m.architecture?.input_modalities?.includes('image') === true,
        reasoning: false,
      }),
      loaded: m.status?.value ? m.status.value === 'loaded' : entries.length === 1 || undefined,
    })),
  };
}

const PROBES: Record<LocalServerType, (ctx: ProbeCtx) => Promise<LocalProbeResult>> = {
  ollama: probeOllama,
  lmstudio: probeLmStudio,
  llamacpp: probeLlamaCpp,
};

/**
 * Test a local server with the endpoints its own software exposes and list
 * the chat models it serves. The API key travels only in the Authorization
 * header and never appears in an error message.
 */
export async function probeLocalServer(
  type: LocalServerType,
  config: LocalServerConfig,
  apiKey: string | undefined,
  fetchImpl: ProbeFetch,
): Promise<LocalProbeResult> {
  const ctx: ProbeCtx = {
    root: localServerRootUrl(config),
    headers: buildLocalServerHeaders(apiKey ?? ''),
    timeoutMs: config.probe_timeout_ms,
    fetch: fetchImpl,
  };
  return PROBES[type](ctx);
}
