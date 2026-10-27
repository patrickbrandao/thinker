import {
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

  @Post()
  @InstanceAdminOnly()
  create(@TenantCtx() ctx: TenantContext, @Body() body: { name: string }) {
    return this.organizations.create(body?.name, requireUser(ctx));
  }

  @Patch(':id')
  rename(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() body: { name: string }) {
    return this.organizations.rename(requireUser(ctx), id, body?.name);
  }

  @Delete(':id')
  async remove(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    await this.organizations.deactivate(requireUser(ctx), id);
    return { ok: true };
  }

  @Get(':id/members')
  async members(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return { members: await this.organizations.listMembers(requireUser(ctx), id) };
  }

  @Post(':id/members')
  addMember(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { email: string; name?: string; role: string },
  ) {
    return this.organizations.addMember(requireUser(ctx), id, body ?? ({} as never));
  }

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
    await this.organizations.roleOf(userId, body?.organizationId);
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
    const { account, temporaryPassword } = await this.accounts.createAccount(
      body?.email ?? '',
      body?.name ?? '',
      body?.isInstanceAdmin === true,
    );
    if (body.organizationId) {
      await this.organizations.addExistingMember(
        requireUser(ctx),
        body.organizationId,
        account.id,
        body.role ?? 'member',
      );
    }
    return { user: account, temporaryPassword };
  }

  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string) {
    return { temporaryPassword: await this.accounts.resetPassword(id) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { isInstanceAdmin: boolean }) {
    return { user: await this.accounts.setInstanceAdmin(id, body?.isInstanceAdmin === true) };
  }
}
