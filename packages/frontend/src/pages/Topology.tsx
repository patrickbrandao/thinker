import { useMemo } from 'react';
import { Workflow } from 'lucide-react';
import FlowCanvas from '../components/flow/FlowCanvas.jsx';
import type { Graph } from '../components/flow/types.js';
import { t } from '../i18n/index.js';
import '../styles-next/canvas.css';

/**
 * Topology and usage as a flow (React Flow). Foundation only: the stage, the
 * node and edge vocabulary and the layout are in place; the adapter that turns
 * harnesses, routes and providers into a Graph comes next.
 */
export default function Topology() {
  const graph = useMemo<Graph>(() => ({ nodes: [], edges: [] }), []);
  return (
    <div className="stage">
      <title>{`${t('nav.topology')} | Thinker`}</title>
      <div className="stage-head">
        <Workflow size={18} className="text-muted" aria-hidden="true" />
        <div>
          <h1>{t('nav.topology')}</h1>
          <div className="sub">{t('shell.flow.subtitle')}</div>
        </div>
        <span className="badge is-accent ml-auto">{t('shell.flow.preview')}</span>
      </div>
      <FlowCanvas graph={graph} hint={t('shell.flow.emptyHint')} />
    </div>
  );
}
