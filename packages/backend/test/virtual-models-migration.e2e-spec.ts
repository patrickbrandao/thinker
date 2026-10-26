import { DataSource, QueryRunner } from 'typeorm';
import { entities, migrations } from '../src/database/data-source-definitions';
import { AddVirtualModels1803700000000 } from '../src/database/migrations/1803700000000-AddVirtualModels';
import { resolveE2eDatabaseUrl } from './e2e-db-guard';

async function run(ds: DataSource, direction: 'up' | 'down'): Promise<void> {
  const queryRunner: QueryRunner = ds.createQueryRunner();
  try {
    // Mirror the deploy runner (transaction mode 'each'): SET LOCAL only
    // applies inside a transaction.
    await queryRunner.startTransaction();
    await new AddVirtualModels1803700000000()[direction](queryRunner);
    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

async function tableExists(ds: DataSource): Promise<boolean> {
  const rows: Array<{ t: string | null }> = await ds.query(
    `SELECT to_regclass('public.virtual_models') AS t`,
  );
  return rows[0].t !== null;
}

async function messageColumns(ds: DataSource): Promise<string[]> {
  const rows: Array<{ name: string }> = await ds.query(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'agent_messages'
       AND column_name LIKE 'virtual_model_%' ORDER BY 1`,
  );
  return rows.map((r) => r.name);
}

async function insertAgent(ds: DataSource, id: string): Promise<void> {
  await ds.query(
    `INSERT INTO tenants (id, name, owner_user_id, is_active, created_at, updated_at)
     VALUES ($1, $1, $1, true, now(), now()) ON CONFLICT (id) DO NOTHING`,
    [`tenant-${id}`],
  );
  await ds.query(
    `INSERT INTO agents (id, name, tenant_id, is_active, created_at, updated_at)
     VALUES ($1, $1, $2, true, now(), now())`,
    [id, `tenant-${id}`],
  );
}

async function insertVirtual(ds: DataSource, id: string, agentId: string, name: string) {
  await ds.query(
    `INSERT INTO virtual_models (id, tenant_id, agent_id, name) VALUES ($1, $2, $3, $4)`,
    [id, `tenant-${agentId}`, agentId, name],
  );
}

describe('AddVirtualModels migration (e2e)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
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
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('creates the table with defaults and the agent_messages columns', async () => {
    expect(await tableExists(ds)).toBe(true);
    expect(await messageColumns(ds)).toEqual(['virtual_model_id', 'virtual_model_name']);
    await insertAgent(ds, 'mig-agent-1');
    await insertVirtual(ds, 'vm-1', 'mig-agent-1', 'DeepSeek/Flash');
    const [row] = await ds.query(`SELECT * FROM virtual_models WHERE id = 'vm-1'`);
    expect(row).toMatchObject({
      sort_order: 0,
      enabled: true,
      continue_on_default: false,
      response_mode: 'buffered',
      output_modality: 'text',
      override_route: null,
      fallback_routes: null,
    });
  });

  it('enforces (agent_id, LOWER(name)) uniqueness and the 64-character limit', async () => {
    await expect(insertVirtual(ds, 'vm-2', 'mig-agent-1', 'deepseek/flash')).rejects.toThrow(
      /IDX_virtual_models_agent_name/,
    );
    await insertAgent(ds, 'mig-agent-2');
    await insertVirtual(ds, 'vm-3', 'mig-agent-2', 'deepseek/flash');
    await expect(insertVirtual(ds, 'vm-4', 'mig-agent-2', 'a'.repeat(65))).rejects.toThrow();
  });

  it('cascades a hard agent delete and rejects an unknown agent', async () => {
    await ds.query(`DELETE FROM agents WHERE id = 'mig-agent-2'`);
    expect(await ds.query(`SELECT 1 FROM virtual_models WHERE id = 'vm-3'`)).toHaveLength(0);
    await expect(insertVirtual(ds, 'vm-5', 'no-such-agent', 'x')).rejects.toThrow(
      /FK_virtual_models_agent/,
    );
  });

  it('reverts cleanly, is idempotent both ways, and re-applies over existing messages', async () => {
    await ds.query(
      `INSERT INTO agent_messages (id, tenant_id, agent_id, timestamp, status, model,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, agent_name)
       VALUES ('msg-vm-1', 'tenant-mig-agent-1', 'mig-agent-1', now(), 'ok', 'gpt-4o', 1, 1, 0, 0, 'mig-agent-1')`,
    );
    await run(ds, 'down');
    await run(ds, 'down');
    expect(await tableExists(ds)).toBe(false);
    expect(await messageColumns(ds)).toEqual([]);

    await run(ds, 'up');
    await run(ds, 'up');
    expect(await tableExists(ds)).toBe(true);
    const [msg] = await ds.query(
      `SELECT virtual_model_id, virtual_model_name FROM agent_messages WHERE id = 'msg-vm-1'`,
    );
    expect(msg).toEqual({ virtual_model_id: null, virtual_model_name: null });
  });
});
