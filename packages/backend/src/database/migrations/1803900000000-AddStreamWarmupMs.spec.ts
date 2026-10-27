import { AddStreamWarmupMs1803900000000 } from './1803900000000-AddStreamWarmupMs';

describe('AddStreamWarmupMs1803900000000', () => {
  const migration = new AddStreamWarmupMs1803900000000();
  const query = jest.fn(async (_sql: string) => []);
  const runner = { query } as never;
  const statements = () => query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());

  beforeEach(() => query.mockClear());

  it('adds both nullable columns idempotently under a lock timeout', async () => {
    await migration.up(runner);
    expect(statements()).toEqual([
      `SET LOCAL lock_timeout = '10s'`,
      'ALTER TABLE "header_tiers" ADD COLUMN IF NOT EXISTS "stream_warmup_ms" integer NULL',
      'ALTER TABLE "tenant_providers" ADD COLUMN IF NOT EXISTS "stream_warmup_ms" integer NULL',
    ]);
  });

  it('drops both columns idempotently on down', async () => {
    await migration.down(runner);
    expect(statements()).toEqual([
      `SET LOCAL lock_timeout = '10s'`,
      'ALTER TABLE "tenant_providers" DROP COLUMN IF EXISTS "stream_warmup_ms"',
      'ALTER TABLE "header_tiers" DROP COLUMN IF EXISTS "stream_warmup_ms"',
    ]);
  });
});
