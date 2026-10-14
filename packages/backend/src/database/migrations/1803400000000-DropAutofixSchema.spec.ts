import { DropAutofixSchema1803400000000 } from './1803400000000-DropAutofixSchema';

async function run(direction: 'up' | 'down'): Promise<string[]> {
  const query = jest.fn(async () => []);
  await new DropAutofixSchema1803400000000()[direction]({ query } as never);
  return query.mock.calls.map((call) => String((call as unknown[])[0]));
}

describe('DropAutofixSchema1803400000000', () => {
  it('keeps a name ordered after the #15 schema drop', () => {
    expect(new DropAutofixSchema1803400000000().name).toBe('DropAutofixSchema1803400000000');
  });

  it('sets a transaction-local lock timeout before taking any lock', async () => {
    const sql = await run('up');

    expect(sql[0]).toBe(`SET LOCAL lock_timeout = '10s'`);
  });

  it('sets a session lock timeout on revert and resets it, even on failure (#68)', async () => {
    const sql = await run('down');
    expect(sql[0]).toBe(`SET lock_timeout = '10s'`);
    expect(sql.at(-1)).toBe('RESET lock_timeout');

    const query = jest.fn(async (statement: string) => {
      if (statement.includes('ADD COLUMN IF NOT EXISTS "autofix_enabled"')) {
        throw new Error('lock timeout');
      }
      return [];
    });
    await expect(new DropAutofixSchema1803400000000().down({ query } as never)).rejects.toThrow(
      'lock timeout',
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('RESET lock_timeout');
  });

  it('drops every repair column, index and constraint idempotently', async () => {
    const sql = (await run('up')).join('\n');

    for (const fragment of [
      'DROP INDEX IF EXISTS "IDX_agent_messages_autofix_request"',
      'DROP INDEX IF EXISTS "IDX_agent_messages_autofix_group"',
      'DROP INDEX IF EXISTS "IDX_requests_autofix_healed"',
      'DROP COLUMN IF EXISTS "autofix_applied"',
      'DROP COLUMN IF EXISTS "autofix_group_id"',
      'DROP COLUMN IF EXISTS "autofix_role"',
      'DROP COLUMN IF EXISTS "autofix_operations"',
      'DROP COLUMN IF EXISTS "autofix_phoenix"',
      'DROP CONSTRAINT IF EXISTS "CHK_requests_autofix_status"',
      'ALTER TABLE "requests" DROP COLUMN IF EXISTS "autofix_status"',
      'ALTER TABLE "agents" DROP COLUMN IF EXISTS "autofix_enabled"',
      'ALTER TABLE "install_metadata" DROP COLUMN IF EXISTS "autofix_consented_at"',
    ]) {
      expect(sql).toContain(fragment);
    }
    expect(sql).not.toMatch(/DROP (INDEX|COLUMN|CONSTRAINT) (?!IF EXISTS)/);
    expect(sql).not.toMatch(/CONCURRENTLY/);
  });

  it('restores the self-hosted columns, constraint and indexes on revert', async () => {
    const sql = (await run('down')).join('\n');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "autofix_enabled" boolean');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "autofix_applied" boolean NOT NULL DEFAULT false',
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "autofix_phoenix" jsonb');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "autofix_status" varchar');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "autofix_consented_at" timestamp');
    expect(sql).toContain('ADD CONSTRAINT "CHK_requests_autofix_status"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_agent_messages_autofix_group"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_agent_messages_autofix_request"');
    // The cloud-only CRM index was never part of the self-hosted path.
    expect(sql).not.toContain('IDX_requests_autofix_healed');
    expect(sql).not.toContain('SET LOCAL');
  });
});
