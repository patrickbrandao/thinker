import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Root token: a short-lived credential the `thinker` CLI mints by itself when
 * it runs with the server's own environment (inside the container, or a
 * `docker run` with the same env file). Whoever holds THINKER_ENCRYPTION_KEY
 * can already decrypt every secret and edit the database, so proving that
 * knowledge is enough to act as the instance administrator.
 *
 * Format: `thk_root_v1.<unix-seconds>.<base64url(email or "")>.<base64url(hmac)>`
 * where hmac = HMAC-SHA256(K, "v1.<ts>.<user>") and
 * K = HMAC-SHA256(THINKER_ENCRYPTION_KEY, "thinker-root-token-v1").
 * The same algorithm lives in packages/cli/src/root-token.ts.
 */
export const ROOT_TOKEN_PREFIX = 'thk_root_v1.';
/** Accepted clock skew in either direction. */
export const ROOT_TOKEN_WINDOW_SECONDS = 300;

function signingKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('thinker-root-token-v1').digest();
}

export function signRootToken(secret: string, email = '', nowSeconds = nowSec()): string {
  const user = Buffer.from(email, 'utf8').toString('base64url');
  const payload = `v1.${nowSeconds}.${user}`;
  const sig = createHmac('sha256', signingKey(secret)).update(payload).digest('base64url');
  return `${ROOT_TOKEN_PREFIX}${nowSeconds}.${user}.${sig}`;
}

export type RootTokenResult = { ok: true; email: string | null } | { ok: false; reason: string };

/** Verifies against each candidate secret (current, then previous key). */
export function verifyRootToken(
  token: string,
  secrets: readonly string[],
  nowSeconds = nowSec(),
): RootTokenResult {
  if (!token.startsWith(ROOT_TOKEN_PREFIX)) return { ok: false, reason: 'format' };
  const parts = token.slice(ROOT_TOKEN_PREFIX.length).split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const [tsRaw, user, sig] = parts;
  if (!/^\d{1,12}$/.test(tsRaw)) return { ok: false, reason: 'format' };
  const ts = Number(tsRaw);
  if (Math.abs(nowSeconds - ts) > ROOT_TOKEN_WINDOW_SECONDS)
    return { ok: false, reason: 'expired' };
  const payload = `v1.${tsRaw}.${user}`;
  const given = Buffer.from(sig, 'base64url');
  const matches = secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac('sha256', signingKey(secret)).update(payload).digest();
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!matches) return { ok: false, reason: 'signature' };
  const email = Buffer.from(user, 'base64url').toString('utf8').trim();
  return { ok: true, email: email || null };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
