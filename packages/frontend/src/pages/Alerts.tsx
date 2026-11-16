import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CircleCheck, Check } from 'lucide-react';
import { SYSTEM_EVENT_CATEGORIES, SYSTEM_EVENT_LEVELS, type SystemEventView } from 'thinker-shared';
import ErrorState from '../components/ErrorState.js';
import Select, { type SelectOption } from '../components/Select.js';
import { Badge, Button, cx, Skel, Tabs } from '../components/ui.js';
import { t, tMaybe } from '../i18n/index.js';
import { useResource } from '../lib/use-resource.js';
import { getAlerts, type AlertItem } from '../services/api/console.js';
import { listAlertEvents, markAlertRead, markAllAlertsRead } from '../services/api/alerts.js';
import { formatDateTime, formatRelativeTime } from '../services/formatters.js';

const PAGE_SIZE = 25;
type View = 'events' | 'requests';

export const LEVEL_TONE = { error: 'danger', warning: 'warn', info: 'info' } as const;

export function categoryLabel(category: string): string {
  return tMaybe(`alerts.category.${category}`) ?? category;
}

export function levelLabel(level: string): string {
  return tMaybe(`alerts.level.${level}`) ?? level;
}

/** "Read by Ana on 05/11 14:02", or null while unread. */
export function readLabel(e: SystemEventView): string | null {
  if (!e.read_at) return null;
  const who = e.read_by_name || e.read_by_email || t('alerts.someone');
  return t('alerts.readBy', { who, when: formatDateTime(e.read_at) });
}

/** Alerts page (/alerts): system events and failed requests of the last 24 hours. */
export default function Alerts() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'requests' ? 'requests' : 'events';
  const level = params.get('level') ?? '';
  const category = params.get('category') ?? '';
  const unread = params.get('unread') === '1';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [busy, setBusy] = useState(false);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const filters = { level, category, unread, page, limit: PAGE_SIZE };
  const events = useResource(() => listAlertEvents(filters), [level, category, unread, page, view]);
  const failed = useResource(getAlerts, [view]);

  const levelOptions: SelectOption[] = [
    { value: '', label: t('alerts.filter.allLevels') },
    ...SYSTEM_EVENT_LEVELS.map((v) => ({ value: v, label: levelLabel(v) })),
  ];
  const categoryOptions: SelectOption[] = [
    { value: '', label: t('alerts.filter.allCategories') },
    ...SYSTEM_EVENT_CATEGORIES.map((v) => ({ value: v, label: categoryLabel(v) })),
  ];

  const markOne = async (id: string) => {
    await markAlertRead(id);
    void events.reload();
  };
  const markAll = async () => {
    setBusy(true);
    try {
      await markAllAlertsRead({ level, category });
      void events.reload();
    } finally {
      setBusy(false);
    }
  };

  const data = events.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="page full">
      <title>{t('alerts.pageTitle')}</title>
      <meta name="description" content={t('alerts.subtitle')} />
      <Tabs<View>
        className="mb-4"
        label={t('alerts.title')}
        value={view}
        onChange={(v) => setParam('view', v === 'requests' ? 'requests' : '')}
        items={[
          { key: 'events', label: t('alerts.tabs.events'), count: data?.unread || undefined },
          {
            key: 'requests',
            label: t('alerts.tabs.requests'),
            count: failed.data?.total || undefined,
          },
        ]}
      />

      {view === 'events' ? (
        <div className="page-actions mb-4 w-full">
          <button
            type="button"
            className={cx(
              'feedback-tag btn btn-sm',
              unread ? 'feedback-tag--selected' : 'btn-ghost',
            )}
            aria-pressed={unread}
            onClick={() => setParam('unread', unread ? '' : '1')}
          >
            {t('alerts.filter.unread')}
          </button>
          <div className="w-full sm:w-40">
            <Select
              value={level}
              onChange={(v) => setParam('level', v)}
              options={levelOptions}
              label={t('alerts.filter.level')}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              value={category}
              onChange={(v) => setParam('category', v)}
              options={categoryOptions}
              label={t('alerts.filter.category')}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !data || data.unread === 0}
            onClick={() => void markAll()}
          >
            <Check size={14} />
            {t('alerts.markAllRead')}
          </Button>
        </div>
      ) : null}

      {view === 'requests' ? (
        <FailedRequests items={failed.data?.items ?? null} total={failed.data?.total ?? 0} />
      ) : events.error ? (
        <ErrorState error={events.error} onRetry={() => void events.reload()} />
      ) : !data ? (
        <Skel height={320} />
      ) : data.events.length === 0 ? (
        <div className="empty">
          <CircleCheck />
          <h3>{t('alerts.empty')}</h3>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data alerts-table">
              <thead>
                <tr>
                  <th className="w-px whitespace-nowrap">{t('alerts.col.level')}</th>
                  <th>{t('alerts.col.event')}</th>
                  <th>{t('alerts.col.category')}</th>
                  <th>{t('alerts.col.actor')}</th>
                  <th>{t('alerts.col.when')}</th>
                  <th>{t('alerts.col.read')}</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id} className={cx(!e.read_at && 'is-unread')}>
                    <td className="whitespace-nowrap">
                      <Badge tone={LEVEL_TONE[e.level] ?? 'neutral'}>{levelLabel(e.level)}</Badge>
                    </td>
                    <td>
                      <div className="row-title">{e.title}</div>
                      {e.message ? <div className="row-sub">{e.message}</div> : null}
                      <div className="row-sub font-mono">{e.type}</div>
                    </td>
                    <td>{categoryLabel(e.category)}</td>
                    <td>
                      {e.actor_email || e.actor_ip ? (
                        <>
                          <div>{e.actor_email ?? '—'}</div>
                          {e.actor_ip ? (
                            <div className="row-sub font-mono">{e.actor_ip}</div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-faint">{t('alerts.system')}</span>
                      )}
                    </td>
                    <td title={formatDateTime(e.created_at)}>{formatRelativeTime(e.created_at)}</td>
                    <td>
                      {e.read_at ? (
                        <span className="text-xs text-muted">{readLabel(e)}</span>
                      ) : (
                        <button
                          type="button"
                          className="link-action text-xs"
                          onClick={() => void markOne(e.id)}
                        >
                          {t('alerts.markRead')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                {t('alerts.prev')}
              </Button>
              <span className="text-muted">{t('alerts.pageOf', { page, pages })}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= pages}
                onClick={() => setParam('page', String(page + 1))}
              >
                {t('alerts.next')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function FailedRequests({ items, total }: { items: AlertItem[] | null; total: number }) {
  if (!items) return <Skel height={320} />;
  if (items.length === 0)
    return (
      <div className="empty">
        <CircleCheck />
        <h3>{t('shell.alerts.empty')}</h3>
      </div>
    );
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('alerts.col.request')}</th>
              <th>{t('alerts.col.harness')}</th>
              <th>{t('alerts.col.when')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link
                    to={`/messages?request=${encodeURIComponent(item.id)}`}
                    className="row-title"
                  >
                    {[item.errorHttpStatus ? `HTTP ${item.errorHttpStatus}` : null, item.errorClass]
                      .filter(Boolean)
                      .join(' · ') || item.status}
                  </Link>
                  {item.errorMessage ? <div className="row-sub">{item.errorMessage}</div> : null}
                </td>
                <td>
                  <div>{item.agentName ?? '—'}</div>
                  {item.model ? <div className="row-sub font-mono">{item.model}</div> : null}
                </td>
                <td title={formatDateTime(item.timestamp)}>{formatRelativeTime(item.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-right text-sm">
        <Link to="/messages?status=failed">
          {total > items.length ? t('shell.alerts.viewAllCount', total) : t('shell.alerts.viewAll')}
        </Link>
      </div>
    </>
  );
}
