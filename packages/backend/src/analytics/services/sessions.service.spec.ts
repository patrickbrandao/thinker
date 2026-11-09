import { SessionsService, TIMELINE_MAX_SESSIONS, timelineBucket } from './sessions.service';

const TENANT = 'tenant-1';

const summaryRow = (over: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  agent_id: 'agent-1',
  agent_name: 'bot',
  started_at: new Date('2026-11-05T10:00:00Z'),
  last_at: new Date('2026-11-05T10:05:00Z'),
  requests: '3',
  failed: '1',
  in_flight: '0',
  subagents: '2',
  // bigint columns arrive from pg as strings
  input_tokens: '1200',
  output_tokens: '340',
  cache_read_tokens: '50',
  cache_creation_tokens: '7',
  cost: 0.0123,
  models: ['gpt-4o'],
  providers: ['openai'],
  ...over,
});

const partRow = (over: Record<string, unknown> = {}) => ({
  session_id: 'sess-1',
  started_at: new Date('2026-11-05T10:00:00Z'),
  last_at: new Date('2026-11-05T10:01:00Z'),
  requests: '2',
  failed: '0',
  input_tokens: '10',
  output_tokens: '5',
  cost: '0.5',
  ...over,
});

function build(answer: (sql: string, params: unknown[]) => unknown[] = () => []) {
  const query = jest.fn(async (sql: string, params: unknown[]) => answer(sql, params));
  return { service: new SessionsService({ query } as never), query };
}

describe('SessionsService.list', () => {
  it('scopes to the tenant and to requests that carry a session id', async () => {
    const { service, query } = build();
    await service.list({ tenantId: TENANT, limit: 50, offset: 0 });
    const [sql, args] = query.mock.calls[0];
    expect(sql).toContain('r.tenant_id = $1');
    expect(sql).toContain('r.session_id IS NOT NULL');
    // The detail join is tenant-scoped too, so no foreign request can fold in.
    expect(sql).toContain('JOIN requests r ON r.tenant_id = $1');
    expect(args[0]).toBe(TENANT);
  });

  it('fetches one extra row to learn whether more pages exist', async () => {
    const { service, query } = build(() => [
      summaryRow({ id: 'a' }),
      summaryRow({ id: 'b' }),
      summaryRow({ id: 'c' }),
    ]);
    const page = await service.list({ tenantId: TENANT, limit: 2, offset: 4 });
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(page.has_more).toBe(true);
    expect(query.mock.calls[0][1]).toEqual([TENANT, 3, 4]);
  });

  it('reports no further page when the result fits the limit', async () => {
    const { service } = build(() => [summaryRow({ id: 'a' }), summaryRow({ id: 'b' })]);
    const page = await service.list({ tenantId: TENANT, limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.has_more).toBe(false);
  });

  it('keeps LIMIT/OFFSET placeholders aligned with the arguments for every filter combination', async () => {
    const combos = [{}, { range: '7d' }, { agentName: 'bot' }, { range: '7d', agentName: 'bot' }];
    for (const filters of combos) {
      const { service, query } = build();
      await service.list({ tenantId: TENANT, limit: 10, offset: 20, ...filters });
      const [sql, args] = query.mock.calls[0] as [string, unknown[]];
      const n = args.length;
      expect(args.slice(-2)).toEqual([11, 20]);
      expect(sql).toContain('LIMIT $' + (n - 1) + ' OFFSET $' + n);
      const used = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      expect(Math.max(...used)).toBe(n);
    }
  });

  it('adds a cutoff for the range and resolves the harness by tenant and live name', async () => {
    const { service, query } = build();
    await service.list({ tenantId: TENANT, range: '1h', agentName: 'bot', limit: 5, offset: 0 });
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('r.timestamp >= $2');
    expect(sql).toContain(
      'r.agent_id IN (SELECT id FROM agents WHERE tenant_id = $1 AND name = $3 AND deleted_at IS NULL)',
    );
    expect(args[2]).toBe('bot');
    expect(typeof args[1]).toBe('string');
  });

  it('omits the time filter without a range', async () => {
    const { service, query } = build();
    await service.list({ tenantId: TENANT, limit: 5, offset: 0 });
    expect(String(query.mock.calls[0][0])).not.toContain('r.timestamp >=');
  });

  it('filters sessions with errors and with subagents (combinable, whole session)', async () => {
    const { service, query } = build();
    await service.list({ tenantId: TENANT, limit: 50, offset: 0 });
    expect(query.mock.calls[0][0]).not.toContain('HAVING');

    await service.list({ tenantId: TENANT, hasErrors: true, limit: 50, offset: 0 });
    let sql = query.mock.calls[1][0] as string;
    expect(sql).toMatch(/HAVING EXISTS/);
    expect(sql).toContain('x.status');
    expect(sql).not.toContain('x.parent_session_id IS NOT NULL');

    await service.list({ tenantId: TENANT, hasSubagents: true, limit: 50, offset: 0 });
    sql = query.mock.calls[2][0] as string;
    expect(sql).toContain('x.parent_session_id IS NOT NULL');

    await service.list({
      tenantId: TENANT,
      range: '7d',
      hasErrors: true,
      hasSubagents: true,
      limit: 10,
      offset: 20,
    });
    const [both, args] = query.mock.calls[3] as [string, unknown[]];
    expect(both.match(/EXISTS \(/g)).toHaveLength(2);
    expect(both).toMatch(/HAVING EXISTS[\s\S]*AND EXISTS/);
    // Both subqueries stay inside the tenant.
    expect(both.match(/x\.tenant_id = \$1/g)).toHaveLength(2);
    expect(args.slice(-2)).toEqual([11, 20]);
  });

  it('folds subagent sessions into their main session', async () => {
    const { service, query } = build();
    await service.list({ tenantId: TENANT, limit: 5, offset: 0 });
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('COALESCE(r.parent_session_id, r.session_id) AS root');
    expect(sql).toContain('r.session_id = a.root OR r.parent_session_id = a.root');
    expect(sql).toContain('COUNT(DISTINCT q.session_id) FILTER (WHERE q.session_id <> q.root)');
  });

  it('only counts models and providers of successful attempts', async () => {
    const { service, query } = build();
    await service.list({ tenantId: TENANT, limit: 5, offset: 0 });
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toContain("m.status IS NULL OR m.status IN ('ok', 'success')");
  });

  it('turns bigint strings and dates into numbers and ISO strings', async () => {
    const { service } = build(() => [summaryRow()]);
    const { items } = await service.list({ tenantId: TENANT, limit: 5, offset: 0 });
    expect(items[0]).toEqual({
      id: 'sess-1',
      agent_id: 'agent-1',
      agent_name: 'bot',
      started_at: '2026-11-05T10:00:00.000Z',
      last_at: '2026-11-05T10:05:00.000Z',
      requests: 3,
      failed: 1,
      in_flight: 0,
      subagents: 2,
      input_tokens: 1200,
      output_tokens: 340,
      cache_read_tokens: 50,
      cache_creation_tokens: 7,
      cost: 0.0123,
      models: ['gpt-4o'],
      providers: ['openai'],
    });
  });

  it('defaults null aggregates to zero and empty lists', async () => {
    const { service } = build(() => [
      summaryRow({
        agent_id: undefined,
        agent_name: undefined,
        requests: null,
        input_tokens: undefined,
        cost: null,
        models: null,
        providers: undefined,
      }),
    ]);
    const { items } = await service.list({ tenantId: TENANT, limit: 5, offset: 0 });
    expect(items[0]).toMatchObject({
      agent_id: null,
      agent_name: null,
      requests: 0,
      input_tokens: 0,
      cost: 0,
      models: [],
      providers: [],
    });
  });

  it('keeps string timestamps as they come', async () => {
    const { service } = build(() => [summaryRow({ started_at: '2026-11-05 10:00:00' })]);
    const { items } = await service.list({ tenantId: TENANT, limit: 5, offset: 0 });
    expect(items[0].started_at).toBe('2026-11-05 10:00:00');
  });
});

describe('SessionsService.get', () => {
  const answerFor =
    (opts: { summary?: unknown[]; parts?: unknown[]; parent?: unknown[]; headers?: unknown[] }) =>
    (sql: string) => {
      if (sql.includes('SELECT request_headers')) return opts.headers ?? [];
      if (sql.includes('SELECT parent_session_id')) return opts.parent ?? [];
      if (sql.includes('GROUP BY q.session_id')) return opts.parts ?? [];
      return opts.summary ?? [];
    };

  it('is null for an unknown session and never reads headers', async () => {
    const { service, query } = build(answerFor({}));
    await expect(service.get(TENANT, 'nope', true)).resolves.toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('SELECT request_headers'))).toBe(
      false,
    );
  });

  it('scopes every statement to the tenant and the session id', async () => {
    const { service, query } = build(answerFor({ summary: [summaryRow()], parts: [partRow()] }));
    await service.get(TENANT, 'sess-1', true);
    expect(query.mock.calls.length).toBe(4);
    for (const [sql, args] of query.mock.calls) {
      expect(String(sql)).toContain('tenant_id = $1');
      expect(args).toEqual([TENANT, 'sess-1']);
    }
  });

  it('marks the main session among the parts and keeps the order given by the query', async () => {
    const { service } = build(
      answerFor({
        summary: [summaryRow()],
        parts: [
          partRow({ session_id: 'sess-1' }),
          partRow({ session_id: 'sub-1', requests: '1', cost: '0.25' }),
        ],
      }),
    );
    const detail = await service.get(TENANT, 'sess-1', false);
    expect(detail!.parts.map((p) => [p.session_id, p.is_main])).toEqual([
      ['sess-1', true],
      ['sub-1', false],
    ]);
    expect(detail!.parts[1]).toMatchObject({ requests: 1, cost: 0.25, input_tokens: 10 });
  });

  it('exposes the parent when a subagent session is opened directly', async () => {
    const { service } = build(
      answerFor({
        summary: [summaryRow({ id: 'sub-1' })],
        parent: [{ parent_session_id: 'main-1' }],
      }),
    );
    await expect(service.get(TENANT, 'sub-1', false)).resolves.toMatchObject({
      id: 'sub-1',
      parent_session_id: 'main-1',
    });
  });

  it('has no parent for a main session', async () => {
    const { service } = build(answerFor({ summary: [summaryRow()] }));
    await expect(service.get(TENANT, 'sess-1', false)).resolves.toMatchObject({
      parent_session_id: null,
    });
  });

  it('does not read recorded headers unless the caller may see the client', async () => {
    const { service, query } = build(
      answerFor({
        summary: [summaryRow()],
        headers: [{ request_headers: { 'user-agent': 'secret/1.0' } }],
      }),
    );
    const detail = await service.get(TENANT, 'sess-1', false);
    expect(detail!.client).toBeNull();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('SELECT request_headers'))).toBe(
      false,
    );
  });

  it('reads the client from the latest recorded headers (object or JSON string)', async () => {
    const headers = {
      'user-agent': 'opencode/1.2',
      'x-opencode-project': 'proj',
      'x-opencode-client': 'cli',
    };
    for (const raw of [headers, JSON.stringify(headers)]) {
      const { service } = build(
        answerFor({ summary: [summaryRow()], headers: [{ request_headers: raw }] }),
      );
      const detail = await service.get(TENANT, 'sess-1', true);
      expect(detail!.client).toEqual({
        user_agent: 'opencode/1.2',
        project: 'proj',
        client: 'cli',
      });
    }
  });

  it('falls back to the originator header for the client name', async () => {
    const { service } = build(
      answerFor({
        summary: [summaryRow()],
        headers: [{ request_headers: { 'user-agent': 'codex', originator: 'codex_cli_rs' } }],
      }),
    );
    const detail = await service.get(TENANT, 'sess-1', true);
    expect(detail!.client).toEqual({ user_agent: 'codex', project: null, client: 'codex_cli_rs' });
  });

  it.each([[undefined], [null], ['not json {'], ['']])(
    'has no client for unusable headers (%p)',
    async (raw) => {
      const { service } = build(
        answerFor({ summary: [summaryRow()], headers: [{ request_headers: raw }] }),
      );
      const detail = await service.get(TENANT, 'sess-1', true);
      expect(detail!.client).toBeNull();
    },
  );

  it('has no client when no request recorded headers', async () => {
    const { service } = build(answerFor({ summary: [summaryRow()], headers: [] }));
    expect((await service.get(TENANT, 'sess-1', true))!.client).toBeNull();
  });
});

describe('SessionsService.timeline', () => {
  it('picks hours for a day, days up to a month and weeks above', () => {
    expect(timelineBucket('24h')).toBe('hour');
    expect(timelineBucket('7d')).toBe('day');
    expect(timelineBucket('30d')).toBe('day');
    expect(timelineBucket('90d')).toBe('week');
    expect(timelineBucket('365d')).toBe('week');
  });

  it('buckets by the range, caps the sessions and keeps the filters', async () => {
    const { service, query } = build(() => [
      {
        root: 's1',
        agent_id: 'a1',
        agent_name: 'bot',
        bucket: new Date('2026-11-05T00:00:00Z'),
        requests: 3,
        failed: 1,
        cost: '0.25',
        total: '7',
      },
      {
        root: 's1',
        agent_id: 'a1',
        agent_name: 'bot',
        bucket: new Date('2026-11-06T00:00:00Z'),
        requests: 1,
        failed: 0,
        cost: 0,
        total: '7',
      },
    ]);
    const out = await service.timeline({ tenantId: TENANT, range: '7d', hasErrors: true });
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("date_trunc('day', r.timestamp)");
    expect(sql).toContain('HAVING EXISTS');
    expect(sql).toContain('r.tenant_id = $1');
    expect(args[0]).toBe(TENANT);
    expect(args[args.length - 1]).toBe(TIMELINE_MAX_SESSIONS);
    expect(out.bucket).toBe('day');
    expect(out.total_sessions).toBe(7);
    expect(out.shown_sessions).toBe(1);
    expect(out.points[0]).toEqual({
      session_id: 's1',
      agent_name: 'bot',
      bucket: '2026-11-05T00:00:00.000Z',
      requests: 3,
      failed: 1,
      cost: 0.25,
    });
    expect(out.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
