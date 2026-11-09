import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { decrypt, encrypt, getEncryptionSecret } from '../common/utils/crypto.util';
import type { TenantCacheService } from '../common/services/tenant-cache.service';
import type { TriggerDispatchService } from './trigger-dispatch.service';
import type { TriggerWorkerService } from './trigger-worker.service';
import { TriggersService } from './triggers.service';

type Row = Record<string, unknown>;

const webhookRow = (over: Row = {}): Row => ({
  id: 't1',
  tenant_id: 'tenant-1',
  name: 'Hook',
  type: 'webhook',
  enabled: true,
  config: {
    method: 'POST',
    url: 'https://example.com/h',
    content_type: 'application/json',
    body: '{{event.json}}',
    headers: [{ name: 'Authorization' }],
  },
  secrets_encrypted: encrypt(
    JSON.stringify({
      headers: { Authorization: 'Bearer abcdefghij' },
      hmacSecret: 'topsecret-value',
    }),
    getEncryptionSecret(),
  ),
  max_retries: 3,
  retry_delay_seconds: 30,
  timeout_seconds: 10,
  workspace_events: [],
  harness_count: 2,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  ...over,
});

interface Fixture {
  /** Trigger rows by tenant, as the tenant-scoped SELECT would return them. */
  triggers?: Row[];
  names?: Array<{ id: string }>;
  agents?: Row[];
  knownTriggers?: Row[];
  event?: Row | null;
  logs?: Row[];
  users?: Row[];
  retried?: unknown;
  bindings?: Row[];
}

function setup(f: Fixture = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const txCalls: Array<{ sql: string; params: unknown[] }> = [];
  let insertedId: unknown;
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO triggers')) insertedId = params[0];
    if (sql.includes('FROM triggers t')) {
      const tenant = params[0];
      const id = params[1];
      // create() re-reads the row it just inserted under a random id.
      return (f.triggers ?? [])
        .filter(
          (r) => r.tenant_id === tenant && (id === undefined || id === insertedId || r.id === id),
        )
        .map((r) => (id !== undefined && id === insertedId ? { ...r, id } : r));
    }
    if (sql.includes('LOWER(name) = LOWER')) return f.names ?? [];
    if (sql.includes('FROM agents')) return f.agents ?? [];
    if (sql.includes('FROM agent_triggers')) return f.bindings ?? [];
    if (sql.includes('FROM triggers WHERE tenant_id')) return f.knownTriggers ?? [];
    if (sql.includes('FROM trigger_events e'))
      return f.event === undefined ? [] : f.event ? [f.event] : [];
    if (sql.includes('FROM trigger_event_logs')) return f.logs ?? [];
    if (sql.includes('FROM "user"')) return f.users ?? [];
    if (sql.includes('UPDATE trigger_events')) return f.retried ?? [];
    return [];
  });
  const ds = {
    query,
    transaction: jest.fn(async (fn: (m: unknown) => Promise<void>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          txCalls.push({ sql, params });
        },
      }),
    ),
  };
  const tenantCache = { ensureForUser: jest.fn().mockResolvedValue('tenant-new') };
  const dispatch = {
    invalidateBindings: jest.fn(),
    emit: jest.fn().mockResolvedValue(['ev1']),
  };
  const worker = {
    kick: jest.fn(),
    deliverNow: jest.fn().mockResolvedValue({
      success: true,
      statusCode: 204,
      error: null,
      response: null,
    }),
  };
  const service = new TriggersService(
    ds as unknown as DataSource,
    tenantCache as unknown as TenantCacheService,
    dispatch as unknown as TriggerDispatchService,
    worker as unknown as TriggerWorkerService,
  );
  const find = (needle: string) => calls.filter((c) => c.sql.includes(needle));
  return { service, ds, query, calls, txCalls, find, tenantCache, dispatch, worker };
}

/** A rejected promise carrying a BadRequestException: its message list. */
async function badRequest(promise: Promise<unknown>): Promise<string[]> {
  const err = await promise.then(
    () => {
      throw new Error('expected a BadRequestException');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return ((err as BadRequestException).getResponse() as { message: string[] }).message;
}

const ownerCtx = { tenantId: 'tenant-1', userId: 'user-1', role: 'owner' as const };
const webhookInput = {
  name: 'Hook',
  type: 'webhook',
  config: { url: 'https://example.com/h' },
};

describe('TriggersService', () => {
  // NODE_ENV=test short-circuits validatePublicUrl unless forced back on.
  const savedSsrf = process.env['SKIP_SSRF_VALIDATION'];
  beforeAll(() => {
    process.env['SKIP_SSRF_VALIDATION'] = 'false';
  });
  afterAll(() => {
    if (savedSsrf === undefined) delete process.env['SKIP_SSRF_VALIDATION'];
    else process.env['SKIP_SSRF_VALIDATION'] = savedSsrf;
  });

  describe('list', () => {
    it('returns nothing without a tenant', async () => {
      const { service, query } = setup();
      expect(await service.list(null)).toEqual({ triggers: [] });
      expect(query).not.toHaveBeenCalled();
    });

    it('lists only the tenant triggers and never exposes secrets', async () => {
      const { service, find } = setup({
        triggers: [
          webhookRow(),
          webhookRow({ id: 'foreign', tenant_id: 'tenant-2', name: 'Other' }),
        ],
      });
      const { triggers } = await service.list('tenant-1');
      expect(find('FROM triggers t')[0].sql).toContain('t.tenant_id = $1');
      expect(triggers.map((t) => t.id)).toEqual(['t1']);
      const json = JSON.stringify(triggers);
      expect(json).not.toContain('abcdefghij');
      expect(json).not.toContain('topsecret-value');
      expect(triggers[0]).toMatchObject({
        harness_count: 2,
        secrets: { hmacSecret: 'topsec…' },
        config: { headers: [{ name: 'Authorization', hint: 'Bear…' }] },
      });
    });
  });

  describe('create', () => {
    it('rejects invalid input with the validation errors', async () => {
      const { service } = setup();
      const messages = await badRequest(
        service.create(ownerCtx, { name: '', type: 'webhook', config: { url: 'nope' } }, true),
      );
      expect(messages).toEqual(
        expect.arrayContaining(['name is required', 'config.url must be an http(s) URL']),
      );
    });

    it('rejects an unknown type', async () => {
      const { service } = setup();
      await expect(
        service.create(ownerCtx, { name: 'x', type: 'carrier-pigeon' }, true),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate name in the tenant, case-insensitively', async () => {
      const { service, find } = setup({ names: [{ id: 'other' }] });
      expect(await badRequest(service.create(ownerCtx, webhookInput, true))).toEqual([
        'A trigger named "Hook" already exists',
      ]);
      expect(find('LOWER(name) = LOWER')[0].params).toEqual(['tenant-1', 'Hook']);
      expect(find('INSERT INTO triggers')).toHaveLength(0);
    });

    it('refuses private webhook destinations when the caller may not use them', async () => {
      const { service, find } = setup();
      const messages = await badRequest(
        service.create(
          ownerCtx,
          { ...webhookInput, config: { url: 'http://127.0.0.1:9/h' } },
          false,
        ),
      );
      expect(messages[0]).toContain('config.url');
      expect(find('INSERT INTO triggers')).toHaveLength(0);
    });

    it('accepts a private webhook destination for callers allowed to use them', async () => {
      const { service } = setup({ triggers: [webhookRow()] });
      await expect(
        service.create(
          ownerCtx,
          { ...webhookInput, config: { url: 'http://127.0.0.1:9/h' } },
          true,
        ),
      ).resolves.toBeDefined();
    });

    it('stores the trigger encrypted, tenant-scoped and attributed to the creator', async () => {
      const { service, find } = setup({ triggers: [webhookRow()] });
      const view = await service.create(
        ownerCtx,
        {
          ...webhookInput,
          secrets: { hmacSecret: 'topsecret-value' },
          workspace_events: ['harness.created'],
        },
        true,
      );
      const insert = find('INSERT INTO triggers')[0].params as string[];
      expect(insert[1]).toBe('tenant-1');
      expect(insert[2]).toBe('Hook');
      expect(insert[3]).toBe('webhook');
      expect(insert[6]).not.toContain('topsecret-value');
      expect(JSON.parse(decrypt(insert[6], getEncryptionSecret()))).toEqual({
        headers: {},
        hmacSecret: 'topsecret-value',
      });
      expect(JSON.parse(insert[10])).toEqual(['harness.created']);
      expect(insert[11]).toBe('user-1');
      expect(view.id).toBe(insert[0]);
      // The re-read after the insert is also tenant scoped.
      expect(find('FROM triggers t').at(-1)!.params[0]).toBe('tenant-1');
    });

    it('stores no ciphertext at all when the trigger has no secrets', async () => {
      const { service, find } = setup({ triggers: [webhookRow()] });
      await service.create(ownerCtx, webhookInput, true);
      expect(find('INSERT INTO triggers')[0].params[6]).toBeNull();
    });

    it('provisions the personal tenant for a user who has none yet', async () => {
      const { service, tenantCache, find } = setup({
        triggers: [webhookRow({ tenant_id: 'tenant-new' })],
      });
      await service.create({ tenantId: null, userId: 'user-9' }, webhookInput, true);
      expect(tenantCache.ensureForUser).toHaveBeenCalledWith('user-9');
      expect(find('INSERT INTO triggers')[0].params[1]).toBe('tenant-new');
    });

    it('fails when there is neither a tenant nor a user', async () => {
      const { service } = setup();
      await expect(
        service.create({ tenantId: null, userId: null }, webhookInput, true),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('cannot see a trigger of another tenant', async () => {
      const { service } = setup({ triggers: [webhookRow({ tenant_id: 'tenant-2' })] });
      await expect(service.update('tenant-1', 't1', { name: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.update(null, 't1', { name: 'x' })).rejects.toThrow(NotFoundException);
    });

    it('refuses to change the type', async () => {
      const { service } = setup({ triggers: [webhookRow()] });
      expect(await badRequest(service.update('tenant-1', 't1', { type: 'syslog' }))).toEqual([
        'type cannot be changed',
      ]);
    });

    it('allows resending the same type', async () => {
      const { service } = setup({ triggers: [webhookRow()] });
      await expect(
        service.update('tenant-1', 't1', { type: 'webhook', name: 'New' }, true),
      ).resolves.toBeDefined();
    });

    it('rejects invalid values', async () => {
      const { service, find } = setup({ triggers: [webhookRow()] });
      await expect(service.update('tenant-1', 't1', { max_retries: 99 }, true)).rejects.toThrow(
        BadRequestException,
      );
      expect(find('UPDATE triggers')).toHaveLength(0);
    });

    it('rejects a name used by another trigger but not by itself', async () => {
      const taken = setup({ triggers: [webhookRow()], names: [{ id: 'other' }] });
      expect(
        (await badRequest(taken.service.update('tenant-1', 't1', { name: 'Taken' }, true)))[0],
      ).toContain('already exists');
      const self = setup({ triggers: [webhookRow()], names: [{ id: 't1' }] });
      await expect(
        self.service.update('tenant-1', 't1', { name: 'Hook' }, true),
      ).resolves.toBeDefined();
    });

    it('keeps stored secrets on a partial update and scopes the write to the tenant', async () => {
      const { service, find, dispatch } = setup({ triggers: [webhookRow()] });
      await service.update('tenant-1', 't1', { enabled: false }, true);
      const update = find('UPDATE triggers')[0];
      expect(update.sql).toContain('WHERE id = $1 AND tenant_id = $2');
      expect(update.params.slice(0, 2)).toEqual(['t1', 'tenant-1']);
      expect(update.params[3]).toBe(false);
      const secrets = JSON.parse(decrypt(update.params[5] as string, getEncryptionSecret()));
      expect(secrets).toEqual({
        headers: { Authorization: 'Bearer abcdefghij' },
        hmacSecret: 'topsecret-value',
      });
      expect(dispatch.invalidateBindings).toHaveBeenCalled();
    });

    it('re-checks the webhook destination when the URL changes', async () => {
      const { service, find } = setup({ triggers: [webhookRow()] });
      await expect(
        service.update('tenant-1', 't1', { config: { url: 'http://127.0.0.1/x' } }, false),
      ).rejects.toThrow(BadRequestException);
      expect(find('UPDATE triggers')).toHaveLength(0);
    });
  });

  describe('remove', () => {
    it('deletes inside the tenant and drops the cached bindings', async () => {
      const { service, find, dispatch } = setup({ triggers: [webhookRow()] });
      expect(await service.remove('tenant-1', 't1')).toEqual({ deleted: true });
      const del = find('DELETE FROM triggers')[0];
      expect(del.sql).toContain('tenant_id = $2');
      expect(del.params).toEqual(['t1', 'tenant-1']);
      expect(dispatch.invalidateBindings).toHaveBeenCalled();
    });

    it('does not delete a trigger of another tenant', async () => {
      const { service, find } = setup({ triggers: [webhookRow({ tenant_id: 'tenant-2' })] });
      await expect(service.remove('tenant-1', 't1')).rejects.toThrow(NotFoundException);
      await expect(service.remove(null, 't1')).rejects.toThrow(NotFoundException);
      expect(find('DELETE FROM triggers')).toHaveLength(0);
    });
  });

  describe('test', () => {
    it('queues a test event for that trigger and delivers it now', async () => {
      const { service, dispatch, worker } = setup({
        triggers: [webhookRow()],
        users: [{ email: 'ana@acme.test' }],
      });
      const result = await service.test('tenant-1', 't1', 'user-1', { event_type: 'limit.alert' });
      expect(dispatch.emit).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        eventType: 'limit.alert',
        triggerId: 't1',
        title: 'Test from trigger Hook',
        message: 'This is a test event sent from Thinker by ana@acme.test.',
        vars: { 'actor.email': 'ana@acme.test' },
      });
      expect(worker.deliverNow).toHaveBeenCalledWith('ev1', 'tenant-1');
      expect(result).toMatchObject({ success: true, status_code: 204, error: null });
    });

    it('uses simulated title, message and variables when given', async () => {
      const { service, dispatch } = setup({ triggers: [webhookRow()] });
      await service.test('tenant-1', 't1', null, {
        vars: {
          'event.title': 'Hi',
          'event.message': 'There',
          'rule.id': 'r1',
          'workspace.id': 'x',
        },
      });
      expect(dispatch.emit.mock.calls[0][0]).toMatchObject({
        eventType: 'test',
        title: 'Hi',
        message: 'There',
        vars: { 'rule.id': 'r1' },
      });
    });

    it('rejects an invalid event type before queueing anything', async () => {
      const { service, dispatch } = setup({ triggers: [webhookRow()] });
      await expect(service.test('tenant-1', 't1', null, { event_type: 'nope' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dispatch.emit).not.toHaveBeenCalled();
    });

    it('cannot test a trigger of another tenant', async () => {
      const { service, dispatch } = setup({ triggers: [webhookRow({ tenant_id: 'tenant-2' })] });
      await expect(service.test('tenant-1', 't1', null)).rejects.toThrow(NotFoundException);
      expect(dispatch.emit).not.toHaveBeenCalled();
    });

    it('reports a full queue when the event was not queued', async () => {
      const { service, dispatch, worker } = setup({ triggers: [webhookRow()] });
      dispatch.emit.mockResolvedValue([]);
      const result = await service.test('tenant-1', 't1', null);
      expect(result).toEqual({
        success: false,
        status_code: null,
        error: 'The trigger has too many pending deliveries',
        response: null,
        duration_ms: 0,
      });
      expect(worker.deliverNow).not.toHaveBeenCalled();
    });

    it('reports a full queue when the row could not be claimed', async () => {
      const { service, worker } = setup({ triggers: [webhookRow()] });
      worker.deliverNow.mockResolvedValue(null);
      expect((await service.test('tenant-1', 't1', null)).success).toBe(false);
    });

    it('returns the failure of the delivery', async () => {
      const { service, worker } = setup({ triggers: [webhookRow()] });
      worker.deliverNow.mockResolvedValue({
        success: false,
        statusCode: 500,
        error: 'HTTP 500',
        response: 'boom',
      });
      expect(await service.test('tenant-1', 't1', null)).toMatchObject({
        success: false,
        status_code: 500,
        error: 'HTTP 500',
        response: 'boom',
      });
    });
  });

  describe('bindings', () => {
    const agents = [{ id: 'a1' }];

    it('needs an existing harness of the tenant', async () => {
      const { service, find } = setup({ agents: [] });
      await expect(service.getBindings('tenant-1', 'ghost')).rejects.toThrow(NotFoundException);
      await expect(service.getBindings(null, 'ghost')).rejects.toThrow(NotFoundException);
      expect(find('FROM agents')[0].params).toEqual(['tenant-1', 'ghost']);
      expect(find('FROM agents')[0].sql).toContain('deleted_at IS NULL');
    });

    it('returns the bindings, parsing stored JSON text', async () => {
      const { service } = setup({
        agents,
        bindings: [
          { trigger_id: 't1', events: '["limit.alert"]' },
          { trigger_id: 't2', events: ['request.debug'] },
        ],
      });
      expect(await service.getBindings('tenant-1', 'bot')).toEqual({
        bindings: [
          { trigger_id: 't1', events: ['limit.alert'] },
          { trigger_id: 't2', events: ['request.debug'] },
        ],
      });
    });

    it.each([
      ['no list', {}],
      ['a non-list', { bindings: 'x' }],
      ['an entry without a trigger id', { bindings: [{ events: ['limit.alert'] }] }],
      ['an entry without events', { bindings: [{ trigger_id: 't1' }] }],
      [
        'a workspace event on a harness',
        { bindings: [{ trigger_id: 't1', events: ['harness.created'] }] },
      ],
      ['an unknown event', { bindings: [{ trigger_id: 't1', events: ['x'] }] }],
    ])('rejects %s', async (_label, body) => {
      const { service, ds } = setup({ agents });
      await expect(service.setBindings('tenant-1', 'bot', body)).rejects.toThrow(
        BadRequestException,
      );
      expect(ds.transaction).not.toHaveBeenCalled();
    });

    it('rejects a trigger the tenant does not own', async () => {
      const { service, find, ds } = setup({ agents, knownTriggers: [] });
      expect(
        await badRequest(
          service.setBindings('tenant-1', 'bot', {
            bindings: [{ trigger_id: 'foreign', events: ['limit.alert'] }],
          }),
        ),
      ).toEqual(['unknown trigger']);
      expect(find('FROM triggers WHERE tenant_id')[0].params).toEqual(['tenant-1', ['foreign']]);
      expect(ds.transaction).not.toHaveBeenCalled();
    });

    it('replaces the bindings atomically, de-duplicating triggers and events', async () => {
      const { service, txCalls, dispatch } = setup({
        agents,
        knownTriggers: [{ id: 't1' }, { id: 't2' }],
      });
      const result = await service.setBindings('tenant-1', 'bot', {
        bindings: [
          { trigger_id: 't1', events: ['limit.alert', 'limit.alert', 'limit.block'] },
          { trigger_id: 't1', events: ['request.debug'] },
          { trigger_id: 't2', events: [] },
        ],
      });
      expect(result.bindings).toEqual([
        { trigger_id: 't1', events: ['limit.alert', 'limit.block'] },
        { trigger_id: 't2', events: [] },
      ]);
      expect(txCalls[0].sql).toContain('DELETE FROM agent_triggers');
      expect(txCalls[0].params).toEqual(['a1']);
      expect(txCalls.slice(1).map((c) => c.params.slice(0, 3))).toEqual([
        ['a1', 't1', 'tenant-1'],
        ['a1', 't2', 'tenant-1'],
      ]);
      expect(dispatch.invalidateBindings).toHaveBeenCalledWith('a1');
    });

    it('clears every binding with an empty list, without a trigger lookup', async () => {
      const { service, txCalls, find } = setup({ agents });
      await service.setBindings('tenant-1', 'bot', { bindings: [] });
      expect(txCalls).toHaveLength(1);
      expect(find('FROM triggers WHERE tenant_id')).toHaveLength(0);
    });
  });

  describe('listEvents', () => {
    it('returns nothing without a tenant', async () => {
      const { service, query } = setup();
      expect(await service.listEvents(null, {})).toEqual({ events: [] });
      expect(query).not.toHaveBeenCalled();
    });

    it('always filters by tenant and defaults to 50 newest first', async () => {
      const { service, find } = setup();
      await service.listEvents('tenant-1', {});
      const q = find('FROM trigger_events e')[0];
      expect(q.sql).toContain('e.tenant_id = $1');
      expect(q.sql).toContain('ORDER BY e.created_at DESC');
      expect(q.sql).toContain('LIMIT 50');
      expect(q.params).toEqual(['tenant-1']);
      expect(q.sql).not.toContain('payload');
    });

    it('applies every valid filter as a bound parameter', async () => {
      const { service, find } = setup();
      await service.listEvents('tenant-1', {
        trigger_id: 't1',
        status: 'failed',
        event_type: 'limit.block',
        agent_name: 'bot',
        before: '2026-01-01T00:00:00Z',
        limit: '20',
      });
      const q = find('FROM trigger_events e')[0];
      expect(q.sql).toContain('e.trigger_id = $2');
      expect(q.sql).toContain('e.status = $3');
      expect(q.sql).toContain('e.event_type = $4');
      expect(q.sql).toContain('e.agent_name = $5');
      // Inclusive at the client's millisecond precision: rows sharing the
      // last row's millisecond are not skipped (the client dedupes by id).
      expect(q.sql).toContain("date_trunc('milliseconds', e.created_at) <= $6::timestamptz");
      expect(q.sql).toContain('ORDER BY e.created_at DESC, e.id DESC');
      expect(q.sql).toContain('LIMIT 20');
      expect(q.params).toEqual([
        'tenant-1',
        't1',
        'failed',
        'limit.block',
        'bot',
        '2026-01-01T00:00:00Z',
      ]);
    });

    it('ignores unknown status and event type values and unparseable dates', async () => {
      const { service, find } = setup();
      await service.listEvents('tenant-1', {
        status: "failed' OR 1=1 --",
        event_type: 'nope',
        before: 'not a date',
      });
      expect(find('FROM trigger_events e')[0].params).toEqual(['tenant-1']);
    });

    it.each([
      ['0', 50],
      ['-5', 1],
      ['abc', 50],
      ['5000', 200],
      ['1.9', 1.9],
    ])('limit %s is clamped to %s', async (raw, expected) => {
      const { service, find } = setup();
      await service.listEvents('tenant-1', { limit: raw });
      const m = /LIMIT ([\d.]+)/.exec(find('FROM trigger_events e')[0].sql)!;
      expect(Number(m[1])).toBe(expected);
    });
  });

  describe('getEvent', () => {
    it('is not found without a tenant or for another tenant', async () => {
      const { service, find } = setup({ event: null });
      await expect(service.getEvent(null, 'e1')).rejects.toThrow(NotFoundException);
      await expect(service.getEvent('tenant-1', 'e1')).rejects.toThrow('Event not found');
      expect(find('FROM trigger_events e')[0].params).toEqual(['e1', 'tenant-1']);
      expect(find('FROM trigger_event_logs')).toHaveLength(0);
    });

    it('returns the event with its parsed payload and attempt logs', async () => {
      const { service } = setup({
        event: { id: 'e1', status: 'failed', payload: '{"a":"b"}' },
        logs: [{ id: 'l1', attempt: 1 }],
      });
      expect(await service.getEvent('tenant-1', 'e1')).toEqual({
        event: { id: 'e1', status: 'failed', payload: { a: 'b' } },
        logs: [{ id: 'l1', attempt: 1 }],
      });
    });
  });

  describe('retryEvent', () => {
    it('re-queues only a failed event of an existing trigger in the tenant, and wakes the worker', async () => {
      const { service, find, worker } = setup({ retried: [{ id: 'e1' }] });
      expect(await service.retryEvent('tenant-1', 'e1')).toEqual({ ok: true });
      const q = find('UPDATE trigger_events')[0];
      expect(q.sql).toContain("tenant_id = $2 AND status = 'failed' AND trigger_id IS NOT NULL");
      expect(q.params).toEqual(['e1', 'tenant-1']);
      expect(worker.kick).toHaveBeenCalled();
    });

    it('accepts the [rows, count] driver shape', async () => {
      const { service } = setup({ retried: [[{ id: 'e1' }], 1] });
      expect(await service.retryEvent('tenant-1', 'e1')).toEqual({ ok: true });
    });

    it('refuses when nothing matched (wrong tenant, not failed, trigger gone)', async () => {
      const { service, worker } = setup({ retried: [] });
      await expect(service.retryEvent('tenant-1', 'e1')).rejects.toThrow(BadRequestException);
      expect(worker.kick).not.toHaveBeenCalled();
    });

    it('refuses without a tenant', async () => {
      const { service } = setup({ retried: [] });
      await expect(service.retryEvent(null, 'e1')).rejects.toThrow(BadRequestException);
    });
  });
});
