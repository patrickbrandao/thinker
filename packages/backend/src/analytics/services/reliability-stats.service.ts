import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentMessage } from '../../entities/agent-message.entity';
import {
  rangeToInterval,
  rangeToPreviousInterval,
  isHourlyRange,
} from '../../common/utils/range.util';
import { computeCutoff, sqlHourBucket, sqlDateBucket } from '../../common/utils/postgres-sql';
import {
  addTenantFilter,
  excludePlaygroundAgents,
  sqlIsCompletedStatus,
  sqlIsFailedStatus,
  sqlIsSuccessStatus,
} from './query-helpers';
import { RequestVolumeService, type DispositionTotals } from './request-volume.service';

export interface ReliabilityStatsResponse {
  success_rate: { value: number; previous: number };
  /** Requests recovered by a successful fallback attempt. */
  fallback_saves: { value: number; previous: number };
  /** Window total, denominator for the recovered-requests share. */
  total_requests: { value: number; previous: number };
  errors_remaining: { value: number; previous: number };
}

export const RELIABILITY_TS_DIMENSIONS = [
  'disposition',
  'http_status',
  'provider',
  'error_kind',
] as const;
export type ReliabilityTsDimension = (typeof RELIABILITY_TS_DIMENSIONS)[number];

export interface ReliabilityTimeseriesResponse {
  range: string;
  by: string;
  keys: string[];
  buckets: Array<{ bucket: string; counts: number[] }>;
}

interface WindowCounts {
  total: number;
  successes: number;
  fallback_saves: number;
  errors: number;
}

/**
 * Generic request reliability for the dashboard: success rate, fallback
 * recoveries, request status over time, and per-harness/provider/model
 * reliability. Served under `/api/v1/overview/reliability/*`.
 */
@Injectable()
export class ReliabilityStatsService {
  constructor(
    @InjectRepository(AgentMessage)
    private readonly messageRepo: Repository<AgentMessage>,
    private readonly requestVolume: RequestVolumeService,
  ) {}

  async getStats(params: {
    tenantId: string | null;
    range?: string;
    agentName?: string;
  }): Promise<ReliabilityStatsResponse> {
    const range = params.range ?? '7d';
    const cutoff = computeCutoff(rangeToInterval(range));
    const prevCutoff = computeCutoff(rangeToPreviousInterval(range));

    const windows = await this.requestVolume.getDispositionTotalsForWindows({
      tenantId: params.tenantId,
      from: prevCutoff,
      splitAt: cutoff,
      to: computeCutoff('0 hours'),
      agentName: params.agentName,
    });
    const current = this.windowCounts(windows.current);
    const previous = this.windowCounts(windows.previous);

    const rate = (c: WindowCounts) => (c.total > 0 ? c.successes / c.total : 0);

    return {
      success_rate: { value: rate(current), previous: rate(previous) },
      fallback_saves: { value: current.fallback_saves, previous: previous.fallback_saves },
      total_requests: { value: current.total, previous: previous.total },
      errors_remaining: { value: current.errors, previous: previous.errors },
    };
  }

  /**
   * Attempt-world reliability per CONNECTION: every provider call counts
   * where it ran, by its own outcome, at the grain the dashboards render a
   * row for — (provider, auth_type, key label). Legacy folds match the usage
   * lists: NULL auth_type reads api_key, NULL label reads Default. Fallback
   * recovery is a request concept and deliberately absent here.
   */
  async getPerProviderStats(params: {
    tenantId: string | null;
    range?: string;
    agentName?: string;
  }): Promise<
    Array<{
      provider: string;
      auth_type: string;
      key_label: string;
      attempts: number;
      failed: number;
      succeeded: number;
    }>
  > {
    const range = params.range ?? '7d';
    const cutoff = computeCutoff(rangeToInterval(range));
    const providerExpr = "CASE WHEN at.provider LIKE 'custom:%' THEN 'custom' ELSE at.provider END";
    const authExpr = "COALESCE(at.auth_type, 'api_key')";
    const labelExpr = "COALESCE(at.provider_key_label, 'Default')";
    const qb = this.messageRepo
      .createQueryBuilder('at')
      .select(providerExpr, 'provider')
      .addSelect(authExpr, 'auth_type')
      .addSelect(labelExpr, 'key_label')
      .addSelect('COUNT(*)', 'attempts')
      .addSelect(`COUNT(*) FILTER (WHERE ${sqlIsSuccessStatus('at.status')})`, 'succeeded')
      .addSelect(`COUNT(*) FILTER (WHERE ${sqlIsFailedStatus('at.status')})`, 'failed')
      .where('at.timestamp >= :cutoff', { cutoff })
      .andWhere(sqlIsCompletedStatus('at.status'))
      .groupBy(providerExpr)
      .addGroupBy(authExpr)
      .addGroupBy(labelExpr);
    addTenantFilter(qb, params.tenantId, params.agentName);
    excludePlaygroundAgents(qb);

    const rows = await qb.getRawMany<{
      provider: string;
      auth_type: string;
      key_label: string;
      attempts: string;
      failed: string;
      succeeded: string;
    }>();
    return rows.map((r) => ({
      provider: r.provider,
      auth_type: r.auth_type,
      key_label: r.key_label,
      attempts: Number(r.attempts),
      failed: Number(r.failed),
      succeeded: Number(r.succeeded),
    }));
  }

  async getPerAgentStats(params: { tenantId: string | null; range?: string }): Promise<
    Array<{
      agent_name: string;
      requests: number;
      failed: number;
      fallback_saves: number;
      succeeded: number;
    }>
  > {
    const volume = await this.requestVolume.getVolumeByDimension('agent_name', params);
    return volume.map((v) => ({
      agent_name: v.key,
      requests: v.requests,
      failed: v.failed,
      fallback_saves: v.fallback,
      succeeded: v.succeeded,
    }));
  }

  /**
   * Attempt-world reliability per model: total attempts and their outcomes.
   * Feeds the Model usage tables.
   */
  async getPerModelStats(params: {
    tenantId: string | null;
    range?: string;
    agentName?: string;
  }): Promise<
    Array<{
      model: string;
      attempts: number;
      failed: number;
      succeeded: number;
    }>
  > {
    const range = params.range ?? '7d';
    const cutoff = computeCutoff(rangeToInterval(range));
    const qb = this.messageRepo
      .createQueryBuilder('at')
      .select('at.model', 'model')
      .addSelect('COUNT(*)', 'attempts')
      .addSelect(`COUNT(*) FILTER (WHERE ${sqlIsSuccessStatus('at.status')})`, 'succeeded')
      .addSelect(`COUNT(*) FILTER (WHERE ${sqlIsFailedStatus('at.status')})`, 'failed')
      .where('at.timestamp >= :cutoff', { cutoff })
      .andWhere(sqlIsCompletedStatus('at.status'))
      .andWhere('at.model IS NOT NULL')
      .groupBy('at.model');
    addTenantFilter(qb, params.tenantId, params.agentName);
    excludePlaygroundAgents(qb);

    const rows = await qb.getRawMany<{
      model: string;
      attempts: string;
      failed: string;
      succeeded: string;
    }>();
    return rows.map((r) => ({
      model: r.model,
      attempts: Number(r.attempts),
      failed: Number(r.failed),
      succeeded: Number(r.succeeded),
    }));
  }

  async getTimeseries(params: {
    tenantId: string | null;
    range?: string;
    by?: string;
    agentName?: string;
    failedOnly?: boolean;
  }): Promise<ReliabilityTimeseriesResponse> {
    const range = params.range ?? '7d';
    const by = (RELIABILITY_TS_DIMENSIONS as readonly string[]).includes(params.by ?? '')
      ? (params.by as ReliabilityTsDimension)
      : 'disposition';
    const cutoff = computeCutoff(rangeToInterval(range));
    const hourly = isHourlyRange(range);

    // Disposition counts LOGICAL REQUESTS (terminal-attempt attribution,
    // #2511) so the By request status bars stack to the same total as the
    // Requests KPI and the by-provider/by-harness views. The other dimensions
    // keep their historical per-attempt semantics.
    if (by === 'disposition') {
      const rows = await this.requestVolume.getDispositionTimeseries({
        tenantId: params.tenantId,
        range,
        hourly,
        agentName: params.agentName,
        failedOnly: params.failedOnly,
      });
      return this.pivotTimeseries(range, by, rows);
    }

    const bucketExpr = hourly ? sqlHourBucket('at.timestamp') : sqlDateBucket('at.timestamp');
    const dimExpr = this.dimensionExpr(by);

    const qb = this.messageRepo
      .createQueryBuilder('at')
      .select(bucketExpr, 'bucket')
      .addSelect(dimExpr, 'dim')
      .addSelect('COUNT(*)', 'count')
      .where('at.timestamp >= :cutoff', { cutoff })
      .andWhere(sqlIsCompletedStatus('at.status'));

    if (params.failedOnly) {
      qb.andWhere(sqlIsFailedStatus('at.status'));
    }

    qb.groupBy(bucketExpr).addGroupBy(dimExpr).orderBy(bucketExpr, 'ASC');
    addTenantFilter(qb, params.tenantId, params.agentName);
    excludePlaygroundAgents(qb);

    const rows = await qb.getRawMany<{ bucket: string; dim: string | null; count: string }>();
    return this.pivotTimeseries(range, by, rows);
  }

  private dimensionExpr(by: ReliabilityTsDimension): string {
    switch (by) {
      case 'disposition':
        return `CASE
          WHEN at.status IN ('error','fallback_error','rate_limited') THEN 'error'
          WHEN ${sqlIsSuccessStatus('at.status')} AND at.fallback_from_model IS NOT NULL THEN 'fallback'
          ELSE 'success' END`;
      case 'http_status':
        return `CASE WHEN ${sqlIsSuccessStatus('at.status')} THEN '200'
          ELSE COALESCE(at.error_http_status::text, 'No response') END`;
      case 'provider':
        return `CASE WHEN at.provider LIKE 'custom:%' THEN 'custom' ELSE at.provider END`;
      case 'error_kind':
        return `COALESCE(at.error_class, 'none')`;
    }
  }

  private pivotTimeseries(
    range: string,
    by: string,
    rows: Array<{ bucket: string; dim: string | null; count: string }>,
  ): ReliabilityTimeseriesResponse {
    const keySet = new Set<string>();
    const bucketMap = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const dim = r.dim ?? 'unknown';
      keySet.add(dim);
      let m = bucketMap.get(r.bucket);
      if (!m) {
        m = new Map();
        bucketMap.set(r.bucket, m);
      }
      m.set(dim, (m.get(dim) ?? 0) + Number(r.count));
    }
    // For disposition, use a fixed order: success → fallback → error.
    const DISPOSITION_ORDER: Record<string, number> = {
      success: 0,
      fallback: 1,
      error: 2,
    };
    const keys =
      by === 'disposition'
        ? [...keySet].sort((a, b) => (DISPOSITION_ORDER[a] ?? 99) - (DISPOSITION_ORDER[b] ?? 99))
        : [...keySet].sort();
    const buckets = [...bucketMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, m]) => ({
        bucket,
        counts: keys.map((k) => m.get(k) ?? 0),
      }));
    return { range, by, keys, buckets };
  }

  /**
   * KPI window counts, read from the SAME request-level reducer as the
   * By request status chart (one request, one disposition). One definition,
   * every surface. Pure — the window totals come from a single
   * `getDispositionTotalsForWindows` scan for both the current and previous
   * window.
   */
  private windowCounts(t: DispositionTotals): WindowCounts {
    return {
      total: t.total,
      successes: t.success + t.fallback,
      fallback_saves: t.fallback,
      errors: t.error,
    };
  }
}
