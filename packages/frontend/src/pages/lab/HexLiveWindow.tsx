/**
 * Lab only: a live session window in the "anoma-ly-hex" look (the reference's
 * OpenCode card): icon, title and mono path in the header, a status chip that
 * flashes green on activity, the live session views in the well and a footer
 * with only the final model and the reasoning effort.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Braces,
  ListTree,
  Maximize2,
  MessageSquare,
  Minimize2,
  Pin,
  PinOff,
  RotateCw,
  Rows3,
  X,
} from 'lucide-react';
import { liveSessionStatus, type LiveAttempt, type LiveSessionStatus } from 'thinker-shared';
import { ThemedIcon } from '../../components/setup-ui.js';
import {
  ChatView,
  CompactView,
  DetailsView,
  InspectorView,
  ReplayClock,
  fmtInt,
  type ViewOpts,
} from '../../components/live-session/LiveSessionViews.js';
import type { LiveTab, LiveWindowPrefs } from '../../components/live-session/live-windows-store.js';
import { t } from '../../i18n/index.js';
import { PROVIDERS } from '../../services/providers.js';
import { useLiveFeed, type LiveSessionFeed } from '../../services/live-session-feed.js';
import { shortId } from '../sessions/session-format.js';
import { effortOf, finalAttempt } from './live-agents-hex.js';

const STATUS_KEY: Record<LiveSessionStatus, string> = {
  idle: 'idle',
  waiting: 'waiting',
  streaming: 'streaming',
  retrying: 'retrying',
  tools: 'tools',
  finished: 'finished',
  cancelled: 'cancelled',
  failed: 'failed',
  waiting_request: 'waitingRequest',
};

const statusLabel = (s: LiveSessionStatus) =>
  t(`liveSession.status.${STATUS_KEY[s]}` as 'liveSession.status.idle');

/** Provider display name without the access-mode suffix ("ChatGPT Pro (subscription)"). */
const providerName = (id: string) =>
  (
    PROVIDERS.find((p) => p.id === id)?.name ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : '')
  ).replace(/\s*\([^)]*\)$/, '');

/** "OpenAI / gpt-5.5-mini" for the footer. */
export function modelLabel(a: Pick<LiveAttempt, 'provider' | 'model'> | null): string {
  if (!a) return '—';
  const p = providerName(a.provider);
  return p ? `${p} / ${a.model}` : a.model;
}

const Chevron = () => (
  <svg className="lab-hex-chevron" width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
    <path
      d="M1 1.5 4 4.5 7 1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const TABS: { key: LiveTab; Icon: typeof MessageSquare }[] = [
  { key: 'chat', Icon: MessageSquare },
  { key: 'details', Icon: ListTree },
  { key: 'inspector', Icon: Braces },
];

const VIEW_OPTS: ViewOpts = { showThinking: true, showMeta: true, autoCollapse: true };

export default function HexLiveWindow({
  feed,
  prefs,
  onPrefs,
  onClose,
  pinned,
  onPin,
  ended,
  iconSrc,
  closesInSec,
}: {
  feed: LiveSessionFeed;
  prefs: LiveWindowPrefs;
  onPrefs: (patch: LiveWindowPrefs) => void;
  onClose: () => void;
  pinned: boolean;
  onPin: () => void;
  ended: boolean;
  /** Harness platform icon; a neutral glyph without one. */
  iconSrc?: string | null;
  /** Seconds until the window closes by itself (null: it stays). */
  closesInSec?: number | null;
}) {
  useLiveFeed(feed);
  const state = feed.state;
  const status = liveSessionStatus(state);
  const tab: LiveTab = prefs.tab ?? 'chat';
  const compact = prefs.mode === 'compact';
  const maximized = !!prefs.maximized && !compact;
  const body = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  // Green flash on the chip for every new event; ring glow when a turn completes.
  const activity = state.lastEventId;
  const [flash, setFlash] = useState(false);
  const firstActivity = useRef(activity);
  useEffect(() => {
    if (activity === firstActivity.current) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 450);
    return () => clearTimeout(timer);
  }, [activity]);
  const [glow, setGlow] = useState(false);
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (status !== 'finished' || was === 'finished') return;
    setGlow(true);
    const timer = setTimeout(() => setGlow(false), 1200);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (stick && body.current) body.current.scrollTop = body.current.scrollHeight;
  });

  const session = feed.session;
  const title =
    (session as { title?: string | null } | null)?.title ||
    session?.agentName ||
    shortId(feed.sessionId);
  const path = [session?.harness ?? session?.agentName, feed.sessionId].filter(Boolean).join(' · ');
  const attempt = finalAttempt(state);
  const effort = effortOf(attempt?.body) ?? '—';
  const tools = state.items.reduce(
    (n, i) => n + (i.kind === 'attempt' ? i.blocks.filter((b) => b.type === 'tool_use').length : 0),
    0,
  );
  const count = [
    t('liveSession.totals.requests', { n: fmtInt(state.totals.requests) }),
    tools ? `${fmtInt(tools)} ${tools === 1 ? 'tool call' : 'tool calls'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const chipText = feed.error
    ? feed.error === 'not_found'
      ? t('liveSession.error.notFound')
      : t('liveSession.error.tooMany')
    : `${ended && status !== 'finished' ? t('sessions.wall.finished') : statusLabel(status)} · ${count}`;

  return (
    <div
      role="region"
      aria-label={t('liveSession.windowLabel', { title })}
      className={`lab-hex-win${glow ? ' lab-hex-win--glow' : ''}`}
    >
      <div
        className="lab-hex-win__head"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          if (!compact) onPrefs({ maximized: !maximized });
        }}
      >
        <span className="lab-hex-win__icon">
          {iconSrc ? (
            <ThemedIcon src={iconSrc} size={18} className="platform-icon" />
          ) : (
            <Bot size={12} />
          )}
        </span>
        <span className="lab-hex-win__title" title={title}>
          {title}
        </span>
        <span className="lab-hex-win__path" title={path}>
          {path}
        </span>
        <button
          type="button"
          className="lab-hex-win__btn"
          title={pinned ? t('sessions.wall.unpin') : t('sessions.wall.pin')}
          aria-label={pinned ? t('sessions.wall.unpin') : t('sessions.wall.pin')}
          aria-pressed={pinned}
          onClick={onPin}
        >
          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button
          type="button"
          className="lab-hex-win__btn"
          title={compact ? t('liveSession.fullView') : t('liveSession.shortView')}
          aria-label={compact ? t('liveSession.fullView') : t('liveSession.shortView')}
          aria-pressed={compact}
          onClick={() => onPrefs({ mode: compact ? 'normal' : 'compact', maximized: false })}
        >
          <Rows3 size={13} />
        </button>
        {!compact && (
          <button
            type="button"
            className="lab-hex-win__btn"
            title={maximized ? t('liveSession.restoreSize') : t('liveSession.maximize')}
            aria-label={maximized ? t('liveSession.restoreSize') : t('liveSession.maximize')}
            onClick={() => onPrefs({ maximized: !maximized })}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
        <button
          type="button"
          className="lab-hex-win__btn"
          title={t('liveSession.close')}
          aria-label={t('liveSession.close')}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      <div className="lab-hex-win__row">
        <span
          className={`lab-hex-chip${flash ? ' lab-hex-chip--flash' : ''}${feed.error ? ' lab-hex-chip--danger' : ''}`}
          aria-live="polite"
        >
          <i className="lab-hex-grid" aria-hidden="true">
            <b />
            <b />
            <b />
            <b />
          </i>
          <span>{chipText}</span>
        </span>
        {feed.error === 'too_many' ? (
          <button
            type="button"
            className="lab-hex-win__btn"
            title={t('liveSession.retry')}
            aria-label={t('liveSession.retry')}
            onClick={() => feed.reconnect()}
          >
            <RotateCw size={12} />
          </button>
        ) : null}
        {closesInSec != null ? (
          <span className="lab-hex-win__closes">closes in {closesInSec}s</span>
        ) : null}
        <span className="lab-hex-win__tabs" role="tablist">
          {!compact &&
            TABS.map(({ key, Icon }) => {
              const label = t(`liveSession.tab.${key}` as 'liveSession.tab.chat');
              return (
                <button
                  key={key}
                  type="button"
                  className="lab-hex-win__btn"
                  role="tab"
                  aria-selected={tab === key}
                  title={label}
                  aria-label={label}
                  onClick={() => onPrefs({ tab: key })}
                >
                  <Icon size={13} />
                </button>
              );
            })}
        </span>
      </div>

      {compact ? (
        <div className="lab-hex-well" style={{ flex: 'none' }}>
          <div className="lab-hex-well__scroll" style={{ padding: 0 }}>
            <CompactView state={state} showThinking />
          </div>
        </div>
      ) : (
        <div className="lab-hex-well">
          <div
            ref={body}
            className={`lab-hex-well__scroll ${tab === 'inspector' ? 'space-y-2' : 'space-y-4'}`}
            onScroll={(e) => {
              const el = e.currentTarget;
              setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
            }}
          >
            <ReplayClock.Provider value={feed.live && !ended ? null : state.lastTs}>
              {state.items.length === 0 ? (
                <div className="py-12 text-center text-[12px] text-muted">
                  {feed.conn === 'connecting'
                    ? t('liveSession.connecting')
                    : t('liveSession.empty')}
                </div>
              ) : tab === 'chat' ? (
                <ChatView state={state} opts={VIEW_OPTS} />
              ) : tab === 'details' ? (
                <DetailsView state={state} opts={VIEW_OPTS} />
              ) : (
                <InspectorView state={state} />
              )}
            </ReplayClock.Provider>
          </div>
        </div>
      )}

      <div className="lab-hex-win__foot">
        <span className="lab-hex-win__model" title={modelLabel(attempt)}>
          <span>{modelLabel(attempt)}</span>
          <Chevron />
        </span>
        <span className="lab-hex-win__effort" title="Reasoning effort">
          {effort}
          <Chevron />
        </span>
      </div>
    </div>
  );
}
