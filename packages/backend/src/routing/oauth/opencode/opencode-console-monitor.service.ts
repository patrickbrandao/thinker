import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TenantProvider } from '../../../entities/tenant-provider.entity';
import { decryptWithAny, getDecryptionSecrets } from '../../../common/utils/crypto.util';
import { scrubSecrets } from '../../../common/utils/secret-scrub';
import { ProxyEgressService } from '../../../proxy-servers/proxy-egress.service';
import {
  OPENCODE_PROVIDER_KEYS,
  opencodeCatalogProvider,
} from '../../../model-discovery/opencode-catalog.service';
import { parseOAuthTokenBlob, type OAuthTokenBlob } from '../core';
import {
  CONSOLE_CONFIG_INTERVAL_MS,
  OpencodeOauthService,
  OpencodeSignedOutError,
  opencodeLoginKey,
  type OpencodeConsoleProvider,
} from './opencode-oauth.service';

/** How often the database is rescanned for new, removed or disabled logins. */
export const CONSOLE_RESCAN_INTERVAL_MS = 60_000;
/** Floor for a check rescheduled to the end of another trigger's 60 s window. */
const MIN_DELAY_MS = 1_000;

/** One `tenant_providers` row holding a Console login (OAuth blob). */
interface ConsoleRow {
  id: string;
  tenantId: string;
  provider: OpencodeConsoleProvider;
  label: string;
  blob: OAuthTokenBlob;
  loginKey: string;
}

type LoginStatus = 'ok' | 'error' | 'signed_out';

interface LoginState {
  key: string;
  tenantId: string;
  rows: ConsoleRow[];
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  /** Signed out: no polling until a row carries a refresh token not known dead. */
  stopped: boolean;
  /** Last state logged, so a failure is logged once, not every minute. */
  status: LoginStatus | null;
}

/**
 * Keeps every OpenCode Console login (an OAuth blob on an `opencode` or
 * `opencode-go` row) alive and checked in the background, as an OpenCode
 * client left open would (ADR 0009): every 60 s per login, refresh the token
 * when it is within 5 minutes of expiry, then `GET /api/v2/config`.
 *
 * - One loop per login (`opencodeLoginKey`: workspace and organization), so
 *   an `opencode` and an `opencode-go` row of one org read the config once.
 *   Each row's token is refreshed on its own, through the shared coordinator
 *   and row lock the proxy uses.
 * - Each loop sleeps 60 s after its check completes (the client's
 *   `Effect.sleep(1 min)` then `check()`, forever).
 * - New logins are picked up and removed or disabled ones dropped by a 60 s
 *   rescan; each check also re-reads its rows, so a deletion stops it at once.
 * - `invalid_grant` stops the loop. The refresh token is remembered as signed
 *   out, so the proxy stops refreshing it and, once the access token expires,
 *   answers M102 ("Reconnect OAuth"). A new login (a new refresh token)
 *   resumes the loop on the next rescan.
 * - Calls go through the connection's outbound proxy chain. Failures are
 *   logged once per state change and never escape a timer.
 *
 * Pasted API keys and the `public` key have no Console session: they are not
 * monitored (only the shared catalog refresh applies to them).
 */
@Injectable()
export class OpencodeConsoleMonitor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OpencodeConsoleMonitor.name);
  private readonly logins = new Map<string, LoginState>();
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private rescanning = false;
  private scanFailed = false;
  private destroyed = false;

  constructor(
    private readonly oauth: OpencodeOauthService,
    @Optional()
    @Inject(getRepositoryToken(TenantProvider))
    private readonly providerRepo: Repository<TenantProvider> | null = null,
    @Optional() private readonly egress?: ProxyEgressService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.providerRepo) return;
    void this.rescan();
    this.rescanTimer = setInterval(() => void this.rescan(), CONSOLE_RESCAN_INTERVAL_MS);
    this.rescanTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    this.rescanTimer = null;
    for (const login of this.logins.values()) {
      if (login.timer) clearTimeout(login.timer);
      login.timer = null;
    }
    this.logins.clear();
  }

  /** Logins being monitored (test and diagnostics hook). */
  monitoredLogins(): string[] {
    return [...this.logins.values()].filter((l) => !l.stopped).map((l) => l.key);
  }

  /** Find new logins, drop removed or disabled ones, resume reconnected ones. */
  async rescan(): Promise<void> {
    if (this.destroyed || this.rescanning) return;
    this.rescanning = true;
    try {
      const groups = groupByLogin(await this.loadRows());
      if (this.scanFailed) this.logger.log('OpenCode Console monitor can read logins again');
      this.scanFailed = false;
      if (this.destroyed) return;
      for (const key of this.logins.keys()) {
        if (!groups.has(key)) this.drop(key);
      }
      for (const [key, rows] of groups) {
        const login = this.logins.get(key);
        if (!login) {
          const created: LoginState = {
            key,
            tenantId: rows[0].tenantId,
            rows,
            timer: null,
            running: false,
            stopped: false,
            status: null,
          };
          this.logins.set(key, created);
          // Read at once, like a client that just connected; the shared
          // 60 s window still applies when a login just read it.
          this.schedule(created, 0);
          continue;
        }
        if (login.running) continue;
        login.rows = rows;
        if (login.stopped && rows.some((row) => !this.oauth.isSignedOut(row.blob.r))) {
          login.stopped = false;
          this.schedule(login, 0);
        }
      }
    } catch (err) {
      if (!this.scanFailed) {
        this.logger.warn(`OpenCode Console monitor could not list logins: ${errorText(err)}`);
      }
      this.scanFailed = true;
    } finally {
      this.rescanning = false;
    }
  }

  /** One check of one login: refresh near expiry, then read the config. */
  async check(key: string): Promise<void> {
    const login = this.logins.get(key);
    if (!login || login.running || this.destroyed) return;
    if (login.timer) clearTimeout(login.timer);
    login.timer = null;
    login.running = true;
    let delay = CONSOLE_CONFIG_INTERVAL_MS;
    try {
      const rows = (await this.loadRows(login.tenantId)).filter((row) => row.loginKey === key);
      if (rows.length === 0) {
        this.drop(key);
        return;
      }
      login.rows = rows;
      const failures: string[] = [];
      for (const row of rows) {
        if (this.oauth.isSignedOut(row.blob.r)) continue;
        try {
          row.blob = await this.inScope(row, () =>
            this.oauth.ensureFreshToken(row.blob, row.tenantId, row.provider, row.label),
          );
        } catch (err) {
          if (!(err instanceof OpencodeSignedOutError)) failures.push(errorText(err));
        }
      }
      const live = rows.filter((row) => !this.oauth.isSignedOut(row.blob.r));
      if (live.length === 0) {
        login.stopped = true;
        this.setStatus(login, 'signed_out');
        return;
      }
      const now = Date.now();
      const usable = live.filter((row) => now < row.blob.e).sort((a, b) => b.blob.e - a.blob.e)[0];
      if (!usable) throw new Error(failures[0] ?? 'access token expired');
      const read = await this.inScope(usable, () =>
        this.oauth.readConsoleConfig(key, usable.blob.t, usable.blob.u),
      );
      if (!read) {
        // Another trigger (the login itself) read it within the window: come
        // back when that window ends rather than a full minute later.
        const last = this.oauth.consoleConfigReadAt(key) ?? Date.now();
        delay = Math.max(last + CONSOLE_CONFIG_INTERVAL_MS - Date.now(), MIN_DELAY_MS);
      }
      if (failures.length > 0) throw new Error(failures[0]);
      this.setStatus(login, 'ok');
    } catch (err) {
      this.setStatus(login, 'error', errorText(err));
    } finally {
      login.running = false;
      if (!login.stopped && !this.destroyed && this.logins.get(key) === login) {
        this.schedule(login, delay);
      }
    }
  }

  private schedule(login: LoginState, delayMs: number): void {
    if (this.destroyed) return;
    if (login.timer) clearTimeout(login.timer);
    login.timer = setTimeout(() => void this.check(login.key), delayMs);
    login.timer.unref?.();
  }

  private drop(key: string): void {
    const login = this.logins.get(key);
    if (login?.timer) clearTimeout(login.timer);
    this.logins.delete(key);
    this.oauth.forgetLogin(key);
    this.logger.debug(`OpenCode Console login removed from monitoring (tenant=${login?.tenantId})`);
  }

  private setStatus(login: LoginState, status: LoginStatus, detail?: string): void {
    const previous = login.status;
    if (previous === status) return;
    login.status = status;
    const who = `tenant=${login.tenantId} ${login.rows
      .map((row) => `${row.provider}/${row.label}`)
      .join(', ')}`;
    if (status === 'signed_out') {
      this.logger.warn(
        `OpenCode Console login is signed out (invalid_grant) for ${who}; ` +
          'monitoring stopped until it is reconnected',
      );
    } else if (status === 'error') {
      this.logger.warn(`OpenCode Console check failed for ${who}: ${detail ?? 'unknown error'}`);
    } else if (previous !== null) {
      this.logger.log(`OpenCode Console check recovered for ${who}`);
    }
  }

  private inScope<T>(row: ConsoleRow, fn: () => Promise<T>): Promise<T> {
    return this.egress
      ? this.egress.runForConnection(row.tenantId, row.provider, row.id, fn)
      : fn();
  }

  /** Active OpenCode subscription rows whose value is a Console OAuth blob. */
  private async loadRows(tenantId?: string): Promise<ConsoleRow[]> {
    if (!this.providerRepo) return [];
    const rows = await this.providerRepo.find({
      where: {
        provider: In([...OPENCODE_PROVIDER_KEYS]),
        auth_type: 'subscription',
        is_active: true,
        ...(tenantId ? { tenant_id: tenantId } : {}),
      },
    });
    const out: ConsoleRow[] = [];
    for (const row of rows) {
      const provider = opencodeCatalogProvider(row.provider);
      if (!provider || !row.api_key_encrypted) continue;
      let raw: string;
      try {
        raw = decryptWithAny(row.api_key_encrypted, getDecryptionSecrets()).plaintext;
      } catch {
        continue; // Undecryptable (rotated secret): nothing to monitor.
      }
      const blob = parseOAuthTokenBlob(raw);
      // A pasted API key or `public` is not a blob: no Console session.
      if (!blob?.t || !blob.r) continue;
      out.push({
        id: row.id,
        tenantId: row.tenant_id,
        provider,
        label: row.label,
        blob,
        loginKey: opencodeLoginKey(row.tenant_id, blob.u, row.label),
      });
    }
    return out;
  }
}

function groupByLogin(rows: ConsoleRow[]): Map<string, ConsoleRow[]> {
  const groups = new Map<string, ConsoleRow[]>();
  for (const row of rows) {
    const group = groups.get(row.loginKey);
    if (group) group.push(row);
    else groups.set(row.loginKey, [row]);
  }
  return groups;
}

function errorText(err: unknown): string {
  return scrubSecrets(err instanceof Error ? err.message : String(err)).slice(0, 300);
}
