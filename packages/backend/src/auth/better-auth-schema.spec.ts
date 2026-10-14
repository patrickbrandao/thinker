import { readFileSync } from 'fs';
import { join } from 'path';
import { migrateAndVerifyBetterAuthSchema } from './better-auth-schema';

describe('migrateAndVerifyBetterAuthSchema', () => {
  const emptyPlan = { toBeCreated: [], toBeAdded: [], schemaProblems: [] };

  function setup(plan: unknown) {
    const order: string[] = [];
    const ctx = {
      options: {} as never,
      runMigrations: jest.fn(async () => {
        order.push('migrate');
      }),
    };
    const planFn = jest.fn(async () => {
      order.push('verify');
      return plan as never;
    });
    const logger = { error: jest.fn() };
    return { ctx, planFn, logger, order };
  }

  it('verifies only after the migration ran, and stays silent when the schema matches', async () => {
    const { ctx, planFn, logger, order } = setup(emptyPlan);
    await expect(migrateAndVerifyBetterAuthSchema(ctx, logger, planFn)).resolves.toEqual([]);
    expect(order).toEqual(['migrate', 'verify']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('still reports a real mismatch left after the migration', async () => {
    const { ctx, planFn, logger } = setup({
      toBeCreated: [{ table: 'jwks', fields: {}, order: 0 }],
      toBeAdded: [{ table: 'user', fields: { role: {} }, order: 0 }],
      schemaProblems: ['column session.foo is required but unknown'],
    });
    const problems = await migrateAndVerifyBetterAuthSchema(ctx, logger, planFn);
    expect(problems).toEqual([
      'missing table jwks',
      'missing column user.role',
      'column session.foo is required but unknown',
    ]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0][0])).toContain('schema mismatch after migration');
  });

  it('propagates a migration failure without verifying', async () => {
    const { ctx, planFn, logger } = setup(emptyPlan);
    ctx.runMigrations.mockRejectedValueOnce(new Error('boom'));
    await expect(migrateAndVerifyBetterAuthSchema(ctx, logger, planFn)).rejects.toThrow('boom');
    expect(planFn).not.toHaveBeenCalled();
  });
});

describe('auth instance schema validation', () => {
  it('disables the init-time runtime check that races the boot migration', () => {
    // Read the source rather than importing the instance (it needs env and a pool).
    const source = readFileSync(join(__dirname, 'auth.instance.ts'), 'utf8');
    expect(source).toMatch(/advanced:\s*\{\s*database:\s*\{\s*validateSchema:\s*false\s*\}\s*\}/);
  });
});
