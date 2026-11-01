import type { FlowEdge, FlowNode, Graph } from './types.js';

/** Grid the canvas snaps to; positions are kept on it. */
export const GRID = 24;
const COLUMN_GAP = 264;

export const snap = (value: number) => Math.round(value / GRID) * GRID;

export interface ColumnLayoutOptions {
  /** Column of each node, left to right. Empty columns close up. */
  columnOf: (node: FlowNode) => number;
  /** Vertical room a node takes in its column. */
  heightOf: (node: FlowNode) => number;
  /** Saved positions win over the computed ones. */
  positions?: Record<string, { x: number; y: number }>;
}

/**
 * Column layout: each kind of node stacks in its own column, columns
 * vertically centered on each other. Inside a column nodes sit in the order
 * of their parents (mean rank in the columns to the left), which keeps links
 * from crossing; the first column keeps the input order.
 */
export function columnLayout(graph: Graph, options: ColumnLayoutOptions): Graph {
  const columns = new Map<number, FlowNode[]>();
  for (const node of graph.nodes) {
    const c = options.columnOf(node);
    columns.set(c, [...(columns.get(c) ?? []), node]);
  }
  const parents = new Map<string, string[]>();
  for (const edge of graph.edges) {
    parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source]);
  }

  const rank = new Map<string, number>();
  const ordered = [...columns.keys()].sort((a, b) => a - b).map((c) => columns.get(c)!);
  for (const column of ordered) {
    const weight = (node: FlowNode) => {
      const ranks = (parents.get(node.id) ?? [])
        .map((p) => rank.get(p))
        .filter((r): r is number => r !== undefined);
      return ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : Infinity;
    };
    const keyed = column.map((node, i) => ({ node, i, w: weight(node) }));
    keyed.sort((a, b) => (a.w === b.w ? a.i - b.i : a.w - b.w));
    column.splice(0, column.length, ...keyed.map((k) => k.node));
    column.forEach((node, i) => rank.set(node.id, i));
  }

  const heights = ordered.map((column) =>
    column.reduce((sum, node) => sum + options.heightOf(node), 0),
  );
  const tallest = Math.max(0, ...heights);
  const placed = new Map<string, { x: number; y: number }>();
  ordered.forEach((column, c) => {
    let y = (tallest - (heights[c] ?? 0)) / 2;
    for (const node of column) {
      placed.set(node.id, { x: snap(c * COLUMN_GAP), y: snap(y) });
      y += options.heightOf(node);
    }
  });

  const nodes = graph.nodes.map((node) => ({
    ...node,
    position: options.positions?.[node.id] ?? placed.get(node.id) ?? { x: 0, y: 0 },
  }));
  return { nodes, edges: graph.edges };
}

/** Edges whose two ends exist, so a stale link never crashes the canvas. */
export function validEdges(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
}
