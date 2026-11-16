/* One floating live-session window: title bar, tabs, views, replay bar. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  History,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Radio,
  RotateCw,
  Rows3,
  Unplug,
  X,
} from 'lucide-react';
import { liveSessionStatus, type LiveAttempt, type LiveSessionStatus } from 'thinker-shared';
import { cx } from '../ui.js';
import { t } from '../../i18n/index.js';
import { useLiveFeed, type LiveSessionFeed } from '../../services/live-session-feed.js';
import { shortId } from '../../pages/sessions/session-format.js';
import {
  ChatView,
  CompactView,
  DetailsView,
  InspectorView,
  ReplayClock,
  fmtInt,
  fmtSecs,
  fmtUsd,
  type ViewOpts,
} from './LiveSessionViews.js';
import type { LiveMode, LiveTab, LiveWindowPrefs } from './live-windows-store.js';

type Tone = 'ok' | 'accent' | 'warn' | 'muted' | 'danger';

const STATUS: Record<LiveSessionStatus, { key: StatusKey; tone: Tone }> = {
  idle: { key: 'idle', tone: 'muted' },
  waiting: { key: 'waiting', tone: 'accent' },
  streaming: { key: 'streaming', tone: 'accent' },
  retrying: { key: 'retrying', tone: 'warn' },
  tools: { key: 'tools', tone: 'warn' },
  finished: { key: 'finished', tone: 'ok' },
  cancelled: { key: 'cancelled', tone: 'muted' },
  failed: { key: 'failed', tone: 'danger' },
  waiting_request: { key: 'waitingRequest', tone: 'muted' },
};
type StatusKey =
  | 'idle'
  | 'waiting'
  | 'streaming'
  | 'retrying'
  | 'tools'
  | 'finished'
  | 'cancelled'
  | 'failed'
  | 'waitingRequest';

const statusLabel = (key: StatusKey) => t(`liveSession.status.${key}` as 'liveSession.status.idle');

/** The provider is (or is about to be) answering: the title dot pulses red. */
const PROVIDER_BUSY = new Set<LiveSessionStatus>(['waiting', 'streaming', 'retrying']);

const TONE: Record<Tone, string> = {
  accent: 'bg-accent-tint text-accent-soft',
  warn: 'bg-warn-tint text-warn',
  ok: 'bg-ok-tint text-ok',
  muted: 'bg-s3 text-muted',
  danger: 'bg-danger-tint text-danger',
};

const TAB_KEYS: readonly LiveTab[] = ['chat', 'details', 'inspector'];
const TITLE_BAR = 44;

const IconBtn = ({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    onClick={onClick}
    className={cx(
      'rounded p-1 hover:bg-s3 hover:text-ink',
      active ? 'bg-s3 text-ink' : 'text-muted',
    )}
  >
    {children}
  </button>
);

/** Keeps a saved position inside the current viewport. */
function clampPos(x: number, y: number, width: number) {
  return {
    x: Math.min(
      Math.max(x, 0),
      Math.max(0, window.innerWidth - Math.min(width, window.innerWidth)),
    ),
    y: Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - TITLE_BAR)),
  };
}

export interface LiveSessionWindowProps {
  feed: LiveSessionFeed;
  /** Cascade slot for windows without a saved position. */
  slot: number;
  /** Stacking order among the open windows (higher is in front). */
  z: number;
  prefs: LiveWindowPrefs;
  onPrefs: (patch: LiveWindowPrefs) => void;
  onFocus: () => void;
  onClose: () => void;
  /** Open positioned at the end of this request (replay paused there). */
  focusRequestId?: string | null;
  /** Bumped when the same window is asked to position on a request again. */
  focusNonce?: number;
  /**
   * Render as a tile in a grid (the live agents wall) instead of a floating
   * window: no drag, resize or minimize; maximize fills the page.
   */
  tile?: boolean;
  /** Extra title-bar content before the window buttons (tile badges, pin). */
  titleExtra?: ReactNode;
  /** The session stopped and its feed was closed on purpose: not a lost connection. */
  ended?: boolean;
}

export default function LiveSessionWindow({
  feed,
  slot,
  z,
  prefs,
  onPrefs,
  onFocus,
  onClose,
  focusRequestId,
  focusNonce = 0,
  tile = false,
  titleExtra,
  ended = false,
}: LiveSessionWindowProps) {
  useLiveFeed(feed);
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() =>
    prefs.x != null && prefs.y != null && typeof window !== 'undefined'
      ? clampPos(prefs.x, prefs.y, prefs.w ?? 380)
      : null,
  );
  const [size, setSize] = useState<{ w: number; h: number } | null>(() =>
    prefs.w && prefs.h && typeof window !== 'undefined'
      ? {
          w: Math.min(prefs.w, window.innerWidth - 16),
          h: Math.min(prefs.h, window.innerHeight - 16),
        }
      : null,
  );
  const mode: LiveMode = prefs.mode ?? 'normal';
  const maximized = !!prefs.maximized;
  const tab: LiveTab = prefs.tab ?? 'chat';
  const setMode = (m: LiveMode) => onPrefs({ mode: m });
  const setMaximized = (m: boolean) => onPrefs({ maximized: m });
  const [stick, setStick] = useState(true);
  const [opts, setOpts] = useState<Omit<ViewOpts, 'autoCollapse'>>({
    showThinking: true,
    showMeta: true,
  });
  const [replay, setReplay] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const live = feed.live;
  const historyReady = feed.historyStatus === 'ready';

  // ------------------------------------------------------------- replay
  const history = feed.timeline();
  const historyRef = useRef(history);
  historyRef.current = history;
  const firstId = history[0]?.id ?? (live ? 1 : 0);
  const liveId = feed.state.lastEventId;
  const v = feed.version;
  const view = useMemo(
    () => (replay == null || !historyReady ? feed.state : feed.stateAt(replay)),
    // feed.state is mutated in place; the version tells it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replay, feed, historyReady, v],
  );
  const markers = useMemo(
    () =>
      history.filter(
        (e) =>
          e.type === 'request.started' ||
          e.type === 'request.failed' ||
          (e.type === 'message.appended' && (e.data as { role?: unknown }).role === 'user'),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, history.length],
  );

  const pendingFraction = useRef<number | null>(null);
  useEffect(() => {
    if (!historyReady || pendingFraction.current == null) return;
    const h = historyRef.current;
    const fraction = pendingFraction.current;
    pendingFraction.current = null;
    if (!h.length) return;
    const first = h[0]!.id;
    const target = first + fraction * (feed.state.lastEventId - first);
    // Snap to a real event id at or before the clicked point.
    let at = first;
    for (const e of h) {
      if (e.id > target) break;
      at = e.id;
    }
    setReplay(at >= feed.state.lastEventId ? null : at);
  }, [historyReady, feed]);

  // A finished session starts from the beginning and plays; "Open session"
  // stops at the end of the chosen request.
  const positioned = useRef<string | null>(null);
  useEffect(() => {
    const want = focusRequestId ? `r:${focusRequestId}:${focusNonce}` : live ? null : 'start';
    if (!want || positioned.current === want) return;
    if (!historyReady) {
      void feed.ensureHistory();
      return;
    }
    positioned.current = want;
    if (focusRequestId) {
      const at = feed.lastEventOfRequest(focusRequestId);
      setReplayPlaying(false);
      setReplay(at != null && at < feed.state.lastEventId ? at : null);
    } else {
      const first = feed.history?.[0]?.id;
      if (first != null && first < feed.state.lastEventId) {
        setReplay(first);
        setReplayPlaying(true);
      }
    }
  }, [feed, live, historyReady, focusRequestId, focusNonce]);

  useEffect(() => {
    if (!replayPlaying || replay == null || !historyReady) return;
    const h = historyRef.current;
    const i = h.findIndex((e) => e.id > replay);
    if (i < 0) {
      setReplay(null);
      setReplayPlaying(false);
      return;
    }
    const prev = h.find((e) => e.id === replay) ?? h[0]!;
    const wait = Math.min(800, Math.max(0, h[i]!.ts - prev.ts));
    const timer = setTimeout(() => setReplay(h[i]!.id), wait);
    return () => clearTimeout(timer);
  }, [replay, replayPlaying, historyReady]);

  useEffect(() => {
    if (stick && body.current) body.current.scrollTop = body.current.scrollHeight;
  });

  // ------------------------------------------------- size persistence
  // The corner handle is the browser's native resize. Only a drag that starts
  // on that corner is saved, so viewport changes never become saved sizes.
  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    onFocus();
    const el = ref.current;
    if (tile || !el || mode !== 'normal' || maximized) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.right - 20 || e.clientY < r.bottom - 20) return;
    const start = { w: r.width, h: r.height };
    const done = () => {
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      const now = el.getBoundingClientRect();
      if (Math.abs(now.width - start.w) < 1 && Math.abs(now.height - start.h) < 1) return;
      const next = { w: Math.round(now.width), h: Math.round(now.height) };
      setSize(next);
      onPrefs(next);
    };
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  };

  // --------------------------------------------------------------- drag
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tile || (e.target as HTMLElement).closest('button') || (maximized && mode === 'normal'))
      return;
    const r = ref.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const r = ref.current?.getBoundingClientRect();
    if (!d || !r) return;
    d.moved = true;
    setPos({
      x: Math.min(Math.max(e.clientX - d.dx, 0), window.innerWidth - r.width),
      y: Math.min(Math.max(e.clientY - d.dy, 0), window.innerHeight - TITLE_BAR),
    });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && pos) onPrefs({ x: Math.round(pos.x), y: Math.round(pos.y) });
  };

  const session = feed.session;
  const status = STATUS[liveSessionStatus(view)];
  const busy = PROVIDER_BUSY.has(liveSessionStatus(view));
  const conn = feed.conn;
  const lastAttempt = [...view.items].reverse().find((i): i is LiveAttempt => i.kind === 'attempt');
  // The short view has no replay bar: it always shows the live end.
  const liveStatus = STATUS[liveSessionStatus(feed.state)];
  const liveAttempt = [...feed.state.items]
    .reverse()
    .find((i): i is LiveAttempt => i.kind === 'attempt');
  const fullOpts: ViewOpts = { ...opts, autoCollapse: true };
  // `title` (first user prompt) is an extra field the backend sends on the wire.
  const title =
    (session as { title?: string | null } | null)?.title ||
    session?.agentName ||
    shortId(feed.sessionId);
  const subtitle = [session?.harness, mode === 'normal' ? session?.agentName : null]
    .filter(Boolean)
    .join(' · ');
  const startHistory = () => void feed.ensureHistory();
  const lost = !ended && live && (conn === 'reconnecting' || (conn === 'closed' && !feed.error));
  const atEnd = replay == null;

  const style: CSSProperties = tile ? {} : { zIndex: 66 + z };
  if (tile) {
    if (maximized && mode === 'normal') style.zIndex = 40;
  } else if (maximized && mode === 'normal')
    Object.assign(style, { inset: 12, width: 'auto', height: 'auto', resize: 'none' });
  else {
    if (pos) Object.assign(style, { left: pos.x, top: pos.y });
    else
      Object.assign(style, {
        right: Math.min(24 + slot * 32, Math.max(8, window.innerWidth - 400)),
        top: 64 + slot * 32,
      });
    // Short and minimized views drop the saved size (React clears what it set).
    if (mode === 'normal' && size) Object.assign(style, { width: size.w, height: size.h });
  }

  const dot = (
    <span className="relative flex size-2.5 shrink-0">
      {busy && conn === 'open' && atEnd && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-70" />
      )}
      <span
        className={cx(
          'relative inline-flex size-2.5 rounded-full',
          !atEnd || !live || ended ? 'bg-[var(--port-2)]' : conn === 'open' ? 'bg-ok' : 'bg-warn',
        )}
      />
    </span>
  );

  const errorBox = feed.error ? (
    <div className="flex items-center gap-2 border-b border-danger/30 bg-danger-tint px-3 py-1.5 text-[12px] text-ink">
      <Unplug size={13} className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1">
        {feed.error === 'not_found'
          ? t('liveSession.error.notFound')
          : t('liveSession.error.tooMany')}
      </span>
      {feed.error === 'too_many' ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm h-6 px-2"
          onClick={() => feed.reconnect()}
        >
          <RotateCw size={12} /> {t('liveSession.retry')}
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      ref={ref}
      role={tile ? 'region' : 'dialog'}
      aria-label={t('liveSession.windowLabel', { title })}
      onPointerDownCapture={onPointerDownCapture}
      className={cx(
        'flex flex-col overflow-hidden rounded-lg border border-line bg-elev',
        tile
          ? maximized && mode === 'normal'
            ? 'fixed inset-2'
            : cx('relative', mode === 'normal' ? 'h-[440px]' : 'h-auto')
          : 'fixed shadow-[var(--shadow-float)]',
        !tile &&
          mode === 'normal' &&
          !maximized &&
          'h-[min(720px,calc(100vh-96px))] w-[min(640px,calc(100vw-16px))] min-h-[280px] min-w-[min(380px,calc(100vw-16px))] max-w-[calc(100vw-8px)] resize',
        !tile && mode === 'normal' && maximized && 'h-auto w-auto',
        !tile && mode === 'compact' && 'w-[min(380px,calc(100vw-16px))]',
        !tile && mode === 'minimized' && 'w-[min(320px,calc(100vw-16px))]',
      )}
      style={style}
    >
      {/* Title bar */}
      <div
        className={cx(
          'flex select-none items-center gap-2 border-b border-line bg-s2 px-3 py-2',
          !tile && 'cursor-grab touch-none active:cursor-grabbing',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          if (mode === 'normal') setMaximized(!maximized);
        }}
      >
        {dot}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{title}</div>
          <div className="truncate text-[11px] text-muted">
            {subtitle ? `${subtitle} · ` : ''}
            <span className="font-mono">{feed.sessionId}</span>
          </div>
        </div>
        {titleExtra}
        <IconBtn
          title={mode === 'compact' ? t('liveSession.fullView') : t('liveSession.shortView')}
          active={mode === 'compact'}
          onClick={() => setMode(mode === 'compact' ? 'normal' : 'compact')}
        >
          <Rows3 size={14} />
        </IconBtn>
        {!tile && (
          <IconBtn
            title={mode === 'minimized' ? t('liveSession.restore') : t('liveSession.minimize')}
            onClick={() => setMode(mode === 'minimized' ? 'normal' : 'minimized')}
          >
            <Minus size={15} />
          </IconBtn>
        )}
        {mode === 'normal' && (
          <IconBtn
            title={maximized ? t('liveSession.restoreSize') : t('liveSession.maximize')}
            onClick={() => setMaximized(!maximized)}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconBtn>
        )}
        <IconBtn title={t('liveSession.close')} onClick={onClose}>
          <X size={15} />
        </IconBtn>
      </div>

      {mode === 'compact' && (
        <>
          <div className="flex items-center gap-2 border-b border-line px-3 py-1 text-[11px] text-muted">
            <span className={cx('rounded px-1.5 py-0.5 font-medium', TONE[liveStatus.tone])}>
              {statusLabel(liveStatus.key)}
            </span>
            {liveAttempt && <span className="truncate font-mono">{liveAttempt.model}</span>}
            <span className="flex-1" />
            <span>{fmtUsd(feed.state.totals.costUsd)}</span>
          </div>
          {errorBox}
          {lost && (
            <div className="flex items-center gap-2 border-b border-warn/30 bg-warn-tint px-3 py-1 text-[11px] text-warn">
              <Unplug size={12} /> {t('liveSession.connectionLost')}
            </div>
          )}
          <CompactView state={feed.state} showThinking={opts.showThinking} />
        </>
      )}

      {mode === 'normal' && (
        <>
          {/* Tabs + status */}
          <div className="flex items-center gap-1 border-b border-line px-2" role="tablist">
            {TAB_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => onPrefs({ tab: k })}
                className={cx(
                  '-mb-px border-b-2 px-2.5 py-1.5 text-[12px] font-medium',
                  tab === k
                    ? 'border-accent text-ink'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {t(`liveSession.tab.${k}` as 'liveSession.tab.chat')}
              </button>
            ))}
            <span className="flex-1" />
            <span
              className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', TONE[status.tone])}
            >
              {statusLabel(status.key)}
            </span>
          </div>
          {tab !== 'chat' && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
              {lastAttempt && <span className="font-mono">{lastAttempt.model}</span>}
              <span>{t('liveSession.totals.requests', { n: fmtInt(view.totals.requests) })}</span>
              <span>
                {t('liveSession.totals.tokens', {
                  input: fmtInt(view.totals.input),
                  output: fmtInt(view.totals.output),
                })}
              </span>
              <span>{fmtUsd(view.totals.costUsd)}</span>
              <span className="flex-1" />
              {tab === 'details' && (
                <>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={opts.showThinking}
                      onChange={(e) => setOpts({ ...opts, showThinking: e.target.checked })}
                    />
                    {t('liveSession.opt.thinking')}
                  </label>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={opts.showMeta}
                      onChange={(e) => setOpts({ ...opts, showMeta: e.target.checked })}
                    />
                    {t('liveSession.opt.metrics')}
                  </label>
                </>
              )}
            </div>
          )}
          {errorBox}
          {lost && (
            <div className="flex items-center gap-2 border-b border-warn/30 bg-warn-tint px-3 py-1.5 text-[12px] text-warn">
              <Unplug size={13} /> {t('liveSession.connectionLost')}
            </div>
          )}

          {/* Body */}
          <div className="relative min-h-0 flex-1">
            <div
              ref={body}
              className={cx(
                'h-full space-y-4 overflow-y-auto px-4 py-4',
                tab === 'inspector' && 'space-y-2',
              )}
              onScroll={(e) => {
                const el = e.currentTarget;
                setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
              }}
            >
              <ReplayClock.Provider
                value={replay == null ? (live ? null : view.lastTs) : view.lastTs}
              >
                {view.items.length === 0 ? (
                  <div className="py-16 text-center text-[13px] text-muted">
                    {conn === 'connecting' || feed.historyStatus === 'loading'
                      ? t('liveSession.connecting')
                      : feed.historyStatus === 'error' && !live
                        ? t('liveSession.error.history')
                        : t('liveSession.empty')}
                  </div>
                ) : tab === 'chat' ? (
                  <ChatView state={view} opts={fullOpts} />
                ) : tab === 'details' ? (
                  <DetailsView state={view} opts={fullOpts} />
                ) : (
                  <InspectorView state={view} />
                )}
              </ReplayClock.Provider>
            </div>
            {!stick && (
              <button
                type="button"
                className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-accent px-3 py-1 text-[12px] font-medium text-on-accent shadow-[var(--shadow-float)]"
                onClick={() => {
                  setStick(true);
                  body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' });
                }}
              >
                <ArrowDown size={13} />{' '}
                {busy && atEnd && live
                  ? t('liveSession.followLive')
                  : t('liveSession.jumpToLatest')}
              </button>
            )}
          </div>

          {/* Playback bar */}
          <div className="flex items-center gap-2 border-t border-line bg-s2 px-3 py-1.5 text-[11px] text-muted">
            <IconBtn
              title={replayPlaying ? t('liveSession.replay.pause') : t('liveSession.replay.play')}
              onClick={() => {
                if (replayPlaying) return setReplayPlaying(false);
                startHistory();
                if (replay == null) setReplay(firstId);
                setReplayPlaying(true);
              }}
            >
              {replayPlaying ? <Pause size={13} /> : <Play size={13} />}
            </IconBtn>
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0">
                {liveId > firstId &&
                  markers.map((m) => (
                    <span
                      key={m.id}
                      className={cx(
                        'absolute -top-[7px] h-[14px] w-px',
                        m.type === 'request.failed'
                          ? 'bg-danger'
                          : m.type === 'request.started'
                            ? 'bg-ok'
                            : 'bg-accent',
                      )}
                      style={{ left: `${((m.id - firstId) / (liveId - firstId)) * 100}%` }}
                    />
                  ))}
              </div>
              <input
                type="range"
                className="relative w-full"
                aria-label={t('liveSession.replay.position')}
                min={firstId}
                max={Math.max(firstId, liveId)}
                value={replay ?? liveId}
                disabled={liveId <= firstId}
                onPointerDown={startHistory}
                onFocus={startHistory}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  startHistory();
                  setReplayPlaying(false);
                  if (!historyReady) {
                    // The range is not known until the history arrives (live
                    // ids do not start at 1): remember where along the bar
                    // the user clicked and apply it once it is loaded.
                    const span = Math.max(1, liveId - firstId);
                    pendingFraction.current = Math.min(1, Math.max(0, (next - firstId) / span));
                    return;
                  }
                  setReplay(next >= liveId ? null : next);
                }}
              />
            </div>
            {atEnd ? (
              live && !ended ? (
                <span className="flex w-24 items-center justify-end gap-1 font-medium text-ok">
                  <Radio size={12} /> {t('liveSession.replay.live')}
                </span>
              ) : (
                <span className="flex w-24 items-center justify-end gap-1 font-medium text-[var(--port-2)]">
                  <History size={12} /> {t('liveSession.replay.end')}
                </span>
              )
            ) : (
              <button
                type="button"
                className="flex w-24 items-center justify-end gap-1 font-medium text-[var(--port-2)] hover:underline"
                onClick={() => {
                  setReplay(null);
                  setReplayPlaying(false);
                }}
                title={live ? t('liveSession.replay.backToLive') : t('liveSession.replay.toEnd')}
              >
                <History size={12} />{' '}
                {feed.historyStatus === 'loading'
                  ? t('liveSession.replay.loading')
                  : t(live ? 'liveSession.replay.elapsedLive' : 'liveSession.replay.elapsedEnd', {
                      secs: fmtSecs(view.lastTs - (history[0]?.ts ?? view.lastTs)),
                    })}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
