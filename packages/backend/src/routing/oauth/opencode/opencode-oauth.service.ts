import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ProviderService } from '../../routing-core/provider.service';
import { ModelDiscoveryService } from '../../../model-discovery/model-discovery.service';
import { scrubSecrets } from '../../../common/utils/secret-scrub';
import { outboundFetch } from '../../../common/outbound/outbound-proxy';
import {
  coordinateOAuthRefresh,
  oauthRefreshKey,
  parseOAuthTokenBlob,
  serializeOAuthTokenBlob,
  subscriptionCredentialLock,
  toPollIntervalMs,
  type OAuthTokenBlob,
} from '../core';

/**
 * OpenCode Console device login (OAuth 2.0 Device Authorization Grant), the
 * same flow `opencode auth login opencode` runs. The access token is
 * organization-scoped and authenticates OpenCode and OpenCode Go inference as
 * a Bearer token; refresh tokens rotate on every refresh.
 */
export const OPENCODE_CONSOLE_SERVER = 'https://opencode.ai/console';
/** OpenCode Go allowance meter: rolling 5-hour, weekly and monthly windows. */
export const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const USAGE_TIMEOUT_MS = 15_000;
const CLIENT_ID = 'opencode-cli';
/** Providers a Console login connects; each keeps its own subscription row. */
export type OpencodeConsoleProvider = 'opencode' | 'opencode-go';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const SLOW_DOWN_STEP_MS = 5000;

interface PendingOpencodeOAuth {
  provider: OpencodeConsoleProvider;
  deviceCode: string;
  agentId: string;
  tenantId: string;
  createdByUserId: string | null;
  expiresAt: number;
  pollIntervalMs: number;
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

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function postJson(url: string, body: Record<string, string | boolean>) {
  return outboundFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

@Injectable()
export class OpencodeOauthService {
  private readonly logger = new Logger(OpencodeOauthService.name);
  private readonly pending = new Map<string, PendingOpencodeOAuth>();

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
    if (
      !payload?.device_code ||
      !payload.user_code ||
      !payload.verification_uri_complete ||
      !payload.expires_in
    ) {
      throw new Error('OpenCode returned an incomplete device authorization payload.');
    }
    const verification = new URL(payload.verification_uri_complete, `${OPENCODE_CONSOLE_SERVER}/`);
    if (verification.protocol !== 'https:' && verification.protocol !== 'http:') {
      throw new Error('OpenCode returned an invalid verification URL.');
    }
    const flowId = randomBytes(16).toString('base64url');
    const expiresAt = Date.now() + payload.expires_in * 1000;
    const pollIntervalMs = toPollIntervalMs(payload.interval, DEFAULT_POLL_INTERVAL_MS);
    this.pending.set(flowId, {
      provider,
      deviceCode: payload.device_code,
      agentId,
      tenantId,
      createdByUserId: createdByUserId ?? null,
      expiresAt,
      pollIntervalMs,
    });
    return {
      flowId,
      userCode: payload.user_code,
      verificationUri: verification.href,
      expiresAt,
      pollIntervalMs,
    };
  }

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
    const blob: OAuthTokenBlob = {
      t: payload.access_token,
      r: payload.refresh_token,
      e: Date.now() + payload.expires_in * 1000,
      ...(payload.org_id ? { u: payload.org_id } : {}),
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
    return { status: 'success' };
  }

  /** Refresh grant; the response rotates the refresh token, so both are replaced. */
  async refreshAccessToken(current: OAuthTokenBlob): Promise<OAuthTokenBlob> {
    const response = await postJson(`${OPENCODE_CONSOLE_SERVER}/auth/device/token`, {
      grant_type: 'refresh_token',
      refresh_token: current.r,
      client_id: CLIENT_ID,
    });
    const text = await response.text();
    if (!response.ok) {
      // 400 invalid_grant means the Console session is gone: only a new login recovers.
      this.logger.error(
        `OpenCode token refresh failed (${response.status}): ${scrubSecrets(text)}`,
      );
      throw new Error('Token refresh failed');
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
    if (Date.now() < blob.e - 60_000) return blob.t;
    try {
      const resolved = await coordinateOAuthRefresh<OAuthTokenBlob>({
        key: oauthRefreshKey(provider, tenantId, keyLabel),
        logger: this.logger,
        callerBlob: blob,
        parse: parseOAuthTokenBlob,
        refresh: (current) => this.refreshAccessToken(current),
        withLock: subscriptionCredentialLock(
          (t, p, l, fn) => this.providerService.withSubscriptionCredentialLock(t, p, l, fn),
          tenantId,
          provider,
          keyLabel,
          serializeOAuthTokenBlob,
        ),
      });
      return resolved.t;
    } catch (err) {
      this.logger.error(`Failed to refresh OpenCode OAuth token for agent=${agentId}: ${err}`);
      return Date.now() < blob.e ? blob.t : null;
    }
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
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
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
