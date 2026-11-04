import { OpencodeOauthService } from './opencode-oauth.service';
import { ProviderService } from '../../routing-core/provider.service';
import { mockSubscriptionCredentialLock } from '../__tests__/mock-subscription-lock';
import { __resetOAuthRefreshCoordinator } from '../core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetchMock = jest.fn() as jest.Mock<Promise<any>>;
// The Console config read after login is fire-and-forget; keep it off the sequenced mock.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const configFetchMock = jest.fn() as jest.Mock<Promise<any>>;
global.fetch = ((url: string, init?: RequestInit) =>
  String(url).endsWith('/console/api/v2/config')
    ? configFetchMock(url, init)
    : fetchMock(url, init)) as typeof fetch;

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const bodyOf = (init?: RequestInit) => JSON.parse(init?.body as string) as Record<string, unknown>;

// What the OpenCode 2.2.5 client sends on every Console call.
const CLIENT_UA = 'opencode/latest/2.2.5/cli';
const consoleHeaders = { accept: 'application/json', 'user-agent': CLIENT_UA };

describe('OpencodeOauthService', () => {
  let service: OpencodeOauthService;
  let upsertProvider: jest.Mock;
  let getFreshSubscriptionCredential: jest.Mock;
  let discoveryService: { discoverModels: jest.Mock };
  let dateNowSpy: jest.SpyInstance<number, []>;
  const now = 1_760_000_000_000;

  beforeEach(() => {
    __resetOAuthRefreshCoordinator();
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    upsertProvider = jest.fn().mockResolvedValue({ provider: {}, isNew: true });
    getFreshSubscriptionCredential = jest.fn().mockResolvedValue(null);
    const providerService = {
      upsertProvider,
      nextOAuthLabel: jest.fn().mockResolvedValue(undefined),
      getFreshSubscriptionCredential,
      withSubscriptionCredentialLock: mockSubscriptionCredentialLock({
        getFreshSubscriptionCredential,
        upsertProvider,
      }),
    } as unknown as ProviderService;
    discoveryService = { discoverModels: jest.fn().mockResolvedValue([]) };
    service = new OpencodeOauthService(providerService, discoveryService as never);
    fetchMock.mockReset();
    configFetchMock.mockReset().mockResolvedValue(jsonResponse(200, {}));
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  let clock = now;
  const advance = (ms: number) => {
    clock += ms;
    dateNowSpy.mockReturnValue(clock);
  };

  const start = async () => {
    clock = now;
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://opencode.ai/console/auth/device/code');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ ...consoleHeaders, 'content-type': 'application/json' });
      // Same body, same key order as the client.
      expect(init?.body).toBe('{"client_id":"opencode-cli","supports_org_scope":true}');
      return jsonResponse(200, {
        device_code: 'dev-1',
        user_code: 'ABCD-EFGH',
        verification_uri_complete: 'device?code=ABCD-EFGH',
        expires_in: 900,
        interval: 5,
      });
    });
    return service.startAuthorization('agent-1', 'tenant-1', 'user-1');
  };

  /** The Console's account lookups the client runs after a successful poll. */
  const mockAccount = (orgs: Array<{ id: string; name: string }>) => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toEqual({ ...consoleHeaders, authorization: 'Bearer acc-1' });
      if (url === 'https://opencode.ai/console/api/user') {
        return jsonResponse(200, { id: 'usr-1', email: 'a@b.c' });
      }
      if (url === 'https://opencode.ai/console/api/orgs') return jsonResponse(200, orgs);
      throw new Error(`unexpected ${url}`);
    });
  };

  const token = (orgId: string | null) => ({
    access_token: 'acc-1',
    refresh_token: 'ref-1',
    expires_in: 3600,
    org_id: orgId,
  });

  it('starts the device flow and resolves the verification URL against the Console', async () => {
    const result = await start();
    expect(result.userCode).toBe('ABCD-EFGH');
    expect(result.verificationUri).toBe('https://opencode.ai/console/device?code=ABCD-EFGH');
    // The client gives every attempt 10 minutes, whatever expires_in says.
    expect(result.expiresAt).toBe(now + 600_000);
    expect(result.pollIntervalMs).toBe(5000);
    expect(service.getPendingCount()).toBe(1);
  });

  it('fails to start without an interval, like the client', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        device_code: 'd',
        user_code: 'u',
        verification_uri_complete: 'device?code=u',
        expires_in: 600,
      }),
    );
    await expect(service.startAuthorization('agent-1', 'tenant-1')).rejects.toThrow(
      'incomplete device authorization payload',
    );
  });

  it('never polls the Console before the wait, and never twice at once', async () => {
    const { flowId } = await start();
    // Asked right away (a tab back in focus): no upstream call yet.
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'pending',
      pollIntervalMs: 5000,
    });
    advance(3000);
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'pending',
      pollIntervalMs: 2000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    advance(2000);
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = service.pollAuthorization(flowId, 'tenant-1');
    const second = service.pollAuthorization(flowId, 'tenant-1');
    release(jsonResponse(400, { error: 'authorization_pending' }));
    await expect(first).resolves.toEqual({ status: 'pending', pollIntervalMs: 5000 });
    await expect(second).resolves.toEqual({ status: 'pending', pollIntervalMs: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The next wait runs from the reply.
    advance(4999);
    await service.pollAuthorization(flowId, 'tenant-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps polling on authorization_pending and backs off 5s on slow_down', async () => {
    const { flowId } = await start();
    advance(5000);
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'authorization_pending' }));
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'pending',
      pollIntervalMs: 5000,
    });
    advance(5000);
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'slow_down' }));
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'pending',
      pollIntervalMs: 10000,
    });
    // The longer wait sticks.
    advance(5000);
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'pending',
      pollIntervalMs: 5000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stores the token blob with the org id on success', async () => {
    const { flowId } = await start();
    advance(5000);
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://opencode.ai/console/auth/device/token');
      expect(init?.headers).toEqual({ ...consoleHeaders, 'content-type': 'application/json' });
      expect(bodyOf(init)).toEqual({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'dev-1',
        client_id: 'opencode-cli',
      });
      return jsonResponse(200, token('org-1'));
    });
    mockAccount([
      { id: 'org-0', name: 'Alpha' },
      { id: 'org-1', name: 'Beta' },
    ]);
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'success',
    });
    expect(upsertProvider).toHaveBeenCalledWith(
      'agent-1',
      'tenant-1',
      'opencode-go',
      JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now + 5000 + 3_600_000, u: 'org-1' }),
      'subscription',
      undefined,
      undefined,
      'user-1',
    );
    expect(discoveryService.discoverModels).toHaveBeenCalled();
    expect(service.getPendingCount()).toBe(0);
  });

  it('picks the first organization by name when the token names none', async () => {
    const { flowId } = await start();
    advance(5000);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, token(null)));
    mockAccount([
      { id: 'org-z', name: 'Zeta' },
      { id: 'org-b', name: 'Acme' },
      { id: 'org-a', name: 'Acme' },
    ]);
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'success',
    });
    expect(JSON.parse(upsertProvider.mock.calls[0][3] as string).u).toBe('org-a');
  });

  it('fails when the token names an organization the account lacks', async () => {
    const { flowId } = await start();
    advance(5000);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, token('org-9')));
    mockAccount([{ id: 'org-1', name: 'Beta' }]);
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'error',
      message: 'OpenCode organization not found: org-9',
    });
    expect(upsertProvider).not.toHaveBeenCalled();
  });

  it('fails the flow on a terminal device error', async () => {
    const { flowId } = await start();
    advance(5000);
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'access_denied' }));
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'error',
      message: 'OpenCode authorization failed: access_denied',
    });
    expect(upsertProvider).not.toHaveBeenCalled();
  });

  it('rejects a poll from another tenant', async () => {
    const { flowId } = await start();
    const result = await service.pollAuthorization(flowId, 'tenant-2');
    expect(result.status).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('unwrapToken', () => {
    it('returns null for a pasted API key so it is used verbatim', async () => {
      await expect(service.unwrapToken('sk-opencode-key', 'agent-1', 'tenant-1')).resolves.toBe(
        null,
      );
    });

    it('returns a fresh access token without refreshing', async () => {
      const raw = JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now + 3_600_000 });
      await expect(service.unwrapToken(raw, 'agent-1', 'tenant-1')).resolves.toBe('acc-1');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('makes no Console call of its own: the background monitor reads the config', async () => {
      const raw = JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now + 3_600_000, u: 'org-1' });
      await service.unwrapToken(raw, 'agent-1', 'tenant-1', 'Default', 'opencode');
      expect(configFetchMock).not.toHaveBeenCalled();
    });

    it('refreshes a token within 5 minutes of expiry and persists both rotated tokens', async () => {
      const raw = JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now + 299_000, u: 'org-1' });
      getFreshSubscriptionCredential.mockResolvedValue(raw);
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        expect(url).toBe('https://opencode.ai/console/auth/device/token');
        expect(init?.headers).toEqual({ ...consoleHeaders, 'content-type': 'application/json' });
        expect(init?.signal).toBeDefined();
        expect(bodyOf(init)).toEqual({
          grant_type: 'refresh_token',
          refresh_token: 'ref-1',
          client_id: 'opencode-cli',
        });
        return jsonResponse(200, {
          access_token: 'acc-2',
          refresh_token: 'ref-2',
          expires_in: 3600,
        });
      });
      await expect(service.unwrapToken(raw, 'agent-1', 'tenant-1', 'Default')).resolves.toBe(
        'acc-2',
      );
      expect(upsertProvider).toHaveBeenCalledWith(
        null,
        'tenant-1',
        'opencode-go',
        JSON.stringify({ t: 'acc-2', r: 'ref-2', e: now + 3_600_000, u: 'org-1' }),
        'subscription',
        undefined,
        'Default',
      );
    });

    it('returns null when an expired token cannot be refreshed (invalid_grant)', async () => {
      const raw = JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now - 1000 });
      getFreshSubscriptionCredential.mockResolvedValue(raw);
      fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));
      await expect(service.unwrapToken(raw, 'agent-1', 'tenant-1')).resolves.toBe(null);
      expect(service.isSignedOut('ref-1')).toBe(true);
      // A signed-out refresh token is never sent again.
      await expect(service.unwrapToken(raw, 'agent-1', 'tenant-1')).resolves.toBe(null);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps a refresh token after a transient refresh failure', async () => {
      const raw = JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now - 1000 });
      getFreshSubscriptionCredential.mockResolvedValue(raw);
      fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'unavailable' }));
      await expect(service.unwrapToken(raw, 'agent-1', 'tenant-1')).resolves.toBe(null);
      expect(service.isSignedOut('ref-1')).toBe(false);
    });
  });

  describe('readConsoleConfig', () => {
    it('reads the config with the client headers, at most once a minute per login', async () => {
      clock = now;
      dateNowSpy.mockReturnValue(now);
      configFetchMock.mockResolvedValue(jsonResponse(200, {}));
      await expect(service.readConsoleConfig('k', 'acc-1', 'org-1')).resolves.toBe(true);
      await expect(service.readConsoleConfig('k', 'acc-1', 'org-1')).resolves.toBe(false);
      const [url, init] = configFetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://opencode.ai/console/api/v2/config');
      expect(init.headers).toEqual({
        ...consoleHeaders,
        authorization: 'Bearer acc-1',
        'x-org-id': 'org-1',
      });
      advance(59_999);
      await expect(service.readConsoleConfig('k', 'acc-1', 'org-1')).resolves.toBe(false);
      advance(1);
      await expect(service.readConsoleConfig('k', 'acc-1', 'org-1')).resolves.toBe(true);
      expect(configFetchMock).toHaveBeenCalledTimes(2);
      expect(service.consoleConfigReadAt('k')).toBe(now + 60_000);
    });

    it('treats 404 as no config and rejects other failures', async () => {
      configFetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
      await expect(service.readConsoleConfig('a', 'acc', undefined)).resolves.toBe(true);
      configFetchMock.mockResolvedValueOnce(jsonResponse(401, { _tag: 'Unauthorized' }));
      await expect(service.readConsoleConfig('b', 'acc', undefined)).rejects.toThrow('401');
    });

    it('reads the config once right after a login', async () => {
      const { flowId } = await start();
      advance(5000);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, token('org-1')));
      mockAccount([{ id: 'org-1', name: 'Beta' }]);
      configFetchMock.mockResolvedValue(jsonResponse(200, {}));
      await service.pollAuthorization(flowId, 'tenant-1');
      expect(configFetchMock).toHaveBeenCalledTimes(1);
      expect(service.consoleConfigReadAt('tenant-1\u0000org-1')).toBeDefined();
    });
  });

  it('stores a Console login for OpenCode under its own provider', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        device_code: 'dev-2',
        user_code: 'WXYZ',
        verification_uri_complete: 'device?code=WXYZ',
        expires_in: 600,
        interval: 5,
      }),
    );
    const { flowId } = await service.startAuthorization('agent-1', 'tenant-1', null, 'opencode');
    advance(5000);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, token(null)));
    mockAccount([{ id: 'org-1', name: 'Beta' }]);
    await service.pollAuthorization(flowId, 'tenant-1');
    expect(upsertProvider.mock.calls[0][2]).toBe('opencode');
  });

  describe('readGoUsage', () => {
    const raw = JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now + 3_600_000, u: 'org-1' });

    it('reads the three allowance windows with the org header', async () => {
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        expect(url).toBe('https://opencode.ai/zen/go/v1/usage');
        expect(init?.headers).toEqual({
          ...consoleHeaders,
          authorization: 'Bearer acc-1',
          'x-opencode-org-id': 'org-1',
        });
        return jsonResponse(200, {
          usage: {
            rolling: { status: 'ok', percent: 12.5, resetsAt: '2026-11-02T20:00:00Z' },
            weekly: { status: 'rate-limited', percent: 100, resetsAt: '2026-11-09T00:00:00Z' },
          },
        });
      });
      await expect(service.readGoUsage(raw, 'agent-1', 'tenant-1')).resolves.toEqual({
        rolling: { percent: 12.5, limited: false, resetsAt: '2026-11-02T20:00:00Z' },
        weekly: { percent: 100, limited: true, resetsAt: '2026-11-09T00:00:00Z' },
        monthly: null,
      });
    });

    it('has no meter for a pasted API key or a workspace without Go', async () => {
      await expect(service.readGoUsage('sk-oc-key', 'agent-1', 'tenant-1')).resolves.toBeNull();
      fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
      await expect(service.readGoUsage(raw, 'agent-1', 'tenant-1')).resolves.toBeNull();
    });
  });
});
