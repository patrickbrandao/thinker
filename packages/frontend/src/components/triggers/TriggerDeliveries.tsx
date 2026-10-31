import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import {
  TRIGGER_EVENT_STATUSES,
  TRIGGER_EVENT_TYPES,
  type TriggerEventStatus,
} from 'thinker-shared';
import { t } from '../../i18n/index.js';
import { formatDateTime, formatDuration } from '../../services/formatters.js';
import { toast } from '../../services/toast-store.js';
import {
  getTriggerEvent,
  listTriggerEvents,
  retryTriggerEvent,
  type TriggerEventDetail,
  type TriggerEventItem,
  type TriggerView,
} from '../../services/api/triggers.js';
import { useResource } from '../../lib/use-resource.js';
import ErrorState from '../ErrorState.js';
import { Badge, Button, EmptyState, Modal } from '../ui.js';
import { TriggerTypeIcon } from './TriggerParts.js';
import { eventLabel } from './trigger-form.js';

const PAGE_SIZE = 50;

const STATUS_TONE: Record<TriggerEventStatus, 'ok' | 'danger' | 'warn' | 'info'> = {
  delivered: 'ok',
  failed: 'danger',
  pending: 'warn',
  delivering: 'info',
};

export function statusLabel(status: TriggerEventStatus | string): string {
  switch (status) {
    case 'pending':
      return t('triggers.deliveries.statuses.pending');
    case 'delivering':
      return t('triggers.deliveries.statuses.delivering');
    case 'delivered':
      return t('triggers.deliveries.statuses.delivered');
    case 'failed':
      return t('triggers.deliveries.statuses.failed');
    default:
      return status;
  }
}

function StatusBadge({ status }: { status: TriggerEventStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{statusLabel(status)}</Badge>;
}

/** Deliveries tab: every event sent to a trigger, newest first, with a detail dialog. */
export default function TriggerDeliveries({ triggers }: { triggers: TriggerView[] }) {
  const [triggerId, setTriggerId] = useState('');
  const [status, setStatus] = useState('');
  const [eventType, setEventType] = useState('');
  const [events, setEvents] = useState<TriggerEventItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listTriggerEvents({
        trigger_id: triggerId || undefined,
        status: status || undefined,
        event_type: eventType || undefined,
        limit: PAGE_SIZE,
      });
      if (id !== generation.current) return;
      setEvents(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      if (id === generation.current) setError(err);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [triggerId, status, eventType]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const last = events[events.length - 1];
    if (!last) return;
    const id = generation.current;
    setLoadingMore(true);
    try {
      const page = await listTriggerEvents({
        trigger_id: triggerId || undefined,
        status: status || undefined,
        event_type: eventType || undefined,
        before: last.created_at,
        limit: PAGE_SIZE,
      });
      if (id !== generation.current) return;
      setEvents((prev) => [...prev, ...page.filter((e) => !prev.some((p) => p.id === e.id))]);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      // the list stays as it was; the button can be pressed again
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="label">{t('triggers.deliveries.trigger')}</span>
          <select
            className="field w-auto min-w-[180px]"
            value={triggerId}
            onChange={(e) => setTriggerId(e.currentTarget.value)}
          >
            <option value="">{t('triggers.deliveries.allTriggers')}</option>
            {triggers.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="label">{t('triggers.deliveries.status')}</span>
          <select
            className="field w-auto min-w-[150px]"
            value={status}
            onChange={(e) => setStatus(e.currentTarget.value)}
          >
            <option value="">{t('triggers.deliveries.allStatuses')}</option>
            {TRIGGER_EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="label">{t('triggers.deliveries.event')}</span>
          <select
            className="field w-auto min-w-[180px]"
            value={eventType}
            onChange={(e) => setEventType(e.currentTarget.value)}
          >
            <option value="">{t('triggers.deliveries.allEvents')}</option>
            {TRIGGER_EVENT_TYPES.map((ev) => (
              <option key={ev} value={ev}>
                {eventLabel(ev)}
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
      ) : !loading && events.length === 0 ? (
        <EmptyState
          title={t('triggers.deliveries.emptyTitle')}
          description={t('triggers.deliveries.emptyBody')}
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('triggers.deliveries.time')}</th>
                <th>{t('triggers.deliveries.trigger')}</th>
                <th>{t('triggers.deliveries.event')}</th>
                <th>{t('triggers.deliveries.harness')}</th>
                <th>{t('triggers.deliveries.status')}</th>
                <th className="num">{t('triggers.deliveries.attempts')}</th>
                <th>{t('triggers.deliveries.lastError')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : null}
              {events.map((ev) => (
                <tr
                  key={ev.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setSelected(ev.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(ev.id);
                    }
                  }}
                >
                  <td className="whitespace-nowrap font-mono text-xs">
                    {formatDateTime(ev.created_at)}
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <TriggerTypeIcon type={ev.trigger_type} />
                      <span className="text-ink">{ev.trigger_name}</span>
                      {ev.trigger_id === null ? (
                        <span className="text-xs text-muted">
                          ({t('triggers.deliveries.deletedTrigger')})
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td>{eventLabel(ev.event_type)}</td>
                  <td className="text-dim">{ev.agent_name ?? '—'}</td>
                  <td>
                    <StatusBadge status={ev.status} />
                  </td>
                  <td className="num">{ev.attempts}</td>
                  <td
                    className="max-w-[280px] truncate text-xs text-muted"
                    title={ev.last_error ?? undefined}
                  >
                    {ev.last_error ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && !error ? (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" busy={loadingMore} onClick={() => void loadMore()}>
            {t('triggers.deliveries.loadMore')}
          </Button>
        </div>
      ) : null}

      <DeliveryDetail
        eventId={selected}
        onClose={() => setSelected(null)}
        onRetried={() => void load()}
      />
    </div>
  );
}

function DeliveryDetail({
  eventId,
  onClose,
  onRetried,
}: {
  eventId: string | null;
  onClose: () => void;
  onRetried: () => void;
}) {
  const detail = useResource<TriggerEventDetail>(() => getTriggerEvent(eventId!), [eventId], {
    enabled: !!eventId,
  });
  const [retrying, setRetrying] = useState(false);
  const data = detail.data && detail.data.event.id === eventId ? detail.data : undefined;

  const retry = async () => {
    if (!eventId) return;
    setRetrying(true);
    try {
      await retryTriggerEvent(eventId);
      toast.success(t('triggers.toast.requeued'));
      onRetried();
      await detail.reload();
    } catch {
      // toasted
    } finally {
      setRetrying(false);
    }
  };

  const ev = data?.event;
  const payload = ev ? Object.entries(ev.payload ?? {}) : [];

  return (
    <Modal open={!!eventId} title={t('triggers.deliveries.detail.title')} onClose={onClose} wide>
      {detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.reload()} />
      ) : !ev ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <TriggerTypeIcon type={ev.trigger_type} />
            <span className="font-medium text-ink">{ev.trigger_name}</span>
            <span className="text-muted">·</span>
            <span>{eventLabel(ev.event_type)}</span>
            {ev.agent_name ? (
              <>
                <span className="text-muted">·</span>
                <span className="font-mono text-dim">{ev.agent_name}</span>
              </>
            ) : null}
            <StatusBadge status={ev.status} />
          </div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{t('triggers.deliveries.detail.created')}</dt>
            <dd className="m-0 font-mono text-xs">{formatDateTime(ev.created_at)}</dd>
            {ev.delivered_at ? (
              <>
                <dt className="text-muted">{t('triggers.deliveries.detail.delivered')}</dt>
                <dd className="m-0 font-mono text-xs">{formatDateTime(ev.delivered_at)}</dd>
              </>
            ) : null}
            {ev.next_attempt_at && ev.status !== 'delivered' ? (
              <>
                <dt className="text-muted">{t('triggers.deliveries.attempts')}</dt>
                <dd className="m-0 text-xs">
                  {t('triggers.deliveries.nextAttempt', {
                    time: formatDateTime(ev.next_attempt_at),
                  })}
                </dd>
              </>
            ) : null}
            {ev.last_error ? (
              <>
                <dt className="text-muted">{t('triggers.deliveries.lastError')}</dt>
                <dd className="m-0 break-words text-xs text-danger">{ev.last_error}</dd>
              </>
            ) : null}
          </dl>

          <section>
            <h3 className="label">{t('triggers.deliveries.detail.payload')}</h3>
            {payload.length === 0 ? (
              <p className="text-sm text-muted">{t('triggers.deliveries.detail.noPayload')}</p>
            ) : (
              <div className="table-wrap max-h-64 overflow-auto">
                <table className="data">
                  <tbody>
                    {payload.map(([key, value]) => (
                      <tr key={key}>
                        <td className="whitespace-nowrap font-mono text-xs text-muted">{key}</td>
                        <td className="break-all font-mono text-xs">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="label">{t('triggers.deliveries.detail.attempts')}</h3>
            {data.logs.length === 0 ? (
              <p className="text-sm text-muted">{t('triggers.deliveries.detail.noAttempts')}</p>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {data.logs.map((log) => (
                  <li key={log.id} className="well flex flex-col gap-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">
                        {t('triggers.deliveries.detail.attempt', { n: log.attempt })}
                      </span>
                      <Badge tone={log.success ? 'ok' : 'danger'}>
                        {log.success
                          ? t('triggers.deliveries.detail.ok')
                          : t('triggers.deliveries.detail.failed')}
                      </Badge>
                      {log.status_code !== null ? (
                        <Badge mono>
                          {t('triggers.deliveries.detail.statusCode', { code: log.status_code })}
                        </Badge>
                      ) : null}
                      <span className="font-mono text-xs text-muted">
                        {formatDateTime(log.started_at)} · {formatDuration(log.duration_ms)}
                      </span>
                    </div>
                    {log.error ? (
                      <p className="m-0 break-words text-xs text-danger">
                        {t('triggers.deliveries.detail.error')}: {log.error}
                      </p>
                    ) : null}
                    {log.response ? (
                      <div>
                        <div className="text-xs text-muted">
                          {t('triggers.deliveries.detail.response')}
                        </div>
                        <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-control border border-line bg-sunken p-2 font-mono text-xs text-dim">
                          {log.response}
                        </pre>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {ev.status === 'failed' ? (
            <div className="actions">
              <Button size="sm" busy={retrying} onClick={() => void retry()}>
                <RotateCw aria-hidden="true" />
                {t('triggers.deliveries.detail.retry')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
