import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_RECORDING_RETENTION_DAYS,
  MAX_LOG_RETENTION_DAYS,
  parseLogRetentionDays,
} from '../config/recording-retention';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Tenant } from '../entities/tenant.entity';
import {
  ORGANIZATION_ROLES,
  OrganizationMember,
  OrganizationRole,
} from '../entities/organization-member.entity';
import { TenantCacheService } from '../common/services/tenant-cache.service';
import { hasRole } from '../common/guards/roles.guard';
import { AccountsService } from './accounts.service';

export interface OrganizationView {
  id: string;
  name: string;
  role: OrganizationRole;
}

export interface MemberView {
  userId: string;
  email: string;
  name: string;
  role: OrganizationRole;
  mustChangePassword: boolean;
}

/** Display name of an organization: its label, else the internal name. */
export function organizationName(tenant: Pick<Tenant, 'name' | 'organization_name'>): string {
  return tenant.organization_name?.trim() || tenant.name;
}

export function assertRole(value: unknown): OrganizationRole {
  if (typeof value === 'string' && (ORGANIZATION_ROLES as readonly string[]).includes(value)) {
    return value as OrganizationRole;
  }
  throw new BadRequestException(`role must be one of ${ORGANIZATION_ROLES.join(', ')}`);
}

export interface LogRetentionView {
  retention_days: number | null;
  default_days: number;
}

/** Organizations and their members (ADR 0006). */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(OrganizationMember)
    private readonly memberRepo: Repository<OrganizationMember>,
    private readonly tenantCache: TenantCacheService,
    private readonly accounts: AccountsService,
    private readonly config: ConfigService,
  ) {}

  /** The caller's organizations; the instance admin sees every active one. */
  async listForUser(userId: string, isInstanceAdmin: boolean): Promise<OrganizationView[]> {
    const rows = (await this.ds.query(
      `SELECT t.id, t.name, t.organization_name, m.role
         FROM tenants t
         LEFT JOIN organization_members m ON m.tenant_id = t.id AND m.user_id = $1
        WHERE t.is_active AND ($2::boolean OR m.user_id IS NOT NULL)
        ORDER BY COALESCE(NULLIF(TRIM(t.organization_name), ''), t.name) ASC`,
      [userId, isInstanceAdmin],
    )) as Array<{
      id: string;
      name: string;
      organization_name: string | null;
      role: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: organizationName(r),
      role: (r.role as OrganizationRole | null) ?? 'owner',
    }));
  }

  async get(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId, is_active: true } });
    if (!tenant) throw new NotFoundException('Organization not found.');
    return tenant;
  }

  /** The caller's role in an organization (403 when not a member). */
  async roleOf(userId: string, tenantId: string): Promise<OrganizationRole> {
    await this.get(tenantId);
    const access = await this.tenantCache.resolveAccess(userId, tenantId);
    return access.role ?? 'viewer';
  }

  async create(name: string, creatorUserId: string): Promise<OrganizationView> {
    const label = name?.trim();
    if (!label) throw new BadRequestException('name is required');
    const id = randomUUID();
    await this.tenantRepo.insert({ id, name: id, organization_name: label, is_active: true });
    await this.tenantCache.addMember(id, creatorUserId, 'owner');
    return { id, name: label, role: 'owner' };
  }

  async rename(
    userId: string,
    tenantId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    await this.require(userId, tenantId, 'owner');
    const label = name?.trim();
    if (!label) throw new BadRequestException('name is required');
    await this.tenantRepo.update({ id: tenantId }, { organization_name: label });
    return { id: tenantId, name: label };
  }

  /**
   * Organization-wide log retention: `retention_days` is the stored value
   * (null follows THINKER_RECORDING_RETENTION_DAYS, reported as `default_days`).
   */
  async getLogRetention(userId: string, tenantId: string): Promise<LogRetentionView> {
    await this.require(userId, tenantId, 'viewer');
    const tenant = await this.get(tenantId);
    return this.logRetentionView(tenant.log_retention_days ?? null);
  }

  async setLogRetention(
    userId: string,
    tenantId: string,
    days: unknown,
  ): Promise<LogRetentionView> {
    await this.require(userId, tenantId, 'owner');
    const parsed = parseLogRetentionDays(days);
    if (parsed === undefined) {
      throw new BadRequestException(
        `retention_days must be null or an integer from 1 to ${MAX_LOG_RETENTION_DAYS}`,
      );
    }
    await this.tenantRepo.update({ id: tenantId }, { log_retention_days: parsed });
    return this.logRetentionView(parsed);
  }

  private logRetentionView(days: number | null): LogRetentionView {
    return {
      retention_days: days,
      default_days:
        this.config.get<number>('app.requestRecordingRetentionDays') ??
        DEFAULT_RECORDING_RETENTION_DAYS,
    };
  }

  /** Deactivates the organization; its data stays, nobody can select it. */
  async deactivate(userId: string, tenantId: string): Promise<void> {
    await this.require(userId, tenantId, 'owner');
    await this.tenantRepo.update({ id: tenantId }, { is_active: false });
    await this.invalidateMembers(tenantId);
  }

  async listMembers(userId: string, tenantId: string): Promise<MemberView[]> {
    await this.require(userId, tenantId, 'viewer');
    return this.ds.query(
      `SELECT m.user_id AS "userId", u.email, u.name, m.role,
              COALESCE(p.must_change_password, false) AS "mustChangePassword"
         FROM organization_members m
         JOIN "user" u ON u.id = m.user_id
         LEFT JOIN user_profiles p ON p.user_id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY m.created_at ASC`,
      [tenantId],
    );
  }

  /**
   * Adds a member by email. An unknown email gets a new account with a
   * temporary password, returned once. Admins cannot grant `owner`.
   */
  async addMember(
    userId: string,
    tenantId: string,
    input: { email: string; name?: string; role: unknown },
  ): Promise<{ member: MemberView; temporaryPassword: string | null }> {
    const callerRole = await this.require(userId, tenantId, 'admin');
    const role = assertRole(input.role);
    this.assertCanGrant(callerRole, role);
    if (!input.email?.includes('@')) throw new BadRequestException('A valid email is required.');

    let account = await this.accounts.findByEmail(input.email);
    let temporaryPassword: string | null = null;
    if (!account) {
      const created = await this.accounts.createAccount(input.email, input.name ?? '');
      account = created.account;
      temporaryPassword = created.temporaryPassword;
    } else if (
      await this.memberRepo.exists({ where: { tenant_id: tenantId, user_id: account.id } })
    ) {
      throw new ConflictException('This account is already a member.');
    }
    await this.tenantCache.addMember(tenantId, account.id, role);
    return { member: await this.member(tenantId, account.id), temporaryPassword };
  }

  /** Adds an existing account (instance admin flow: create user into an org). */
  async addExistingMember(
    userId: string,
    tenantId: string,
    memberId: string,
    roleInput: unknown,
  ): Promise<void> {
    const callerRole = await this.require(userId, tenantId, 'admin');
    const role = assertRole(roleInput);
    this.assertCanGrant(callerRole, role);
    await this.tenantCache.addMember(tenantId, memberId, role);
  }

  /** Every active membership, for the instance admin's user list. */
  async allMemberships(): Promise<
    Array<{ userId: string; id: string; name: string; role: OrganizationRole }>
  > {
    const rows = (await this.ds.query(
      `SELECT m.user_id AS "userId", t.id, t.name, t.organization_name, m.role
         FROM organization_members m
         JOIN tenants t ON t.id = m.tenant_id AND t.is_active
        ORDER BY m.created_at ASC`,
    )) as Array<{
      userId: string;
      id: string;
      name: string;
      organization_name: string | null;
      role: OrganizationRole;
    }>;
    return rows.map((r) => ({
      userId: r.userId,
      id: r.id,
      name: organizationName(r),
      role: r.role,
    }));
  }

  async changeRole(
    userId: string,
    tenantId: string,
    memberId: string,
    roleInput: unknown,
  ): Promise<MemberView> {
    const callerRole = await this.require(userId, tenantId, 'admin');
    const role = assertRole(roleInput);
    const current = await this.member(tenantId, memberId);
    this.assertCanGrant(callerRole, role);
    this.assertCanGrant(callerRole, current.role);
    if (current.role === 'owner' && role !== 'owner') await this.assertNotLastOwner(tenantId);
    await this.tenantCache.addMember(tenantId, memberId, role);
    return this.member(tenantId, memberId);
  }

  async removeMember(userId: string, tenantId: string, memberId: string): Promise<void> {
    const callerRole = await this.require(userId, tenantId, 'admin');
    const current = await this.member(tenantId, memberId);
    this.assertCanGrant(callerRole, current.role);
    if (current.role === 'owner') await this.assertNotLastOwner(tenantId);
    await this.memberRepo.delete({ tenant_id: tenantId, user_id: memberId });
    this.tenantCache.invalidate(memberId);
  }

  private async member(tenantId: string, memberId: string): Promise<MemberView> {
    const rows = (await this.ds.query(
      `SELECT m.user_id AS "userId", u.email, u.name, m.role,
              COALESCE(p.must_change_password, false) AS "mustChangePassword"
         FROM organization_members m
         JOIN "user" u ON u.id = m.user_id
         LEFT JOIN user_profiles p ON p.user_id = m.user_id
        WHERE m.tenant_id = $1 AND m.user_id = $2`,
      [tenantId, memberId],
    )) as MemberView[];
    if (!rows[0]) throw new NotFoundException('Member not found.');
    return rows[0];
  }

  private async require(
    userId: string,
    tenantId: string,
    required: OrganizationRole,
  ): Promise<OrganizationRole> {
    const role = await this.roleOf(userId, tenantId);
    if (!hasRole(role, required)) {
      throw new ForbiddenException({
        message: `This action needs the ${required} role in the organization (you are ${role}).`,
        code: 'insufficient_role',
      });
    }
    return role;
  }

  /** Only an owner grants, changes or removes the owner role. */
  private assertCanGrant(callerRole: OrganizationRole, role: OrganizationRole): void {
    if (role === 'owner' && callerRole !== 'owner') {
      throw new ForbiddenException({
        message: 'Only an owner can grant or change the owner role.',
        code: 'insufficient_role',
      });
    }
  }

  private async assertNotLastOwner(tenantId: string): Promise<void> {
    const owners = await this.memberRepo.count({ where: { tenant_id: tenantId, role: 'owner' } });
    if (owners <= 1) throw new ConflictException('An organization needs at least one owner.');
  }

  private async invalidateMembers(tenantId: string): Promise<void> {
    const rows = await this.memberRepo.find({ where: { tenant_id: tenantId } });
    for (const row of rows) this.tenantCache.invalidate(row.user_id);
  }
}
