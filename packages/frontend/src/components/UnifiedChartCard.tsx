import { Show, Suspense, lazy, type Component, type JSX } from 'solid-js';
import InfoTooltip from './InfoTooltip.jsx';
import { formatNumber, formatCost } from '../services/formatters.js';
import { type StatusTimeseries } from '../services/api/analytics.js';
import { t } from '../i18n/index.js';

const MultiAgentTokenChart = lazy(() => import('./MultiAgentTokenChart.jsx'));
const ReliabilityChart = lazy(() => import('./ReliabilityChart.jsx'));

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
  seriesFilters?: JSX.Element;
}

const trendBadge = (pct: number) => {
  if (pct === 0) return null;
  const clamped = Math.max(-999, Math.min(999, Math.round(pct)));
  if (clamped === 0) return null;
  const sign = clamped > 0 ? '+' : '';
  return (
    <span class="trend trend--neutral">
      {sign}
      {clamped}%
    </span>
  );
};

const EMPTY = (msg: string) => (
  <div style="height: 260px; color: hsl(var(--muted-foreground)); display: flex; align-items: center; justify-content: center;">
    {msg}
  </div>
);

const UnifiedChartCard: Component<UnifiedChartCardProps> = (props) => {
  const showCost = () => props.costValue != null;

  const tabTitle = (): string => {
    switch (props.activeTab) {
      case 'requests':
        return props.requestsLabel ?? t('overview.chart.requests');
      case 'recovered':
        return t('overview.chart.recoveredRequests');
      case 'cost':
        return t('overview.chart.cost');
      case 'tokens':
        return t('overview.chart.tokenUsage');
    }
  };

  return (
    <div class="chart-card">
      {/* ── Stat header tabs ── */}
      <div class="chart-card__header">
        <button
          type="button"
          class="chart-card__stat chart-card__stat--clickable"
          classList={{ 'chart-card__stat--active': props.activeTab === 'requests' }}
          onClick={() => props.onTabChange('requests')}
        >
          <span class="chart-card__label">
            {props.requestsLabel ?? t('overview.chart.requests')}
            <Show when={props.requestsInfoTooltip}>
              <InfoTooltip text={props.requestsInfoTooltip!} />
            </Show>
          </span>
          <div class="chart-card__value-row">
            <span class="chart-card__value">{formatNumber(props.requestsValue)}</span>
            {trendBadge(props.requestsTrendPct)}
          </div>
        </button>
        <Show when={props.recoveredTimeseries}>
          <button
            type="button"
            class="chart-card__stat chart-card__stat--clickable"
            classList={{ 'chart-card__stat--active': props.activeTab === 'recovered' }}
            onClick={() => props.onTabChange('recovered')}
          >
            <span class="chart-card__label">
              {t('overview.chart.recoveredRequests')}
              <InfoTooltip text={t('overview.tips.recoveredRequests')} />
            </span>
            <div class="chart-card__value-row">
              <span class="chart-card__value">{formatNumber(props.recoveredValue ?? 0)}</span>
              {trendBadge(props.recoveredTrendPct ?? 0)}
            </div>
          </button>
        </Show>
        <Show when={showCost()}>
          <button
            type="button"
            class="chart-card__stat chart-card__stat--clickable"
            classList={{ 'chart-card__stat--active': props.activeTab === 'cost' }}
            onClick={() => props.onTabChange('cost')}
          >
            <span class="chart-card__label">
              {t('overview.chart.cost')}
              <Show when={props.costInfoTooltip}>
                <InfoTooltip text={props.costInfoTooltip!} />
              </Show>
            </span>
            <div class="chart-card__value-row">
              <span class="chart-card__value">{formatCost(props.costValue!) ?? formatCost(0)}</span>
              {trendBadge(props.costTrendPct ?? 0)}
            </div>
          </button>
        </Show>
        <button
          type="button"
          class="chart-card__stat chart-card__stat--clickable"
          classList={{ 'chart-card__stat--active': props.activeTab === 'tokens' }}
          onClick={() => props.onTabChange('tokens')}
        >
          <span class="chart-card__label">{t('overview.chart.tokenUsage')}</span>
          <div class="chart-card__value-row">
            <span class="chart-card__value">{formatNumber(props.tokensValue)}</span>
            {trendBadge(props.tokensTrendPct)}
          </div>
        </button>
      </div>

      {/* ── Subtitle bar: title + contextual filters ── */}
      <div class="chart-card__subtitle">
        <span class="chart-card__subtitle-title">{tabTitle()}</span>
        {/* The grouping filters (by status/provider/harness) only apply to the
            other tabs — recovered is already a fixed fallback subset. */}
        <Show when={props.seriesFilters && props.activeTab !== 'recovered'}>
          <div class="chart-card__filters">{props.seriesFilters}</div>
        </Show>
      </div>

      {/* ── Chart body ── */}
      <div class="chart-card__body">
        <Suspense fallback={EMPTY(t('overview.chart.loading'))}>
          <Show when={props.activeTab === 'requests'}>
            <Show
              when={props.requestStatusTimeseries}
              fallback={
                <Show
                  when={props.agentRequestTimeseries?.agents.length}
                  fallback={EMPTY(t('overview.chart.noRequestData'))}
                >
                  <MultiAgentTokenChart
                    agents={props.agentRequestTimeseries!.agents}
                    timeseries={props.agentRequestTimeseries!.timeseries}
                    range={props.range}
                    colorMap={props.colorMap}
                    // i18n-ignore: chart mode flag, not shown
                    label="Requests"
                  />
                </Show>
              }
            >
              <Show
                when={props.requestStatusTimeseries!.buckets.length > 0}
                fallback={EMPTY(t('overview.chart.noRequestData'))}
              >
                <ReliabilityChart
                  timeseries={props.requestStatusTimeseries!}
                  range={props.range}
                  seriesMode={props.requestStatusSeriesMode ?? 'disposition'}
                />
              </Show>
            </Show>
          </Show>
          <Show when={props.activeTab === 'recovered'}>
            <Show
              when={props.recoveredTimeseries && props.recoveredTimeseries.buckets.length > 0}
              fallback={EMPTY(t('overview.chart.noRecovered'))}
            >
              <ReliabilityChart
                timeseries={props.recoveredTimeseries!}
                range={props.range}
                seriesMode="disposition"
              />
            </Show>
          </Show>
          <Show when={props.activeTab === 'cost'}>
            <Show
              when={props.agentCostTimeseries?.agents.length}
              fallback={EMPTY(t('overview.chart.noCostData'))}
            >
              <MultiAgentTokenChart
                agents={props.agentCostTimeseries!.agents}
                timeseries={props.agentCostTimeseries!.timeseries}
                range={props.range}
                colorMap={props.colorMap}
                // i18n-ignore: chart mode flag, not shown
                label="Cost"
              />
            </Show>
          </Show>
          <Show when={props.activeTab === 'tokens'}>
            <Show
              when={props.agentTimeseries?.agents.length}
              fallback={EMPTY(t('overview.chart.noTokenData'))}
            >
              <MultiAgentTokenChart
                agents={props.agentTimeseries!.agents}
                timeseries={props.agentTimeseries!.timeseries}
                range={props.range}
                colorMap={props.colorMap}
              />
            </Show>
          </Show>
        </Suspense>
      </div>
    </div>
  );
};

export default UnifiedChartCard;
