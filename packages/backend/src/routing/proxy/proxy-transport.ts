import { randomBytes } from 'crypto';

/**
 * Pure helper functions for classifying and formatting transport-level
 * errors that occur when forwarding requests to upstream LLM providers.
 *
 * These cover network failures, DNS resolution errors, timeouts, and
 * similar non-HTTP errors that the `fetch()` call can throw.
 */

export const PROVIDER_TRANSPORT_ERROR_STATUS = 503;
export const PROVIDER_TIMEOUT_STATUS = 504;
/** Status for a provider URL the SSRF policy refused (#74). */
export const PROVIDER_URL_BLOCKED_STATUS = 502;
export const PROVIDER_URL_BLOCKED_CODE = 'provider_url_blocked';

/**
 * The 502 body for a blocked provider URL is built by the gateway itself, but
 * downstream it is read back as text alongside real upstream bodies. An
 * upstream could send `code: "provider_url_blocked"` in its own 502, so the
 * code alone must not classify it (#158). Each gateway-built body carries a
 * random marker that is registered here; only a body whose marker is known to
 * this process counts as gateway-produced. The registry is bounded, so markers
 * that leak into logs or recordings expire.
 */
const GATEWAY_MARKER_FIELD = 'thinker_gateway_error';
const GATEWAY_MARKER_LIMIT = 1024;
const gatewayMarkers = new Set<string>();

function issueGatewayMarker(): string {
  const marker = randomBytes(16).toString('hex');
  gatewayMarkers.add(marker);
  if (gatewayMarkers.size > GATEWAY_MARKER_LIMIT) {
    const oldest = gatewayMarkers.values().next().value;
    if (oldest !== undefined) gatewayMarkers.delete(oldest);
  }
  return marker;
}

/**
 * Removes the internal marker from a body before it is logged, stored or
 * recorded, so markers never leave the process. Other bodies pass unchanged.
 */
export function stripGatewayMarker(rawBody: string): string {
  if (!rawBody.includes(GATEWAY_MARKER_FIELD)) return rawBody;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rawBody;
    if (!(GATEWAY_MARKER_FIELD in parsed)) return rawBody;
    const rest: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    delete rest[GATEWAY_MARKER_FIELD];
    return JSON.stringify(rest);
  } catch {
    return rawBody;
  }
}

/** True only for a blocked-URL body this gateway process built itself. */
export function isGatewayProviderUrlBlockedBody(rawBody: string): boolean {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const marker = parsed[GATEWAY_MARKER_FIELD];
    const error = parsed.error as Record<string, unknown> | undefined;
    return (
      typeof marker === 'string' &&
      gatewayMarkers.has(marker) &&
      error?.code === PROVIDER_URL_BLOCKED_CODE
    );
  } catch {
    return false;
  }
}

/**
 * The configured provider URL was refused by the SSRF policy: a cloud metadata
 * address or name, before connecting or at connect time (DNS rebinding). It is
 * a fault of the provider configuration, not of the gateway, so it surfaces
 * like an unreachable provider (fallbacks run) with its own status and code
 * instead of an internal error.
 */
export class ProviderUrlBlockedError extends Error {
  readonly code = 'EPROVIDERURLBLOCKED';

  constructor(detail: string) {
    super(`Provider URL blocked by the SSRF policy: ${detail}`);
    this.name = 'ProviderUrlBlockedError';
  }
}

export function isProviderUrlBlockedError(error: unknown): boolean {
  return getErrorCode(error) === 'EPROVIDERURLBLOCKED';
}

const GENERIC_FETCH_ERROR_MESSAGE = 'fetch failed';

const TRANSPORT_PATTERN =
  /(fetch failed|failed to parse url|network|timeout|econnrefused|econnreset|enotfound|ehostunreach|etimedout|und_err_|\bterminated\b)/i;

// ---------------------------------------------------------------------------
// Error property accessors
// ---------------------------------------------------------------------------

export function getErrorName(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.name;
}

export function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== 'object') return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

export function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function getErrorCause(error: unknown): unknown {
  if (!(error instanceof Error)) return undefined;
  return error.cause;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function isTransportError(error: unknown): boolean {
  if (isProviderUrlBlockedError(error)) return true;
  const name = getErrorName(error);
  if (name === 'AbortError' || name === 'TimeoutError') return true;

  const detail = [
    getErrorMessage(error),
    getErrorMessage(getErrorCause(error)),
    getErrorCode(error),
    getErrorCode(getErrorCause(error)),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  return TRANSPORT_PATTERN.test(detail);
}

export function isTimeoutError(error: unknown): boolean {
  return getErrorName(error) === 'TimeoutError';
}

// ---------------------------------------------------------------------------
// Detail extraction & sanitization
// ---------------------------------------------------------------------------

export function sanitizeTransportErrorDetail(detail: string): string {
  return detail.replace(/key=[^&\s]+/gi, 'key=***').slice(0, 500);
}

export function selectTransportErrorDetail(error: unknown): string | undefined {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);

  if (message && message.toLowerCase() !== GENERIC_FETCH_ERROR_MESSAGE) {
    return sanitizeTransportErrorDetail(message);
  }
  if (code) return code;
  return undefined;
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

export function describeTransportError(error: unknown): string {
  if (isTimeoutError(error)) {
    return 'Upstream provider request timed out';
  }

  const detail =
    selectTransportErrorDetail(error) ?? selectTransportErrorDetail(getErrorCause(error));

  if (!detail) return 'Failed to reach upstream provider';
  return `Failed to reach upstream provider: ${detail}`;
}

export function buildTransportErrorResponse(error: unknown): Response {
  if (isProviderUrlBlockedError(error)) {
    const message = sanitizeTransportErrorDetail(getErrorMessage(error) ?? '');
    return new Response(
      JSON.stringify({
        error: {
          message,
          type: PROVIDER_URL_BLOCKED_CODE,
          code: PROVIDER_URL_BLOCKED_CODE,
        },
        [GATEWAY_MARKER_FIELD]: issueGatewayMarker(),
      }),
      {
        status: PROVIDER_URL_BLOCKED_STATUS,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'application/json' },
      },
    );
  }
  const status = isTimeoutError(error) ? PROVIDER_TIMEOUT_STATUS : PROVIDER_TRANSPORT_ERROR_STATUS;
  const message = describeTransportError(error);

  return new Response(JSON.stringify({ error: { message } }), {
    status,
    statusText: status === PROVIDER_TIMEOUT_STATUS ? 'Gateway Timeout' : 'Service Unavailable',
    headers: { 'content-type': 'application/json' },
  });
}
