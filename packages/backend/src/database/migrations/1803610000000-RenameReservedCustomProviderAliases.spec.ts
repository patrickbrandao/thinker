import { Logger } from '@nestjs/common';
import { RenameReservedCustomProviderAliases1803610000000 } from './1803610000000-RenameReservedCustomProviderAliases';

describe('RenameReservedCustomProviderAliases1803610000000', () => {
  const migration = new RenameReservedCustomProviderAliases1803610000000();
  let queries: string[];
  let args: unknown[][];
  let rows: { id: string; tenant_id: string; alias: string }[];
  let warn: jest.SpyInstance;

  const mockQueryRunner = {
    query: jest.fn().mockImplementation((sql: string, ...params: unknown[]) => {
      queries.push(sql);
      args.push(params);
      if (sql.startsWith('SELECT')) return Promise.resolve(rows);
      return Promise.resolve([]);
    }),
  } as never;

  const updates = () => args.filter((_, i) => queries[i].startsWith('UPDATE'));

  beforeEach(() => {
    queries = [];
    args = [];
    rows = [];
    jest.clearAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('exposes the expected migration name', () => {
    expect(migration.name).toBe('RenameReservedCustomProviderAliases1803610000000');
  });

  it('reads aliased rows oldest first', async () => {
    await migration.up(mockQueryRunner);
    expect(queries[0]).toMatch(
      /^SELECT .* WHERE "alias" IS NOT NULL ORDER BY "created_at" ASC, "id" ASC$/,
    );
  });

  it('renames lmstudio and llamacpp aliases with a -custom suffix', async () => {
    rows = [
      { id: 'cp-1', tenant_id: 't1', alias: 'lmstudio' },
      { id: 'cp-2', tenant_id: 't1', alias: 'llamacpp' },
      { id: 'cp-3', tenant_id: 't1', alias: 'lm-studio' },
    ];
    await migration.up(mockQueryRunner);
    expect(updates()).toEqual([[['lmstudio-custom', 'cp-1']], [['llamacpp-custom', 'cp-2']]]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('lmstudio-custom/<model>');
  });

  it('matches a reserved alias stored in another case', async () => {
    rows = [{ id: 'cp-1', tenant_id: 't1', alias: 'LMStudio' }];
    await migration.up(mockQueryRunner);
    expect(updates()).toEqual([[['lmstudio-custom', 'cp-1']]]);
  });

  it('skips a suffix already taken in the tenant, but not in another tenant', async () => {
    rows = [
      { id: 'cp-1', tenant_id: 't1', alias: 'lmstudio-custom' },
      { id: 'cp-2', tenant_id: 't1', alias: 'lmstudio' },
      { id: 'cp-3', tenant_id: 't2', alias: 'lmstudio' },
    ];
    await migration.up(mockQueryRunner);
    expect(updates()).toEqual([[['lmstudio-custom-2', 'cp-2']], [['lmstudio-custom', 'cp-3']]]);
  });

  it('also moves any other built-in provider id', async () => {
    rows = [{ id: 'cp-1', tenant_id: 't1', alias: 'openai' }];
    await migration.up(mockQueryRunner);
    expect(updates()).toEqual([[['openai-custom', 'cp-1']]]);
  });

  it('is a no-op when no alias is reserved, so a re-run changes nothing', async () => {
    rows = [
      { id: 'cp-1', tenant_id: 't1', alias: 'lmstudio-custom' },
      { id: 'cp-2', tenant_id: 't1', alias: 'vercel-ai-gateway' },
    ];
    await migration.up(mockQueryRunner);
    expect(updates()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never logs a provider name', async () => {
    rows = [{ id: 'cp-1', tenant_id: 't1', alias: 'llamacpp' }];
    await migration.up(mockQueryRunner);
    expect(queries[0]).not.toContain('"name"');
  });

  it('has a no-op down', async () => {
    await migration.down();
    expect(queries).toEqual([]);
  });
});
