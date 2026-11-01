import { useEffect, useRef, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { nodeTypes } from './nodes.jsx';
import { edgeTypes } from './edges.jsx';
import { GRID, validEdges } from './layout.js';
import type { FlowNode, Graph } from './types.js';
import { cx } from '../ui.jsx';

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
}

// Sized in pixels (14 stroke units of the base 1.6 line), so it keeps its size on thicker lines.
const ARROW = {
  type: MarkerType.ArrowClosed,
  width: 22.4,
  height: 22.4,
  color: 'var(--edge)',
  markerUnits: 'userSpaceOnUse',
};

function Canvas({ graph, legend, hint, onNodeOpen, editable, onNodesMoved }: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const flow = useReactFlow();
  const shape = useRef('');

  useEffect(() => {
    setNodes(graph.nodes);
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
      requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 200 }));
    }
  }, [graph, setNodes, setEdges, flow]);

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
    <div className="stage-wrap">
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
        snapToGrid
        snapGrid={[GRID, GRID]}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
        <Controls position="bottom-left" showInteractive={false} />
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
