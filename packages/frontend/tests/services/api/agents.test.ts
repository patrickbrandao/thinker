import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as agents from '../../../src/services/api/agents';

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

describe('agents API client', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('getAgents GETs /agents', async () => {
    const fetchMock = setupFetch([{ agent_name: 'a' }]);
    const out = await agents.getAgents();
    expect(out).toEqual([{ agent_name: 'a' }]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/agents');
    expect(url).not.toContain('includePlayground');
  });

  it('getAgents(true) requests includePlayground so the Playground agent is listed', async () => {
    const fetchMock = setupFetch([{ agent_name: 'a' }]);
    await agents.getAgents(true);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/agents?includePlayground=true');
  });

  it('getAgentInfo unwraps the { agent } envelope', async () => {
    const fetchMock = setupFetch({
      agent: { agent_name: 'a', display_name: 'A', agent_category: null, agent_platform: null },
    });
    const out = await agents.getAgentInfo('a');
    expect(out).toEqual({
      agent_name: 'a',
      display_name: 'A',
      agent_category: null,
      agent_platform: null,
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/agents/a');
  });

  it('getAgentInfo returns null when the envelope is { agent: null }', async () => {
    setupFetch({ agent: null });
    const out = await agents.getAgentInfo('missing');
    expect(out).toBeNull();
  });

  it('getAgentInfo URL-encodes the agent name', async () => {
    const fetchMock = setupFetch({ agent: null });
    await agents.getAgentInfo('my agent');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/agents/my%20agent');
  });

  it('getAgentKey GETs the agent key endpoint', async () => {
    const fetchMock = setupFetch({ keyPrefix: 'mnfst_abc' });
    const out = await agents.getAgentKey('demo');
    expect(out).toEqual({ keyPrefix: 'mnfst_abc' });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/agents/demo/key');
  });

  it('rotateAgentKey POSTs to the rotate endpoint', async () => {
    const fetchMock = setupFetch({ apiKey: 'mnfst_new' });
    const out = await agents.rotateAgentKey('demo');
    expect(out).toEqual({ apiKey: 'mnfst_new' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/agents/demo/rotate-key');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('updateAgent PATCHes the agent with the provided fields', async () => {
    const fetchMock = setupFetch({ ok: true });
    await agents.updateAgent('old', { name: 'new', agent_category: 'cat' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/agents/old');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'new',
      agent_category: 'cat',
    });
  });

  it('renameAgent forwards to updateAgent with { name }', async () => {
    const fetchMock = setupFetch({ ok: true });
    await agents.renameAgent('old', 'new');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/agents/old');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'new' });
  });

  it('deleteAgent DELETEs the agent', async () => {
    const fetchMock = setupFetch({});
    await agents.deleteAgent('demo');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/agents/demo');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('getDuplicatePreview GETs the duplicate-preview endpoint', async () => {
    const fetchMock = setupFetch({
      copied: {
        providers: 1,
        customProviders: 0,
        tierAssignments: 4,
        specificityAssignments: 0,
        modelParams: 0,
      },
      suggested_name: 'demo-copy',
    });
    const out = await agents.getDuplicatePreview('demo');
    expect(out.suggested_name).toBe('demo-copy');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/agents/demo/duplicate-preview');
  });

  it('duplicateAgent POSTs the new name, then opts the copy out of legacy Autofix', async () => {
    const fetchMock = setupFetch({
      agent: { id: '1', name: 'demo-copy', display_name: 'Demo Copy' },
      apiKey: 'mnfst_new',
      copied: {
        providers: 0,
        customProviders: 0,
        tierAssignments: 0,
        specificityAssignments: 0,
        modelParams: 0,
      },
    });
    const out = await agents.duplicateAgent('demo', 'demo-copy');
    expect(out.agent.name).toBe('demo-copy');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/agents/demo/duplicate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ name: 'demo-copy' });
    // Until #16: the duplicate endpoint takes no Autofix field, so the copy is
    // switched off right after it is created.
    const [optOutUrl, optOutInit] = fetchMock.mock.calls[1];
    expect(optOutUrl).toContain('/api/v1/routing/demo-copy/autofix');
    expect((optOutInit as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((optOutInit as RequestInit).body as string)).toEqual({ enabled: false });
  });

  it('duplicateAgent still returns the copy when the Autofix opt-out fails', async () => {
    const created = {
      agent: { id: '1', name: 'demo-copy', display_name: 'Demo Copy' },
      apiKey: 'mnfst_new',
      copied: { providers: 0, tierAssignments: 0, specificityAssignments: 0, modelParams: 0 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => created,
        text: async () => JSON.stringify(created),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'boom' }),
        text: async () => JSON.stringify({ message: 'boom' }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const out = await agents.duplicateAgent('demo', 'demo-copy');
    expect(out.agent.name).toBe('demo-copy');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('createAgent POSTs the create payload', async () => {
    const fetchMock = setupFetch({
      agent: {
        id: 'a-1',
        name: 'new-agent',
        display_name: 'New Agent',
        agent_category: 'coding',
        agent_platform: 'openclaw',
      },
      apiKey: 'mnfst_xxx',
    });
    const out = await agents.createAgent({
      name: 'new-agent',
      agent_category: 'coding',
      agent_platform: 'openclaw',
    });
    expect(out.agent.name).toBe('new-agent');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/agents');
    expect((init as RequestInit).method).toBe('POST');
    // Until #16: every create opts out of the legacy backend Autofix default.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'new-agent',
      agent_category: 'coding',
      agent_platform: 'openclaw',
      autofix_enabled: false,
    });
  });

  it('createAgent always sends autofix_enabled: false, even for a bare name', async () => {
    const fetchMock = setupFetch({ agent: { name: 'my-agent' }, apiKey: 'k' });
    await agents.createAgent({ name: 'my-agent' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ name: 'my-agent', autofix_enabled: false });
  });
});
