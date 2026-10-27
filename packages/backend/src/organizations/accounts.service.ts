import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { UserProfile } from '../entities/user-profile.entity';
import { runAsServerUserCreation } from '../auth/signup-policy';
import { TenantCacheService } from '../common/services/tenant-cache.service';

export interface AccountRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  isInstanceAdmin: boolean;
  mustChangePassword: boolean;
}

/** A random temporary password, shown to the creator once (ADR 0006). */
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

function betterAuth() {
  // Lazy-require: Better Auth is ESM and only loads where accounts change.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../auth/auth.instance').auth;
}

/**
 * Account management on top of Better Auth (ADR 0006): server-side creation
 * with a temporary password, admin resets, the forced first-login change and
 * the instance-admin flag in `user_profiles`.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    private readonly tenantCache: TenantCacheService,
  ) {}

  async findByEmail(email: string): Promise<AccountRow | null> {
    const rows = await this.listAccounts(`LOWER(u.email) = LOWER($1)`, [email.trim()]);
    return rows[0] ?? null;
  }

  async findById(userId: string): Promise<AccountRow | null> {
    const rows = await this.listAccounts(`u.id = $1`, [userId]);
    return rows[0] ?? null;
  }

  listAccounts(where = 'TRUE', params: unknown[] = []): Promise<AccountRow[]> {
    return this.ds.query(
      `SELECT u.id, u.email, u.name, u."createdAt" AS "createdAt",
              COALESCE(p.is_instance_admin, false) AS "isInstanceAdmin",
              COALESCE(p.must_change_password, false) AS "mustChangePassword"
         FROM "user" u
         LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE ${where}
        ORDER BY u."createdAt" ASC`,
      params,
    );
  }

  /** Creates an account with a temporary password that must change on first login. */
  async createAccount(
    email: string,
    name: string,
    isInstanceAdmin = false,
  ): Promise<{ account: AccountRow; temporaryPassword: string }> {
    const normalized = email.trim().toLowerCase();
    if (await this.findByEmail(normalized)) {
      throw new ConflictException('An account with this email already exists.');
    }
    const temporaryPassword = generateTemporaryPassword();
    const result = await runAsServerUserCreation(() =>
      betterAuth().api.signUpEmail({
        body: { email: normalized, password: temporaryPassword, name: name.trim() || normalized },
      }),
    );
    const userId = (result as { user?: { id?: string } })?.user?.id;
    if (!userId) throw new BadRequestException('Could not create the account.');
    await this.ds.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1`, [userId]);
    // signUpEmail signs the new user in server-side; that session is nobody's.
    await this.ds.query(`DELETE FROM session WHERE "userId" = $1`, [userId]);
    await this.profileRepo.upsert(
      { user_id: userId, is_instance_admin: isInstanceAdmin, must_change_password: true },
      ['user_id'],
    );
    const account = await this.findById(userId);
    return { account: account!, temporaryPassword };
  }

  /** New temporary password for an account (instance admin). */
  async resetPassword(userId: string): Promise<string> {
    if (!(await this.findById(userId))) throw new NotFoundException('Account not found.');
    const temporaryPassword = generateTemporaryPassword();
    const ctx = await betterAuth().$context;
    const hash = await ctx.password.hash(temporaryPassword);
    const updated = (await this.ds.query(
      `UPDATE account SET password = $1, "updatedAt" = NOW()
        WHERE "userId" = $2 AND "providerId" = 'credential' RETURNING id`,
      [hash, userId],
    )) as unknown[];
    if (updated.length === 0) {
      await this.ds.query(
        `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
         VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())`,
        [randomBytes(16).toString('hex'), userId, hash],
      );
    }
    await this.setFlags(userId, { must_change_password: true });
    // Sessions opened with the old password end now.
    await this.ds.query(`DELETE FROM session WHERE "userId" = $1`, [userId]);
    return temporaryPassword;
  }

  /** The user's own change (also clears the temporary-password flag). */
  async changeOwnPassword(
    userId: string,
    headers: Headers,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('The new password needs at least 8 characters.');
    }
    if (newPassword === currentPassword) {
      throw new BadRequestException('Choose a password different from the current one.');
    }
    try {
      await betterAuth().api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: false },
        headers,
      });
    } catch {
      throw new BadRequestException('The current password is wrong.');
    }
    await this.setFlags(userId, { must_change_password: false });
  }

  async setInstanceAdmin(userId: string, isInstanceAdmin: boolean): Promise<AccountRow> {
    if (!(await this.findById(userId))) throw new NotFoundException('Account not found.');
    if (!isInstanceAdmin) {
      const [{ count }] = (await this.ds.query(
        `SELECT COUNT(*)::int AS count FROM user_profiles WHERE is_instance_admin AND user_id <> $1`,
        [userId],
      )) as Array<{ count: number }>;
      if (count === 0)
        throw new ConflictException('The instance needs at least one administrator.');
    }
    await this.setFlags(userId, { is_instance_admin: isInstanceAdmin });
    return (await this.findById(userId))!;
  }

  async setActiveOrganization(userId: string, tenantId: string): Promise<void> {
    await this.setFlags(userId, { active_tenant_id: tenantId });
  }

  private async setFlags(userId: string, flags: Partial<UserProfile>): Promise<void> {
    await this.profileRepo.upsert({ user_id: userId, ...flags }, ['user_id']);
    this.tenantCache.invalidate(userId);
  }
}
