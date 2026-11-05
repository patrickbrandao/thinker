import { ConsoleService, likePattern } from './console.service';

const TENANT = 'tenant-1';

/** A data source that answers each statement by a substring of its SQL. */
function build(
  answers: Array<[match: string, rows: unknown[]]> = [],
  opts: { userTable?: boolean } = {},
) {
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('to_regclass')) return [{ ok: opts.userTable ?? true }];
    for (const [match, rows] of answers) if (sql.includes(match)) return rows;
    return [];
  });
  return { service: new ConsoleService({ query } as never), query };
}

const sqlOf = (call: unknown[]) => String(call[0]).replace(/\s+/g, ' ');
const callMatching = (query: jest.Mock, text: string) =>
  query.mock.calls.find((c) => String(c[0]).includes(text));

describe('likePattern', () => {
  it('wraps the query for a contains-match', () => {
    expect(likePattern('abc')).toBe('%abc%');
  });

  it('escapes LIKE wildcards and the escape character so input is literal', () => {
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
    expect(likePattern('a\\b')).toBe('%a\\\\b%');
    expect(likePattern('%%')).toBe('%\\%\\%%');
  });
});

describe('ConsoleService.search', () => {
  it.each(['', ' ', 'a', ' a ', '\t\n'])('returns nothing for %p without querying', async (q) => {
    const { service, query } = build();
    await expect(service.search(TENANT, q)).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('searches from two characters on, trimming the query', async () => {
    const { service, query } = build();
    await service.search(TENANT, '  ab  ');
    const harness = callMatching(query, 'FROM agents')!;
    expect(harness[1]).toEqual([TENANT, '%ab%', 6]);
  });

  it('caps the query at 100 characters', async () => {
    const { service, query } = build();
    await service.search(TENANT, 'x'.repeat(250));
    const params = callMatching(query, 'FROM agents')![1] as unknown[];
    expect(params[1]).toBe(`%${'x'.repeat(100)}%`);
  });

  it('scopes every query to the tenant and caps each type', async () => {
    const { service, query } = build();
    await service.search(TENANT, 'abc');
    const searches = query.mock.calls.filter((c) => !String(c[0]).includes('to_regclass'));
    expect(searches).toHaveLength(6);
    for (const call of searches) {
      expect(sqlOf(call)).toMatch(/tenant_id = \$1/);
      expect(call[1]).toEqual([TENANT, '%abc%', 6]);
      expect(sqlOf(call)).toContain('LIMIT $3');
    }
  });

  it('hides deleted harnesses and the Playground', async () => {
    const { service, query } = build();
    await service.search(TENANT, 'abc');
    const sql = sqlOf(callMatching(query, 'FROM agents')!);
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('is_playground = false');
  });

  it('only searches models of active connections', async () => {
    const { service, query } = build();
    await service.search(TENANT, 'abc');
    expect(sqlOf(callMatching(query, 'cached_models')!)).toContain('tp.is_active = true');
  });

  it('maps each type to its title, subtitle and dashboard link', async () => {
    const { service } = build([
      [
        'cached_models',
        [{ connection_id: 'c1', provider: 'openai', model_id: 'gpt-4o', display_name: null }],
      ],
      [
        'FROM agents',
        [
          { id: 'h1', name: 'my bot', display_name: 'My Bot', agent_platform: 'claude-code' },
          { id: 'h2', name: 'plain', display_name: null, agent_platform: null },
        ],
      ],
      [
        'FROM tenant_providers',
        [
          { id: 'c/1', provider: 'openai', label: 'Work', auth_type: 'api_key' },
          { id: 'c2', provider: 'anthropic', label: '', auth_type: 'subscription' },
        ],
      ],
      [
        'FROM custom_providers',
        [{ id: 'cp1', name: 'Local', alias: null, base_url: 'http://x.test/v1' }],
      ],
      ['FROM virtual_models', [{ id: 'v1', name: 'fast', agent_name: 'my bot' }]],
      ['organization_members', [{ id: 'u1', name: '', email: 'a@b.test', role: 'admin' }]],
    ]);
    const results = await service.search(TENANT, 'abc');
    expect(results).toEqual([
      {
        type: 'harness',
        id: 'h1',
        title: 'My Bot',
        subtitle: 'claude-code',
        href: '/harnesses/my%20bot',
      },
      { type: 'harness', id: 'h2', title: 'plain', subtitle: null, href: '/harnesses/plain' },
      {
        type: 'connection',
        id: 'c/1',
        title: 'openai · Work',
        subtitle: 'api_key',
        href: '/providers/connections/c%2F1',
      },
      {
        type: 'connection',
        id: 'c2',
        title: 'anthropic',
        subtitle: 'subscription',
        href: '/providers/connections/c2',
      },
      {
        type: 'custom_provider',
        id: 'cp1',
        title: 'Local',
        subtitle: 'http://x.test/v1',
        href: '/providers/usage-based',
      },
      {
        type: 'virtual_model',
        id: 'v1',
        title: 'fast',
        subtitle: 'my bot',
        href: '/harnesses/my%20bot/routing',
      },
      {
        type: 'model',
        id: 'openai/gpt-4o',
        title: 'gpt-4o',
        subtitle: 'openai/gpt-4o',
        href: '/providers/connections/c1',
      },
      {
        type: 'member',
        id: 'u1',
        title: 'a@b.test',
        subtitle: 'a@b.test · admin',
        href: '/organization',
      },
    ]);
  });

  it('skips member search where Better Auth never created its user table, and remembers it', async () => {
    const { service, query } = build([], { userTable: false });
    await service.search(TENANT, 'abc');
    await service.search(TENANT, 'abc');
    expect(callMatching(query, 'organization_members')).toBeUndefined();
    expect(query.mock.calls.filter((c) => String(c[0]).includes('to_regclass'))).toHaveLength(1);
  });

  it('checks the user table once and then searches members on every call', async () => {
    const { service, query } = build();
    await service.search(TENANT, 'abc');
    await service.search(TENANT, 'abc');
    expect(query.mock.calls.filter((c) => String(c[0]).includes('to_regclass'))).toHaveLength(1);
    expect(
      query.mock.calls.filter((c) => String(c[0]).includes('organization_members')),
    ).toHaveLength(2);
  });

  it('scopes member search by the tenant of the membership', async () => {
    const { service, query } = build();
    await service.search(TENANT, 'abc');
    expect(sqlOf(callMatching(query, 'organization_members')!)).toContain('om.tenant_id = $1');
  });
});

describe('ConsoleService.alerts', () => {
  it('filters by tenant, failure statuses and a 24 hour window', async () => {
    const { service, query } = build([['count(*)', [{ total: 0 }]]]);
    await service.alerts(TENANT);
    expect(query).toHaveBeenCalledTimes(2);
    for (const call of query.mock.calls) {
      const sql = sqlOf(call);
      expect(sql).toContain('tenant_id = $1');
      expect(sql).toContain('status = ANY($2)');
      expect(sql).toContain('timestamp >= now() - make_interval(hours => $3)');
      expect(call[1]).toEqual([TENANT, ['error', 'fallback_error', 'rate_limited', 'failed'], 24]);
    }
    const list = sqlOf(callMatching(query, 'ORDER BY')!);
    expect(list).toContain('ORDER BY timestamp DESC LIMIT 30');
  });

  it('reports the window total separately from the 30 listed items', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `r${i}`,
      timestamp: new Date('2026-11-05T10:00:00Z'),
      agent_name: 'bot',
      requested_model: 'gpt-4o',
      status: 'error',
      error_message: 'boom',
      error_http_status: 502,
      error_class: 'upstream',
    }));
    const { service } = build([
      ['ORDER BY', rows],
      ['count(*)', [{ total: 71 }]],
    ]);
    const result = await service.alerts(TENANT);
    expect(result.items).toHaveLength(30);
    expect(result.total).toBe(71);
  });

  it('serializes dates, passes string timestamps through and truncates long messages', async () => {
    const long = 'e'.repeat(500);
    const { service } = build([
      [
        'ORDER BY',
        [
          {
            id: 'a',
            timestamp: new Date('2026-11-05T10:00:00Z'),
            agent_name: 'bot',
            requested_model: 'gpt-4o',
            status: 'failed',
            error_message: long,
            error_http_status: 429,
            error_class: 'rate',
          },
          {
            id: 'b',
            timestamp: '2026-11-05 09:00:00',
            agent_name: null,
            requested_model: null,
            status: 'error',
            error_message: null,
            error_http_status: null,
            error_class: null,
          },
        ],
      ],
      ['count(*)', [{ total: 2 }]],
    ]);
    const { items } = await service.alerts(TENANT);
    expect(items[0]).toEqual({
      id: 'a',
      timestamp: '2026-11-05T10:00:00.000Z',
      agentName: 'bot',
      model: 'gpt-4o',
      status: 'failed',
      errorMessage: 'e'.repeat(300),
      errorHttpStatus: 429,
      errorClass: 'rate',
    });
    expect(items[1]).toMatchObject({
      timestamp: '2026-11-05 09:00:00',
      agentName: null,
      model: null,
      errorMessage: null,
    });
  });

  it('answers an empty window with zero', async () => {
    const { service } = build();
    await expect(service.alerts(TENANT)).resolves.toEqual({ items: [], total: 0 });
  });
});
