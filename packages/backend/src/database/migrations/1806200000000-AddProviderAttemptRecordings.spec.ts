import { AddProviderAttemptRecordings1806200000000 } from './1806200000000-AddProviderAttemptRecordings';

describe('AddProviderAttemptRecordings1806200000000', () => {
  it('creates and drops the jsonb recordings table keyed by storage key', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddProviderAttemptRecordings1806200000000();
    await migration.up({ query } as never);
    const create = query.mock.calls[0][0] as string;
    expect(create).toContain('CREATE TABLE IF NOT EXISTS "provider_attempt_recordings"');
    expect(create).toContain('"payload" jsonb NOT NULL');
    expect(create).toContain('PRIMARY KEY ("storage_key")');
    expect(query.mock.calls[1][0]).toContain('"IDX_provider_attempt_recordings_attempt"');
    await migration.down({ query } as never);
    expect(query.mock.calls[2][0]).toBe('DROP TABLE IF EXISTS "provider_attempt_recordings"');
  });
});
