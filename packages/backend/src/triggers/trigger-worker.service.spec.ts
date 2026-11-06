import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { encrypt, getEncryptionSecret } from '../common/utils/crypto.util';
import { currentOutboundScope, type OutboundScope } from '../common/outbound/outbound-proxy';
import type { ProxyEgressService } from '../proxy-servers/proxy-egress.service';
import type { TriggerDispatchService } from './trigger-dispatch.service';
import { deliver, type DeliveryInput, type DeliveryResult } from './trigger-senders';
import { TriggerWorkerService, decryptSecrets } from './trigger-worker.service';

jest.mock('./trigger-senders', () => ({ deliver: jest.fn() }));
const deliverMock = deliver as jest.MockedFunction<typeof deliver>;

const OK: DeliveryResult = { success: true, statusCode: 200, error: null, response: 'ok' };
const FAIL: DeliveryResult = { success: false, statusCode: 500, error: 'HTTP 500', response: 'no' };

interface TriggerFixture {
  id?: string;
  name?: string;
  type?: string;
  enabled?: boolean;
  config?: unknown;
  secrets_encrypted?: string | null;
  max_retries?: number;
  retry_delay_seconds?: number;
  timeout_seconds?: number;
}

const trigger = (over: TriggerFixture = {}) => ({
  id: 'trig-1',
  name: 'Hook',
  type: 'webhook',
  enabled: true,
  config: { url: 'http://x' },
  secrets_encrypted: null,
  max_retries: 3,
  retry_delay_seconds: 30,
  timeout_seconds: 10,
  ...over,
});

const queueRow = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  tenant_id: 'tenant-1',
  trigger_id: 'trig-1',
  event_type: 'limit.block',
  payload: { 'event.title': 'T' } as Record<string, string> | string,
  attempts: 0,
  ...over,
});

interface Setup {
  trigger?: ReturnType<typeof trigger> | null;
  claimed?: unknown;
  ownerEmail?: string | null;
}

function setup(opts: Setup = {}, withEgress = false, config: Record<string, string> = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const state = { trigger: opts.trigger === undefined ? trigger() : opts.trigger };
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM triggers WHERE id')) return state.trigger ? [state.trigger] : [];
    if (sql.includes('RETURNING id, tenant_id')) return opts.claimed ?? [];
    if (sql.includes('FROM tenants t')) return [{ email: opts.ownerEmail ?? null }];
    return [];
  });
  const dispatch = { setQueuedListener: jest.fn() } as unknown as TriggerDispatchService;
  const configService = {
    get: (key: string, fallback?: string) => config[key] ?? fallback,
  } as unknown as ConfigService;
  const scopeForTarget = jest.fn(
    async (tenantId: string, _t: string, id: string, label: string): Promise<OutboundScope> => ({
      tenantId,
      sourceType: 'trigger',
      sourceId: id,
      sourceLabel: label,
      chain: null,
      hops: [],
    }),
  );
  const egress = withEgress ? ({ scopeForTarget } as unknown as ProxyEgressService) : undefined;
  const worker = new TriggerWorkerService(
    { query } as unknown as DataSource,
    dispatch,
    configService,
    egress,
  );
  const find = (needle: string) => calls.filter((c) => c.sql.includes(needle));
  return { worker, query, calls, find, state, dispatch, scopeForTarget };
}

describe('decryptSecrets', () => {
  it('returns no secrets for an empty value', () => {
    expect(decryptSecrets(null)).toEqual({});
    expect(decryptSecrets('')).toEqual({});
  });

  it('round-trips encrypted secrets', () => {
    const stored = encrypt(
      JSON.stringify({ apiKey: 'k', headers: { A: 'b' } }),
      getEncryptionSecret(),
    );
    expect(decryptSecrets(stored)).toEqual({ apiKey: 'k', headers: { A: 'b' } });
  });

  it('throws on garbage instead of returning partial secrets', () => {
    expect(() => decryptSecrets('not-encrypted')).toThrow();
  });
});

describe('TriggerWorkerService', () => {
  beforeEach(() => {
    deliverMock.mockReset();
    deliverMock.mockResolvedValue(OK);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('registers for new rows, polls every 10 s and stops on destroy', async () => {
      jest.useFakeTimers();
      const { worker, dispatch, query } = setup();
      worker.onApplicationBootstrap();
      expect(dispatch.setQueuedListener).toHaveBeenCalledTimes(1);

      // the bootstrap kick runs after the 250 ms coalescing delay
      await jest.advanceTimersByTimeAsync(250);
      const afterKick = query.mock.calls.length;
      expect(afterKick).toBeGreaterThan(0);

      await jest.advanceTimersByTimeAsync(10_000);
      expect(query.mock.calls.length).toBeGreaterThan(afterKick);

      worker.onModuleDestroy();
      const afterDestroy = query.mock.calls.length;
      await jest.advanceTimersByTimeAsync(60_000);
      expect(query.mock.calls.length).toBe(afterDestroy);
    });

    it('the listener given to the dispatcher kicks the worker', async () => {
      jest.useFakeTimers();
      const { worker, dispatch, query } = setup();
      worker.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(250); // bootstrap kick done
      query.mockClear();
      const listener = (dispatch.setQueuedListener as jest.Mock).mock.calls[0][0] as () => void;
      listener();
      await jest.advanceTimersByTimeAsync(250);
      expect(query).toHaveBeenCalled();
      worker.onModuleDestroy();
    });

    it('coalesces a burst of kicks into one run', async () => {
      jest.useFakeTimers();
      const { worker, find } = setup();
      worker.kick();
      worker.kick();
      worker.kick();
      await jest.advanceTimersByTimeAsync(249);
      expect(find('FOR UPDATE SKIP LOCKED')).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(find('FOR UPDATE SKIP LOCKED')).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(find('FOR UPDATE SKIP LOCKED')).toHaveLength(1);
    });

    it('a destroyed worker never runs a pending kick', async () => {
      jest.useFakeTimers();
      const { worker, find } = setup();
      worker.kick();
      worker.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(1000);
      expect(find('FOR UPDATE SKIP LOCKED')).toHaveLength(0);
    });

    it('uses the configured sender address, then the notification address, as the e-mail default', async () => {
      const a = setup({ claimed: [] }, false, { 'app.emailFrom': 'ops@acme.test' });
      const b = setup({}, false, {});
      deliverMock.mockClear();
      await a.worker.process(queueRow() as never);
      await b.worker.process(queueRow() as never);
      expect(deliverMock.mock.calls[0][0].defaultFrom).toBe('ops@acme.test');
      expect(deliverMock.mock.calls[1][0].defaultFrom).toBe('noreply@thinker.example.com');
    });
  });

  describe('run (queue claiming)', () => {
    it('claims due pending rows and stale deliveries with SKIP LOCKED, in batches of 50', async () => {
      const { worker, find } = setup({ claimed: [] });
      await worker.run();
      const claim = find('FOR UPDATE SKIP LOCKED')[0].sql;
      expect(claim).toContain("status = 'pending' AND next_attempt_at <= NOW()");
      expect(claim).toContain(
        "status = 'delivering' AND updated_at < NOW() - INTERVAL '5 minutes'",
      );
      expect(claim).toContain('LIMIT 50');
      expect(claim).toContain("SET status = 'delivering'");
    });

    it('delivers every claimed row and accepts the [rows, count] driver result shape', async () => {
      const rows = [queueRow({ id: 'a' }), queueRow({ id: 'b' })];
      const { worker, find } = setup({ claimed: [rows, 2] });
      await worker.run();
      expect(deliverMock).toHaveBeenCalledTimes(2);
      expect(
        find('INSERT INTO trigger_event_logs')
          .map((c) => c.params[1])
          .sort(),
      ).toEqual(['a', 'b']);
    });

    it('delivers at most 10 rows at a time', async () => {
      const rows = Array.from({ length: 25 }, (_, i) => queueRow({ id: `r${i}` }));
      const { worker } = setup({ claimed: rows });
      let inFlight = 0;
      let peak = 0;
      deliverMock.mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return OK;
      });
      await worker.run();
      expect(deliverMock).toHaveBeenCalledTimes(25);
      expect(peak).toBe(10);
    });

    it('keeps claiming while a batch comes back full', async () => {
      const full = Array.from({ length: 50 }, (_, i) => queueRow({ id: `r${i}` }));
      const { worker, query } = setup();
      let claims = 0;
      const original = query.getMockImplementation()!;
      query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('RETURNING id, tenant_id')) return ++claims === 1 ? full : [];
        return original(sql, params);
      });
      await worker.run();
      expect(claims).toBe(2);
      expect(deliverMock).toHaveBeenCalledTimes(50);
    });

    it('a run requested while one is active is coalesced into one extra pass', async () => {
      const { worker, query } = setup();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let claims = 0;
      const original = query.getMockImplementation()!;
      query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('RETURNING id, tenant_id')) {
          claims++;
          if (claims === 1) await gate;
          return [];
        }
        return original(sql, params);
      });
      const first = worker.run();
      const second = worker.run();
      const third = worker.run();
      await Promise.all([second, third]); // both return immediately
      expect(claims).toBe(1);
      release();
      await first;
      expect(claims).toBe(2); // one extra pass, not two
    });

    it('logs a failed run and is able to run again', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const { worker, query } = setup();
      const original = query.getMockImplementation()!;
      let fail = true;
      query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('RETURNING id, tenant_id') && fail) throw new Error('db down');
        return original(sql, params);
      });
      await expect(worker.run()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('db down'));
      fail = false;
      query.mockClear();
      await worker.run();
      expect(query).toHaveBeenCalled();
    });

    it('a row whose result cannot be recorded is logged and does not stop its batch neighbours', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const { worker, query, find } = setup({
        claimed: [queueRow({ id: 'a' }), queueRow({ id: 'b' })],
      });
      const original = query.getMockImplementation()!;
      query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes("SET status = 'delivered'") && params?.[0] === 'a') {
          throw new Error('write failed');
        }
        return original(sql, params);
      });
      await worker.run();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('write failed'));
      expect(find("SET status = 'delivered'").map((c) => c.params[0])).toContain('b');
    });
  });

  describe('process', () => {
    it('delivers, logs the attempt and marks the event delivered', async () => {
      const { worker, find } = setup();
      const result = await worker.process(queueRow() as never);
      expect(result).toEqual(OK);

      const log = find('INSERT INTO trigger_event_logs')[0].params;
      expect(log[1]).toBe('ev-1');
      expect(log[2]).toBe('tenant-1');
      expect(log[3]).toBe(1); // attempt
      expect(log[6]).toBe(true);
      expect(log[7]).toBe(200);
      expect(log[8]).toBeNull();
      expect(log[9]).toBe('ok');

      const update = find("SET status = 'delivered'")[0];
      expect(update.params).toEqual(['ev-1', 1]);
      expect(find("SET status = 'pending'")).toHaveLength(0);
      expect(find("SET status = 'failed'")).toHaveLength(0);
    });

    it('looks the trigger up inside the event tenant', async () => {
      const { worker, find } = setup();
      await worker.process(queueRow() as never);
      const lookup = find('FROM triggers WHERE id')[0];
      expect(lookup.sql).toContain('tenant_id = $2');
      expect(lookup.params).toEqual(['trig-1', 'tenant-1']);
    });

    it('passes the decrypted secrets, rendered variables and the timeout to the sender', async () => {
      const secrets = encrypt(JSON.stringify({ hmacSecret: 'shh-shh-shh' }), getEncryptionSecret());
      const { worker } = setup({
        trigger: trigger({
          secrets_encrypted: secrets,
          timeout_seconds: 7,
          config: JSON.stringify({ url: 'http://hook' }),
        }),
      });
      await worker.process(queueRow({ attempts: 2, payload: JSON.stringify({ a: 'b' }) }) as never);
      const input = deliverMock.mock.calls[0][0] as DeliveryInput;
      expect(input.type).toBe('webhook');
      expect(input.config).toEqual({ url: 'http://hook' });
      expect(input.secrets).toEqual({ hmacSecret: 'shh-shh-shh' });
      expect(input.timeoutMs).toBe(7000);
      expect(input.eventType).toBe('limit.block');
      expect(input.vars).toEqual({ a: 'b', 'trigger.name': 'Hook', 'delivery.attempt': '3' });
    });

    describe('retry and give-up', () => {
      it('reschedules a failure with the trigger retry delay while retries remain', async () => {
        deliverMock.mockResolvedValue(FAIL);
        const { worker, find } = setup({
          trigger: trigger({ max_retries: 3, retry_delay_seconds: 45 }),
        });
        await worker.process(queueRow({ attempts: 0 }) as never);
        const update = find("SET status = 'pending'")[0];
        expect(update.sql).toContain("next_attempt_at = NOW() + ($4::int * INTERVAL '1 second')");
        expect(update.params).toEqual(['ev-1', 1, 'HTTP 500', 45]);
        expect(find("SET status = 'failed'")).toHaveLength(0);
      });

      it('allows 1 + max_retries attempts in total, then gives up', async () => {
        deliverMock.mockResolvedValue(FAIL);
        const t = trigger({ max_retries: 2 });
        for (const [attempts, expected] of [
          [0, 'pending'],
          [1, 'pending'],
          [2, 'failed'], // third attempt = 1 + 2 retries
        ] as const) {
          const { worker, find } = setup({ trigger: t });
          await worker.process(queueRow({ attempts }) as never);
          expect(find(`SET status = '${expected}'`)).toHaveLength(1);
        }
      });

      it('with max_retries 0 a failure is final on the first attempt', async () => {
        deliverMock.mockResolvedValue(FAIL);
        const { worker, find } = setup({ trigger: trigger({ max_retries: 0 }) });
        await worker.process(queueRow() as never);
        const update = find("SET status = 'failed'")[0];
        expect(update.params).toEqual(['ev-1', 1, 'HTTP 500']);
        expect(update.sql).toContain('next_attempt_at = NULL');
      });

      it('raises trigger.failed once a delivery gives up, never about itself or recursively', async () => {
        deliverMock.mockResolvedValue(FAIL);
        const record = jest.fn();
        const { query, dispatch } = setup({ trigger: trigger({ max_retries: 0 }) });
        const worker = new TriggerWorkerService(
          { query } as unknown as DataSource,
          dispatch,
          { get: (_k: string, f?: string) => f } as unknown as ConfigService,
          undefined,
          { record } as never,
        );
        await worker.process(queueRow() as never);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toMatchObject({
          type: 'trigger.failed',
          entityId: 'trig-1',
          excludeTriggerId: 'trig-1',
        });
        await worker.process(queueRow({ event_type: 'trigger.failed' }) as never);
        await worker.process(queueRow({ event_type: 'test' }) as never);
        expect(record).toHaveBeenCalledTimes(1);
      });

      it('a retry that finally succeeds is marked delivered with the cumulative attempt count', async () => {
        const { worker, find } = setup();
        await worker.process(queueRow({ attempts: 2 }) as never);
        expect(find("SET status = 'delivered'")[0].params).toEqual(['ev-1', 3]);
        expect(find('INSERT INTO trigger_event_logs')[0].params[3]).toBe(3);
      });

      it('records every failed attempt in the delivery log', async () => {
        deliverMock.mockResolvedValue(FAIL);
        const { worker, find } = setup();
        await worker.process(queueRow() as never);
        const log = find('INSERT INTO trigger_event_logs')[0].params;
        expect(log.slice(6, 10)).toEqual([false, 500, 'HTTP 500', 'no']);
      });

      it('a sender that throws becomes a failed attempt, never an exception', async () => {
        deliverMock.mockRejectedValue(new Error('socket hang up'));
        const { worker, find } = setup();
        const result = await worker.process(queueRow() as never);
        expect(result).toEqual({
          success: false,
          statusCode: null,
          error: 'socket hang up',
          response: null,
        });
        expect(find("SET status = 'pending'")[0].params[2]).toBe('socket hang up');
      });

      it('a non-Error throw is stringified', async () => {
        deliverMock.mockRejectedValue('boom');
        const { worker } = setup();
        expect((await worker.process(queueRow() as never)).error).toBe('boom');
      });

      it('unreadable stored secrets fail the attempt without calling the sender', async () => {
        const { worker, find } = setup({ trigger: trigger({ secrets_encrypted: 'garbage' }) });
        const result = await worker.process(queueRow() as never);
        expect(result.success).toBe(false);
        expect(deliverMock).not.toHaveBeenCalled();
        expect(find("SET status = 'pending'")).toHaveLength(1);
      });

      it('a database failure while recording the result propagates to the caller', async () => {
        const { worker, query } = setup();
        const original = query.getMockImplementation()!;
        query.mockImplementation(async (sql: string, params?: unknown[]) => {
          if (sql.includes("SET status = 'delivered'")) throw new Error('write failed');
          return original(sql, params);
        });
        await expect(worker.process(queueRow() as never)).rejects.toThrow('write failed');
      });
    });

    describe('trigger state', () => {
      it('fails for good when the trigger was deleted', async () => {
        const { worker, find } = setup({ trigger: null });
        const result = await worker.process(queueRow() as never);
        expect(result.error).toBe('Trigger was deleted');
        expect(deliverMock).not.toHaveBeenCalled();
        expect(find("SET status = 'failed'")[0].params).toEqual(['ev-1', 1, 'Trigger was deleted']);
        expect(find("SET status = 'pending'")).toHaveLength(0);
      });

      it('fails for good, without a lookup, when the row has no trigger', async () => {
        const { worker, find } = setup();
        const result = await worker.process(queueRow({ trigger_id: null }) as never);
        expect(result.error).toBe('Trigger was deleted');
        expect(find('FROM triggers WHERE id')).toHaveLength(0);
        expect(find("SET status = 'failed'")).toHaveLength(1);
      });

      it('fails for good when the trigger is disabled', async () => {
        const { worker, find } = setup({ trigger: trigger({ enabled: false, max_retries: 5 }) });
        const result = await worker.process(queueRow() as never);
        expect(result.error).toBe('Trigger is disabled');
        expect(deliverMock).not.toHaveBeenCalled();
        expect(find("SET status = 'failed'")).toHaveLength(1);
      });

      it('still delivers a test event through a disabled trigger', async () => {
        const { worker, find } = setup({ trigger: trigger({ enabled: false }) });
        await worker.process(queueRow({ event_type: 'test' }) as never);
        expect(deliverMock).toHaveBeenCalledTimes(1);
        expect(find("SET status = 'delivered'")).toHaveLength(1);
      });

      it('delivers through a disabled trigger when the attempt is manual', async () => {
        const { worker } = setup({ trigger: trigger({ enabled: false }) });
        await worker.process(queueRow() as never, true);
        expect(deliverMock).toHaveBeenCalledTimes(1);
      });
    });

    describe('egress', () => {
      it('sends webhook deliveries through the trigger proxy scope and logs the hops', async () => {
        const { worker, find, scopeForTarget } = setup({}, true);
        const hops = [
          {
            kind: 'proxy',
            proxy_id: 'p1',
            name: 'Proxy',
            position: 1,
            result: 'ok',
            ms: 5,
            tunnel_ms: 2,
            status: 200,
          },
        ];
        scopeForTarget.mockImplementation(async (tenantId, _t, id, label) => ({
          tenantId,
          sourceType: 'trigger',
          sourceId: id,
          sourceLabel: label,
          chain: [],
          hops: hops as never,
        }));
        let seen: OutboundScope | null = null;
        deliverMock.mockImplementation(async () => {
          seen = currentOutboundScope();
          return OK;
        });
        await worker.process(queueRow() as never);
        expect(scopeForTarget).toHaveBeenCalledWith('tenant-1', 'trigger', 'trig-1', 'Hook');
        expect(seen).not.toBeNull();
        const log = find('INSERT INTO trigger_event_logs')[0].params;
        expect(JSON.parse(log[10] as string)).toEqual({
          kind: 'proxy',
          proxy_id: 'p1',
          name: 'Proxy',
        });
        expect(JSON.parse(log[11] as string)).toEqual(hops);
      });

      it('does not use a proxy scope for syslog, which is not HTTP', async () => {
        const { worker, scopeForTarget, find } = setup(
          { trigger: trigger({ type: 'syslog', config: { host: 'h' } }) },
          true,
        );
        await worker.process(queueRow() as never);
        expect(scopeForTarget).not.toHaveBeenCalled();
        const log = find('INSERT INTO trigger_event_logs')[0].params;
        expect(log[10]).toBeNull();
        expect(log[11]).toBeNull();
      });

      it('works without the proxy module and logs no egress', async () => {
        const { worker, find } = setup({}, false);
        await worker.process(queueRow() as never);
        const log = find('INSERT INTO trigger_event_logs')[0].params;
        expect(log[10]).toBeNull();
        expect(log[11]).toBeNull();
      });

      it('resolves the e-mail fallback recipient from the event tenant owner', async () => {
        const { worker, find } = setup({ ownerEmail: 'owner@acme.test' });
        deliverMock.mockImplementation(async (input) => {
          expect(await input.fallbackRecipient()).toBe('owner@acme.test');
          return OK;
        });
        await worker.process(queueRow() as never);
        const lookup = find('FROM tenants t')[0];
        expect(lookup.params).toEqual(['tenant-1']);
        expect(lookup.sql).toContain("om.role = 'owner'");
      });

      it('returns no fallback recipient when the tenant has no e-mail', async () => {
        const { worker } = setup({ ownerEmail: null });
        deliverMock.mockImplementation(async (input) => {
          expect(await input.fallbackRecipient()).toBeNull();
          return OK;
        });
        await worker.process(queueRow() as never);
        expect.assertions(1);
      });
    });
  });

  describe('deliverNow (test button)', () => {
    it('claims only a pending row of the given tenant and delivers it', async () => {
      const { worker, find } = setup({ claimed: [queueRow()] });
      const result = await worker.deliverNow('ev-1', 'tenant-1');
      expect(result).toEqual(OK);
      const claim = find('RETURNING id, tenant_id')[0];
      expect(claim.sql).toContain("id = $1 AND tenant_id = $2 AND status = 'pending'");
      expect(claim.params).toEqual(['ev-1', 'tenant-1']);
    });

    it('returns null when there is nothing to claim (foreign tenant or already taken)', async () => {
      const { worker } = setup({ claimed: [] });
      expect(await worker.deliverNow('ev-1', 'other-tenant')).toBeNull();
      expect(deliverMock).not.toHaveBeenCalled();
    });

    it('accepts the [rows, count] driver result shape', async () => {
      const { worker } = setup({ claimed: [[queueRow()], 1] });
      expect(await worker.deliverNow('ev-1', 'tenant-1')).toEqual(OK);
    });

    it('delivers even if the trigger is disabled (manual attempt)', async () => {
      const { worker } = setup({ claimed: [queueRow()], trigger: trigger({ enabled: false }) });
      expect(await worker.deliverNow('ev-1', 'tenant-1')).toEqual(OK);
    });
  });
});
