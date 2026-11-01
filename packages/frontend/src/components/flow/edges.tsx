import { memo, type CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';
import type { FlowEdge } from './types.js';
import { cx } from '../ui.jsx';

/** Where the counter sits along the line: near the source, so crossing lines keep theirs apart. */
const LABEL_AT = 0.2;

/** Point at `t` of the cubic Bézier `M x,y C x1,y1 x2,y2 x3,y3` built by `getBezierPath`. */
export function pointOnBezier(path: string, t: number): [number, number] | null {
  const n = path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)?.map(Number);
  if (!n || n.length < 8) return null;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = n as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const u = 1 - t;
  const at = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return [at(x0, x1, x2, x3), at(y0, y1, y2, y3)];
}

function FlowEdgeView(props: EdgeProps<FlowEdge>) {
  const { data } = props;
  const [path, midX, midY] = getBezierPath(props);
  const [labelX, labelY] = pointOnBezier(path, data?.labelAt ?? LABEL_AT) ?? [midX, midY];
  return (
    <g
      className={cx(
        'flow-edge',
        (data?.live ?? 0) > 0 && 'edge-live',
        data?.dashed && 'edge-dashed',
        data?.idle && 'edge-idle',
        data?.state === 'error' && 'edge-error',
      )}
      style={data?.width ? ({ '--edge-width': data.width } as CSSProperties) : undefined}
    >
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} />
      {/* Live traffic runs as pulses over the line, so dashes keep meaning "fallback". */}
      {(data?.live ?? 0) > 0 ? <path d={path} className="flow-edge-pulse" /> : null}
      {data?.tooltip ? (
        // Wide invisible stroke so the hover text is easy to reach.
        <path d={path} className="flow-edge-hit">
          <title>{data.tooltip}</title>
        </path>
      ) : null}
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="flow-edge-label nodrag nopan"
            title={data.tooltip}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}

export const edgeTypes: EdgeTypes = { flow: memo(FlowEdgeView) };
