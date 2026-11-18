import { RequestRecordingMigrationService } from './request-recording-migration.service';

function setup(rows: Array<Record<string, string>>, acquired = true) {
  const pages = [rows];
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('pg_try_advisory_lock')) return [{ acquired }];
    if (sql.includes('pg_advisory_unlock')) return [];
    return pages.shift() ?? [];
  });
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query,
  };
  const dataSource = { createQueryRunner: () => queryRunner };
  const storage = {
    backend: 'postgres' as string | null,
    legacyBackend: 'filesystem' as string | null,
    moveFromLegacy: jest.fn().mockResolvedValue(true),
  };
  const service = new RequestRecordingMigrationService(dataSource as never, storage as never);
  return { service, storage, query, queryRunner };
}

const row = (id: string) => ({
  attempt_id: id,
  tenant_id: 't1',
  request_id: `r-${id}`,
  storage_key: `key-${id}`,
});

describe('RequestRecordingMigrationService', () => {
  it('moves every pending recording from the legacy store, keeping going after a failure', async () => {
    const { service, storage, query, queryRunner } = setup([row('a'), row('b')]);
    storage.moveFromLegacy.mockRejectedValueOnce(new Error('missing file'));

    await expect(service.moveAll()).resolves.toEqual({ moved: 1, failed: 1 });

    expect(storage.moveFromLegacy).toHaveBeenCalledWith('key-a', {
      tenantId: 't1',
      requestId: 'r-a',
      attemptId: 'a',
    });
    expect(storage.moveFromLegacy).toHaveBeenCalledWith('key-b', expect.anything());
    expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_unlock'));
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('does nothing when another replica holds the lock', async () => {
    const { service, storage } = setup([row('a')], false);
    await expect(service.moveAll()).resolves.toEqual({ moved: 0, failed: 0 });
    expect(storage.moveFromLegacy).not.toHaveBeenCalled();
  });

  it('does nothing without a legacy store or off PostgreSQL', async () => {
    const noLegacy = setup([row('a')]);
    noLegacy.storage.legacyBackend = null;
    await expect(noLegacy.service.moveAll()).resolves.toEqual({ moved: 0, failed: 0 });

    const filesystem = setup([row('a')]);
    filesystem.storage.backend = 'filesystem';
    await expect(filesystem.service.moveAll()).resolves.toEqual({ moved: 0, failed: 0 });
    expect(filesystem.storage.moveFromLegacy).not.toHaveBeenCalled();
  });
});
