import type { ReactNode } from 'react';
import type { Edge, Node } from '@xyflow/react';

/**
 * Vocabulary of the flow canvas, n8n style: square nodes with the icon
 * inside and the name below, linked left to right.
 *
 *   source ──▶ node ──▶ … ──▶ sink
 *
 * source: where requests come in (a client address); the text goes inside
 *         the node and its left side is rounder, n8n's trigger shape.
 * node:   any other step (a harness, a provider connection, a proxy profile,
 *         the internet).
 *
 * Pages build a Graph from API data with an adapter; the canvas never knows
 * the domain.
 */
export type FlowNodeKind = 'source' | 'node';

export interface FlowNodeData extends Record<string, unknown> {
  kind: FlowNodeKind;
  /** Drawn inside the node. */
  icon: ReactNode;
  /** Name below the node (`node`), or the text lines inside it (`source`). */
  title: string;
  /** For sources: lines drawn inside the node, next to the icon. */
  lines?: string[];
  /** Second, dimmer line below the name. */
  subtitle?: string | null;
  /** Hover text (metrics and details). */
  tooltip?: string;
  /** Draw an input handle (something links into it). */
  inbound?: boolean;
  /** Draw an output handle (it links to something). */
  outbound?: boolean;
  state?: 'error' | 'idle';
  /** Where a double-click goes. */
  href?: string;
}

export type FlowNode = Node<FlowNodeData, FlowNodeKind>;

export interface FlowEdgeData extends Record<string, unknown> {
  /** Live traffic on this link (requests in the window); animates when > 0. */
  live?: number;
  label?: string;
  /** Hover text, e.g. the models carried by the link. */
  tooltip?: string;
  dashed?: boolean;
  state?: 'error';
}

export type FlowEdge = Edge<FlowEdgeData>;

export interface Graph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
