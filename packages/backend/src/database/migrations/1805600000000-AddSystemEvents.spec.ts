import { AddSystemEvents1805600000000 } from './1805600000000-AddSystemEvents';

describe('AddSystemEvents1805600000000', () => {
  it('creates system_events with its indexes and drops it on down', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddSystemEvents1805600000000();
    await migration.up({ query } as never);
    const sql = query.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "system_events"');
    expect(sql).toContain('"read_by_user_id" varchar NULL');
    expect(sql).toContain('("tenant_id", "created_at" DESC)');
    expect(sql).toContain('("tenant_id", "category")');
    query.mockClear();
    await migration.down({ query } as never);
    expect(query.mock.calls[0][0]).toContain('DROP TABLE IF EXISTS "system_events"');
  });
});
