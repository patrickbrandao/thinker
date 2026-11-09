import { createHmac } from 'crypto';

/**
 * Root token, minted locally from THINKER_ENCRYPTION_KEY when the CLI runs
 * with the server's own environment (inside the container, or `docker run`
 * with the same env). Same algorithm as
 * packages/backend/src/common/utils/root-token.ts; valid for 5 minutes.
 */
export const ROOT_TOKEN_PREFIX = 'thk_root_v1.';

export function signRootToken(
  secret: string,
  email = '',
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const key = createHmac('sha256', secret).update('thinker-root-token-v1').digest();
  const user = Buffer.from(email, 'utf8').toString('base64url');
  const sig = createHmac('sha256', key).update(`v1.${nowSeconds}.${user}`).digest('base64url');
  return `${ROOT_TOKEN_PREFIX}${nowSeconds}.${user}.${sig}`;
}
