// The module reads `.env` on import; the real file must never feed this spec.
jest.mock('./load-env-file', () => ({}));

import type { DataSource } from 'typeorm';
import { INVALID_WHERE_VALUES_BEHAVIOR, entities, migrations } from './data-source-definitions';

const URL_VARS = ['MIGRATION_DATABASE_URL', 'DATABASE_UNPOOLED_URL', 'DATABASE_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of URL_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of URL_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function load(env: Partial<Record<(typeof URL_VARS)[number], string>>): DataSource {
  Object.assign(process.env, env);
  let ds!: DataSource;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ds = require('./datasource').default;
  });
  return ds;
}

const urlOf = (ds: DataSource) => (ds.options as { url?: string }).url;

describe('migration data source', () => {
  it('refuses to start without any database URL, never defaulting to localhost', () => {
    expect(() => load({})).toThrow(/DATABASE_URL \(or MIGRATION_DATABASE_URL\) is required/);
  });

  it('treats blank URLs as unset', () => {
    expect(() =>
      load({ MIGRATION_DATABASE_URL: '   ', DATABASE_UNPOOLED_URL: '', DATABASE_URL: '  ' }),
    ).toThrow(/is required/);
  });

  it('falls back to DATABASE_URL for self-hosted installs', () => {
    expect(urlOf(load({ DATABASE_URL: 'postgresql://pooled/db' }))).toBe('postgresql://pooled/db');
  });

  it('prefers the unpooled URL over DATABASE_URL', () => {
    const ds = load({
      DATABASE_URL: 'postgresql://pooled/db',
      DATABASE_UNPOOLED_URL: 'postgresql://direct/db',
    });
    expect(urlOf(ds)).toBe('postgresql://direct/db');
  });

  it('prefers MIGRATION_DATABASE_URL over everything', () => {
    const ds = load({
      DATABASE_URL: 'postgresql://pooled/db',
      DATABASE_UNPOOLED_URL: 'postgresql://direct/db',
      MIGRATION_DATABASE_URL: 'postgresql://migrations/db',
    });
    expect(urlOf(ds)).toBe('postgresql://migrations/db');
  });

  it('skips a blank override instead of letting it win', () => {
    const ds = load({
      MIGRATION_DATABASE_URL: ' ',
      DATABASE_UNPOOLED_URL: ' postgresql://direct/db ',
      DATABASE_URL: 'postgresql://pooled/db',
    });
    expect(urlOf(ds)).toBe('postgresql://direct/db');
  });

  it('is a postgres data source with the committed entities and migrations, and no synchronize', () => {
    const ds = load({ DATABASE_URL: 'postgresql://pooled/db' });
    expect(ds.options.type).toBe('postgres');
    // Fresh module instance per load, so compare by name, not by identity.
    const names = (list: unknown) => (list as Array<{ name: string }>).map((item) => item.name);
    expect(names(ds.options.entities)).toEqual(names(entities));
    expect(names(ds.options.migrations)).toEqual(names(migrations));
    expect(ds.options.migrations).toHaveLength(migrations.length);
    expect((ds.options as { synchronize?: boolean }).synchronize).toBeFalsy();
    expect(ds.options.invalidWhereValuesBehavior).toEqual(INVALID_WHERE_VALUES_BEHAVIOR);
  });

  it('does not connect on import', () => {
    expect(load({ DATABASE_URL: 'postgresql://127.0.0.1:1/never' }).isInitialized).toBe(false);
  });

  it('pins every pooled session to UTC on connect', async () => {
    const ds = load({ DATABASE_URL: 'postgresql://pooled/db' });
    const onConnect = (ds.options as { extra?: { onConnect?: (c: unknown) => Promise<void> } })
      .extra?.onConnect;
    const query = jest.fn().mockResolvedValue(undefined);
    await onConnect!({ query });
    expect(query).toHaveBeenCalledWith("SET TIME ZONE 'UTC'");
  });
});
