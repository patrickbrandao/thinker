process.env['THINKER_ENCRYPTION_KEY'] ??= 'test-encryption-secret-at-least-32-characters-long';

import { DataSource } from 'typeorm';
import { resolveE2eDatabaseUrl } from './e2e-db-guard';

/**
 * Migration-built schema (NOT synchronize): the key a harness already has
 * survives HarnessKeysAndIpPrefixes as its primary key, the one-key-per-agent
 * constraint is gone, and at most one primary per harness remains.
 */
describe('HarnessKeysAndIpPrefixes migration (e2e)', () => {
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
    // Back to the schema before this migration, with one key per harness:
    // undo the migrations that came after it, then this one.
    for (;;) {
      const last = (await ds.query(
        `SELECT name FROM migrations ORDER BY id DESC LIMIT 1`,
      )) as Array<{ name: string }>;
      const name = last[0].name;
      await ds.undoLastMigration({ transaction: 'each' });
      if (name === 'HarnessKeysAndIpPrefixes1806100000000') break;
    }

    await ds.query(`INSERT INTO tenants (id, name, is_active) VALUES ('mk-tenant', 'mk', true)`);
    await ds.query(
      `INSERT INTO agents (id, name, tenant_id) VALUES ('mk-agent', 'mk-agent', 'mk-tenant')`,
    );
    await ds.query(
      `INSERT INTO agent_api_keys (id, key, key_hash, key_prefix, label, tenant_id, agent_id, is_active)
       VALUES ('mk-key', 'enc', 'hash-old', 'thk_old', 'mk-agent ingest key', 'mk-tenant', 'mk-agent', true)`,
    );
    await expect(
      ds.query(
        `INSERT INTO agent_api_keys (id, key_hash, key_prefix, tenant_id, agent_id)
         VALUES ('mk-key-2', 'hash-2', 'thk_2', 'mk-tenant', 'mk-agent')`,
      ),
    ).rejects.toThrow();

    await ds.runMigrations({ transaction: 'each' });
  }, 90000);

  afterAll(async () => {
    await ds?.destroy();
  });

  it('keeps the existing key as the active, non-expiring, recoverable primary key', async () => {
    const rows = (await ds.query(
      `SELECT is_primary, is_active, expires_at, key, revoked_at FROM agent_api_keys WHERE id = 'mk-key'`,
    )) as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { is_primary: true, is_active: true, expires_at: null, key: 'enc', revoked_at: null },
    ]);
  });

  it('accepts extra keys but only one primary per harness', async () => {
    await ds.query(
      `INSERT INTO agent_api_keys (id, key_hash, key_prefix, tenant_id, agent_id, name, expires_at)
       VALUES ('mk-key-3', 'hash-3', 'thk_3', 'mk-tenant', 'mk-agent', 'ci', NOW() + interval '30 days')`,
    );
    await expect(
      ds.query(
        `INSERT INTO agent_api_keys (id, key_hash, key_prefix, tenant_id, agent_id, is_primary)
         VALUES ('mk-key-4', 'hash-4', 'thk_4', 'mk-tenant', 'mk-agent', true)`,
      ),
    ).rejects.toThrow();
  });

  it('refuses to delete an IP prefix list a key still uses', async () => {
    await ds.query(
      `INSERT INTO ip_prefix_lists (id, tenant_id, name, entries) VALUES ('mk-list', 'mk-tenant', 'Office', '[{"prefix":"203.0.113.0/24"}]')`,
    );
    await ds.query(
      `INSERT INTO agent_api_key_ip_prefix_lists (key_id, list_id, tenant_id) VALUES ('mk-key', 'mk-list', 'mk-tenant')`,
    );
    await expect(ds.query(`DELETE FROM ip_prefix_lists WHERE id = 'mk-list'`)).rejects.toThrow();
    await expect(
      ds.query(
        `INSERT INTO ip_prefix_lists (id, tenant_id, name) VALUES ('mk-list-2', 'mk-tenant', 'OFFICE')`,
      ),
    ).rejects.toThrow();
  });
});
