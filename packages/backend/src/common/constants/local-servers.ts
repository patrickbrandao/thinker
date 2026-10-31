import { Logger } from '@nestjs/common';
import { getContainerHostAlias } from '../utils/container-host';

/**
 * Built-in local OpenAI-compatible servers that connect as a canonical
 * provider (`lmstudio`, `llamacpp`) rather than as a custom provider. Ollama
 * has its own module because it reads Ollama's `OLLAMA_HOST` convention.
 */
export const LOCAL_SERVER_DEFAULT_PORTS = {
  lmstudio: 1234,
  llamacpp: 8080,
} as const;

export type LocalServerId = keyof typeof LOCAL_SERVER_DEFAULT_PORTS;

/** Env vars that override the default `http://<host alias>:<port>` base URL. */
export const LOCAL_SERVER_BASE_URL_ENV: Readonly<Record<LocalServerId, string>> = {
  lmstudio: 'THINKER_LMSTUDIO_BASE_URL',
  llamacpp: 'THINKER_LLAMACPP_BASE_URL',
};

/**
 * Strip trailing slashes and one trailing `/v1`, without a regex (the value
 * is operator input; an anchored `/\/+$/` backtracks on long slash runs).
 */
function toServerRoot(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47 /* '/' */) end--;
  const trimmed = url.slice(0, end);
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -'/v1'.length) : trimmed;
}

/**
 * Why an override is unusable, or null when it is an absolute `http(s)` URL
 * the gateway can append `/v1/...` to. A bare `host:port` (the usual
 * mistake) is caught before parsing, since `new URL` would read the host as
 * a scheme.
 * Credentials and query strings (even an empty trailing `?` or `#`) are
 * rejected because `fetch` refuses the first and the endpoint path would land
 * after the second.
 */
function invalidBaseUrlReason(value: string): string | null {
  if (!value.includes('://')) return 'has no http:// or https:// scheme';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'is not an absolute URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'must use http:// or https://';
  }
  if (!url.hostname) return 'has no host';
  if (url.username || url.password) {
    return 'must not embed credentials (store an API key on the connection instead)';
  }
  // `new URL` drops an empty `?` or `#`, but the raw value is what would be
  // concatenated with the endpoint path (`.../v1?/v1/chat/completions`).
  if (url.search || url.hash || value.includes('?') || value.includes('#')) {
    return 'must not carry a query string or fragment';
  }
  return null;
}

const logger = new Logger('LocalServers');
const warnedValues = new Map<LocalServerId, string>();

/**
 * Warn once per distinct bad value. The value itself is never logged: an
 * operator may have pasted a URL with credentials in it.
 */
function warnInvalidOverride(id: LocalServerId, value: string, reason: string, fallback: string) {
  if (warnedValues.get(id) === value) return;
  warnedValues.set(id, value);
  logger.warn(
    `${LOCAL_SERVER_BASE_URL_ENV[id]} ${reason} (expected e.g. http://192.168.1.20:` +
      `${LOCAL_SERVER_DEFAULT_PORTS[id]}); ignoring it and using ${fallback}`,
  );
}

/**
 * Server root of a local runner, without `/v1` (endpoint paths add it).
 * Read on every call so a changed env var or container runtime applies
 * without a module reload. The default reaches the host from inside Docker
 * or Podman through the container host alias, and `localhost` otherwise.
 *
 * An override that is not an absolute `http(s)` URL is ignored with a
 * warning (logged at boot by `checkLocalServerBaseUrls`) and the default is
 * used, the same way an unusable `OLLAMA_HOST` or `DB_POOL_MAX` never stops
 * the gateway: the variable is optional, and every other provider keeps
 * working.
 */
export function getLocalServerBaseUrl(id: LocalServerId): string {
  const fallback = `http://${getContainerHostAlias()}:${LOCAL_SERVER_DEFAULT_PORTS[id]}`;
  const configured = process.env[LOCAL_SERVER_BASE_URL_ENV[id]]?.trim();
  if (!configured) return fallback;
  const reason = invalidBaseUrlReason(configured);
  if (reason) {
    warnInvalidOverride(id, configured, reason, fallback);
    return fallback;
  }
  return toServerRoot(configured);
}

/** Validate every local runner override once at boot, so a typo shows up in the startup log. */
export function checkLocalServerBaseUrls(): void {
  for (const id of Object.keys(LOCAL_SERVER_DEFAULT_PORTS) as LocalServerId[]) {
    getLocalServerBaseUrl(id);
  }
}

/**
 * Local servers need no credentials, but llama-server (`--api-key`) and LM
 * Studio can be told to require a bearer token. Send it only when one is
 * stored for the connection.
 */
export function buildLocalServerHeaders(apiKey: string): Record<string, string> {
  return apiKey
    ? { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

/* ── Configurable local servers (N per type) ─────────────────────────────── */

/**
 * Local runner types a server connection can speak. Each one is stored as a
 * custom provider row with `local_type` set, so every server gets its own
 * base URL, API key, timeouts and display name.
 */
export const LOCAL_SERVER_TYPES = ['ollama', 'lmstudio', 'llamacpp'] as const;
export type LocalServerType = (typeof LOCAL_SERVER_TYPES)[number];

export function isLocalServerType(value: unknown): value is LocalServerType {
  return typeof value === 'string' && (LOCAL_SERVER_TYPES as readonly string[]).includes(value);
}

/** Connection settings of one local server. Every field is user-editable. */
export interface LocalServerConfig {
  scheme: 'http' | 'https';
  host: string;
  port: number;
  /** Path the server is mounted under (reverse proxy, llama-server `--api-prefix`), or ''. */
  path_prefix: string;
  /** Upper bound of one proxied request. The first call may load the model. */
  request_timeout_ms: number;
  /** Upper bound of a connection test or model listing. */
  probe_timeout_ms: number;
}

export interface LocalServerTypeDefaults {
  type: LocalServerType;
  displayName: string;
  /** The env var whose value pre-fills a new server, when set. */
  env: string;
  defaultPort: number;
  /** Health/version endpoint used by the connection test. */
  healthPath: string;
  /** Native model listing used by the connection test. */
  modelsPath: string;
}

/**
 * Defaults per type, from each project's official docs (checked 2026-10-31):
 * - Ollama: binds 127.0.0.1:11434, `OLLAMA_HOST=0.0.0.0:11434` exposes it
 *   (docs/faq.mdx). OpenAI-compatible API under `/v1`; native `/api/version`,
 *   `/api/tags`, `/api/show` (capabilities, `<arch>.context_length`), `/api/ps`
 *   (docs/api.md). No built-in auth; a reverse proxy may require a bearer token.
 * - LM Studio: `lms server start`, port 1234; "Serve on Local Network" exposes
 *   it. OpenAI-compatible `/v1`; native `GET /api/v1/models` (loaded_instances,
 *   max_context_length, capabilities) and the older `/api/v0/models`.
 *   Optional "Require Authentication": `Authorization: Bearer <token>`
 *   (lmstudio.ai/docs/developer/rest/list, core/authentication).
 * - llama.cpp `llama-server`: binds 127.0.0.1, default port 9931 since
 *   ggml-org/llama.cpp#30159 (2026-10-09; older builds and the Docker examples
 *   use 8080). `--api-prefix`, `--api-key` (Bearer), public `GET /health`,
 *   `GET /props` (n_ctx, modalities), `GET /v1/models` (router mode lists every
 *   model with `status.value`) — tools/server/README.md.
 */
export const LOCAL_SERVER_TYPE_DEFAULTS: Readonly<
  Record<LocalServerType, LocalServerTypeDefaults>
> = {
  ollama: {
    type: 'ollama',
    displayName: 'Ollama',
    env: 'OLLAMA_HOST',
    defaultPort: 11434,
    healthPath: '/api/version',
    modelsPath: '/api/tags',
  },
  lmstudio: {
    type: 'lmstudio',
    displayName: 'LM Studio',
    env: 'THINKER_LMSTUDIO_BASE_URL',
    defaultPort: 1234,
    healthPath: '/api/v1/models',
    modelsPath: '/api/v1/models',
  },
  llamacpp: {
    type: 'llamacpp',
    displayName: 'llama.cpp',
    env: 'THINKER_LLAMACPP_BASE_URL',
    defaultPort: 9931,
    healthPath: '/health',
    modelsPath: '/v1/models',
  },
};

/** 10 minutes: a cold model load on a big GGUF can take minutes before the first token. */
export const LOCAL_SERVER_DEFAULT_REQUEST_TIMEOUT_MS = 600_000;
export const LOCAL_SERVER_DEFAULT_PROBE_TIMEOUT_MS = 10_000;
export const LOCAL_SERVER_MIN_TIMEOUT_MS = 1_000;
export const LOCAL_SERVER_MAX_TIMEOUT_MS = 3_600_000;

/** Parse an `OLLAMA_HOST`-style value: `host`, `host:port`, `:port` or a full URL. */
function parseHostSetting(
  raw: string,
  defaultPort: number,
): Pick<LocalServerConfig, 'scheme' | 'host' | 'port' | 'path_prefix'> | null {
  let value = raw.trim();
  if (!value) return null;
  if (!value.includes('://'))
    value = `http://${value.startsWith(':') ? `localhost${value}` : value}`;
  if (invalidBaseUrlReason(value)) return null;
  const url = new URL(value);
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const port = url.port ? Number(url.port) : scheme === 'https' ? 443 : defaultPort;
  // A bind-all address is where the server listens, not where to reach it.
  const host =
    url.hostname === '0.0.0.0' || url.hostname === '[::]' ? getContainerHostAlias() : url.hostname;
  const root = toServerRoot(url.pathname);
  return { scheme, host, port, path_prefix: root === '/' ? '' : root };
}

/**
 * Pre-filled settings of a new server of `type`: the container host alias and
 * the documented port, overridden by the type's env var when it parses.
 */
export function defaultLocalServerConfig(type: LocalServerType): LocalServerConfig {
  const defaults = LOCAL_SERVER_TYPE_DEFAULTS[type];
  const fromEnv = parseHostSetting(process.env[defaults.env] ?? '', defaults.defaultPort);
  return {
    scheme: 'http',
    host: getContainerHostAlias(),
    port: defaults.defaultPort,
    path_prefix: '',
    ...(fromEnv ?? {}),
    request_timeout_ms: LOCAL_SERVER_DEFAULT_REQUEST_TIMEOUT_MS,
    probe_timeout_ms: LOCAL_SERVER_DEFAULT_PROBE_TIMEOUT_MS,
  };
}

const HOST_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])$/;
const PATH_PREFIX_PATTERN = /^(?:\/[A-Za-z0-9._~-]+)*$/;

/** Normalise a path prefix: leading slash, no trailing slash, '' for none. */
export function normalizePathPrefix(prefix: string | undefined | null): string {
  const trimmed = (prefix ?? '').trim();
  if (!trimmed || trimmed === '/') return '';
  let end = trimmed.length;
  while (end > 0 && trimmed.charCodeAt(end - 1) === 47 /* '/' */) end--;
  const body = trimmed.slice(0, end);
  return body.startsWith('/') ? body : `/${body}`;
}

/**
 * Why a server config is unusable, or null. On top of the per-field checks
 * the assembled URL goes through the same rules as the env overrides: no
 * credentials, no query string or fragment.
 */
export function invalidLocalServerConfigReason(config: LocalServerConfig): string | null {
  if (config.scheme !== 'http' && config.scheme !== 'https') return 'scheme must be http or https';
  if (!config.host || !HOST_PATTERN.test(config.host)) {
    return 'host must be a hostname or IP address, without scheme, port or path';
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return 'port must be between 1 and 65535';
  }
  const prefix = normalizePathPrefix(config.path_prefix);
  if (!PATH_PREFIX_PATTERN.test(prefix) || prefix.split('/').some((s) => s === '.' || s === '..')) {
    return 'path prefix may only hold path segments (letters, digits, . _ ~ -)';
  }
  for (const key of ['request_timeout_ms', 'probe_timeout_ms'] as const) {
    const v = config[key];
    if (
      !Number.isInteger(v) ||
      v < LOCAL_SERVER_MIN_TIMEOUT_MS ||
      v > LOCAL_SERVER_MAX_TIMEOUT_MS
    ) {
      return `${key} must be between ${LOCAL_SERVER_MIN_TIMEOUT_MS} and ${LOCAL_SERVER_MAX_TIMEOUT_MS}`;
    }
  }
  const reason = invalidBaseUrlReason(localServerRootUrl(config));
  return reason ? `server URL ${reason}` : null;
}

/** `scheme://host:port/prefix`, without `/v1`. */
export function localServerRootUrl(config: LocalServerConfig): string {
  return `${config.scheme}://${config.host}:${config.port}${normalizePathPrefix(config.path_prefix)}`;
}

/** Base URL stored on the custom provider row: the OpenAI-compatible `/v1` of the server. */
export function localServerBaseUrl(config: LocalServerConfig): string {
  return `${localServerRootUrl(config)}/v1`;
}

/**
 * Reverse of `localServerBaseUrl` for rows saved before servers had their own
 * settings (migration and legacy rows): split an absolute base URL into a
 * config, or null when it is not a usable local server URL.
 */
export function localServerConfigFromBaseUrl(
  baseUrl: string,
  type: LocalServerType,
): LocalServerConfig | null {
  const parsed = parseHostSetting(baseUrl, LOCAL_SERVER_TYPE_DEFAULTS[type].defaultPort);
  if (!parsed || !baseUrl.includes('://')) return null;
  return {
    ...parsed,
    request_timeout_ms: LOCAL_SERVER_DEFAULT_REQUEST_TIMEOUT_MS,
    probe_timeout_ms: LOCAL_SERVER_DEFAULT_PROBE_TIMEOUT_MS,
  };
}
