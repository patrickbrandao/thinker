import type { Edge, Node } from '@xyflow/react';

/**
 * Vocabulary of the flow canvas (skill: canvas.md), mapped to Thinker:
 *
 *   entry ──(live traffic)──▶ hub ══(port)══▶ item / group
 *
 * entry: where traffic comes from (a harness); its edges animate while live.
 * hub:   a routing point (auto, a virtual model, a tier) with one output port
 *        per kind of link.
 * item:  a leaf (a provider connection, a model).
 * group: a leaf standing for a set (a provider pool), with a counter.
 *
 * Pages build a Graph from API data with an adapter; the canvas never knows
 * the domain.
 */
export type FlowNodeKind = 'entry' | 'hub' | 'item' | 'group';

export interface FlowNodeData extends Record<string, unknown> {
  kind: FlowNodeKind;
  title: string;
  subtitle?: string | null;
  /** Port slot 1–12 (`--port-N`) used for the accent of the node. */
  port?: number;
  /** Short metric lines, e.g. "1.2k req" or "3 err". */
  metrics?: string[];
  /** For groups: how many members the node stands for. */
  count?: number;
  /** Where "Open" in the drawer goes. */
  href?: string;
}

export type FlowNode = Node<FlowNodeData, FlowNodeKind>;

export interface FlowEdgeData extends Record<string, unknown> {
  port?: number;
  /** Live traffic on this link (requests in the window); animates when > 0. */
  live?: number;
  label?: string;
  state?: 'saving' | 'error';
}

export type FlowEdge = Edge<FlowEdgeData>;

export interface Graph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** A port: an id the API understands, a label and a color slot. */
export interface FlowPort {
  id: string;
  label: string;
  slot: number;
}
