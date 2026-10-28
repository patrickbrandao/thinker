import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Workflow } from 'lucide-react';
import FlowCanvas from '../components/flow/FlowCanvas.jsx';
import { Switch, Tabs } from '../components/ui.jsx';
import { getTopology, type TopologyRange } from '../services/api/console.js';
import { analyticsPing } from '../services/sse.js';
import { useResource } from '../lib/use-resource.js';
import { useSignal } from '../lib/signal.js';
import { t } from '../i18n/index.js';
import { buildTopologyGraph, topologyPorts } from './topology-adapter.js';
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
 * Topology and usage as a flow: harnesses → routing points (auto, virtual
 * models, header tiers) → providers, with the traffic of the chosen period on
 * every link. Refreshes when new requests arrive (SSE ping).
 */
export default function Topology() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TopologyRange>(savedRange);
  const [activeOnly, setActiveOnly] = useState(false);
  const ping = useSignal(analyticsPing);
  const topology = useResource(() => getTopology(range), [range]);

  useEffect(() => {
    if (ping > 0) void topology.reload();
    // Reload on new traffic only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ping]);

  const graph = useMemo(
    () =>
      topology.data ? buildTopologyGraph(topology.data, { activeOnly }) : { nodes: [], edges: [] },
    [topology.data, activeOnly],
  );
  const ports = useMemo(() => topologyPorts(), []);

  const hint =
    topology.loading && !topology.data
      ? null
      : topology.data && topology.data.harnesses.length === 0
        ? t('shell.flow.empty')
        : graph.nodes.length === 0
          ? t('shell.flow.emptyActive')
          : null;

  return (
    <div className="stage">
      <title>{`${t('nav.topology')} | Thinker`}</title>
      <div className="stage-head">
        <Workflow size={18} className="text-muted" aria-hidden="true" />
        <div>
          <h1>{t('nav.topology')}</h1>
          <div className="sub">
            {t('shell.flow.subtitle')}{' '}
            <span className="hidden xl:inline">{t('shell.flow.hint')}</span>
          </div>
        </div>
        <div className="stage-actions items-center">
          <label className="flex items-center gap-2 text-xs text-muted">
            <Switch
              checked={activeOnly}
              onChange={setActiveOnly}
              label={t('shell.flow.activeOnly')}
            />
            {t('shell.flow.activeOnly')}
          </label>
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
        ports={ports}
        hint={hint}
        onNodeOpen={(node) => {
          if (node.data.href) navigate(node.data.href);
        }}
      />
    </div>
  );
}
