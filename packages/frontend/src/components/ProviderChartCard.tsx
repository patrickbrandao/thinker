import { Suspense, lazy } from 'react';
import { ChartStatTab, chartEmpty } from './UnifiedChartCard.js';
import { formatNumber, formatCost } from '../services/formatters.js';
import { formatRate } from '../services/overview-format.js';
import { t } from '../i18n/index.js';

// uPlot is heavy; lazy-load the chart so it stays out of the initial bundle and
// is only fetched when this card actually renders a chart body.
const MultiAgentTokenChart = lazy(() => import('./MultiAgentTokenChart.js'));

type ProviderView = 'messages' | 'tokens' | 'cost';

/** Neutral trend pill; hidden for a flat trend or a (near) zero value. */
function Trend({ pct, value }: { pct: number; value: number }) {
  if (pct === 0 || Math.abs(value) < 0.005) return null;
  const clamped = Math.max(-999, Math.min(999, Math.round(pct)));
  if (clamped === 0) return null;
  return (
    <span className="trend badge">
      {clamped > 0 ? '+' : ''}
      {clamped}%
    </span>
  );
}

interface AgentTimeseries {
  agents: string[];
  timeseries: Array<Record<string, number | string>>;
}

interface ProviderChartCardProps {
  activeView: ProviderView;
  onViewChange: (view: ProviderView) => void;
  messagesValue: number;
  messagesTrendPct: number;
  requestSuccessRate?: number;
  attemptSuccessRate?: number;
  tokensValue: number;
  tokensTrendPct: number;
  costValue?: number;
  costTrendPct?: number;
  costInfoTooltip?: string;
  range: string;
  agentTimeseries?: AgentTimeseries;
  agentMessageTimeseries?: AgentTimeseries;
  agentCostTimeseries?: AgentTimeseries;
  colorMap?: Record<string, string>;
}

export default function ProviderChartCard(props: ProviderChartCardProps) {
  const showCost = props.costValue != null;

  const requestsInfo =
    props.attemptSuccessRate == null
      ? undefined
      : props.requestSuccessRate == null
        ? t('overview.chart.attemptSuccess', {
            attempt: formatRate(props.attemptSuccessRate / 100),
          })
        : t('overview.chart.callerSuccess', {
            request: formatRate(props.requestSuccessRate / 100),
            attempt: formatRate(props.attemptSuccessRate / 100),
          });

  const chart = (series: AgentTimeseries | undefined, empty: string, label?: string) =>
    series?.agents.length ? (
      <MultiAgentTokenChart
        agents={series.agents}
        timeseries={series.timeseries}
        range={props.range}
        colorMap={props.colorMap}
        label={label}
      />
    ) : (
      chartEmpty(empty)
    );

  return (
    <section className="chart-card panel overflow-hidden">
      <div className="grid grid-cols-2 border-b border-line sm:flex sm:flex-wrap" role="tablist">
        {showCost ? (
          <ChartStatTab
            active={props.activeView === 'cost'}
            label={t('overview.chart.cost')}
            info={props.costInfoTooltip}
            value={formatCost(props.costValue!) ?? formatCost(0)}
            trend={<Trend pct={props.costTrendPct ?? 0} value={props.costValue!} />}
            onClick={() => props.onViewChange('cost')}
          />
        ) : null}
        <ChartStatTab
          active={props.activeView === 'messages'}
          label={t('overview.chart.requests')}
          info={requestsInfo}
          value={props.messagesValue}
          trend={<Trend pct={props.messagesTrendPct} value={props.messagesValue} />}
          onClick={() => props.onViewChange('messages')}
        />
        <ChartStatTab
          active={props.activeView === 'tokens'}
          label={t('overview.chart.tokenUsage')}
          value={formatNumber(props.tokensValue)}
          trend={<Trend pct={props.tokensTrendPct} value={props.tokensValue} />}
          onClick={() => props.onViewChange('tokens')}
        />
      </div>
      <div className="px-2 py-3">
        <Suspense fallback={chartEmpty(t('overview.chart.loading'))}>
          {props.activeView === 'messages'
            ? // i18n-ignore: chart mode flag, not shown
              chart(props.agentMessageTimeseries, t('overview.chart.noRequestData'), 'Requests')
            : props.activeView === 'tokens'
              ? chart(props.agentTimeseries, t('overview.chart.noTokenData'))
              : // i18n-ignore: chart mode flag, not shown
                chart(props.agentCostTimeseries, t('overview.chart.noCostData'), 'Cost')}
        </Suspense>
      </div>
    </section>
  );
}
