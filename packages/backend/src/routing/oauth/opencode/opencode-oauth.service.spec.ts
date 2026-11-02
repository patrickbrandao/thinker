import { OpencodeOauthService } from './opencode-oauth.service';
import { ProviderService } from '../../routing-core/provider.service';
import { mockSubscriptionCredentialLock } from '../__tests__/mock-subscription-lock';
import { __resetOAuthRefreshCoordinator } from '../core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetchMock = jest.fn() as jest.Mock<Promise<any>>;
global.fetch = fetchMock;

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const bodyOf = (init?: RequestInit) => JSON.parse(init?.body as string) as Record<string, unknown>;

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
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  const start = async () => {
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://opencode.ai/console/auth/device/code');
      expect(bodyOf(init)).toEqual({ client_id: 'opencode-cli', supports_org_scope: true });
      return jsonResponse(200, {
        device_code: 'dev-1',
        user_code: 'ABCD-EFGH',
        verification_uri_complete: 'device?code=ABCD-EFGH',
        expires_in: 600,
        interval: 5,
      });
    });
    return service.startAuthorization('agent-1', 'tenant-1', 'user-1');
  };

  it('starts the device flow and resolves the verification URL against the Console', async () => {
    const result = await start();
    expect(result.userCode).toBe('ABCD-EFGH');
    expect(result.verificationUri).toBe('https://opencode.ai/console/device?code=ABCD-EFGH');
    expect(result.expiresAt).toBe(now + 600_000);
    expect(result.pollIntervalMs).toBe(5000);
    expect(service.getPendingCount()).toBe(1);
  });

  it('keeps polling on authorization_pending and backs off 5s on slow_down', async () => {
    const { flowId } = await start();
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'authorization_pending' }));
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'pending',
      pollIntervalMs: 5000,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'slow_down' }));
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'pending',
      pollIntervalMs: 10000,
    });
  });

  it('stores the token blob with the org id on success', async () => {
    const { flowId } = await start();
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://opencode.ai/console/auth/device/token');
      expect(bodyOf(init)).toEqual({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'dev-1',
        client_id: 'opencode-cli',
      });
      return jsonResponse(200, {
        access_token: 'acc-1',
        refresh_token: 'ref-1',
        expires_in: 3600,
        org_id: 'org-1',
      });
    });
    await expect(service.pollAuthorization(flowId, 'tenant-1')).resolves.toEqual({
      status: 'success',
    });
    expect(upsertProvider).toHaveBeenCalledWith(
      'agent-1',
      'tenant-1',
      'opencode-go',
      JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now + 3_600_000, u: 'org-1' }),
      'subscription',
      undefined,
      undefined,
      'user-1',
    );
    expect(discoveryService.discoverModels).toHaveBeenCalled();
    expect(service.getPendingCount()).toBe(0);
  });

  it('fails the flow on a terminal device error', async () => {
    const { flowId } = await start();
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

    it('refreshes an expiring token and persists both rotated tokens', async () => {
      const raw = JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now + 10_000, u: 'org-1' });
      getFreshSubscriptionCredential.mockResolvedValue(raw);
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        expect(url).toBe('https://opencode.ai/console/auth/device/token');
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
    });
  });

  it('stores a Console login for OpenCode under its own provider', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        device_code: 'dev-2',
        user_code: 'WXYZ',
        verification_uri_complete: 'device?code=WXYZ',
        expires_in: 600,
      }),
    );
    const { flowId } = await service.startAuthorization('agent-1', 'tenant-1', null, 'opencode');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { access_token: 'acc', refresh_token: 'ref', expires_in: 3600 }),
    );
    await service.pollAuthorization(flowId, 'tenant-1');
    expect(upsertProvider.mock.calls[0][2]).toBe('opencode');
  });

  describe('readGoUsage', () => {
    const raw = JSON.stringify({ t: 'acc-1', r: 'ref-1', e: now + 3_600_000, u: 'org-1' });

    it('reads the three allowance windows with the org header', async () => {
      fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
        expect(url).toBe('https://opencode.ai/zen/go/v1/usage');
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer acc-1',
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
