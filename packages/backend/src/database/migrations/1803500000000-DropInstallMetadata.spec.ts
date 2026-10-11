import { DropInstallMetadata1803500000000 } from './1803500000000-DropInstallMetadata';

async function run(direction: 'up' | 'down'): Promise<string[]> {
  const query = jest.fn(async () => []);
  await new DropInstallMetadata1803500000000()[direction]({ query } as never);
  return query.mock.calls.map((call) => String((call as unknown[])[0]));
}

describe('DropInstallMetadata1803500000000', () => {
  it('keeps a name ordered after the #16 schema drop', () => {
    expect(new DropInstallMetadata1803500000000().name).toBe('DropInstallMetadata1803500000000');
  });

  it('sets a transaction-local lock timeout, then drops the table idempotently', async () => {
    expect(await run('up')).toEqual([
      `SET LOCAL lock_timeout = '10s'`,
      'DROP TABLE IF EXISTS "install_metadata"',
    ]);
  });

  it('recreates the telemetry table, empty and idempotently, on revert', async () => {
    const sql = (await run('down')).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "install_metadata"');
    for (const column of [
      '"id"',
      '"install_id"',
      '"created_at"',
      '"first_send_at"',
      '"last_sent_at"',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('CONSTRAINT "PK_install_metadata" PRIMARY KEY ("id")');
    expect(sql).not.toContain('autofix_consented_at');
    expect(sql).not.toMatch(/INSERT/i);
    expect(sql).not.toContain('SET LOCAL');
  });
});
