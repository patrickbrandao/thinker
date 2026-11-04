import { OpencodeConsoleMonitor } from './opencode-console-monitor.service';
import { OpencodeOauthService } from './opencode-oauth.service';
import { outboundFetch } from '../../../common/outbound/outbound-proxy';
import { __resetOAuthRefreshCoordinator } from '../core';

jest.mock('../../../common/outbound/outbound-proxy', () => ({ outboundFetch: jest.fn() }));
// Rows hold the plaintext blob; decryption is the identity here.
jest.mock('../../../common/utils/crypto.util', () => ({
  decryptWithAny: (value: string) => ({ plaintext: value }),
  getDecryptionSecrets: () => [],
}));

const fetchMock = outboundFetch as jest.MockedFunction<typeof outboundFetch>;
const T0 = 1_760_000_000_000;
const HOUR = 3_600_000;
const CLIENT_UA = 'opencode/latest/2.2.5/cli';

interface Row {
  id: string;
  tenant_id: string;
  provider: string;
  label: string;
  auth_type: string;
  is_active: boolean;
  api_key_encrypted: string;
}

const blob = (t: string, r: string, e: number, u?: string) =>
  JSON.stringify({ t, r, e, ...(u ? { u } : {}) });

const json = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

describe('OpencodeConsoleMonitor', () => {
  let rows: Row[];
  let monitor: OpencodeConsoleMonitor;
  let oauth: OpencodeOauthService;
  let egress: { runForConnection: jest.Mock };
  let refreshReply: (refreshToken: string) => Response;
  let refreshCount: number;

  const configCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/console/api/v2/config'));
  const refreshCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/device/token'));

  const row = (over: Partial<Row> & { id: string; api_key_encrypted: string }): Row => ({
    tenant_id: 'tenant-1',
    provider: 'opencode-go',
    label: 'Default',
    auth_type: 'subscription',
    is_active: true,
    ...over,
  });

  const repo = {
    find: jest.fn(async ({ where }: { where: { tenant_id?: string } }) =>
      rows.filter(
        (r) =>
          r.is_active &&
          r.auth_type === 'subscription' &&
          (!where.tenant_id || r.tenant_id === where.tenant_id),
      ),
    ),
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    __resetOAuthRefreshCoordinator();
    rows = [];
    refreshCount = 0;
    refreshReply = () => {
      refreshCount += 1;
      return json(200, {
        access_token: `acc-r${refreshCount}`,
        refresh_token: `ref-r${refreshCount}`,
        expires_in: 3600,
      });
    };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/console/api/v2/config')) return json(200, {});
      if (String(url).endsWith('/auth/device/token')) {
        const body = JSON.parse(String(init?.body)) as { refresh_token: string };
        return refreshReply(body.refresh_token);
      }
      throw new Error(`unexpected ${String(url)}`);
    });
    // The row lock re-reads and writes the in-memory rows.
    const providerService = {
      withSubscriptionCredentialLock: jest.fn(
        async (
          tenantId: string,
          provider: string,
          label: string | undefined,
          fn: (ops: {
            readFreshRaw: () => Promise<string | null>;
            writeRaw: (raw: string) => Promise<void>;
          }) => Promise<unknown>,
        ) => {
          const target = rows.find(
            (r) =>
              r.tenant_id === tenantId &&
              r.provider === provider &&
              r.label.toLowerCase() === (label ?? 'Default').toLowerCase(),
          );
          return fn({
            readFreshRaw: async () => target?.api_key_encrypted ?? null,
            writeRaw: async (raw) => {
              if (target) target.api_key_encrypted = raw;
            },
          });
        },
      ),
    };
    oauth = new OpencodeOauthService(providerService as never, {} as never);
    egress = { runForConnection: jest.fn((_t, _p, _id, fn: () => Promise<unknown>) => fn()) };
    monitor = new OpencodeConsoleMonitor(oauth, repo as never, egress as never);
  });

  afterEach(() => {
    monitor.onModuleDestroy();
    jest.useRealTimers();
  });

  /**
   * Run the 0 ms check a rescan scheduled from inside a timer: the fake clock
   * turns a 0 ms delay set during a tick into 1 ms.
   */
  const settle = () => jest.advanceTimersByTimeAsync(1);

  /** Boot, then let the immediate first checks run. */
  const boot = async () => {
    monitor.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
  };

  it('reads the Console config at once and then every 60 s, with the client headers', async () => {
    rows = [row({ id: 'p1', api_key_encrypted: blob('acc-1', 'ref-1', T0 + 10 * HOUR, 'org-1') })];
    await boot();
    expect(configCalls()).toHaveLength(1);
    const [url, init] = configCalls()[0];
    expect(url).toBe('https://opencode.ai/console/api/v2/config');
    expect(init?.headers).toEqual({
      accept: 'application/json',
      'user-agent': CLIENT_UA,
      authorization: 'Bearer acc-1',
      'x-org-id': 'org-1',
    });
    await jest.advanceTimersByTimeAsync(59_000);
    expect(configCalls()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(configCalls()).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(configCalls()).toHaveLength(7);
    expect(refreshCalls()).toHaveLength(0);
    // Every call runs in the connection's outbound scope.
    expect(egress.runForConnection).toHaveBeenCalledWith(
      'tenant-1',
      'opencode-go',
      'p1',
      expect.any(Function),
    );
  });

  it('runs one loop for the opencode and opencode-go rows of one organization', async () => {
    rows = [
      row({
        id: 'p1',
        provider: 'opencode',
        api_key_encrypted: blob('a1', 'r1', T0 + HOUR, 'org-1'),
      }),
      row({ id: 'p2', api_key_encrypted: blob('a2', 'r2', T0 + 2 * HOUR, 'org-1') }),
      row({ id: 'p3', label: 'Other', api_key_encrypted: blob('a3', 'r3', T0 + HOUR, 'org-2') }),
    ];
    await boot();
    expect(monitor.monitoredLogins()).toHaveLength(2);
    expect(configCalls()).toHaveLength(2);
    // The org-1 read uses the row whose token lives longest.
    const auth = configCalls().map(
      ([, init]) => (init?.headers as Record<string, string>).authorization,
    );
    expect(auth.sort()).toEqual(['Bearer a2', 'Bearer a3']);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(configCalls()).toHaveLength(4);
  });

  it('refreshes a token within 5 minutes of expiry, persists the rotation once, then reads', async () => {
    rows = [row({ id: 'p1', api_key_encrypted: blob('acc-1', 'ref-1', T0 + 6 * 60_000, 'org-1') })];
    await boot();
    expect(refreshCalls()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(60_000);
    // Now 5 minutes from expiry: the client's lazy refresh margin.
    expect(refreshCalls()).toHaveLength(1);
    const [, init] = refreshCalls()[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'ref-1',
      client_id: 'opencode-cli',
    });
    expect(JSON.parse(rows[0].api_key_encrypted)).toMatchObject({
      t: 'acc-r1',
      r: 'ref-r1',
      u: 'org-1',
    });
    const last = configCalls().at(-1)!;
    expect((last[1]?.headers as Record<string, string>).authorization).toBe('Bearer acc-r1');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('stops polling a login on invalid_grant and resumes once it is reconnected', async () => {
    const warn = jest.spyOn(monitor['logger'], 'warn').mockImplementation(() => undefined);
    rows = [row({ id: 'p1', api_key_encrypted: blob('acc-1', 'ref-1', T0 + 60_000, 'org-1') })];
    refreshReply = () => json(400, { error: 'invalid_grant' });
    await boot();
    expect(refreshCalls()).toHaveLength(1);
    expect(configCalls()).toHaveLength(0);
    expect(monitor.monitoredLogins()).toEqual([]);
    expect(oauth.isSignedOut('ref-1')).toBe(true);
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(refreshCalls()).toHaveLength(1);
    expect(configCalls()).toHaveLength(0);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('signed out'))).toHaveLength(1);

    // A new login writes a new refresh token into the row.
    rows[0].api_key_encrypted = blob('acc-2', 'ref-2', Date.now() + HOUR, 'org-1');
    await jest.advanceTimersByTimeAsync(60_000);
    await settle(); // the check the rescan scheduled
    expect(monitor.monitoredLogins()).toHaveLength(1);
    expect(configCalls()).toHaveLength(1);
  });

  it('logs a failing check once, not every minute, and logs the recovery', async () => {
    const warn = jest.spyOn(monitor['logger'], 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(monitor['logger'], 'log').mockImplementation(() => undefined);
    rows = [row({ id: 'p1', api_key_encrypted: blob('acc-1', 'ref-1', T0 + 10 * HOUR, 'org-1') })];
    let failing = true;
    fetchMock.mockImplementation(async () => (failing ? json(503, {}) : json(200, {})));
    await boot();
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(warn).toHaveBeenCalledTimes(1);
    failing = false;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(log.mock.calls.filter(([m]) => String(m).includes('recovered'))).toHaveLength(1);
  });

  it('picks up new logins and drops removed or disabled ones without a restart', async () => {
    await boot();
    expect(monitor.monitoredLogins()).toEqual([]);
    rows.push(
      row({ id: 'p1', api_key_encrypted: blob('acc-1', 'ref-1', T0 + 10 * HOUR, 'org-1') }),
    );
    await jest.advanceTimersByTimeAsync(60_000);
    await settle(); // the check the rescan scheduled
    expect(monitor.monitoredLogins()).toHaveLength(1);
    expect(configCalls()).toHaveLength(1);

    rows[0].is_active = false;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(monitor.monitoredLogins()).toEqual([]);
    const before = configCalls().length;
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(configCalls()).toHaveLength(before);
  });

  it('makes no Console call for a pasted API key or the public key', async () => {
    rows = [
      row({ id: 'p1', provider: 'opencode', api_key_encrypted: 'public' }),
      row({ id: 'p2', api_key_encrypted: 'sk-opencode-key' }),
    ];
    await boot();
    await jest.advanceTimersByTimeAsync(3 * 60_000);
    expect(monitor.monitoredLogins()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for the 60 s window a login read already opened', async () => {
    rows = [row({ id: 'p1', api_key_encrypted: blob('acc-1', 'ref-1', T0 + 10 * HOUR, 'org-1') })];
    // The login itself read the config 20 s before the monitor sees it.
    await oauth.readConsoleConfig('tenant-1\u0000org-1', 'acc-1', 'org-1');
    await jest.advanceTimersByTimeAsync(20_000);
    await boot();
    expect(configCalls()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(40_000);
    expect(configCalls()).toHaveLength(2);
  });

  it('leaves no timers behind after destroy', async () => {
    rows = [row({ id: 'p1', api_key_encrypted: blob('acc-1', 'ref-1', T0 + 10 * HOUR, 'org-1') })];
    await boot();
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    monitor.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(configCalls()).toHaveLength(1);
  });
});
