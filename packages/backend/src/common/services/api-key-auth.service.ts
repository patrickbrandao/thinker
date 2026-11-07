import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiKey } from '../../entities/api-key.entity';
import { TenantContext } from '../decorators/tenant-context.decorator';
import { verifyKey, keyPrefix as computePrefix } from '../utils/hash.util';
import { toLocalSqlTimestamp } from '../utils/postgres-sql';
import { ENCRYPTION_KEY_ENV, ENCRYPTION_KEY_PREVIOUS_ENV } from '../utils/crypto.util';
import { ROOT_TOKEN_PREFIX, verifyRootToken } from '../utils/root-token';
import { TenantCacheService } from './tenant-cache.service';

/** Prefix of admin API keys created in the dashboard or with `thinker key create`. */
export const ADMIN_KEY_PREFIX = 'thk_adm_';

/** How a management credential authenticated. */
export type ManagementAuthKind = 'api_key' | 'root';

export interface ManagementAuth {
  kind: ManagementAuthKind;
  ctx: TenantContext;
  /** Key row id (null for root). */
  keyId: string | null;
  /** Key name, or `root` / `root:<email>`. */
  keyName: string;
  /** ISO expiry the next request enforces; null = never expires. */
  expiresAt: string | null;
}

/**
 * Verifies a Thinker management credential (`X-API-Key` on the REST API, or
 * `X-API-Key` / `Authorization: Bearer` on MCP): a row of `api_keys`
 * (dashboard/CLI admin keys and CLI login tokens) or a root token minted from
 * THINKER_ENCRYPTION_KEY. Returns null when the value is neither.
 */
@Injectable()
export class ApiKeyAuthService {
  private readonly logger = new Logger(ApiKeyAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
    private readonly tenantCache: TenantCacheService,
    private readonly ds: DataSource,
  ) {}

  async authenticate(
    raw: string,
    requestedTenantId: string | null = null,
  ): Promise<ManagementAuth | null> {
    if (raw.startsWith(ROOT_TOKEN_PREFIX)) return this.authenticateRoot(raw, requestedTenantId);
    return this.authenticateKey(raw);
  }

  private async authenticateRoot(
    raw: string,
    requestedTenantId: string | null,
  ): Promise<ManagementAuth> {
    const secrets = [
      process.env[ENCRYPTION_KEY_ENV],
      process.env[ENCRYPTION_KEY_PREVIOUS_ENV],
    ].filter((s): s is string => typeof s === 'string' && s.length > 0);
    const result = verifyRootToken(raw, secrets);
    if (!result.ok) {
      throw new UnauthorizedException(
        result.reason === 'expired'
          ? 'Root token outside the 5-minute window — check the clock'
          : 'Invalid root token (THINKER_ENCRYPTION_KEY differs from the server)',
      );
    }
    const userId = await this.rootUserId(result.email);
    const access = await this.tenantCache.resolveAccess(userId, requestedTenantId);
    return {
      kind: 'root',
      ctx: { tenantId: access.tenantId, userId, role: 'owner', isInstanceAdmin: true },
      keyId: null,
      keyName: result.email ? `root:${result.email}` : 'root',
      expiresAt: null,
    };
  }

  /** The account root acts as: the given email, else the oldest instance admin. */
  private async rootUserId(email: string | null): Promise<string> {
    const rows = (await this.ds.query(
      email
        ? `SELECT u.id FROM "user" u WHERE lower(u.email) = lower($1) LIMIT 1`
        : `SELECT u.id FROM "user" u JOIN user_profiles p ON p.user_id = u.id
            WHERE p.is_instance_admin ORDER BY u."createdAt" ASC LIMIT 1`,
      email ? [email] : [],
    )) as Array<{ id: string }>;
    if (!rows[0]) {
      throw new UnauthorizedException(
        email
          ? `No account with email ${email}`
          : 'No instance administrator exists yet — finish /setup first',
      );
    }
    return String(rows[0].id);
  }

  private async authenticateKey(raw: string): Promise<ManagementAuth | null> {
    const candidates = await this.apiKeyRepo.find({ where: { key_prefix: computePrefix(raw) } });
    const found = candidates.find((c) => verifyKey(raw, c.key_hash));
    if (!found) return null;
    const now = Date.now();
    const absoluteExpiryAt = found.absolute_expires_at
      ? new Date(found.absolute_expires_at).getTime()
      : null;
    // Two independent deadlines: the sliding window (`expires_at`) and the
    // hard ceiling (`absolute_expires_at`). NULL on both = never expires.
    const expired =
      (found.expires_at && new Date(found.expires_at).getTime() <= now) ||
      (absoluteExpiryAt !== null && absoluteExpiryAt <= now);
    if (expired)
      throw new UnauthorizedException('API key expired — run thinker login, or create a new key');
    // The key carries its creator's CURRENT role in that organization
    // (ADR 0006); a creator who left the organization loses the key (403).
    if (!found.created_by_user_id) {
      throw new UnauthorizedException('API key has no owning user');
    }
    const access = await this.tenantCache.resolveAccess(found.created_by_user_id, found.tenant_id);
    // CLI login tokens slide up to their absolute ceiling; admin keys keep
    // the fixed expiry chosen at creation.
    const sliding = found.expires_at !== null && !raw.startsWith(ADMIN_KEY_PREFIX);
    const ttlDays = this.configService.get<number>('app.cliTokenTtlDays', 30);
    const slidExpiryAt = now + ttlDays * 86_400_000;
    const nextExpiryAt = sliding
      ? absoluteExpiryAt !== null && absoluteExpiryAt < slidExpiryAt
        ? absoluteExpiryAt
        : slidExpiryAt
      : found.expires_at
        ? new Date(found.expires_at).getTime()
        : null;
    this.apiKeyRepo
      .createQueryBuilder()
      .update(ApiKey)
      .set(
        sliding && nextExpiryAt !== null
          ? {
              last_used_at: () => 'CURRENT_TIMESTAMP',
              // Node clock, like every other writer of expires_at.
              expires_at: toLocalSqlTimestamp(new Date(nextExpiryAt)),
            }
          : { last_used_at: () => 'CURRENT_TIMESTAMP' },
      )
      .where('id = :id', { id: found.id })
      .execute()
      .catch((err: Error) =>
        this.logger.warn(`Failed to update last_used_at/expires_at: ${err.message}`),
      );
    return {
      kind: 'api_key',
      ctx: {
        tenantId: found.tenant_id,
        userId: found.created_by_user_id,
        role: access.role,
        isInstanceAdmin: access.isInstanceAdmin,
      },
      keyId: found.id,
      keyName: found.name,
      expiresAt: nextExpiryAt !== null ? new Date(nextExpiryAt).toISOString() : null,
    };
  }
}
