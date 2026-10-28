import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import InfoTooltip from './InfoTooltip.js';
import { cx } from './ui.js';
import { formatNumber } from '../services/formatters.js';
import { type ReliabilityStats } from '../services/api/analytics.js';
import { formatRate } from '../services/overview-format.js';
import { intlLocale, t } from '../i18n/index.js';

function fmtPct(v: number): string {
  if (v === 1 || v === 0)
    return new Intl.NumberFormat(intlLocale(), { style: 'percent' }).format(v);
  return formatRate(v);
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return <span className="trend badge">{t('overview.kpi.new')}</span>;
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

export interface ReliabilityKpiCardsProps {
  stats: ReliabilityStats | undefined;
  /** Scopes the deep links to one harness; omitted, they cover every harness. */
  agentName?: string;
  /** The page's current window, carried on the deep links. */
  range?: string;
  /** Hide the deep links entirely (no Requests log to point at). */
  noLinks?: boolean;
}

function Tile({
  label,
  info,
  value,
  trend,
  link,
  title,
  showMore,
  tone,
  onNavigate,
}: {
  label: string;
  info?: string;
  value: string;
  trend: ReactNode;
  link: string | null;
  title?: string;
  showMore?: boolean;
  /** Alert color; set only when the value needs attention (above zero). */
  tone?: 'warn' | 'danger';
  onNavigate: (to: string) => void;
}) {
  const linkProps = link
    ? {
        title,
        role: 'link' as const,
        tabIndex: 0,
        onClick: (event: MouseEvent<HTMLDivElement>) => {
          const interactive =
            event.target instanceof Element &&
            event.target.closest('a, button, input, select, textarea, [role="button"]');
          if (!interactive) onNavigate(link);
        },
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.target === event.currentTarget && event.key === 'Enter') onNavigate(link);
        },
      }
    : {};
  return (
    <div
      className={cx('stat-tile', link && 'cursor-pointer hover:border-line-strong')}
      {...linkProps}
    >
      <span className="stat-label flex items-center gap-1">
        {label}
        {info ? <InfoTooltip text={info} /> : null}
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span
          className={cx(
            'stat-value text-xl font-semibold tabular-nums',
            tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink',
          )}
        >
          {value}
        </span>
        {trend}
        {showMore ? (
          <span className="ml-auto text-xs text-accent">{t('overview.kpi.viewMore')}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The reliability story, request-first: Success rate · Recovered requests %
 * · Recovered by fallback · Failed requests. Recovered = fallback_saves over
 * the window total.
 */
export default function ReliabilityKpiCards({
  stats,
  agentName,
  range,
  noLinks,
}: ReliabilityKpiCardsProps) {
  const navigate = useNavigate();
  if (!stats) return null;

  const requestsLink = (extra: string) => {
    if (noLinks) return null;
    const params = [
      agentName ? `agent=${encodeURIComponent(agentName)}` : '',
      range ? `range=${range}` : '',
      extra.replace(/^&/, ''),
    ]
      .filter(Boolean)
      .join('&');
    return params ? `/messages?${params}` : '/messages';
  };
  const scopeTitle = (subject: string) =>
    agentName
      ? t('overview.kpi.scopeHarness', { subject })
      : t('overview.kpi.scopeAll', { subject });

  const recovered = stats.fallback_saves?.value ?? 0;
  const recoveredPrev = stats.fallback_saves?.previous ?? 0;
  const total = stats.total_requests;
  const recoveredPct = total && total.value !== 0 ? recovered / total.value : 0;
  const recoveredPctPrev = total && total.previous !== 0 ? recoveredPrev / total.previous : 0;
  const showMore = !!requestsLink('');
  const fallbackLink = requestsLink('&status=ok&trigger=fallback');

  return (
    <div className="stat-tiles">
      <Tile
        label={t('overview.kpi.successRate')}
        info={t('overview.tips.requestSuccessRate')}
        value={fmtPct(stats.success_rate.value)}
        trend={
          <TrendBadge current={stats.success_rate.value} previous={stats.success_rate.previous} />
        }
        link={null}
        onNavigate={navigate}
      />
      <Tile
        label={t('overview.kpi.recoveredRequests')}
        info={t('overview.tips.recoveredRequests')}
        value={fmtPct(recoveredPct)}
        trend={<TrendBadge current={recoveredPct} previous={recoveredPctPrev} />}
        link={fallbackLink}
        title={scopeTitle(t('overview.kpi.subjectRecovered'))}
        showMore={showMore}
        onNavigate={navigate}
      />
      <Tile
        label={t('overview.kpi.recoveredByFallback')}
        value={formatNumber(recovered)}
        trend={<TrendBadge current={recovered} previous={recoveredPrev} />}
        link={fallbackLink}
        title={scopeTitle(t('overview.kpi.subjectRecoveredByFallback'))}
        showMore={showMore}
        tone={recovered > 0 ? 'warn' : undefined}
        onNavigate={navigate}
      />
      <Tile
        label={t('overview.kpi.failedRequests')}
        value={formatNumber(stats.errors_remaining.value)}
        trend={
          <TrendBadge
            current={stats.errors_remaining.value}
            previous={stats.errors_remaining.previous}
          />
        }
        link={requestsLink('&status=failed')}
        title={scopeTitle(t('overview.kpi.subjectFailed'))}
        showMore={showMore}
        tone={stats.errors_remaining.value > 0 ? 'danger' : undefined}
        onNavigate={navigate}
      />
    </div>
  );
}
