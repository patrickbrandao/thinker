/* Development-only lab (not part of the product): the Live agents wall over a simulated fleet. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  ClipboardCopy,
  FlaskConical,
  Moon,
  PanelRightClose,
  PanelRightOpen,
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
import LiveAgentsWall, {
  DEFAULT_LAYOUT,
  DEFAULT_TIMING,
  type WallLayout,
  type WallStats,
  type WallTiming,
} from './LiveAgentsWall.js';

export type CapMode = 'http1' | 'http2' | 'custom' | 'unlimited';

export interface LabSettings {
  fleet: FleetConfig;
  cap: { mode: CapMode; custom: number };
  layout: WallLayout;
  /** Seconds (the wall takes ms). */
  timing: { pollSec: number; graceSec: number; settleSec: number; touchSec: number };
}

export const LAB_SETTINGS_KEY = 'thinker.lab.liveAgents.settings';
export const LAB_NOTES_KEY = 'thinker.lab.liveAgents.notes';
const PANEL_KEY = 'thinker.lab.liveAgents.panel';

export const DEFAULT_SETTINGS: LabSettings = {
  fleet: DEFAULT_FLEET,
  cap: { mode: 'http1', custom: 8 },
  layout: DEFAULT_LAYOUT,
  timing: {
    pollSec: DEFAULT_TIMING.pollMs / 1000,
    graceSec: DEFAULT_TIMING.graceMs / 1000,
    settleSec: DEFAULT_TIMING.settleMs / 1000,
    touchSec: DEFAULT_TIMING.touchMs / 1000,
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
      compact: typeof l.compact === 'boolean' ? l.compact : d.layout.compact,
      showReplayBar:
        typeof l.showReplayBar === 'boolean' ? l.showReplayBar : d.layout.showReplayBar,
    },
    timing: {
      pollSec: num(tm.pollSec, d.timing.pollSec),
      graceSec: num(tm.graceSec, d.timing.graceSec),
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

  // The fleet runs while the page is mounted.
  useEffect(() => {
    fleet.start();
    return () => fleet.dispose();
  }, [fleet]);
  useEffect(() => fleet.configure(settings.fleet), [fleet, settings.fleet]);

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
      graceMs: settings.timing.graceSec * 1000,
      settleMs: settings.timing.settleSec * 1000,
      touchMs: settings.timing.touchSec * 1000,
    }),
    [settings.timing],
  );
  const maxTiles = capTiles(settings.cap);

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
            label="Tiles at once"
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
          <Counter label="tiles live" value={wallStats.shown} />
          <Counter label="waiting" value={wallStats.waiting} />
          <Counter label="ended tiles" value={wallStats.ended} />
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
        <NumberRow
          label="Tile min width"
          value={l.minTileWidth}
          min={240}
          max={900}
          step={10}
          suffix="px"
          onChange={(v) => setLayout({ minTileWidth: v })}
        />
        <NumberRow
          label="Columns"
          value={l.columns}
          min={0}
          max={8}
          onChange={(v) => setLayout({ columns: v })}
        />
        <div className="-mt-1 pl-36 text-[11px] text-faint">0 fills rows by min width</div>
        <NumberRow
          label="Tile height"
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
          label="Compact tiles"
          checked={l.compact}
          onChange={(v) => setLayout({ compact: v })}
        />
        <Toggle
          label="Show replay bar"
          checked={l.showReplayBar}
          onChange={(v) => setLayout({ showReplayBar: v })}
        />
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
          label="Grace period"
          value={tm.graceSec}
          min={0}
          max={300}
          suffix="s"
          onChange={(v) => setTiming({ graceSec: v })}
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
          Restore defaults (official values)
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

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-line bg-elev px-4 py-3">
        <FlaskConical size={18} className="shrink-0 text-[var(--port-2)]" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px]">Lab · Live agents</h1>
          <div className="truncate text-[12px] text-muted">
            The wall over a simulated fleet of harnesses: customize here, then port to the official
            page.
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-2 text-muted hover:bg-s2 hover:text-ink"
          title={dark ? 'Light theme' : 'Dark theme'}
          aria-label={dark ? 'Light theme' : 'Dark theme'}
          onClick={toggleTheme}
        >
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button
          type="button"
          className="rounded-md p-2 text-muted hover:bg-s2 hover:text-ink"
          title={panel ? 'Hide controls' : 'Show controls'}
          aria-label={panel ? 'Hide controls' : 'Show controls'}
          aria-expanded={panel}
          onClick={() => setPanel((p) => !p)}
        >
          {panel ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto">
          <LiveAgentsWall
            key={wallKey}
            fetch={fleet.fetch}
            createFeed={createFeed}
            maxTiles={maxTiles}
            layout={l}
            timing={timing}
            onStats={setWallStats}
          />
        </main>
        {panel ? (
          <aside
            className={cx(
              'overflow-y-auto border-l border-line bg-elev',
              // A drawer over the wall on narrow screens, a side panel otherwise.
              'absolute inset-y-0 right-0 z-30 w-[min(400px,100%)] lg:static lg:w-[400px] lg:shrink-0',
            )}
            aria-label="Lab controls"
          >
            {controls}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
