import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ProviderService } from '../../routing-core/provider.service';
import { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import { scrubSecrets } from '../../../common/utils/secret-scrub';
import { outboundFetch } from '../../../common/outbound/outbound-proxy';
import { OPENCODE_USER_AGENT } from '../../../common/constants/subscription-clients';
import {
  coordinateOAuthRefresh,
  oauthRefreshKey,
  parseOAuthTokenBlob,
  serializeOAuthTokenBlob,
  subscriptionCredentialLock,
  type OAuthTokenBlob,
} from '../core';

/**
 * OpenCode Console device login (OAuth 2.0 Device Authorization Grant),
 * reproducing what the OpenCode 2 client (`anomalyco/opencode`,
 * packages/core/src/plugin/provider/opencode.ts) sends: the same requests,
 * headers, poll cadence, follow-up calls and refresh margin, so the Console
 * sees an OpenCode client. The access token is organization-scoped and
 * authenticates OpenCode and OpenCode Go inference as a Bearer token; refresh
 * tokens rotate on every refresh.
 */
export const OPENCODE_CONSOLE_SERVER = 'https://opencode.ai/console';
/** OpenCode Go allowance meter: rolling 5-hour, weekly and monthly windows. */
export const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const USAGE_TIMEOUT_MS = 15_000;
const CLIENT_ID = 'opencode-cli';
/** Providers a Console login connects; each keeps its own subscription row. */
export type OpencodeConsoleProvider = 'opencode' | 'opencode-go';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
/** The client adds 5 s to its wait on every slow_down and keeps it. */
const SLOW_DOWN_STEP_MS = 5000;
/** The client gives a login attempt 10 minutes, whatever `expires_in` says. */
const LOGIN_ATTEMPT_MS = 10 * 60_000;
/** The client refreshes a token used within 5 minutes of its expiry. */
const REFRESH_MARGIN_MS = 5 * 60_000;
const REFRESH_TIMEOUT_MS = 30_000;
/** A connected client reads its Console config every 60 s. */
export const CONSOLE_CONFIG_INTERVAL_MS = 60_000;
/** Headers the client sends on every Console call (its HTTP client is mapped to set the UA). */
const CONSOLE_HEADERS = { accept: 'application/json', 'user-agent': OPENCODE_USER_AGENT };

interface PendingOpencodeOAuth {
  provider: OpencodeConsoleProvider;
  deviceCode: string;
  agentId: string;
  tenantId: string;
  createdByUserId: string | null;
  expiresAt: number;
  /** The client's current wait between polls (grows on slow_down). */
  pollIntervalMs: number;
  /** No upstream poll before this: the client sleeps one wait before each poll. */
  nextPollAt: number;
  /** The upstream poll in progress; polls are strictly sequential, like the client's. */
  inFlight: Promise<OpencodeOAuthPollResult> | null;
}

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  org_id?: string | null;
  error?: string;
}

interface ConsoleUser {
  id?: string;
  email?: string;
}

interface ConsoleOrg {
  id: string;
  name: string;
}

export interface OpencodeOAuthStartResult {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  pollIntervalMs: number;
}

export interface OpencodeGoUsageWindow {
  /** Share of the window's allowance already spent, 0–100. */
  percent: number;
  /** True while requests are blocked until `resetsAt`. */
  limited: boolean;
  resetsAt: string | null;
}

export interface OpencodeGoUsage {
  rolling: OpencodeGoUsageWindow | null;
  weekly: OpencodeGoUsageWindow | null;
  monthly: OpencodeGoUsageWindow | null;
}

interface RawUsageWindow {
  status?: string;
  percent?: number;
  resetsAt?: string;
}

export interface OpencodeOAuthPollResult {
  status: 'pending' | 'success' | 'error';
  message?: string;
  pollIntervalMs?: number;
}

function errorText(err: unknown): string {
  return scrubSecrets(err instanceof Error ? err.message : String(err));
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function postJson(url: string, body: Record<string, string | boolean>, signal?: AbortSignal) {
  return outboundFetch(url, {
    method: 'POST',
    headers: { ...CONSOLE_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal && { signal }),
  });
}

/** A Console GET with the access token; like the client, any non-2xx fails. */
async function getConsoleJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await outboundFetch(url, {
    headers: { ...CONSOLE_HEADERS, authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`OpenCode Console ${url} returned ${response.status}`);
  const body = parseJson<T>(await response.text());
  if (body === null) throw new Error(`OpenCode Console ${url} returned an unreadable body`);
  return body;
}

/**
 * The Console refused the refresh token (400 `invalid_grant`): the session
 * was revoked or expired and only a new device login recovers it.
 */
export class OpencodeSignedOutError extends Error {
  constructor() {
    super('OpenCode Console session ended (invalid_grant); reconnect the login');
    this.name = 'OpencodeSignedOutError';
  }
}

/** Refresh tokens remembered as signed out, bounded like the rejection cooldown. */
const MAX_SIGNED_OUT = 1_000;

/**
 * One Console login per workspace and organization: an `opencode` and an
 * `opencode-go` row signed in to the same org are one client, not two.
 */
export function opencodeLoginKey(tenantId: string, orgId: string | undefined, label?: string) {
  return `${tenantId}\u0000${orgId ?? label ?? ''}`;
}

@Injectable()
export class OpencodeOauthService {
  private readonly logger = new Logger(OpencodeOauthService.name);
  private readonly pending = new Map<string, PendingOpencodeOAuth>();
  /**
   * Last Console config read per login (`opencodeLoginKey`). Every read goes
   * through `readConsoleConfig`, which allows one per 60 s, whatever asks.
   */
  private readonly configReadAt = new Map<string, number>();
  /**
   * Refresh tokens the Console answered `invalid_grant` for. They are never
   * sent again: the proxy and the background monitor both skip them until a
   * new login stores a new token. Compared, never logged or persisted.
   */
  private readonly signedOut = new Set<string>();

  constructor(
    private readonly providerService: ProviderService,
    private readonly discoveryService: ModelDiscoveryService,
  ) {}

  async startAuthorization(
    agentId: string,
    tenantId: string,
    createdByUserId?: string | null,
    provider: OpencodeConsoleProvider = 'opencode-go',
  ): Promise<OpencodeOAuthStartResult> {
    this.cleanupExpired();
    const response = await postJson(`${OPENCODE_CONSOLE_SERVER}/auth/device/code`, {
      client_id: CLIENT_ID,
      supports_org_scope: true,
    });
    const text = await response.text();
    if (!response.ok) {
      this.logger.error(`OpenCode device code request failed: ${scrubSecrets(text)}`);
      throw new Error('Failed to start OpenCode login');
    }
    const payload = parseJson<DeviceCodeResponse>(text);
    // The client requires every field, `interval` included (it has no default).
    if (
      !payload?.device_code ||
      !payload.user_code ||
      !payload.verification_uri_complete ||
      typeof payload.expires_in !== 'number' ||
      typeof payload.interval !== 'number'
    ) {
      throw new Error('OpenCode returned an incomplete device authorization payload.');
    }
    const verification = new URL(payload.verification_uri_complete, `${OPENCODE_CONSOLE_SERVER}/`);
    if (verification.protocol !== 'https:' && verification.protocol !== 'http:') {
      throw new Error('OpenCode returned an invalid verification URL.');
    }
    const flowId = randomBytes(16).toString('base64url');
    const now = Date.now();
    const expiresAt = now + LOGIN_ATTEMPT_MS;
    // `interval` is always seconds for the client.
    const pollIntervalMs = payload.interval * 1000;
    this.pending.set(flowId, {
      provider,
      deviceCode: payload.device_code,
      agentId,
      tenantId,
      createdByUserId: createdByUserId ?? null,
      expiresAt,
      pollIntervalMs,
      nextPollAt: now + pollIntervalMs,
      inFlight: null,
    });
    return {
      flowId,
      userCode: payload.user_code,
      verificationUri: verification.href,
      expiresAt,
      pollIntervalMs,
    };
  }

  /**
   * The dashboard may ask at any time (several tabs, a page back in focus);
   * the Console is polled only on the client's own cadence: one wait before
   * each poll, measured from the previous reply, never two at once.
   */
  async pollAuthorization(flowId: string, tenantId: string): Promise<OpencodeOAuthPollResult> {
    this.cleanupExpired();
    const pending = this.pending.get(flowId);
    if (!pending) return { status: 'error', message: 'OpenCode login expired. Start again.' };
    if (pending.tenantId !== tenantId) {
      return {
        status: 'error',
        message: 'OpenCode login session does not match the current account.',
      };
    }
    if (pending.inFlight) return pending.inFlight;
    const wait = pending.nextPollAt - Date.now();
    if (wait > 0) return { status: 'pending', pollIntervalMs: wait };
    const inFlight = this.pollUpstream(flowId, pending).finally(() => {
      pending.inFlight = null;
      pending.nextPollAt = Date.now() + pending.pollIntervalMs;
    });
    pending.inFlight = inFlight;
    return inFlight;
  }

  private async pollUpstream(
    flowId: string,
    pending: PendingOpencodeOAuth,
  ): Promise<OpencodeOAuthPollResult> {
    // The token endpoint answers pending/slow_down in the body, not the status.
    const response = await postJson(`${OPENCODE_CONSOLE_SERVER}/auth/device/token`, {
      grant_type: DEVICE_GRANT_TYPE,
      device_code: pending.deviceCode,
      client_id: CLIENT_ID,
    });
    const payload = parseJson<TokenResponse>(await response.text());
    if (payload?.error === 'authorization_pending') {
      return { status: 'pending', pollIntervalMs: pending.pollIntervalMs };
    }
    if (payload?.error === 'slow_down') {
      pending.pollIntervalMs += SLOW_DOWN_STEP_MS;
      return { status: 'pending', pollIntervalMs: pending.pollIntervalMs };
    }
    this.pending.delete(flowId);
    if (payload?.error) {
      return { status: 'error', message: `OpenCode authorization failed: ${payload.error}` };
    }
    if (!payload?.access_token || !payload.refresh_token || !payload.expires_in) {
      return { status: 'error', message: 'OpenCode returned an incomplete token payload.' };
    }

    // Like the client: read the account and its organizations, then pick the
    // token's organization, or the first by name when the token names none.
    let orgId: string | undefined;
    try {
      const [, orgs] = await Promise.all([
        getConsoleJson<ConsoleUser>(`${OPENCODE_CONSOLE_SERVER}/api/user`, payload.access_token),
        getConsoleJson<ConsoleOrg[]>(`${OPENCODE_CONSOLE_SERVER}/api/orgs`, payload.access_token),
      ]);
      const list = Array.isArray(orgs) ? orgs : [];
      const org =
        payload.org_id == null
          ? list.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]
          : list.find((o) => o.id === payload.org_id);
      if (payload.org_id != null && !org) {
        return { status: 'error', message: `OpenCode organization not found: ${payload.org_id}` };
      }
      orgId = org?.id;
    } catch (err) {
      this.logger.error(`OpenCode account lookup after login failed: ${scrubSecrets(String(err))}`);
      return { status: 'error', message: 'OpenCode login failed reading the account.' };
    }

    const blob: OAuthTokenBlob = {
      t: payload.access_token,
      r: payload.refresh_token,
      e: Date.now() + payload.expires_in * 1000,
      ...(orgId ? { u: orgId } : {}),
    };
    const label = await this.providerService.nextOAuthLabel(pending.tenantId, pending.provider);
    const { provider: savedProvider } = await this.providerService.upsertProvider(
      pending.agentId,
      pending.tenantId,
      pending.provider,
      serializeOAuthTokenBlob(blob),
      'subscription',
      undefined,
      label,
      pending.createdByUserId,
    );
    try {
      await this.discoveryService.discoverModels(savedProvider);
    } catch (err) {
      this.logger.warn(`Model discovery after OpenCode OAuth failed: ${err}`);
    }
    this.logger.log(`OpenCode OAuth token stored for agent=${pending.agentId}`);
    // The client reads its Console config as soon as it signs in; the
    // background monitor takes over from the next minute.
    void this.readConsoleConfig(
      opencodeLoginKey(pending.tenantId, orgId, savedProvider?.label ?? label),
      blob.t,
      orgId,
    ).catch((err: unknown) =>
      this.logger.debug(`OpenCode Console config read after login failed: ${errorText(err)}`),
    );
    return { status: 'success' };
  }

  /**
   * Refresh grant; the response rotates the refresh token, so both are
   * replaced. A 400 `invalid_grant` throws `OpencodeSignedOutError` and marks
   * the refresh token as signed out, like the client's `SignedOutError`.
   */
  async refreshAccessToken(current: OAuthTokenBlob): Promise<OAuthTokenBlob> {
    if (this.signedOut.has(current.r)) throw new OpencodeSignedOutError();
    const response = await postJson(
      `${OPENCODE_CONSOLE_SERVER}/auth/device/token`,
      { grant_type: 'refresh_token', refresh_token: current.r, client_id: CLIENT_ID },
      AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    );
    const text = await response.text();
    if (!response.ok) {
      if (response.status === 400 && parseJson<TokenResponse>(text)?.error === 'invalid_grant') {
        if (this.signedOut.size >= MAX_SIGNED_OUT) this.signedOut.clear();
        this.signedOut.add(current.r);
        throw new OpencodeSignedOutError();
      }
      throw new Error(
        `OpenCode token refresh failed (${response.status}): ${scrubSecrets(text).slice(0, 200)}`,
      );
    }
    const payload = parseJson<TokenResponse>(text);
    if (!payload?.access_token || !payload.refresh_token || !payload.expires_in) {
      throw new Error('OpenCode token refresh returned an incomplete payload');
    }
    const orgId = payload.org_id ?? current.u;
    return {
      t: payload.access_token,
      r: payload.refresh_token,
      e: Date.now() + payload.expires_in * 1000,
      ...(orgId ? { u: orgId } : {}),
    };
  }

  /** True once the Console answered `invalid_grant` for this refresh token. */
  isSignedOut(refreshToken: string): boolean {
    return this.signedOut.has(refreshToken);
  }

  /**
   * Returns the access token for a stored OAuth blob, refreshing it when it
   * is about to expire. Returns null when the value is not an OAuth blob
   * (a pasted OpenCode API key) so callers use it verbatim.
   */
  async unwrapToken(
    rawValue: string,
    agentId: string,
    tenantId: string,
    keyLabel?: string,
    provider: OpencodeConsoleProvider = 'opencode-go',
  ): Promise<string | null> {
    const blob = parseOAuthTokenBlob(rawValue);
    if (!blob?.t || !blob.r) return null;
    // No Console call here: the background monitor reads the config of every
    // login once a minute, whether or not it is in use.
    return this.resolveAccessToken(blob, agentId, tenantId, keyLabel, provider);
  }

  private async resolveAccessToken(
    blob: OAuthTokenBlob,
    agentId: string,
    tenantId: string,
    keyLabel: string | undefined,
    provider: OpencodeConsoleProvider,
  ): Promise<string | null> {
    if (Date.now() < blob.e - REFRESH_MARGIN_MS) return blob.t;
    try {
      return (await this.ensureFreshToken(blob, tenantId, provider, keyLabel)).t;
    } catch (err) {
      this.logger.error(
        `Failed to refresh OpenCode OAuth token for agent=${agentId}: ${errorText(err)}`,
      );
      return Date.now() < blob.e ? blob.t : null;
    }
  }

  /**
   * The stored login with a usable access token: refreshed when it is within
   * 5 minutes of expiry (the client's lazy check), under the single-flight
   * coordinator and the row lock, so a rotation is persisted exactly once
   * whoever asks (a proxied request or the background monitor). Rejects when
   * the refresh fails; `OpencodeSignedOutError` means only a new login helps.
   */
  async ensureFreshToken(
    blob: OAuthTokenBlob,
    tenantId: string,
    provider: OpencodeConsoleProvider,
    keyLabel: string | undefined,
  ): Promise<OAuthTokenBlob> {
    if (Date.now() < blob.e - REFRESH_MARGIN_MS) return blob;
    return coordinateOAuthRefresh<OAuthTokenBlob>({
      key: oauthRefreshKey(provider, tenantId, keyLabel),
      logger: this.logger,
      callerBlob: blob,
      parse: parseOAuthTokenBlob,
      refresh: (current) => this.refreshAccessToken(current),
      expirySkewMs: REFRESH_MARGIN_MS,
      withLock: subscriptionCredentialLock(
        (t, p, l, fn) => this.providerService.withSubscriptionCredentialLock(t, p, l, fn),
        tenantId,
        provider,
        keyLabel,
        serializeOAuthTokenBlob,
      ),
    });
  }

  /**
   * The Go allowance meter for a stored Console login, or null when the
   * credential cannot read it: a pasted API key (no organization to name) or
   * a workspace without Go (403).
   */
  async readGoUsage(
    rawValue: string,
    agentId: string,
    tenantId: string,
    keyLabel?: string,
  ): Promise<OpencodeGoUsage | null> {
    const orgId = parseOAuthTokenBlob(rawValue)?.u;
    if (!orgId) return null;
    const token = await this.unwrapToken(rawValue, agentId, tenantId, keyLabel, 'opencode-go');
    if (!token) return null;
    const response = await outboundFetch(OPENCODE_GO_USAGE_URL, {
      headers: {
        ...CONSOLE_HEADERS,
        authorization: `Bearer ${token}`,
        'x-opencode-org-id': orgId,
      },
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    if (response.status === 403) return null;
    if (!response.ok) throw new Error(`OpenCode Go usage returned ${response.status}`);
    const body = parseJson<{ usage?: Record<string, RawUsageWindow> }>(await response.text());
    const window = (raw: RawUsageWindow | undefined): OpencodeGoUsageWindow | null =>
      raw && typeof raw.percent === 'number'
        ? {
            percent: raw.percent,
            limited: raw.status === 'rate-limited',
            resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : null,
          }
        : null;
    return {
      rolling: window(body?.usage?.rolling),
      weekly: window(body?.usage?.weekly),
      monthly: window(body?.usage?.monthly),
    };
  }

  /**
   * `GET /api/v2/config` as the client sends it on login and every 60 s while
   * connected (packages/core/src/plugin/provider/opencode.ts, fetchConfig).
   * At most one read per login per 60 s, whoever triggers it: returns false
   * without a request inside that window. The body is read and dropped:
   * Thinker does not apply the Console's remote config (ADR 0009). A non-2xx
   * other than 404 (the client's "no config") rejects.
   */
  async readConsoleConfig(
    loginKey: string,
    accessToken: string,
    orgId: string | undefined,
  ): Promise<boolean> {
    const now = Date.now();
    if (now - (this.configReadAt.get(loginKey) ?? -Infinity) < CONSOLE_CONFIG_INTERVAL_MS) {
      return false;
    }
    this.configReadAt.set(loginKey, now);
    const response = await outboundFetch(`${OPENCODE_CONSOLE_SERVER}/api/v2/config`, {
      headers: {
        ...CONSOLE_HEADERS,
        authorization: `Bearer ${accessToken}`,
        ...(orgId && { 'x-org-id': orgId }),
      },
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    await response.text().catch(() => undefined);
    if (!response.ok && response.status !== 404) {
      throw new Error(`OpenCode Console config returned ${response.status}`);
    }
    return true;
  }

  /** When `readConsoleConfig` last sent a request for this login, if ever. */
  consoleConfigReadAt(loginKey: string): number | undefined {
    return this.configReadAt.get(loginKey);
  }

  /** Forget a login that no longer exists, so a new one reads at once. */
  forgetLogin(loginKey: string): void {
    this.configReadAt.delete(loginKey);
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [flowId, pending] of this.pending.entries()) {
      if (pending.expiresAt <= now) this.pending.delete(flowId);
    }
  }
}
