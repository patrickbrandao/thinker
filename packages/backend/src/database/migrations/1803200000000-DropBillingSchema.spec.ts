import { DropBillingSchema1803200000000 } from './1803200000000-DropBillingSchema';

async function run(direction: 'up' | 'down'): Promise<string[]> {
  const query = jest.fn(async () => []);
  await new DropBillingSchema1803200000000()[direction]({ query } as never);
  return query.mock.calls.map((call) => String((call as unknown[])[0]));
}

describe('DropBillingSchema1803200000000', () => {
  it('drops the quota trigger and function before the table they write to', async () => {
    const sql = await run('up');
    const at = (fragment: string) => sql.findIndex((statement) => statement.includes(fragment));

    expect(at('DROP TRIGGER IF EXISTS "TRG_agent_messages_count_tenant_request_usage"')).toBe(0);
    expect(at('DROP FUNCTION IF EXISTS "count_tenant_request_usage"()')).toBe(1);
    expect(at('DROP TABLE IF EXISTS "tenant_request_usage"')).toBeGreaterThan(1);
  });

  it('drops every billing table and column idempotently', async () => {
    const sql = (await run('up')).join('\n');

    expect(sql).toContain(
      `DELETE FROM "backfill_state" WHERE "name" = 'tenant_request_usage_cutover_v1'`,
    );
    expect(sql).toContain('ALTER TABLE "requests" DROP COLUMN IF EXISTS "quota_counted"');
    expect(sql).toContain('DROP TABLE IF EXISTS "tenant_request_usage"');
    expect(sql).toContain('DROP TABLE IF EXISTS "billing_email_logs"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "limit_overrides"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "billing_email_preferences"');
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN|TRIGGER|FUNCTION) (?!IF EXISTS)/);
  });

  it('restores the self-hosted billing schema on revert, without the quota counter', async () => {
    const sql = (await run('down')).join('\n');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "limit_overrides" jsonb');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "billing_email_preferences" jsonb');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "billing_email_logs"');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_email_logs_dedupe_key"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_billing_email_logs_tenant_period"');
    expect(sql).not.toContain('tenant_request_usage');
  });
});
