import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSession, getSessions } from '../../../src/services/api/sessions';

vi.mock('../../../src/services/toast-store.js', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function setupFetch(response: unknown = {}, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('sessions API client', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getSessions GETs /sessions with the filters as a query string', async () => {
    const fetchMock = setupFetch({ items: [], has_more: false });
    const res = await getSessions({ range: '7d', agent_name: 'demo', limit: '25', offset: '50' });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/api/v1/sessions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      range: '7d',
      agent_name: 'demo',
      limit: '25',
      offset: '50',
    });
    expect(res).toEqual({ items: [], has_more: false });
  });

  it('getSessions omits empty and undefined filters', async () => {
    const fetchMock = setupFetch({ items: [], has_more: false });
    await getSessions({ range: '24h', agent_name: '', limit: undefined });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect([...url.searchParams.keys()]).toEqual(['range']);
  });

  it('getSessions is never served from the SWR cache', async () => {
    const fetchMock = setupFetch({ items: [], has_more: false });
    await getSessions({ range: '24h' });
    await getSessions({ range: '24h' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('getSession url-encodes the id', async () => {
    const fetchMock = setupFetch({ id: 'a/b c' });
    await getSession('a/b c#1');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/sessions/a%2Fb%20c%231');
  });

  it('getSession sends the active organization header and is never cached', async () => {
    localStorage.setItem('thinker.activeOrganization', 'org-7');
    const fetchMock = setupFetch({ id: 's1' });
    await getSession('s1');
    await getSession('s1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['X-Thinker-Organization']).toBe('org-7');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });

  it('surfaces a server error as a rejected promise', async () => {
    setupFetch({ message: 'Not found' }, 404);
    await expect(getSession('missing')).rejects.toThrow();
  });
});
