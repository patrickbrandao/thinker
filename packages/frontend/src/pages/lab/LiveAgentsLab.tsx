/* Development-only lab (not part of the product): the Live agents wall over a simulated fleet. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  FlaskConical,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Sun,
} from 'lucide-react';
import { cx } from '../../components/ui.js';
import type { LiveTab } from '../../components/live-session/live-windows-store.js';
import { effectiveTheme, themePreference, toggleTheme } from '../../lib/theme.js';
import { useSignal } from '../../lib/signal.js';
import { LiveSessionFeed } from '../../services/live-session-feed.js';
import {
  DEFAULT_FLEET,
  FAKE_MAX_LIVE_CONNECTIONS,
  Fleet,
  cleanFleetConfig,
  fleetLoadPage,
  type FleetConfig,
  type FleetStats,
} from './live-agents-sim.js';
import { BridgeHost } from './live-agents-bridge.js';
import LiveAgentsWall, {
  DEFAULT_LAYOUT,
  DEFAULT_TIMING,
  type WallLayout,
  type WallStats,
  type WallTheme,
  type WallTiming,
} from './LiveAgentsWall.js';
import {
  DEFAULT_AUTO_CLOSE,
  type AutoCloseTimeouts,
} from '../../components/live-session/hex-live.js';

export type CapMode = 'http1' | 'http2' | 'custom' | 'unlimited';

export interface LabSettings {
  fleet: FleetConfig;
  cap: { mode: CapMode; custom: number };
  layout: WallLayout;
  /** Window look. */
  theme: WallTheme;
  /** Seconds (the wall takes ms). */
  timing: { pollSec: number; settleSec: number; touchSec: number };
  /** Auto-close after the session's last item, seconds. */
  autoClose: { answerSec: number; toolSec: number };
}

export const LAB_SETTINGS_KEY = 'thinker.lab.liveAgents.settings';
export const LAB_NOTES_KEY = 'thinker.lab.liveAgents.notes';
const PANEL_KEY = 'thinker.lab.liveAgents.panel';
const WINDOW_POS_KEY = 'thinker.lab.liveAgents.window';

export const DEFAULT_SETTINGS: LabSettings = {
  fleet: DEFAULT_FLEET,
  cap: { mode: 'http1', custom: 8 },
  layout: DEFAULT_LAYOUT,
  theme: 'hex',
  timing: {
    pollSec: DEFAULT_TIMING.pollMs / 1000,
    settleSec: DEFAULT_TIMING.settleMs / 1000,
    touchSec: DEFAULT_TIMING.touchMs / 1000,
  },
  autoClose: {
    answerSec: DEFAULT_AUTO_CLOSE.answerMs / 1000,
    toolSec: DEFAULT_AUTO_CLOSE.toolMs / 1000,
  },
};

/** Connection cap of each mode (the official page picks 3 or 16 from the protocol). */
export function capTiles(cap: LabSettings['cap']): number {
  if (cap.mode === 'http1') return 3;
  if (cap.mode === 'http2') return 16;
  if (cap.mode === 'custom') return Math.max(1, Math.round(cap.custom) || 1);
  return Infinity;
}

const TABS: LiveTab[] = ['chat', 'details', 'inspector'];
const CAPS: CapMode[] = ['http1', 'http2', 'custom', 'unlimited'];
const THEMES: WallTheme[] = ['thinker', 'hex'];

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function loadSettings(): LabSettings {
  let raw: Partial<LabSettings> = {};
  try {
    raw = JSON.parse(localStorage.getItem(LAB_SETTINGS_KEY) ?? '{}') as Partial<LabSettings>;
  } catch {
    raw = {};
  }
  const d = DEFAULT_SETTINGS;
  const l = { ...d.layout, ...(raw.layout ?? {}) };
  const tm = { ...d.timing, ...(raw.timing ?? {}) };
  const cap = { ...d.cap, ...(raw.cap ?? {}) };
  const ac = { ...d.autoClose, ...(raw.autoClose ?? {}) };
  return {
    fleet: cleanFleetConfig(raw.fleet),
    cap: {
      mode: CAPS.includes(cap.mode) ? cap.mode : d.cap.mode,
      custom: num(cap.custom, d.cap.custom),
    },
    layout: {
      minTileWidth: num(l.minTileWidth, d.layout.minTileWidth),
      columns: num(l.columns, d.layout.columns),
      tileHeight: num(l.tileHeight, d.layout.tileHeight),
      defaultTab: TABS.includes(l.defaultTab) ? l.defaultTab : d.layout.defaultTab,
      showReplayBar:
        typeof l.showReplayBar === 'boolean' ? l.showReplayBar : d.layout.showReplayBar,
    },
    theme: THEMES.includes(raw.theme as WallTheme) ? (raw.theme as WallTheme) : d.theme,
    autoClose: {
      answerSec: num(ac.answerSec, d.autoClose.answerSec),
      toolSec: num(ac.toolSec, d.autoClose.toolSec),
    },
    timing: {
      pollSec: num(tm.pollSec, d.timing.pollSec),
      settleSec: num(tm.settleSec, d.timing.settleSec),
      touchSec: num(tm.touchSec, d.timing.touchSec),
    },
  };
}

const read = (key: string, fallback = '') => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked storage: the knobs just do not survive a reload */
  }
};

// ------------------------------------------------------------------ controls

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-2 border-b border-line pb-4">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
    {children}
  </section>
);

function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-dim">
      <span className="w-36 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className="field h-7 w-16 px-1.5 py-0 text-right font-mono text-[12px]"
        aria-label={label}
      />
      {suffix ? <span className="w-4 text-muted">{suffix}</span> : <span className="w-4" />}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-dim">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md border px-2 py-1 text-[12px]',
            value === o.value
              ? 'border-accent bg-accent-tint text-ink'
              : 'border-line text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Counter = ({ label, value }: { label: string; value: number | string }) => (
  <div className="rounded-md border border-line bg-s2 px-2 py-1.5">
    <div className="font-mono text-[15px] text-ink">{value}</div>
    <div className="text-[11px] text-muted">{label}</div>
  </div>
);

// ---------------------------------------------------------------------- page

export default function LiveAgentsLab() {
  useSignal(themePreference);
  const dark = effectiveTheme() === 'dark';
  const [settings, setSettings] = useState<LabSettings>(loadSettings);
  const [notes, setNotes] = useState(() => read(LAB_NOTES_KEY));
  const [panel, setPanel] = useState(() => read(PANEL_KEY, 'open') !== 'closed');
  const [copied, setCopied] = useState(false);
  const [agentFilter, setAgentFilter] = useState('');
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [wallKey, setWallKey] = useState(0);
  const [wallStats, setWallStats] = useState<WallStats>({
    running: 0,
    shown: 0,
    waiting: 0,
    ended: 0,
  });
  const fleetRef = useRef<Fleet | null>(null);
  fleetRef.current ??= new Fleet(settings.fleet, { autoStart: false });
  const fleet = fleetRef.current;
  const [fleetStats, setFleetStats] = useState<FleetStats>(() => fleet.stats());
  const [paused, setPaused] = useState(fleet.paused);

  useEffect(() => {
    document.title = 'Lab · Live agents';
  }, []);

  useEffect(() => {
    write(LAB_SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);
  useEffect(() => write(LAB_NOTES_KEY, notes), [notes]);
  useEffect(() => write(PANEL_KEY, panel ? 'open' : 'closed'), [panel]);

  // The fleet runs while the page is mounted, and answers watch tabs
  // (/lab/live-agents/watch/:id) over the BroadcastChannel bridge.
  useEffect(() => {
    fleet.start();
    const host = typeof BroadcastChannel === 'undefined' ? null : new BridgeHost(fleet);
    return () => {
      host?.dispose();
      fleet.dispose();
    };
  }, [fleet]);
  useEffect(() => fleet.configure(settings.fleet), [fleet, settings.fleet]);

  // Harness names for the filter in the controls window (the fleet's fake API).
  useEffect(() => {
    let alive = true;
    const load = () =>
      fleet
        .fetch('/api/v1/agents')
        .then((r) => r.json() as Promise<{ agents?: { agent_name: string }[] }>)
        .then((d) => {
          if (alive) setAgentNames((d.agents ?? []).map((a) => a.agent_name).sort());
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [fleet]);

  // Counters: every fleet change, and a tick for the running window.
  useEffect(() => {
    const update = () => {
      setFleetStats(fleet.stats());
      setPaused(fleet.paused);
    };
    const off = fleet.watch(update);
    const timer = setInterval(update, 1000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [fleet]);

  const createFeed = useCallback(
    (id: string) =>
      new LiveSessionFeed(id, {
        live: true,
        EventSource: fleet.EventSource,
        fetch: fleet.fetch,
        loadPage: fleetLoadPage(fleet),
      }),
    [fleet],
  );

  const setFleet = (patch: Partial<FleetConfig>) =>
    setSettings((s) => ({ ...s, fleet: cleanFleetConfig({ ...s.fleet, ...patch }) }));
  const setLayout = (patch: Partial<WallLayout>) =>
    setSettings((s) => ({ ...s, layout: { ...s.layout, ...patch } }));
  const setTiming = (patch: Partial<LabSettings['timing']>) =>
    setSettings((s) => ({ ...s, timing: { ...s.timing, ...patch } }));
  const setCap = (patch: Partial<LabSettings['cap']>) =>
    setSettings((s) => ({ ...s, cap: { ...s.cap, ...patch } }));

  const timing = useMemo<WallTiming>(
    () => ({
      pollMs: settings.timing.pollSec * 1000,
      settleMs: settings.timing.settleSec * 1000,
      touchMs: settings.timing.touchSec * 1000,
    }),
    [settings.timing],
  );
  const maxTiles = capTiles(settings.cap);
  const autoClose = useMemo<AutoCloseTimeouts>(
    () => ({
      answerMs: settings.autoClose.answerSec * 1000,
      toolMs: settings.autoClose.toolSec * 1000,
    }),
    [settings.autoClose],
  );
  const setAutoClose = (patch: Partial<LabSettings['autoClose']>) =>
    setSettings((s) => ({ ...s, autoClose: { ...s.autoClose, ...patch } }));

  const reset = () => {
    fleet.reset();
    if (fleet.paused) fleet.resume();
    setWallKey((k) => k + 1);
  };

  const copySettings = async () => {
    const text = JSON.stringify(
      { ...settings, resolved: { maxTiles: Number.isFinite(maxTiles) ? maxTiles : null }, notes },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (no focus or permission): the console still has it.
      console.info('[lab] live agents settings\n' + text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const f = settings.fleet;
  const l = settings.layout;
  const tm = settings.timing;

  const controls = (
    <div className="flex flex-col gap-4 p-4">
      <Section title="Simulation">
        <div className="flex flex-wrap gap-2">
          {paused ? (
            <button type="button" className="btn" onClick={() => fleet.resume()}>
              <Play size={14} /> Resume
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => fleet.pause()}>
              <Pause size={14} /> Pause
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={reset} title="New fleet">
            <RotateCcw size={14} /> Reset
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const a = fleet.agents.find((x) => !x.session) ?? fleet.agents[0];
              if (a) fleet.startSession(a);
            }}
            title="Start one more session now"
          >
            + Session
          </button>
        </div>
        <NumberRow
          label="Agents"
          value={f.agents}
          min={1}
          max={40}
          onChange={(v) => setFleet({ agents: v })}
        />
        <NumberRow
          label="Start interval"
          value={f.startIntervalSec}
          min={0}
          max={120}
          suffix="s"
          onChange={(v) => setFleet({ startIntervalSec: v })}
        />
        <NumberRow
          label="Turns per session"
          value={f.turns}
          min={0}
          max={20}
          onChange={(v) => setFleet({ turns: v })}
        />
        <div className="-mt-1 pl-36 text-[11px] text-faint">0 plays each scenario as written</div>
        <NumberRow
          label="Speed"
          value={f.speed}
          min={0.25}
          max={8}
          step={0.25}
          suffix="×"
          onChange={(v) => setFleet({ speed: v })}
        />
        <NumberRow
          label="Running window"
          value={f.runningWindowSec}
          min={0}
          max={300}
          suffix="s"
          onChange={(v) => setFleet({ runningWindowSec: v })}
        />
        <div className="-mt-1 pl-36 text-[11px] text-faint">
          How long a finished session stays running (the API uses 5 min)
        </div>
      </Section>

      <Section title="Failures">
        <NumberRow
          label="429 then fallback"
          value={f.fallbackPct}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => setFleet({ fallbackPct: v })}
        />
        <NumberRow
          label="Mid-stream cut"
          value={f.cutPct}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => setFleet({ cutPct: v })}
        />
        <div className="text-[11px] text-faint">
          Per request, applied to sessions started from now on.
        </div>
      </Section>

      <Section title="Connection cap">
        <Segmented
          label="Connection cap"
          value={settings.cap.mode}
          onChange={(mode) => setCap({ mode })}
          options={[
            { value: 'http1', label: 'HTTP/1.1 · 3' },
            { value: 'http2', label: 'HTTP/2 · 16' },
            { value: 'custom', label: 'Custom' },
            { value: 'unlimited', label: 'Unlimited' },
          ]}
        />
        {settings.cap.mode === 'custom' ? (
          <NumberRow
            label="Windows at once"
            value={settings.cap.custom}
            min={1}
            max={40}
            onChange={(v) => setCap({ custom: v })}
          />
        ) : null}
        <div className="text-[11px] text-faint">
          The fake backend refuses live feeds over {FAKE_MAX_LIVE_CONNECTIONS} (429), like the real
          one per organization.
        </div>
      </Section>

      <Section title="Live counters">
        <div className="grid grid-cols-3 gap-2">
          <Counter label="running" value={fleetStats.running} />
          <Counter label="windows live" value={wallStats.shown} />
          <Counter label="waiting" value={wallStats.waiting} />
          <Counter label="ended windows" value={wallStats.ended} />
          <Counter label="sessions ended" value={fleetStats.ended} />
          <Counter label="SSE open" value={fleetStats.liveConnections} />
        </div>
        <div className="text-[11px] text-faint">
          {fleetStats.agents} agents · {fleetStats.active} sessions playing · cap{' '}
          {Number.isFinite(maxTiles) ? maxTiles : '∞'}
          {paused ? ' · paused' : ''}
        </div>
      </Section>

      <Section title="Layout">
        <div className="flex items-center gap-2 text-[12px] text-dim">
          <span className="w-36 shrink-0">Theme</span>
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(theme) => setSettings((s) => ({ ...s, theme }))}
            options={[
              { value: 'thinker', label: 'Thinker' },
              { value: 'hex', label: 'anoma-ly-hex' },
            ]}
          />
        </div>
        <NumberRow
          label="Window width"
          value={l.minTileWidth}
          min={240}
          max={900}
          step={10}
          suffix="px"
          onChange={(v) => setLayout({ minTileWidth: v })}
        />
        <div className="-mt-1 pl-36 text-[11px] text-faint">
          Windows cascade (+28 px) below a free band as tall as one window
        </div>
        <NumberRow
          label="Window height"
          value={l.tileHeight}
          min={200}
          max={1000}
          step={10}
          suffix="px"
          onChange={(v) => setLayout({ tileHeight: v })}
        />
        <div className="flex items-center gap-2 text-[12px] text-dim">
          <span className="w-36 shrink-0">Default tab</span>
          <Segmented
            label="Default tab"
            value={l.defaultTab}
            onChange={(defaultTab) => setLayout({ defaultTab })}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'details', label: 'Details' },
              { value: 'inspector', label: 'Inspector' },
            ]}
          />
        </div>
        <Toggle
          label="Show replay bar (Thinker theme)"
          checked={l.showReplayBar}
          onChange={(v) => setLayout({ showReplayBar: v })}
        />
      </Section>

      <Section title="Auto-close">
        <NumberRow
          label="Close after assistant"
          value={settings.autoClose.answerSec}
          min={1}
          max={300}
          suffix="s"
          onChange={(v) => setAutoClose({ answerSec: v })}
        />
        <NumberRow
          label="Close after tool call"
          value={settings.autoClose.toolSec}
          min={1}
          max={600}
          suffix="s"
          onChange={(v) => setAutoClose({ toolSec: v })}
        />
        <div className="text-[11px] text-faint">
          The session&apos;s last item decides: an assistant answer or a tool call. New activity
          resets it, hovering pauses it, pinned windows stay. Also applies after the session ends.
        </div>
      </Section>

      <Section title="Wall timing">
        <NumberRow
          label="Poll every"
          value={tm.pollSec}
          min={1}
          max={30}
          suffix="s"
          onChange={(v) => setTiming({ pollSec: v })}
        />
        <NumberRow
          label="Settle"
          value={tm.settleSec}
          min={0}
          max={60}
          suffix="s"
          onChange={(v) => setTiming({ settleSec: v })}
        />
        <NumberRow
          label="Interaction guard"
          value={tm.touchSec}
          min={0}
          max={120}
          suffix="s"
          onChange={(v) => setTiming({ touchSec: v })}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
        >
          Restore defaults
        </button>
      </Section>

      <section className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Decisions
        </div>
        <textarea
          className="field min-h-[120px] w-full font-mono text-[12px]"
          placeholder="What was decided here, to port to src/pages/LiveAgents.tsx…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Decisions"
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copySettings()}>
          {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}{' '}
          {copied ? 'Copied' : 'Copy current settings as JSON'}
        </button>
      </section>
    </div>
  );

  const toolbar = (
    <>
      <select
        className="field h-7 w-auto max-w-[160px] py-0 text-[12px]"
        aria-label="Harness filter"
        value={agentFilter}
        onChange={(e) => setAgentFilter(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <option value="">All harnesses</option>
        {agentNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="rounded-md p-1.5 text-muted hover:bg-s3 hover:text-ink"
        title={dark ? 'Light theme' : 'Dark theme'}
        aria-label={dark ? 'Light theme' : 'Dark theme'}
        onClick={toggleTheme}
      >
        {dark ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </>
  );

  return (
    <div className="h-screen overflow-auto bg-bg">
      <LiveAgentsWall
        key={wallKey}
        fetch={fleet.fetch}
        createFeed={createFeed}
        maxTiles={maxTiles}
        layout={l}
        timing={timing}
        onStats={setWallStats}
        hideHeader
        agentFilter={agentFilter}
        theme={settings.theme}
        autoClose={autoClose}
      />
      <ControlsWindow
        open={panel}
        onToggle={() => setPanel((p) => !p)}
        summary={`${wallStats.running} running · ${wallStats.shown} live · ${wallStats.waiting} waiting`}
        toolbar={toolbar}
      >
        {controls}
      </ControlsWindow>
    </div>
  );
}

/**
 * The lab's floating controls window: draggable by its title bar, collapsible
 * to the bar alone, position remembered in localStorage. It floats over the
 * wall so the wall keeps the whole page.
 */
function ControlsWindow({
  open,
  onToggle,
  summary,
  toolbar,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  summary: string;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const v = JSON.parse(read(WINDOW_POS_KEY, 'null')) as { x: number; y: number } | null;
      return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (pos) write(WINDOW_POS_KEY, JSON.stringify(pos));
  }, [pos]);

  // Keep the bar on screen after a resize.
  const clamp = useCallback((p: { x: number; y: number }) => {
    const w = ref.current?.offsetWidth ?? 380;
    return {
      x: Math.min(Math.max(p.x, 0), Math.max(0, window.innerWidth - w)),
      y: Math.min(Math.max(p.y, 0), Math.max(0, window.innerHeight - 44)),
    };
  }, []);
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Lab controls"
      className="fixed z-[80] flex w-[min(380px,calc(100vw-16px))] flex-col overflow-hidden rounded-lg border border-line bg-elev shadow-[var(--shadow-float)]"
      style={
        pos
          ? { left: pos.x, top: pos.y, maxHeight: `calc(100vh - ${pos.y + 8}px)` }
          : { right: 16, bottom: 16, maxHeight: 'calc(100vh - 32px)' }
      }
    >
      <div
        className="flex cursor-grab select-none items-center gap-2 border-b border-line bg-s2 px-2.5 py-1.5 active:cursor-grabbing"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, select')) return;
          const r = ref.current!.getBoundingClientRect();
          drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <FlaskConical size={15} className="shrink-0 text-[var(--port-2)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-ink">Simulation</div>
          <div className="truncate text-[11px] text-muted">{summary}</div>
        </div>
        {toolbar}
        <button
          type="button"
          className="rounded-md p-1.5 text-muted hover:bg-s3 hover:text-ink"
          title={open ? 'Collapse' : 'Expand'}
          aria-label={open ? 'Collapse controls' : 'Expand controls'}
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>
      {open ? <div className="min-h-0 flex-1 overflow-y-auto">{children}</div> : null}
    </div>
  );
}
