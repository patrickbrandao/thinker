process.env['THINKER_ENCRYPTION_KEY'] ??= 'test-encryption-secret-at-least-32-characters-long';

import { DataSource } from 'typeorm';
import { resolveE2eDatabaseUrl } from './e2e-db-guard';

/**
 * Migration-built schema: KeyIpRestriction moves a harness's source-IP
 * restriction onto each of its keys that is not revoked.
 */
describe('KeyIpRestriction migration (e2e)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: resolveE2eDatabaseUrl(),
      entities: ['src/entities/!(*.spec).ts'],
      migrations: ['src/database/migrations/!(*.spec).ts'],
      synchronize: false,
      dropSchema: true,
      logging: false,
    });
    await ds.initialize();
    await ds.runMigrations({ transaction: 'each' });
    for (;;) {
      const last = (await ds.query(
        `SELECT name FROM migrations ORDER BY id DESC LIMIT 1`,
      )) as Array<{ name: string }>;
      await ds.undoLastMigration({ transaction: 'each' });
      if (last[0].name === 'KeyIpRestriction1806300000000') break;
    }

    await ds.query(`INSERT INTO tenants (id, name, is_active) VALUES ('kt', 'kt', true)`);
    await ds.query(
      `INSERT INTO agents (id, name, tenant_id, ip_restriction_enabled)
       VALUES ('ka', 'ka', 'kt', true), ('kb', 'kb', 'kt', false)`,
    );
    await ds.query(
      `INSERT INTO ip_prefix_lists (id, tenant_id, name, entries)
       VALUES ('kl', 'kt', 'Office', '[{"prefix":"198.51.100.0/24"}]'::jsonb)`,
    );
    await ds.query(
      `INSERT INTO agent_ip_prefix_lists (agent_id, list_id, tenant_id) VALUES ('ka', 'kl', 'kt')`,
    );
    await ds.query(
      `INSERT INTO agent_api_keys (id, key_hash, key_prefix, tenant_id, agent_id, is_primary, revoked_at)
       VALUES ('k-primary', 'h1', 'thk_1', 'kt', 'ka', true, NULL),
              ('k-extra', 'h2', 'thk_2', 'kt', 'ka', false, NULL),
              ('k-revoked', 'h3', 'thk_3', 'kt', 'ka', false, NOW()),
              ('k-other', 'h4', 'thk_4', 'kt', 'kb', true, NULL)`,
    );

    await ds.runMigrations({ transaction: 'each' });
  }, 90000);

  afterAll(async () => {
    await ds?.destroy();
  });

  it('copies the harness restriction to every key that is not revoked', async () => {
    const keys = (await ds.query(
      `SELECT id, ip_restriction_enabled AS enabled FROM agent_api_keys ORDER BY id`,
    )) as Array<{ id: string; enabled: boolean }>;
    expect(keys).toEqual([
      { id: 'k-extra', enabled: true },
      { id: 'k-other', enabled: false },
      { id: 'k-primary', enabled: true },
      { id: 'k-revoked', enabled: false },
    ]);
    const links = (await ds.query(
      `SELECT key_id, list_id FROM agent_api_key_ip_prefix_lists ORDER BY key_id`,
    )) as Array<{ key_id: string; list_id: string }>;
    expect(links).toEqual([
      { key_id: 'k-extra', list_id: 'kl' },
      { key_id: 'k-primary', list_id: 'kl' },
    ]);
  });

  it('drops the per-harness restriction', async () => {
    const tables = (await ds.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_ip_prefix_lists'`,
    )) as unknown[];
    expect(tables).toHaveLength(0);
    const cols = (await ds.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agents' AND column_name = 'ip_restriction_enabled'`,
    )) as unknown[];
    expect(cols).toHaveLength(0);
  });
});
