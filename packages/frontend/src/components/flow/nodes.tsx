import { memo } from 'react';
import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react';
import type { FlowNode } from './types.js';
import { cx } from '../ui.jsx';

/** Entry point: icon and text inside, rounder on the left (n8n trigger). */
function SourceNodeView({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div
      className={cx('n8n-source', data.state && `is-${data.state}`, selected && 'is-selected')}
      title={data.tooltip}
    >
      <span className="n8n-source-icon">{data.icon}</span>
      <span className={cx('n8n-source-lines', data.dense && 'is-dense')}>
        {(data.lines ?? [data.title]).map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </span>
      {data.outbound ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

/** A step: icon inside a square, name (and an optional subtitle) below. */
function StepNodeView({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div className="n8n-step" title={data.tooltip}>
      <div className={cx('n8n-box', data.state && `is-${data.state}`, selected && 'is-selected')}>
        {data.inbound ? <Handle type="target" position={Position.Left} /> : null}
        <span className="n8n-icon">{data.icon}</span>
        {data.outbound ? <Handle type="source" position={Position.Right} /> : null}
      </div>
      <div className="n8n-name">{data.title}</div>
      {data.subtitle ? <div className="n8n-sub">{data.subtitle}</div> : null}
    </div>
  );
}

export const nodeTypes: NodeTypes = {
  source: memo(SourceNodeView),
  node: memo(StepNodeView),
};
