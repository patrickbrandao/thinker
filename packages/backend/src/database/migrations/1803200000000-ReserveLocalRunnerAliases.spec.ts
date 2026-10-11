import { ReserveLocalRunnerAliases1803200000000 } from './1803200000000-ReserveLocalRunnerAliases';

interface Row {
  id: string;
  tenant_id: string;
  alias: string;
}

/** A query runner that serves `rows` to the alias SELECT and records every other statement. */
function runner(rows: Row[], hasLegacyColumn = true) {
  const query = jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT "id", "tenant_id", "alias"')) return rows;
    if (sql.includes('information_schema.columns')) return hasLegacyColumn ? [{}] : [];
    return [];
  });
  return { query };
}

function updates(query: jest.Mock): unknown[][] {
  return query.mock.calls
    .filter(([sql]) => String(sql).startsWith('UPDATE "custom_providers" SET'))
    .map(([, params]) => params as unknown[]);
}

describe('ReserveLocalRunnerAliases1803200000000', () => {
  const migration = new ReserveLocalRunnerAliases1803200000000();

  it('adds the legacy_alias column idempotently', async () => {
    const { query } = runner([]);
    await migration.up({ query } as never);
    expect(query.mock.calls[0][0]).toBe(
      'ALTER TABLE "custom_providers" ADD COLUMN IF NOT EXISTS "legacy_alias" varchar',
    );
    expect(updates(query)).toEqual([]);
  });

  it('moves lmstudio and llamacpp to <id>-custom and keeps the old alias', async () => {
    const { query } = runner([
      { id: 'cp-1', tenant_id: 't-1', alias: 'lmstudio' },
      { id: 'cp-2', tenant_id: 't-1', alias: 'llamacpp' },
      { id: 'cp-3', tenant_id: 't-1', alias: 'vercel' },
      { id: 'cp-4', tenant_id: 't-1', alias: 'lm-studio' },
    ]);
    await migration.up({ query } as never);
    expect(updates(query)).toEqual([
      ['lmstudio-custom', 'lmstudio', 'cp-1'],
      ['llamacpp-custom', 'llamacpp', 'cp-2'],
    ]);
  });

  it('matches the reserved ids case-insensitively and stores the alias as it was', async () => {
    const { query } = runner([{ id: 'cp-1', tenant_id: 't-1', alias: 'LMStudio' }]);
    await migration.up({ query } as never);
    expect(updates(query)).toEqual([['lmstudio-custom', 'LMStudio', 'cp-1']]);
  });

  it('picks the next free suffix when the tenant already uses <id>-custom', async () => {
    const { query } = runner([
      { id: 'cp-1', tenant_id: 't-1', alias: 'lmstudio-custom' },
      { id: 'cp-2', tenant_id: 't-1', alias: 'LMSTUDIO-CUSTOM-2' },
      { id: 'cp-3', tenant_id: 't-1', alias: 'lmstudio' },
    ]);
    await migration.up({ query } as never);
    expect(updates(query)).toEqual([['lmstudio-custom-3', 'lmstudio', 'cp-3']]);
  });

  it('scopes the suffix choice to the tenant', async () => {
    const { query } = runner([
      { id: 'cp-1', tenant_id: 't-1', alias: 'lmstudio-custom' },
      { id: 'cp-2', tenant_id: 't-1', alias: 'lmstudio' },
      { id: 'cp-3', tenant_id: 't-2', alias: 'lmstudio' },
    ]);
    await migration.up({ query } as never);
    expect(updates(query)).toEqual([
      ['lmstudio-custom-2', 'lmstudio', 'cp-2'],
      ['lmstudio-custom', 'lmstudio', 'cp-3'],
    ]);
  });

  it('restores the old alias where it is still free, then drops the column', async () => {
    const { query } = runner([]);
    await migration.down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' '));
    expect(statements[1]).toContain('SET "alias" = cp."legacy_alias"');
    expect(statements[1]).toContain('LOWER(other."alias") = LOWER(cp."legacy_alias")');
    expect(statements[2]).toBe(
      'ALTER TABLE "custom_providers" DROP COLUMN IF EXISTS "legacy_alias"',
    );
  });

  it('does nothing on revert when the column is already gone', async () => {
    const { query } = runner([], false);
    await migration.down({ query } as never);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
