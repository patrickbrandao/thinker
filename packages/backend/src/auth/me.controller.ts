import { Controller, Get, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import { organizationName } from '../organizations/organizations.service';
import { Request } from 'express';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { MinRole } from '../common/decorators/roles.decorator';

/**
 * Cheap identity probe for CLI/API clients. `@TenantCtx()` fails closed with
 * a 401 when no credential attached a tenant context, so the env `API_KEY`
 * operator fallback (which attaches none) is rejected here by design — the
 * CLI contract promises a tenant identity, not just "some credential worked".
 */
@MinRole('viewer')
@Controller('api/v1/me')
export class MeController {
  constructor(@InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>) {}

  @Get()
  async me(@TenantCtx() ctx: TenantContext, @Req() request: Request) {
    const r = request as Request & { authMethod?: string; apiKeyExpiresAt?: string | null };
    const tenant = ctx.tenantId
      ? await this.tenantRepo.findOne({ where: { id: ctx.tenantId } })
      : null;
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      isInstanceAdmin: ctx.isInstanceAdmin === true,
      mustChangePassword: ctx.mustChangePassword === true,
      organization: tenant
        ? { id: tenant.id, name: organizationName(tenant), role: ctx.role ?? 'viewer' }
        : null,
      authMethod: r.authMethod ?? null,
      expiresAt: r.apiKeyExpiresAt ?? null,
    };
  }
}
