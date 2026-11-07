import { Audit } from '../alerts/audit.decorator';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { InstanceAdminOnly, MinRole } from '../common/decorators/roles.decorator';
import { OrganizationsService } from './organizations.service';
import { AccountsService } from './accounts.service';

/** Node request headers as a Fetch `Headers` (what Better Auth's API takes). */
function toHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (typeof value === 'string') headers.set(key, value);
  }
  return headers;
}

function requireUser(ctx: TenantContext): string {
  if (!ctx.userId) throw new UnauthorizedException('A user credential is required.');
  return ctx.userId;
}

/**
 * Organizations and members (ADR 0006). The role check runs per
 * organization in the service, against the `:id` in the path, so the
 * global guard only needs an authenticated user here.
 */
@MinRole('viewer')
@Controller('api/v1/organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  async list(@TenantCtx() ctx: TenantContext) {
    return {
      organizations: await this.organizations.listForUser(
        requireUser(ctx),
        ctx.isInstanceAdmin === true,
      ),
    };
  }

  @Audit({ entity: 'workspace', action: 'created' })
  @Post()
  @InstanceAdminOnly()
  create(@TenantCtx() ctx: TenantContext, @Body() body: { name: string }) {
    return this.organizations.create(body?.name, requireUser(ctx));
  }

  @Audit({
    entity: 'workspace',
    action: 'updated',
    lookup: { table: 'tenants', nameColumn: 'name', tenantScoped: false },
  })
  @Patch(':id')
  rename(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() body: { name: string }) {
    return this.organizations.rename(requireUser(ctx), id, body?.name);
  }

  @Audit({
    entity: 'workspace',
    action: 'deleted',
    lookup: { table: 'tenants', nameColumn: 'name', tenantScoped: false },
  })
  @Delete(':id')
  async remove(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    await this.organizations.deactivate(requireUser(ctx), id);
    return { ok: true };
  }

  @Get(':id/log-retention')
  logRetention(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.organizations.getLogRetention(requireUser(ctx), id);
  }

  @Audit({
    entity: 'workspace',
    action: 'updated',
    lookup: { table: 'tenants', nameColumn: 'name', tenantScoped: false },
  })
  @Patch(':id/log-retention')
  setLogRetention(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { retention_days?: number | null },
  ) {
    return this.organizations.setLogRetention(requireUser(ctx), id, body?.retention_days ?? null);
  }

  @Get(':id/members')
  async members(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return { members: await this.organizations.listMembers(requireUser(ctx), id) };
  }

  @Audit({ entity: 'member', action: 'created' })
  @Post(':id/members')
  addMember(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { email: string; name?: string; role: string },
  ) {
    return this.organizations.addMember(requireUser(ctx), id, body ?? ({} as never));
  }

  @Audit({
    entity: 'member',
    action: 'updated',
    idParam: 'userId',
    lookup: { table: 'user', nameColumn: 'email', tenantScoped: false },
  })
  @Patch(':id/members/:userId')
  async changeRole(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('userId') memberId: string,
    @Body() body: { role: string },
  ) {
    return {
      member: await this.organizations.changeRole(requireUser(ctx), id, memberId, body?.role),
    };
  }

  @Audit({
    entity: 'member',
    action: 'deleted',
    idParam: 'userId',
    lookup: { table: 'user', nameColumn: 'email', tenantScoped: false },
  })
  @Delete(':id/members/:userId')
  async removeMember(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('userId') memberId: string,
  ) {
    await this.organizations.removeMember(requireUser(ctx), id, memberId);
    return { ok: true };
  }
}

/** The caller's own account: password change and active organization. */
@MinRole('viewer')
@Controller('api/v1/me')
export class MeAccountController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Post('password')
  async changePassword(
    @TenantCtx() ctx: TenantContext,
    @Req() req: Request,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    await this.accounts.changeOwnPassword(
      requireUser(ctx),
      toHeaders(req),
      body?.currentPassword ?? '',
      body?.newPassword ?? '',
    );
    return { ok: true };
  }

  @Put('active-organization')
  async setActive(@TenantCtx() ctx: TenantContext, @Body() body: { organizationId: string }) {
    const userId = requireUser(ctx);
    if (typeof body?.organizationId !== 'string' || !body.organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    await this.organizations.roleOf(userId, body.organizationId);
    await this.accounts.setActiveOrganization(userId, body.organizationId);
    return { ok: true };
  }
}

/** Accounts across the instance (instance administrator only). */
@InstanceAdminOnly()
@Controller('api/v1/admin/users')
export class AdminUsersController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get()
  async list() {
    const [users, memberships] = await Promise.all([
      this.accounts.listAccounts(),
      this.organizations.allMemberships(),
    ]);
    return {
      users: users.map((u) => ({
        ...u,
        organizations: memberships.filter((m) => m.userId === u.id).map(({ userId: _, ...m }) => m),
      })),
    };
  }

  @Audit({ entity: 'user', action: 'created' })
  @Post()
  async create(
    @TenantCtx() ctx: TenantContext,
    @Body()
    body: {
      email: string;
      name: string;
      isInstanceAdmin?: boolean;
      organizationId?: string;
      role?: string;
    },
  ) {
    // Validate the membership first: the temporary password is shown once,
    // so a bad organization or role must fail before the account exists.
    if (body?.organizationId) {
      await this.organizations.assertCanAddMember(
        requireUser(ctx),
        body.organizationId,
        body.role ?? 'member',
      );
    }
    const { account, temporaryPassword } = await this.accounts.createAccount(
      body?.email ?? '',
      body?.name ?? '',
      body?.isInstanceAdmin === true,
    );
    if (body?.organizationId) {
      await this.organizations.addExistingMember(
        requireUser(ctx),
        body.organizationId,
        account.id,
        body.role ?? 'member',
      );
    }
    return { user: account, temporaryPassword };
  }

  @Audit({
    entity: 'user',
    action: 'updated',
    lookup: { table: 'user', nameColumn: 'email', tenantScoped: false },
  })
  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string) {
    return { temporaryPassword: await this.accounts.resetPassword(id) };
  }

  @Audit({
    entity: 'user',
    action: 'updated',
    lookup: { table: 'user', nameColumn: 'email', tenantScoped: false },
  })
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { isInstanceAdmin: boolean }) {
    return { user: await this.accounts.setInstanceAdmin(id, body?.isInstanceAdmin === true) };
  }
}
