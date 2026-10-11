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
 * Server root of a local runner, without `/v1` (endpoint paths add it).
 * Read on every call so a changed env var or container runtime applies
 * without a module reload. The default reaches the host from inside Docker
 * or Podman through the container host alias, and `localhost` otherwise.
 */
export function getLocalServerBaseUrl(id: LocalServerId): string {
  const configured = process.env[LOCAL_SERVER_BASE_URL_ENV[id]]?.trim();
  return toServerRoot(
    configured || `http://${getContainerHostAlias()}:${LOCAL_SERVER_DEFAULT_PORTS[id]}`,
  );
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
