import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { platformIcon } from 'thinker-shared';
import ErrorState from '../components/ErrorState.js';
import Select, { type SelectOption } from '../components/Select.js';
import { ThemedIcon } from '../components/setup-ui.js';
import { Badge, Button, Skel } from '../components/ui.js';
import { t } from '../i18n/index.js';
import { useResource } from '../lib/use-resource.js';
import { getAgents } from '../services/api.js';
import { getSessions } from '../services/api/sessions.js';
import { formatDateTime, formatNumber, formatTimeAgo } from '../services/formatters.js';
import { getModelDisplayName } from '../services/model-display.js';
import { costLabel, isActive, shortId, spanLabel } from './sessions/session-format.js';

const PAGE_SIZE = 50;

interface AgentOption {
  agent_name: string;
  agent_platform?: string | null;
  agent_category?: string | null;
}

/** Harness sessions, latest activity first. */
export default function Sessions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const range = searchParams.get('range') || '7d';
  const agent = searchParams.get('agent') || '';
  const [page, setPage] = useState(0);

  const setParam = (key: string, value: string) => {
    setPage(0);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const agents = useResource(async () => {
    const data = (await getAgents()) as { agents?: AgentOption[] } | AgentOption[];
    return Array.isArray(data) ? data : (data?.agents ?? []);
  }, []);
  const platformOf = useMemo(() => {
    const map = new Map<string, AgentOption>();
    for (const a of agents.data ?? []) map.set(a.agent_name, a);
    return map;
  }, [agents.data]);

  const sessions = useResource(
    () =>
      getSessions({
        range,
        agent_name: agent || undefined,
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      }),
    [range, agent, page],
  );

  const harnessIcon = (name: string | null) => {
    const info = name ? platformOf.get(name) : undefined;
    const src = info?.agent_platform
      ? platformIcon(info.agent_platform, info.agent_category ?? null)
      : null;
    return src ? (
      <ThemedIcon src={src} size={14} className="platform-icon shrink-0 rounded-[3px]" />
    ) : null;
  };

  const agentOptions: SelectOption[] = [
    { label: t('sessions.allHarnesses'), value: '' },
    ...(agents.data ?? [])
      .map((a) => a.agent_name)
      .sort()
      .map((name) => ({ label: name, value: name, icon: harnessIcon(name) })),
  ];
  const rangeOptions: SelectOption[] = ['24h', '7d', '30d', '90d', '365d'].map((value) => ({
    value,
    label: t(`messages.log.range.${value}` as 'messages.log.range.7d'),
  }));

  const items = sessions.data?.items ?? [];

  return (
    <div className="page full">
      <title>{t('sessions.pageTitle')}</title>
      <meta name="description" content={t('sessions.metaDescription')} />
      <div className="page-head">
        <p className="m-0 max-w-2xl text-sm text-muted">{t('sessions.subtitle')}</p>
        <div className="page-actions w-full lg:w-auto lg:justify-end">
          <div className="w-full sm:w-44">
            <Select value={agent} onChange={(v) => setParam('agent', v)} options={agentOptions} />
          </div>
          <div className="w-full sm:w-44">
            <Select value={range} onChange={(v) => setParam('range', v)} options={rangeOptions} />
          </div>
        </div>
      </div>

      {sessions.error ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.reload()} />
      ) : sessions.loading && !sessions.data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skel key={i} height={36} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <h3>{t('sessions.emptyTitle')}</h3>
          <p className="max-w-md text-sm">{t('sessions.emptyBody')}</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data data-table">
              <thead>
                <tr>
                  <th>{t('sessions.col.session')}</th>
                  <th>{t('sessions.col.harness')}</th>
                  <th>{t('sessions.col.started')}</th>
                  <th>{t('sessions.col.duration')}</th>
                  <th className="text-right">{t('sessions.col.requests')}</th>
                  <th className="text-right">{t('sessions.col.tokens')}</th>
                  <th className="text-right">{t('sessions.col.cost')}</th>
                  <th>{t('sessions.col.models')}</th>
                  <th>{t('sessions.col.lastActivity')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const to = `/sessions/${encodeURIComponent(s.id)}`;
                  return (
                    <tr
                      key={`${s.agent_id}:${s.id}`}
                      className="msg-row--clickable cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a, button')) return;
                        navigate(to);
                      }}
                    >
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            to={to}
                            className="mono whitespace-nowrap text-xs text-ink"
                            title={s.id}
                          >
                            {shortId(s.id)}
                          </Link>
                          {isActive(s.last_at) ? (
                            <Badge tone="ok">{t('sessions.active')}</Badge>
                          ) : null}
                          {s.subagents > 0 ? (
                            <Badge>{t('sessions.subagents', { count: s.subagents })}</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          {harnessIcon(s.agent_name)}
                          {s.agent_name ?? '—'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(s.started_at)}</td>
                      <td className="whitespace-nowrap">{spanLabel(s.started_at, s.last_at)}</td>
                      <td className="text-right tabular-nums">
                        {formatNumber(s.requests)}
                        {s.failed > 0 ? (
                          <div className="text-xs text-danger">
                            {t('sessions.failed', { count: s.failed })}
                          </div>
                        ) : null}
                      </td>
                      <td
                        className="text-right tabular-nums"
                        title={`${formatNumber(s.input_tokens)} in · ${formatNumber(s.output_tokens)} out`}
                      >
                        {formatNumber(s.input_tokens + s.output_tokens)}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {costLabel(s.cost)}
                      </td>
                      <td className="max-w-[260px]">
                        <div className="flex flex-wrap gap-1">
                          {s.models.slice(0, 2).map((m) => (
                            <Badge key={m} className="max-w-[200px] truncate" title={m}>
                              {getModelDisplayName(m)}
                            </Badge>
                          ))}
                          {s.models.length > 2 ? (
                            <Badge title={s.models.slice(2).join(', ')}>
                              {t('sessions.more', { count: s.models.length - 2 })}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs text-muted">
                        {formatTimeAgo(s.last_at) ?? formatDateTime(s.last_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {page > 0 || sessions.data?.has_more ? (
            <div className="flex items-center justify-end gap-2 pt-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 0 || sessions.loading}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('sessions.prev')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!sessions.data?.has_more || sessions.loading}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('sessions.next')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
