import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import FlowCanvas from '../components/flow/FlowCanvas.jsx';
import { Button, Switch, Tabs } from '../components/ui.jsx';
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
import { buildTopologyGraph, topologyLegend } from './topology-adapter.js';
import '../styles/canvas.css';

const RANGES: TopologyRange[] = ['1h', '24h', '7d', '30d'];
const RANGE_KEY = 'thinker.topologyRange';

function savedRange(): TopologyRange {
  try {
    const value = localStorage.getItem(RANGE_KEY) as TopologyRange | null;
    return value && RANGES.includes(value) ? value : '24h';
  } catch {
    return '24h';
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
  const [range, setRange] = useState<TopologyRange>(savedRange);
  const [activeOnly, setActiveOnly] = useState(false);
  // Moves of this visit, so a refresh landing before the save never snaps a node back.
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [resetting, setResetting] = useState(false);
  const ping = useSignal(analyticsPing);
  const topology = useResource(() => getTopology(range), [range]);

  useEffect(() => {
    if (ping > 0) void topology.reload();
    // Reload on new traffic only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ping]);

  // Link widths follow the last minute: refresh so they settle once traffic stops.
  useEffect(() => {
    const timer = window.setInterval(() => void topology.reload(), 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const graph = useMemo(
    () =>
      topology.data
        ? buildTopologyGraph(
            { ...topology.data, positions: { ...topology.data.positions, ...moved } },
            { activeOnly },
          )
        : { nodes: [], edges: [] },
    [topology.data, activeOnly, moved],
  );
  const legend = useMemo(() => topologyLegend(), []);

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
    }
  };

  return (
    <div className="stage">
      <title>{`${t('nav.topology')} | Thinker`}</title>
      <div className="stage-head">
        <span className="sub hidden md:inline">{t('shell.flow.hint')}</span>
        <div className="stage-actions items-center">
          <label className="flex items-center gap-2 text-xs text-muted">
            <Switch
              checked={activeOnly}
              onChange={setActiveOnly}
              label={t('shell.flow.activeOnly')}
            />
            {t('shell.flow.activeOnly')}
          </label>
          <Button variant="ghost" size="sm" busy={resetting} onClick={() => void reset()}>
            {t('shell.flow.resetLayout')}
          </Button>
          <Tabs
            label={t('shell.flow.range')}
            value={range}
            onChange={(next) => {
              setRange(next);
              try {
                localStorage.setItem(RANGE_KEY, next);
              } catch {
                /* per-viewer convenience only */
              }
            }}
            items={RANGES.map((key) => ({ key, label: t(`shell.flow.ranges.${key}`) }))}
          />
        </div>
      </div>
      <FlowCanvas
        graph={graph}
        legend={legend}
        hint={hint}
        editable
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
    </div>
  );
}
