import { DropSaasFeatureSchema1803300000000 } from './1803300000000-DropSaasFeatureSchema';

async function run(direction: 'up' | 'down'): Promise<string[]> {
  const query = jest.fn(async () => []);
  await new DropSaasFeatureSchema1803300000000()[direction]({ query } as never);
  return query.mock.calls.map((call) => String((call as unknown[])[0]));
}

describe('DropSaasFeatureSchema1803300000000', () => {
  it('sets a transaction-local lock timeout before taking any lock', async () => {
    const sql = await run('up');

    expect(sql[0]).toBe(`SET LOCAL lock_timeout = '10s'`);
  });

  it('removes Gemini Free grants before the connections they point at', async () => {
    const sql = await run('up');
    const at = (fragment: string) => sql.findIndex((statement) => statement.includes(fragment));

    const grants = at('DELETE FROM "agent_enabled_providers"');
    const connections = at('DELETE FROM "tenant_providers"');
    expect(grants).toBeGreaterThan(0);
    expect(connections).toBeGreaterThan(grants);
    expect(sql[connections]).toContain(`LOWER("provider") = 'gemini-free'`);
  });

  it('drops the SaaS tables and the CRM index idempotently', async () => {
    const sql = (await run('up')).join('\n');

    expect(sql).toContain('DROP TABLE IF EXISTS "waitlist_claims"');
    expect(sql).toContain('DROP TABLE IF EXISTS "public_error_pages"');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_requests_autofix_healed"');
    expect(sql).not.toMatch(/DROP (TABLE|INDEX) (?!IF EXISTS)/);
  });

  it('restores the self-hosted tables on revert, without the CRM index', async () => {
    const sql = (await run('down')).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "waitlist_claims"');
    expect(sql).toContain('CONSTRAINT "UQ_waitlist_claims_email" UNIQUE ("email")');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public_error_pages"');
    expect(sql).not.toContain('IDX_requests_autofix_healed');
    expect(sql).not.toContain('SET LOCAL');
  });
});
