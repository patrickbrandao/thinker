import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  TriggerSignalService,
  type TriggerSignal,
} from '../common/services/trigger-signal.service';
import type { EmitInput, TriggerDispatchService } from './trigger-dispatch.service';
import { PROVIDER_FAILURE_WINDOW_MS, TriggerListenerService } from './trigger-listener.service';

type Row = Record<string, unknown>;

const facts = (over: Row = {}): Row => ({
  status: 'success',
  error_message: null,
  error_http_status: null,
  error_origin: null,
  requested_model: 'gpt-x',
  duration_ms: 1234,
  model: 'gpt-x-real',
  provider: 'openai',
  routing_tier: 'simple',
  input_tokens: '10',
  output_tokens: 5,
  cost_usd: '0.0123',
  ...over,
});

const failedFacts = (over: Row = {}) =>
  facts({
    status: 'error',
    error_message: 'upstream 502',
    error_http_status: 502,
    error_origin: 'provider',
    ...over,
  });

interface Setup {
  subscribed?: string[];
  requestFacts?: Row | null;
  agents?: Row[];
  users?: Row[];
}

function setup(opts: Setup = {}) {
  const subscribed = new Set(opts.subscribed ?? []);
  const emitted: EmitInput[] = [];
  const dispatch = {
    isSubscribed: jest.fn(async (_agentId: string, event: string) => subscribed.has(event)),
    emit: jest.fn(async (input: EmitInput) => {
      emitted.push(input);
      return ['id'];
    }),
    requestUrl: (id: string) => `https://t.example/requests/${id}`,
  };
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const factsFixture = { current: opts.requestFacts === undefined ? facts() : opts.requestFacts };
  const ds = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM requests r'))
        return factsFixture.current ? [factsFixture.current] : [];
      if (sql.includes('FROM agents')) return opts.agents ?? [];
      if (sql.includes('FROM "user"')) return opts.users ?? [];
      return [];
    }),
  };
  const signals = new TriggerSignalService();
  const listener = new TriggerListenerService(
    signals,
    dispatch as unknown as TriggerDispatchService,
    ds as unknown as DataSource,
  );
  return { listener, signals, dispatch, ds, emitted, calls, subscribed, factsFixture };
}

const request = (
  over: Partial<Extract<TriggerSignal, { kind: 'request' }>> = {},
): TriggerSignal => ({
  kind: 'request',
  tenantId: 'tenant-1',
  agentId: 'a1',
  agentName: 'bot',
  requestId: 'req-1',
  ...over,
});

const attempt = (
  over: Partial<Extract<TriggerSignal, { kind: 'attempt' }>> = {},
): TriggerSignal => ({
  kind: 'attempt',
  tenantId: 'tenant-1',
  agentId: 'a1',
  agentName: 'bot',
  tenantProviderId: 'conn-1',
  provider: 'openai',
  keyLabel: 'prod',
  ok: false,
  httpStatus: 401,
  errorCode: null,
  errorMessage: 'bad key',
  ...over,
});

/** Runs a request signal through the 2 s settle delay. */
async function handleRequest(listener: TriggerListenerService, signal: TriggerSignal = request()) {
  const pending = listener.handle(signal);
  await jest.advanceTimersByTimeAsync(2_000);
  await pending;
}

describe('TriggerListenerService', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') }));
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('subscription', () => {
    it('handles signals published after init', async () => {
      const { listener, signals, emitted } = setup({
        agents: [{ id: 'a1' }],
      });
      listener.onModuleInit();
      signals.emit({
        kind: 'limit',
        tenantId: 'tenant-1',
        agentName: 'bot',
        alertType: 'soft',
        ruleId: 'r1',
        metric: 'tokens',
        threshold: 100,
        actual: 120,
        period: 'day',
        periodStart: 's',
        periodEnd: 'e',
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(emitted).toHaveLength(1);
      expect(emitted[0].eventType).toBe('limit.alert');
      listener.onModuleDestroy();
    });

    it('logs a failing handler instead of throwing into the publisher, and keeps listening', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const { listener, signals, ds, emitted } = setup({ agents: [{ id: 'a1' }] });
      ds.query.mockRejectedValueOnce(new Error('db down'));
      listener.onModuleInit();
      const limit = {
        kind: 'limit',
        tenantId: 'tenant-1',
        agentName: 'bot',
        alertType: 'soft',
        ruleId: 'r1',
        metric: 'cost',
        threshold: 1,
        actual: 2,
        period: 'day',
        periodStart: 's',
        periodEnd: 'e',
      } as const;
      expect(() => signals.emit(limit)).not.toThrow();
      await jest.advanceTimersByTimeAsync(0);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('limit failed: db down'));
      signals.emit(limit);
      await jest.advanceTimersByTimeAsync(0);
      expect(emitted).toHaveLength(1);
      listener.onModuleDestroy();
    });

    it('stops handling signals after destroy', async () => {
      const { listener, signals, ds } = setup();
      listener.onModuleInit();
      listener.onModuleDestroy();
      signals.emit({
        kind: 'harness',
        tenantId: 't',
        action: 'created',
        agentId: 'a',
        agentName: 'n',
        displayName: 'N',
        userId: 'u',
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(ds.query).not.toHaveBeenCalled();
    });

    it('destroy before init is harmless', () => {
      const { listener } = setup();
      expect(() => listener.onModuleDestroy()).not.toThrow();
    });
  });

  describe('request signals', () => {
    it('does no work for a harness with no request.debug or provider.failure binding', async () => {
      const { listener, ds, dispatch } = setup({ subscribed: ['limit.block'] });
      await listener.handle(request());
      expect(ds.query).not.toHaveBeenCalled();
      expect(dispatch.emit).not.toHaveBeenCalled();
    });

    it('waits for the request rows to settle before reading them, scoped to the tenant', async () => {
      const { listener, calls } = setup({ subscribed: ['request.debug'] });
      const pending = listener.handle(request());
      await jest.advanceTimersByTimeAsync(1_999);
      expect(calls).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      await pending;
      expect(calls[0].params).toEqual(['req-1', 'tenant-1']);
      expect(calls[0].sql).toContain('r.id = $1 AND r.tenant_id = $2');
    });

    it('does nothing when the request row is gone', async () => {
      const { listener, dispatch } = setup({ subscribed: ['request.debug'], requestFacts: null });
      await handleRequest(listener);
      expect(dispatch.emit).not.toHaveBeenCalled();
    });

    it('emits request.debug for a successful request with its variables', async () => {
      const { listener, emitted } = setup({ subscribed: ['request.debug'] });
      await handleRequest(listener);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        tenantId: 'tenant-1',
        eventType: 'request.debug',
        agentId: 'a1',
        agentName: 'bot',
        title: 'bot: request gpt-x-real',
      });
      expect(emitted[0].message).toBe(
        'openai answered gpt-x-real in 1234 ms, 15 tokens, $0.012300.',
      );
      expect(emitted[0].vars).toEqual({
        'request.id': 'req-1',
        'request.status': 'success',
        'request.model': 'gpt-x-real',
        'request.requested_model': 'gpt-x',
        'request.provider': 'openai',
        'request.tier': 'simple',
        'request.input_tokens': '10',
        'request.output_tokens': '5',
        'request.tokens': '15',
        'request.cost': '0.012300',
        'request.latency_ms': '1234',
        'request.error': '',
        'request.http_status': '',
        'request.url': 'https://t.example/requests/req-1',
      });
    });

    it('emits request.debug for a failed request with the error', async () => {
      const { listener, emitted } = setup({
        subscribed: ['request.debug'],
        requestFacts: failedFacts({ model: null, provider: null }),
      });
      await handleRequest(listener);
      expect(emitted[0].title).toBe('bot: failed request gpt-x');
      expect(emitted[0].message).toBe('Request failed (error): upstream 502.');
      expect(emitted[0].vars).toMatchObject({
        'request.error': 'upstream 502',
        'request.http_status': '502',
      });
    });

    it('formats a request with no cost or tokens', async () => {
      const { listener, emitted } = setup({
        subscribed: ['request.debug'],
        requestFacts: facts({
          cost_usd: null,
          input_tokens: null,
          output_tokens: null,
          provider: null,
        }),
      });
      await handleRequest(listener);
      expect(emitted[0].message).toBe('provider answered gpt-x-real in 1234 ms, 0 tokens, $0.');
      expect(emitted[0].vars!['request.cost']).toBe('');
    });

    it('does not emit request.debug when only provider.failure is subscribed', async () => {
      const { listener, emitted } = setup({
        subscribed: ['provider.failure'],
        requestFacts: failedFacts(),
      });
      await handleRequest(listener);
      expect(emitted.map((e) => e.eventType)).toEqual(['provider.failure']);
    });

    it('does not emit provider.failure for a success', async () => {
      const { listener, emitted } = setup({ subscribed: ['provider.failure'] });
      await handleRequest(listener);
      expect(emitted).toEqual([]);
    });

    it.each(['client', 'thinker', 'auth', null])(
      'does not emit provider.failure for a failure caused by %s',
      async (origin) => {
        const { listener, emitted } = setup({
          subscribed: ['provider.failure'],
          requestFacts: failedFacts({ error_origin: origin }),
        });
        await handleRequest(listener);
        expect(emitted).toEqual([]);
      },
    );

    it.each(['provider', 'transport'])(
      'emits provider.failure when the %s is at fault',
      async (origin) => {
        const { listener, emitted } = setup({
          subscribed: ['provider.failure'],
          requestFacts: failedFacts({ error_origin: origin }),
        });
        await handleRequest(listener);
        expect(emitted).toHaveLength(1);
        expect(emitted[0].title).toBe('bot: provider failure (openai)');
        expect(emitted[0].message).toBe('All routes failed for a request to gpt-x: upstream 502.');
        expect(emitted[0].vars).toMatchObject({ 'failure.count': '1', 'request.id': 'req-1' });
      },
    );

    it('emits both events when both are subscribed and a provider failed', async () => {
      const { listener, emitted } = setup({
        subscribed: ['request.debug', 'provider.failure'],
        requestFacts: failedFacts(),
      });
      await handleRequest(listener);
      expect(emitted.map((e) => e.eventType)).toEqual(['request.debug', 'provider.failure']);
    });

    it('limits provider.failure to one per harness and provider per window, then reports the count', async () => {
      const { listener, emitted } = setup({
        subscribed: ['provider.failure'],
        requestFacts: failedFacts(),
      });
      await handleRequest(listener);
      await handleRequest(listener);
      await handleRequest(listener);
      expect(emitted).toHaveLength(1);

      // The window is measured from the notice; the settle delays count too.
      await jest.advanceTimersByTimeAsync(PROVIDER_FAILURE_WINDOW_MS);
      await handleRequest(listener);
      expect(emitted).toHaveLength(2);
      expect(emitted[1].vars!['failure.count']).toBe('3');
      expect(emitted[1].message).toContain('(3 failures since the last notice)');

      // The counter restarts after each notice.
      await jest.advanceTimersByTimeAsync(PROVIDER_FAILURE_WINDOW_MS);
      await handleRequest(listener);
      expect(emitted[2].vars!['failure.count']).toBe('1');
      expect(emitted[2].message).not.toContain('since the last notice');
    });

    it('tracks the failure window per harness and per provider', async () => {
      const { listener, emitted, factsFixture } = setup({
        subscribed: ['provider.failure'],
        requestFacts: failedFacts(),
      });
      await handleRequest(listener, request({ agentId: 'a1' }));
      await handleRequest(listener, request({ agentId: 'a2' }));
      factsFixture.current = failedFacts({ provider: 'anthropic' });
      await handleRequest(listener, request({ agentId: 'a1' }));
      expect(emitted).toHaveLength(3);
    });
  });

  describe('attempt signals (credential.expired)', () => {
    it('emits credential.expired when a subscribed harness gets a 401', async () => {
      const { listener, emitted } = setup({ subscribed: ['credential.expired'] });
      await listener.handle(attempt());
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        tenantId: 'tenant-1',
        eventType: 'credential.expired',
        agentId: 'a1',
        title: 'Credential rejected: openai "prod"',
      });
      expect(emitted[0].message).toContain('with HTTP 401');
      expect(emitted[0].vars).toEqual({
        'connection.id': 'conn-1',
        'connection.provider': 'openai',
        'connection.label': 'prod',
        'connection.http_status': '401',
        'connection.error': 'bad key',
      });
    });

    it('also reacts to a 403, and copes with missing provider and label', async () => {
      const { listener, emitted } = setup({ subscribed: ['credential.expired'] });
      await listener.handle(attempt({ httpStatus: 403, provider: null, keyLabel: null }));
      expect(emitted[0].title).toBe('Credential rejected: provider');
      expect(emitted[0].message).toContain('The provider rejected the connection with HTTP 403');
    });

    it.each([200, 400, 404, 429, 500, null])('ignores HTTP status %s', async (httpStatus) => {
      const { listener, emitted } = setup({ subscribed: ['credential.expired'] });
      await listener.handle(attempt({ httpStatus }));
      expect(emitted).toEqual([]);
    });

    it('ignores a Thinker error code carrying a synthetic 401', async () => {
      const { listener, emitted } = setup({ subscribed: ['credential.expired'] });
      await listener.handle(attempt({ errorCode: 'M100' }));
      expect(emitted).toEqual([]);
    });

    it('ignores attempts with no connection', async () => {
      const { listener, dispatch } = setup({ subscribed: ['credential.expired'] });
      await listener.handle(attempt({ tenantProviderId: null }));
      expect(dispatch.isSubscribed).not.toHaveBeenCalled();
    });

    it('ignores harnesses that did not subscribe', async () => {
      const { listener, emitted } = setup({ subscribed: [] });
      await listener.handle(attempt());
      expect(emitted).toEqual([]);
    });

    it('reports a connection once until it succeeds again', async () => {
      const { listener, emitted } = setup({ subscribed: ['credential.expired'] });
      await listener.handle(attempt());
      await listener.handle(attempt());
      expect(emitted).toHaveLength(1);

      await listener.handle(attempt({ tenantProviderId: 'conn-2' }));
      expect(emitted).toHaveLength(2);

      await listener.handle(attempt({ ok: true, httpStatus: 200 }));
      await listener.handle(attempt());
      expect(emitted).toHaveLength(3);
    });

    it('does not mark a connection as reported when the harness is not subscribed', async () => {
      const { listener, emitted, subscribed } = setup();
      await listener.handle(attempt());
      subscribed.add('credential.expired');
      await listener.handle(attempt());
      expect(emitted).toHaveLength(1);
    });
  });

  describe('limit signals', () => {
    const limit = (
      over: Partial<Extract<TriggerSignal, { kind: 'limit' }>> = {},
    ): TriggerSignal => ({
      kind: 'limit',
      tenantId: 'tenant-1',
      agentName: 'bot',
      alertType: 'soft',
      ruleId: 'r1',
      metric: 'cost',
      threshold: 10,
      actual: 12.345,
      period: 'month',
      periodStart: '2026-01-01',
      periodEnd: '2026-02-01',
      ...over,
    });

    it('looks the harness up by name inside the tenant, ignoring deleted harnesses', async () => {
      const { listener, calls } = setup({ agents: [{ id: 'a1' }] });
      await listener.handle(limit());
      expect(calls[0].sql).toContain('tenant_id = $1 AND name = $2 AND deleted_at IS NULL');
      expect(calls[0].params).toEqual(['tenant-1', 'bot']);
    });

    it('emits nothing for an unknown harness', async () => {
      const { listener, dispatch } = setup({ agents: [] });
      await listener.handle(limit());
      expect(dispatch.emit).not.toHaveBeenCalled();
    });

    it('emits limit.alert for a soft limit with dollar values', async () => {
      const { listener, emitted } = setup({ agents: [{ id: 'a1' }] });
      await listener.handle(limit());
      expect(emitted[0]).toMatchObject({
        tenantId: 'tenant-1',
        eventType: 'limit.alert',
        agentId: 'a1',
        agentName: 'bot',
        title: 'bot exceeded the cost threshold',
      });
      expect(emitted[0].message).toBe(
        'bot used $12.35 this month, over the $10.00 threshold. Requests are still being processed.',
      );
      expect(emitted[0].vars).toEqual({
        'rule.id': 'r1',
        'rule.metric': 'cost',
        'rule.threshold': '10',
        'rule.period': 'month',
        'value.actual': '12.345',
        'period.start': '2026-01-01',
        'period.end': '2026-02-01',
        'period.reset': '',
      });
    });

    it('emits limit.block for a hard limit with token values and the reset time', async () => {
      const { listener, emitted } = setup({ agents: [{ id: 'a1' }] });
      await listener.handle(
        limit({
          alertType: 'hard',
          metric: 'tokens',
          threshold: 1000,
          actual: 1000.4,
          period: 'day',
          periodReset: '2026-01-02T00:00:00Z',
        }),
      );
      expect(emitted[0].eventType).toBe('limit.block');
      expect(emitted[0].title).toBe('bot has been blocked');
      expect(emitted[0].message).toContain('limit per day (1000 tokens).');
      expect(emitted[0].message).toContain(
        'blocked until the period resets on 2026-01-02T00:00:00Z.',
      );
      expect(emitted[0].vars!['period.reset']).toBe('2026-01-02T00:00:00Z');
    });

    it('formats the hard-limit message for a cost limit', async () => {
      const { listener, emitted } = setup({ agents: [{ id: 'a1' }] });
      await listener.handle(limit({ alertType: 'hard', threshold: 10, actual: 10.5 }));
      expect(emitted[0].message).toBe(
        'bot reached the $10.00 cost limit per month ($10.50). New requests are blocked until the period resets.',
      );
    });

    it('does not repeat the unit in the hard-limit message of a tokens limit', async () => {
      const { listener, emitted } = setup({ agents: [{ id: 'a1' }] });
      await listener.handle(
        limit({
          alertType: 'hard',
          metric: 'tokens',
          threshold: 1000,
          actual: 1000,
          period: 'day',
        }),
      );
      expect(emitted[0].message).toContain('reached the 1000 tokens limit per day');
    });

    it('omits the reset clause when none is known', async () => {
      const { listener, emitted } = setup({ agents: [{ id: 'a1' }] });
      await listener.handle(limit({ alertType: 'hard' }));
      expect(emitted[0].message).toMatch(/until the period resets\.$/);
    });
  });

  describe('harness signals', () => {
    const harness = (
      over: Partial<Extract<TriggerSignal, { kind: 'harness' }>> = {},
    ): TriggerSignal => ({
      kind: 'harness',
      tenantId: 'tenant-1',
      action: 'created',
      agentId: 'a1',
      agentName: 'bot',
      displayName: 'The Bot',
      userId: 'u1',
      ...over,
    });

    it('emits harness.created with the acting user', async () => {
      const { listener, emitted, calls } = setup({ users: [{ email: 'ana@acme.test' }] });
      await listener.handle(harness());
      expect(calls[0].params).toEqual(['u1']);
      expect(emitted[0]).toMatchObject({
        tenantId: 'tenant-1',
        eventType: 'harness.created',
        agentId: 'a1',
        agentName: 'bot',
        displayName: 'The Bot',
        title: 'Harness The Bot created',
        message: 'The harness The Bot (bot) was created by ana@acme.test.',
        vars: { 'actor.email': 'ana@acme.test' },
      });
    });

    it('emits harness.deleted without an actor when there is no user', async () => {
      const { listener, emitted, ds } = setup();
      await listener.handle(harness({ action: 'deleted', userId: null }));
      expect(ds.query).not.toHaveBeenCalled();
      expect(emitted[0].eventType).toBe('harness.deleted');
      expect(emitted[0].message).toBe('The harness The Bot (bot) was deleted.');
      expect(emitted[0].vars).toEqual({ 'actor.email': '' });
    });

    it('omits the actor when the user row has no e-mail', async () => {
      const { listener, emitted } = setup({ users: [{ email: null }] });
      await listener.handle(harness());
      expect(emitted[0].message).toBe('The harness The Bot (bot) was created.');
    });
  });
});
