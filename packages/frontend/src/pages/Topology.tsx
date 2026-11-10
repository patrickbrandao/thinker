import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import FlowCanvas from '../components/flow/FlowCanvas.jsx';
import { Button, Modal } from '../components/ui.jsx';
import {
  getTopology,
  resetTopologyPositions,
  saveTopologyPositions,
  type TopologyRange,
} from '../services/api/console.js';
import { analyticsPing } from '../services/sse.js';
import { useResource } from '../lib/use-resource.js';
import { useSignal } from '../lib/signal.js';
import { t } from '../i18n/index.js';
import {
  buildTopologyGraph,
  filterTopology,
  topologyLegend,
  topologyProviderTypes,
} from './topology-adapter.js';
import '../styles/canvas.css';

const RANGE_KEY = 'thinker.topologyRange';
const MODE_KEY = 'thinker.topologyMode';
const HARNESS_KEY = 'thinker.topologyHarness';
const PROVIDER_KEY = 'thinker.topologyProvider';
/**
 * Recent: every node over the window. Traffic: only what carried it. Live:
 * requests in flight. Interval: requests that started or ended between two instants.
 */
const MODES = ['recent', 'traffic', 'live', 'interval'] as const;
type Mode = (typeof MODES)[number];
/** How often `live` asks for the requests in flight. */
const LIVE_POLL_MS = 1_000;
/** Slider bounds per unit of the recent window. */
const UNITS = { m: 120, h: 24, d: 60 } as const;
type Unit = keyof typeof UNITS;

function parseRange(value: string | null): { count: number; unit: Unit } | null {
  const match = value ? /^(\d+)([mhd])$/.exec(value) : null;
  if (!match) return null;
  const unit = match[2] as Unit;
  const count = Number(match[1]);
  return count >= 1 && count <= UNITS[unit] ? { count, unit } : null;
}

/** `datetime-local` value (to the second) of a local date. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function savedMode(): Mode {
  try {
    const value = localStorage.getItem(MODE_KEY) as Mode | null;
    return value && MODES.includes(value) ? value : 'recent';
  } catch {
    return 'recent';
  }
}

function saved(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function remember(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* per-viewer convenience only */
  }
}

function savedRange(): { count: number; unit: Unit } {
  try {
    return parseRange(localStorage.getItem(RANGE_KEY)) ?? { count: 24, unit: 'h' };
  } catch {
    return { count: 24, unit: 'h' };
  }
}

/**
 * Topology and usage as a flow, n8n style: client addresses → harnesses →
 * provider connections → proxy profiles → internet, with the traffic of the
 * chosen period on every link. Nodes are draggable and their positions are
 * saved per workspace. Refreshes when new requests arrive (SSE ping).
 */
export default function Topology() {
  const navigate = useNavigate();
  const [span, setSpan] = useState(savedRange);
  // The slider moves freely; the fetch follows once it rests.
  const [range, setRange] = useState<TopologyRange>(
    () => `${span.count}${span.unit}` as TopologyRange,
  );
  useEffect(() => {
    const next = `${span.count}${span.unit}` as TopologyRange;
    const timer = setTimeout(() => {
      setRange(next);
      try {
        localStorage.setItem(RANGE_KEY, next);
      } catch {
        /* per-viewer convenience only */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [span]);
  const [mode, setMode] = useState<Mode>(savedMode);
  // Narrow the canvas to one harness and/or one provider type ('' = all).
  const [harnessFilter, setHarnessFilter] = useState(() => saved(HARNESS_KEY));
  const [providerFilter, setProviderFilter] = useState(() => saved(PROVIDER_KEY));
  const live = mode === 'live';
  // Interval bounds as `datetime-local` values; the fetch waits for a valid pair.
  const [bounds, setBounds] = useState({ from: '', to: '' });
  const interval = useMemo(() => {
    if (mode !== 'interval') return undefined;
    const from = new Date(bounds.from);
    const to = new Date(bounds.to);
    return from < to ? { from: from.toISOString(), to: to.toISOString() } : undefined;
  }, [mode, bounds]);
  /** First click on an empty bound: from the day's first second to now. */
  const fillBounds = () => {
    if (bounds.from || bounds.to) return;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    setBounds({ from: localInput(start), to: localInput(now) });
  };
  // Moves of this visit, so a refresh landing before the save never snaps a node back.
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const ping = useSignal(analyticsPing);
  const topology = useResource(
    () => (interval ? getTopology('interval', interval) : getTopology(live ? 'live' : range)),
    [range, live, interval?.from, interval?.to],
  );

  useEffect(() => {
    if (ping > 0) void topology.reload();
    // Reload on new traffic only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ping]);

  // Link widths follow the last minute: refresh so they settle once traffic
  // stops. Live follows the requests in flight, so it asks every second.
  useEffect(() => {
    const timer = window.setInterval(() => void topology.reload(), live ? LIVE_POLL_MS : 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, live]);

  const graph = useMemo(
    () =>
      topology.data
        ? buildTopologyGraph(
            {
              ...filterTopology(topology.data, {
                harness: harnessFilter,
                provider: providerFilter,
              }),
              positions: { ...topology.data.positions, ...moved },
            },
            { activeOnly: mode === 'traffic', live },
          )
        : { nodes: [], edges: [] },
    [topology.data, mode, live, moved, harnessFilter, providerFilter],
  );
  const legend = useMemo(() => topologyLegend(), []);
  const harnessOptions = useMemo(
    () =>
      (topology.data?.harnesses ?? [])
        .map((h) => ({ value: h.id, label: h.displayName || h.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [topology.data],
  );
  const providerOptions = useMemo(
    () => (topology.data ? topologyProviderTypes(topology.data) : []),
    [topology.data],
  );

  const hint =
    topology.loading && !topology.data
      ? null
      : topology.data && topology.data.harnesses.length === 0
        ? t('shell.flow.empty')
        : graph.nodes.length === 0
          ? t('shell.flow.emptyActive')
          : null;

  const reset = async () => {
    setResetting(true);
    try {
      await resetTopologyPositions();
      setMoved({});
      await topology.reload();
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  return (
    <div className="stage">
      <title>{`${t('nav.topology')} | Thinker`}</title>
      <div className="stage-head">
        <div className="stage-actions items-center">
          <label htmlFor="topology-mode" className="text-xs text-muted">
            {t('shell.flow.filter')}
          </label>
          <select
            id="topology-mode"
            className="field stage-mode"
            aria-label={t('shell.flow.mode')}
            value={mode}
            onChange={(e) => {
              const next = e.currentTarget.value as Mode;
              setMode(next);
              try {
                localStorage.setItem(MODE_KEY, next);
              } catch {
                /* per-viewer convenience only */
              }
            }}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(`shell.flow.modes.${m}`)}
              </option>
            ))}
          </select>
          <select
            className="field stage-mode"
            aria-label={t('shell.flow.harness')}
            value={harnessFilter}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setHarnessFilter(next);
              remember(HARNESS_KEY, next);
            }}
          >
            <option value="">{t('shell.flow.allHarnesses')}</option>
            {harnessFilter && !harnessOptions.some((o) => o.value === harnessFilter) ? (
              <option value={harnessFilter}>{harnessFilter}</option>
            ) : null}
            {harnessOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="field stage-mode"
            aria-label={t('shell.flow.providerType')}
            value={providerFilter}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setProviderFilter(next);
              remember(PROVIDER_KEY, next);
            }}
          >
            <option value="">{t('shell.flow.allProviders')}</option>
            {providerFilter && !providerOptions.some((o) => o.value === providerFilter) ? (
              <option value={providerFilter}>{providerFilter}</option>
            ) : null}
            {providerOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {mode === 'interval' ? (
            <div className="stage-range">
              <input
                type="datetime-local"
                step={1}
                className="field"
                aria-label={t('shell.flow.from')}
                value={bounds.from}
                max={bounds.to || undefined}
                onFocus={fillBounds}
                onPointerDown={fillBounds}
                onChange={(e) => {
                  const from = e.currentTarget.value;
                  setBounds((b) => ({ ...b, from }));
                }}
              />
              <span className="text-xs text-muted">{t('shell.flow.until')}</span>
              <input
                type="datetime-local"
                step={1}
                className="field"
                aria-label={t('shell.flow.to')}
                value={bounds.to}
                min={bounds.from || undefined}
                onFocus={fillBounds}
                onPointerDown={fillBounds}
                onChange={(e) => {
                  const to = e.currentTarget.value;
                  setBounds((b) => ({ ...b, to }));
                }}
              />
            </div>
          ) : null}
          <div className="stage-range" hidden={live || mode === 'interval'}>
            <select
              className="field"
              aria-label={t('shell.flow.unit')}
              value={span.unit}
              onChange={(e) => {
                const unit = e.currentTarget.value as Unit;
                setSpan((w) => ({ unit, count: Math.min(w.count, UNITS[unit]) }));
              }}
            >
              {(Object.keys(UNITS) as Unit[]).map((unit) => (
                <option key={unit} value={unit}>
                  {t(`shell.flow.units.${unit}`)}
                </option>
              ))}
            </select>
            <input
              type="range"
              className="accent-accent"
              min={1}
              max={UNITS[span.unit]}
              value={span.count}
              aria-label={t('shell.flow.range')}
              onChange={(e) => {
                const count = Number(e.currentTarget.value);
                setSpan((w) => ({ ...w, count }));
              }}
            />
            <output>{t(`shell.flow.windowLabel.${span.unit}`, span.count)}</output>
          </div>
        </div>
      </div>
      <FlowCanvas
        graph={graph}
        legend={legend}
        hint={hint}
        editable
        onResetLayout={() => setConfirmReset(true)}
        onNodeOpen={(node) => {
          if (node.data.href) navigate(node.data.href);
        }}
        onNodesMoved={(nodes) => {
          const positions = nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
          setMoved((prev) => ({
            ...prev,
            ...Object.fromEntries(positions.map((p) => [p.id, { x: p.x, y: p.y }])),
          }));
          void saveTopologyPositions(positions).catch(() => undefined);
        }}
      />
      <Modal
        open={confirmReset}
        title={t('shell.flow.resetModal.title')}
        onClose={() => setConfirmReset(false)}
      >
        <p className="text-sm text-dim">{t('shell.flow.resetModal.body')}</p>
        <div className="actions">
          <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" busy={resetting} onClick={() => void reset()}>
            {t('shell.flow.resetModal.submit')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
