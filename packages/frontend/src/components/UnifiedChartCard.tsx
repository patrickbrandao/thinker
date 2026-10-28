import { Suspense, lazy, type ReactNode } from 'react';
import InfoTooltip from './InfoTooltip.js';
import { cx } from './ui.js';
import { formatNumber, formatCost } from '../services/formatters.js';
import { type StatusTimeseries } from '../services/api/analytics.js';
import { t } from '../i18n/index.js';

// uPlot is heavy: the charts load on demand, outside the initial bundle.
const MultiAgentTokenChart = lazy(() => import('./MultiAgentTokenChart.js'));
const ReliabilityChart = lazy(() => import('./ReliabilityChart.js'));

export type ChartTab = 'requests' | 'recovered' | 'cost' | 'tokens';

interface AgentTimeseries {
  agents: string[];
  timeseries: Array<Record<string, number | string>>;
}

export interface UnifiedChartCardProps {
  activeTab: ChartTab;
  onTabChange: (tab: ChartTab) => void;
  // Requests tab
  /** Tab label override: the connection pages count ATTEMPTS, not requests. */
  requestsLabel?: string;
  /** Optional ⓘ next to the requests/attempts tab label. */
  requestsInfoTooltip?: string;
  requestsValue: number;
  requestsTrendPct: number;
  agentRequestTimeseries?: AgentTimeseries;
  /** When set, the Requests tab shows this (disposition) instead of agentRequestTimeseries */
  requestStatusTimeseries?: StatusTimeseries;
  /** Series mode for the status chart (colors/labels): disposition by default. */
  requestStatusSeriesMode?: string;
  // Recovered requests tab (the subset recovered by fallback).
  // The tab renders only when the timeseries is provided.
  recoveredValue?: number;
  recoveredTrendPct?: number;
  recoveredTimeseries?: StatusTimeseries;
  // Cost tab
  costValue?: number;
  costTrendPct?: number;
  costInfoTooltip?: string;
  agentCostTimeseries?: AgentTimeseries;
  // Token usage tab
  tokensValue: number;
  tokensTrendPct: number;
  agentTimeseries?: AgentTimeseries;
  // Shared
  range: string;
  colorMap?: Record<string, string>;
  /** Filter controls rendered in the subtitle bar */
  seriesFilters?: ReactNode;
}

/** Neutral trend pill (+12%), clamped to ±999%; nothing for a flat trend. */
export function TrendBadge({ pct }: { pct: number }) {
  if (pct === 0) return null;
  const clamped = Math.max(-999, Math.min(999, Math.round(pct)));
  if (clamped === 0) return null;
  return (
    <span className="trend badge">
      {clamped > 0 ? '+' : ''}
      {clamped}%
    </span>
  );
}

/** One stat in a chart card header; clicking it switches the chart view. */
export function ChartStatTab({
  active,
  label,
  info,
  value,
  trend,
  onClick,
}: {
  active: boolean;
  label: ReactNode;
  info?: string;
  value: ReactNode;
  trend?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cx(
        'chart-card__stat flex min-w-0 flex-col items-start gap-1 border-b-2 px-4 py-3 text-left transition-colors',
        active ? 'is-active border-accent bg-s2' : 'border-transparent hover:bg-s2',
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-1 text-xs text-muted">
        {label}
        {info ? <InfoTooltip text={info} /> : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-semibold tabular-nums text-ink">{value}</span>
        {trend}
      </span>
    </button>
  );
}

export const chartEmpty = (msg: string) => (
  <div className="flex h-[260px] items-center justify-center text-sm text-muted">{msg}</div>
);

/**
 * The overview chart card: stat tabs (requests, recovered, cost, tokens) over
 * one chart body. Each tab picks its series; filters sit in the subtitle bar.
 */
export default function UnifiedChartCard(props: UnifiedChartCardProps) {
  const showCost = props.costValue != null;
  const requestsLabel = props.requestsLabel ?? t('overview.chart.requests');

  const tabTitle = {
    requests: requestsLabel,
    recovered: t('overview.chart.recoveredRequests'),
    cost: t('overview.chart.cost'),
    tokens: t('overview.chart.tokenUsage'),
  }[props.activeTab];

  const requestsBody = () => {
    const status = props.requestStatusTimeseries;
    if (status) {
      return status.buckets.length > 0 ? (
        <ReliabilityChart
          timeseries={status}
          range={props.range}
          seriesMode={props.requestStatusSeriesMode ?? 'disposition'}
        />
      ) : (
        chartEmpty(t('overview.chart.noRequestData'))
      );
    }
    const agents = props.agentRequestTimeseries;
    return agents?.agents.length ? (
      <MultiAgentTokenChart
        agents={agents.agents}
        timeseries={agents.timeseries}
        range={props.range}
        colorMap={props.colorMap}
        // i18n-ignore: chart mode flag, not shown
        label="Requests"
      />
    ) : (
      chartEmpty(t('overview.chart.noRequestData'))
    );
  };

  const body = () => {
    switch (props.activeTab) {
      case 'requests':
        return requestsBody();
      case 'recovered':
        return props.recoveredTimeseries && props.recoveredTimeseries.buckets.length > 0 ? (
          <ReliabilityChart
            timeseries={props.recoveredTimeseries}
            range={props.range}
            seriesMode="disposition"
          />
        ) : (
          chartEmpty(t('overview.chart.noRecovered'))
        );
      case 'cost':
        return props.agentCostTimeseries?.agents.length ? (
          <MultiAgentTokenChart
            agents={props.agentCostTimeseries.agents}
            timeseries={props.agentCostTimeseries.timeseries}
            range={props.range}
            colorMap={props.colorMap}
            // i18n-ignore: chart mode flag, not shown
            label="Cost"
          />
        ) : (
          chartEmpty(t('overview.chart.noCostData'))
        );
      case 'tokens':
        return props.agentTimeseries?.agents.length ? (
          <MultiAgentTokenChart
            agents={props.agentTimeseries.agents}
            timeseries={props.agentTimeseries.timeseries}
            range={props.range}
            colorMap={props.colorMap}
          />
        ) : (
          chartEmpty(t('overview.chart.noTokenData'))
        );
    }
  };

  return (
    <section className="chart-card panel overflow-hidden">
      <div
        className="grid grid-cols-2 border-b border-line sm:flex sm:flex-wrap"
        role="tablist"
        aria-label={tabTitle}
      >
        <ChartStatTab
          active={props.activeTab === 'requests'}
          label={requestsLabel}
          info={props.requestsInfoTooltip}
          value={formatNumber(props.requestsValue)}
          trend={<TrendBadge pct={props.requestsTrendPct} />}
          onClick={() => props.onTabChange('requests')}
        />
        {props.recoveredTimeseries ? (
          <ChartStatTab
            active={props.activeTab === 'recovered'}
            label={t('overview.chart.recoveredRequests')}
            info={t('overview.tips.recoveredRequests')}
            value={formatNumber(props.recoveredValue ?? 0)}
            trend={<TrendBadge pct={props.recoveredTrendPct ?? 0} />}
            onClick={() => props.onTabChange('recovered')}
          />
        ) : null}
        {showCost ? (
          <ChartStatTab
            active={props.activeTab === 'cost'}
            label={t('overview.chart.cost')}
            info={props.costInfoTooltip}
            value={formatCost(props.costValue!) ?? formatCost(0)}
            trend={<TrendBadge pct={props.costTrendPct ?? 0} />}
            onClick={() => props.onTabChange('cost')}
          />
        ) : null}
        <ChartStatTab
          active={props.activeTab === 'tokens'}
          label={t('overview.chart.tokenUsage')}
          value={formatNumber(props.tokensValue)}
          trend={<TrendBadge pct={props.tokensTrendPct} />}
          onClick={() => props.onTabChange('tokens')}
        />
      </div>

      {/* Subtitle bar: title + contextual filters. The grouping filters do not
          apply to the recovered tab, which is already a fixed fallback subset. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <span className="text-sm font-semibold text-ink">{tabTitle}</span>
        {props.seriesFilters && props.activeTab !== 'recovered' ? (
          <div className="flex flex-wrap items-center gap-2">{props.seriesFilters}</div>
        ) : null}
      </div>

      <div className="px-2 pb-3">
        <Suspense fallback={chartEmpty(t('overview.chart.loading'))}>{body()}</Suspense>
      </div>
    </section>
  );
}
