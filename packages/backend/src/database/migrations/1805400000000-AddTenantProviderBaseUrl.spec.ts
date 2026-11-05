import { AddTenantProviderBaseUrl1805400000000 } from './1805400000000-AddTenantProviderBaseUrl';

describe('AddTenantProviderBaseUrl1805400000000', () => {
  it('adds and drops a nullable tenant_providers.base_url', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddTenantProviderBaseUrl1805400000000();
    await migration.up({ query } as never);
    expect(query.mock.calls[0][0]).toContain(
      'ALTER TABLE "tenant_providers" ADD COLUMN IF NOT EXISTS "base_url" varchar',
    );
    await migration.down({ query } as never);
    expect(query.mock.calls[1][0]).toContain('DROP COLUMN IF EXISTS "base_url"');
  });
});
