import { useMemo, useState } from 'react';
import { t } from '../../i18n/index.js';
import { useResource } from '../../lib/use-resource.js';
import type { StatusTimeseries } from '../../services/api/analytics.js';
import { getProxyStats, type ProxyStats } from '../../services/api/proxies.js';
import { formatNumber } from '../../services/formatters.js';
import ErrorState from '../ErrorState.js';
import ReliabilityChart from '../ReliabilityChart.js';
import { Badge, Panel, Skel } from '../ui.js';
import { formatBytes, resultLabel, sourceTypeLabel } from './ProxyParts.js';

const DAY_OPTIONS = [7, 30, 90] as const;

function totalsOf(stats: ProxyStats) {
  let connections = 0;
  let successes = 0;
  let failures = 0;
  let sent = 0;
  let received = 0;
  let fallback = 0;
  let tunnelSum = 0;
  let tunnelWeight = 0;
  let maxTunnel: number | null = null;
  for (const d of stats.daily) {
    connections += d.connections;
    successes += d.successes;
    failures += d.failures;
    sent += d.bytes_sent;
    received += d.bytes_received;
    fallback += d.fallback_uses;
    if (d.avg_tunnel_ms != null && d.successes > 0) {
      tunnelSum += d.avg_tunnel_ms * d.successes;
      tunnelWeight += d.successes;
    }
    if (d.max_tunnel_ms != null) maxTunnel = Math.max(maxTunnel ?? 0, d.max_tunnel_ms);
  }
  return {
    connections,
    successes,
    failures,
    sent,
    received,
    fallback,
    avgTunnel: tunnelWeight ? Math.round(tunnelSum / tunnelWeight) : null,
    maxTunnel,
  };
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

/** Stats tab of a proxy: daily connections (kept after log cleanup), failures by code, by source. */
export default function ProxyStatsTab({ proxyId }: { proxyId: string }) {
  const [days, setDays] = useState<number>(30);
  const stats = useResource(() => getProxyStats(proxyId, days), [proxyId, days]);
  const data = stats.data;

  const series = useMemo<StatusTimeseries | null>(() => {
    if (!data) return null;
    return {
      range: `${days}d`,
      by: 'disposition',
      keys: ['success', 'error'],
      buckets: data.daily.map((d) => ({ bucket: d.day, counts: [d.successes, d.failures] })),
    };
  }, [data, days]);

  const ms = (v: number | null) => (v == null ? '—' : t('proxies.common.ms', { ms: v }));

  return (
    <div className="flex flex-col gap-4">
      <div className="segmented w-fit" role="radiogroup" aria-label={t('proxies.stats.period')}>
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={days === d}
            aria-pressed={days === d}
            onClick={() => setDays(d)}
          >
            {t('proxies.stats.lastDays', { days: d })}
          </button>
        ))}
      </div>

      {stats.error ? (
        <ErrorState error={stats.error} onRetry={() => void stats.reload()} />
      ) : !data ? (
        <Skel width="100%" height={260} />
      ) : (
        <>
          {(() => {
            const tot = totalsOf(data);
            return (
              <div className="stat-tiles">
                <Tile
                  label={t('proxies.stats.connections')}
                  value={formatNumber(tot.connections)}
                />
                <Tile label={t('proxies.stats.successes')} value={formatNumber(tot.successes)} />
                <Tile label={t('proxies.stats.failures')} value={formatNumber(tot.failures)} />
                <Tile label={t('proxies.stats.avgTunnel')} value={ms(tot.avgTunnel)} />
                <Tile label={t('proxies.stats.maxTunnel')} value={ms(tot.maxTunnel)} />
                <Tile
                  label={t('proxies.stats.bytes')}
                  value={`${formatBytes(tot.sent)} / ${formatBytes(tot.received)}`}
                />
                <Tile label={t('proxies.stats.fallback')} value={formatNumber(tot.fallback)} />
              </div>
            );
          })()}

          <Panel title={t('proxies.stats.perDay')}>
            {series && data.daily.length > 0 ? (
              <ReliabilityChart timeseries={series} range={series.range} seriesMode="disposition" />
            ) : (
              <p className="m-0 text-sm text-muted">{t('proxies.stats.empty')}</p>
            )}
          </Panel>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <Panel title={t('proxies.stats.failuresByCode')} bodyClassName="p-0">
              {Object.keys(data.failures_by_code).length === 0 ? (
                <p className="m-0 px-4 py-4 text-sm text-muted">{t('proxies.stats.noFailures')}</p>
              ) : (
                <table className="data">
                  <tbody>
                    {Object.entries(data.failures_by_code)
                      .sort((a, b) => b[1] - a[1])
                      .map(([code, n]) => (
                        <tr key={code}>
                          <td>
                            <Badge tone="danger">{resultLabel(code)}</Badge>
                          </td>
                          <td className="num">{formatNumber(n)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title={t('proxies.stats.bySource')} bodyClassName="p-0">
              {data.by_source.length === 0 ? (
                <p className="m-0 px-4 py-4 text-sm text-muted">{t('proxies.stats.empty')}</p>
              ) : (
                <div className="table-wrap rounded-none border-0">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>{t('proxies.logs.source')}</th>
                        <th className="num">{t('proxies.stats.connections')}</th>
                        <th className="num">{t('proxies.stats.failures')}</th>
                        <th className="num">{t('proxies.stats.fallback')}</th>
                        <th className="num">{t('proxies.stats.bytes')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_source.map((row) => (
                        <tr key={`${row.source_type}:${row.source_id ?? ''}`}>
                          <td>
                            <span className="inline-flex items-center gap-1.5">
                              <Badge>{sourceTypeLabel(row.source_type)}</Badge>
                              <span className="text-ink">{row.label ?? row.source_id ?? '—'}</span>
                            </span>
                          </td>
                          <td className="num">{formatNumber(row.connections)}</td>
                          <td className="num">{formatNumber(row.failures)}</td>
                          <td className="num">{formatNumber(row.fallback_uses)}</td>
                          <td className="num whitespace-nowrap text-xs">
                            {formatBytes(row.bytes_sent)} / {formatBytes(row.bytes_received)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
