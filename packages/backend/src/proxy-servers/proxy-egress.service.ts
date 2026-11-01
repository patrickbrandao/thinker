import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { decryptWithAny, getDecryptionSecrets } from '../common/utils/crypto.util';
import {
  clearProxyAgentCache,
  runWithOutboundScope,
  setOutboundHopSink,
  type EgressItem,
  type HopEvent,
  type OutboundProxy,
  type OutboundScope,
} from '../common/outbound/outbound-proxy';

export const PROXY_TARGET_TYPES = ['provider', 'connection', 'trigger', 'email_config'] as const;
export type ProxyTargetType = (typeof PROXY_TARGET_TYPES)[number];
export type ProxyMode = 'global' | 'direct' | 'profile';
/** Provider defaults are kept apart for local, usage-based and subscription connections. */
export type ProviderAuthKind = 'local' | 'api_key' | 'subscription';

export function providerTargetId(kind: ProviderAuthKind, provider: string): string {
  return `${kind}:${provider.toLowerCase()}`;
}

export function authKindOf(authType: string | null | undefined): ProviderAuthKind {
  if (authType === 'local') return 'local';
  return authType === 'subscription' ? 'subscription' : 'api_key';
}

/** Local server types; the default of every server of a type is `local:<type>`. */
export const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'llamacpp']);

/**
 * Provider part of a connection's default target: local servers (custom
 * providers with a `local_type`) share the default of their type.
 */
export function defaultTargetOf(
  kind: ProviderAuthKind,
  provider: string,
  localType?: string | null,
): string {
  return providerTargetId(kind, kind === 'local' && localType ? localType : provider);
}

export interface ProxyServerRow {
  id: string;
  tenant_id: string;
  name: string;
  scheme: 'http' | 'https';
  host: string;
  port: number;
  username: string | null;
  password_encrypted: string | null;
  enabled: boolean;
  connect_timeout_ms: number;
  debug_enabled: boolean;
  debug_until: string | Date | null;
  log_retention_days: number | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface ConnectionMeta {
  provider: string;
  auth_type: string;
  label: string;
}

interface Assignment {
  mode: ProxyMode;
  profile_id: string | null;
}

interface Snapshot {
  proxies: Map<string, OutboundProxy>;
  /** Profile id → ordered proxy ids (null = Direct). */
  profiles: Map<string, Array<string | null>>;
  /** `${target_type}:${target_id}` → how the object leaves. */
  assignments: Map<string, Assignment>;
  connections: Map<string, ConnectionMeta>;
  /** `custom:<id>` → local server type. */
  localTypes: Map<string, string>;
}

const SNAPSHOT_TTL_MS = 30_000;
const SNAPSHOT_LIMIT = 2_000;

export function isDebugActive(row: Pick<ProxyServerRow, 'debug_enabled' | 'debug_until'>): boolean {
  if (!row.debug_enabled) return false;
  if (row.debug_until === null) return true;
  return new Date(row.debug_until).getTime() > Date.now();
}

export function decryptProxyPassword(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decryptWithAny(stored, getDecryptionSecrets()).plaintext;
  } catch {
    return null;
  }
}

export function toOutboundProxy(row: ProxyServerRow): OutboundProxy {
  return {
    id: row.id,
    name: row.name,
    scheme: row.scheme === 'https' ? 'https' : 'http',
    host: row.host,
    port: Number(row.port),
    username: row.username,
    password: decryptProxyPassword(row.password_encrypted),
    enabled: row.enabled,
    connectTimeoutMs: Number(row.connect_timeout_ms),
    debug: isDebugActive(row),
    version: new Date(row.updated_at).toISOString(),
  };
}

function unwrap<T>(result: unknown): T[] {
  return (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as T[];
}

/**
 * Resolves the outbound proxy chain of each bound object (cached per
 * workspace, invalidated on every change) and stores what the outbound helper
 * reports: proxy logs (failures, or everything in debug) and the daily rollup.
 */
@Injectable()
export class ProxyEgressService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProxyEgressService.name);
  private readonly snapshots = new Map<string, { data: Promise<Snapshot>; expiresAt: number }>();
  /** Last snapshot that loaded, used when a reload fails (stale beats direct). */
  private readonly lastGood = new Map<string, Snapshot>();

  constructor(private readonly ds: DataSource) {}

  onModuleInit(): void {
    setOutboundHopSink((event) => {
      void this.record(event).catch((err) =>
        this.logger.warn(
          `Failed to record proxy usage: ${err instanceof Error ? err.message : err}`,
        ),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    setOutboundHopSink(null);
    await clearProxyAgentCache();
  }

  invalidate(tenantId: string): void {
    this.snapshots.delete(tenantId);
  }

  private snapshot(tenantId: string): Promise<Snapshot> {
    const cached = this.snapshots.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const data = this.load(tenantId).then(
      (snap) => {
        this.lastGood.set(tenantId, snap);
        return snap;
      },
      (err: unknown) => {
        const stale = this.lastGood.get(tenantId);
        if (stale) return stale;
        throw err;
      },
    );
    if (this.lastGood.size > SNAPSHOT_LIMIT) {
      const first = this.lastGood.keys().next().value;
      if (first !== undefined) this.lastGood.delete(first);
    }
    if (this.snapshots.size >= SNAPSHOT_LIMIT) {
      const first = this.snapshots.keys().next().value;
      if (first !== undefined) this.snapshots.delete(first);
    }
    this.snapshots.set(tenantId, { data, expiresAt: Date.now() + SNAPSHOT_TTL_MS });
    data.catch(() => this.snapshots.delete(tenantId));
    return data;
  }

  private async load(tenantId: string): Promise<Snapshot> {
    const [proxies, bindings, assignments, connections, locals] = await Promise.all([
      this.ds.query(`SELECT * FROM proxy_servers WHERE tenant_id = $1`, [tenantId]),
      this.ds.query(
        `SELECT target_id, position, proxy_id FROM proxy_bindings
          WHERE tenant_id = $1 AND target_type = 'profile' ORDER BY target_id, position`,
        [tenantId],
      ),
      this.ds.query(
        `SELECT target_type, target_id, mode, profile_id FROM proxy_assignments WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.ds.query(
        `SELECT id, provider, auth_type, label FROM tenant_providers WHERE tenant_id = $1`,
        [tenantId],
      ),
      this.ds.query(
        `SELECT 'custom:' || id AS id, local_type FROM custom_providers
          WHERE tenant_id = $1 AND local_type IS NOT NULL`,
        [tenantId],
      ),
    ]);
    const snap: Snapshot = {
      proxies: new Map(),
      profiles: new Map(),
      assignments: new Map(),
      connections: new Map(),
      localTypes: new Map(),
    };
    for (const row of unwrap<ProxyServerRow>(proxies))
      snap.proxies.set(row.id, toOutboundProxy(row));
    for (const row of unwrap<{ target_id: string; proxy_id: string | null }>(bindings)) {
      const list = snap.profiles.get(row.target_id) ?? [];
      list.push(row.proxy_id);
      snap.profiles.set(row.target_id, list);
    }
    for (const row of unwrap<Assignment & { target_type: string; target_id: string }>(
      assignments,
    )) {
      snap.assignments.set(`${row.target_type}:${row.target_id}`, {
        mode: row.mode,
        profile_id: row.profile_id,
      });
    }
    for (const row of unwrap<ConnectionMeta & { id: string }>(connections)) {
      snap.connections.set(row.id, row);
    }
    for (const row of unwrap<{ id: string; local_type: string }>(locals ?? [])) {
      snap.localTypes.set(row.id.toLowerCase(), row.local_type.toLowerCase());
    }
    return snap;
  }

  private items(snap: Snapshot, ids: Array<string | null> | undefined): EgressItem[] | null {
    if (!ids || ids.length === 0) return null;
    const items: EgressItem[] = [];
    for (const id of ids) {
      if (id === null) {
        items.push({ kind: 'direct' });
        continue;
      }
      const proxy = snap.proxies.get(id);
      if (proxy) items.push({ kind: 'proxy', proxy });
    }
    return items.length > 0 ? items : null;
  }

  /** Chain of an assignment: null for global (or an empty profile), [Direct] for direct. */
  private resolve(snap: Snapshot, assignment: Assignment): EgressItem[] | null {
    if (assignment.mode === 'direct') return [{ kind: 'direct' }];
    if (assignment.mode === 'profile' && assignment.profile_id) {
      return this.items(snap, snap.profiles.get(assignment.profile_id));
    }
    return null;
  }

  async chainFor(
    tenantId: string,
    targetType: ProxyTargetType,
    targetId: string,
  ): Promise<EgressItem[] | null> {
    const snap = await this.snapshot(tenantId);
    const assignment = snap.assignments.get(`${targetType}:${targetId}`);
    return assignment ? this.resolve(snap, assignment) : null;
  }

  /**
   * Scope of a provider connection: its own assignment, else the default of
   * its provider (usage-based or subscription), else the global proxy.
   * Without a connection (OAuth flows) `authKind` picks the provider default.
   * Local servers use the default of their type (`local:<type>`).
   */
  async scopeForConnection(
    tenantId: string | null | undefined,
    provider: string,
    connectionId: string | null | undefined,
    authKind?: ProviderAuthKind,
  ): Promise<OutboundScope> {
    const providerName = provider.toLowerCase();
    if (!tenantId) {
      return {
        tenantId: null,
        sourceType: 'provider',
        sourceId: providerName,
        sourceLabel: providerName,
        chain: null,
        hops: [],
      };
    }
    try {
      const snap = await this.snapshot(tenantId);
      const conn = connectionId ? snap.connections.get(connectionId) : undefined;
      const name = (conn?.provider ?? providerName).toLowerCase();
      const label = conn ? `${name} / ${conn.label}` : name;
      const own = connectionId ? snap.assignments.get(`connection:${connectionId}`) : undefined;
      const kind = conn
        ? authKindOf(conn.auth_type)
        : LOCAL_PROVIDERS.has(name)
          ? 'local'
          : (authKind ?? 'api_key');
      const target = defaultTargetOf(kind, name, snap.localTypes.get(name));
      const assignment = own ?? snap.assignments.get(`provider:${target}`);
      return {
        tenantId,
        sourceType: connectionId ? 'connection' : 'provider',
        sourceId: connectionId ?? name,
        sourceLabel: label,
        chain: assignment ? this.resolve(snap, assignment) : null,
        hops: [],
      };
    } catch (err) {
      // Never loaded for this workspace (database down): no known binding.
      this.logger.warn(
        `Could not resolve the outbound proxy chain: ${err instanceof Error ? err.message : err}`,
      );
      return {
        tenantId,
        sourceType: 'provider',
        sourceId: providerName,
        sourceLabel: providerName,
        chain: null,
        hops: [],
      };
    }
  }

  async scopeForTarget(
    tenantId: string,
    targetType: 'trigger' | 'email_config',
    targetId: string,
    label: string,
  ): Promise<OutboundScope> {
    return {
      tenantId,
      sourceType: targetType,
      sourceId: targetId,
      sourceLabel: label,
      chain: await this.chainFor(tenantId, targetType, targetId),
      hops: [],
    };
  }

  /** Runs `fn` with the connection's (or provider's) chain active. */
  async runForConnection<T>(
    tenantId: string | null | undefined,
    provider: string,
    connectionId: string | null | undefined,
    fn: () => Promise<T>,
    authKind?: ProviderAuthKind,
  ): Promise<T> {
    const scope = await this.scopeForConnection(tenantId, provider, connectionId, authKind);
    return runWithOutboundScope(scope, fn);
  }

  /** Stores one use of a workspace proxy. */
  async record(event: HopEvent): Promise<void> {
    const tenantId = event.scope.tenantId;
    if (!tenantId) return;
    const { hop, proxy, scope } = event;
    const success = hop.result === 'ok';
    if (!success || proxy.debug || scope.sourceType === 'test') {
      await this.ds.query(
        `INSERT INTO proxy_logs
           (id, tenant_id, proxy_id, proxy_name, started_at, duration_ms, tunnel_ms, source_type,
            source_id, source_label, destination, position, result, status_code, bytes_sent,
            bytes_received, request_id, agent_message_id, error)
         SELECT $1, $2, p.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
           FROM (SELECT $3::varchar AS wanted) w
           LEFT JOIN proxy_servers p ON p.id = w.wanted`,
        [
          randomUUID(),
          tenantId,
          proxy.id,
          proxy.name,
          event.startedAt.toISOString(),
          hop.ms,
          hop.tunnel_ms,
          scope.sourceType,
          scope.sourceId,
          scope.sourceLabel,
          event.destination,
          hop.position,
          hop.result,
          hop.status,
          event.bytesSent,
          event.bytesReceived,
          scope.requestId ?? null,
          scope.agentMessageId ?? null,
          hop.error ?? null,
        ],
      );
    }
    const day = event.startedAt.toISOString().slice(0, 10);
    const tunnel = hop.tunnel_ms;
    await this.ds.query(
      `INSERT INTO proxy_usage_daily
         (tenant_id, proxy_id, proxy_name, day, source_type, source_id, connections, successes,
          failures, failures_by_code, tunnel_ms_sum, tunnel_ms_max, tunnel_samples, bytes_sent,
          bytes_received, fallback_uses)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (tenant_id, proxy_id, day, source_type, source_id) DO UPDATE SET
         proxy_name = EXCLUDED.proxy_name,
         connections = proxy_usage_daily.connections + 1,
         successes = proxy_usage_daily.successes + EXCLUDED.successes,
         failures = proxy_usage_daily.failures + EXCLUDED.failures,
         failures_by_code = CASE WHEN EXCLUDED.failures > 0 THEN
           proxy_usage_daily.failures_by_code || jsonb_build_object($16::text,
             COALESCE((proxy_usage_daily.failures_by_code ->> $16::text)::int, 0) + 1)
           ELSE proxy_usage_daily.failures_by_code END,
         tunnel_ms_sum = proxy_usage_daily.tunnel_ms_sum + EXCLUDED.tunnel_ms_sum,
         tunnel_ms_max = GREATEST(proxy_usage_daily.tunnel_ms_max, EXCLUDED.tunnel_ms_max),
         tunnel_samples = proxy_usage_daily.tunnel_samples + EXCLUDED.tunnel_samples,
         bytes_sent = proxy_usage_daily.bytes_sent + EXCLUDED.bytes_sent,
         bytes_received = proxy_usage_daily.bytes_received + EXCLUDED.bytes_received,
         fallback_uses = proxy_usage_daily.fallback_uses + EXCLUDED.fallback_uses`,
      [
        tenantId,
        proxy.id,
        proxy.name,
        day,
        scope.sourceType,
        scope.sourceId ?? '',
        success ? 1 : 0,
        success ? 0 : 1,
        JSON.stringify(success ? {} : { [hop.result]: 1 }),
        tunnel ?? 0,
        tunnel ?? 0,
        tunnel === null ? 0 : 1,
        event.bytesSent,
        event.bytesReceived,
        hop.position > 1 ? 1 : 0,
        hop.result,
      ],
    );
  }

  /** Debug turns itself off once its duration expires. */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'proxy-debug-expiry' })
  async expireDebug(): Promise<void> {
    try {
      const rows = unwrap<{ tenant_id: string }>(
        await this.ds.query(
          `UPDATE proxy_servers SET debug_enabled = false, debug_until = NULL, updated_at = NOW()
            WHERE debug_enabled AND debug_until IS NOT NULL AND debug_until < NOW()
            RETURNING tenant_id`,
        ),
      );
      for (const row of rows) this.invalidate(row.tenant_id);
    } catch (err) {
      this.logger.warn(`Proxy debug expiry failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
