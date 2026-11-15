import { Injectable, Logger } from '@nestjs/common';
import { COPILOT_URLS } from '../../provider-urls/provider-url-constants';
import {
  fetchProviderUrl,
  runWithProviderUrls,
  scopedProviderUrl,
  type ProviderUrlConnection,
} from '../../provider-urls/provider-url-scope';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
/** A started login keeps its URL overrides this long (GitHub device codes last 15 min). */
const PENDING_TTL_MS = 20 * 60 * 1000;

interface PendingCopilotUrls {
  tenantId: string;
  urls: ProviderUrlConnection;
  expiresAt: number;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type PollStatus = 'pending' | 'complete' | 'expired' | 'denied' | 'slow_down';

@Injectable()
export class CopilotDeviceAuthService {
  private readonly logger = new Logger(CopilotDeviceAuthService.name);
  /** URL overrides of started logins (ADR 0012), by device code. */
  private readonly pending = new Map<string, PendingCopilotUrls>();

  async requestDeviceCode(
    urls?: ProviderUrlConnection,
    tenantId?: string,
  ): Promise<DeviceCodeResponse> {
    const deviceCodeUrl = runWithProviderUrls(urls, () =>
      scopedProviderUrl('copilot', 'subscription', 'device_code', COPILOT_URLS.deviceCode),
    );
    const res = await fetchProviderUrl(deviceCodeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        scope: 'read:user',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`GitHub device code request failed: ${res.status}`);
    }

    const data = (await res.json()) as DeviceCodeResponse;
    if (!data.device_code || !data.user_code) {
      throw new Error('Invalid device code response from GitHub');
    }
    this.cleanup();
    if (urls && tenantId) {
      this.pending.set(data.device_code, {
        tenantId,
        urls,
        expiresAt: Date.now() + PENDING_TTL_MS,
      });
    }
    return data;
  }

  /**
   * Poll the token endpoint. `urls` in the result are the overrides the login
   * was started with, for the account the caller creates on `complete`.
   */
  async pollForToken(
    deviceCode: string,
    tenantId?: string,
  ): Promise<{ status: PollStatus; token?: string; urls?: ProviderUrlConnection }> {
    this.cleanup();
    const started = this.pending.get(deviceCode);
    const urls = started && started.tenantId === tenantId ? started.urls : undefined;
    const tokenUrl = runWithProviderUrls(urls, () =>
      scopedProviderUrl('copilot', 'subscription', 'device_token', COPILOT_URLS.deviceToken),
    );
    const res = await fetchProviderUrl(tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`GitHub token poll failed: ${res.status}`);
    }

    const result = this.parsePollResponse(
      (await res.json()) as { access_token?: string; error?: string },
    );
    if (result.status !== 'pending' && result.status !== 'slow_down') {
      this.pending.delete(deviceCode);
    }
    return urls && result.status === 'complete' ? { ...result, urls } : result;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [code, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(code);
    }
  }

  private parsePollResponse(data: { access_token?: string; error?: string }): {
    status: PollStatus;
    token?: string;
  } {
    if (data.access_token) return { status: 'complete', token: data.access_token };
    if (data.error === 'authorization_pending') return { status: 'pending' };
    if (data.error === 'slow_down') return { status: 'slow_down' };
    if (data.error === 'expired_token') return { status: 'expired' };
    if (data.error === 'access_denied') return { status: 'denied' };

    this.logger.warn(`Unexpected GitHub poll response: ${JSON.stringify(data)}`);
    return { status: 'pending' };
  }
}
