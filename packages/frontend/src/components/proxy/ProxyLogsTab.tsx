import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { RotateCw } from 'lucide-react';
import { t } from '../../i18n/index.js';
import {
  listProxyLogs,
  PROXY_RESULT_CODES,
  PROXY_SOURCE_TYPES,
  type ProxyDetail,
  type ProxyLog,
} from '../../services/api/proxies.js';
import { formatDateTime, formatDuration } from '../../services/formatters.js';
import ErrorState from '../ErrorState.js';
import { Badge, Button, EmptyState } from '../ui.js';
import { formatBytes, resultLabel, sourceTypeLabel } from './ProxyParts.js';

const PAGE_SIZE = 50;
const PERIODS = ['24h', '7d', '30d', 'all'] as const;
type Period = (typeof PERIODS)[number];
const PERIOD_MS: Record<Period, number | null> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  all: null,
};

/** Logs tab of a proxy: one row per connection sent to it, newest first. */
export default function ProxyLogsTab({ proxy }: { proxy: ProxyDetail }) {
  const [result, setResult] = useState('');
  const [source, setSource] = useState('');
  const [period, setPeriod] = useState<Period>('7d');
  const [logs, setLogs] = useState<ProxyLog[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);

  const filters = useCallback(() => {
    const ms = PERIOD_MS[period];
    return {
      result: result || undefined,
      source_type: source || undefined,
      from: ms ? new Date(Date.now() - ms).toISOString() : undefined,
      limit: PAGE_SIZE,
    };
  }, [result, source, period]);

  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listProxyLogs(proxy.id, filters());
      if (id !== generation.current) return;
      setLogs(page.logs);
      setNext(page.next_before);
    } catch (err) {
      if (id === generation.current) setError(err);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [proxy.id, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!next) return;
    const id = generation.current;
    setLoadingMore(true);
    try {
      const page = await listProxyLogs(proxy.id, { ...filters(), before: next });
      if (id !== generation.current) return;
      setLogs((prev) => [...prev, ...page.logs.filter((l) => !prev.some((p) => p.id === l.id))]);
      setNext(page.next_before);
    } catch {
      // the list stays as it was; the button can be pressed again
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {!proxy.debug_enabled ? (
        <div className="notice is-info">
          <span>{t('proxies.logs.failuresOnly')}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="label">{t('proxies.logs.result')}</span>
          <select
            className="field w-auto min-w-[170px]"
            value={result}
            onChange={(e) => setResult(e.currentTarget.value)}
          >
            <option value="">{t('proxies.logs.allResults')}</option>
            <option value="failure">{t('proxies.logs.anyFailure')}</option>
            {PROXY_RESULT_CODES.map((code) => (
              <option key={code} value={code}>
                {resultLabel(code)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="label">{t('proxies.logs.source')}</span>
          <select
            className="field w-auto min-w-[150px]"
            value={source}
            onChange={(e) => setSource(e.currentTarget.value)}
          >
            <option value="">{t('proxies.logs.allSources')}</option>
            {PROXY_SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {sourceTypeLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="label">{t('proxies.logs.period')}</span>
          <select
            className="field w-auto min-w-[130px]"
            value={period}
            onChange={(e) => setPeriod(e.currentTarget.value as Period)}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`proxies.logs.periods.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={() => void load()} busy={loading}>
          <RotateCw aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : !loading && logs.length === 0 ? (
        <EmptyState
          title={t('proxies.logs.emptyTitle')}
          description={t('proxies.logs.emptyBody')}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('proxies.logs.time')}</th>
                <th>{t('proxies.logs.source')}</th>
                <th>{t('proxies.logs.destination')}</th>
                <th className="num">{t('proxies.logs.position')}</th>
                <th>{t('proxies.logs.result')}</th>
                <th className="num">{t('proxies.logs.tunnel')}</th>
                <th className="num">{t('proxies.logs.duration')}</th>
                <th className="num">{t('proxies.logs.bytes')}</th>
                <th>{t('proxies.logs.error')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-muted">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : null}
              {logs.map((log) => {
                const requestId = log.request_id ?? log.agent_message_id;
                return (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap font-mono text-xs">
                      {requestId ? (
                        <Link
                          to={`/requests/${encodeURIComponent(requestId)}`}
                          className="link-action"
                          title={t('proxies.logs.openRequest')}
                        >
                          {formatDateTime(log.started_at)}
                        </Link>
                      ) : (
                        formatDateTime(log.started_at)
                      )}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        <Badge>{sourceTypeLabel(log.source_type)}</Badge>
                        {log.source_label ? (
                          <span className="text-ink">{log.source_label}</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-dim">{log.destination}</td>
                    <td className="num">{log.position}</td>
                    <td>
                      <Badge tone={log.result === 'ok' ? 'ok' : 'danger'}>
                        {resultLabel(log.result)}
                      </Badge>
                      {log.status_code !== null ? (
                        <span className="ml-1.5 font-mono text-xs text-muted">
                          {log.status_code}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">
                      {log.tunnel_ms != null ? t('proxies.common.ms', { ms: log.tunnel_ms }) : '—'}
                    </td>
                    <td className="num">{formatDuration(log.duration_ms)}</td>
                    <td className="num whitespace-nowrap text-xs">
                      {formatBytes(log.bytes_sent)} / {formatBytes(log.bytes_received)}
                    </td>
                    <td
                      className="max-w-[280px] truncate text-xs text-muted"
                      title={log.error ?? undefined}
                    >
                      {log.error ?? ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {next && !error ? (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" busy={loadingMore} onClick={() => void loadMore()}>
            {t('proxies.logs.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
