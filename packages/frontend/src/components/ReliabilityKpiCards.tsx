import type { ReactNode } from 'react';
import { cx } from './ui.js';
import { formatCost, formatNumber } from '../services/formatters.js';
import { type ReliabilityStats, type StatusTimeseries } from '../services/api/analytics.js';
import { formatRate } from '../services/overview-format.js';
import { intlLocale, t } from '../i18n/index.js';

/** The card that drives the chart below the cards. */
export type KpiView = 'requests' | 'cost' | 'tokens' | 'recovered' | 'failed';

/** Request statuses each requests-world card keeps; absent = every status. */
const FILTER_KEYS: Partial<Record<KpiView, string[]>> = {
  recovered: ['fallback'],
  failed: ['error'],
};

/** The chart tab a card opens: the request cards all open the requests chart. */
export function kpiChartTab(view: KpiView): 'requests' | 'cost' | 'tokens' {
  return view === 'cost' || view === 'tokens' ? view : 'requests';
}

/** The chart title for a card: the card's own label (Cost names its unit). */
export function kpiChartTitle(view: KpiView): string {
  switch (view) {
    case 'requests':
      return t('overview.kpi.successfulRequests');
    case 'cost':
      return t('overview.chart.costUsd');
    case 'tokens':
      return t('overview.chart.tokenUsage');
    case 'recovered':
      return t('overview.kpi.recoveredRequests');
    case 'failed':
      return t('overview.kpi.failedRequests');
  }
}

/** Where a card's data lives: the Requests log, scoped like the page. */
export interface KpiDetailsScope {
  agentName?: string;
  connectionId?: string;
  range?: string;
}

/**
 * The Requests-log report behind the chart a card opens (the old "View more"
 * targets): recovered → fallback-rescued, failed → failed, the rest → every
 * request of the scope and window.
 */
export function kpiDetailsHref(view: KpiView, scope: KpiDetailsScope = {}): string {
  const extra =
    view === 'recovered' ? 'status=ok&trigger=fallback' : view === 'failed' ? 'status=failed' : '';
  const params = [
    scope.agentName ? `agent=${encodeURIComponent(scope.agentName)}` : '',
    scope.connectionId ? `connections=${encodeURIComponent(scope.connectionId)}` : '',
    scope.range ? `range=${encodeURIComponent(scope.range)}` : '',
    extra,
  ]
    .filter(Boolean)
    .join('&');
  return params ? `/messages?${params}` : '/messages';
}

/** The request-status series narrowed to the statuses a card stands for. */
export function applyKpiFilter(
  ts: StatusTimeseries | undefined,
  view: KpiView,
): StatusTimeseries | undefined {
  const keep = FILTER_KEYS[view];
  if (!ts || !keep) return ts;
  const picked = ts.keys.map((k, i) => ({ k, i })).filter(({ k }) => keep.includes(k));
  return {
    ...ts,
    keys: picked.map(({ k }) => k),
    buckets: ts.buckets.map((b) => ({
      bucket: b.bucket,
      counts: picked.map(({ i }) => b.counts[i] ?? 0),
    })),
  };
}

function fmtPct(v: number): string {
  if (v === 1 || v === 0)
    return new Intl.NumberFormat(intlLocale(), { style: 'percent' }).format(v);
  return formatRate(v);
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return null;
  const clamped = Math.max(-999, Math.min(999, Math.round(pct)));
  return (
    <span className="trend badge">
      {clamped > 0 ? '+' : ''}
      {clamped}%
    </span>
  );
}

/** Trend pill from a precomputed percentage (cost and token totals). */
function PctBadge({ pct }: { pct: number }) {
  const clamped = Math.max(-999, Math.min(999, Math.round(pct)));
  if (clamped === 0) return null;
  return (
    <span className="trend badge">
      {clamped > 0 ? '+' : ''}
      {clamped}%
    </span>
  );
}

/** A usage total shown as a card (value + trend in percent). */
export interface KpiUsage {
  value: number;
  trendPct: number;
}

export interface ReliabilityKpiCardsProps {
  stats: ReliabilityStats | undefined;
  /** Window cost; omitted, the Cost card is hidden (no cost to show). */
  cost?: KpiUsage;
  /** Window token usage; omitted, the Token usage card is hidden. */
  tokens?: KpiUsage;
  /** The card currently driving the chart. */
  selected?: KpiView;
  /** Clicking a card switches the chart to its view. */
  onSelect?: (view: KpiView) => void;
}

function Tile({
  id,
  label,
  value,
  secondary,
  trend,
  tone,
  selected,
  onSelect,
}: {
  id: KpiView;
  label: string;
  value: string;
  /** Muted text right after the value, e.g. the share of all requests. */
  secondary?: string;
  trend: ReactNode;
  /** Alert color; set only when the value needs attention (above zero). */
  tone?: 'warn' | 'danger';
  selected: boolean;
  onSelect?: (view: KpiView) => void;
}) {
  const valueTone = tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink';
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className={cx('stat-value text-xl font-semibold tabular-nums', valueTone)}>
          {value}
        </span>
        {secondary ? (
          <span className="stat-secondary text-sm tabular-nums text-muted">{secondary}</span>
        ) : null}
        {trend}
      </div>
    </>
  );
  if (!onSelect) return <div className="stat-tile">{body}</div>;
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        'stat-tile cursor-pointer text-left',
        selected ? 'is-selected' : 'hover:border-line-strong',
      )}
      onClick={() => onSelect(id)}
    >
      {body}
    </button>
  );
}

/**
 * The overview cards, request-first: Successful requests · Cost · Token usage
 * · Recovered requests · Failed requests. Recovered = fallback_saves over the
 * window total. Each card picks what the chart below shows.
 */
export default function ReliabilityKpiCards({
  stats,
  cost,
  tokens,
  selected,
  onSelect,
}: ReliabilityKpiCardsProps) {
  if (!stats && !cost && !tokens) return null;

  // Cost and tokens come with the critical overview; the request cards show a
  // dash until the reliability stats for this scope land.
  const pending = '—';
  const recovered = stats?.fallback_saves?.value ?? 0;
  const recoveredPrev = stats?.fallback_saves?.previous ?? 0;
  const total = stats?.total_requests;
  const failed = stats?.errors_remaining ?? { value: 0, previous: 0 };
  const recoveredPct = total && total.value !== 0 ? recovered / total.value : 0;
  const recoveredPctPrev = total && total.previous !== 0 ? recoveredPrev / total.previous : 0;
  const successful = Math.max(0, (total?.value ?? 0) - failed.value);
  const successfulPrev = Math.max(0, (total?.previous ?? 0) - failed.previous);
  const tile = (id: KpiView) => ({ id, onSelect, selected: selected === id });

  return (
    <div className="stat-tiles">
      <Tile
        {...tile('requests')}
        label={t('overview.kpi.successfulRequests')}
        value={stats ? formatNumber(successful) : pending}
        secondary={stats ? fmtPct(stats.success_rate.value) : undefined}
        trend={<TrendBadge current={successful} previous={successfulPrev} />}
      />
      {cost ? (
        <Tile
          {...tile('cost')}
          label={t('overview.chart.cost')}
          value={formatCost(cost.value) ?? formatCost(0)!}
          trend={<PctBadge pct={cost.trendPct} />}
        />
      ) : null}
      {tokens ? (
        <Tile
          {...tile('tokens')}
          label={t('overview.chart.tokenUsage')}
          value={formatNumber(tokens.value)}
          trend={<PctBadge pct={tokens.trendPct} />}
        />
      ) : null}
      <Tile
        {...tile('recovered')}
        label={t('overview.kpi.recoveredRequests')}
        value={stats ? formatNumber(recovered) : pending}
        secondary={stats ? fmtPct(recoveredPct) : undefined}
        trend={<TrendBadge current={recoveredPct} previous={recoveredPctPrev} />}
        tone={recovered > 0 ? 'warn' : undefined}
      />
      <Tile
        {...tile('failed')}
        label={t('overview.kpi.failedRequests')}
        value={stats ? formatNumber(failed.value) : pending}
        trend={<TrendBadge current={failed.value} previous={failed.previous} />}
        tone={failed.value > 0 ? 'danger' : undefined}
      />
    </div>
  );
}
