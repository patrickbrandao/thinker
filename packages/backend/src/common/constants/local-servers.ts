import { Logger } from '@nestjs/common';
import { getContainerHostAlias } from '../utils/detect-self-hosted';

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
 * Credentials and query strings are rejected because `fetch` refuses the
 * first and the endpoint path would land after the second.
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
  if (url.search || url.hash) return 'must not carry a query string or fragment';
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
