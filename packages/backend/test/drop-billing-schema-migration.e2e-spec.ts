import { DataSource } from 'typeorm';
import { entities, migrations } from '../src/database/data-source-definitions';
import { DropBillingSchema1803200000000 } from '../src/database/migrations/1803200000000-DropBillingSchema';
import { toLocalSqlTimestamp } from '../src/common/utils/postgres-sql';

const TENANT = 'billing-drop-tenant';
const AGENT = 'billing-drop-agent';
const TIMESTAMP = toLocalSqlTimestamp(new Date(Date.now() - 60 * 1000));

interface BillingArtifacts {
  usageTable: string | null;
  emailLogsTable: string | null;
  quotaFlag: boolean;
  limitOverrides: boolean;
  emailPreferences: boolean;
  usageTrigger: boolean;
  usageFunction: boolean;
  cutoverRow: boolean;
}

async function billingArtifacts(ds: DataSource): Promise<BillingArtifacts> {
  const rows: BillingArtifacts[] = await ds.query(`
    SELECT
      to_regclass('tenant_request_usage')::text AS "usageTable",
      to_regclass('billing_email_logs')::text AS "emailLogsTable",
      EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'requests' AND column_name = 'quota_counted'
      ) AS "quotaFlag",
      EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'tenants' AND column_name = 'limit_overrides'
      ) AS "limitOverrides",
      EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'tenants' AND column_name = 'billing_email_preferences'
      ) AS "emailPreferences",
      EXISTS (
        SELECT 1 FROM pg_trigger
         WHERE tgname = 'TRG_agent_messages_count_tenant_request_usage'
      ) AS "usageTrigger",
      EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'count_tenant_request_usage'
      ) AS "usageFunction",
      EXISTS (
        SELECT 1 FROM "backfill_state" WHERE "name" = 'tenant_request_usage_cutover_v1'
      ) AS "cutoverRow"
  `);
  return rows[0]!;
}

const NONE: BillingArtifacts = {
  usageTable: null,
  emailLogsTable: null,
  quotaFlag: false,
  limitOverrides: false,
  emailPreferences: false,
  usageTrigger: false,
  usageFunction: false,
  cutoverRow: false,
};

async function runDropMigration(ds: DataSource, direction: 'up' | 'down'): Promise<void> {
  const queryRunner = ds.createQueryRunner();
  try {
    await new DropBillingSchema1803200000000()[direction](queryRunner);
  } finally {
    await queryRunner.release();
  }
}

async function insertAttempt(ds: DataSource, id: string): Promise<void> {
  await ds.query(
    `INSERT INTO "requests" ("id", "tenant_id", "agent_id", "timestamp", "status")
     VALUES ($1, $2, $3, $4, 'success')`,
    [`${id}-request`, TENANT, AGENT, TIMESTAMP],
  );
  await ds.query(
    `INSERT INTO "agent_messages" (
       "id", "request_id", "tenant_id", "agent_id", "agent_name", "timestamp",
       "status", "input_tokens", "output_tokens", "cache_read_tokens",
       "cache_creation_tokens"
     )
     VALUES ($1, $2, $3, $4, $4, $5, 'success', 0, 0, 0, 0)`,
    [id, `${id}-request`, TENANT, AGENT, TIMESTAMP],
  );
}

/**
 * Recreates the shape the old cloud-mode quota migration left behind: the
 * counter table, the request flag, the cutover row and a trigger on
 * agent_messages that writes into the counter table.
 */
async function installLegacyQuotaCounter(ds: DataSource): Promise<void> {
  await ds.query(`
    CREATE TABLE "tenant_request_usage" (
      "tenant_id" varchar NOT NULL,
      "window_start" timestamp NOT NULL,
      "request_count" bigint NOT NULL DEFAULT 0,
      "baseline_counted" boolean NOT NULL DEFAULT false,
      CONSTRAINT "PK_tenant_request_usage" PRIMARY KEY ("tenant_id", "window_start")
    )
  `);
  await ds.query(
    `ALTER TABLE "requests" ADD COLUMN "quota_counted" boolean NOT NULL DEFAULT false`,
  );
  await ds.query(
    `INSERT INTO "backfill_state" ("name", "completed_at")
     VALUES ('tenant_request_usage_cutover_v1', NOW())`,
  );
  await ds.query(`
    CREATE FUNCTION "count_tenant_request_usage"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO "tenant_request_usage" ("tenant_id", "window_start", "request_count")
      VALUES (NEW.tenant_id, date_trunc('month', NEW."timestamp"), 1)
      ON CONFLICT ("tenant_id", "window_start")
      DO UPDATE SET "request_count" = "tenant_request_usage"."request_count" + 1;
      RETURN NEW;
    END;
    $$
  `);
  await ds.query(`
    CREATE TRIGGER "TRG_agent_messages_count_tenant_request_usage"
    AFTER INSERT OR UPDATE OF "request_id" ON "agent_messages"
    FOR EACH ROW EXECUTE FUNCTION "count_tenant_request_usage"()
  `);
}

describe('DropBillingSchema migration (e2e)', () => {
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

    await ds.query(`INSERT INTO "tenants" ("id", "name", "is_active") VALUES ($1, $1, true)`, [
      TENANT,
    ]);
    await ds.query(
      `INSERT INTO "agents" ("id", "tenant_id", "name", "display_name", "is_playground")
       VALUES ($1, $2, $1, $1, false)`,
      [AGENT, TENANT],
    );
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('leaves no billing schema on a database migrated from empty', async () => {
    expect(await billingArtifacts(ds)).toEqual(NONE);
    const applied: Array<{ name: string }> = await ds.query(
      `SELECT "name" FROM "migrations" WHERE "name" = 'DropBillingSchema1803200000000'`,
    );
    expect(applied).toHaveLength(1);
  });

  it('reverts to the self-hosted billing schema and applies again', async () => {
    await runDropMigration(ds, 'down');
    expect(await billingArtifacts(ds)).toEqual({
      ...NONE,
      emailLogsTable: 'billing_email_logs',
      limitOverrides: true,
      emailPreferences: true,
    });

    await runDropMigration(ds, 'up');
    expect(await billingArtifacts(ds)).toEqual(NONE);

    // Idempotent: a second run on the cleaned schema is a no-op.
    await runDropMigration(ds, 'up');
    expect(await billingArtifacts(ds)).toEqual(NONE);
  });

  it('removes a legacy cloud quota counter, so attempt writes keep working', async () => {
    await installLegacyQuotaCounter(ds);
    await insertAttempt(ds, 'attempt-before-drop');
    const counted: Array<{ n: string }> = await ds.query(
      `SELECT "request_count" AS n FROM "tenant_request_usage" WHERE "tenant_id" = $1`,
      [TENANT],
    );
    expect(Number(counted[0]?.n)).toBe(1);

    await runDropMigration(ds, 'up');

    expect(await billingArtifacts(ds)).toEqual(NONE);
    await expect(insertAttempt(ds, 'attempt-after-drop')).resolves.toBeUndefined();
    const attempts: Array<{ n: string }> = await ds.query(
      `SELECT COUNT(*) AS n FROM "agent_messages" WHERE "tenant_id" = $1`,
      [TENANT],
    );
    expect(Number(attempts[0]?.n)).toBe(2);
  });
});
