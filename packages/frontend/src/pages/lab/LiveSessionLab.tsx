/* Development-only lab (not part of the product): live session windows over a simulated gateway feed. */
import { useEffect, useRef, useState } from 'react';
import {
  FlaskConical,
  Moon,
  Pause,
  Play,
  Plug,
  Radio,
  RotateCcw,
  StepForward,
  Sun,
  Unplug,
} from 'lucide-react';
import { cx } from '../../components/ui.js';
import { effectiveTheme, themePreference, toggleTheme } from '../../lib/theme.js';
import { useSignal } from '../../lib/signal.js';
import { SCENARIOS, SimServer, toSseFrame, type WireEvent } from './live-session-sim.js';
import { FeedClient, useFeed, useServer } from './live-session-feed.js';
import LiveSessionWindow from './LiveSessionWindow.js';

interface Sim {
  server: SimServer;
  client: FeedClient;
  /** Bumped on reset, so the window starts over. */
  gen: number;
}

let generation = 0;
const makeSim = (id: string, speed: number): Sim => {
  const server = new SimServer(SCENARIOS.find((s) => s.id === id)!);
  server.speed = speed;
  return { server, client: new FeedClient(server), gen: ++generation };
};

const TYPE_COLOR: Record<string, string> = {
  snapshot: 'text-[var(--port-2)]',
  'message.appended': 'text-accent',
  'request.started': 'text-ok',
  'request.completed': 'text-ok',
  'request.failed': 'text-danger',
  'request.cancelled': 'text-muted',
  'block.started': 'text-warn',
  'block.stopped': 'text-warn',
  'block.delta': 'text-faint',
  heartbeat: 'text-faint',
};

/** The frame as sent, with the bulky payloads folded (they are in the Inspector). */
function frameText(ev: WireEvent): string {
  const data = { ...ev.data };
  if ('body' in data) data.body = '{…provider request body}';
  if ('headers' in data) data.headers = '{…}';
  if ('state' in data) data.state = '{…full session state}';
  return toSseFrame({ ...ev, data });
}

function SessionRow({
  sim,
  selected,
  open,
  onSelect,
  onWatch,
}: {
  sim: Sim;
  selected: boolean;
  open: boolean;
  onSelect: () => void;
  onWatch: () => void;
}) {
  const server = useServer(sim.server);
  const s = server.scenario.session;
  const p = server.progress;
  return (
    <tr
      className={cx('cursor-pointer border-t border-line', selected && 'bg-accent-tint/50')}
      onClick={onSelect}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-2 font-medium text-ink">
          {server.playing && <span className="size-2 animate-pulse rounded-full bg-danger" />}
          {s.title}
        </div>
        <div className="font-mono text-[11px] text-muted">{s.sessionId}</div>
      </td>
      <td className="px-3 py-2">{s.harness}</td>
      <td className="px-3 py-2 font-mono text-[12px]">{s.requestedModel}</td>
      <td className="px-3 py-2">
        <div className="h-1.5 w-20 overflow-hidden rounded bg-s3">
          <div className="h-full bg-accent" style={{ width: `${(p.done / p.total) * 100}%` }} />
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <button
          type="button"
          className="btn btn-ghost mr-1 h-7 px-2"
          title={server.playing ? 'Pause' : 'Start'}
          disabled={server.finished}
          onClick={(e) => {
            e.stopPropagation();
            if (server.playing) server.pause();
            else server.play();
          }}
        >
          {server.playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button
          type="button"
          className={cx('btn h-7 text-[12px]', !open && 'btn-ghost')}
          onClick={(e) => {
            e.stopPropagation();
            onWatch();
          }}
        >
          <Radio size={13} /> {open ? 'Watching' : 'Watch live'}
        </button>
      </td>
    </tr>
  );
}

export default function LiveSessionLab() {
  useSignal(themePreference);
  const dark = effectiveTheme() === 'dark';
  const [speed, setSpeed] = useState(1);
  const [sims, setSims] = useState<Record<string, Sim>>(() =>
    Object.fromEntries(SCENARIOS.map((s) => [s.id, makeSim(s.id, 1)])),
  );
  const [selected, setSelected] = useState(SCENARIOS[0]!.id);
  /** Open windows, bottom to top (the last one is in front). */
  const [stack, setStack] = useState<string[]>([]);
  const [cascade, setCascade] = useState<Record<string, number>>({});
  const [autoCollapse, setAutoCollapse] = useState(true);
  const [hideDeltas, setHideDeltas] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const sim = sims[selected]!;
  const server = useServer(sim.server);
  const client = useFeed(sim.client);
  const p = server.progress;

  useEffect(() => {
    for (const s of Object.values(sims)) s.server.speed = speed;
  }, [sims, speed]);

  const openWindow = (id: string) => {
    setSelected(id);
    sims[id]!.client.open();
    setStack((st) => [...st.filter((x) => x !== id), id]);
    setCascade((c) => (id in c ? c : { ...c, [id]: Object.keys(c).length % 6 }));
  };
  const closeWindow = (id: string) => {
    sims[id]!.client.close();
    setStack((st) => st.filter((x) => x !== id));
  };
  const focus = (id: string) => {
    setSelected(id);
    setStack((st) => (st.at(-1) === id ? st : [...st.filter((x) => x !== id), id]));
  };
  const reset = (id: string) => {
    const old = sims[id]!;
    old.client.dispose();
    old.server.dispose();
    const fresh = makeSim(id, speed);
    if (stack.includes(id)) fresh.client.open();
    setSims((s) => ({ ...s, [id]: fresh }));
  };

  const frames = hideDeltas
    ? client.frames.filter((f) => f.ev.type !== 'block.delta' && f.ev.type !== 'heartbeat')
    : client.frames;
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [frames.length]);
  const isOpen = stack.includes(selected);

  return (
    <div className="flex h-full min-h-screen flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-line bg-elev px-5 py-3">
        <FlaskConical size={18} className="text-[var(--port-2)]" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[16px]">Lab · Live session window</h1>
          <div className="truncate text-[12px] text-muted">
            Simulated gateway feed (SSE) rebuilding harness ↔ provider sessions as chats, in real
            time.
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
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Controls for the selected session */}
        <aside className="flex w-[380px] shrink-0 flex-col gap-4 overflow-hidden border-r border-line bg-elev p-4">
          <section className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Selected session
            </div>
            <select
              className="field"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              {server.playing ? (
                <button type="button" className="btn" onClick={() => server.pause()}>
                  <Pause size={14} /> Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={server.finished}
                  onClick={() => server.play()}
                >
                  <Play size={14} /> {p.done ? 'Resume' : 'Start'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                disabled={server.playing || server.finished}
                onClick={() => server.step()}
                title="Emit next event"
              >
                <StepForward size={14} />
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => reset(selected)}
                title="Reset"
              >
                <RotateCcw size={14} />
              </button>
              <button
                type="button"
                className="btn btn-ghost ml-auto"
                title="Start every session and open all windows"
                onClick={() => {
                  for (const s of SCENARIOS) {
                    openWindow(s.id);
                    sims[s.id]!.server.play();
                  }
                }}
              >
                Start all
              </button>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-s3">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${(p.done / p.total) * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <span className="w-16">Speed {speed}×</span>
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.25}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="flex-1"
              />
              <span className="font-mono">
                {p.done}/{p.total}
              </span>
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Window and connection
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => (isOpen ? closeWindow(selected) : openWindow(selected))}
              >
                <Radio size={14} /> {isOpen ? 'Close window' : 'Watch live'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!isOpen || client.conn !== 'open'}
                onClick={() => client.drop(3000)}
              >
                {client.conn === 'reconnecting' ? <Plug size={14} /> : <Unplug size={14} />} Drop
                connection (3s)
              </button>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-dim">
              <input
                type="checkbox"
                checked={autoCollapse}
                onChange={(e) => setAutoCollapse(e.target.checked)}
              />
              Collapse thinking when it ends (Details)
            </label>
            <p className="text-[12px] leading-snug text-muted">
              Close a window mid-stream and open it again: one <code>snapshot</code> rebuilds it,
              in-flight blocks included. A drop resumes with <code>Last-Event-ID</code> and replays
              only the missed events. The bar at the bottom of each window replays the session from
              history.
            </p>
            <div className="font-mono text-[11px] text-faint">
              conn: {client.conn} · Last-Event-ID: {client.lastId ?? '—'} · server buffer:{' '}
              {p.emitted} events
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Wire (text/event-stream)
              </div>
              <label className="flex items-center gap-1 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={hideDeltas}
                  onChange={(e) => setHideDeltas(e.target.checked)}
                />
                hide deltas
              </label>
            </div>
            <div
              ref={logRef}
              className="min-h-0 flex-1 overflow-y-auto rounded-md border border-line bg-sunken p-2 font-mono text-[11px] leading-snug"
            >
              {frames.length === 0 && (
                <div className="text-faint">
                  No frames. Open the selected session's window and start it.
                </div>
              )}
              {frames.map((f, i) => (
                <div
                  key={i}
                  className={cx(
                    'mb-1.5 whitespace-pre-wrap break-all',
                    f.how !== 'live' && 'border-l-2 border-[var(--port-2)] pl-1.5',
                  )}
                >
                  {f.how !== 'live' && <span className="text-[var(--port-2)]">[{f.how}] </span>}
                  <span className={TYPE_COLOR[f.ev.type]}>{frameText(f.ev)}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>

        {/* Backdrop: the Sessions page the windows float over. */}
        <main className="min-w-0 flex-1 overflow-auto p-6">
          <h2 className="mb-3">Sessions</h2>
          <div className="overflow-hidden rounded-lg border border-line bg-elev">
            <table className="w-full text-[13px]">
              <thead className="bg-s2 text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Harness</th>
                  <th className="px-3 py-2">Model</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((s) => (
                  <SessionRow
                    key={s.id}
                    sim={sims[s.id]!}
                    selected={s.id === selected}
                    open={stack.includes(s.id)}
                    onSelect={() => setSelected(s.id)}
                    onWatch={() => (stack.includes(s.id) ? focus(s.id) : openWindow(s.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>

      {/* Stable DOM order (moving nodes would reset their scroll); stacking comes from z. */}
      {SCENARIOS.filter((s) => stack.includes(s.id)).map(({ id }) => (
        <LiveSessionWindow
          key={`${id}:${sims[id]!.gen}`}
          client={sims[id]!.client}
          index={cascade[id] ?? 0}
          z={stack.indexOf(id)}
          onFocus={() => focus(id)}
          onClose={() => closeWindow(id)}
          autoCollapse={autoCollapse}
        />
      ))}
    </div>
  );
}
