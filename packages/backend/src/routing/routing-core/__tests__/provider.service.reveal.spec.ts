import type { Repository } from 'typeorm';
import { ProviderService } from '../provider.service';
import type { TenantProvider } from '../../../entities/tenant-provider.entity';
import { encrypt } from '../../../common/utils/crypto.util';

const SECRET = 'r'.repeat(48);

describe('ProviderService.revealApiKey', () => {
  const original = process.env.THINKER_ENCRYPTION_KEY;
  let rows: Partial<TenantProvider>[];
  let svc: ProviderService;
  let findOne: jest.Mock;

  beforeAll(() => {
    process.env.THINKER_ENCRYPTION_KEY = SECRET;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.THINKER_ENCRYPTION_KEY;
    else process.env.THINKER_ENCRYPTION_KEY = original;
  });

  beforeEach(() => {
    rows = [
      {
        id: 'conn-key',
        tenant_id: 'tenant-a',
        provider: 'opencode',
        auth_type: 'api_key',
        api_key_encrypted: encrypt('public', SECRET),
      },
      {
        id: 'conn-local',
        tenant_id: 'tenant-a',
        provider: 'custom:1',
        auth_type: 'local',
        api_key_encrypted: encrypt('lm-studio-key', SECRET),
      },
      {
        id: 'conn-oauth',
        tenant_id: 'tenant-a',
        provider: 'openai',
        auth_type: 'subscription',
        api_key_encrypted: encrypt('{"t":"a","r":"b"}', SECRET),
      },
      {
        id: 'conn-blob-as-key',
        tenant_id: 'tenant-a',
        provider: 'openai',
        auth_type: 'api_key',
        api_key_encrypted: encrypt('{"access_token":"x"}', SECRET),
      },
      {
        id: 'conn-other-tenant',
        tenant_id: 'tenant-b',
        provider: 'openai',
        auth_type: 'api_key',
        api_key_encrypted: encrypt('sk-tenant-b-secret', SECRET),
      },
      {
        id: 'conn-undecryptable',
        tenant_id: 'tenant-a',
        provider: 'openai',
        auth_type: 'api_key',
        api_key_encrypted: encrypt('sk-other-instance', 'z'.repeat(48)),
      },
    ];
    findOne = jest.fn(async ({ where }: { where: { id: string; tenant_id: string } }) => {
      return rows.find((r) => r.id === where.id && r.tenant_id === where.tenant_id) ?? null;
    });
    const repo = { findOne } as unknown as Repository<TenantProvider>;
    svc = new ProviderService(
      repo,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('returns the plaintext API key of a connection in the tenant', async () => {
    await expect(svc.revealApiKey('tenant-a', 'conn-key')).resolves.toMatchObject({
      apiKey: 'public',
    });
    expect(findOne).toHaveBeenCalledWith({ where: { id: 'conn-key', tenant_id: 'tenant-a' } });
  });

  it('reveals a local server key', async () => {
    await expect(svc.revealApiKey('tenant-a', 'conn-local')).resolves.toMatchObject({
      apiKey: 'lm-studio-key',
    });
  });

  it('is tenant-scoped: another tenant cannot read a connection by id', async () => {
    await expect(svc.revealApiKey('tenant-a', 'conn-other-tenant')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses subscription credentials', async () => {
    await expect(svc.revealApiKey('tenant-a', 'conn-oauth')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'credential_not_revealable' }),
    });
  });

  it('refuses an OAuth token blob even when stored as an API key', async () => {
    await expect(svc.revealApiKey('tenant-a', 'conn-blob-as-key')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'credential_not_revealable' }),
    });
  });

  it('reports a key that does not decrypt', async () => {
    await expect(svc.revealApiKey('tenant-a', 'conn-undecryptable')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'key_not_decryptable' }),
    });
  });
});
