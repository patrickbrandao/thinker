import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import type { OrganizationRole } from '../../entities/organization-member.entity';

/**
 * The single request-scoped ownership concept. Every resource belongs to a
 * tenant; the user only authenticates and (optionally) appears as audit
 * metadata. Controllers scope queries by `tenantId` and thread `userId` only
 * into `created_by_user_id` audit writes.
 */
export interface TenantContext {
  /**
   * The tenant resolved for this request. Null when the authenticated user
   * has no tenant yet (fresh account before the first agent is created) —
   * read endpoints should return empty data, mutating endpoints either 404
   * or lazily create the tenant via TenantCacheService.ensureForUser().
   */
  tenantId: string | null;
  /** The authenticated user, when one exists. Attribution only — never scope by it. */
  userId: string | null;
  /**
   * The user's role in the active organization (ADR 0006). Null when the user
   * belongs to none yet: their first mutation creates a personal organization
   * they own. Undefined only for internal contexts that skip the auth guards.
   */
  role?: OrganizationRole | null;
  /** Instance administrator: manages accounts and every organization. */
  isInstanceAdmin?: boolean;
  /** The account still has a temporary password (ADR 0006). */
  mustChangePassword?: boolean;
}

export type RequestWithTenantContext = Request & { tenantContext?: TenantContext };

/**
 * Injects the TenantContext attached by SessionGuard / ApiKeyGuard. Fails
 * closed with a 401 when no credential established a context (same contract
 * as @CurrentUser).
 */
export const TenantCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<RequestWithTenantContext>();
  if (!request.tenantContext) {
    throw new UnauthorizedException(
      'This endpoint requires a tenant-scoped credential (session cookie or API key).',
    );
  }
  return request.tenantContext;
});
