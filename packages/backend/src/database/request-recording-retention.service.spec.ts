import { Logger } from '@nestjs/common';
import { RequestRecordingRetentionService } from './request-recording-retention.service';

describe('RequestRecordingRetentionService', () => {
  const query = jest.fn();
  const connect = jest.fn();
  const release = jest.fn();
  const queryRunner = { query, connect, release };
  const createQueryRunner = jest.fn(() => queryRunner);
  const get = jest.fn();
  const storage = { delete: jest.fn() };
  let service: RequestRecordingRetentionService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    get.mockReturnValue(null);
    connect.mockResolvedValue(undefined);
    release.mockResolvedValue(undefined);
    storage.delete.mockResolvedValue(undefined);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ acquired: true }];
      if (sql.includes('pg_advisory_unlock')) return [{ unlocked: true }];
      if (sql.includes('UPDATE agent_messages')) {
        return [[{ id: 'attempt-1' }], 1];
      }
      return [];
    });
    service = new RequestRecordingRetentionService(
      { createQueryRunner } as never,
      { get } as never,
      storage as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('deletes recordings older than the 365-day default, storage object first', async () => {
    const expired = {
      attempt_id: 'attempt-1',
      storage_key: 'request-recordings/v1/attempt-1.json.gz',
    };
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ acquired: true }];
      if (sql.includes('FROM agent_messages')) return [expired];
      if (sql.includes('UPDATE agent_messages')) {
        return [[{ id: 'attempt-1' }], 1];
      }
      return [];
    });

    await expect(service.deleteExpiredRecordings()).resolves.toBe(1);

    const select = query.mock.calls.find(([sql]) => String(sql).includes('FROM agent_messages'));
    expect(select).toBeDefined();
    expect(select![0]).not.toMatch(/subscription|tenants|plan/i);
    expect(select![1]).toEqual([365]);
    expect(storage.delete).toHaveBeenCalledWith(expired.storage_key);
    const deleteCall = query.mock.calls.findIndex(([sql]) =>
      String(sql).includes('UPDATE agent_messages'),
    );
    expect(storage.delete.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[deleteCall]!,
    );
  });

  it('uses the global retention override when configured', async () => {
    get.mockReturnValue(30);
    service = new RequestRecordingRetentionService(
      { createQueryRunner } as never,
      { get } as never,
      storage as never,
    );

    await expect(service.deleteExpiredRecordings()).resolves.toBe(0);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM agent_messages'), [30]);
  });

  it('does no work when another replica owns the advisory lock', async () => {
    query.mockResolvedValueOnce([{ acquired: false }]);

    await expect(service.deleteExpiredRecordings()).resolves.toBe(0);

    expect(storage.delete).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it('keeps metadata when object deletion fails so cleanup can retry', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ acquired: true }];
      if (sql.includes('FROM agent_messages')) {
        return [
          {
            attempt_id: 'attempt-1',
            storage_key: 'request-recordings/v1/attempt-1.json.gz',
          },
        ];
      }
      return [];
    });
    storage.delete.mockRejectedValue(new Error('bucket offline'));

    await expect(service.deleteExpiredRecordings()).resolves.toBe(0);

    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE agent_messages'))).toBe(
      false,
    );
  });

  it('logs and swallows cleanup failures', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    query.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.deleteExpiredRecordings()).resolves.toBe(0);

    expect(error).toHaveBeenCalledWith('Request recording retention failed: database unavailable');
    expect(release).toHaveBeenCalled();
  });

  it('logs non-Error cleanup failures', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    query.mockRejectedValueOnce('offline');

    await expect(service.deleteExpiredRecordings()).resolves.toBe(0);

    expect(error).toHaveBeenCalledWith('Request recording retention failed: offline');
  });
});
