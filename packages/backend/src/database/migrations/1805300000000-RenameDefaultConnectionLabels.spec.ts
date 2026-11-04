import { RenameDefaultConnectionLabels1805300000000 } from './1805300000000-RenameDefaultConnectionLabels';

describe('RenameDefaultConnectionLabels1805300000000', () => {
  const migration = new RenameDefaultConnectionLabels1805300000000();
  let queries: { sql: string; params: unknown[] }[];
  let connections: Record<string, string>[];
  let tiers: Record<string, unknown>[];

  const queryRunner = {
    query: jest.fn().mockImplementation((sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes('FROM "tenant_providers"')) return Promise.resolve(connections);
      if (sql.startsWith('SELECT') && sql.includes('"tier_assignments"'))
        return Promise.resolve(tiers);
      return Promise.resolve([]);
    }),
  } as never;

  const renames = () =>
    queries.filter((q) => q.sql.startsWith('UPDATE "tenant_providers"')).map((q) => q.params);

  beforeEach(() => {
    queries = [];
    tiers = [];
    connections = [];
  });

  it('numbers legacy names per provider, skipping taken names and local runners', async () => {
    connections = [
      { id: 'a', tenant_id: 't', provider: 'opencode', auth_type: 'api_key', label: 'Default' },
      {
        id: 'b',
        tenant_id: 't',
        provider: 'opencode',
        auth_type: 'subscription',
        label: 'opencode-2',
      },
      { id: 'c', tenant_id: 't', provider: 'opencode', auth_type: 'api_key', label: 'Key 2' },
      { id: 'd', tenant_id: 't', provider: 'custom:abc', auth_type: 'api_key', label: 'Default' },
      { id: 'e', tenant_id: 't', provider: 'lmstudio', auth_type: 'local', label: 'Default' },
      { id: 'f', tenant_id: 't', provider: 'xai', auth_type: 'api_key', label: 'Work' },
    ];
    await migration.up(queryRunner);
    expect(renames()).toEqual([
      ['opencode-1', 'a'],
      ['opencode-3', 'c'],
      ['custom-1', 'd'],
    ]);
  });

  it('rewrites history and pinned routes of a renamed connection', async () => {
    connections = [
      { id: 'a', tenant_id: 't', provider: 'xai', auth_type: 'api_key', label: 'Default' },
    ];
    tiers = [
      {
        id: 'tier-1',
        override_route: {
          provider: 'xai',
          authType: 'api_key',
          model: 'grok',
          keyLabel: 'default',
        },
        auto_assigned_route: null,
        fallback_routes: [
          { provider: 'xai', authType: 'subscription', model: 'grok', keyLabel: 'Default' },
        ],
      },
    ];
    await migration.up(queryRunner);

    const history = queries.find((q) => q.sql.includes('"agent_messages"'));
    expect(history?.params).toEqual(['xai-1', 'a', 'Default']);

    const tierUpdate = queries.find((q) => q.sql.startsWith('UPDATE "tier_assignments"'));
    expect(tierUpdate?.sql).toContain('"override_route"');
    expect(tierUpdate?.sql).not.toContain('"fallback_routes"');
    expect(JSON.parse(tierUpdate!.params[0] as string).keyLabel).toBe('xai-1');
  });
});
