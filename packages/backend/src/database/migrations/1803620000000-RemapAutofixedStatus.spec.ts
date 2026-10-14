import { RemapAutofixedStatus1803620000000 } from './1803620000000-RemapAutofixedStatus';

describe('RemapAutofixedStatus1803620000000', () => {
  const migration = new RemapAutofixedStatus1803620000000();
  const query = jest.fn(async () => []);
  const runner = { query } as never;

  beforeEach(() => query.mockClear());

  it('exposes the expected migration name', () => {
    expect(migration.name).toBe('RemapAutofixedStatus1803620000000');
  });

  it('remaps auto_fixed rows to superseded fallback errors under a lock timeout', async () => {
    await migration.up(runner);
    expect(query).toHaveBeenNthCalledWith(1, `SET LOCAL lock_timeout = '10s'`);
    expect(query).toHaveBeenNthCalledWith(
      2,
      `UPDATE "agent_messages" SET "status" = 'fallback_error', "superseded" = true WHERE "status" = 'auto_fixed'`,
    );
  });

  it('has a no-op down', async () => {
    await migration.down();
    expect(query).not.toHaveBeenCalled();
  });
});
