import { DataSource } from 'typeorm';
import { entities, migrations } from '../src/database/data-source-definitions';
import { DropAutofixSchema1803400000000 } from '../src/database/migrations/1803400000000-DropAutofixSchema';
import { DropInstallMetadata1803500000000 } from '../src/database/migrations/1803500000000-DropInstallMetadata';

async function installMetadataColumns(ds: DataSource): Promise<string[]> {
  const rows: Array<{ name: string }> = await ds.query(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'install_metadata'
     ORDER BY 1`,
  );
  return rows.map((row) => row.name);
}

async function run(
  ds: DataSource,
  migration: DropInstallMetadata1803500000000 | DropAutofixSchema1803400000000,
  direction: 'up' | 'down',
): Promise<void> {
  const queryRunner = ds.createQueryRunner();
  try {
    // Mirror the deploy runner (transaction mode 'each'): SET LOCAL only
    // applies inside a transaction.
    await queryRunner.startTransaction();
    await migration[direction](queryRunner);
    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

const TELEMETRY_COLUMNS = ['created_at', 'first_send_at', 'id', 'install_id', 'last_sent_at'];

describe('DropInstallMetadata migration (e2e)', () => {
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
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('leaves no install_metadata table on a database migrated from empty', async () => {
    expect(await installMetadataColumns(ds)).toEqual([]);
    const applied: Array<{ name: string }> = await ds.query(
      `SELECT "name" FROM "migrations" WHERE "name" = 'DropInstallMetadata1803500000000'`,
    );
    expect(applied).toHaveLength(1);
  });

  it('drops a populated table from an existing install, and is idempotent', async () => {
    await run(ds, new DropInstallMetadata1803500000000(), 'down');
    expect(await installMetadataColumns(ds)).toEqual(TELEMETRY_COLUMNS);
    await ds.query(
      `INSERT INTO "install_metadata" ("id", "install_id") VALUES ('singleton', 'some-uuid')`,
    );

    await run(ds, new DropInstallMetadata1803500000000(), 'up');
    expect(await installMetadataColumns(ds)).toEqual([]);

    await run(ds, new DropInstallMetadata1803500000000(), 'up');
    expect(await installMetadataColumns(ds)).toEqual([]);
  });

  it('reverts in runner order through the #16 drop and re-applies cleanly', async () => {
    await run(ds, new DropInstallMetadata1803500000000(), 'down');
    // A revert on an already-reverted schema is a no-op.
    await run(ds, new DropInstallMetadata1803500000000(), 'down');
    await run(ds, new DropAutofixSchema1803400000000(), 'down');
    expect(await installMetadataColumns(ds)).toEqual(
      [...TELEMETRY_COLUMNS, 'autofix_consented_at'].sort(),
    );

    await run(ds, new DropAutofixSchema1803400000000(), 'up');
    await run(ds, new DropInstallMetadata1803500000000(), 'up');
    expect(await installMetadataColumns(ds)).toEqual([]);
  });
});
