import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { INSTANCE_ADMIN_KEY, MIN_ROLE_KEY, MinRoleMetadata } from '../decorators/roles.decorator';
import { RequestWithTenantContext } from '../decorators/tenant-context.decorator';
import { ORGANIZATION_ROLES, OrganizationRole } from '../../entities/organization-member.entity';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function roleRank(role: OrganizationRole): number {
  return ORGANIZATION_ROLES.indexOf(role);
}

export function hasRole(role: OrganizationRole, required: OrganizationRole): boolean {
  return roleRank(role) >= roleRank(required);
}

/**
 * Organization role check (ADR 0006). Runs after SessionGuard/ApiKeyGuard,
 * which put the active organization and role on the request. A user with no
 * organization yet acts as owner of the personal one their first mutation
 * creates.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & RequestWithTenantContext>();
    const ctx = request.tenantContext;
    if (!ctx) return true; // No tenant credential: the auth guards decide.

    if (this.reflector.getAllAndOverride<boolean>(INSTANCE_ADMIN_KEY, targets)) {
      if (ctx.isInstanceAdmin) return true;
      throw new ForbiddenException({
        message: 'Only the instance administrator can do this.',
        code: 'insufficient_role',
      });
    }

    if (ctx.role === undefined) return true; // Internal context, not a user credential.
    const meta = this.reflector.getAllAndOverride<MinRoleMetadata>(MIN_ROLE_KEY, targets);
    const isRead = READ_METHODS.has(request.method);
    const required: OrganizationRole =
      meta && (!isRead || meta.includeReads) ? meta.role : isRead ? 'viewer' : 'member';
    const role: OrganizationRole = ctx.role ?? (ctx.tenantId ? 'viewer' : 'owner');
    if (hasRole(role, required)) return true;
    throw new ForbiddenException({
      message: `This action needs the ${required} role in the organization (you are ${role}).`,
      code: 'insufficient_role',
    });
  }
}
