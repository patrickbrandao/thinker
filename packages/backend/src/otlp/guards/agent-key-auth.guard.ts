import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { AgentApiKey } from '../../entities/agent-api-key.entity';
import {
  IngestionContext,
  RequestWithThinkerErrorContext,
} from '../interfaces/ingestion-context.interface';
import { verifyKey, keyPrefix as computePrefix } from '../../common/utils/hash.util';
import { API_KEY_PREFIX } from '../../common/constants/api-key.constants';
import { isLoopbackPeer } from '../../common/utils/local-ip';
import { scryptFingerprint } from '../../common/utils/crypto.util';
const MIN_TOKEN_LENGTH = 12;
// Generated keys are `thk_` + 43 base64url chars. The ceiling is generous on
// purpose; it bounds the input to the cache fingerprint below, so an oversized
// header cannot buy extra scrypt work per request.
const MAX_TOKEN_LENGTH = 512;

/**
 * Read one request header as a single non-empty string. Node joins repeated
 * custom headers with ", " already; the array branch only covers callers that
 * hand us a pre-split header map. An empty value counts as absent.
 */
function headerValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw.join(', ') : raw;
  return value ? value : undefined;
}

/**
 * Whether two caller-supplied header values carry the same key. Both operands
 * come from the same request, so there is no server-side secret for a timing
 * side channel to reveal; timingSafeEqual is used anyway so the comparison never
 * short-circuits on content. A length mismatch is a definite mismatch.
 */
function sameKey(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

/**
 * Guard message for a request that carries two different agent keys. Mapped to
 * a documented error code by ProxyExceptionFilter (AUTH_ERROR_CODES).
 */
export const CONFLICTING_API_KEY_HEADERS = 'Conflicting API key headers';

interface CachedKey {
  keyId: string;
  tenantId: string;
  agentId: string;
  agentName: string;
  userId: string | null;
  // When this cache entry stops being trusted (the 5-min cache TTL).
  expiresAt: number;
  // The API key's OWN expiry (epoch ms) copied off the DB row, or null when
  // the key never expires. Distinct from `expiresAt`: a key can be set to
  // expire while still inside the cache TTL window, so the fast path must
  // honor this independently instead of trusting the cache entry until the
  // TTL lapses.
  keyExpiresAt: number | null;
}

@Injectable()
export class AgentKeyAuthGuard implements CanActivate, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentKeyAuthGuard.name);
  // STATIC on purpose: Nest instantiates class-referenced @UseGuards enhancers
  // per host module, so the proxy controllers and the OtlpModule export are
  // DIFFERENT guard instances. Instance-level maps let a rotated key keep
  // authenticating from another instance's warm cache for up to CACHE_TTL_MS;
  // sharing the maps process-wide makes invalidateCache()/clearCache() reach
  // every instance.
  //
  // Both caches are keyed by a fingerprint of the presented token, never the
  // token itself, so a heap snapshot or core dump does not hold every working
  // agent key as a greppable string. The fingerprint is the cheap scrypt index
  // from crypto.util (N=2, 16 bytes) under a random salt generated once per
  // process: it is computed only after the prefix and length checks, costs a
  // few microseconds, and with 128 bits of output a collision between two
  // tokens is not a practical concern. It is a cache index only; the persisted
  // key hash and the real verification stay full-cost scrypt (verifyKey).
  private static readonly CACHE_FINGERPRINT_SALT = randomBytes(16);
  private static cache = new Map<string, CachedKey>();
  private devContext: { context: IngestionContext; expiresAt: number } | null = null;
  // 5 min TTL amortizes the expensive prefix lookup and hash verification.
  // Cache hits still verify the key row is active, so rotation and deletion
  // take effect across replicas without waiting for this TTL.
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly MAX_CACHE_SIZE = 10_000;
  // Maps a rejected token's fingerprint to when its rejection stops being trusted.
  // Without this, every request bearing a wrong/revoked thk_ key runs a
  // fresh indexed DB lookup AND emits a warn log — so a single misconfigured
  // agent in a retry loop sustains DB load and floods the logs indefinitely.
  // The TTL is deliberately much shorter than CACHE_TTL_MS so a key that gets
  // created or reactivated starts working quickly; key mutations also clear
  // this via clearCache()/invalidateCache(), so a created key is never stuck.
  private static negativeCache = new Map<string, number>();
  private readonly NEGATIVE_CACHE_TTL_MS = 30 * 1000;
  private readonly MAX_NEGATIVE_CACHE_SIZE = 10_000;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(AgentApiKey)
    private readonly keyRepo: Repository<AgentApiKey>,
    private readonly configService: ConfigService,
  ) {
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000);
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  async onModuleInit(): Promise<void> {
    // Pre-migration API keys were hashed with a static salt
    // ("manifest-api-key-salt"). The verifyKey path still accepts them for
    // backward compatibility, but a leaked DB backup gives an attacker a
    // rainbow-table head start. Surface a one-shot warning so operators
    // know to rotate them via the dashboard.
    try {
      const legacyCount = await this.keyRepo
        .createQueryBuilder('k')
        .where("k.key_hash NOT LIKE '%:%'")
        .andWhere('k.is_active = true')
        .getCount();
      if (legacyCount > 0) {
        this.logger.warn(
          `${legacyCount} active agent API key(s) still use the legacy static-salt hash. ` +
            'Rotate them in the dashboard (Agent → Rotate Key) when convenient.',
        );
      }
    } catch (err) {
      // Don't block boot on this informational check (e.g. fresh DB before
      // migrations run on the very first boot of an old install).
      this.logger.debug(`Legacy hash audit skipped: ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    // The caches are static, so they outlive the instance and leak across
    // application contexts (test isolation, and any repeated Nest bootstrap in
    // one process). Tearing the module down clears them.
    this.clearCache();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // The agent key arrives on one of two transports: `Authorization: Bearer
    // <key>` (OpenAI SDKs and most harnesses; a raw `<key>` with no scheme is
    // accepted too) or `x-api-key: <key>` (the Anthropic SDK default, and
    // Claude Code with ANTHROPIC_API_KEY). Both feed the exact same validation
    // below — same prefix/length checks, same caches, same dev-loopback rule.
    const authHeader = headerValue(request.headers['authorization']);
    const apiKeyHeader = headerValue(request.headers['x-api-key']);

    // Use socket.remoteAddress (TCP peer) — request.ip honors X-Forwarded-For
    // and is spoofable when `trust proxy` is enabled.
    const isDevLoopback =
      this.configService.get<string>('app.nodeEnv') === 'development' && isLoopbackPeer(request);

    if (authHeader === undefined && apiKeyHeader === undefined) {
      if (await this.handleDevLoopback(request, isDevLoopback)) return true;
      this.logger.warn(`Request without auth from ${request.ip}`);
      throw new UnauthorizedException('Authorization header required');
    }

    const bearerToken =
      authHeader === undefined
        ? undefined
        : authHeader.startsWith('Bearer ')
          ? authHeader.slice(7)
          : authHeader;

    // Two different keys on one request is ambiguous: picking either one would
    // silently bill the request to an agent the caller may not have meant.
    // Reject it outright (before the dev-loopback shortcut, so the answer does
    // not depend on where the caller sits). The same key in both is fine —
    // some clients set both headers from one variable. Neither value is
    // logged.
    if (
      bearerToken !== undefined &&
      apiKeyHeader !== undefined &&
      !sameKey(bearerToken, apiKeyHeader)
    ) {
      this.logger.warn(`Rejected request with conflicting agent key headers from ${request.ip}`);
      throw new UnauthorizedException(CONFLICTING_API_KEY_HEADERS);
    }

    const token = bearerToken ?? apiKeyHeader;

    if (!token) {
      throw new UnauthorizedException('Empty token');
    }

    if (!token.startsWith(API_KEY_PREFIX)) {
      if (await this.handleDevLoopback(request, isDevLoopback)) return true;
      throw new UnauthorizedException('Invalid API key format');
    }

    if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
      throw new UnauthorizedException('Invalid API key format');
    }

    return this.validatePrefixedAgentKey(request, token);
  }

  invalidateCache(key: string) {
    const fingerprint = AgentKeyAuthGuard.fingerprint(key);
    AgentKeyAuthGuard.cache.delete(fingerprint);
    // Drop any negative entry too, so re-creating or rotating a key that was
    // briefly rejected (e.g. a client raced ahead of key creation) takes
    // effect immediately instead of waiting out the negative TTL.
    AgentKeyAuthGuard.negativeCache.delete(fingerprint);
  }

  clearCache() {
    AgentKeyAuthGuard.cache.clear();
    AgentKeyAuthGuard.negativeCache.clear();
  }

  /** Cache index for a token. Never log or serialize it alongside the token. */
  private static fingerprint(token: string): string {
    return scryptFingerprint(token, AgentKeyAuthGuard.CACHE_FINGERPRINT_SALT);
  }

  private setContext(request: Request, ctx: IngestionContext): void {
    (request as Request & { ingestionContext: IngestionContext }).ingestionContext = ctx;
  }

  private async handleDevLoopback(request: Request, isDevLoopback: boolean): Promise<boolean> {
    if (!isDevLoopback) return false;
    const devCtx = await this.resolveDevContext();
    if (!devCtx) return false;
    this.setContext(request, devCtx);
    return true;
  }

  private async validatePrefixedAgentKey(request: Request, token: string): Promise<boolean> {
    const fingerprint = AgentKeyAuthGuard.fingerprint(token);
    const now = Date.now();

    // Negative cache first: a recently-rejected token short-circuits here
    // without touching the DB or emitting a log line. This is what collapses
    // a wrong/revoked-key storm to one DB lookup + one warn per TTL window.
    const negativeExpiry = AgentKeyAuthGuard.negativeCache.get(fingerprint);
    if (negativeExpiry !== undefined && negativeExpiry > now) {
      // LRU touch — re-insert to move to tail of insertion order.
      AgentKeyAuthGuard.negativeCache.delete(fingerprint);
      AgentKeyAuthGuard.negativeCache.set(fingerprint, negativeExpiry);
      throw new UnauthorizedException('Invalid API key');
    }
    if (negativeExpiry !== undefined) {
      // Stale negative entry — drop it and re-check against the DB so a key
      // that has since been created/reactivated can authenticate again.
      AgentKeyAuthGuard.negativeCache.delete(fingerprint);
    }

    const cached = AgentKeyAuthGuard.cache.get(fingerprint);
    // A key whose own expiry has passed must stop authenticating immediately,
    // even if its cache entry is still inside the 5-min TTL. Drop the stale
    // entry and fall through to the DB path (which re-checks expiry and rejects
    // with "API key expired") rather than honoring it here.
    if (cached && cached.keyExpiresAt !== null && cached.keyExpiresAt <= now) {
      AgentKeyAuthGuard.cache.delete(fingerprint);
    } else if (cached && cached.expiresAt > now) {
      let stillActive: boolean;
      try {
        stillActive = await this.keyRepo.existsBy({
          id: cached.keyId,
          is_active: true,
        });
      } catch (err) {
        this.logger.warn(`Agent-key activity recheck failed: ${(err as Error).message}`);
        throw new UnauthorizedException('Invalid API key');
      }
      if (!stillActive) {
        AgentKeyAuthGuard.cache.delete(fingerprint);
        this.rememberInvalid(fingerprint);
        throw new UnauthorizedException('Invalid API key');
      }
      // LRU touch — re-insert to move to tail of insertion order
      AgentKeyAuthGuard.cache.delete(fingerprint);
      AgentKeyAuthGuard.cache.set(fingerprint, cached);
      this.setContext(request, {
        tenantId: cached.tenantId,
        agentId: cached.agentId,
        agentName: cached.agentName,
        userId: cached.userId,
      });
      return true;
    }

    const prefix = computePrefix(token);
    const candidates = await this.keyRepo
      .createQueryBuilder('k')
      .select([
        'k.id',
        'k.key_hash',
        'k.tenant_id',
        'k.agent_id',
        'k.expires_at',
        'a.name',
        't.owner_user_id',
      ])
      .leftJoin('k.agent', 'a')
      .leftJoin('k.tenant', 't')
      .where('k.key_prefix = :prefix', { prefix })
      .andWhere('k.is_active = true')
      .andWhere('a.deleted_at IS NULL')
      .getMany();

    const keyRecord = candidates.find((c) => verifyKey(token, c.key_hash));

    if (!keyRecord) {
      // Remember the rejection so an identical repeat is served from the
      // negative cache (no DB, no log) until the short TTL lapses.
      this.rememberInvalid(fingerprint);
      // Log only the fixed prefix — even leaking the next character or two
      // narrows the search space if these warnings end up in a SIEM that
      // retains them indefinitely.
      this.logger.warn(`Rejected unknown agent key (prefix: ${API_KEY_PREFIX}...)`);
      throw new UnauthorizedException('Invalid API key');
    }

    // The candidate query left-joins agent + tenant. If either relation fails
    // to hydrate — e.g. the agent is soft-deleted in the race between the query
    // above and the dereference below — reading keyRecord.agent.name /
    // keyRecord.tenant.owner_user_id would throw a TypeError and surface a 500
    // that leaks an internal error. Treat an unhydrated relation as an invalid
    // key: remember the rejection (so an identical retry is served from the
    // negative cache) and return a clean 401.
    if (!keyRecord.agent || !keyRecord.tenant) {
      this.rememberInvalid(fingerprint);
      this.logger.warn(
        `Rejected agent key with unhydrated relations (prefix: ${API_KEY_PREFIX}...)`,
      );
      throw new UnauthorizedException('Invalid API key');
    }

    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      // An expired key still identifies its agent, so this rejection is the one
      // auth failure Thinker can attribute and record (M004). The others
      // (M001–M003, M005, M006) never resolve a tenant and stay unrecorded — see
      // UNRECORDABLE_THINKER_CODES.
      (request as Request & RequestWithThinkerErrorContext).thinkerErrorContext = {
        tenantId: keyRecord.tenant_id,
        agentId: keyRecord.agent_id,
        agentName: keyRecord.agent.name,
        userId: keyRecord.tenant.owner_user_id,
      };
      throw new UnauthorizedException('API key expired');
    }

    this.keyRepo
      .createQueryBuilder()
      .update(AgentApiKey)
      .set({ last_used_at: () => 'CURRENT_TIMESTAMP' })
      .where('id = :id', { id: keyRecord.id })
      .execute()
      .catch((err: Error) => this.logger.warn(`Failed to update last_used_at: ${err.message}`));

    this.evictExpired();
    while (AgentKeyAuthGuard.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = AgentKeyAuthGuard.cache.keys().next().value;
      if (firstKey === undefined) break;
      AgentKeyAuthGuard.cache.delete(firstKey);
    }

    AgentKeyAuthGuard.cache.set(fingerprint, {
      keyId: keyRecord.id,
      tenantId: keyRecord.tenant_id,
      agentId: keyRecord.agent_id,
      agentName: keyRecord.agent.name,
      userId: keyRecord.tenant.owner_user_id,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
      keyExpiresAt: keyRecord.expires_at ? new Date(keyRecord.expires_at).getTime() : null,
    });

    this.setContext(request, {
      tenantId: keyRecord.tenant_id,
      agentId: keyRecord.agent_id,
      agentName: keyRecord.agent.name,
      userId: keyRecord.tenant.owner_user_id,
    });

    return true;
  }

  private async resolveDevContext(): Promise<IngestionContext | null> {
    if (this.devContext && this.devContext.expiresAt > Date.now()) {
      return this.devContext.context;
    }

    // Prefer the seed tenant when present so a shared dev DB doesn't
    // accidentally route loopback traffic into another developer's data
    // simply because their key was inserted first.
    const seedKey = await this.keyRepo
      .createQueryBuilder('k')
      .leftJoinAndSelect('k.agent', 'a')
      .leftJoinAndSelect('k.tenant', 't')
      .where('k.is_active = true')
      .andWhere('k.tenant_id = :tid', { tid: 'seed-tenant-001' })
      .getOne();

    const keyRecord =
      seedKey ??
      (await this.keyRepo.findOne({
        where: { is_active: true },
        relations: ['agent', 'tenant'],
      }));

    if (!keyRecord) return null;

    const ctx: IngestionContext = {
      tenantId: keyRecord.tenant_id,
      agentId: keyRecord.agent_id,
      agentName: keyRecord.agent.name,
      userId: keyRecord.tenant.owner_user_id,
    };

    this.devContext = { context: ctx, expiresAt: Date.now() + this.CACHE_TTL_MS };
    return ctx;
  }

  private rememberInvalid(fingerprint: string): void {
    this.evictExpired();
    while (AgentKeyAuthGuard.negativeCache.size >= this.MAX_NEGATIVE_CACHE_SIZE) {
      const firstKey = AgentKeyAuthGuard.negativeCache.keys().next().value;
      if (firstKey === undefined) break;
      AgentKeyAuthGuard.negativeCache.delete(firstKey);
    }
    AgentKeyAuthGuard.negativeCache.set(fingerprint, Date.now() + this.NEGATIVE_CACHE_TTL_MS);
  }

  private evictExpired() {
    const now = Date.now();
    for (const [key, entry] of AgentKeyAuthGuard.cache) {
      if (entry.expiresAt <= now) AgentKeyAuthGuard.cache.delete(key);
    }
    for (const [key, expiresAt] of AgentKeyAuthGuard.negativeCache) {
      if (expiresAt <= now) AgentKeyAuthGuard.negativeCache.delete(key);
    }
  }
}
