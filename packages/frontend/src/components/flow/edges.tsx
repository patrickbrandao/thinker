import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';
import type { FlowEdge } from './types.js';
import { cx } from '../ui.jsx';

function FlowEdgeView(props: EdgeProps<FlowEdge>) {
  const [path, labelX, labelY] = getBezierPath(props);
  const { data } = props;
  return (
    <g
      className={cx(
        'flow-edge',
        (data?.live ?? 0) > 0 && 'edge-live',
        data?.dashed && 'edge-dashed',
        data?.state === 'error' && 'edge-error',
      )}
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
