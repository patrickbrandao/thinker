import { Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { BackfillState } from '../../entities/backfill-state.entity';
import {
  BootBackfillConnection,
  resolveDirectBackfillDatabaseUrl,
} from './boot-backfill-connection';
import { MessageProviderBackfillBootService } from './message-provider-backfill.boot.service';
import { RequestBackfillBootService } from './request-backfill.boot.service';

const DIRECT = 'postgres://u:secret-password@db-direct:5432/app';

function fakeDataSource() {
  const lock = {
    connect: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
    query: jest.fn(async (sql: string) =>
      sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : undefined,
    ),
  };
  const ds = {
    isInitialized: false,
    initialize: jest.fn(async function (this: { isInitialized: boolean }) {
      this.isInitialized = true;
    }),
    destroy: jest.fn(async function (this: { isInitialized: boolean }) {
      this.isInitialized = false;
    }),
    createQueryRunner: jest.fn(() => lock),
    query: jest.fn(async () => [{ pending: false, present: false }]),
  };
  return { ds: ds as unknown as DataSource & typeof ds, lock };
}

function stateRepo(completed = false) {
  const execute = jest.fn(async () => undefined);
  const builder = {
    insert: () => ({ into: () => ({ values: () => ({ orIgnore: () => ({ execute }) }) }) }),
  };
  return {
    countBy: jest.fn(async () => (completed ? 1 : 0)),
    createQueryBuilder: jest.fn(() => builder),
  } as unknown as Repository<BackfillState>;
}

describe('resolveDirectBackfillDatabaseUrl (#74)', () => {
  it('prefers MIGRATION_DATABASE_URL, then DATABASE_UNPOOLED_URL, then BACKFILL_DATABASE_URL', () => {
    expect(
      resolveDirectBackfillDatabaseUrl({
        MIGRATION_DATABASE_URL: 'm',
        DATABASE_UNPOOLED_URL: 'u',
        BACKFILL_DATABASE_URL: 'b',
      }),
    ).toBe('m');
    expect(
      resolveDirectBackfillDatabaseUrl({ DATABASE_UNPOOLED_URL: 'u', BACKFILL_DATABASE_URL: 'b' }),
    ).toBe('u');
    expect(resolveDirectBackfillDatabaseUrl({ BACKFILL_DATABASE_URL: ' b ' })).toBe('b');
  });

  it('ignores blank values and DATABASE_URL', () => {
    expect(
      resolveDirectBackfillDatabaseUrl({ MIGRATION_DATABASE_URL: '  ', DATABASE_URL: 'pooled' }),
    ).toBeNull();
  });
});

describe('BootBackfillConnection (#74)', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('uses the app DataSource when no direct URL is set', async () => {
    const app = fakeDataSource().ds;
    const factory = jest.fn();
    const connection = new BootBackfillConnection(app, { DATABASE_URL: 'pooled' }, factory);
    expect(connection.usesDirectUrl).toBe(false);
    await expect(connection.get()).resolves.toBe(app);
    expect(factory).not.toHaveBeenCalled();
    await connection.close();
    expect(app.destroy).not.toHaveBeenCalled();
  });

  it('opens one direct DataSource lazily, reuses it, and closes it', async () => {
    const app = fakeDataSource().ds;
    const direct = fakeDataSource().ds;
    const factory = jest.fn(() => direct);
    const connection = new BootBackfillConnection(app, { MIGRATION_DATABASE_URL: DIRECT }, factory);

    const [a, b] = await Promise.all([connection.get(), connection.get()]);
    expect(a).toBe(direct);
    expect(b).toBe(direct);
    await connection.get();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(DIRECT);
    expect(direct.initialize).toHaveBeenCalledTimes(1);

    await connection.close();
    expect(direct.destroy).toHaveBeenCalledTimes(1);
    expect(app.destroy).not.toHaveBeenCalled();
  });

  it('destroys a pool still opening when close() runs (#158)', async () => {
    const direct = fakeDataSource().ds;
    let finishInit!: () => void;
    direct.initialize.mockImplementation(function (this: { isInitialized: boolean }) {
      return new Promise<void>((resolve) => {
        finishInit = () => {
          this.isInitialized = true;
          resolve();
        };
      });
    });
    const connection = new BootBackfillConnection(
      fakeDataSource().ds,
      { MIGRATION_DATABASE_URL: DIRECT },
      () => direct,
    );
    const pending = connection.get();
    const closing = connection.close();
    finishInit();
    await pending;
    await closing;
    expect(direct.destroy).toHaveBeenCalledTimes(1);
    expect(direct.isInitialized).toBe(false);
  });

  it('refuses to reopen the direct pool after close() (#158)', async () => {
    const direct = fakeDataSource().ds;
    const factory = jest.fn(() => direct);
    const connection = new BootBackfillConnection(
      fakeDataSource().ds,
      { MIGRATION_DATABASE_URL: DIRECT },
      factory,
    );
    await connection.get();
    await connection.close();

    await expect(connection.get()).rejects.toThrow('closed');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(direct.initialize).toHaveBeenCalledTimes(1);
  });

  it('refuses a first get() that arrives after close() (#158)', async () => {
    const factory = jest.fn(() => fakeDataSource().ds);
    const connection = new BootBackfillConnection(
      fakeDataSource().ds,
      { MIGRATION_DATABASE_URL: DIRECT },
      factory,
    );
    await connection.close();
    await expect(connection.get()).rejects.toThrow('closed');
    expect(factory).not.toHaveBeenCalled();
  });

  it('never logs the URL', async () => {
    const direct = fakeDataSource().ds;
    const connection = new BootBackfillConnection(
      fakeDataSource().ds,
      { BACKFILL_DATABASE_URL: DIRECT },
      () => direct,
    );
    await connection.get();
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('secret-password');
  });
});

describe('boot backfills on a direct URL (#74)', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('takes the message-provider backfill lock and runs it on the direct DataSource', async () => {
    const app = fakeDataSource();
    const direct = fakeDataSource();
    const service = new MessageProviderBackfillBootService(app.ds, stateRepo());
    service.connection = new BootBackfillConnection(
      app.ds,
      { MIGRATION_DATABASE_URL: DIRECT },
      () => direct.ds,
    );
    const runner = jest.fn(async () => ({ stamped: 0, windows: 0 }));

    await expect(service.runOnce(runner as never)).resolves.toBe(true);
    expect(app.ds.createQueryRunner).not.toHaveBeenCalled();
    expect(direct.lock.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1) AS locked',
      expect.any(Array),
    );
    expect(runner).toHaveBeenCalledWith(direct.ds, expect.anything());

    await service.onApplicationShutdown();
    expect(direct.ds.destroy).toHaveBeenCalled();
  });

  it('takes the request backfill lock and runs it on the direct DataSource', async () => {
    const app = fakeDataSource();
    const direct = fakeDataSource();
    const service = new RequestBackfillBootService(app.ds, stateRepo());
    service.connection = new BootBackfillConnection(
      app.ds,
      { DATABASE_UNPOOLED_URL: DIRECT },
      () => direct.ds,
    );
    const runner = jest.fn(async () => ({ attempts: 0, rejections: 0, windows: 0 }));

    await expect(service.runOnce(runner as never)).resolves.toBe(true);
    expect(app.ds.createQueryRunner).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledWith(direct.ds, expect.anything(), expect.anything());

    await service.onApplicationShutdown();
    expect(direct.ds.destroy).toHaveBeenCalled();
  });
});
