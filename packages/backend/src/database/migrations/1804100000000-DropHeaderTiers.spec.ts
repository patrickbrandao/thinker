import { DropHeaderTiers1804100000000 } from './1804100000000-DropHeaderTiers';

describe('DropHeaderTiers1804100000000', () => {
  const migration = new DropHeaderTiers1804100000000();
  const query = jest.fn(async (_sql: string) => []);
  const runner = { query } as never;
  const statements = () => query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());

  beforeEach(() => query.mockClear());

  it('deletes header-scoped params, then drops the table and the message columns', async () => {
    await migration.up(runner);
    expect(statements()).toEqual([
      `SET LOCAL lock_timeout = '10s'`,
      `DELETE FROM "agent_model_params" WHERE "scope_key" LIKE 'header:%'`,
      'DROP TABLE IF EXISTS "header_tiers"',
      'ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "header_tier_color"',
      'ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "header_tier_name"',
      'ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "header_tier_id"',
    ]);
  });

  it('recreates the columns and the table idempotently on down', async () => {
    await migration.down(runner);
    const sql = statements();
    expect(sql[0]).toBe(`SET LOCAL lock_timeout = '10s'`);
    expect(sql).toContain(
      'ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "header_tier_id" varchar DEFAULT NULL',
    );
    expect(sql.some((s) => s.startsWith('CREATE TABLE IF NOT EXISTS "header_tiers"'))).toBe(true);
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_header_tiers_agent_name" ON "header_tiers" ("agent_id", LOWER("name"))',
    );
  });
});
