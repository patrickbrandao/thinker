/* Lab prototype: one floating live-session window. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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
  Rows3,
  Unplug,
  X,
} from 'lucide-react';
import { cx } from '../../components/ui.js';
import { reduceEvents, type LiveAttempt, type LiveState } from './live-session-sim.js';
import { useFeed, type FeedClient } from './live-session-feed.js';
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

type Tab = 'chat' | 'details' | 'inspector';
type Mode = 'normal' | 'compact' | 'minimized';

function sessionStatus(state: LiveState): {
  label: string;
  tone: 'ok' | 'accent' | 'warn' | 'muted' | 'danger';
} {
  const last = state.items.at(-1);
  if (!last) return { label: 'Idle', tone: 'muted' };
  if (last.kind === 'attempt') {
    if (last.status === 'waiting')
      return { label: last.attempt > 1 ? 'Retrying' : 'Waiting for provider', tone: 'accent' };
    if (last.status === 'streaming') return { label: 'Streaming', tone: 'accent' };
    if (last.status === 'failed')
      return last.error?.next === 'give_up'
        ? { label: 'Failed', tone: 'danger' }
        : { label: 'Retrying', tone: 'warn' };
    if (last.status === 'cancelled') return { label: 'Cancelled', tone: 'muted' };
    if (last.stopReason === 'tool_use' || last.stopReason === 'tool_calls')
      return { label: 'Harness running tools', tone: 'warn' };
    return { label: 'Turn finished', tone: 'ok' };
  }
  if (last.role === 'tool') return { label: 'Harness running tools', tone: 'warn' };
  return { label: 'Waiting for request', tone: 'muted' };
}

const TONE: Record<string, string> = {
  accent: 'bg-accent-tint text-accent-soft',
  warn: 'bg-warn-tint text-warn',
  ok: 'bg-ok-tint text-ok',
  muted: 'bg-s3 text-muted',
  danger: 'bg-danger-tint text-danger',
};

const IconBtn = ({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    className={cx(
      'rounded p-1 hover:bg-s3 hover:text-ink',
      active ? 'bg-s3 text-ink' : 'text-muted',
    )}
  >
    {children}
  </button>
);

export default function LiveSessionWindow({
  client,
  index,
  z,
  onFocus,
  onClose,
  autoCollapse,
}: {
  client: FeedClient;
  index: number;
  z: number;
  onFocus: () => void;
  onClose: () => void;
  autoCollapse: boolean;
}) {
  useFeed(client);
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>('normal');
  const [maximized, setMaximized] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [stick, setStick] = useState(true);
  const [opts, setOpts] = useState<Omit<ViewOpts, 'autoCollapse'>>({
    showThinking: true,
    showMeta: true,
  });
  const [replay, setReplay] = useState<number | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);

  // ------------------------------------------------------------- replay
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(
    () => client.server.history(client.state.lastEventId),
    [client, client.version],
  );
  const historyRef = useRef(history);
  historyRef.current = history;
  const firstId = history[0]?.id ?? 0;
  const liveId = client.state.lastEventId;
  const view = useMemo(
    () => (replay == null ? client.state : reduceEvents(client.server.history(replay))),
    [replay, client, client.version],
  );
  const markers = useMemo(
    () =>
      history.filter(
        (e) =>
          e.type === 'request.started' ||
          e.type === 'request.failed' ||
          (e.type === 'message.appended' && e.data.role === 'user'),
      ),
    [history.length],
  );

  useEffect(() => {
    if (!replayPlaying || replay == null) return;
    const history = historyRef.current;
    const i = history.findIndex((e) => e.id > replay);
    if (i < 0) {
      setReplay(null);
      setReplayPlaying(false);
      return;
    }
    const prev = history.find((e) => e.id === replay) ?? history[0]!;
    const wait = Math.min(800, Math.max(0, history[i]!.ts - prev.ts));
    const t = setTimeout(() => setReplay(history[i]!.id), wait);
    return () => clearTimeout(t);
  }, [replay, replayPlaying]);

  useEffect(() => {
    if (stick && body.current) body.current.scrollTop = body.current.scrollHeight;
  });

  // --------------------------------------------------------------- drag
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || maximized) return;
    const r = ref.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const r = ref.current?.getBoundingClientRect();
    if (!d || !r) return;
    setPos({
      x: Math.min(Math.max(e.clientX - d.dx, 0), window.innerWidth - r.width),
      y: Math.min(Math.max(e.clientY - d.dy, 0), window.innerHeight - 44),
    });
  };

  const session = client.session;
  const status = sessionStatus(view);
  const live = status.tone === 'accent';
  const conn = client.conn;
  const lastAttempt = [...view.items].reverse().find((i): i is LiveAttempt => i.kind === 'attempt');
  const fullOpts: ViewOpts = { ...opts, autoCollapse };

  const style: React.CSSProperties = { zIndex: 70 + z };
  if (maximized && mode === 'normal')
    Object.assign(style, { inset: 12, width: 'auto', height: 'auto', resize: 'none' });
  else if (pos) Object.assign(style, { left: pos.x, top: pos.y });
  else Object.assign(style, { right: 24 + index * 32, top: 64 + index * 32 });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Live session ${session.title}`}
      onPointerDownCapture={onFocus}
      className={cx(
        'fixed flex flex-col overflow-hidden rounded-lg border border-line bg-elev shadow-[var(--shadow-float)]',
        mode === 'normal' &&
          'h-[min(720px,calc(100vh-96px))] w-[min(640px,calc(100vw-32px))] min-h-[280px] min-w-[380px] resize',
        mode === 'compact' && 'w-[380px]',
        mode === 'minimized' && 'w-[320px]',
      )}
      style={style}
    >
      {/* Title bar */}
      <div
        className="flex cursor-grab select-none items-center gap-2 border-b border-line bg-s2 px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => mode === 'normal' && setMaximized((m) => !m)}
      >
        <span className="relative flex size-2.5 shrink-0">
          {live && conn === 'open' && replay == null && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
          )}
          <span
            className={cx(
              'relative inline-flex size-2.5 rounded-full',
              replay != null
                ? 'bg-[var(--port-2)]'
                : conn === 'open'
                  ? live
                    ? 'bg-danger'
                    : 'bg-ok'
                  : 'bg-warn',
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{session.title}</div>
          <div className="truncate text-[11px] text-muted">
            {session.harness} · {mode === 'normal' ? `${session.agent} · ` : ''}
            <span className="font-mono">{session.sessionId}</span>
          </div>
        </div>
        <IconBtn
          title={mode === 'compact' ? 'Full view' : 'Short view (last 3 items)'}
          active={mode === 'compact'}
          onClick={() => setMode((m) => (m === 'compact' ? 'normal' : 'compact'))}
        >
          <Rows3 size={14} />
        </IconBtn>
        <IconBtn
          title={mode === 'minimized' ? 'Restore' : 'Minimize'}
          onClick={() => setMode((m) => (m === 'minimized' ? 'normal' : 'minimized'))}
        >
          <Minus size={15} />
        </IconBtn>
        {mode === 'normal' && (
          <IconBtn
            title={maximized ? 'Restore size' : 'Maximize'}
            onClick={() => setMaximized((m) => !m)}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconBtn>
        )}
        <IconBtn title="Close" onClick={onClose}>
          <X size={15} />
        </IconBtn>
      </div>

      {mode === 'compact' && (
        <>
          <div className="flex items-center gap-2 border-b border-line px-3 py-1 text-[11px] text-muted">
            <span className={cx('rounded px-1.5 py-0.5 font-medium', TONE[status.tone])}>
              {status.label}
            </span>
            {lastAttempt && <span className="truncate font-mono">{lastAttempt.model}</span>}
            <span className="flex-1" />
            <span>{fmtUsd(view.totals.costUsd)}</span>
          </div>
          <CompactView state={client.state} showThinking={opts.showThinking} />
        </>
      )}

      {mode === 'normal' && (
        <>
          {/* Tabs + status */}
          <div className="flex items-center gap-1 border-b border-line px-2">
            {(['chat', 'details', 'inspector'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cx(
                  '-mb-px border-b-2 px-2.5 py-1.5 text-[12px] font-medium',
                  tab === t
                    ? 'border-accent text-ink'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {t === 'chat' ? 'Chat' : t === 'details' ? 'Details' : 'Inspector'}
              </button>
            ))}
            <span className="flex-1" />
            <span
              className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', TONE[status.tone])}
            >
              {status.label}
            </span>
          </div>
          {tab !== 'chat' && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
              {lastAttempt && <span className="font-mono">{lastAttempt.model}</span>}
              <span>{view.totals.requests} req</span>
              <span>
                {fmtInt(view.totals.input)} in / {fmtInt(view.totals.output)} out
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
                    Thinking
                  </label>
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={opts.showMeta}
                      onChange={(e) => setOpts({ ...opts, showMeta: e.target.checked })}
                    />
                    Metrics
                  </label>
                </>
              )}
            </div>
          )}
          {conn !== 'open' && (
            <div className="flex items-center gap-2 border-b border-warn/30 bg-warn-tint px-3 py-1.5 text-[12px] text-warn">
              <Unplug size={13} /> Connection lost. Reconnecting with Last-Event-ID{' '}
              {client.lastId ?? '—'}…
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
              <ReplayClock.Provider value={replay == null ? null : view.lastTs}>
                {view.items.length === 0 ? (
                  <div className="py-16 text-center text-[13px] text-muted">
                    No activity yet. The chat appears as the harness talks to the provider.
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
                <ArrowDown size={13} /> {live ? 'Follow live' : 'Jump to latest'}
              </button>
            )}
          </div>

          {/* Playback bar */}
          <div className="flex items-center gap-2 border-t border-line bg-s2 px-3 py-1.5 text-[11px] text-muted">
            <IconBtn
              title={replayPlaying ? 'Pause replay' : 'Replay from here'}
              onClick={() => {
                if (replayPlaying) return setReplayPlaying(false);
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
                min={firstId}
                max={Math.max(firstId, liveId)}
                value={replay ?? liveId}
                disabled={liveId <= firstId}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setReplayPlaying(false);
                  setReplay(v >= liveId ? null : v);
                }}
              />
            </div>
            {replay == null ? (
              <span className="flex w-24 items-center justify-end gap-1 font-medium text-danger">
                <Radio size={12} /> LIVE
              </span>
            ) : (
              <button
                type="button"
                className="flex w-24 items-center justify-end gap-1 font-medium text-[var(--port-2)] hover:underline"
                onClick={() => {
                  setReplay(null);
                  setReplayPlaying(false);
                }}
                title="Back to live"
              >
                <History size={12} /> {fmtSecs(view.lastTs - (history[0]?.ts ?? view.lastTs))} →
                live
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
