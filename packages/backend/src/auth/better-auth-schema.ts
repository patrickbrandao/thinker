import type { Logger } from '@nestjs/common';
import type { getMigrations } from 'better-auth/db/migration';

type MigrationPlan = Pick<
  Awaited<ReturnType<typeof getMigrations>>,
  'toBeCreated' | 'toBeAdded' | 'schemaProblems'
>;

export interface BetterAuthMigrationContext {
  options: Parameters<typeof getMigrations>[0];
  runMigrations(): Promise<void>;
}

/**
 * Better Auth tables are created at boot by Better Auth's own migrator, not by
 * TypeORM. Its runtime schema check (`advanced.database.validateSchema`) fires
 * as soon as the auth instance initializes, which on a fresh database is
 * before that migrator ran, so every first boot logged a spurious ERROR
 * "Database schema mismatch / Missing tables". The runtime check is therefore
 * off (see auth.instance.ts) and this runs the equivalent check once, right
 * after the migration, where a finding is a real problem.
 *
 * Returns the problems found (empty when the schema matches).
 */
export async function migrateAndVerifyBetterAuthSchema(
  ctx: BetterAuthMigrationContext,
  logger: Pick<Logger, 'error'>,
  plan: (options: BetterAuthMigrationContext['options']) => Promise<MigrationPlan> = async (
    options,
  ) => (await import('better-auth/db/migration')).getMigrations(options),
): Promise<string[]> {
  await ctx.runMigrations();
  let result: MigrationPlan;
  try {
    result = await plan(ctx.options);
  } catch (err) {
    // The migration itself succeeded; a failing verification must not stop boot.
    logger.error(
      `Could not verify the Better Auth database schema after migration: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
  const { toBeCreated, toBeAdded, schemaProblems } = result;
  const problems = [
    ...toBeCreated.map((t) => `missing table ${t.table}`),
    ...toBeAdded.flatMap((t) =>
      Object.keys(t.fields).map((field) => `missing column ${t.table}.${field}`),
    ),
    ...schemaProblems,
  ];
  if (problems.length > 0) {
    logger.error(`Better Auth database schema mismatch after migration: ${problems.join('; ')}`);
  }
  return problems;
}
