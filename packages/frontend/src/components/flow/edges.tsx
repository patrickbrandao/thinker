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

function FlowEdgeView(props: EdgeProps<FlowEdge>) {
  const [path, labelX, labelY] = getBezierPath(props);
  const { data } = props;
  const style = data?.port
    ? ({ '--port': `var(--port-${data.port})` } as CSSProperties)
    : undefined;
  return (
    <g
      className={cx(
        'flow-edge',
        (data?.live ?? 0) > 0 && 'edge-live',
        data?.state === 'saving' && 'edge-saving',
        data?.state === 'error' && 'edge-error',
      )}
      style={style}
    >
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="badge mono nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}

export const edgeTypes: EdgeTypes = { flow: memo(FlowEdgeView) };
