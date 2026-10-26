import { HttpException } from '@nestjs/common';
import { formatThinkerError, THINKER_ERRORS, type ThinkerErrorCode } from './error-codes';

/**
 * `routing_reason` values the proxy stamps on a Thinker-originated row. Each
 * one classifies to an `{ error_origin, error_class }` pair via
 * `classifyMessageError` in `thinker-shared` — the two lists are kept in
 * lock-step by `__tests__/thinker-error.spec.ts`.
 */
export const THINKER_BLOCKED_REQUEST_REASONS = [
  'no_provider',
  'no_provider_key',
  'subscription_credentials_unusable',
  'key_expired',
  'limit_exceeded',
  'thinker_rate_limited',
  'thinker_ip_rate_limited',
  'thinker_concurrency_limited',
  'thinker_invalid_request',
  // No longer raised (it was the M303 cloud-only rejection), but kept so rows
  // recorded before the single self-hosted mode still classify.
  'local_provider_unavailable',
  'model_not_available',
  'virtual_model_unavailable',
  'thinker_internal_error',
] as const;
export type ThinkerBlockedRequestReason = (typeof THINKER_BLOCKED_REQUEST_REASONS)[number];

/**
 * Error codes that can never become an `agent_messages` row: they are raised by
 * `AgentKeyAuthGuard` before a key resolves to a tenant, so there is no agent to
 * attribute the row to. Recording them anyway would let anyone holding the
 * endpoint URL write rows into someone else's dashboard by guessing keys.
 *
 * `M004` (expired key) is deliberately NOT here — that key does resolve to an
 * agent, so its rejection is recordable.
 */
export const UNRECORDABLE_THINKER_CODES = ['M001', 'M002', 'M003', 'M005', 'M006'] as const;
export type UnrecordableThinkerCode = (typeof UNRECORDABLE_THINKER_CODES)[number];

/** A documented Thinker error that can be attributed to an agent, and so recorded. */
export type RecordableThinkerCode = Exclude<ThinkerErrorCode, UnrecordableThinkerCode>;

/**
 * The one mapping from a documented error code to the reason persisted on its
 * message row. Adding a code to `THINKER_ERRORS` without adding it here (or to
 * `UNRECORDABLE_THINKER_CODES`) fails the guardrail spec.
 */
export const THINKER_CODE_TO_REASON: Record<RecordableThinkerCode, ThinkerBlockedRequestReason> = {
  M004: 'key_expired',
  M100: 'no_provider_key',
  M101: 'no_provider',
  M102: 'subscription_credentials_unusable',
  M200: 'limit_exceeded',
  M201: 'thinker_rate_limited',
  M202: 'thinker_ip_rate_limited',
  M203: 'thinker_concurrency_limited',
  M300: 'thinker_invalid_request',
  M301: 'virtual_model_unavailable',
  M302: 'model_not_available',
  M500: 'thinker_internal_error',
};

export function isRecordableThinkerCode(code: ThinkerErrorCode): code is RecordableThinkerCode {
  return !(UNRECORDABLE_THINKER_CODES as readonly string[]).includes(code);
}

/**
 * An error Thinker itself raised, carrying the documented code that identifies
 * it. Throwing this instead of a bare `HttpException` is what lets the proxy
 * tell "Thinker rejected the request" from "the provider returned a 4xx" —
 * before this existed, a `BadRequestException` for a malformed body was recorded
 * as a provider error and counted against provider reliability.
 */
export class ThinkerError extends HttpException {
  constructor(
    readonly code: ThinkerErrorCode,
    status: number,
    vars: Record<string, string | number> = {},
  ) {
    super(formatThinkerError(code, vars), status);
  }

  /** Human title from the catalogue, e.g. "Missing messages array". */
  get title(): string {
    return THINKER_ERRORS[this.code].title;
  }
}
