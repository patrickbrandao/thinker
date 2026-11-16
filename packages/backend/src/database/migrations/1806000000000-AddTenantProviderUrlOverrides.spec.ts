import { AddTenantProviderUrlOverrides1806000000000 } from './1806000000000-AddTenantProviderUrlOverrides';

describe('AddTenantProviderUrlOverrides1806000000000', () => {
  it('adds and drops a nullable tenant_providers.url_overrides jsonb', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddTenantProviderUrlOverrides1806000000000();
    await migration.up({ query } as never);
    expect(query.mock.calls[0][0]).toContain(
      'ALTER TABLE "tenant_providers" ADD COLUMN IF NOT EXISTS "url_overrides" jsonb',
    );
    expect(query.mock.calls[1][0]).toContain(
      'ALTER TABLE "oauth_pending_flows" ADD COLUMN IF NOT EXISTS "url_overrides" jsonb',
    );
    await migration.down({ query } as never);
    expect(query.mock.calls[2][0]).toContain('DROP COLUMN IF EXISTS "url_overrides"');
    expect(query.mock.calls[3][0]).toContain('"tenant_providers" DROP COLUMN IF EXISTS');
  });
});
