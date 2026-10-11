import { AddRequestsAutofixHealedIndex1802200000000 } from './1802200000000-AddRequestsAutofixHealedIndex';

describe('AddRequestsAutofixHealedIndex1802200000000', () => {
  const migration = new AddRequestsAutofixHealedIndex1802200000000();
  let queries: string[];

  const mockQueryRunner = {
    query: jest.fn().mockImplementation((sql: string) => {
      queries.push(sql);
      return Promise.resolve([]);
    }),
  } as never;

  beforeEach(() => {
    queries = [];
    jest.clearAllMocks();
  });

  it('keeps the recorded migration name', () => {
    expect(migration.name).toBe('AddRequestsAutofixHealedIndex1802200000000');
  });

  it('runs outside a transaction so CONCURRENTLY is legal on revert', () => {
    expect(migration.transaction).toBe(false);
  });

  it('touches nothing on the way up, like the self-hosted path always did', async () => {
    await migration.up();

    expect(queries).toEqual([]);
  });

  it('still drops the index on rollback, a no-op where it never existed', async () => {
    await migration.down(mockQueryRunner);

    expect(queries).toEqual(['DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_autofix_healed"']);
  });
});
