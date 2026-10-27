import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Tenant } from '../../entities/tenant.entity';
import { OrganizationMember, OrganizationRole } from '../../entities/organization-member.entity';
import { UserProfile } from '../../entities/user-profile.entity';
import { TtlFifoCache } from '../utils/ttl-fifo-cache';

/** What the auth boundary needs about a user: memberships and account flags. */
interface UserAccess {
  memberships: { tenantId: string; role: OrganizationRole }[];
  isInstanceAdmin: boolean;
  mustChangePassword: boolean;
  activeTenantId: string | null;
}

export interface ResolvedTenantAccess {
  tenantId: string | null;
  role: OrganizationRole | null;
  isInstanceAdmin: boolean;
  mustChangePassword: boolean;
}

/**
 * The ONE place user→organization resolution happens (ADR 0006). Everything
 * downstream is scoped by tenantId; this service picks the active
 * organization (requested header, saved choice, first membership) and the
 * user's role in it from `organization_members`.
 */
@Injectable()
export class TenantCacheService {
  private readonly cache = new TtlFifoCache<string, UserAccess>({
    maxEntries: 5_000,
    ttlMs: 300_000,
  });

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(OrganizationMember)
    private readonly memberRepo: Repository<OrganizationMember>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
  ) {}

  /**
   * Resolves the active organization and role. A requested organization the
   * user does not belong to is a 403, except for the instance admin, who acts
   * as `owner` in any active organization.
   */
  async resolveAccess(
    userId: string,
    requestedTenantId?: string | null,
  ): Promise<ResolvedTenantAccess> {
    const access = await this.loadAccess(userId);
    const flags = {
      isInstanceAdmin: access.isInstanceAdmin,
      mustChangePassword: access.mustChangePassword,
    };
    const membershipFor = (tenantId: string | null | undefined) =>
      tenantId ? access.memberships.find((m) => m.tenantId === tenantId) : undefined;

    if (requestedTenantId) {
      const member = membershipFor(requestedTenantId);
      if (member) return { tenantId: member.tenantId, role: member.role, ...flags };
      if (access.isInstanceAdmin && (await this.isActiveTenant(requestedTenantId))) {
        return { tenantId: requestedTenantId, role: 'owner', ...flags };
      }
      throw new ForbiddenException({
        message: 'You are not a member of this organization.',
        code: 'not_a_member',
      });
    }

    const saved = membershipFor(access.activeTenantId);
    if (saved) return { tenantId: saved.tenantId, role: saved.role, ...flags };
    if (
      access.isInstanceAdmin &&
      access.activeTenantId &&
      (await this.isActiveTenant(access.activeTenantId))
    ) {
      return { tenantId: access.activeTenantId, role: 'owner', ...flags };
    }
    const first = access.memberships[0];
    if (first) return { tenantId: first.tenantId, role: first.role, ...flags };
    return { tenantId: null, role: null, ...flags };
  }

  /** The active organization id only (MCP and legacy callers). */
  async resolve(userId: string): Promise<string | null> {
    return (await this.resolveAccess(userId)).tenantId;
  }

  /**
   * Resolve the user's organization, creating a personal one (with the user
   * as owner) when they belong to none. Used by mutation paths that must work
   * before the first agent exists (playground, custom providers).
   */
  async ensureForUser(userId: string): Promise<string> {
    const existing = await this.resolve(userId);
    if (existing) return existing;

    let tenantId: string = randomUUID();
    try {
      await this.tenantRepo.insert({
        id: tenantId,
        name: userId,
        owner_user_id: userId,
        organization_name: await this.personalOrganizationName(userId),
        is_active: true,
      });
    } catch (err) {
      // Unique index on owner_user_id: a concurrent request created it first.
      const raced = await this.tenantRepo.findOne({ where: { owner_user_id: userId } });
      if (!raced) throw err;
      tenantId = raced.id;
    }
    await this.addMember(tenantId, userId, 'owner');
    return tenantId;
  }

  /** Creates or updates a membership and drops the user's cached access. */
  async addMember(tenantId: string, userId: string, role: OrganizationRole): Promise<void> {
    await this.memberRepo.upsert({ tenant_id: tenantId, user_id: userId, role }, [
      'tenant_id',
      'user_id',
    ]);
    this.invalidate(userId);
  }

  /** Remove a cached entry so the next resolve re-hits the DB. */
  invalidate(userId: string): void {
    this.cache.invalidate(userId);
  }

  private loadAccess(userId: string): Promise<UserAccess> {
    return this.cache.resolve(userId, async (uid) => {
      const [rows, profile] = await Promise.all([
        this.memberRepo.find({ where: { user_id: uid }, order: { created_at: 'ASC' } }),
        this.profileRepo.findOne({ where: { user_id: uid } }),
      ]);
      // Deactivated organizations drop out of every membership list.
      const tenantIds = rows.map((r) => r.tenant_id);
      const active = tenantIds.length
        ? await this.tenantRepo.find({
            where: { id: In(tenantIds), is_active: true },
            select: { id: true },
          })
        : [];
      const activeIds = new Set(active.map((t) => t.id));
      return {
        memberships: rows
          .filter((r) => activeIds.has(r.tenant_id))
          .map((r) => ({ tenantId: r.tenant_id, role: r.role })),
        isInstanceAdmin: profile?.is_instance_admin ?? false,
        mustChangePassword: profile?.must_change_password ?? false,
        activeTenantId: profile?.active_tenant_id ?? null,
      };
    });
  }

  /** Display name for a personal organization: the user's name or email. */
  private async personalOrganizationName(userId: string): Promise<string | null> {
    try {
      const rows = (await this.tenantRepo.query(
        `SELECT COALESCE(NULLIF(TRIM(name), ''), email) AS label FROM "user" WHERE id = $1`,
        [userId],
      )) as Array<{ label: string | null }>;
      return rows[0]?.label ?? null;
    } catch {
      return null; // No Better Auth table (tests): fall back to the internal name.
    }
  }

  private async isActiveTenant(tenantId: string): Promise<boolean> {
    return this.tenantRepo.exists({ where: { id: tenantId, is_active: true } });
  }
}
