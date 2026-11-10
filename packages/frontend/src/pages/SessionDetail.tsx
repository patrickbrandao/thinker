import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import ErrorState from '../components/ErrorState.js';
import MessageTable from '../components/MessageTable.js';
import RequestDrawerStack from '../components/RequestDrawerStack.js';
import { DETAILED_COLUMNS, type MessageRow } from '../components/message-table-types.js';
import { Badge, Button, Panel, Skel } from '../components/ui.js';
import { t } from '../i18n/index.js';
import { useResource } from '../lib/use-resource.js';
import { getMessages } from '../services/api.js';
import { getSession } from '../services/api/sessions.js';
import { formatDateTime, formatNumber } from '../services/formatters.js';
import { getModelDisplayName, preloadModelDisplayNames } from '../services/model-display.js';
import { costLabel, isActive, shortId, spanLabel } from './sessions/session-format.js';

const PAGE_SIZE = '50';

interface MessagePage {
  items: MessageRow[];
  next_cursor: string | null;
  total_count: number;
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="truncate text-sm font-semibold text-ink tabular-nums" title={hint}>
        {value}
      </div>
    </div>
  );
}

/** One harness session: totals, subagent breakdown and every request in it. */
export default function SessionDetail() {
  const { sessionId = '' } = useParams();
  useEffect(() => preloadModelDisplayNames(), []);
  const session = useResource(() => getSession(sessionId), [sessionId]);

  const [rows, setRows] = useState<MessageRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const firstPage = useResource(async () => {
    const res = (await getMessages({
      session: sessionId,
      limit: PAGE_SIZE,
      include_filter_options: 'false',
    })) as MessagePage;
    setRows(res.items);
    setCursor(res.next_cursor);
    setTotal(res.total_count);
    return res;
  }, [sessionId]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = (await getMessages({
        session: sessionId,
        limit: PAGE_SIZE,
        cursor,
        include_total: 'false',
        include_filter_options: 'false',
      })) as MessagePage;
      setRows((prev) => [...prev, ...res.items]);
      setCursor(res.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const s = session.data;
  if (s) document.title = t('sessions.detail.pageTitle', { id: shortId(s.id) });

  return (
    <div className="page full">
      <div className="mb-3">
        <Link to="/sessions" className="link-action text-sm">
          {t('sessions.detail.back')}
        </Link>
      </div>

      {session.error ? (
        <ErrorState error={session.error} onRetry={() => void session.reload()} />
      ) : !s ? (
        <Skel height={120} />
      ) : (
        <div className="flex flex-col gap-4">
          <Panel
            title={
              <span className="mono text-sm" title={s.id}>
                {s.id}
              </span>
            }
            actions={isActive(s.last_at) ? <Badge tone="ok">{t('sessions.active')}</Badge> : null}
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 2xl:grid-cols-8">
              <Stat label={t('sessions.detail.harness')} value={s.agent_name ?? '—'} />
              <Stat label={t('sessions.detail.started')} value={formatDateTime(s.started_at)} />
              <Stat label={t('sessions.detail.ended')} value={formatDateTime(s.last_at)} />
              <Stat
                label={t('sessions.detail.duration')}
                value={spanLabel(s.started_at, s.last_at)}
              />
              <Stat
                label={t('sessions.detail.requests')}
                value={
                  <>
                    {formatNumber(s.requests)}
                    {s.failed > 0 ? (
                      <span className="ml-1 text-xs font-normal text-danger">
                        ({t('sessions.failed', { count: s.failed })})
                      </span>
                    ) : null}
                  </>
                }
              />
              <Stat
                label={t('sessions.detail.inputTokens')}
                value={formatNumber(s.input_tokens)}
                hint={String(s.input_tokens)}
              />
              <Stat
                label={t('sessions.detail.outputTokens')}
                value={formatNumber(s.output_tokens)}
                hint={String(s.output_tokens)}
              />
              <Stat label={t('sessions.detail.cost')} value={costLabel(s.cost)} />
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-sm">
              {s.cache_read_tokens > 0 ? (
                <div>
                  <span className="text-muted">{t('sessions.detail.cacheRead')}: </span>
                  {formatNumber(s.cache_read_tokens)}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted">{t('sessions.detail.models')}:</span>
                {s.models.map((m) => (
                  <Badge key={m} title={m}>
                    {getModelDisplayName(m)}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted">{t('sessions.detail.providers')}:</span>
                {s.providers.map((p) => (
                  <Badge key={p}>{p}</Badge>
                ))}
              </div>
              {s.client?.user_agent ? (
                <div>
                  <span className="text-muted">{t('sessions.detail.client')}: </span>
                  <span className="mono text-xs">{s.client.user_agent}</span>
                </div>
              ) : null}
              {s.client?.project ? (
                <div>
                  <span className="text-muted">{t('sessions.detail.project')}: </span>
                  <span className="mono text-xs">{s.client.project}</span>
                </div>
              ) : null}
              {s.parent_session_id ? (
                <div>
                  <span className="text-muted">{t('sessions.detail.parent')}: </span>
                  <Link
                    to={`/sessions/${encodeURIComponent(s.parent_session_id)}`}
                    className="link-action mono text-xs"
                  >
                    {s.parent_session_id}
                  </Link>
                </div>
              ) : null}
            </div>
          </Panel>

          {s.parts.length > 1 ? (
            <Panel title={t('sessions.detail.parts')}>
              <div className="table-wrap">
                <table className="data data-table">
                  <thead>
                    <tr>
                      <th>{t('sessions.col.session')}</th>
                      <th>{t('sessions.col.started')}</th>
                      <th>{t('sessions.col.duration')}</th>
                      <th className="text-right">{t('sessions.col.requests')}</th>
                      <th className="text-right">{t('sessions.col.tokens')}</th>
                      <th className="text-right">{t('sessions.col.cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.parts.map((p) => (
                      <tr key={p.session_id}>
                        <td>
                          <div className="flex items-center gap-1.5">
                            {p.is_main ? (
                              <span className="mono text-xs">{shortId(p.session_id)}</span>
                            ) : (
                              <Link
                                to={`/sessions/${encodeURIComponent(p.session_id)}`}
                                className="link-action mono text-xs"
                                title={p.session_id}
                              >
                                {shortId(p.session_id)}
                              </Link>
                            )}
                            <Badge tone={p.is_main ? 'accent' : 'neutral'}>
                              {p.is_main
                                ? t('sessions.detail.main')
                                : t('sessions.detail.subagent')}
                            </Badge>
                          </div>
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {formatDateTime(p.started_at)}
                        </td>
                        <td>{spanLabel(p.started_at, p.last_at)}</td>
                        <td className="text-right tabular-nums">
                          {formatNumber(p.requests)}
                          {p.failed > 0 ? (
                            <span className="ml-1 text-xs text-danger">({p.failed})</span>
                          ) : null}
                        </td>
                        <td className="text-right tabular-nums">
                          {formatNumber(p.input_tokens + p.output_tokens)}
                        </td>
                        <td className="whitespace-nowrap text-right tabular-nums">
                          {costLabel(p.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="m-0 text-sm font-semibold text-ink">
                {t('sessions.detail.requestsTitle')}
              </h2>
              <span className="text-xs text-muted">
                {t('messages.log.total', { count: total })}
              </span>
            </div>
            {firstPage.error ? (
              <ErrorState error={firstPage.error} onRetry={() => void firstPage.reload()} />
            ) : firstPage.loading && rows.length === 0 ? (
              <Skel height={200} />
            ) : (
              <>
                <div className="table-wrap">
                  <MessageTable
                    items={rows}
                    columns={DETAILED_COLUMNS}
                    onRowSelect={setSelected}
                    selectedRowId={selected}
                    rowIdPrefix="msg-"
                    showHeaderTooltips
                    expandable
                  />
                </div>
                {cursor ? (
                  <div className="flex justify-center pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      busy={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {t('sessions.next')}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
      <RequestDrawerStack messageId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
