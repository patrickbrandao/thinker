import { AddTenantRequestUsage1801300000000 } from './1801300000000-AddTenantRequestUsage';

describe('AddTenantRequestUsage1801300000000', () => {
  let statements: Array<{ sql: string; params?: unknown[] }>;
  const queryRunner = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params });
    }),
    startTransaction: jest.fn(async () => undefined),
    commitTransaction: jest.fn(async () => undefined),
    rollbackTransaction: jest.fn(async () => undefined),
  };

  beforeEach(() => {
    statements = [];
    jest.clearAllMocks();
  });

  it('keeps only the self-hosted path: no quota counter schema is created', async () => {
    const migration = new AddTenantRequestUsage1801300000000();
    await migration.up();

    expect(migration.transaction).toBe(false);
    expect(queryRunner.query).not.toHaveBeenCalled();
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('removes the trigger before its supporting columns and table', async () => {
    await new AddTenantRequestUsage1801300000000().down(queryRunner as never);

    const sql = statements.map((statement) => statement.sql).join('\n');
    expect(sql.indexOf('DROP TRIGGER')).toBeLessThan(sql.indexOf('DROP FUNCTION'));
    expect(sql).toContain(
      `DELETE FROM "backfill_state" WHERE "name" = 'tenant_request_usage_cutover_v1'`,
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS "quota_counted"');
    expect(sql).toContain('DROP TABLE IF EXISTS "tenant_request_usage"');
    expect(statements.at(-1)?.sql).toContain('RESET lock_timeout');
  });
});
