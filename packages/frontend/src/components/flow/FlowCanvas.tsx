import { useEffect, type ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { nodeTypes } from './nodes.jsx';
import { edgeTypes } from './edges.jsx';
import { GRID, autoLayout, validEdges } from './layout.js';
import type { FlowNode, FlowPort, Graph } from './types.js';

export interface FlowCanvasProps {
  graph: Graph;
  /** Legend of the ports drawn on the edges. */
  ports?: FlowPort[];
  /** Centered hint, e.g. for an empty graph. */
  hint?: ReactNode;
  onNodeOpen?: (node: FlowNode) => void;
  /** Read-only by default; set to let the user drag nodes. */
  editable?: boolean;
  /** Called after a drag, with the moved node's new position. */
  onNodeMoved?: (node: FlowNode) => void;
}

function Canvas({ graph, ports, hint, onNodeOpen, editable, onNodeMoved }: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  const flow = useReactFlow();

  useEffect(() => {
    const laid = autoLayout(graph, { keepPositions: true });
    setNodes(laid.nodes);
    setEdges(validEdges(laid.nodes, laid.edges).map((e) => ({ type: 'flow', ...e })));
    // Fit after React Flow measured the new nodes.
    requestAnimationFrame(() => void flow.fitView({ padding: 0.2, duration: 200 }));
  }, [graph, setNodes, setEdges, flow]);

  // `f` frames the whole graph (skill shortcut), unless typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'f' && !event.metaKey && !event.ctrlKey) {
        void flow.fitView({ padding: 0.2, duration: 200 });
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
        onNodeDragStop={(_, node) => onNodeMoved?.(node)}
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
        {nodes.length > 12 ? <MiniMap pannable zoomable /> : null}
      </ReactFlow>
      {hint ? <div className="stage-hint">{hint}</div> : null}
      {ports?.length ? (
        <div className="stage-legend">
          {ports.map((port) => (
            <span key={port.id} style={{ ['--port' as string]: `var(--port-${port.slot})` }}>
              {port.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The flow stage (React Flow). Lazy-load the page that uses it so React Flow
 * stays in its own chunk. Pages pass a Graph built by an adapter from API data.
 */
export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
