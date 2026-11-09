import { ForbiddenException } from '@nestjs/common';
import type { TenantContext } from '../decorators/tenant-context.decorator';

/**
 * Who may point the gateway at the instance's own network (#78) or at the
 * host's local runners — Ollama, LM Studio, llama.cpp (#102). ADR 0006.
 *
 *   allow       anyone allowed to connect providers;
 *   admin-only  the instance admin and organization owners (default);
 *   deny        nobody.
 *
 * Cloud metadata endpoints stay blocked in every mode (validatePublicUrl).
 */
export const PRIVATE_URLS_ENV = 'THINKER_PROVIDER_PRIVATE_URLS';
export type PrivateUrlPolicy = 'allow' | 'admin-only' | 'deny';

export function privateUrlPolicy(env: NodeJS.ProcessEnv = process.env): PrivateUrlPolicy {
  const value = env[PRIVATE_URLS_ENV]?.trim().toLowerCase();
  return value === 'allow' || value === 'deny' ? value : 'admin-only';
}

export function canUsePrivateDestinations(
  ctx: Pick<TenantContext, 'role' | 'isInstanceAdmin'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const policy = privateUrlPolicy(env);
  if (policy === 'allow') return true;
  if (policy === 'deny') return false;
  // Internal contexts (no role at all) are not user credentials.
  if (ctx.role === undefined) return true;
  return ctx.isInstanceAdmin === true || ctx.role === 'owner';
}

/**
 * Whether a stored destination may reach private and LAN addresses at connect
 * time. `stored` is what the policy said for whoever registered it
 * (`allow_private_destination`); `allow` lets every destination through.
 * Rows registered before the column existed default to true, so destinations
 * already in use keep working (ADR 0006 item 7).
 */
export function allowsPrivateDestination(
  stored: boolean | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return privateUrlPolicy(env) === 'allow' || stored !== false;
}

export function assertCanUseLocalRunners(
  ctx: Pick<TenantContext, 'role' | 'isInstanceAdmin'>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (canUsePrivateDestinations(ctx, env)) return;
  throw new ForbiddenException({
    message:
      privateUrlPolicy(env) === 'deny'
        ? 'Local runners are disabled on this instance.'
        : 'Only the instance administrator or an organization owner can connect local runners.',
    code: 'private_destination_forbidden',
  });
}
