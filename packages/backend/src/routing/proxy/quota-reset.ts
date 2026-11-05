/**
 * Reads quota-exhaustion signals from an upstream error body. Each provider
 * says "the plan's window is used up, come back at T" its own way; the proxy
 * turns that into a route cooldown that lasts until T instead of the short
 * rate-limit default.
 *
 * Sources: docs/externos/assinatura/sub-openai.md G4, sub-gemini.md G4,
 * sub-zai.md G2, sub-minimax.md G3.
 */

export interface QuotaSignal {
  /** The plan's quota is used up (not a short burst limit). */
  exhausted: boolean;
  /** Milliseconds until the quota resets, when the body states it. */
  resetInMs?: number;
}

/** Errors that already name an exhausted quota (OpenCode, OpenAI). */
const QUOTA_EXHAUSTED_RE =
  /freeusagelimiterror|gousagelimiterror|budgetlimiterror|creditlimitexceeded|insufficient_quota|credit_balance_exhausted/i;

const CODEX_EXHAUSTED_TYPES = new Set(['usage_limit_reached', 'usage_not_included']);
const GOOGLE_EXHAUSTED_REASONS = new Set([
  'QUOTA_EXHAUSTED',
  'MODEL_CAPACITY_EXHAUSTED',
  'INSUFFICIENT_G1_CREDITS_BALANCE',
]);
/** GLM Coding Plan: no balance, 5 h / weekly / monthly windows used up, plan expired, fair-use block. */
const ZAI_EXHAUSTED_CODES = new Set([
  '1113',
  '1308',
  '1309',
  '1310',
  '1313',
  '1316',
  '1317',
  '1318',
  '1319',
  '1320',
  '1321',
]);
/** MiniMax M Plan: 5 h window used up (2056) or quota out without credits (2067). */
const MINIMAX_EXHAUSTED_CODES = new Set([2056, 2067]);
/** Z.ai states resets as `YYYY-MM-DD HH:MM:SS` in China time (UTC+8). */
const ZAI_RESET_RE = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveMs(ms: number): number | undefined {
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

/** Google `RetryInfo.retryDelay` (`"3600s"`, `"1.5s"`). */
function parseDurationMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  return match ? positiveMs(Number(match[1]) * 1000) : undefined;
}

function codexSignal(error: Record<string, unknown>, now: number): QuotaSignal | null {
  const type = typeof error.type === 'string' ? error.type : error.code;
  if (typeof type !== 'string' || !CODEX_EXHAUSTED_TYPES.has(type)) return null;
  const resetsAt = Number(error.resets_at);
  const resetsIn = Number(error.resets_in_seconds);
  const resetInMs = positiveMs(resetsAt * 1000 - now) ?? positiveMs(resetsIn * 1000) ?? undefined;
  return { exhausted: true, resetInMs };
}

function googleSignal(error: Record<string, unknown>): QuotaSignal | null {
  if (!Array.isArray(error.details)) return null;
  let exhausted = false;
  let resetInMs: number | undefined;
  for (const raw of error.details) {
    const detail = asRecord(raw);
    if (!detail) continue;
    const type = String(detail['@type'] ?? '');
    if (
      type.endsWith('google.rpc.ErrorInfo') &&
      GOOGLE_EXHAUSTED_REASONS.has(String(detail.reason))
    ) {
      exhausted = true;
    }
    if (type.endsWith('google.rpc.RetryInfo')) {
      resetInMs = parseDurationMs(detail.retryDelay) ?? resetInMs;
    }
  }
  if (!exhausted) return null;
  return { exhausted, resetInMs };
}

function zaiSignal(error: Record<string, unknown>, now: number): QuotaSignal | null {
  const code = error.code === undefined ? '' : String(error.code);
  if (!ZAI_EXHAUSTED_CODES.has(code)) return null;
  const match = typeof error.message === 'string' ? ZAI_RESET_RE.exec(error.message) : null;
  const resetAt = match ? Date.parse(`${match[1]}T${match[2]}+08:00`) : NaN;
  return { exhausted: true, resetInMs: positiveMs(resetAt - now) };
}

function minimaxSignal(body: Record<string, unknown>): QuotaSignal | null {
  const baseResp = asRecord(body.base_resp);
  const code = Number(baseResp?.status_code);
  return MINIMAX_EXHAUSTED_CODES.has(code) ? { exhausted: true } : null;
}

/**
 * The quota signal in an upstream error body, or null when the body does not
 * report an exhausted quota.
 */
export function parseQuotaSignal(bodyText: string, now = Date.now()): QuotaSignal | null {
  if (!bodyText) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // Not JSON: only the generic pattern can match.
  }
  const body = asRecord(Array.isArray(parsed) ? parsed[0] : parsed);
  if (body) {
    const error = asRecord(body.error);
    const signal =
      (error && (codexSignal(error, now) ?? googleSignal(error) ?? zaiSignal(error, now))) ??
      minimaxSignal(body);
    if (signal) return signal;
  }
  return QUOTA_EXHAUSTED_RE.test(bodyText) ? { exhausted: true } : null;
}
