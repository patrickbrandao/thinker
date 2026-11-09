import { Logger } from '@nestjs/common';
import { RenameOpencodeZenToOpencode1805000000000 } from './1805000000000-RenameOpencodeZenToOpencode';

describe('RenameOpencodeZenToOpencode1805000000000', () => {
  const migration = new RenameOpencodeZenToOpencode1805000000000();
  let queries: { sql: string; params: unknown[] }[];
  let aliasRows: { id: string; tenant_id: string; alias: string }[];
  let warn: jest.SpyInstance;

  const queryRunner = {
    query: jest.fn().mockImplementation((sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return Promise.resolve(sql.startsWith('SELECT') ? aliasRows : []);
    }),
  } as never;

  beforeEach(() => {
    queries = [];
    aliasRows = [];
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('moves a custom provider off the now-reserved opencode alias', async () => {
    aliasRows = [{ id: 'cp-1', tenant_id: 't1', alias: 'opencode' }];
    await migration.up(queryRunner);
    const rename = queries.find((q) => q.sql.includes('"custom_providers" SET "alias"'));
    expect(rename?.params).toEqual(['opencode-custom', 'cp-1']);
  });

  it('renames the provider id in every provider column', async () => {
    await migration.up(queryRunner);
    for (const table of [
      'tenant_providers',
      'agent_messages',
      'playground_columns',
      'agent_model_params',
    ]) {
      expect(queries.map((q) => q.sql)).toContain(
        `UPDATE "${table}" SET "provider" = 'opencode' WHERE lower("provider") IN ('opencode-zen', 'opencodezen')`,
      );
    }
  });

  it('rewrites the model prefix and the serialized routes', async () => {
    await migration.up(queryRunner);
    const sql = queries.map((q) => q.sql);
    expect(sql).toContain(
      `UPDATE "agent_messages" SET "model" = 'opencode/' || substr("model", 14) WHERE "model" LIKE 'opencode-zen/%'`,
    );
    expect(sql).toContain(
      `UPDATE "virtual_models" SET "fallback_routes" = replace("fallback_routes"::text, '"opencode-zen', '"opencode')::jsonb WHERE "fallback_routes"::text LIKE '%"opencode-zen%'`,
    );
    expect(sql.some((s) => s.startsWith('UPDATE "tenant_providers" SET "cached_models"'))).toBe(
      true,
    );
  });
});
