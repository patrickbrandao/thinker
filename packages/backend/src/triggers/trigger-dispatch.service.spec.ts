import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { ThinkerRuntimeService } from '../common/services/thinker-runtime.service';
import { MAX_PENDING_PER_TRIGGER, TriggerDispatchService } from './trigger-dispatch.service';

type Row = Record<string, unknown>;

interface Fixture {
  /** Rows returned for the agent_triggers binding lookup. */
  bindings?: Row[];
  /** Rows returned for the workspace-event trigger lookup. */
  workspaceTriggers?: Row[];
  /** Rows returned for the targets query. */
  targets?: Row[];
  meta?: Row[];
}

function setup(fixture: Fixture = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM agent_triggers')) return fixture.bindings ?? [];
    if (sql.includes('workspace_events ?')) return fixture.workspaceTriggers ?? [];
    if (sql.includes('FROM tenants t')) return fixture.meta ?? [];
    if (sql.includes('SELECT t.id, t.name, t.type')) return fixture.targets ?? [];
    return [];
  });
  const runtime = {
    getAuthBaseUrl: () => 'https://thinker.example.com',
  } as unknown as ThinkerRuntimeService;
  const service = new TriggerDispatchService({ query } as unknown as DataSource, runtime);
  const sqlCalls = (needle: string) => calls.filter((c) => c.sql.includes(needle));
  return { service, query, calls, sqlCalls };
}

const target = (id: string, pending = 0) => ({
  id,
  name: `trigger ${id}`,
  type: 'webhook',
  pending,
});

describe('TriggerDispatchService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('urls', () => {
    it('builds harness and request links on the public base URL, encoded', () => {
      const { service } = setup();
      expect(service.harnessUrl('my agent/1')).toBe(
        'https://thinker.example.com/harnesses/my%20agent%2F1',
      );
      expect(service.requestUrl('req 1')).toBe('https://thinker.example.com/requests/req%201');
    });
  });

  describe('isSubscribed / binding cache', () => {
    const bindings = [
      { trigger_id: 't1', events: ['limit.block', 'request.debug'] },
      { trigger_id: 't2', events: '["provider.failure"]' },
    ];

    it('answers from the bindings, parsing events stored as JSON text', async () => {
      const { service } = setup({ bindings });
      expect(await service.isSubscribed('a1', 'limit.block')).toBe(true);
      expect(await service.isSubscribed('a1', 'provider.failure')).toBe(true);
      expect(await service.isSubscribed('a1', 'credential.expired')).toBe(false);
    });

    it('only considers enabled triggers in the binding query', async () => {
      const { service, sqlCalls } = setup({ bindings });
      await service.isSubscribed('a1', 'limit.block');
      expect(sqlCalls('FROM agent_triggers')[0].sql).toContain('t.enabled = true');
      expect(sqlCalls('FROM agent_triggers')[0].params).toEqual(['a1']);
    });

    it('caches bindings per harness for 30 seconds', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
      const { service, sqlCalls } = setup({ bindings });
      await service.isSubscribed('a1', 'limit.block');
      await service.isSubscribed('a1', 'request.debug');
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(1);

      await service.isSubscribed('a2', 'limit.block');
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(2);

      jest.advanceTimersByTime(29_000);
      await service.isSubscribed('a1', 'limit.block');
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(2);

      jest.advanceTimersByTime(2_000);
      await service.isSubscribed('a1', 'limit.block');
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(3);
    });

    it('invalidates one harness or all of them', async () => {
      const { service, sqlCalls } = setup({ bindings });
      await service.isSubscribed('a1', 'limit.block');
      await service.isSubscribed('a2', 'limit.block');
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(2);

      service.invalidateBindings('a1');
      await service.isSubscribed('a1', 'limit.block');
      await service.isSubscribed('a2', 'limit.block');
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(3);

      service.invalidateBindings();
      await service.isSubscribed('a1', 'limit.block');
      await service.isSubscribed('a2', 'limit.block');
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(5);
    });

    it('propagates a database failure instead of caching it', async () => {
      const { service, query } = setup({ bindings });
      query.mockRejectedValueOnce(new Error('db down'));
      await expect(service.isSubscribed('a1', 'limit.block')).rejects.toThrow('db down');
      expect(await service.isSubscribed('a1', 'limit.block')).toBe(true);
    });
  });

  describe('emit', () => {
    const base = {
      tenantId: 'tenant-1',
      agentId: 'a1',
      agentName: 'bot',
      title: 'Title',
      message: 'Message',
    };

    it('queues nothing when the harness has no binding for the event', async () => {
      const { service, sqlCalls } = setup({
        bindings: [{ trigger_id: 't1', events: ['limit.alert'] }],
      });
      expect(await service.emit({ ...base, eventType: 'limit.block' })).toEqual([]);
      expect(sqlCalls('INSERT INTO trigger_events')).toHaveLength(0);
    });

    it('queues nothing for a harness event without a harness', async () => {
      const { service, query } = setup();
      expect(await service.emit({ ...base, agentId: undefined, eventType: 'limit.block' })).toEqual(
        [],
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('queues one row per subscribed trigger, scoped to the tenant', async () => {
      const { service, sqlCalls } = setup({
        bindings: [
          { trigger_id: 't1', events: ['limit.block'] },
          { trigger_id: 't2', events: ['limit.block'] },
          { trigger_id: 't3', events: ['limit.alert'] },
        ],
        targets: [target('t1'), target('t2')],
        meta: [{ workspace_name: 'Acme', display_name: 'The Bot', agent_name: 'bot' }],
      });
      const ids = await service.emit({ ...base, eventType: 'limit.block' });
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);

      const targetQuery = sqlCalls('SELECT t.id, t.name, t.type')[0];
      expect(targetQuery.sql).toContain('t.tenant_id = $1');
      expect(targetQuery.sql).toContain('AND t.enabled = true');
      expect(targetQuery.params).toEqual(['tenant-1', ['t1', 't2']]);

      const inserts = sqlCalls('INSERT INTO trigger_events');
      expect(inserts).toHaveLength(2);
      const [
        id,
        tenantId,
        triggerId,
        triggerName,
        triggerType,
        agentId,
        agentName,
        eventType,
        raw,
      ] = inserts[0].params as string[];
      expect([id, tenantId, triggerId, triggerName, triggerType]).toEqual([
        ids[0],
        'tenant-1',
        't1',
        'trigger t1',
        'webhook',
      ]);
      expect([agentId, agentName, eventType]).toEqual(['a1', 'bot', 'limit.block']);
      const vars = JSON.parse(raw);
      expect(vars).toMatchObject({
        'event.type': 'limit.block',
        'event.title': 'Title',
        'event.message': 'Message',
        'workspace.id': 'tenant-1',
        'workspace.name': 'Acme',
        'harness.id': 'a1',
        'harness.name': 'bot',
        'harness.display_name': 'The Bot',
        'harness.url': 'https://thinker.example.com/harnesses/bot',
      });
      expect(vars['event.id']).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(vars['event.timestamp']))).toBe(false);
    });

    it('lets the caller variables and display name override the defaults', async () => {
      const { service, sqlCalls } = setup({
        bindings: [{ trigger_id: 't1', events: ['limit.alert'] }],
        targets: [target('t1')],
        meta: [{ workspace_name: 'Acme', display_name: 'Old', agent_name: 'bot' }],
      });
      await service.emit({
        ...base,
        eventType: 'limit.alert',
        displayName: 'Deleted Bot',
        vars: { 'rule.id': 'r1', 'workspace.name': 'Override' },
      });
      const vars = JSON.parse(sqlCalls('INSERT INTO trigger_events')[0].params[8] as string);
      expect(vars['harness.display_name']).toBe('Deleted Bot');
      expect(vars['rule.id']).toBe('r1');
      expect(vars['workspace.name']).toBe('Override');
    });

    it('falls back to the agent row name when the signal carries none', async () => {
      const { service, sqlCalls } = setup({
        bindings: [{ trigger_id: 't1', events: ['limit.alert'] }],
        targets: [target('t1')],
        meta: [{ workspace_name: null, display_name: null, agent_name: 'from-db' }],
      });
      await service.emit({ ...base, agentName: undefined, eventType: 'limit.alert' });
      const params = sqlCalls('INSERT INTO trigger_events')[0].params as string[];
      expect(params[6]).toBe('from-db');
      const vars = JSON.parse(params[8]);
      expect(vars['harness.display_name']).toBe('from-db');
      expect(vars['workspace.name']).toBe('');
    });

    it('routes workspace events through the triggers that subscribed, for that tenant only', async () => {
      const { service, sqlCalls } = setup({
        workspaceTriggers: [{ id: 't9' }],
        targets: [target('t9')],
      });
      const ids = await service.emit({
        tenantId: 'tenant-1',
        eventType: 'harness.created',
        title: 'x',
        message: 'y',
      });
      expect(ids).toHaveLength(1);
      const lookup = sqlCalls('workspace_events ?')[0];
      expect(lookup.sql).toContain('tenant_id = $1');
      expect(lookup.sql).toContain('enabled = true');
      expect(lookup.params).toEqual(['tenant-1', 'harness.created']);
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(0);
    });

    it('queues nothing for a workspace event nobody subscribed to', async () => {
      const { service, sqlCalls } = setup({ workspaceTriggers: [] });
      expect(
        await service.emit({
          tenantId: 't',
          eventType: 'harness.deleted',
          title: 'x',
          message: 'y',
        }),
      ).toEqual([]);
      expect(sqlCalls('INSERT INTO trigger_events')).toHaveLength(0);
    });

    it('a test emit targets one trigger even if disabled, skips bindings and does not kick the worker', async () => {
      const { service, sqlCalls } = setup({ targets: [target('t5')] });
      const onQueued = jest.fn();
      service.setQueuedListener(onQueued);
      const ids = await service.emit({
        tenantId: 'tenant-1',
        eventType: 'test',
        triggerId: 't5',
        title: 'x',
        message: 'y',
      });
      expect(ids).toHaveLength(1);
      const targetQuery = sqlCalls('SELECT t.id, t.name, t.type')[0];
      expect(targetQuery.sql).not.toContain('AND t.enabled = true');
      expect(targetQuery.sql).toContain('t.tenant_id = $1');
      expect(targetQuery.params).toEqual(['tenant-1', ['t5']]);
      expect(sqlCalls('FROM agent_triggers')).toHaveLength(0);
      expect(onQueued).not.toHaveBeenCalled();
    });

    it('a test emit for a trigger of another tenant queues nothing', async () => {
      // The tenant filter in the targets query returns no row for a foreign id.
      const { service, sqlCalls } = setup({ targets: [] });
      const ids = await service.emit({
        tenantId: 'tenant-1',
        eventType: 'test',
        triggerId: 'foreign',
        title: 'x',
        message: 'y',
      });
      expect(ids).toEqual([]);
      expect(sqlCalls('INSERT INTO trigger_events')).toHaveLength(0);
    });

    it('tells the worker about new rows so it does not wait for the poll', async () => {
      const { service } = setup({
        bindings: [{ trigger_id: 't1', events: ['limit.alert'] }],
        targets: [target('t1')],
      });
      const onQueued = jest.fn();
      service.setQueuedListener(onQueued);
      await service.emit({ ...base, eventType: 'limit.alert' });
      expect(onQueued).toHaveBeenCalledTimes(1);
    });

    it('does not kick the worker when every row was dropped', async () => {
      const { service } = setup({
        bindings: [{ trigger_id: 't1', events: ['limit.alert'] }],
        targets: [target('t1', MAX_PENDING_PER_TRIGGER)],
      });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const onQueued = jest.fn();
      service.setQueuedListener(onQueued);
      expect(await service.emit({ ...base, eventType: 'limit.alert' })).toEqual([]);
      expect(onQueued).not.toHaveBeenCalled();
    });

    it('drops events for a trigger at the pending cap but keeps queueing the others', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service, sqlCalls } = setup({
        bindings: [
          { trigger_id: 't1', events: ['limit.alert'] },
          { trigger_id: 't2', events: ['limit.alert'] },
        ],
        targets: [target('t1', MAX_PENDING_PER_TRIGGER), target('t2', MAX_PENDING_PER_TRIGGER - 1)],
      });
      const ids = await service.emit({ ...base, eventType: 'limit.alert' });
      expect(ids).toHaveLength(1);
      expect(sqlCalls('INSERT INTO trigger_events')[0].params[2]).toBe('t2');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('trigger t1');
    });

    it('throttles the drop warning to once a minute and reports the dropped count', async () => {
      jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { service } = setup({
        bindings: [{ trigger_id: 't1', events: ['limit.alert'] }],
        targets: [target('t1', MAX_PENDING_PER_TRIGGER)],
      });
      await service.emit({ ...base, eventType: 'limit.alert' });
      await service.emit({ ...base, eventType: 'limit.alert' });
      await service.emit({ ...base, eventType: 'limit.alert' });
      expect(warn).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(60_000);
      await service.emit({ ...base, eventType: 'limit.alert' });
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[1][0]).toContain('dropped 3 new event(s)');
    });

    it('stops at the first failed insert and surfaces the error', async () => {
      const { service, query } = setup({
        bindings: [{ trigger_id: 't1', events: ['limit.alert'] }],
        targets: [target('t1')],
      });
      const original = query.getMockImplementation()!;
      query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO trigger_events')) throw new Error('insert failed');
        return original(sql, params);
      });
      await expect(service.emit({ ...base, eventType: 'limit.alert' })).rejects.toThrow(
        'insert failed',
      );
    });
  });
});
