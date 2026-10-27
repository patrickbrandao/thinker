import { MeController } from './me.controller';
import { Request } from 'express';

describe('MeController', () => {
  const tenantRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 't1', name: 't1', organization_name: 'Acme' }),
  };
  const controller = new MeController(tenantRepo as never);

  it('returns tenant, user, and auth method from the request', async () => {
    const request = { authMethod: 'api_key' } as Request & { authMethod: string };
    expect(await controller.me({ tenantId: 't1', userId: 'u1' }, request)).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      authMethod: 'api_key',
      expiresAt: null,
    });
  });

  it('reports a null auth method when no guard stamped one', async () => {
    expect(await controller.me({ tenantId: 't1', userId: null }, {} as Request)).toMatchObject({
      tenantId: 't1',
      userId: null,
      authMethod: null,
      expiresAt: null,
    });
  });

  it('echoes the key expiry the guard stamped on the request', async () => {
    const expiresAt = '2026-09-01T00:00:00.000Z';
    const request = { authMethod: 'api_key', apiKeyExpiresAt: expiresAt } as Request & {
      authMethod: string;
      apiKeyExpiresAt: string;
    };
    expect(await controller.me({ tenantId: 't1', userId: 'u1' }, request)).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      authMethod: 'api_key',
      expiresAt,
    });
  });

  it('reports a null expiry for a non-expiring key', async () => {
    const request = { authMethod: 'api_key', apiKeyExpiresAt: null } as Request & {
      authMethod: string;
      apiKeyExpiresAt: string | null;
    };
    expect(await controller.me({ tenantId: 't1', userId: 'u1' }, request)).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      authMethod: 'api_key',
      expiresAt: null,
    });
  });
});

describe('MeController organization fields (ADR 0006)', () => {
  it('reports the active organization, role and account flags', async () => {
    const tenantRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 't1', name: 't1', organization_name: 'Acme' }),
    };
    const controller = new MeController(tenantRepo as never);
    await expect(
      controller.me(
        {
          tenantId: 't1',
          userId: 'u1',
          role: 'admin',
          isInstanceAdmin: true,
          mustChangePassword: false,
        },
        {} as Request,
      ),
    ).resolves.toMatchObject({
      isInstanceAdmin: true,
      mustChangePassword: false,
      organization: { id: 't1', name: 'Acme', role: 'admin' },
    });
  });
});
