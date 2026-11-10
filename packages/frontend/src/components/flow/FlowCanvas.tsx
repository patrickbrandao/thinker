import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { BroomSparkles, Hand, SquareDashedMousePointer } from 'lucide-react';
import { nodeTypes } from './nodes.jsx';
import { edgeTypes } from './edges.jsx';
import { DRAG_SNAP, GRID, validEdges } from './layout.js';
import type { FlowNode, Graph } from './types.js';
import { cx } from '../ui.jsx';
import { t } from '../../i18n/index.js';

export interface FlowLegendItem {
  id: string;
  label: string;
  dashed?: boolean;
  error?: boolean;
  idle?: boolean;
}

export interface FlowCanvasProps {
  /** Nodes come laid out (positions set by the page's adapter). */
  graph: Graph;
  legend?: FlowLegendItem[];
  /** Centered hint, e.g. for an empty graph. */
  hint?: ReactNode;
  onNodeOpen?: (node: FlowNode) => void;
  /** Read-only by default; set to let the user drag nodes. */
  editable?: boolean;
  /** Called after a drag, with every moved node at its new position. */
  onNodesMoved?: (nodes: FlowNode[]) => void;
  /** Adds a reset-layout button to the controls; the page confirms and resets. */
  onResetLayout?: () => void;
}

// Sized in pixels (14 stroke units of the base 1.6 line), so it keeps its size on thicker lines.
const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 22.4,
  height: 22.4,
  color: 'var(--edge)',
  markerUnits: 'userSpaceOnUse',
};

function Canvas({
  graph,
  legend,
  hint,
  onNodeOpen,
  editable,
  onNodesMoved,
  onResetLayout,
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const flow = useReactFlow();
  const shape = useRef('');
  // Set when the node set changed; the fit waits until React Flow measured them.
  const pendingFit = useRef(false);
  const measured = useNodesInitialized();
  // Dragging empty space pans the stage (hand) or draws a selection box (select).
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    // A data refresh or a saved move keeps the user's selection, and never
    // moves a node that is being dragged (it would jump back, then return).
    setNodes((prev) => {
      const current = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((n) => {
        const old = current.get(n.id);
        if (!old?.selected && !old?.dragging) return n;
        return {
          ...n,
          selected: old.selected,
          ...(old.dragging ? { dragging: true, position: old.position } : {}),
        };
      });
    });
    setEdges(
      validEdges(graph.nodes, graph.edges).map((e) => ({
        type: 'flow',
        ...(e.data?.arrow ? { markerEnd: ARROW } : {}),
        ...e,
      })),
    );
    // Re-frame only when the set of nodes changed, so a data refresh keeps
    // the user's pan and zoom. Fit after React Flow measured the new nodes.
    const next = graph.nodes.map((n) => n.id).join('|');
    if (next !== shape.current) {
      shape.current = next;
      pendingFit.current = true;
    }
  }, [graph, setNodes, setEdges, flow]);

  useEffect(() => {
    if (!pendingFit.current || !measured || nodes.length === 0) return;
    pendingFit.current = false;
    // Next frame: the store holds the committed nodes and their sizes.
    requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 200 }));
  }, [measured, nodes, flow]);

  // `f` frames the whole graph, unless typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'f' && !event.metaKey && !event.ctrlKey) {
        void flow.fitView({ padding: 0.15, duration: 200 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flow]);

  return (
    <div className={cx('stage-wrap', selecting && 'is-selecting')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDoubleClick={(_, node) => onNodeOpen?.(node)}
        onNodeDragStop={(_, node, moved) => onNodesMoved?.(moved.length ? moved : [node])}
        nodesDraggable={editable === true}
        nodesConnectable={false}
        elementsSelectable
        // In select mode the middle and right buttons still pan.
        panOnDrag={selecting ? [1, 2] : true}
        selectionOnDrag={selecting}
        selectionMode={SelectionMode.Partial}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[DRAG_SNAP, DRAG_SNAP]}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton
            onClick={() => setSelecting((on) => !on)}
            title={selecting ? t('shell.flow.selectMode') : t('shell.flow.panMode')}
            aria-label={selecting ? t('shell.flow.selectMode') : t('shell.flow.panMode')}
            aria-pressed={selecting}
          >
            {selecting ? <SquareDashedMousePointer /> : <Hand />}
          </ControlButton>
          {onResetLayout ? (
            <ControlButton
              onClick={onResetLayout}
              title={t('shell.flow.resetLayout')}
              aria-label={t('shell.flow.resetLayout')}
            >
              <BroomSparkles />
            </ControlButton>
          ) : null}
        </Controls>
        {nodes.length > 24 ? <MiniMap pannable zoomable position="top-right" /> : null}
      </ReactFlow>
      {hint ? <div className="stage-hint">{hint}</div> : null}
      {legend?.length ? (
        <div className="stage-legend">
          {legend.map((item) => (
            <span
              key={item.id}
              className={cx(
                item.dashed && 'is-dashed',
                item.error && 'is-error',
                item.idle && 'is-idle',
              )}
            >
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The flow stage (React Flow). Lazy-load the page that uses it so React Flow
 * stays in its own chunk. Pages pass a laid-out Graph built by an adapter.
 */
export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
