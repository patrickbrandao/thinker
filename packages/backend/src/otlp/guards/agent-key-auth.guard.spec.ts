import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentKeyAuthGuard, CONFLICTING_API_KEY_HEADERS } from './agent-key-auth.guard';
import { hashKey } from '../../common/utils/hash.util';
import { scryptFingerprint } from '../../common/utils/crypto.util';

/** The guard's caches are keyed by a salted scrypt fingerprint of the token. */
function testCacheKey(token: string): string {
  const salt = (AgentKeyAuthGuard as unknown as { CACHE_FINGERPRINT_SALT: Buffer })
    .CACHE_FINGERPRINT_SALT;
  return scryptFingerprint(token, salt);
}

function makeContext(headers: Record<string, string | undefined>, ip = '203.0.113.1') {
  // The guard reads request.socket.remoteAddress for its loopback decision
  // (request.ip is spoofable via X-Forwarded-For when trust proxy is set).
  // Mirror the test's `ip` onto the socket so existing scenarios still hold.
  const request: Record<string, unknown> = { headers, ip, socket: { remoteAddress: ip } };
  return {
    req: request,
    ctx: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext,
  };
}

function createMockConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    'app.nodeEnv': 'test',
    ...overrides,
  };
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('AgentKeyAuthGuard', () => {
  let guard: AgentKeyAuthGuard;
  let mockGetMany: jest.Mock;
  let mockCreateQueryBuilder: jest.Mock;
  let mockExecute: jest.Mock;
  let mockFindOne: jest.Mock;
  let mockExistsBy: jest.Mock;
  let mockConfig: ConfigService;

  function buildMockRepo() {
    mockGetMany = jest.fn().mockResolvedValue([]);
    const mockSelectQb = {
      select: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: mockGetMany,
      // resolveDevContext seeds-tenant lookup; default to no row so it falls
      // back to repo.findOne — preserves existing test scenarios.
      getOne: jest.fn().mockResolvedValue(null),
    };
    mockExecute = jest.fn().mockResolvedValue({});
    const mockUpdateQb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockImplementation((setObj) => {
        if (setObj) {
          for (const val of Object.values(setObj)) {
            if (typeof val === 'function') (val as () => unknown)();
          }
        }
        return mockUpdateQb;
      }),
      where: jest.fn().mockReturnThis(),
      execute: mockExecute,
    };
    mockCreateQueryBuilder = jest.fn().mockImplementation((alias?: string) => {
      return alias ? mockSelectQb : mockUpdateQb;
    });
    mockFindOne = jest.fn().mockResolvedValue(null);
    mockExistsBy = jest.fn().mockResolvedValue(true);
    return {
      createQueryBuilder: mockCreateQueryBuilder,
      findOne: mockFindOne,
      existsBy: mockExistsBy,
    } as never;
  }

  function createGuard(configOverrides: Record<string, string> = {}) {
    mockConfig = createMockConfig(configOverrides);
    const repo = buildMockRepo();
    const g = new AgentKeyAuthGuard(repo, mockConfig);
    g.clearCache();
    return g;
  }

  beforeEach(() => {
    guard = createGuard();
  });

  afterEach(() => {
    guard.onModuleDestroy();
  });

  describe('onModuleInit legacy-hash audit', () => {
    const makeAuditRepo = (getCount: jest.Mock) =>
      ({
        createQueryBuilder: jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount,
        })),
      }) as never;

    it('warns when legacy static-salt keys are still active', async () => {
      const g = new AgentKeyAuthGuard(
        makeAuditRepo(jest.fn().mockResolvedValue(3)),
        createMockConfig(),
      );
      const logger = (g as unknown as { logger: { warn: jest.Mock } }).logger;
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      await g.onModuleInit();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('legacy static-salt'));
      g.onModuleDestroy();
    });

    it('swallows audit query failures with a debug log', async () => {
      const g = new AgentKeyAuthGuard(
        makeAuditRepo(jest.fn().mockRejectedValue(new Error('no table'))),
        createMockConfig(),
      );
      const logger = (g as unknown as { logger: { debug: jest.Mock } }).logger;
      const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
      await g.onModuleInit();
      expect(debugSpy).toHaveBeenCalled();
      g.onModuleDestroy();
    });
  });

  it('throws UnauthorizedException when Authorization header is missing', async () => {
    const { ctx } = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Authorization header required');
  });

  it('throws UnauthorizedException when token is empty (Bearer with no value)', async () => {
    const { ctx } = makeContext({ authorization: 'Bearer ' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Empty token');
  });

  it('rejects token without thk_ prefix', async () => {
    const { ctx } = makeContext({ authorization: 'Bearer osk_some_old_key' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
    expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects thk_ token shorter than minimum length', async () => {
    const { ctx } = makeContext({ authorization: 'Bearer thk_ab' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
    expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
  });

  it('rejects bare thk_ prefix with no suffix', async () => {
    const { ctx } = makeContext({ authorization: 'Bearer thk_' });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
    expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when API key is not found in DB', async () => {
    mockGetMany.mockResolvedValue([]);
    const { ctx } = makeContext({ authorization: 'Bearer thk_unknown-key' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');
  });

  it('returns true and attaches ingestionContext when key is valid', async () => {
    const token = 'thk_valid-key';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-1',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx, req } = makeContext({ authorization: `Bearer ${token}` });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.ingestionContext).toEqual({
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      agentName: 'test-agent',
      userId: 'user-1',
    });
  });

  it('returns true when raw token (no Bearer prefix) matches', async () => {
    const token = 'thk_raw-key-test';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-2',
        tenant_id: 'tenant-2',
        agent_id: 'agent-2',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent-2' },
        tenant: { owner_user_id: 'user-2' },
      },
    ]);

    const { ctx, req } = makeContext({ authorization: token });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.ingestionContext).toEqual({
      tenantId: 'tenant-2',
      agentId: 'agent-2',
      agentName: 'test-agent-2',
      userId: 'user-2',
    });
  });

  it('throws UnauthorizedException when API key is expired', async () => {
    const token = 'thk_expired-key-test';
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    mockGetMany.mockResolvedValue([
      {
        id: 'key-3',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: pastDate,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('API key expired');
  });

  it('uses cached context after verifying that the key row is still active', async () => {
    const token = 'thk_cached-key-test';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-4',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx: ctx1 } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx1);

    expect(mockGetMany).toHaveBeenCalledTimes(1);

    mockCreateQueryBuilder.mockClear();
    mockGetMany.mockClear();
    mockCreateQueryBuilder.mockClear();

    const { ctx: ctx2 } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx2);

    expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
    expect(mockExistsBy).toHaveBeenCalledWith({ id: 'key-4', is_active: true });
  });

  it('rejects a cached key deactivated by another replica', async () => {
    const token = 'thk_cross-replica-revocation';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-revoked',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx: first } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(first)).resolves.toBe(true);

    mockExistsBy.mockResolvedValue(false);
    const { ctx: afterRevocation } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(afterRevocation)).rejects.toThrow('Invalid API key');

    const internalCache = (AgentKeyAuthGuard as unknown as { cache: Map<string, unknown> }).cache;
    expect(internalCache.has(testCacheKey(token))).toBe(false);
  });

  it('fails closed when the cached-key activity recheck cannot reach the database', async () => {
    const token = 'thk_cached-key-db-error';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-db-error',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx: first } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(first)).resolves.toBe(true);

    mockExistsBy.mockRejectedValueOnce(new Error('database unavailable'));
    const { ctx: duringOutage } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(duringOutage)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(duringOutage)).resolves.toBe(true);

    expect(mockGetMany).toHaveBeenCalledTimes(1);
    expect(mockExistsBy).toHaveBeenCalledTimes(2);
  });

  it('stops authenticating from cache once the key own expiry passes within the cache TTL', async () => {
    // A key that expires (or is set to expire) while still cached must not keep
    // authenticating until the 5-min cache TTL lapses. The fast path reads the
    // key's own expires_at, not just the cache entry's TTL.
    const token = 'thk_soon-expiring-key';
    const keyHash = hashKey(token);
    mockGetMany.mockResolvedValue([
      {
        id: 'key-exp',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: keyHash,
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    // First call caches the key (DB lookup happens).
    const { ctx: ctx1 } = makeContext({ authorization: `Bearer ${token}` });
    expect(await guard.canActivate(ctx1)).toBe(true);
    expect(mockGetMany).toHaveBeenCalledTimes(1);

    // Simulate the key being set to expire in the past while still cached: its
    // cache entry TTL is well in the future, but keyExpiresAt is now stale.
    const internalCache = (
      AgentKeyAuthGuard as unknown as { cache: Map<string, { keyExpiresAt: number }> }
    ).cache;
    const entry = internalCache.get(testCacheKey(token))!;
    expect(entry).toBeDefined();
    entry.keyExpiresAt = Date.now() - 1000;

    // The DB now reports the key as expired — the fast path must drop the stale
    // entry and fall through to the DB re-check, which rejects.
    mockGetMany.mockResolvedValue([
      {
        id: 'key-exp',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: keyHash,
        expires_at: new Date(Date.now() - 1000).toISOString(),
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx: ctx2 } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx2)).rejects.toThrow('API key expired');
    // The cache entry was discarded rather than honored, so a DB re-check ran.
    expect(internalCache.has(testCacheKey(token))).toBe(false);
  });

  it('stores the key own expires_at on the cached entry for non-expiring keys', async () => {
    const token = 'thk_no-expiry-key';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-noexp',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx);

    const internalCache = (
      AgentKeyAuthGuard as unknown as { cache: Map<string, { keyExpiresAt: number | null }> }
    ).cache;
    const entry = internalCache.get(testCacheKey(token));
    expect(entry).toBeDefined();
    // A null DB expiry stays null on the cache entry (key never expires).
    expect(entry!.keyExpiresAt).toBeNull();
  });

  it('requires auth for loopback IPs in non-development mode', async () => {
    const { ctx } = makeContext({}, '127.0.0.1');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  describe('dev loopback bypass in development mode', () => {
    beforeEach(() => {
      guard.onModuleDestroy();
      guard = createGuard({ 'app.nodeEnv': 'development' });
    });

    it('allows loopback with non-thk token in dev mode by resolving first active key', async () => {
      mockFindOne.mockResolvedValue({
        tenant_id: 'dev-tenant',
        agent_id: 'dev-agent',
        agent: { name: 'demo-agent' },
        tenant: { owner_user_id: 'dev-user' },
      });
      const { ctx, req } = makeContext({ authorization: 'Bearer dev-no-auth' }, '127.0.0.1');
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(req.ingestionContext).toEqual({
        tenantId: 'dev-tenant',
        agentId: 'dev-agent',
        agentName: 'demo-agent',
        userId: 'dev-user',
      });
      expect(mockFindOne).toHaveBeenCalledWith({
        where: { is_active: true },
        relations: ['agent', 'tenant'],
      });
    });

    it('allows loopback without auth header in dev mode', async () => {
      mockFindOne.mockResolvedValue({
        tenant_id: 'dev-tenant',
        agent_id: 'dev-agent',
        agent: { name: 'demo-agent' },
        tenant: { owner_user_id: 'dev-user' },
      });
      const { ctx, req } = makeContext({}, '127.0.0.1');
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(req.ingestionContext).toEqual({
        tenantId: 'dev-tenant',
        agentId: 'dev-agent',
        agentName: 'demo-agent',
        userId: 'dev-user',
      });
    });

    it('rejects loopback without auth when no active keys exist in DB', async () => {
      mockFindOne.mockResolvedValue(null);
      const { ctx } = makeContext({}, '127.0.0.1');
      await expect(guard.canActivate(ctx)).rejects.toThrow('Authorization header required');
    });

    it('rejects non-thk token when no active keys exist in DB', async () => {
      mockFindOne.mockResolvedValue(null);
      const { ctx } = makeContext({ authorization: 'Bearer dev-no-auth' }, '127.0.0.1');
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
    });

    it('rejects non-thk token from non-loopback IP in dev mode', async () => {
      const { ctx } = makeContext({ authorization: 'Bearer dev-no-auth' }, '192.168.1.100');
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
    });

    it('rejects loopback with non-thk token in production mode', async () => {
      guard.onModuleDestroy();
      guard = createGuard({ 'app.nodeEnv': 'production' });
      const { ctx } = makeContext({ authorization: 'Bearer dev-no-auth' }, '127.0.0.1');
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
    });

    it('rejects loopback with non-thk token in test mode', async () => {
      guard.onModuleDestroy();
      guard = createGuard({ 'app.nodeEnv': 'test' });
      const { ctx } = makeContext({ authorization: 'Bearer dev-no-auth' }, '127.0.0.1');
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
    });

    it('caches dev context and reuses it on subsequent calls', async () => {
      mockFindOne.mockResolvedValue({
        tenant_id: 'dev-tenant',
        agent_id: 'dev-agent',
        agent: { name: 'demo-agent' },
        tenant: { owner_user_id: 'dev-user' },
      });

      const { ctx: ctx1 } = makeContext({ authorization: 'Bearer dev-no-auth' }, '127.0.0.1');
      await guard.canActivate(ctx1);
      expect(mockFindOne).toHaveBeenCalledTimes(1);

      mockFindOne.mockClear();
      const { ctx: ctx2 } = makeContext({ authorization: 'Bearer dev-no-auth' }, '::1');
      await guard.canActivate(ctx2);
      expect(mockFindOne).not.toHaveBeenCalled();
    });
  });

  it('handles request.ip being undefined without crashing', async () => {
    const request: Record<string, unknown> = { headers: {}, ip: undefined, socket: {} };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('does not throw when last_used_at update fails', async () => {
    const token = 'thk_update-fail-key';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-5',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);
    mockExecute.mockRejectedValueOnce(new Error('DB write error'));

    const { ctx, req } = makeContext({ authorization: `Bearer ${token}` });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.ingestionContext).toBeDefined();
    expect(mockExecute).toHaveBeenCalled();
  });

  it('evicts the first cache entry when cache reaches MAX_CACHE_SIZE', async () => {
    const internalCache = (AgentKeyAuthGuard as any).cache as Map<string, unknown>;

    const firstFillerHash = testCacheKey('thk_filler-0');
    for (let i = 0; i < 10_000; i++) {
      internalCache.set(testCacheKey(`thk_filler-${i}`), {
        tenantId: 't',
        agentId: 'a',
        agentName: 'n',
        userId: 'u',
        expiresAt: Date.now() + 999_999,
      });
    }
    expect(internalCache.size).toBe(10_000);

    const token = 'thk_overflow-key';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-max',
        tenant_id: 'tenant-max',
        agent_id: 'agent-max',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent-max' },
        tenant: { owner_user_id: 'user-max' },
      },
    ]);

    const { ctx } = makeContext({ authorization: `Bearer ${token}` });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(internalCache.has(firstFillerHash)).toBe(false);
    expect(internalCache.has(testCacheKey(token))).toBe(true);
  });

  it('evictExpired removes entries whose expiresAt has passed', async () => {
    const internalCache = (AgentKeyAuthGuard as any).cache as Map<string, unknown>;

    const expiredHash = testCacheKey('thk_expired-cache');
    const validHash = testCacheKey('thk_valid-cache');
    internalCache.set(expiredHash, {
      tenantId: 't',
      agentId: 'a',
      agentName: 'n',
      userId: 'u',
      expiresAt: Date.now() - 1000,
    });
    internalCache.set(validHash, {
      tenantId: 't2',
      agentId: 'a2',
      agentName: 'n2',
      userId: 'u2',
      expiresAt: Date.now() + 999_999,
    });

    expect(internalCache.size).toBe(2);

    const evictToken = 'thk_trigger-evict-key';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-evict',
        tenant_id: 'tenant-evict',
        agent_id: 'agent-evict',
        key_hash: hashKey(evictToken),
        expires_at: null,
        agent: { name: 'test-agent-evict' },
        tenant: { owner_user_id: 'user-evict' },
      },
    ]);

    const { ctx } = makeContext({ authorization: `Bearer ${evictToken}` });
    await guard.canActivate(ctx);

    expect(internalCache.has(expiredHash)).toBe(false);
    expect(internalCache.has(validHash)).toBe(true);
    expect(internalCache.has(testCacheKey(evictToken))).toBe(true);
  });

  it('periodic timer fires evictExpired', () => {
    jest.useFakeTimers();

    const repo = buildMockRepo();
    const timedGuard = new AgentKeyAuthGuard(repo, createMockConfig());

    const internalCache = (AgentKeyAuthGuard as any).cache as Map<string, unknown>;
    internalCache.set(testCacheKey('thk_stale'), {
      tenantId: 't',
      agentId: 'a',
      agentName: 'n',
      userId: 'u',
      expiresAt: Date.now() - 1000,
    });

    expect(internalCache.size).toBe(1);
    jest.advanceTimersByTime(60_000);
    expect(internalCache.size).toBe(0);

    timedGuard.onModuleDestroy();
    jest.useRealTimers();
  });

  it('onModuleDestroy stops the periodic cleanup timer', () => {
    jest.useFakeTimers();

    const repo = buildMockRepo();
    const timedGuard = new AgentKeyAuthGuard(repo, createMockConfig());

    const internalCache = (AgentKeyAuthGuard as any).cache as Map<string, unknown>;
    timedGuard.onModuleDestroy();

    internalCache.set(testCacheKey('thk_leftover'), {
      tenantId: 't',
      agentId: 'a',
      agentName: 'n',
      userId: 'u',
      expiresAt: Date.now() - 1000,
    });

    jest.advanceTimersByTime(120_000);
    expect(internalCache.size).toBe(1);

    jest.useRealTimers();
  });

  it('onModuleDestroy clears the static caches so they cannot leak between contexts', () => {
    const destroyedGuard = new AgentKeyAuthGuard(buildMockRepo(), createMockConfig());
    const internalCache = (AgentKeyAuthGuard as unknown as { cache: Map<string, unknown> }).cache;
    const negativeCache = (AgentKeyAuthGuard as unknown as { negativeCache: Map<string, number> })
      .negativeCache;
    internalCache.set(testCacheKey('thk_survivor'), {
      tenantId: 't',
      agentId: 'a',
      agentName: 'n',
      userId: 'u',
      expiresAt: Date.now() + 60_000,
      keyExpiresAt: null,
    });
    negativeCache.set(testCacheKey('thk_rejected'), Date.now() + 60_000);

    destroyedGuard.onModuleDestroy();

    expect(internalCache.size).toBe(0);
    expect(negativeCache.size).toBe(0);
  });

  it('does not store plaintext tokens in either cache', async () => {
    const token = 'thk_plaintext-check-key';
    const rejected = 'thk_plaintext-check-rejected';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-pt',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx);

    const internalCache = (AgentKeyAuthGuard as any).cache as Map<string, unknown>;
    expect(internalCache.has(testCacheKey(token))).toBe(true);
    expect(internalCache.has(token)).toBe(false);

    mockGetMany.mockResolvedValue([]);
    const { ctx: rejectedCtx } = makeContext({ 'x-api-key': rejected });
    await expect(guard.canActivate(rejectedCtx)).rejects.toThrow('Invalid API key');
    const negativeCache = (AgentKeyAuthGuard as unknown as { negativeCache: Map<string, number> })
      .negativeCache;
    expect(negativeCache.has(testCacheKey(rejected))).toBe(true);

    // No map key equals, contains or embeds either token (or its prefix).
    const allKeys = [...internalCache.keys(), ...negativeCache.keys()];
    expect(allKeys).toHaveLength(2);
    for (const key of allKeys) {
      expect(key).not.toContain(token);
      expect(key).not.toContain(rejected);
      expect(key).not.toContain('thk_');
    }
  });

  it('salts the fingerprint per process, so it is not a plain digest of the token', () => {
    const salt = (AgentKeyAuthGuard as unknown as { CACHE_FINGERPRINT_SALT: Buffer })
      .CACHE_FINGERPRINT_SALT;
    expect(salt).toBeInstanceOf(Buffer);
    expect(salt.length).toBe(16);
    expect(testCacheKey('thk_same-token')).toBe(testCacheKey('thk_same-token'));
    expect(scryptFingerprint('thk_same-token', Buffer.alloc(16))).not.toBe(
      testCacheKey('thk_same-token'),
    );
  });

  it('invalidateCache drops the fingerprinted entries for a raw key', async () => {
    const token = 'thk_invalidate-fingerprint';
    mockGetMany.mockResolvedValue([]);
    const { ctx } = makeContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');
    const negativeCache = (AgentKeyAuthGuard as unknown as { negativeCache: Map<string, number> })
      .negativeCache;
    expect(negativeCache.has(testCacheKey(token))).toBe(true);

    guard.invalidateCache(token);
    expect(negativeCache.has(testCacheKey(token))).toBe(false);
  });

  it('rejects an over-long token before it can reach the caches', async () => {
    const token = `thk_${'a'.repeat(600)}`;
    const { ctx } = makeContext({ 'x-api-key': token });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
    expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
    const negativeCache = (AgentKeyAuthGuard as unknown as { negativeCache: Map<string, number> })
      .negativeCache;
    expect(negativeCache.size).toBe(0);
  });

  it('caches entries for the configured 5 minute TTL', async () => {
    const token = 'thk_ttl-check-key';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-ttl',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const before = Date.now();
    const { ctx } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx);

    const internalCache = (AgentKeyAuthGuard as any).cache as Map<string, { expiresAt: number }>;
    const entry = internalCache.get(testCacheKey(token));
    expect(entry).toBeDefined();
    const ttlMs = entry!.expiresAt - before;
    expect(ttlMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
  });

  it('LRU touch on cache hit moves entry to tail of insertion order', async () => {
    const token = 'thk_lru-touch-key';
    mockGetMany.mockResolvedValue([
      {
        id: 'key-lru',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: hashKey(token),
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx);

    const internalCache = (AgentKeyAuthGuard as any).cache as Map<string, unknown>;
    internalCache.set(testCacheKey('thk_other-1'), {
      tenantId: 't',
      agentId: 'a',
      agentName: 'n',
      userId: 'u',
      expiresAt: Date.now() + 999_999,
    });

    expect(Array.from(internalCache.keys())[0]).toBe(testCacheKey(token));

    const { ctx: ctx2 } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx2);

    expect(Array.from(internalCache.keys())[1]).toBe(testCacheKey(token));
  });

  it('invalidateCache removes a specific key from cache', async () => {
    const token = 'thk_inv-key-test';
    const storedHash = hashKey(token);
    mockGetMany.mockResolvedValue([
      {
        id: 'key-inv',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: storedHash,
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const { ctx } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx);

    guard.invalidateCache(token);
    mockCreateQueryBuilder.mockClear();
    mockGetMany.mockClear();

    mockGetMany.mockResolvedValue([
      {
        id: 'key-inv',
        tenant_id: 'tenant-1',
        agent_id: 'agent-1',
        key_hash: storedHash,
        expires_at: null,
        agent: { name: 'test-agent' },
        tenant: { owner_user_id: 'user-1' },
      },
    ]);

    const mockSelectQb2 = {
      select: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: mockGetMany,
    };
    const mockUpdateQb2 = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    mockCreateQueryBuilder.mockImplementation((alias?: string) => {
      return alias ? mockSelectQb2 : mockUpdateQb2;
    });

    const { ctx: ctx2 } = makeContext({ authorization: `Bearer ${token}` });
    await guard.canActivate(ctx2);

    expect(mockGetMany).toHaveBeenCalledTimes(1);
  });

  describe('negative cache (rejected-key storm protection)', () => {
    const negativeCacheOf = (_g: AgentKeyAuthGuard) =>
      (AgentKeyAuthGuard as unknown as { negativeCache: Map<string, number> }).negativeCache;

    it('serves a repeated bad key from the negative cache without a second DB lookup or log', async () => {
      mockGetMany.mockResolvedValue([]); // unknown key — DB returns no candidates
      const logger = (guard as unknown as { logger: { warn: jest.Mock } }).logger;
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      const { ctx: ctx1 } = makeContext({ authorization: 'Bearer thk_bad-key-storm' });
      await expect(guard.canActivate(ctx1)).rejects.toThrow('Invalid API key');
      // First miss pays the DB lookup and logs once.
      expect(mockGetMany).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      mockCreateQueryBuilder.mockClear();
      mockGetMany.mockClear();
      warnSpy.mockClear();

      const { ctx: ctx2 } = makeContext({ authorization: 'Bearer thk_bad-key-storm' });
      await expect(guard.canActivate(ctx2)).rejects.toThrow('Invalid API key');
      // The repeat is served from the negative cache: no DB query, no log line.
      expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('records a rejected unknown key for the configured TTL', async () => {
      const token = 'thk_record-bad-key';
      const { ctx } = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');

      const negCache = negativeCacheOf(guard);
      expect(negCache.has(testCacheKey(token))).toBe(true);
      // Stored under the fingerprint, never the raw token.
      expect(negCache.has(token)).toBe(false);
      const ttl = negCache.get(testCacheKey(token))! - Date.now();
      expect(ttl).toBeGreaterThan(30 * 1000 - 2000);
      expect(ttl).toBeLessThanOrEqual(30 * 1000 + 100);
    });

    it('LRU-touches a negative entry on a cache hit (moves it to the tail)', async () => {
      const { ctx } = makeContext({ authorization: 'Bearer thk_neg-lru-key' });
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');

      const negCache = negativeCacheOf(guard);
      negCache.set(testCacheKey('thk_neg-other'), Date.now() + 999_999);
      expect(Array.from(negCache.keys())[0]).toBe(testCacheKey('thk_neg-lru-key'));

      const { ctx: ctx2 } = makeContext({ authorization: 'Bearer thk_neg-lru-key' });
      await expect(guard.canActivate(ctx2)).rejects.toThrow('Invalid API key');
      // After the touch the rejected key sits behind the other entry.
      expect(Array.from(negCache.keys())[1]).toBe(testCacheKey('thk_neg-lru-key'));
    });

    it('drops a stale negative entry and re-checks the DB so a since-created key works', async () => {
      const token = 'thk_was-bad-now-good';
      const negCache = negativeCacheOf(guard);
      // An already-expired negative entry from an earlier rejection.
      negCache.set(testCacheKey(token), Date.now() - 1000);

      // The key now exists in the DB (created after that rejection).
      mockGetMany.mockResolvedValue([
        {
          id: 'key-revived',
          tenant_id: 'tenant-1',
          agent_id: 'agent-1',
          key_hash: hashKey(token),
          expires_at: null,
          agent: { name: 'test-agent' },
          tenant: { owner_user_id: 'user-1' },
        },
      ]);

      const { ctx, req } = makeContext({ authorization: `Bearer ${token}` });
      expect(await guard.canActivate(ctx)).toBe(true);
      expect(req.ingestionContext).toBeDefined();
      expect(negCache.has(testCacheKey(token))).toBe(false);
    });

    it('evicts the oldest negative entry when the negative cache is full', async () => {
      const negCache = negativeCacheOf(guard);
      const firstHash = testCacheKey('thk_neg-filler-0');
      for (let i = 0; i < 10_000; i++) {
        negCache.set(testCacheKey(`thk_neg-filler-${i}`), Date.now() + 999_999);
      }
      expect(negCache.size).toBe(10_000);

      const token = 'thk_neg-overflow-key';
      const { ctx } = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');

      expect(negCache.has(firstHash)).toBe(false);
      expect(negCache.has(testCacheKey(token))).toBe(true);
      expect(negCache.size).toBeLessThanOrEqual(10_000);
    });

    it('evictExpired also sweeps expired negative-cache entries but keeps live ones', async () => {
      const negCache = negativeCacheOf(guard);
      const expiredHash = testCacheKey('thk_neg-expired');
      const liveHash = testCacheKey('thk_neg-live');
      negCache.set(expiredHash, Date.now() - 1000);
      negCache.set(liveHash, Date.now() + 999_999);

      // A successful validation runs evictExpired() before caching, which now
      // sweeps the negative cache too.
      const token = 'thk_valid-triggers-evict';
      mockGetMany.mockResolvedValue([
        {
          id: 'key-ev',
          tenant_id: 'tenant-1',
          agent_id: 'agent-1',
          key_hash: hashKey(token),
          expires_at: null,
          agent: { name: 'test-agent' },
          tenant: { owner_user_id: 'user-1' },
        },
      ]);
      const { ctx } = makeContext({ authorization: `Bearer ${token}` });
      await guard.canActivate(ctx);

      expect(negCache.has(expiredHash)).toBe(false);
      expect(negCache.has(liveHash)).toBe(true);
    });

    it('invalidateCache removes the negative entry so a re-created key is not stuck', async () => {
      const token = 'thk_inv-neg-key';
      const { ctx } = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');

      const negCache = negativeCacheOf(guard);
      expect(negCache.has(testCacheKey(token))).toBe(true);

      guard.invalidateCache(token);
      expect(negCache.has(testCacheKey(token))).toBe(false);
    });

    it('invalidation reaches every guard instance (proxy vs otlp enhancer split)', async () => {
      // Nest instantiates class-referenced @UseGuards enhancers per host
      // module, so rotate-key clears a DIFFERENT guard instance than the one
      // authenticating proxy traffic. The caches are static so a clear issued
      // through ANY instance revokes the warm entry every instance sees.
      const token = 'thk_cross-instance-key';
      const firstGetMany = mockGetMany;
      firstGetMany.mockResolvedValue([
        {
          id: 'key-x',
          tenant_id: 'tenant-x',
          agent_id: 'agent-x',
          key_hash: hashKey(token),
          expires_at: null,
          agent: { name: 'x' },
          tenant: { owner_user_id: 'user-x' },
        },
      ]);
      const { ctx } = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true); // warms the shared cache

      const rotatePathInstance = new AgentKeyAuthGuard(buildMockRepo(), createMockConfig()); // a different instance, as in production
      firstGetMany.mockResolvedValue([]); // rotation deleted the row
      rotatePathInstance.invalidateCache(token); // rotate clears via the OTHER instance

      const { ctx: ctx2 } = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx2)).rejects.toThrow('Invalid API key');
      rotatePathInstance.onModuleDestroy();
    });

    it('clearCache empties the negative cache', async () => {
      const token = 'thk_clear-neg-key';
      const { ctx } = makeContext({ authorization: `Bearer ${token}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');

      const negCache = negativeCacheOf(guard);
      expect(negCache.size).toBe(1);

      guard.clearCache();
      expect(negCache.size).toBe(0);
    });
  });

  describe('x-api-key transport (Anthropic SDK)', () => {
    const VALID = 'thk_x-api-key-valid';
    const OTHER = 'thk_x-api-key-other';

    function seedValidKey(token = VALID) {
      mockGetMany.mockResolvedValue([
        {
          id: 'key-xak',
          tenant_id: 'tenant-xak',
          agent_id: 'agent-xak',
          key_hash: hashKey(token),
          expires_at: null,
          agent: { name: 'xak-agent' },
          tenant: { owner_user_id: 'user-xak' },
        },
      ]);
    }

    const EXPECTED_CONTEXT = {
      tenantId: 'tenant-xak',
      agentId: 'agent-xak',
      agentName: 'xak-agent',
      userId: 'user-xak',
    };

    function warnSpy(g: AgentKeyAuthGuard): jest.SpyInstance {
      const logger = (g as unknown as { logger: { warn: jest.Mock } }).logger;
      return jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    }

    function loggedText(spy: jest.SpyInstance): string {
      return spy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    }

    it('accepts Bearer only', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({ authorization: `Bearer ${VALID}` });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.ingestionContext).toEqual(EXPECTED_CONTEXT);
    });

    it('accepts x-api-key only', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({ 'x-api-key': VALID });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.ingestionContext).toEqual(EXPECTED_CONTEXT);
    });

    it('accepts both headers when they carry the same key', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({ authorization: `Bearer ${VALID}`, 'x-api-key': VALID });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.ingestionContext).toEqual(EXPECTED_CONTEXT);
      expect(mockGetMany).toHaveBeenCalledTimes(1);
    });

    it('accepts a raw Authorization value equal to x-api-key', async () => {
      seedValidKey();
      const { ctx } = makeContext({ authorization: VALID, 'x-api-key': VALID });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects both headers with different keys before touching the DB', async () => {
      seedValidKey();
      const spy = warnSpy(guard);
      const { ctx, req } = makeContext({ authorization: `Bearer ${VALID}`, 'x-api-key': OTHER });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(CONFLICTING_API_KEY_HEADERS);
      expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
      expect(req.ingestionContext).toBeUndefined();
      const logged = loggedText(spy);
      expect(logged).toContain('conflicting');
      expect(logged).not.toContain(VALID);
      expect(logged).not.toContain(OTHER);
    });

    it('rejects conflicting headers in either order', async () => {
      seedValidKey();
      const { ctx } = makeContext({ authorization: `Bearer ${OTHER}`, 'x-api-key': VALID });
      await expect(guard.canActivate(ctx)).rejects.toThrow(CONFLICTING_API_KEY_HEADERS);
    });

    it('does not cache a conflict, so a later single-header request still works', async () => {
      seedValidKey();
      const { ctx: conflicting } = makeContext({
        authorization: `Bearer ${OTHER}`,
        'x-api-key': VALID,
      });
      await expect(guard.canActivate(conflicting)).rejects.toThrow(CONFLICTING_API_KEY_HEADERS);

      const { ctx } = makeContext({ 'x-api-key': VALID });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    // Pinned so a refactor cannot silently start ignoring a non-Bearer
    // Authorization value or preferring one header over the other. When both
    // headers are present they must be byte-equal, whatever they contain.
    it('rejects an empty Bearer (Node trims it to "Bearer") next to a valid x-api-key', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({ authorization: 'Bearer', 'x-api-key': VALID });
      await expect(guard.canActivate(ctx)).rejects.toThrow(CONFLICTING_API_KEY_HEADERS);
      expect(req.ingestionContext).toBeUndefined();
      expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
    });

    it('rejects a non-Bearer Authorization scheme next to a valid x-api-key', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({ authorization: 'Basic xyz', 'x-api-key': VALID });
      await expect(guard.canActivate(ctx)).rejects.toThrow(CONFLICTING_API_KEY_HEADERS);
      expect(req.ingestionContext).toBeUndefined();
    });

    it('rejects a duplicated x-api-key (joined by Node as "A, B") on its own as an unknown key', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({ 'x-api-key': `${VALID}, ${OTHER}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(/^Invalid API key$/);
      await expect(guard.canActivate(ctx)).rejects.not.toThrow(CONFLICTING_API_KEY_HEADERS);
      expect(req.ingestionContext).toBeUndefined();
    });

    it('rejects a duplicated identical x-api-key ("A, A") as an unknown key', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({ 'x-api-key': `${VALID}, ${VALID}` });
      await expect(guard.canActivate(ctx)).rejects.toThrow(/^Invalid API key$/);
      expect(req.ingestionContext).toBeUndefined();
    });

    it('treats a pre-split x-api-key array like the joined header', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({
        'x-api-key': [VALID, OTHER] as unknown as string,
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(/^Invalid API key$/);
      expect(req.ingestionContext).toBeUndefined();
    });

    it('rejects a duplicated x-api-key ("A, B") next to Bearer A as conflicting', async () => {
      seedValidKey();
      const { ctx, req } = makeContext({
        authorization: `Bearer ${VALID}`,
        'x-api-key': `${VALID}, ${OTHER}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(CONFLICTING_API_KEY_HEADERS);
      expect(req.ingestionContext).toBeUndefined();
    });

    it('rejects a request with neither header', async () => {
      const { ctx } = makeContext({});
      await expect(guard.canActivate(ctx)).rejects.toThrow('Authorization header required');
    });

    it('treats an empty x-api-key as absent', async () => {
      const { ctx } = makeContext({ 'x-api-key': '' });
      await expect(guard.canActivate(ctx)).rejects.toThrow('Authorization header required');
    });

    it('rejects an unknown key sent via x-api-key without logging it', async () => {
      mockGetMany.mockResolvedValue([]);
      const spy = warnSpy(guard);
      const { ctx } = makeContext({ 'x-api-key': OTHER });

      await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key');
      expect(loggedText(spy)).not.toContain(OTHER);
    });

    it('applies the same format checks to x-api-key', async () => {
      const { ctx: noPrefix } = makeContext({ 'x-api-key': 'sk-ant-not-a-gateway-key' });
      await expect(guard.canActivate(noPrefix)).rejects.toThrow('Invalid API key format');

      const { ctx: tooShort } = makeContext({ 'x-api-key': 'thk_ab' });
      await expect(guard.canActivate(tooShort)).rejects.toThrow('Invalid API key format');
      expect(mockCreateQueryBuilder).not.toHaveBeenCalled();
    });

    it('shares the positive cache across transports', async () => {
      seedValidKey();
      const { ctx: viaBearer } = makeContext({ authorization: `Bearer ${VALID}` });
      await guard.canActivate(viaBearer);
      expect(mockGetMany).toHaveBeenCalledTimes(1);

      mockGetMany.mockClear();
      const { ctx: viaHeader, req } = makeContext({ 'x-api-key': VALID });
      await expect(guard.canActivate(viaHeader)).resolves.toBe(true);
      expect(mockGetMany).not.toHaveBeenCalled();
      expect(mockExistsBy).toHaveBeenCalledWith({ id: 'key-xak', is_active: true });
      expect(req.ingestionContext).toEqual(EXPECTED_CONTEXT);
    });

    it('shares the negative cache across transports', async () => {
      mockGetMany.mockResolvedValue([]);
      const { ctx: viaHeader } = makeContext({ 'x-api-key': OTHER });
      await expect(guard.canActivate(viaHeader)).rejects.toThrow('Invalid API key');
      expect(mockGetMany).toHaveBeenCalledTimes(1);

      const { ctx: viaBearer } = makeContext({ authorization: `Bearer ${OTHER}` });
      await expect(guard.canActivate(viaBearer)).rejects.toThrow('Invalid API key');
      expect(mockGetMany).toHaveBeenCalledTimes(1);
    });

    it('rejects an expired key sent via x-api-key and keeps it attributable (M004)', async () => {
      mockGetMany.mockResolvedValue([
        {
          id: 'key-xak-exp',
          tenant_id: 'tenant-xak',
          agent_id: 'agent-xak',
          key_hash: hashKey(VALID),
          expires_at: new Date(Date.now() - 1000).toISOString(),
          agent: { name: 'xak-agent' },
          tenant: { owner_user_id: 'user-xak' },
        },
      ]);
      const { ctx, req } = makeContext({ 'x-api-key': VALID });
      await expect(guard.canActivate(ctx)).rejects.toThrow('API key expired');
      expect(req.thinkerErrorContext).toEqual(EXPECTED_CONTEXT);
    });

    describe('dev loopback', () => {
      const DEV_KEY_ROW = {
        tenant_id: 'dev-tenant',
        agent_id: 'dev-agent',
        agent: { name: 'demo-agent' },
        tenant: { owner_user_id: 'dev-user' },
      };

      beforeEach(() => {
        guard.onModuleDestroy();
        guard = createGuard({ 'app.nodeEnv': 'development' });
      });

      it('allows a non-thk x-api-key from loopback, like Bearer', async () => {
        mockFindOne.mockResolvedValue(DEV_KEY_ROW);
        const { ctx, req } = makeContext({ 'x-api-key': 'dev-no-auth' }, '127.0.0.1');
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(req.ingestionContext).toEqual({
          tenantId: 'dev-tenant',
          agentId: 'dev-agent',
          agentName: 'demo-agent',
          userId: 'dev-user',
        });
      });

      it('rejects a non-thk x-api-key from a non-loopback peer', async () => {
        mockFindOne.mockResolvedValue(DEV_KEY_ROW);
        const { ctx } = makeContext({ 'x-api-key': 'dev-no-auth' }, '192.168.1.100');
        await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
      });

      it('still rejects conflicting headers from loopback', async () => {
        mockFindOne.mockResolvedValue(DEV_KEY_ROW);
        const { ctx } = makeContext(
          { authorization: 'Bearer dev-a', 'x-api-key': 'dev-b' },
          '127.0.0.1',
        );
        await expect(guard.canActivate(ctx)).rejects.toThrow(CONFLICTING_API_KEY_HEADERS);
        expect(mockFindOne).not.toHaveBeenCalled();
      });

      it('rejects a non-thk x-api-key from loopback outside development', async () => {
        guard.onModuleDestroy();
        guard = createGuard({ 'app.nodeEnv': 'production' });
        mockFindOne.mockResolvedValue(DEV_KEY_ROW);
        const { ctx } = makeContext({ 'x-api-key': 'dev-no-auth' }, '127.0.0.1');
        await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid API key format');
      });
    });
  });
});
