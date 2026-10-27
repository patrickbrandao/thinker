import {
  canWrite,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  resolveMcpOperator,
  scopesFromClaims,
} from './mcp-auth';
import type { TenantCacheService } from '../common/services/tenant-cache.service';

function tenantCacheReturning(tenantId: string | null, role = 'owner'): TenantCacheService {
  return {
    resolveAccess: jest.fn().mockResolvedValue({
      tenantId,
      role: tenantId ? role : null,
      isInstanceAdmin: false,
      mustChangePassword: false,
    }),
  } as unknown as TenantCacheService;
}

describe('scopesFromClaims', () => {
  it('splits the space-delimited scope claim', () => {
    expect([...scopesFromClaims({ scope: 'mcp:read mcp:write offline_access' })]).toEqual([
      MCP_READ_SCOPE,
      MCP_WRITE_SCOPE,
      'offline_access',
    ]);
  });

  it('treats a missing or non-string scope as no capabilities', () => {
    expect(scopesFromClaims({}).size).toBe(0);
    expect(scopesFromClaims({ scope: ['mcp:read'] }).size).toBe(0);
  });
});

describe('resolveMcpOperator', () => {
  it('maps the token subject to that user’s tenant', async () => {
    const cache = tenantCacheReturning('tenant-1');
    const operator = await resolveMcpOperator(cache, { sub: 'user-1', scope: MCP_READ_SCOPE });
    expect(operator).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      scopes: new Set([MCP_READ_SCOPE]),
      role: 'owner',
    });
    expect(cache.resolveAccess).toHaveBeenCalledWith('user-1');
  });

  it('refuses a token with no subject', async () => {
    const cache = tenantCacheReturning('tenant-1');
    expect(await resolveMcpOperator(cache, { scope: MCP_READ_SCOPE })).toBeNull();
    expect(cache.resolveAccess).not.toHaveBeenCalled();
  });

  it('refuses a user that has no tenant yet', async () => {
    const cache = tenantCacheReturning(null);
    expect(await resolveMcpOperator(cache, { sub: 'user-1' })).toBeNull();
  });
});

describe('canWrite (ADR 0006)', () => {
  const op = (role: 'viewer' | 'member' | 'admin' | 'owner', write = true) => ({
    userId: 'u',
    tenantId: 't',
    scopes: new Set(write ? [MCP_READ_SCOPE, MCP_WRITE_SCOPE] : [MCP_READ_SCOPE]),
    role,
  });

  it('needs both the write scope and the role', () => {
    expect(canWrite(op('viewer'))).toBe(false);
    expect(canWrite(op('member'))).toBe(true);
    expect(canWrite(op('member'), 'admin')).toBe(false);
    expect(canWrite(op('admin'), 'admin')).toBe(true);
    expect(canWrite(op('owner', false))).toBe(false);
  });
});
