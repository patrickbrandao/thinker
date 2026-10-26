import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockToastError = vi.fn();
vi.mock('../../src/services/toast-store.js', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), warning: vi.fn() },
}));

import * as api from '../../src/services/api/virtual-models';
import { ApiError } from '../../src/services/api/core';

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

const call = (fetchMock: ReturnType<typeof vi.fn>) => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
  return {
    url,
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
};

describe('virtual models API client', () => {
  beforeEach(() => {
    mockToastError.mockReset();
    vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the agent-scoped virtual models', async () => {
    const fetchMock = setupFetch([{ id: 'vm-1' }]);
    expect(await api.listVirtualModels('my agent')).toEqual([{ id: 'vm-1' }]);
    expect(call(fetchMock).url).toContain('/api/v1/routing/my%20agent/virtual-models');
  });

  it('creates with the whole body and no toast on failure', async () => {
    const fetchMock = setupFetch({ id: 'vm-new' });
    const input = {
      name: 'deepseek/flash',
      override_route: {
        model: 'deepseek-chat',
        provider: 'deepseek',
        authType: 'api_key' as const,
      },
      fallback_routes: [],
      continue_on_default: true,
      response_mode: 'buffered' as const,
    };
    await api.createVirtualModel('a', input);
    const c = call(fetchMock);
    expect(c.method).toBe('POST');
    expect(c.url).toContain('/routing/a/virtual-models');
    expect(c.body).toEqual(input);

    setupFetch({ message: 'A virtual model named "x" already exists on this agent' }, 409);
    const err = await api.createVirtualModel('a', { name: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toContain('already exists');
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('updates silently by default and toasts when asked', async () => {
    setupFetch({ message: 'boom' }, 400);
    await api.updateVirtualModel('a', 'vm-1', { name: 'n' }).catch(() => undefined);
    expect(mockToastError).not.toHaveBeenCalled();
    const fetchMock = setupFetch({ message: 'boom' }, 400);
    await api
      .updateVirtualModel('a', 'vm-1', { continue_on_default: true }, { silent: false })
      .catch(() => undefined);
    expect(mockToastError).toHaveBeenCalledWith('boom');
    const c = call(fetchMock);
    expect(c.method).toBe('PUT');
    expect(c.url).toContain('/routing/a/virtual-models/vm-1');
    expect(c.body).toEqual({ continue_on_default: true });
  });

  it('toggles, sets the response mode and deletes', async () => {
    let fetchMock = setupFetch({});
    await api.toggleVirtualModel('a', 'vm/1', false);
    expect(call(fetchMock)).toMatchObject({
      method: 'PATCH',
      body: { enabled: false },
    });
    expect(call(fetchMock).url).toContain('/virtual-models/vm%2F1/toggle');

    fetchMock = setupFetch({});
    await api.setVirtualModelResponseMode('a', 'vm-1', 'stream');
    expect(call(fetchMock)).toMatchObject({ method: 'PATCH', body: { response_mode: 'stream' } });
    expect(call(fetchMock).url).toContain('/virtual-models/vm-1/response-mode');

    fetchMock = setupFetch('');
    await api.deleteVirtualModel('a', 'vm-1');
    expect(call(fetchMock).method).toBe('DELETE');
  });

  it('reorders with the full id list', async () => {
    const fetchMock = setupFetch({ ok: true });
    await api.reorderVirtualModels('a', ['b', 'a']);
    const c = call(fetchMock);
    expect(c.url).toContain('/routing/a/virtual-models/reorder');
    expect(c).toMatchObject({ method: 'POST', body: { ids: ['b', 'a'] } });
  });

  it('sets the override with a structured route when the auth type is known', async () => {
    let fetchMock = setupFetch({});
    await api.setVirtualModelOverride('a', 'vm-1', 'gpt-x', 'openai', 'api_key', 'Main');
    expect(call(fetchMock).body).toEqual({
      model: 'gpt-x',
      provider: 'openai',
      authType: 'api_key',
      providerKeyLabel: 'Main',
      route: { provider: 'openai', authType: 'api_key', model: 'gpt-x', keyLabel: 'Main' },
    });
    fetchMock = setupFetch({});
    await api.setVirtualModelOverride('a', 'vm-1', 'gpt-x', 'openai');
    expect(call(fetchMock).body).toEqual({ model: 'gpt-x', provider: 'openai' });
    fetchMock = setupFetch({});
    await api.setVirtualModelOverride('a', 'vm-1', 'gpt-x', 'openai', 'api_key');
    expect(call(fetchMock).body.route).toEqual({
      provider: 'openai',
      authType: 'api_key',
      model: 'gpt-x',
    });
    fetchMock = setupFetch('');
    await api.clearVirtualModelOverride('a', 'vm-1');
    expect(call(fetchMock)).toMatchObject({ method: 'DELETE' });
    expect(call(fetchMock).url).toContain('/virtual-models/vm-1/override');
  });

  it('sets fallbacks, sending routes only when they line up with the models', async () => {
    const route = { provider: 'openai', authType: 'api_key' as const, model: 'm' };
    let fetchMock = setupFetch([]);
    await api.setVirtualModelFallbacks('a', 'vm-1', ['m'], [route]);
    expect(call(fetchMock).body).toEqual({ models: ['m'], routes: [route] });
    fetchMock = setupFetch([]);
    await api.setVirtualModelFallbacks('a', 'vm-1', ['m', 'n'], [route]);
    expect(call(fetchMock).body).toEqual({ models: ['m', 'n'] });
    fetchMock = setupFetch('');
    await api.clearVirtualModelFallbacks('a', 'vm-1');
    expect(call(fetchMock)).toMatchObject({ method: 'DELETE' });
    expect(call(fetchMock).url).toContain('/virtual-models/vm-1/fallbacks');
  });
});
