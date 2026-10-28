import type { FlowEdge, FlowNode, Graph } from './types.js';

/** Grid the canvas snaps to; positions are kept on it. */
export const GRID = 24;
const COLUMN_GAP = 288;
const ROW_GAP = 120;
const CLIENT_GAP = 48;
const ROUTE_HEIGHT = 18;

/** Vertical room a node takes in its column. */
const rowHeight = (node: FlowNode) =>
  node.data.kind === 'client'
    ? CLIENT_GAP
    : ROW_GAP + Math.max(0, (node.data.routes?.length ?? 0) - 1) * ROUTE_HEIGHT;

export const snap = (value: number) => Math.round(value / GRID) * GRID;

/**
 * Layered left-to-right layout: each node goes one column right of its
 * deepest parent (sources in column 0), stacked in input order. Cycles are
 * broken by ignoring edges back to a node already on the current path.
 * Nodes that already have a position (saved by the user) keep it.
 */
export function autoLayout(graph: Graph, options: { keepPositions?: boolean } = {}): Graph {
  const incoming = new Map<string, string[]>();
  for (const node of graph.nodes) incoming.set(node.id, []);
  for (const edge of graph.edges) incoming.get(edge.target)?.push(edge.source);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = (incoming.get(id) ?? []).filter((p) => incoming.has(p));
    const d = parents.length === 0 ? 0 : Math.max(...parents.map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  const rows = new Map<number, number>();
  const nodes: FlowNode[] = graph.nodes.map((node) => {
    const column = depthOf(node.id);
    const y = rows.get(column) ?? 0;
    rows.set(column, y + rowHeight(node));
    const hasPosition =
      options.keepPositions && node.position && (node.position.x !== 0 || node.position.y !== 0);
    return hasPosition ? node : { ...node, position: { x: snap(column * COLUMN_GAP), y: snap(y) } };
  });
  return { nodes, edges: graph.edges };
}

/** Edges whose two ends exist, so a stale link never crashes the canvas. */
export function validEdges(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
}
