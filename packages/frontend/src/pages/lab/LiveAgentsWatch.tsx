/*
 * Development-only lab (not part of the product): one simulated session in its
 * own browser tab, opened from a Live agents lab window ("Open in a new tab").
 * The session lives in the lab tab's fleet; this page reaches it over the
 * BroadcastChannel bridge (live-agents-bridge.ts), so the official
 * LiveSessionFeed and windows run unchanged here.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { CircleCheck, ExternalLink, Loader2, RotateCw, Unplug } from 'lucide-react';
import { platformIcon } from 'thinker-shared';
import { cx } from '../../components/ui.js';
import LiveSessionWindow from '../../components/live-session/LiveSessionWindow.js';
import type { LiveTab, LiveWindowPrefs } from '../../components/live-session/live-windows-store.js';
import { LiveSessionFeed, useLiveFeed } from '../../services/live-session-feed.js';
import HexLiveWindow from './HexLiveWindow.js';
import { BridgeClient, loadPageVia } from './live-agents-bridge.js';
import { LAB_SETTINGS_KEY, loadSettings } from './LiveAgentsLab.js';
import {
  HIDE_MAXIMIZE,
  hideMaximizeCss,
  withoutMaximize,
  type WallTheme,
} from './LiveAgentsWall.js';
import './live-agents-hex.css';

const LAB_PATH = '/lab/live-agents';

export default function LiveAgentsWatch() {
  const { sessionId = '' } = useParams();
  const [settings, setSettings] = useState(loadSettings);
  // The theme follows the lab's selection, also when it changes in the lab tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LAB_SETTINGS_KEY) setSettings(loadSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [bridge, setBridge] = useState<BridgeClient | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const b = new BridgeClient({ sessionId });
    setBridge(b);
    return () => {
      b.dispose();
      setBridge(null);
    };
  }, [sessionId]);

  const [feed, setFeed] = useState<LiveSessionFeed | null>(null);
  useEffect(() => {
    if (!bridge || !sessionId) return;
    const f = new LiveSessionFeed(sessionId, {
      live: true,
      EventSource: bridge.EventSource,
      fetch: bridge.fetch,
      loadPage: loadPageVia(bridge.fetch),
    });
    f.open();
    setFeed(f);
    return () => {
      f.dispose();
      setFeed(null);
    };
  }, [bridge, sessionId]);

  if (typeof BroadcastChannel === 'undefined')
    return <Notice tone="danger" title="This browser has no BroadcastChannel." />;
  if (!bridge || !feed) return <div className="h-screen bg-bg" aria-busy="true" />;
  return (
    <WatchView
      key={feed.sessionId}
      bridge={bridge}
      feed={feed}
      theme={settings.theme}
      defaultTab={settings.layout.defaultTab}
    />
  );
}

function WatchView({
  bridge,
  feed,
  theme,
  defaultTab,
}: {
  bridge: BridgeClient;
  feed: LiveSessionFeed;
  theme: WallTheme;
  defaultTab: LiveTab;
}) {
  useLiveFeed(feed);
  useSyncExternalStore(bridge.subscribe, bridge.getVersion, bridge.getVersion);
  const [prefs, setPrefs] = useState<LiveWindowPrefs>({ tab: defaultTab });
  const onPrefs = (patch: LiveWindowPrefs) =>
    setPrefs((p) => ({ ...p, ...withoutMaximize(patch) }));
  const ended = bridge.ended.has(feed.sessionId);
  const hasData = feed.state.lastEventId > 0;

  const session = feed.session as (typeof feed.session & { title?: string | null }) | null;
  const title = session?.title || session?.agentName || feed.sessionId;
  useEffect(() => {
    document.title = title;
  }, [title]);

  // A finished session stays on screen; its stream is closed to free the
  // connection (the fleet caps them) once the snapshot is in.
  useEffect(() => {
    if (ended && hasData) feed.close();
  }, [ended, hasData, feed]);

  // Harness icon, as the wall shows it (one lookup once the agent is known).
  const agentName = session?.agentName ?? null;
  const [iconSrc, setIconSrc] = useState<string | null>(null);
  const up = bridge.status === 'up';
  useEffect(() => {
    if (!agentName || !up) return;
    let alive = true;
    bridge
      .fetch('/api/v1/agents')
      .then(
        (r) =>
          r.json() as Promise<{
            agents?: { agent_name: string; agent_platform?: string; agent_category?: string }[];
          }>,
      )
      .then((d) => {
        const a = d.agents?.find((x) => x.agent_name === agentName);
        if (alive && a?.agent_platform)
          setIconSrc(platformIcon(a.agent_platform, a.agent_category ?? null) ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [bridge, agentName, up]);

  const closeTab = () => {
    window.close();
    // A tab the user opened by hand cannot be closed by script: go back instead.
    setTimeout(() => {
      if (!window.closed && window.history.length > 1) window.history.back();
    }, 150);
  };

  let notice: ReactNode = null;
  if (ended) notice = <Notice tone="ok" title="Session ended" />;
  else if (bridge.status === 'lost')
    notice = (
      <Notice
        tone="warn"
        title="The simulation runs in the lab tab — keep it open"
        body="No answer from the Live agents lab tab. Reopen or reload it and this page reconnects by itself; a reloaded lab starts a new simulation, so this session will be gone."
        actions={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => bridge.retry()}>
              <RotateCw size={13} /> Retry
            </button>
            <a className="btn btn-ghost btn-sm" href={LAB_PATH} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Open the lab
            </a>
          </>
        }
      />
    );
  else if (feed.error === 'not_found')
    notice = (
      <Notice
        tone="danger"
        title="This session is not in the simulation any more"
        body="The lab tab was reloaded (a new simulation) or the session was forgotten. Open a session again from the lab."
      />
    );
  else if (bridge.status === 'connecting' && !hasData)
    notice = <Notice tone="muted" title="Connecting to the lab tab…" spin />;

  if (theme === 'hex')
    return (
      <div className="lab-hex flex h-screen flex-col gap-2 p-2 text-ink">
        {notice}
        <div className="min-h-0 flex-1">
          <HexLiveWindow
            feed={feed}
            prefs={prefs}
            onPrefs={onPrefs}
            onClose={closeTab}
            ended={ended}
            iconSrc={iconSrc}
          />
        </div>
      </div>
    );
  return (
    <div
      className={cx(
        'flex h-screen flex-col gap-2 bg-bg p-2 text-ink',
        HIDE_MAXIMIZE,
        // The official tile has a fixed height: here it fills the tab.
        '[&_[role=region]]:!h-full',
      )}
    >
      <style>{hideMaximizeCss(`.${HIDE_MAXIMIZE}`)}</style>
      {notice}
      <div className="min-h-0 flex-1">
        <LiveSessionWindow
          tile
          ended={ended}
          feed={feed}
          slot={0}
          z={0}
          prefs={prefs}
          onPrefs={onPrefs}
          onFocus={noop}
          onClose={closeTab}
        />
      </div>
    </div>
  );
}

const noop = () => undefined;

type Tone = 'ok' | 'warn' | 'danger' | 'muted';

const TONE: Record<Tone, string> = {
  ok: 'border-ok/30 bg-ok-tint',
  warn: 'border-warn/30 bg-warn-tint',
  danger: 'border-danger/30 bg-danger-tint',
  muted: 'border-line bg-s2',
};

function Notice({
  tone,
  title,
  body,
  actions,
  spin,
}: {
  tone: Tone;
  title: string;
  body?: string;
  actions?: ReactNode;
  spin?: boolean;
}) {
  const icon = useMemo(() => {
    if (spin) return <Loader2 size={15} className="shrink-0 animate-spin text-muted" />;
    if (tone === 'ok') return <CircleCheck size={15} className="shrink-0 text-ok" />;
    return (
      <Unplug size={15} className={cx('shrink-0', tone === 'warn' ? 'text-warn' : 'text-danger')} />
    );
  }, [spin, tone]);
  return (
    <div
      role="status"
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-[13px] text-ink',
        TONE[tone],
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {body ? <div className="text-[12px] text-muted">{body}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
