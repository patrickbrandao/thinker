import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as notifications from '../../../src/services/api/notifications';

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

describe('notifications API client', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('getNotificationLogs forwards agent_name as a query param', async () => {
    const fetchMock = setupFetch([]);
    await notifications.getNotificationLogs('demo');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/notifications/logs');
    expect(url).toContain('agent_name=demo');
  });

  it('getNotificationRules forwards agent_name as a query param', async () => {
    const fetchMock = setupFetch([]);
    await notifications.getNotificationRules('demo');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/notifications');
    expect(url).toContain('agent_name=demo');
  });

  it('createNotificationRule POSTs the rule payload', async () => {
    const fetchMock = setupFetch({});
    await notifications.createNotificationRule({
      agent_name: 'demo',
      metric_type: 'cost',
      threshold: 10,
      period: 'day',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/notifications');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      agent_name: 'demo',
      metric_type: 'cost',
      threshold: 10,
      period: 'day',
    });
  });

  it('updateNotificationRule PATCHes by id', async () => {
    const fetchMock = setupFetch({});
    await notifications.updateNotificationRule('rule-1', { is_active: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/notifications/rule-1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ is_active: false });
  });

  it('deleteNotificationRule DELETEs by id', async () => {
    const fetchMock = setupFetch({});
    await notifications.deleteNotificationRule('rule-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/notifications/rule-1');
    expect((init as RequestInit).method).toBe('DELETE');
  });
});
