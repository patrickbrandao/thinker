import { DataSource } from 'typeorm';
import { entities, migrations } from '../src/database/data-source-definitions';
import { DropAutofixSchema1803400000000 } from '../src/database/migrations/1803400000000-DropAutofixSchema';
import { DropInstallMetadata1803500000000 } from '../src/database/migrations/1803500000000-DropInstallMetadata';

/** Every Autofix column the migration drops, as `table.column`. */
const AUTOFIX_COLUMNS = [
  'agents.autofix_enabled',
  'agent_messages.autofix_applied',
  'agent_messages.autofix_group_id',
  'agent_messages.autofix_role',
  'agent_messages.autofix_operations',
  'agent_messages.autofix_phoenix',
  'requests.autofix_status',
  'install_metadata.autofix_consented_at',
].sort();

const AUTOFIX_INDEXES = [
  'IDX_agent_messages_autofix_group',
  'IDX_agent_messages_autofix_request',
  'IDX_requests_autofix_healed',
];

interface AutofixArtifacts {
  columns: string[];
  indexes: string[];
  checks: string[];
}

async function autofixArtifacts(ds: DataSource): Promise<AutofixArtifacts> {
  const columns: Array<{ name: string }> = await ds.query(
    `SELECT table_name || '.' || column_name AS name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name LIKE 'autofix%'
     ORDER BY 1`,
  );
  const indexes: Array<{ name: string }> = await ds.query(
    `SELECT indexname AS name FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = ANY($1)
     ORDER BY 1`,
    [AUTOFIX_INDEXES],
  );
  const checks: Array<{ name: string }> = await ds.query(
    `SELECT conname AS name FROM pg_constraint WHERE conname = 'CHK_requests_autofix_status'`,
  );
  return {
    columns: columns.map((row) => row.name),
    indexes: indexes.map((row) => row.name),
    checks: checks.map((row) => row.name),
  };
}

const NONE: AutofixArtifacts = { columns: [], indexes: [], checks: [] };

async function runDropMigration(ds: DataSource, direction: 'up' | 'down'): Promise<void> {
  const queryRunner = ds.createQueryRunner();
  try {
    // Mirror the deploy runner (transaction mode 'each'): SET LOCAL only
    // applies inside a transaction.
    await queryRunner.startTransaction();
    await new DropAutofixSchema1803400000000()[direction](queryRunner);
    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

describe('DropAutofixSchema migration (e2e)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url:
        process.env['DATABASE_URL'] ?? 'postgresql://myuser:mypassword@localhost:5432/mydatabase',
      // The exact registries the deploy runner uses, not a glob.
      entities,
      migrations,
      synchronize: false,
      dropSchema: true,
      logging: false,
    });
    await ds.initialize();
    await ds.runMigrations({ transaction: 'each' });
    // #17 drops `install_metadata` after this migration. Revert in the order the
    // runner would, so the table this migration's revert touches exists again.
    const queryRunner = ds.createQueryRunner();
    try {
      await new DropInstallMetadata1803500000000().down(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('leaves no Autofix schema on a database migrated from empty', async () => {
    expect(await autofixArtifacts(ds)).toEqual(NONE);
    const applied: Array<{ name: string }> = await ds.query(
      `SELECT "name" FROM "migrations" WHERE "name" = 'DropAutofixSchema1803400000000'`,
    );
    expect(applied).toHaveLength(1);
  });

  it('restores the self-hosted schema on revert and drops it again', async () => {
    await runDropMigration(ds, 'down');
    expect(await autofixArtifacts(ds)).toEqual({
      columns: AUTOFIX_COLUMNS,
      indexes: ['IDX_agent_messages_autofix_group', 'IDX_agent_messages_autofix_request'],
      checks: ['CHK_requests_autofix_status'],
    });

    // The restored constraint still guards the column the way 1801000000000 did.
    await expect(
      ds.query(
        `INSERT INTO "requests" ("id", "timestamp", "status", "autofix_status")
         VALUES ('bad-autofix-status', now(), 'success', 'bogus')`,
      ),
    ).rejects.toThrow(/CHK_requests_autofix_status/);

    // A revert on an already-reverted schema is a no-op.
    await runDropMigration(ds, 'down');

    await runDropMigration(ds, 'up');
    expect(await autofixArtifacts(ds)).toEqual(NONE);

    // Idempotent: a second run on the cleaned schema is a no-op.
    await runDropMigration(ds, 'up');
    expect(await autofixArtifacts(ds)).toEqual(NONE);
  });

  it('drops a leftover cloud-mode healed-requests index along with its column', async () => {
    await runDropMigration(ds, 'down');
    await ds.query(
      `CREATE INDEX "IDX_requests_autofix_healed" ON "requests" ("tenant_id", "timestamp")
       INCLUDE ("status") WHERE "autofix_status" = 'retry_succeeded'`,
    );
    expect((await autofixArtifacts(ds)).indexes).toContain('IDX_requests_autofix_healed');

    await runDropMigration(ds, 'up');

    expect(await autofixArtifacts(ds)).toEqual(NONE);
  });

  it('keeps existing rows when the columns go', async () => {
    await runDropMigration(ds, 'down');
    await ds.query(
      `INSERT INTO "requests" ("id", "timestamp", "status", "autofix_status")
       VALUES ('kept-request', now(), 'success', 'retry_succeeded')`,
    );

    await runDropMigration(ds, 'up');

    const rows: Array<{ id: string; status: string }> = await ds.query(
      `SELECT "id", "status" FROM "requests" WHERE "id" = 'kept-request'`,
    );
    expect(rows).toEqual([{ id: 'kept-request', status: 'success' }]);
  });
});
