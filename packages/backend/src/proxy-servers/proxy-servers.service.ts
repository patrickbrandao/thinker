import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { encrypt, getEncryptionSecret } from '../common/utils/crypto.util';
import { MAX_LOG_RETENTION_DAYS, parseLogRetentionDays } from '../config/recording-retention';
import {
  assertConnectableHost,
  resolveConnectableAddresses,
} from '../common/utils/ssrf-safe-fetch';
import {
  buildProxyAgent,
  classifyProxyError,
  fetchViaProxy,
  getGlobalProxyConfig,
  type EgressHop,
} from '../common/outbound/outbound-proxy';
import { PROVIDER_ENDPOINTS, resolveEndpointKey } from '../routing/proxy/provider-endpoints';
import {
  LOCAL_PROVIDERS,
  PROXY_TARGET_TYPES,
  ProxyEgressService,
  isDebugActive,
  toOutboundProxy,
  type ProxyServerRow,
  type ProxyTargetType,
} from './proxy-egress.service';

export const MAX_CHAIN_ITEMS = 6;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEBUG_DURATIONS: Record<string, number | null> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  forever: null,
};
const TRIGGER_TYPES_WITH_PROXY = new Set(['webhook', 'telegram', 'email']);

export interface ProxyServerInput {
  name?: unknown;
  scheme?: unknown;
  host?: unknown;
  port?: unknown;
  /** 'none' clears username and password. */
  auth?: unknown;
  username?: unknown;
  /** Empty or absent on edit keeps the stored password. */
  password?: unknown;
  enabled?: unknown;
  connect_timeout_ms?: unknown;
  /** 'off' | '1h' | '24h' | '7d' | 'forever' */
  debug?: unknown;
  log_retention_days?: unknown;
}

export interface BindingRef {
  target_type: ProxyTargetType;
  target_id: string;
  label: string;
  /** Chain after "Remove from all": true when no proxy would be left. */
  loses_proxy: boolean;
}

export interface Stats7d {
  connections: number;
  successes: number;
  failures: number;
  avg_tunnel_ms: number | null;
  bytes_sent: number;
  bytes_received: number;
}

function unwrap<T>(result: unknown): T[] {
  return (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];
}

function bad(message: string): never {
  throw new BadRequestException([message]);
}

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** Proxy host: a hostname or IP literal; cloud metadata endpoints are refused. */
export async function validateProxyHost(value: unknown): Promise<string> {
  if (typeof value !== 'string') bad('host is required');
  const host = value.trim().replace(/^\[|\]$/g, '');
  if (!host) bad('host is required');
  if (isIP(host) === 0 && !HOSTNAME_RE.test(host)) {
    bad('host must be a hostname or an IP address, without scheme, port or path');
  }
  try {
    assertConnectableHost(host);
  } catch {
    bad('Cloud metadata addresses cannot be used as a proxy');
  }
  if (isIP(host) === 0) {
    try {
      await resolveConnectableAddresses(host);
    } catch (err) {
      if ((err as { code?: string }).code === 'ESSRFBLOCKED') {
        bad('This host resolves to a cloud metadata address');
      }
      // Unresolvable now: allowed (the proxy may live on a network that only
      // the gateway's runtime can see); checked again at connect time.
    }
  }
  return host.toLowerCase();
}

/**
 * Chain validation: the first item is a proxy, then up to five fallbacks that
 * are proxies or "direct" (at most once, never first); no proxy twice.
 */
export function validateChain(chain: unknown, known: Set<string>): Array<string | null> {
  if (!Array.isArray(chain)) bad('chain must be an array');
  if (chain.length > MAX_CHAIN_ITEMS) bad(`A chain has at most ${MAX_CHAIN_ITEMS} items`);
  const out: Array<string | null> = [];
  const seen = new Set<string>();
  let direct = false;
  chain.forEach((item, index) => {
    if (item === 'direct' || item === null) {
      if (index === 0) bad('The first item of a chain must be a proxy');
      if (direct) bad('"Direct" can appear only once');
      direct = true;
      out.push(null);
      return;
    }
    if (typeof item !== 'string' || !known.has(item)) bad(`Unknown proxy ${String(item)}`);
    if (seen.has(item)) bad('A proxy can appear only once in a chain');
    seen.add(item);
    out.push(item);
  });
  return out;
}

/**
 * Removes or replaces one proxy in a chain. Returns null when no proxy is
 * left (the whole chain goes). A leading "direct" left by the removal is
 * moved behind the next proxy, so the chain still starts with a proxy.
 */
export function rewriteChain(
  chain: Array<string | null>,
  proxyId: string,
  replacement: string | null,
): Array<string | null> | null {
  const out: Array<string | null> = [];
  for (const item of chain) {
    if (item === proxyId) {
      if (replacement && !chain.includes(replacement) && !out.includes(replacement)) {
        out.push(replacement);
      }
      continue;
    }
    out.push(item);
  }
  if (!out.some((item) => item !== null)) return null;
  if (out[0] === null) {
    const next = out.findIndex((item) => item !== null);
    const [proxy] = out.splice(next, 1);
    out.splice(0, 1, proxy!, null);
  }
  return out;
}

@Injectable()
export class ProxyServersService {
  constructor(
    private readonly ds: DataSource,
    private readonly egress: ProxyEgressService,
  ) {}

  // ---------------------------------------------------------------------------
  // Servers
  // ---------------------------------------------------------------------------

  private async rows(tenantId: string, id?: string): Promise<ProxyServerRow[]> {
    return unwrap<ProxyServerRow>(
      await this.ds.query(
        `SELECT * FROM proxy_servers WHERE tenant_id = $1 ${id ? 'AND id = $2' : ''}
          ORDER BY LOWER(name)`,
        id ? [tenantId, id] : [tenantId],
      ),
    );
  }

  private async row(tenantId: string | null, id: string): Promise<ProxyServerRow> {
    const found = tenantId ? (await this.rows(tenantId, id))[0] : undefined;
    if (!found) throw new NotFoundException('Proxy server not found');
    return found;
  }

  private view(row: ProxyServerRow, extra: { binding_count?: number; stats_7d?: Stats7d } = {}) {
    const debug = isDebugActive(row);
    const stats = extra.stats_7d;
    let status: 'disabled' | 'idle' | 'ok' | 'degraded' | 'failing' = 'idle';
    if (!row.enabled) status = 'disabled';
    else if (stats && stats.connections > 0) {
      if (stats.failures === 0) status = 'ok';
      else if (stats.successes === 0) status = 'failing';
      else status = 'degraded';
    }
    return {
      id: row.id,
      name: row.name,
      scheme: row.scheme,
      host: row.host,
      port: Number(row.port),
      username: row.username,
      has_password: !!row.password_encrypted,
      enabled: row.enabled,
      connect_timeout_ms: Number(row.connect_timeout_ms),
      debug_enabled: debug,
      debug_until: debug && row.debug_until ? new Date(row.debug_until).toISOString() : null,
      log_retention_days: row.log_retention_days,
      status,
      binding_count: extra.binding_count ?? 0,
      stats_7d: stats ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private async stats7d(tenantId: string): Promise<Map<string, Stats7d>> {
    const rows = unwrap<{
      proxy_id: string;
      connections: string;
      successes: string;
      failures: string;
      tunnel_sum: string;
      tunnel_samples: string;
      bytes_sent: string;
      bytes_received: string;
    }>(
      await this.ds.query(
        `SELECT proxy_id, SUM(connections) AS connections, SUM(successes) AS successes,
                SUM(failures) AS failures, SUM(tunnel_ms_sum) AS tunnel_sum,
                SUM(tunnel_samples) AS tunnel_samples, SUM(bytes_sent) AS bytes_sent,
                SUM(bytes_received) AS bytes_received
           FROM proxy_usage_daily
          WHERE tenant_id = $1 AND day >= CURRENT_DATE - 6
          GROUP BY proxy_id`,
        [tenantId],
      ),
    );
    const out = new Map<string, Stats7d>();
    for (const r of rows) {
      const samples = Number(r.tunnel_samples);
      out.set(r.proxy_id, {
        connections: Number(r.connections),
        successes: Number(r.successes),
        failures: Number(r.failures),
        avg_tunnel_ms: samples > 0 ? Math.round(Number(r.tunnel_sum) / samples) : null,
        bytes_sent: Number(r.bytes_sent),
        bytes_received: Number(r.bytes_received),
      });
    }
    return out;
  }

  private async bindingCounts(tenantId: string): Promise<Map<string, number>> {
    const rows = unwrap<{ proxy_id: string; count: number }>(
      await this.ds.query(
        `SELECT proxy_id, COUNT(DISTINCT (target_type, target_id))::int AS count
           FROM proxy_bindings WHERE tenant_id = $1 AND proxy_id IS NOT NULL GROUP BY proxy_id`,
        [tenantId],
      ),
    );
    return new Map(rows.map((r) => [r.proxy_id, Number(r.count)]));
  }

  async list(tenantId: string | null) {
    const global = getGlobalProxyConfig();
    const globalView = global ? { url: global.display, no_proxy: global.noProxy.entries } : null;
    if (!tenantId) return { proxies: [], global: globalView };
    const [rows, stats, counts] = await Promise.all([
      this.rows(tenantId),
      this.stats7d(tenantId),
      this.bindingCounts(tenantId),
    ]);
    return {
      proxies: rows.map((row) =>
        this.view(row, { binding_count: counts.get(row.id) ?? 0, stats_7d: stats.get(row.id) }),
      ),
      global: globalView,
    };
  }

  async get(tenantId: string | null, id: string) {
    const row = await this.row(tenantId, id);
    const [stats, bindings] = await Promise.all([
      this.stats7d(row.tenant_id),
      this.bindingsOf(row.tenant_id, id),
    ]);
    return {
      ...this.view(row, { binding_count: bindings.length, stats_7d: stats.get(id) }),
      bindings,
      suggested_test_url: await this.suggestedTestUrl(row.tenant_id, bindings),
    };
  }

  private async assertUniqueName(tenantId: string, name: string, exceptId?: string) {
    const rows = unwrap<{ id: string }>(
      await this.ds.query(
        `SELECT id FROM proxy_servers WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)`,
        [tenantId, name],
      ),
    );
    if (rows.some((r) => r.id !== exceptId)) bad(`A proxy server named "${name}" already exists`);
  }

  private async normalize(input: ProxyServerInput, current?: ProxyServerRow) {
    const out: Partial<ProxyServerRow> & { password?: string | null } = {};
    if (input.name !== undefined || !current) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 100) bad('name is required (at most 100 characters)');
      out.name = name;
    }
    if (input.scheme !== undefined || !current) {
      const scheme = input.scheme ?? 'http';
      if (scheme !== 'http' && scheme !== 'https') bad('scheme must be http or https');
      out.scheme = scheme;
    }
    if (input.host !== undefined || !current) out.host = await validateProxyHost(input.host);
    if (input.port !== undefined || !current) {
      const port = Number(input.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) bad('port must be 1-65535');
      out.port = port;
    }
    if (input.auth === 'none') {
      out.username = null;
      out.password = null;
    } else {
      if (input.username !== undefined) {
        if (input.username !== null && typeof input.username !== 'string') bad('Invalid username');
        const username = (input.username ?? '').trim();
        if (username.length > 255) bad('username is too long');
        out.username = username || null;
      }
      if (typeof input.password === 'string' && input.password !== '') {
        if (input.password.length > 1024) bad('password is too long');
        out.password = input.password;
      } else if (input.password !== undefined && input.password !== null && input.password !== '') {
        bad('Invalid password');
      }
      const username = out.username !== undefined ? out.username : (current?.username ?? null);
      if (!username && out.password) bad('A password needs a username');
      if (!username && current?.password_encrypted && out.password === undefined) {
        out.password = null;
      }
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') bad('enabled must be a boolean');
      out.enabled = input.enabled;
    }
    if (input.connect_timeout_ms !== undefined || !current) {
      const timeout =
        input.connect_timeout_ms === undefined || input.connect_timeout_ms === null
          ? DEFAULT_TIMEOUT_MS
          : Number(input.connect_timeout_ms);
      if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
        bad(`connect_timeout_ms must be ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}`);
      }
      out.connect_timeout_ms = timeout;
    }
    if (input.debug !== undefined) {
      if (input.debug === 'off' || input.debug === false) {
        out.debug_enabled = false;
        out.debug_until = null;
      } else {
        const key = input.debug === true ? '24h' : String(input.debug);
        if (!(key in DEBUG_DURATIONS)) bad('debug must be off, 1h, 24h, 7d or forever');
        const ms = DEBUG_DURATIONS[key];
        out.debug_enabled = true;
        out.debug_until = ms === null ? null : new Date(Date.now() + ms).toISOString();
      }
    }
    if (input.log_retention_days !== undefined) {
      const parsed = parseLogRetentionDays(input.log_retention_days);
      if (parsed === undefined) {
        bad(`log_retention_days must be null or an integer from 1 to ${MAX_LOG_RETENTION_DAYS}`);
      }
      out.log_retention_days = parsed;
    }
    return out;
  }

  async create(tenantId: string, userId: string | null, input: ProxyServerInput) {
    const data = await this.normalize(input);
    await this.assertUniqueName(tenantId, data.name!);
    const id = randomUUID();
    await this.ds.query(
      `INSERT INTO proxy_servers
         (id, tenant_id, name, scheme, host, port, username, password_encrypted, enabled,
          connect_timeout_ms, debug_enabled, debug_until, log_retention_days, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        tenantId,
        data.name,
        data.scheme,
        data.host,
        data.port,
        data.username ?? null,
        data.password ? encrypt(data.password, getEncryptionSecret()) : null,
        data.enabled ?? true,
        data.connect_timeout_ms,
        data.debug_enabled ?? false,
        data.debug_until ?? null,
        data.log_retention_days ?? null,
        userId,
      ],
    );
    this.egress.invalidate(tenantId);
    return this.get(tenantId, id);
  }

  async update(tenantId: string | null, id: string, input: ProxyServerInput) {
    const current = await this.row(tenantId, id);
    const data = await this.normalize(input, current);
    if (data.name) await this.assertUniqueName(current.tenant_id, data.name, id);
    const sets: string[] = [];
    const params: unknown[] = [id, current.tenant_id];
    const set = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`"${column}" = $${params.length}`);
    };
    for (const column of [
      'name',
      'scheme',
      'host',
      'port',
      'username',
      'enabled',
      'connect_timeout_ms',
      'debug_enabled',
      'debug_until',
      'log_retention_days',
    ] as const) {
      if (data[column] !== undefined) set(column, data[column]);
    }
    if (data.password !== undefined) {
      set(
        'password_encrypted',
        data.password ? encrypt(data.password, getEncryptionSecret()) : null,
      );
    }
    sets.push('updated_at = NOW()');
    await this.ds.query(
      `UPDATE proxy_servers SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2`,
      params,
    );
    this.egress.invalidate(current.tenant_id);
    return this.get(current.tenant_id, id);
  }

  // ---------------------------------------------------------------------------
  // Removal
  // ---------------------------------------------------------------------------

  private async chainsUsing(
    manager: EntityManager | DataSource,
    tenantId: string,
    proxyId: string,
  ): Promise<
    Array<{ target_type: ProxyTargetType; target_id: string; chain: Array<string | null> }>
  > {
    const rows = unwrap<{
      target_type: ProxyTargetType;
      target_id: string;
      position: number;
      proxy_id: string | null;
    }>(
      await manager.query(
        `SELECT b.target_type, b.target_id, b.position, b.proxy_id
           FROM proxy_bindings b
          WHERE b.tenant_id = $1 AND (b.target_type, b.target_id) IN (
            SELECT target_type, target_id FROM proxy_bindings WHERE tenant_id = $1 AND proxy_id = $2)
          ORDER BY b.target_type, b.target_id, b.position`,
        [tenantId, proxyId],
      ),
    );
    const chains = new Map<
      string,
      { target_type: ProxyTargetType; target_id: string; chain: Array<string | null> }
    >();
    for (const row of rows) {
      const key = `${row.target_type}:${row.target_id}`;
      const entry = chains.get(key) ?? {
        target_type: row.target_type,
        target_id: row.target_id,
        chain: [],
      };
      entry.chain.push(row.proxy_id);
      chains.set(key, entry);
    }
    return [...chains.values()];
  }

  /** Bindings of a proxy with display labels. */
  async bindingsOf(tenantId: string, proxyId: string): Promise<BindingRef[]> {
    const chains = await this.chainsUsing(this.ds, tenantId, proxyId);
    const labels = await this.targetLabels(
      tenantId,
      chains.map((c) => ({ type: c.target_type, id: c.target_id })),
    );
    return chains.map((c) => ({
      target_type: c.target_type,
      target_id: c.target_id,
      label: labels.get(`${c.target_type}:${c.target_id}`) ?? c.target_id,
      loses_proxy: rewriteChain(c.chain, proxyId, null) === null,
    }));
  }

  private async targetLabels(
    tenantId: string,
    targets: Array<{ type: string; id: string }>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = (type: string) => targets.filter((t) => t.type === type).map((t) => t.id);
    for (const id of ids('provider'))
      out.set(`provider:${id}`, await this.providerLabel(tenantId, id));
    const connections = ids('connection');
    if (connections.length > 0) {
      for (const r of unwrap<{ id: string; provider: string; label: string }>(
        await this.ds.query(
          `SELECT id, provider, label FROM tenant_providers WHERE tenant_id = $1 AND id = ANY($2)`,
          [tenantId, connections],
        ),
      )) {
        out.set(
          `connection:${r.id}`,
          `${await this.providerLabel(tenantId, r.provider)} / ${r.label}`,
        );
      }
    }
    const triggers = ids('trigger');
    if (triggers.length > 0) {
      for (const r of unwrap<{ id: string; name: string }>(
        await this.ds.query(`SELECT id, name FROM triggers WHERE tenant_id = $1 AND id = ANY($2)`, [
          tenantId,
          triggers,
        ]),
      )) {
        out.set(`trigger:${r.id}`, r.name);
      }
    }
    const emails = ids('email_config');
    if (emails.length > 0) {
      for (const r of unwrap<{ id: string; provider: string }>(
        await this.ds.query(
          `SELECT id, provider FROM email_provider_configs WHERE tenant_id = $1 AND id = ANY($2)`,
          [tenantId, emails],
        ),
      )) {
        out.set(`email_config:${r.id}`, `E-mail (${r.provider})`);
      }
    }
    return out;
  }

  private async providerLabel(tenantId: string, provider: string): Promise<string> {
    if (!provider.startsWith('custom:')) return provider;
    const rows = unwrap<{ name: string }>(
      await this.ds
        .query(`SELECT name FROM custom_providers WHERE id = $1 AND tenant_id = $2`, [
          provider.slice('custom:'.length),
          tenantId,
        ])
        .catch(() => []),
    );
    return rows[0]?.name ?? provider;
  }

  /**
   * Deletes a proxy. With bindings and no mode: 409 listing them. `remove`
   * drops it from every chain, `replace` puts `replaceWith` in its place;
   * the proxy is then deleted in the same transaction.
   */
  async remove(
    tenantId: string | null,
    id: string,
    mode?: string,
    replaceWith?: string,
  ): Promise<{ deleted: true; affected: number }> {
    const row = await this.row(tenantId, id);
    const tenant = row.tenant_id;
    const bindings = await this.bindingsOf(tenant, id);
    if (bindings.length > 0 && mode !== 'remove' && mode !== 'replace') {
      throw new ConflictException({
        statusCode: 409,
        error: 'proxy_in_use',
        message: 'This proxy server is used by outbound proxy chains',
        bindings,
      });
    }
    if (mode === 'replace') {
      if (!replaceWith || replaceWith === id) bad('replace_with must be another proxy server');
      await this.row(tenant, replaceWith);
    }
    let affected = 0;
    await this.ds.transaction(async (manager) => {
      const chains = await this.chainsUsing(manager, tenant, id);
      for (const c of chains) {
        const next = rewriteChain(c.chain, id, mode === 'replace' ? replaceWith! : null);
        await this.writeChain(manager, tenant, c.target_type, c.target_id, next ?? []);
        affected++;
      }
      await manager.query(`DELETE FROM proxy_servers WHERE id = $1 AND tenant_id = $2`, [
        id,
        tenant,
      ]);
    });
    this.egress.invalidate(tenant);
    return { deleted: true, affected };
  }

  // ---------------------------------------------------------------------------
  // Bindings
  // ---------------------------------------------------------------------------

  private async writeChain(
    manager: EntityManager | DataSource,
    tenantId: string,
    targetType: string,
    targetId: string,
    chain: Array<string | null>,
  ) {
    await manager.query(
      `DELETE FROM proxy_bindings WHERE tenant_id = $1 AND target_type = $2 AND target_id = $3`,
      [tenantId, targetType, targetId],
    );
    for (let i = 0; i < chain.length; i++) {
      await manager.query(
        `INSERT INTO proxy_bindings (tenant_id, target_type, target_id, position, proxy_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, targetType, targetId, i + 1, chain[i]],
      );
    }
  }

  private parseTargetType(value: string): ProxyTargetType {
    if (!(PROXY_TARGET_TYPES as readonly string[]).includes(value)) {
      throw new NotFoundException('Unknown binding target');
    }
    return value as ProxyTargetType;
  }

  /** Checks the bound object exists in the workspace and may have a proxy. */
  private async assertTarget(
    tenantId: string,
    type: ProxyTargetType,
    id: string,
  ): Promise<{ provider?: string }> {
    switch (type) {
      case 'provider': {
        const name = id.toLowerCase();
        if (LOCAL_PROVIDERS.has(name)) bad('Local providers do not use outbound proxies');
        if (!/^[a-z0-9:._-]{1,120}$/.test(name)) bad('Invalid provider');
        return { provider: name };
      }
      case 'connection': {
        const rows = unwrap<{ provider: string; auth_type: string }>(
          await this.ds.query(
            `SELECT provider, auth_type FROM tenant_providers WHERE id = $1 AND tenant_id = $2`,
            [id, tenantId],
          ),
        );
        if (!rows[0]) throw new NotFoundException('Connection not found');
        if (rows[0].auth_type === 'local' || LOCAL_PROVIDERS.has(rows[0].provider)) {
          bad('Local providers do not use outbound proxies');
        }
        return { provider: rows[0].provider };
      }
      case 'trigger': {
        const rows = unwrap<{ type: string }>(
          await this.ds.query(`SELECT type FROM triggers WHERE id = $1 AND tenant_id = $2`, [
            id,
            tenantId,
          ]),
        );
        if (!rows[0]) throw new NotFoundException('Trigger not found');
        if (!TRIGGER_TYPES_WITH_PROXY.has(rows[0].type)) {
          bad('Only webhook, Telegram and e-mail triggers use outbound proxies');
        }
        return {};
      }
      case 'email_config': {
        const rows = unwrap<{ id: string }>(
          await this.ds.query(
            `SELECT id FROM email_provider_configs WHERE id = $1 AND tenant_id = $2`,
            [id, tenantId],
          ),
        );
        if (!rows[0]) throw new NotFoundException('E-mail configuration not found');
        return {};
      }
    }
  }

  private async chainView(tenantId: string, type: string, id: string) {
    const rows = unwrap<{ proxy_id: string | null; name: string | null; enabled: boolean | null }>(
      await this.ds.query(
        `SELECT b.proxy_id, p.name, p.enabled FROM proxy_bindings b
           LEFT JOIN proxy_servers p ON p.id = b.proxy_id
          WHERE b.tenant_id = $1 AND b.target_type = $2 AND b.target_id = $3
          ORDER BY b.position`,
        [tenantId, type, id],
      ),
    );
    return rows.map((r) =>
      r.proxy_id === null
        ? { kind: 'direct' as const, proxy_id: null, name: 'Direct', enabled: true }
        : {
            kind: 'proxy' as const,
            proxy_id: r.proxy_id,
            name: r.name ?? '',
            enabled: !!r.enabled,
          },
    );
  }

  /**
   * The chain bound to an object, plus the effective outbound path: own chain
   * > provider chain (connections) > global proxy > direct.
   */
  async getBinding(tenantId: string | null, targetType: string, targetId: string) {
    const type = this.parseTargetType(targetType);
    if (!tenantId) throw new NotFoundException('Binding target not found');
    const target = await this.assertTarget(tenantId, type, targetId);
    const id = type === 'provider' ? targetId.toLowerCase() : targetId;
    const chain = await this.chainView(tenantId, type, id);
    let inherited: Awaited<ReturnType<ProxyServersService['chainView']>> = [];
    if (type === 'connection' && target.provider) {
      inherited = await this.chainView(tenantId, 'provider', target.provider.toLowerCase());
    }
    const global = getGlobalProxyConfig();
    const effective =
      chain.length > 0
        ? { source: type, chain }
        : inherited.length > 0
          ? { source: 'provider' as const, chain: inherited }
          : global
            ? { source: 'global' as const, chain: [], global: global.display }
            : { source: 'direct' as const, chain: [] };
    return {
      target_type: type,
      target_id: id,
      mode: chain.length > 0 ? 'own' : 'inherit',
      chain,
      inherited_chain: type === 'connection' ? inherited : undefined,
      effective,
    };
  }

  async setBinding(tenantId: string | null, targetType: string, targetId: string, body: unknown) {
    const type = this.parseTargetType(targetType);
    if (!tenantId) throw new NotFoundException('Binding target not found');
    await this.assertTarget(tenantId, type, targetId);
    const id = type === 'provider' ? targetId.toLowerCase() : targetId;
    const raw = (body as { chain?: unknown } | null)?.chain ?? [];
    const known = new Set((await this.rows(tenantId)).map((r) => r.id));
    const chain = validateChain(raw, known);
    await this.ds.transaction((manager) => this.writeChain(manager, tenantId, type, id, chain));
    this.egress.invalidate(tenantId);
    return this.getBinding(tenantId, type, id);
  }

  // ---------------------------------------------------------------------------
  // Test
  // ---------------------------------------------------------------------------

  private async suggestedTestUrl(tenantId: string, bindings: BindingRef[]): Promise<string | null> {
    for (const b of bindings) {
      if (b.target_type === 'trigger') {
        const rows = unwrap<{ type: string; config: Record<string, unknown> | string }>(
          await this.ds.query(
            `SELECT type, config FROM triggers WHERE id = $1 AND tenant_id = $2`,
            [b.target_id, tenantId],
          ),
        );
        const row = rows[0];
        if (!row) continue;
        const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
        if (row.type === 'telegram') return 'https://api.telegram.org/';
        if (
          row.type === 'webhook' &&
          typeof config.url === 'string' &&
          !config.url.includes('{{')
        ) {
          return config.url;
        }
        continue;
      }
      let provider: string | null = null;
      if (b.target_type === 'provider') provider = b.target_id;
      if (b.target_type === 'connection') {
        const rows = unwrap<{ provider: string }>(
          await this.ds.query(`SELECT provider FROM tenant_providers WHERE id = $1`, [b.target_id]),
        );
        provider = rows[0]?.provider ?? null;
      }
      if (provider?.startsWith('custom:')) {
        const rows = unwrap<{ base_url: string }>(
          await this.ds
            .query(`SELECT base_url FROM custom_providers WHERE id = $1 AND tenant_id = $2`, [
              provider.slice('custom:'.length),
              tenantId,
            ])
            .catch(() => []),
        );
        if (rows[0]?.base_url) return rows[0].base_url;
        continue;
      }
      const key = provider ? resolveEndpointKey(provider) : null;
      const endpoint = key ? PROVIDER_ENDPOINTS[key] : undefined;
      if (endpoint?.baseUrl) return `${endpoint.baseUrl}/`;
    }
    return null;
  }

  /**
   * GET through this proxy (even disabled) with a fresh tunnel, so the tunnel
   * latency is measured. No periodic health check exists (no phone-home).
   */
  async test(tenantId: string | null, id: string, body: { url?: unknown } | undefined) {
    const row = await this.row(tenantId, id);
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      bad('url must be an absolute http:// or https:// URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      bad('url must be an absolute http:// or https:// URL');
    }
    const proxy = { ...toOutboundProxy(row), enabled: true, version: `test-${randomUUID()}` };
    const dispatcher = buildProxyAgent(proxy);
    const startedAt = new Date();
    const started = performance.now();
    const destination = `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`;
    let hop: EgressHop;
    try {
      const { response, tunnelMs } = await fetchViaProxy(
        proxy,
        parsed.href,
        {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(proxy.connectTimeoutMs + 15_000),
        },
        dispatcher,
      );
      await response.body?.cancel().catch(() => undefined);
      hop = {
        kind: 'proxy',
        proxy_id: row.id,
        name: row.name,
        position: 1,
        result: 'ok',
        ms: Math.round(performance.now() - started),
        tunnel_ms: tunnelMs,
        status: response.status,
      };
    } catch (err) {
      const cls = classifyProxyError(err);
      const message =
        cls?.message ??
        (err instanceof Error
          ? `${err.message}${err.cause instanceof Error ? `: ${err.cause.message}` : ''}`
          : String(err));
      hop = {
        kind: 'proxy',
        proxy_id: row.id,
        name: row.name,
        position: 1,
        result:
          cls?.result ??
          (err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'error'),
        ms: Math.round(performance.now() - started),
        tunnel_ms: null,
        status: cls?.status ?? null,
        error: message.slice(0, 300),
      };
    } finally {
      void dispatcher.close().catch(() => undefined);
    }
    await this.egress
      .record({
        scope: {
          tenantId: row.tenant_id,
          sourceType: 'test',
          sourceId: null,
          sourceLabel: 'Test',
          chain: null,
          hops: [],
        },
        hop,
        proxy,
        destination,
        startedAt,
        bytesSent: 0,
        bytesReceived: 0,
      })
      .catch(() => undefined);
    return {
      ok: hop.result === 'ok',
      result: hop.result,
      status: hop.status,
      tunnel_ms: hop.tunnel_ms,
      total_ms: hop.ms,
      error: hop.error ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Logs and statistics
  // ---------------------------------------------------------------------------

  async logs(
    tenantId: string | null,
    id: string,
    query: {
      result?: string;
      source_type?: string;
      from?: string;
      to?: string;
      before?: string;
      limit?: string;
    },
  ) {
    const row = await this.row(tenantId, id);
    const params: unknown[] = [row.tenant_id, id];
    const where = ['tenant_id = $1', 'proxy_id = $2'];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (query.result === 'ok') where.push(`result = 'ok'`);
    else if (query.result === 'failure') where.push(`result <> 'ok'`);
    else if (query.result) add('result = ?', query.result);
    if (query.source_type) add('source_type = ?', query.source_type);
    const date = (value: string | undefined, name: string) => {
      if (!value) return undefined;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) bad(`${name} must be a date`);
      return d.toISOString();
    };
    const from = date(query.from, 'from');
    const to = date(query.to, 'to');
    const before = date(query.before, 'before');
    if (from) add('started_at >= ?', from);
    if (to) add('started_at <= ?', to);
    if (before) add('started_at < ?', before);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const logs = unwrap<Record<string, unknown> & { started_at: string }>(
      await this.ds.query(
        `SELECT id, proxy_name, started_at, duration_ms, tunnel_ms, source_type, source_id,
                source_label, destination, position, result, status_code, bytes_sent,
                bytes_received, request_id, agent_message_id, error
           FROM proxy_logs WHERE ${where.join(' AND ')}
          ORDER BY started_at DESC LIMIT ${limit + 1}`,
        params,
      ),
    ).map((l) => ({
      ...l,
      bytes_sent: Number(l.bytes_sent),
      bytes_received: Number(l.bytes_received),
    }));
    const hasMore = logs.length > limit;
    return {
      logs: logs.slice(0, limit),
      next_before: hasMore ? new Date(String(logs[limit - 1]!.started_at)).toISOString() : null,
    };
  }

  async stats(tenantId: string | null, id: string, daysParam?: string) {
    const row = await this.row(tenantId, id);
    const days = Math.min(Math.max(Number(daysParam) || 30, 1), 365);
    const params = [row.tenant_id, id, days - 1];
    const daily = unwrap<Record<string, string>>(
      await this.ds.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(connections) AS connections,
                SUM(successes) AS successes, SUM(failures) AS failures,
                SUM(tunnel_ms_sum) AS tunnel_sum, SUM(tunnel_samples) AS tunnel_samples,
                MAX(tunnel_ms_max) AS tunnel_max, SUM(bytes_sent) AS bytes_sent,
                SUM(bytes_received) AS bytes_received, SUM(fallback_uses) AS fallback_uses
           FROM proxy_usage_daily
          WHERE tenant_id = $1 AND proxy_id = $2 AND day >= CURRENT_DATE - $3::int
          GROUP BY day ORDER BY day`,
        params,
      ),
    );
    const bySource = unwrap<Record<string, string>>(
      await this.ds.query(
        `SELECT source_type, source_id, SUM(connections) AS connections,
                SUM(successes) AS successes, SUM(failures) AS failures,
                SUM(bytes_sent) AS bytes_sent, SUM(bytes_received) AS bytes_received,
                SUM(fallback_uses) AS fallback_uses
           FROM proxy_usage_daily
          WHERE tenant_id = $1 AND proxy_id = $2 AND day >= CURRENT_DATE - $3::int
          GROUP BY source_type, source_id ORDER BY SUM(connections) DESC`,
        params,
      ),
    );
    const codes = unwrap<{ code: string; count: string }>(
      await this.ds.query(
        `SELECT kv.key AS code, SUM((kv.value)::int) AS count
           FROM proxy_usage_daily u, jsonb_each_text(u.failures_by_code) kv
          WHERE u.tenant_id = $1 AND u.proxy_id = $2 AND u.day >= CURRENT_DATE - $3::int
          GROUP BY kv.key ORDER BY SUM((kv.value)::int) DESC`,
        params,
      ),
    );
    const labels = await this.targetLabels(
      row.tenant_id,
      bySource
        .filter((s) => s.source_type !== 'test')
        .map((s) => ({ type: s.source_type!, id: s.source_id! })),
    );
    const n = (v: string | undefined) => Number(v ?? 0);
    return {
      days,
      daily: daily.map((d) => ({
        day: d.day,
        connections: n(d.connections),
        successes: n(d.successes),
        failures: n(d.failures),
        avg_tunnel_ms:
          n(d.tunnel_samples) > 0 ? Math.round(n(d.tunnel_sum) / n(d.tunnel_samples)) : null,
        max_tunnel_ms: n(d.tunnel_max),
        bytes_sent: n(d.bytes_sent),
        bytes_received: n(d.bytes_received),
        fallback_uses: n(d.fallback_uses),
      })),
      by_source: bySource.map((s) => ({
        source_type: s.source_type,
        source_id: s.source_id || null,
        label:
          s.source_type === 'test'
            ? 'Test'
            : (labels.get(`${s.source_type}:${s.source_id}`) ?? s.source_id ?? ''),
        connections: n(s.connections),
        successes: n(s.successes),
        failures: n(s.failures),
        bytes_sent: n(s.bytes_sent),
        bytes_received: n(s.bytes_received),
        fallback_uses: n(s.fallback_uses),
      })),
      failures_by_code: Object.fromEntries(codes.map((c) => [c.code, n(c.count)])),
    };
  }
}
