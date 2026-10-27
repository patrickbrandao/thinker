import { TenantCacheService } from '../common/services/tenant-cache.service';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '../auth/mcp-scopes';
import type { OrganizationRole } from '../entities/organization-member.entity';
import { hasRole } from '../common/guards/roles.guard';

/** The claims carried by one verified OAuth access token. */
export interface McpAccessTokenClaims {
  sub?: string;
  scope?: unknown;
}

/** The operator and capabilities carried by one verified OAuth access token. */
export interface McpOperator {
  userId: string;
  tenantId: string;
  scopes: ReadonlySet<string>;
  /** Role in the active organization (ADR 0006); caps what the scopes allow. */
  role: OrganizationRole;
}

/**
 * Write access for a tool family: the token's write scope AND the
 * organization role (agents need `member`; providers and routing `admin`).
 */
export function canWrite(operator: McpOperator, required: OrganizationRole = 'member'): boolean {
  return operator.scopes.has(MCP_WRITE_SCOPE) && hasRole(operator.role, required);
}

/** Convert the OAuth JWT's space-separated scope claim to exact capabilities. */
export function scopesFromClaims(claims: McpAccessTokenClaims): ReadonlySet<string> {
  if (typeof claims.scope !== 'string') return new Set();
  return new Set(claims.scope.split(' ').filter(Boolean));
}

export { MCP_READ_SCOPE, MCP_WRITE_SCOPE };

/**
 * Resolve the subject of a cryptographically verified MCP access token to an
 * acting operator.
 *
 * Signature, issuer, audience, expiry, and baseline scope checks happen before
 * this function — `createMcpProtectedRequestHandler` owns them. Here we only map `sub` (a Better
 * Auth user id) to that user's tenant through the same cache the session guard
 * uses, so every tool is scoped exactly like the dashboard and CLI are.
 *
 * Returns null when the user has no tenant yet; the MCP route answers 401 so a
 * deleted or tenant-less account can never act.
 */
export async function resolveMcpOperator(
  tenantCache: TenantCacheService,
  claims: McpAccessTokenClaims,
): Promise<McpOperator | null> {
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  const access = await tenantCache.resolveAccess(claims.sub);
  if (!access.tenantId || access.mustChangePassword) return null;
  return {
    userId: claims.sub,
    tenantId: access.tenantId,
    scopes: scopesFromClaims(claims),
    role: access.role ?? 'viewer',
  };
}
