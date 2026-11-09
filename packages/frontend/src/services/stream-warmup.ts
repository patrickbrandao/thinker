import { t } from '../i18n/index.js';

/**
 * Stream warm-up override (#244): how long the gateway waits for the first
 * streamed chunk before failing over. The UI edits seconds; the API stores ms
 * (1000..600000, null inherits the next level).
 */
export const MIN_STREAM_WARMUP_SECONDS = 1;
export const MAX_STREAM_WARMUP_SECONDS = 600;

/** Validation message for an out-of-range warm-up, in the active language. */
export function streamWarmupError(): string {
  return t('routing.warmupError', {
    min: MIN_STREAM_WARMUP_SECONDS,
    max: MAX_STREAM_WARMUP_SECONDS,
  });
}

/** Stored ms to the text shown in the seconds input ('' when unset). */
export function warmupMsToSecondsInput(ms: number | null | undefined): string {
  return ms == null ? '' : String(ms / 1000);
}

/** Seconds input to ms for the API: null for empty, undefined when invalid. */
export function parseWarmupSeconds(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  const seconds = Number(text);
  if (
    !Number.isFinite(seconds) ||
    seconds < MIN_STREAM_WARMUP_SECONDS ||
    seconds > MAX_STREAM_WARMUP_SECONDS
  ) {
    return undefined;
  }
  return Math.round(seconds * 1000);
}

/**
 * Stream idle timeout override: the longest pause allowed between two chunks
 * of a streaming response before the attempt fails. Same shape as the warm-up:
 * the UI edits seconds, the API stores ms (1000..3600000, null inherits).
 */
export const MIN_STREAM_IDLE_SECONDS = 1;
export const MAX_STREAM_IDLE_SECONDS = 3600;

/** Validation message for an out-of-range idle timeout, in the active language. */
export function streamIdleError(): string {
  return t('routing.warmupError', {
    min: MIN_STREAM_IDLE_SECONDS,
    max: MAX_STREAM_IDLE_SECONDS,
  });
}

/** Stored ms to the text shown in the seconds input ('' when unset). */
export const idleMsToSecondsInput = warmupMsToSecondsInput;

/** Seconds input to ms for the API: null for empty, undefined when invalid. */
export function parseIdleSeconds(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  const seconds = Number(text);
  if (
    !Number.isFinite(seconds) ||
    seconds < MIN_STREAM_IDLE_SECONDS ||
    seconds > MAX_STREAM_IDLE_SECONDS
  ) {
    return undefined;
  }
  return Math.round(seconds * 1000);
}
