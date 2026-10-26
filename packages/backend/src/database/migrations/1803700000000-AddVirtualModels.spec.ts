import { AddVirtualModels1803700000000 } from './1803700000000-AddVirtualModels';

describe('AddVirtualModels1803700000000', () => {
  const migration = new AddVirtualModels1803700000000();
  const query = jest.fn(async (_sql: string) => []);
  const runner = { query } as never;
  const statements = () => query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());

  beforeEach(() => query.mockClear());

  it('exposes the expected migration name', () => {
    expect(migration.name).toBe('AddVirtualModels1803700000000');
  });

  it('creates the table, its indexes and the agent_messages columns under a lock timeout', async () => {
    await migration.up(runner);
    const sql = statements();
    expect(sql[0]).toBe(`SET LOCAL lock_timeout = '10s'`);
    expect(sql[1]).toContain('CREATE TABLE IF NOT EXISTS "virtual_models"');
    expect(sql[1]).toContain('"name" varchar(64) NOT NULL');
    expect(sql[1]).toContain('"continue_on_default" boolean NOT NULL DEFAULT false');
    expect(sql[1]).toContain(`"response_mode" varchar NOT NULL DEFAULT 'buffered'`);
    expect(sql[1]).toContain(`"output_modality" varchar NOT NULL DEFAULT 'text'`);
    expect(sql[1]).toContain(
      'FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE CASCADE',
    );
    expect(sql[2]).toBe(
      'CREATE INDEX IF NOT EXISTS "IDX_virtual_models_agent_sort" ON "virtual_models" ("agent_id", "sort_order")',
    );
    expect(sql[3]).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_virtual_models_agent_name" ON "virtual_models" ("agent_id", LOWER("name"))',
    );
    expect(sql[4]).toBe(
      'ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "virtual_model_id" varchar NULL',
    );
    expect(sql[5]).toBe(
      'ALTER TABLE "agent_messages" ADD COLUMN IF NOT EXISTS "virtual_model_name" varchar NULL',
    );
    expect(sql).toHaveLength(6);
  });

  it('drops the columns and the table on down', async () => {
    await migration.down(runner);
    expect(statements()).toEqual([
      `SET LOCAL lock_timeout = '10s'`,
      'ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "virtual_model_name"',
      'ALTER TABLE "agent_messages" DROP COLUMN IF EXISTS "virtual_model_id"',
      'DROP TABLE IF EXISTS "virtual_models"',
    ]);
  });
});
