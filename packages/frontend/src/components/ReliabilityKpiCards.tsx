import { Show, type Component, type JSX } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import InfoTooltip from './InfoTooltip.jsx';
import { formatNumber } from '../services/formatters.js';
// The card grid styles: this component owns the dependency so the agent
// Overview renders styled cards even when loaded directly (deep link/refresh).
import '../styles/analytics-overview.css';
import {
  RECOVERED_REQUESTS_TOOLTIP,
  REQUEST_SUCCESS_RATE_TOOLTIP,
  type ReliabilityStats,
} from '../services/api/analytics.js';

function fmtPct(v: number): string {
  const pct = v * 100;
  return pct === 100 || pct === 0 ? `${pct}%` : `${pct.toFixed(1)}%`;
}

function trendBadge(current: number, previous: number) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return <span class="trend trend--neutral">new</span>;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return null;
  const clamped = Math.max(-999, Math.min(999, Math.round(pct)));
  const sign = clamped > 0 ? '+' : '';
  return (
    <span class="trend trend--neutral">
      {sign}
      {clamped}%
    </span>
  );
}

export interface ReliabilityKpiCardsProps {
  stats: ReliabilityStats | undefined;
  /** Scopes the deep links to one harness; omitted, they cover every harness. */
  agentName?: string;
  /** The page's current window, carried on the deep links. */
  range?: string;
  /** Hide the deep links entirely (no Requests log to point at). */
  noLinks?: boolean;
}

const viewMore = (): JSX.Element => <span class="view-more-link">View more</span>;

/**
 * The reliability story, request-first: Success rate · Recovered requests %
 * · Recovered by fallback · Failed requests. Recovered = fallback_saves over
 * the window total.
 */
const ReliabilityKpiCards: Component<ReliabilityKpiCardsProps> = (props) => {
  const navigate = useNavigate();
  const requestsLink = (extra: string) => {
    if (props.noLinks) return null;
    const params = [
      props.agentName ? `agent=${encodeURIComponent(props.agentName)}` : '',
      props.range ? `range=${props.range}` : '',
      extra.replace(/^&/, ''),
    ]
      .filter(Boolean)
      .join('&');
    return params ? `/messages?${params}` : '/messages';
  };
  const linkProps = (link: string | null, title: string) =>
    link
      ? {
          style: 'cursor: pointer;',
          title,
          role: 'link' as const,
          tabIndex: 0,
          onClick: (event: MouseEvent) => {
            const interactive =
              event.target instanceof Element &&
              event.target.closest('a, button, input, select, textarea, [role="button"]');
            if (!interactive) navigate(link);
          },
          onKeyDown: (event: KeyboardEvent) => {
            if (event.target === event.currentTarget && event.key === 'Enter') navigate(link);
          },
        }
      : {};
  const scopeTitle = (subject: string) =>
    props.agentName ? `View this harness's ${subject}` : `View ${subject} across all harnesses`;
  const recovered = () => props.stats?.fallback_saves?.value ?? 0;
  const recoveredPrev = () => props.stats?.fallback_saves?.previous ?? 0;
  const recoveredPct = () => {
    const s = props.stats;
    if (!s || !s.total_requests || s.total_requests.value === 0) return 0;
    return recovered() / s.total_requests.value;
  };
  const recoveredPctPrev = () => {
    const s = props.stats;
    if (!s || !s.total_requests || s.total_requests.previous === 0) return 0;
    return recoveredPrev() / s.total_requests.previous;
  };

  return (
    <Show when={props.stats}>
      {(s) => (
        <div class="overview-stats">
          <div class="overview-stat-card">
            <span class="overview-stat-card__label">
              Success rate
              <InfoTooltip text={REQUEST_SUCCESS_RATE_TOOLTIP} />
            </span>
            <div class="overview-stat-card__value-row">
              <span class="overview-stat-card__value">{fmtPct(s().success_rate.value)}</span>
              {trendBadge(s().success_rate.value, s().success_rate.previous)}
            </div>
          </div>
          <div
            class="overview-stat-card"
            {...linkProps(
              requestsLink('&status=ok&trigger=fallback'),
              scopeTitle('recovered requests'),
            )}
          >
            <span class="overview-stat-card__label">
              Recovered requests
              <InfoTooltip text={RECOVERED_REQUESTS_TOOLTIP} />
            </span>
            <div class="overview-stat-card__value-row">
              <span class="overview-stat-card__value">{fmtPct(recoveredPct())}</span>
              {trendBadge(recoveredPct(), recoveredPctPrev())}
              <Show when={requestsLink('')}>{viewMore()}</Show>
            </div>
          </div>
          <div
            class="overview-stat-card overview-stat-card--fallback"
            {...linkProps(
              requestsLink('&status=ok&trigger=fallback'),
              scopeTitle('requests recovered by fallback'),
            )}
          >
            <span class="overview-stat-card__label">Recovered by Fallback</span>
            <div class="overview-stat-card__value-row">
              <span class="overview-stat-card__value">{formatNumber(recovered())}</span>
              {trendBadge(recovered(), recoveredPrev())}
              <Show when={requestsLink('')}>{viewMore()}</Show>
            </div>
          </div>
          <div
            class="overview-stat-card overview-stat-card--destructive"
            {...linkProps(requestsLink('&status=failed'), scopeTitle('failed requests'))}
          >
            <span class="overview-stat-card__label">Failed requests</span>
            <div class="overview-stat-card__value-row">
              <span class="overview-stat-card__value">
                {formatNumber(s().errors_remaining.value)}
              </span>
              {trendBadge(s().errors_remaining.value, s().errors_remaining.previous)}
              <Show when={requestsLink('')}>{viewMore()}</Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

export default ReliabilityKpiCards;
