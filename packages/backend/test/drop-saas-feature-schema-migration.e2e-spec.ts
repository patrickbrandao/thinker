import { DataSource } from 'typeorm';
import { entities, migrations } from '../src/database/data-source-definitions';
import { DropSaasFeatureSchema1803300000000 } from '../src/database/migrations/1803300000000-DropSaasFeatureSchema';
import { toLocalSqlTimestamp } from '../src/common/utils/postgres-sql';
import { resolveE2eDatabaseUrl } from './e2e-db-guard';

const TENANT = 'saas-drop-tenant';
const OTHER_TENANT = 'saas-drop-other-tenant';
const AGENT = 'saas-drop-agent';
const TIMESTAMP = toLocalSqlTimestamp(new Date(Date.now() - 60 * 1000));

interface SaasArtifacts {
  waitlistTable: string | null;
  errorPagesTable: string | null;
  crmIndex: string | null;
}

async function saasArtifacts(ds: DataSource): Promise<SaasArtifacts> {
  const rows: SaasArtifacts[] = await ds.query(`
    SELECT
      to_regclass('waitlist_claims')::text AS "waitlistTable",
      to_regclass('public_error_pages')::text AS "errorPagesTable",
      to_regclass('"IDX_requests_autofix_healed"')::text AS "crmIndex"
  `);
  return rows[0]!;
}

const NONE: SaasArtifacts = { waitlistTable: null, errorPagesTable: null, crmIndex: null };

async function runDropMigration(ds: DataSource, direction: 'up' | 'down'): Promise<void> {
  const queryRunner = ds.createQueryRunner();
  try {
    // Mirror the deploy runner (transaction mode 'each'): SET LOCAL only
    // applies inside a transaction.
    await queryRunner.startTransaction();
    await new DropSaasFeatureSchema1803300000000()[direction](queryRunner);
    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

async function insertConnection(
  ds: DataSource,
  id: string,
  tenantId: string,
  provider: string,
): Promise<void> {
  await ds.query(
    `INSERT INTO "tenant_providers"
       ("id", "tenant_id", "provider", "auth_type", "api_key_encrypted", "label", "is_active")
     VALUES ($1, $2, $3, 'api_key', 'encrypted-placeholder', 'Default', true)`,
    [id, tenantId, provider],
  );
}

async function ids(ds: DataSource, sql: string): Promise<string[]> {
  const rows: Array<{ id: string }> = await ds.query(sql);
  return rows.map((row) => row.id).sort();
}

describe('DropSaasFeatureSchema migration (e2e)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      // Goes through the e2e guard: dropSchema below wipes the database.
      url: resolveE2eDatabaseUrl(),
      // The exact registries the deploy runner uses, not a glob.
      entities,
      migrations,
      synchronize: false,
      dropSchema: true,
      logging: false,
    });
    await ds.initialize();
    await ds.runMigrations({ transaction: 'each' });

    for (const tenant of [TENANT, OTHER_TENANT]) {
      await ds.query(`INSERT INTO "tenants" ("id", "name", "is_active") VALUES ($1, $1, true)`, [
        tenant,
      ]);
    }
    await ds.query(
      `INSERT INTO "agents" ("id", "tenant_id", "name", "display_name", "is_playground")
       VALUES ($1, $2, $1, $1, false)`,
      [AGENT, TENANT],
    );
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('leaves no SaaS schema on a database migrated from empty', async () => {
    expect(await saasArtifacts(ds)).toEqual(NONE);
    const applied: Array<{ name: string }> = await ds.query(
      `SELECT "name" FROM "migrations" WHERE "name" = 'DropSaasFeatureSchema1803300000000'`,
    );
    expect(applied).toHaveLength(1);
  });

  it('reverts to the self-hosted tables and applies again', async () => {
    await runDropMigration(ds, 'down');
    expect(await saasArtifacts(ds)).toEqual({
      waitlistTable: 'waitlist_claims',
      errorPagesTable: 'public_error_pages',
      crmIndex: null,
    });
    // The restored tables accept the rows their old writers inserted.
    await ds.query(`INSERT INTO "waitlist_claims" ("email") VALUES ('a@example.com')`);
    await ds.query(
      `INSERT INTO "public_error_pages" ("slug", "cluster_key", "provider", "title", "meta_description", "h1")
       VALUES ('s', 'k', 'openai', 't', 'm', 'h')`,
    );

    await runDropMigration(ds, 'up');
    expect(await saasArtifacts(ds)).toEqual(NONE);

    // Idempotent: a second run on the cleaned schema is a no-op.
    await runDropMigration(ds, 'up');
    expect(await saasArtifacts(ds)).toEqual(NONE);
  });

  it('drops a leftover cloud-mode CRM index', async () => {
    await ds.query(
      // The real index filtered on requests.autofix_status, which #16 dropped;
      // only its name matters to this migration.
      `CREATE INDEX "IDX_requests_autofix_healed" ON "requests" ("tenant_id", "timestamp")
       INCLUDE ("status")`,
    );
    expect((await saasArtifacts(ds)).crmIndex).toBe('"IDX_requests_autofix_healed"');

    await runDropMigration(ds, 'up');

    expect(await saasArtifacts(ds)).toEqual(NONE);
  });

  it('deletes Gemini Free connections and their grants, keeping everything else', async () => {
    await insertConnection(ds, 'tp-gemini-free', TENANT, 'gemini-free');
    await insertConnection(ds, 'tp-gemini-free-other', OTHER_TENANT, 'Gemini-Free');
    await insertConnection(ds, 'tp-gemini', TENANT, 'gemini');
    await insertConnection(ds, 'tp-openai', TENANT, 'openai');
    for (const providerId of ['tp-gemini-free', 'tp-gemini', 'tp-openai']) {
      await ds.query(
        `INSERT INTO "agent_enabled_providers" ("agent_id", "tenant_provider_id") VALUES ($1, $2)`,
        [AGENT, providerId],
      );
    }
    await ds.query(
      `INSERT INTO "requests" ("id", "tenant_id", "agent_id", "timestamp", "status")
       VALUES ('gemini-free-request', $1, $2, $3, 'success')`,
      [TENANT, AGENT, TIMESTAMP],
    );
    await ds.query(
      `INSERT INTO "agent_messages" (
         "id", "request_id", "tenant_id", "agent_id", "agent_name", "timestamp",
         "status", "input_tokens", "output_tokens", "cache_read_tokens",
         "cache_creation_tokens", "provider", "tenant_provider_id"
       )
       VALUES ('gemini-free-attempt', 'gemini-free-request', $1, $2, $2, $3,
               'success', 1, 1, 0, 0, 'gemini-free', 'tp-gemini-free')`,
      [TENANT, AGENT, TIMESTAMP],
    );

    await runDropMigration(ds, 'up');

    expect(await ids(ds, `SELECT "id" FROM "tenant_providers"`)).toEqual([
      'tp-gemini',
      'tp-openai',
    ]);
    expect(
      await ids(ds, `SELECT "tenant_provider_id" AS "id" FROM "agent_enabled_providers"`),
    ).toEqual(['tp-gemini', 'tp-openai']);
    // History survives with its provider label; only the dangling link goes.
    const history: Array<{ provider: string; tenant_provider_id: string | null }> = await ds.query(
      `SELECT "provider", "tenant_provider_id" FROM "agent_messages" WHERE "id" = 'gemini-free-attempt'`,
    );
    expect(history).toEqual([{ provider: 'gemini-free', tenant_provider_id: null }]);
  });
});
