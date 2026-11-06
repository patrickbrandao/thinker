/**
 * Same-route retry of a transient upstream failure (report from NOC Norte,
 * P4). Env:
 * - THINKER_UPSTREAM_RETRY_MODE: `off` | `last-route` (default: only when the
 *   chain has no other route left) | `always`;
 * - THINKER_UPSTREAM_RETRIES: 0 to 5 (default 1);
 * - THINKER_UPSTREAM_RETRY_DELAY_MS: 0 to 60000 (default 1000);
 * - THINKER_UPSTREAM_RETRY_STATUSES: CSV of 4xx/5xx (default 500,502,503; a
 *   504 timeout is left out on purpose, a repeat doubles the wait).
 */

export type UpstreamRetryMode = 'off' | 'last-route' | 'always';

export interface UpstreamRetryPolicy {
  mode: UpstreamRetryMode;
  retries: number;
  delayMs: number;
  statuses: ReadonlySet<number>;
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = (raw ?? '').trim();
  if (!/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= min && n <= max ? n : fallback;
}

export function parseUpstreamRetryPolicy(
  env: NodeJS.ProcessEnv = process.env,
): UpstreamRetryPolicy {
  const rawMode = (env.THINKER_UPSTREAM_RETRY_MODE ?? '').trim().toLowerCase();
  const mode: UpstreamRetryMode = /^(0|false|off|no)$/.test(rawMode)
    ? 'off'
    : rawMode === 'always'
      ? 'always'
      : 'last-route';
  const statuses = new Set(
    (env.THINKER_UPSTREAM_RETRY_STATUSES ?? '500,502,503')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 400 && n <= 599),
  );
  const retries = boundedInt(env.THINKER_UPSTREAM_RETRIES, 1, 0, 5);
  return {
    mode: retries === 0 ? 'off' : mode,
    retries,
    delayMs: boundedInt(env.THINKER_UPSTREAM_RETRY_DELAY_MS, 1000, 0, 60_000),
    statuses,
  };
}

/** Wait `ms`, or less if the client hangs up. False when aborted. */
export function waitUnlessAborted(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (ms <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
