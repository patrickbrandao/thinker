import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  ExternalLink,
  Maximize2,
  Minus,
  PanelRight,
  PictureInPicture2,
  X,
} from 'lucide-react';
import { getMessageDetails, type AttemptRecording } from '../services/api/messages.js';
import { isFailedStatus, isSuccessStatus } from 'thinker-shared';
import { formatParamValue } from './MessageDetailsSections.js';
import { providerIcon } from './ProviderIcon.js';
import { FallbackIcon } from './message-table-cells.js';
import { authBadgeFor } from './AuthBadge.js';
import { RawView, RequestView, ResponseView, ToolsView } from './RequestAttemptViews.js';
import { RequestTimelineChart } from './RequestTimelineChart.js';
import { useResource } from '../lib/use-resource.js';
import { intlLocale, t } from '../i18n/index.js';
import { usd } from '../services/formatters.js';
import { IconButton, Tabs, cx } from './ui.js';
import { splitRequestLine } from '../services/request-line.js';

export interface RequestDrawerProps {
  messageId: string | null;
  onClose: () => void;
  /** `page` fills a dedicated browser tab: no side panel, float or close controls. */
  variant?: 'panel' | 'page';
}

type AttemptTab = 'details' | 'request' | 'response' | 'timeline' | 'tools' | 'raw';
type Layout = 'docked' | 'floating';

interface FloatRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PENDING_POLL_MS = 1500;

function initialFloatRect(): FloatRect {
  const width = Math.min(960, window.innerWidth - 48);
  const height = Math.min(720, window.innerHeight - 48);
  return {
    left: Math.max(16, window.innerWidth - width - 32),
    top: Math.max(16, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  };
}

function formatPeer(ip: string | undefined, port: number | undefined): string | undefined {
  if (!ip) return undefined;
  if (port == null) return ip;
  return ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`;
}

interface Attempt {
  id: string;
  index: number;
  type: 'initial' | 'fallback';
  status: string;
  provider: string;
  model: string;
  auth_type: string;
  error_message?: string;
  error_origin?: string;
  error_class?: string;
  error_http_status?: number;
  model_id?: string;
  trace_id?: string;
  routing_tier?: string;
  routing_reason?: string;
  /** Virtual model (ADR 0004) the request named; shared by every attempt. */
  virtual_model_name?: string;
  service_type?: string;
  session_key?: string;
  description?: string;
  duration_ms?: number;
  cost?: number;
  input_tokens?: number;
  output_tokens?: number;
  fallback_from_model?: string;
  fallback_index?: number;
  request_headers?: Record<string, string>;
  request_params?: Record<string, unknown>;
  recording?: AttemptRecording | null;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const mon = d.toLocaleString(intlLocale(), { month: 'short' });
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mon} ${day}, ${hh}:${mm}:${ss}`;
}

function statusLabel(status: string): string {
  if (status === 'pending') return t('messages.drawer.status.pending');
  if (status === 'cancelled') return t('messages.drawer.status.cancelled');
  if (isSuccessStatus(status)) return t('messages.drawer.status.success');
  if (status === 'rate_limited') return t('messages.drawer.status.rate_limited');
  return t('messages.drawer.status.failed');
}

/** The attempt's HTTP code as displayed: 200 for success, the provider's
    error code otherwise, ERR when the failure carried no HTTP response. */
function attemptCode(att: { status: string; error_http_status?: number }): string {
  if (att.status === 'pending') return '—';
  if (att.status === 'cancelled') return 'CXL';
  if (isSuccessStatus(att.status)) return '200';
  return att.error_http_status != null ? String(att.error_http_status) : 'ERR';
}

function requestStatusClass(status: string): string {
  if (isSuccessStatus(status)) return 'drawer-status--success badge is-ok';
  if (status === 'pending' || status === 'cancelled') return 'drawer-status--neutral badge';
  return 'drawer-status--error badge is-danger';
}

function attemptStatusClass(status: string): string {
  if (isSuccessStatus(status)) return 'attempt-code--ok badge mono is-ok';
  if (status === 'pending' || status === 'cancelled') return 'attempt-code--neutral badge mono';
  return 'attempt-code--error badge mono is-danger';
}

function attemptErrorMessage(
  att: Pick<Attempt, 'status' | 'error_message'>,
  requestMessage: unknown,
): string | undefined {
  if (!isFailedStatus(att.status)) return undefined;
  if (typeof att.error_message === 'string' && att.error_message.trim()) {
    return att.error_message;
  }
  if (typeof requestMessage === 'string' && requestMessage.trim()) return requestMessage;
  return t('messages.drawer.noErrorMessage');
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the details payload is loosely typed */
function inferType(att: any, index: number): Attempt['type'] {
  if (att.fallback_from_model || att.fallback_index) return 'fallback';
  // For backend summary attempts (no fallback fields), use position:
  // first = initial, rest = fallback.
  if (index > 0) return 'fallback';
  return 'initial';
}

function buildAttempts(msg: any): Attempt[] {
  // When the backend provides a real attempts array, use it
  if (Array.isArray(msg.attempts)) {
    return msg.attempts.map((att: any, i: number) => ({
      id: att.id,
      index: i + 1,
      type: inferType(att, i),
      status: att.status,
      provider: att.provider ?? msg.provider,
      model: att.model ?? msg.model ?? msg.model_id,
      auth_type: att.auth_type ?? msg.auth_type,
      error_message: attemptErrorMessage(att, msg.error_message),
      error_origin: att.error_origin ?? undefined,
      error_class: att.error_class ?? undefined,
      error_http_status: att.error_http_status ?? undefined,
      model_id: att.model_id ?? undefined,
      trace_id: att.trace_id ?? msg.trace_id,
      routing_tier: att.routing_tier ?? undefined,
      virtual_model_name: msg.virtual_model_name ?? undefined,
      routing_reason: att.routing_reason ?? undefined,
      service_type: att.service_type ?? msg.service_type,
      session_key: att.session_key ?? msg.session_key,
      description: att.description ?? msg.description,
      duration_ms: att.duration_ms ?? undefined,
      cost: att.cost_usd != null ? Number(att.cost_usd) : undefined,
      input_tokens: att.input_tokens ?? undefined,
      fallback_from_model: att.fallback_from_model ?? undefined,
      fallback_index: att.fallback_index ?? undefined,
      output_tokens: att.output_tokens ?? undefined,
      request_headers: att.request_headers ?? undefined,
      request_params: att.request_params ?? undefined,
      recording: att.recording ?? null,
    }));
  }

  // Fallback: single attempt from the message row itself
  const type: Attempt['type'] = msg.fallback_from_model ? 'fallback' : 'initial';

  return [
    {
      id: msg.id,
      index: 1,
      type,
      status: msg.status,
      provider: msg.provider,
      model: msg.model || msg.model_id,
      auth_type: msg.auth_type,
      error_message: attemptErrorMessage(msg, msg.error_message),
      error_origin: msg.error_origin,
      error_class: msg.error_class,
      error_http_status: msg.error_http_status,
      model_id: msg.model_id,
      trace_id: msg.trace_id,
      routing_tier: msg.routing_tier,
      virtual_model_name: msg.virtual_model_name ?? undefined,
      routing_reason: msg.routing_reason,
      service_type: msg.service_type,
      session_key: msg.session_key,
      description: msg.description,
      duration_ms: msg.duration_ms,
      cost: msg.cost,
      input_tokens: msg.input_tokens,
      fallback_from_model: msg.fallback_from_model ?? undefined,
      fallback_index: msg.fallback_index ?? undefined,
      output_tokens: msg.output_tokens,
      request_headers: msg.request_headers,
      request_params: msg.request_params,
      recording: null,
    },
  ];
}

function Kv({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="drawer-kv grid grid-cols-[minmax(96px,140px)_1fr] items-baseline gap-3 border-b border-line py-1.5 text-xs">
      <span className="drawer-kv__key text-muted">{label}</span>
      <span className="min-w-0 break-words text-ink">{children}</span>
    </div>
  );
}

function FallbackBadge() {
  return (
    <div className="mb-2">
      <span className="trigger-badge trigger-badge--fallback badge is-info">
        <FallbackIcon />
        {t('messages.table.fallbackBadge')}
      </span>
    </div>
  );
}

function ContextCard({ tone, children }: { tone: 'fallback' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cx(
        `drawer-context-card drawer-context-card--${tone} mt-3 rounded-control border border-line p-3`,
        tone === 'error' ? 'bg-danger-tint' : 'bg-info-tint',
      )}
    >
      {children}
    </div>
  );
}

function AttemptDetails({ att, attempts }: { att: Attempt; attempts: Attempt[] }) {
  const next = attempts[att.index];
  return (
    <div className="drawer-metadata">
      <Kv label={t('messages.drawer.kv.status')}>
        <span className="inline-flex items-center gap-1.5">
          {statusLabel(att.status)}
          <span className={cx('attempt-code', attemptStatusClass(att.status))}>
            {attemptCode(att)}
          </span>
        </span>
      </Kv>
      <Kv label={t('messages.drawer.kv.type')}>
        <span className="capitalize">
          {att.type === 'fallback'
            ? t('messages.drawer.type.fallback')
            : t('messages.drawer.type.initial')}
        </span>
      </Kv>
      <Kv label={t('messages.drawer.kv.provider')}>
        <span className="inline-flex items-center gap-1.5">
          {providerIcon(att.provider, 14)}
          {att.provider ?? '-'}
        </span>
      </Kv>
      {att.auth_type ? <Kv label={t('messages.drawer.kv.auth')}>{att.auth_type}</Kv> : null}
      <Kv label={t('messages.drawer.kv.model')}>{att.model ?? '-'}</Kv>
      {att.model_id && att.model_id !== att.model ? (
        <Kv label={t('messages.drawer.kv.modelId')}>{att.model_id}</Kv>
      ) : null}
      {att.trace_id ? <Kv label={t('messages.drawer.kv.traceId')}>{att.trace_id}</Kv> : null}
      {att.virtual_model_name ? (
        <Kv label={t('messages.drawer.kv.virtualModel')}>
          <span className="tier-badge tier-badge--virtual badge is-accent">
            {att.virtual_model_name}
          </span>
        </Kv>
      ) : null}
      {att.routing_tier ? (
        <Kv label={t('messages.drawer.kv.routingTier')}>{att.routing_tier}</Kv>
      ) : null}
      {att.routing_reason ? (
        <Kv label={t('messages.drawer.kv.reason')}>{att.routing_reason}</Kv>
      ) : null}
      {att.service_type ? (
        <Kv label={t('messages.drawer.kv.serviceType')}>{att.service_type}</Kv>
      ) : null}
      {att.session_key ? <Kv label={t('messages.drawer.kv.session')}>{att.session_key}</Kv> : null}
      {att.duration_ms != null ? (
        // i18n-ignore
        <Kv label={t('messages.drawer.kv.duration')}>{att.duration_ms}ms</Kv>
      ) : null}
      {att.cost != null ? <Kv label={t('messages.drawer.kv.cost')}>{usd(att.cost, 4)}</Kv> : null}
      <Kv label={t('messages.drawer.kv.inputTokens')}>
        {att.input_tokens?.toLocaleString(intlLocale())}
      </Kv>
      <Kv label={t('messages.drawer.kv.outputTokens')}>
        {att.output_tokens?.toLocaleString(intlLocale())}
      </Kv>

      {/* The attempt's story, in reading order:
          1. ORIGIN cards (why this attempt exists) — before the error;
          2. the ERROR card (what happened here);
          3. CONSEQUENCE cards (what this failure triggered next) — after it.
          Cumulative by design: the error card is never replaced by a context card. */}

      {/* Origin: this attempt IS the fallback recovery */}
      {att.fallback_from_model ? (
        <ContextCard tone="fallback">
          <FallbackBadge />
          <div className="text-sm text-ink">
            {isSuccessStatus(att.status)
              ? t('messages.drawer.fallbackRecovered')
              : t('messages.drawer.fallbackFailed')}{' '}
            {t('messages.drawer.fellBackFrom', { model: att.fallback_from_model ?? '' })}
          </div>
        </ContextCard>
      ) : null}

      {/* Error block if this attempt failed — never hidden by the context cards */}
      {att.error_message ? (
        <ContextCard tone="error">
          <div className="eyebrow mb-2">{t('messages.drawer.error')}</div>
          <div className="mb-2 whitespace-pre-wrap font-mono text-sm text-danger [overflow-wrap:anywhere]">
            {att.error_message}
          </div>
          {att.error_origin || att.error_class || att.error_http_status ? (
            <table className="error-recovery-row__meta-table text-xs text-ink">
              <tbody>
                {att.error_origin ? (
                  <tr>
                    <td className="error-recovery-row__meta-label py-0.5 pr-3 text-muted">
                      {t('messages.drawer.origin')}
                    </td>
                    <td>{att.error_origin}</td>
                  </tr>
                ) : null}
                {att.error_class ? (
                  <tr>
                    <td className="error-recovery-row__meta-label py-0.5 pr-3 text-muted">
                      {t('messages.drawer.errorType')}
                    </td>
                    <td>{att.error_class}</td>
                  </tr>
                ) : null}
                {att.error_http_status ? (
                  <tr>
                    <td className="error-recovery-row__meta-label py-0.5 pr-3 text-muted">
                      {t('messages.drawer.httpStatus')}
                    </td>
                    <td>{att.error_http_status}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}
        </ContextCard>
      ) : null}

      {/* Consequence: this failed attempt was recovered by a LATER fallback attempt */}
      {isFailedStatus(att.status) && next?.fallback_from_model ? (
        <ContextCard tone="fallback">
          <FallbackBadge />
          <div className="text-sm text-ink">
            {t('messages.drawer.attemptFailed')}{' '}
            {isSuccessStatus(next.status)
              ? t('messages.drawer.recoveredBy', { model: next.model ?? '', n: att.index + 1 })
              : t('messages.drawer.continuedWith', { model: next.model ?? '', n: att.index + 1 })}
          </div>
        </ContextCard>
      ) : null}
    </div>
  );
}

function KvList({ entries, mono }: { entries: Array<[string, unknown]>; mono?: boolean }) {
  return (
    <div className="drawer-metadata">
      {entries.map(([key, val]) => (
        <Kv key={key} label={key}>
          <span className={cx('break-all', mono && 'font-mono')}>
            {mono ? formatParamValue(val) : String(val)}
          </span>
        </Kv>
      ))}
    </div>
  );
}

const sortedEntries = (obj: Record<string, unknown>) =>
  Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));

function RequestHeadersList({ headers }: { headers: Record<string, string> }) {
  const { requestLine, rest } = splitRequestLine(headers);
  return (
    <>
      {requestLine ? (
        <div className="drawer-request-line break-all border-b border-line py-1.5 font-mono text-xs text-ink">
          {requestLine}
        </div>
      ) : null}
      <KvList entries={sortedEntries(rest)} />
    </>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-card mt-5">
      <h4 className="eyebrow mb-2">{title}</h4>
      {children}
    </section>
  );
}

interface CallerOrigin {
  clientIp?: string;
  clientIpSource?: string;
  peerIp?: string;
  peerPort?: number;
}

export default function RequestDrawer({
  messageId,
  onClose,
  variant = 'panel',
}: RequestDrawerProps) {
  const [selectedAttempt, setSelectedAttempt] = useState(0);
  const [tab, setTab] = useState<AttemptTab>('details');
  const [layout, setLayout] = useState<Layout>('docked');
  const [minimized, setMinimized] = useState(false);
  const [rect, setRect] = useState<FloatRect | null>(null);
  const boxRef = useRef<HTMLElement>(null);
  const open = messageId !== null;
  const isPage = variant === 'page';
  const floating = !isPage && layout === 'floating';

  const { data, reload } = useResource(() => getMessageDetails(messageId as string), [messageId], {
    enabled: !!messageId,
  });

  const m = useMemo(() => {
    if (!data) return null;
    return ((data as any).message ?? data) as any;
  }, [data]);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const attempts = useMemo(() => (m ? buildAttempts(m) : []), [m]);
  const currentAttempt = attempts[selectedAttempt] ?? null;
  const requestPending = m?.status === 'pending';

  // A pending request keeps changing (attempts, recordings, outcome): refetch
  // until it settles.
  useEffect(() => {
    if (!requestPending) return;
    const timer = setInterval(() => void reload(), PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [requestPending, reload]);

  const visibleTabs: Array<{ key: AttemptTab; label: string }> = [
    { key: 'details', label: t('messages.drawer.tabs.details') },
  ];
  if (currentAttempt) {
    visibleTabs.push({ key: 'request', label: t('messages.drawer.tabs.request') });
    if (currentAttempt.recording || currentAttempt.status === 'pending') {
      visibleTabs.push({ key: 'response', label: t('messages.drawer.tabs.response') });
    }
  }
  if (m?.timeline?.events?.length > 0) {
    visibleTabs.push({ key: 'timeline', label: t('messages.drawer.timeline') });
  }
  if (currentAttempt) {
    if (currentAttempt.recording) {
      visibleTabs.push({ key: 'tools', label: t('messages.drawer.tabs.tools') });
      visibleTabs.push({ key: 'raw', label: t('messages.drawer.tabs.raw') });
    }
  }
  // A tab that disappears (another attempt has no recording) falls back to the first.
  const activeTab = visibleTabs.some((x) => x.key === tab) ? tab : visibleTabs[0]!.key;
  const attemptPending = currentAttempt?.status === 'pending' || requestPending;

  // Reset attempt + tab when the message changes
  useEffect(() => {
    if (messageId) {
      setSelectedAttempt(0);
      setTab('details');
    }
  }, [messageId]);

  // Close on Escape (the floating window and the dedicated page stay open).
  useEffect(() => {
    if (!open || floating || isPage) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, floating, isPage, onClose]);

  if (!open) return null;

  const popOut = () => {
    setRect((prev) => prev ?? initialFloatRect());
    setMinimized(false);
    setLayout('floating');
  };
  const dock = () => {
    setLayout('docked');
    setMinimized(false);
  };
  const openInTab = () => {
    window.open(`/requests/${encodeURIComponent(messageId)}`, '_blank', 'noopener');
  };

  // Drag the floating window by its header.
  const startDrag = (e: ReactMouseEvent) => {
    if (!floating || !rect || (e.target as HTMLElement).closest('button')) return;
    const box = boxRef.current?.getBoundingClientRect();
    const start = {
      x: e.clientX,
      y: e.clientY,
      left: box?.left ?? rect.left,
      top: box?.top ?? rect.top,
    };
    const move = (ev: MouseEvent) => {
      setRect((prev) =>
        prev
          ? {
              ...prev,
              left: Math.min(
                window.innerWidth - 80,
                Math.max(0, start.left + ev.clientX - start.x),
              ),
              top: Math.min(window.innerHeight - 40, Math.max(0, start.top + ev.clientY - start.y)),
            }
          : prev,
      );
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  };

  const requestStatus: string = m?.status ?? 'error';
  const headerProvider: string | undefined = currentAttempt?.provider ?? m?.provider;
  const headerAuthType: string | undefined = currentAttempt?.auth_type ?? m?.auth_type;
  const headerModel: string | undefined = currentAttempt?.model ?? m?.model ?? m?.model_id;
  const origin: CallerOrigin | null = m?.caller_attribution ?? null;
  const headers: Record<string, string> | undefined =
    currentAttempt?.request_headers ?? m?.request_headers ?? undefined;

  const floatStyle: CSSProperties | undefined =
    floating && rect
      ? minimized
        ? { left: rect.left, top: 'auto', bottom: 16, width: 380, height: 'auto' }
        : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : undefined;

  const controls = isPage ? null : (
    <div className="drawer__controls flex shrink-0 items-center gap-0.5">
      {floating ? (
        <>
          <IconButton
            label={minimized ? t('messages.drawer.restore') : t('messages.drawer.minimize')}
            onClick={() => setMinimized((v) => !v)}
          >
            {minimized ? <Maximize2 /> : <Minus />}
          </IconButton>
          <IconButton label={t('messages.drawer.dock')} onClick={dock}>
            <PanelRight />
          </IconButton>
        </>
      ) : (
        <IconButton label={t('messages.drawer.float')} onClick={popOut}>
          <PictureInPicture2 />
        </IconButton>
      )}
      <IconButton label={t('messages.drawer.openInTab')} onClick={openInTab}>
        <ExternalLink />
      </IconButton>
      <IconButton label={t('messages.drawer.close')} onClick={onClose}>
        <X />
      </IconButton>
    </div>
  );

  return (
    <aside
      ref={boxRef}
      className={cx(
        'drawer drawer--open',
        isPage ? 'drawer--page' : floating ? 'drawer--floating' : 'w-[min(880px,100vw)]',
        floating && minimized && 'drawer--minimized',
      )}
      style={floatStyle}
      aria-label={m ? t('messages.drawer.title', { id: m.id?.slice(0, 12) ?? '' }) : undefined}
    >
      {m ? (
        <>
          {/* Request header (full width) */}
          <div
            className={cx(
              'dh drawer__header flex-col items-stretch gap-2',
              floating && 'cursor-move select-none',
            )}
            onMouseDown={startDrag}
          >
            <div className="drawer__title-row flex items-center justify-between gap-3">
              <h3 className="drawer__title truncate font-mono text-sm font-semibold text-ink">
                {t('messages.drawer.title', { id: m.id?.slice(0, 12) ?? '' })}
              </h3>
              {controls}
            </div>
            {minimized && floating ? null : (
              <div className="drawer__meta-row flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span className={cx('drawer-status', requestStatusClass(requestStatus))}>
                  {statusLabel(requestStatus)}
                </span>
                {requestPending ? (
                  <span className="spinner" aria-label={t('messages.drawer.autoRefresh')} />
                ) : null}
                {headerProvider ? (
                  <>
                    <span className="drawer__meta-sep text-faint">{'·'}</span>
                    <span className="drawer__meta-text inline-flex items-center gap-1 text-dim">
                      <span className="relative inline-flex size-3.5 shrink-0">
                        {providerIcon(headerProvider, 14)}
                        {authBadgeFor(headerAuthType, 8)}
                      </span>
                      {headerModel}
                    </span>
                  </>
                ) : null}
                {m.virtual_model_name ? (
                  <span
                    className="tier-badge tier-badge--virtual badge is-accent"
                    title={t('messages.table.virtualModel', { name: m.virtual_model_name })}
                  >
                    {m.virtual_model_name}
                  </span>
                ) : null}
                {origin?.clientIp ? (
                  <>
                    <span className="drawer__meta-sep text-faint">{'·'}</span>
                    <span className="drawer__meta-text font-mono">{origin.clientIp}</span>
                  </>
                ) : null}
                {m.timestamp ? (
                  <>
                    <span className="drawer__meta-sep text-faint">{'·'}</span>
                    <span className="drawer__meta-text">{fmtDate(m.timestamp)}</span>
                  </>
                ) : null}
              </div>
            )}
          </div>

          {minimized && floating ? null : (
            <div className="drawer__split flex min-h-0 flex-1 flex-col sm:flex-row">
              {/* Attempts sidebar — hidden when no attempts */}
              {attempts.length > 0 ? (
                <div className="drawer__sidebar shrink-0 overflow-y-auto border-b border-line p-2 sm:w-52 sm:border-b-0 sm:border-r">
                  <div className="drawer__sidebar-title eyebrow px-1.5 pb-1.5">
                    {t('messages.drawer.attempts')}
                  </div>
                  {attempts.map((att, idx) => (
                    <button
                      key={att.id ?? idx}
                      type="button"
                      className={cx(
                        'attempt-item flex w-full cursor-pointer items-center gap-1.5 rounded-control border-0 bg-transparent px-1.5 py-1.5 text-left text-xs text-dim hover:bg-s2',
                        selectedAttempt === idx && 'attempt-item--active bg-accent-tint text-ink',
                      )}
                      aria-pressed={selectedAttempt === idx}
                      onClick={() => {
                        setSelectedAttempt(idx);
                        setTab('details');
                      }}
                    >
                      <span className="attempt-item__num font-mono text-faint">{att.index}</span>
                      <span className="attempt-item__icon inline-flex text-muted">
                        {att.type === 'fallback' ? (
                          <FallbackIcon />
                        ) : (
                          <ArrowRight aria-hidden="true" className="size-3.5" />
                        )}
                      </span>
                      <span className="attempt-item__model min-w-0 flex-1 truncate">
                        {att.model ?? t('messages.drawer.noProvider')}
                      </span>
                      <span className={cx('attempt-code', attemptStatusClass(att.status))}>
                        {attemptCode(att)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Attempt content */}
              <div className="drawer__content flex min-h-0 min-w-0 flex-1 flex-col">
                <Tabs
                  className="drawer__tabs-full mb-0 shrink-0 px-3"
                  items={visibleTabs}
                  value={activeTab}
                  onChange={setTab}
                />
                {activeTab === 'details' ? (
                  <div className="db drawer__body">
                    {currentAttempt ? (
                      <AttemptDetails att={currentAttempt} attempts={attempts} />
                    ) : (
                      <div className="text-sm text-muted">{t('messages.drawer.rejected')}</div>
                    )}
                    {origin?.clientIp || origin?.peerIp ? (
                      <DetailCard title={t('messages.drawer.origin_section')}>
                        <div className="drawer-metadata">
                          {origin.clientIp ? (
                            <Kv label={t('messages.details.field.clientIp')}>
                              <span className="font-mono">{origin.clientIp}</span>
                            </Kv>
                          ) : null}
                          {origin.clientIpSource ? (
                            <Kv label={t('messages.details.field.clientIpSource')}>
                              <span className="font-mono">{origin.clientIpSource}</span>
                            </Kv>
                          ) : null}
                          {origin.peerIp ? (
                            <Kv label={t('messages.details.field.peer')}>
                              <span className="font-mono">
                                {formatPeer(origin.peerIp, origin.peerPort)}
                              </span>
                            </Kv>
                          ) : null}
                        </div>
                      </DetailCard>
                    ) : null}
                    {headers && Object.keys(headers).length > 0 ? (
                      <DetailCard title={t('messages.drawer.requestHeaders')}>
                        <RequestHeadersList headers={headers} />
                      </DetailCard>
                    ) : null}
                  </div>
                ) : activeTab === 'timeline' && m.timeline ? (
                  <div className="db drawer__body">
                    <RequestTimelineChart timeline={m.timeline} />
                  </div>
                ) : currentAttempt ? (
                  <div className="drawer__messages-pane min-h-0 flex-1 overflow-hidden">
                    {activeTab === 'request' ? (
                      <RequestView
                        recording={currentAttempt.recording ?? null}
                        fallbackParams={currentAttempt.request_params}
                      />
                    ) : activeTab === 'response' ? (
                      <ResponseView
                        recording={currentAttempt.recording ?? null}
                        pending={attemptPending}
                      />
                    ) : activeTab === 'tools' ? (
                      <ToolsView
                        recording={currentAttempt.recording ?? null}
                        pending={attemptPending}
                      />
                    ) : (
                      <RawView recording={currentAttempt.recording ?? null} />
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="db drawer__body flex h-[200px] items-center justify-center text-sm text-muted">
          {t('messages.drawer.loading')}
        </div>
      )}
    </aside>
  );
}
