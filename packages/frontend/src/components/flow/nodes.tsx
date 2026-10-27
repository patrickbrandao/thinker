import { memo, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react';
import { Bot, Boxes, Plug, Route } from 'lucide-react';
import type { FlowNode, FlowNodeKind } from './types.js';
import { t } from '../../i18n/index.js';
import { cx } from '../ui.jsx';

const KIND_ICON: Record<FlowNodeKind, typeof Bot> = {
  entry: Bot,
  hub: Route,
  item: Plug,
  group: Boxes,
};

const portStyle = (port?: number): CSSProperties | undefined =>
  port ? ({ '--port': `var(--port-${port})` } as CSSProperties) : undefined;

function FlowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const Icon = KIND_ICON[data.kind];
  return (
    <div
      className={cx('flow-node', `node-${data.kind}`, selected && 'is-selected')}
      style={portStyle(data.port)}
    >
      {data.kind !== 'entry' ? <Handle type="target" position={Position.Left} /> : null}
      <div className="node-kind">
        <Icon aria-hidden="true" />
        {t(`shell.flow.kinds.${data.kind}`)}
      </div>
      <div className="node-title" title={data.title}>
        {data.title}
      </div>
      {data.subtitle ? <div className="node-sub">{data.subtitle}</div> : null}
      {data.kind === 'group' && data.count !== undefined ? (
        <div className="node-count">{data.count}</div>
      ) : null}
      {data.metrics?.length ? (
        <div className="node-metric">
          {data.metrics.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      ) : null}
      {data.kind === 'entry' || data.kind === 'hub' ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}

const View = memo(FlowNodeView);

export const nodeTypes: NodeTypes = { entry: View, hub: View, item: View, group: View };
