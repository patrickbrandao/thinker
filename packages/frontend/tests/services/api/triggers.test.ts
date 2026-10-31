import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as triggers from '../../../src/services/api/triggers';

vi.mock('../../../src/services/toast-store.js', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function setupFetch(response: unknown = {}, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => (typeof response === 'string' ? response : JSON.stringify(response)),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const body = (init: unknown) => JSON.parse((init as RequestInit).body as string);

describe('triggers API client', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('listTriggers unwraps the triggers array', async () => {
    const fetchMock = setupFetch({ triggers: [{ id: 't1' }] });
    expect(await triggers.listTriggers()).toEqual([{ id: 't1' }]);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/triggers');
  });

  it('createTrigger POSTs and updateTrigger PATCHes by id', async () => {
    const fetchMock = setupFetch({ id: 't1' });
    await triggers.createTrigger({ name: 'ops', type: 'webhook', secrets: { hmacSecret: null } });
    let [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/triggers');
    expect((init as RequestInit).method).toBe('POST');
    expect(body(init)).toEqual({ name: 'ops', type: 'webhook', secrets: { hmacSecret: null } });

    await triggers.updateTrigger('a/b', { enabled: false });
    [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/v1/triggers/a%2Fb');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(body(init)).toEqual({ enabled: false });
  });

  it('deleteTrigger, testTrigger and retryTriggerEvent hit their endpoints', async () => {
    const fetchMock = setupFetch({ success: true });
    await triggers.deleteTrigger('t1');
    await triggers.testTrigger('t1');
    await triggers.retryTriggerEvent('e1');
    expect(fetchMock.mock.calls.map(([u, i]) => `${(i as RequestInit).method} ${u}`)).toEqual([
      'DELETE /api/v1/triggers/t1',
      'POST /api/v1/triggers/t1/test',
      'POST /api/v1/triggers/events/e1/retry',
    ]);
  });

  it('testTrigger sends the simulated event as JSON', async () => {
    const fetchMock = setupFetch({ success: true });
    await triggers.testTrigger('t1', {
      event_type: 'limit.block',
      vars: { 'harness.name': 'bot' },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(body(init)).toEqual({ event_type: 'limit.block', vars: { 'harness.name': 'bot' } });
  });

  it('listTriggerEvents sends filters, the cursor and a default limit', async () => {
    const fetchMock = setupFetch({ events: [] });
    await triggers.listTriggerEvents({ status: 'failed', before: '2026-10-01T00:00:00.000Z' });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/api/v1/triggers/events');
    expect(url.searchParams.get('status')).toBe('failed');
    expect(url.searchParams.get('before')).toBe('2026-10-01T00:00:00.000Z');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('trigger_id')).toBe(false);
  });

  it('getTriggerEvent reads one event', async () => {
    const fetchMock = setupFetch({ event: { id: 'e1' }, logs: [] });
    const out = await triggers.getTriggerEvent('e1');
    expect(out.event.id).toBe('e1');
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/triggers/events/e1');
  });

  it('reads and replaces the bindings of a harness', async () => {
    const bindings = [{ trigger_id: 't1', events: ['limit.alert'] }];
    const fetchMock = setupFetch({ bindings });
    expect(await triggers.getHarnessTriggers('my agent')).toEqual(bindings);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/agents/my%20agent/triggers');

    expect(await triggers.setHarnessTriggers('my agent', bindings as never)).toEqual(bindings);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/v1/agents/my%20agent/triggers');
    expect((init as RequestInit).method).toBe('PUT');
    expect(body(init)).toEqual({ bindings });
  });

  it('rejects with the joined 400 messages', async () => {
    setupFetch({ message: ['url must be a URL', 'name is required'] }, 400);
    await expect(triggers.createTrigger({ name: '' })).rejects.toThrow(
      'url must be a URL, name is required',
    );
  });
});
