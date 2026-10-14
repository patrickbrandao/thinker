import { isAnthropicExtraUsageError } from './provider-error-semantics';

/**
 * Error taxonomy for `agent_messages`.
 *
 * Historically a single `status` column answered three unrelated questions at
 * once (was it a success? who failed? was it a superseded attempt?), so a
 * missing-API-key config error and a provider 500 landed in the same `error`
 * bucket, and a recovered fallback attempt (`fallback_error`) looked like an
 * outcome. This module splits those into orthogonal axes:
 *
 *  - `error_origin` — WHO caused the failure (provider / transport / config /
 *    policy / internal).
 *  - `error_class`  — WHAT kind of failure it was. A rate limit is a *class* of
 *    error here, not a top-level status.
 *  - `superseded`   — whether this row is a retried / fell-back-away-from attempt
 *    rather than the request's terminal outcome (the old `fallback_error`).
 *
 * `classifyMessageError` is the single source of truth for live ingestion. The
 * original backfill migration mirrors its status-derived rules; provider-body
 * semantic overrides added later apply to newly recorded rows unless a dedicated
 * follow-up migration explicitly reclassifies history.
 */

/**
 * Synthetic HTTP codes the proxy stamps on non-HTTP transport failures
 * (see packages/backend/src/routing/proxy/proxy-transport.ts). A provider that
 * genuinely returns 503/504 is bucketed as `transport` too — an unreachable or
 * timed-out upstream is a transport-level condition regardless of who emitted
 * the code.
 */
export const TRANSPORT_NETWORK_HTTP_STATUS = 503;
export const TRANSPORT_TIMEOUT_HTTP_STATUS = 504;

/** Non-ok terminal/attempt statuses the proxy writes to `agent_messages.status`. */
export const OK_STATUS = 'ok';
export const RATE_LIMITED_STATUS = 'rate_limited';
/** A row that failed but was recovered by a later attempt (retry / fallback). */
export const SUPERSEDED_STATUS = 'fallback_error';
/** Every status whose row is a recovered (superseded) attempt, not a terminal failure. */
export const SUPERSEDED_STATUSES: readonly string[] = [SUPERSEDED_STATUS];

/**
 * Canonical outcome vocabulary for `requests.status` and `agent_messages.status`.
 *
 * The legacy `status` column conflated the outcome with the *reason* it failed
 * (`rate_limited`, `fallback_error`). Those reasons now live on the orthogonal
 * axes — `error_class` (rate limit) and `superseded` (recovered attempt) — so
 * `status` carries only the terminal outcome:
 *
 *  - `pending` — accepted, no terminal outcome yet.
 *  - `cancelled` — the caller disconnected before a terminal provider outcome.
 *  - `success` — completed successfully (legacy `ok`).
 *  - `failed`  — completed without succeeding (legacy `error` / `rate_limited` /
 *    `fallback_error`).
 *
 * Rolling-deploy note: during a deploy, old replicas still write the legacy
 * values while new replicas write these. Every reader must therefore compare
 * through `normalizeStatus` / `isSuccessStatus` / `isFailedStatus`, which accept
 * both vocabularies, until the backfill rewrites history and the compat window
 * closes. `classifyMessageError` is deliberately left legacy-aware so it can
 * still classify unnormalized historical rows.
 */
export const PENDING_STATUS = 'pending';
export const CANCELLED_STATUS = 'cancelled';
export const SUCCESS_STATUS = 'success';
export const FAILED_STATUS = 'failed';

export const REQUEST_STATUSES = [
  PENDING_STATUS,
  CANCELLED_STATUS,
  SUCCESS_STATUS,
  FAILED_STATUS,
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const ATTEMPT_STATUSES = [
  PENDING_STATUS,
  CANCELLED_STATUS,
  SUCCESS_STATUS,
  FAILED_STATUS,
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * Collapse any status value — legacy (`ok`/`error`/`rate_limited`/
 * `fallback_error`) or canonical — onto the canonical vocabulary.
 * A nullish value is treated as `success`, matching the legacy writer convention
 * where an absent status meant `ok`. Unknown non-null values fail closed.
 */
export function normalizeStatus(status: string | null | undefined): RequestStatus {
  if (status === PENDING_STATUS) return PENDING_STATUS;
  if (status === CANCELLED_STATUS) return CANCELLED_STATUS;
  if (status == null || status === OK_STATUS || status === SUCCESS_STATUS) return SUCCESS_STATUS;
  return FAILED_STATUS;
}

/** True for a terminal success, whether stored as legacy `ok` or canonical `success`. */
export function isSuccessStatus(status: string | null | undefined): boolean {
  return normalizeStatus(status) === SUCCESS_STATUS;
}

/** True for a terminal failure, whether stored as a legacy error value or canonical `failed`. */
export function isFailedStatus(status: string | null | undefined): boolean {
  return normalizeStatus(status) === FAILED_STATUS;
}

export const ERROR_ORIGINS = [
  'provider',
  'transport',
  'config',
  'policy',
  'internal',
  'request',
] as const;
export type ErrorOrigin = (typeof ERROR_ORIGINS)[number];

/**
 * Origins that are NOT a provider round-trip: Thinker rejected or
 * short-circuited the request before (or without) reaching a provider. These
 * are returned to the caller as HTTP 200 friendly stubs, so they must never
 * count as a "message" nor as a provider-reliability event.
 *
 * `request` is the caller's own fault (a malformed body Thinker refused to
 * route), which is neither the operator's setup (`config`), a limit they set
 * (`policy`), nor a Thinker bug (`internal`) — but it is still not a provider
 * failure, so it belongs here to stay out of `provider_error_rate`.
 */
export const THINKER_ERROR_ORIGINS = ['config', 'policy', 'internal', 'request'] as const;
export type ThinkerErrorOrigin = (typeof THINKER_ERROR_ORIGINS)[number];

export const ERROR_CLASSES = [
  // provider (HTTP-derived)
  'rate_limit',
  'auth',
  'invalid_request',
  'not_found',
  'payload_too_large',
  'billing',
  'server_error',
  'client_error',
  // transport
  'timeout',
  'network',
  // thinker (config / policy / internal / request)
  'no_provider',
  'no_provider_key',
  'subscription_credentials_unusable',
  'local_provider_unavailable',
  'limit_exceeded',
  'internal',
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

/**
 * Canned `routing_reason` values the proxy writes for Thinker-originated stubs
 * (see proxy-message-recorder.ts). Their presence is the definitive signal that
 * a row is Thinker's own error, not a provider's.
 *
 * Every documented Thinker error code (`M###`, see
 * backend/src/common/errors/error-codes.ts) that can be attributed to an agent
 * maps onto exactly one reason here — `thinker-error.spec.ts` fails if a new
 * code ships without one.
 */
const THINKER_REASON_TO_CLASSIFICATION: Record<
  string,
  { origin: ThinkerErrorOrigin; errorClass: ErrorClass }
> = {
  no_provider: { origin: 'config', errorClass: 'no_provider' },
  no_provider_key: { origin: 'config', errorClass: 'no_provider_key' },
  subscription_credentials_unusable: {
    origin: 'config',
    errorClass: 'subscription_credentials_unusable',
  },
  local_provider_unavailable: {
    origin: 'config',
    errorClass: 'local_provider_unavailable',
  },
  key_expired: { origin: 'config', errorClass: 'auth' },
  limit_exceeded: { origin: 'policy', errorClass: 'limit_exceeded' },
  // Three distinct limits (per-user / per-IP / concurrency) that used to
  // collapse into `thinker_rate_limited`. That legacy reason stays mapped so
  // rows written before the split keep classifying.
  thinker_rate_limited: { origin: 'policy', errorClass: 'rate_limit' },
  thinker_ip_rate_limited: { origin: 'policy', errorClass: 'rate_limit' },
  thinker_concurrency_limited: { origin: 'policy', errorClass: 'rate_limit' },
  provider_cooldown: { origin: 'policy', errorClass: 'rate_limit' },
  thinker_invalid_request: { origin: 'request', errorClass: 'invalid_request' },
  model_not_available: { origin: 'request', errorClass: 'not_found' },
  thinker_internal_error: { origin: 'internal', errorClass: 'internal' },
  // Legacy alias of `thinker_internal_error`, kept for rows already written.
  friendly_error: { origin: 'internal', errorClass: 'internal' },
};

/** Map a provider's HTTP status code to a normalized error class. */
export function classifyHttpErrorClass(httpStatus: number): ErrorClass {
  if (httpStatus === 429) return 'rate_limit';
  if (httpStatus === 402) return 'billing';
  if (httpStatus === 401 || httpStatus === 403) return 'auth';
  if (httpStatus === 404) return 'not_found';
  if (httpStatus === 413) return 'payload_too_large';
  if (httpStatus === 400 || httpStatus === 422) return 'invalid_request';
  if (httpStatus >= 500) return 'server_error';
  if (httpStatus >= 400) return 'client_error';
  // A sub-400 code recorded on an error row (e.g. a 200 body that carried an
  // error envelope) is a provider anomaly — never treat it as success.
  return 'server_error';
}

export interface MessageErrorSignals {
  /** `agent_messages.status`. */
  status: string;
  /** `agent_messages.error_http_status` (numeric provider/synthetic code, or null). */
  errorHttpStatus?: number | null;
  /** `agent_messages.routing_reason` — carries the canned Thinker reason for stubs. */
  routingReason?: string | null;
  /** Canonical provider id, used for narrow provider-specific semantic overrides. */
  provider?: string | null;
  /** Raw or persisted provider error envelope. */
  errorMessage?: string | null;
}

export interface MessageErrorClassification {
  error_origin: ErrorOrigin | null;
  error_class: ErrorClass | null;
  superseded: boolean;
}

/**
 * Derive the `{ error_origin, error_class, superseded }` triple for a message
 * row from the signals available both at ingestion time and in the backfill.
 *
 * Precedence: ok short-circuits → Thinker canned reason → 429 (provider rate
 * limit even when the numeric code was dropped) → synthetic transport codes →
 * any other numeric provider code → an errored row with no captured HTTP
 * response (the fetch failed before the provider replied ⇒ transport/network).
 */
export function classifyMessageError(signals: MessageErrorSignals): MessageErrorClassification {
  if (signals.status === PENDING_STATUS || signals.status === CANCELLED_STATUS) {
    return { error_origin: null, error_class: null, superseded: false };
  }
  // Accepts both the legacy `ok` and the canonical `success`, so re-classifying
  // an already-normalized row (buildRequestRow reads a collapsed attempt status)
  // still short-circuits as a success rather than falling through to the error
  // branches.
  if (isSuccessStatus(signals.status)) {
    return { error_origin: null, error_class: null, superseded: false };
  }

  // A `fallback_error` row was recovered by a later attempt, so it must not count
  // as a live fault against the provider.
  const superseded = SUPERSEDED_STATUSES.includes(signals.status);

  const thinker = signals.routingReason
    ? THINKER_REASON_TO_CLASSIFICATION[signals.routingReason]
    : undefined;
  if (thinker) {
    return { error_origin: thinker.origin, error_class: thinker.errorClass, superseded };
  }

  if (signals.status === RATE_LIMITED_STATUS) {
    return { error_origin: 'provider', error_class: 'rate_limit', superseded };
  }

  const http = signals.errorHttpStatus ?? null;
  if (
    isAnthropicExtraUsageError({
      provider: signals.provider,
      httpStatus: http,
      errorBody: signals.errorMessage,
    })
  ) {
    return { error_origin: 'provider', error_class: 'billing', superseded };
  }
  if (http === TRANSPORT_TIMEOUT_HTTP_STATUS) {
    return { error_origin: 'transport', error_class: 'timeout', superseded };
  }
  if (http === TRANSPORT_NETWORK_HTTP_STATUS) {
    return { error_origin: 'transport', error_class: 'network', superseded };
  }
  if (http != null) {
    return { error_origin: 'provider', error_class: classifyHttpErrorClass(http), superseded };
  }

  return { error_origin: 'transport', error_class: 'network', superseded };
}

/**
 * True when an origin is Thinker's own — config, policy, internal, or request —
 * rather than a provider round-trip. Reads THINKER_ERROR_ORIGINS, so a new
 * origin added there is covered without touching this guard.
 */
export function isThinkerErrorOrigin(
  origin: string | null | undefined,
): origin is ThinkerErrorOrigin {
  return origin != null && (THINKER_ERROR_ORIGINS as readonly string[]).includes(origin);
}
