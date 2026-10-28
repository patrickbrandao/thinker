import { memo, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react';
import { Bot, Boxes, Monitor, Plug, Route } from 'lucide-react';
import type { FlowNode, FlowNodeKind } from './types.js';
import { t } from '../../i18n/index.js';
import { cx } from '../ui.jsx';

const KIND_ICON: Record<FlowNodeKind, typeof Bot> = {
  client: Monitor,
  entry: Bot,
  hub: Route,
  item: Plug,
  group: Boxes,
};

const portStyle = (port?: number): CSSProperties | undefined =>
  port ? ({ '--port': `var(--port-${port})` } as CSSProperties) : undefined;

/** One line: the address and its request counter. */
function ClientNodeView({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div className={cx('flow-node', 'node-client', selected && 'is-selected')}>
      <div className="node-line">
        <span className="node-ip" title={data.title}>
          {data.title}
        </span>
        {data.count !== undefined ? <span className="node-pill">{data.count}</span> : null}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function FlowNodeView({ data, selected }: NodeProps<FlowNode>) {
  const Icon = KIND_ICON[data.kind];
  const hub = data.kind === 'hub';
  return (
    <div
      className={cx('flow-node', `node-${data.kind}`, selected && 'is-selected')}
      style={portStyle(data.port)}
    >
      {data.kind !== 'entry' || data.inbound ? (
        <Handle type="target" position={Position.Left} />
      ) : null}
      <div className="node-kind">
        <Icon aria-hidden="true" />
        {data.label ?? t(`shell.flow.kinds.${data.kind}`)}
        {hub ? (
          <span className="node-name" title={data.title}>
            {data.title}
          </span>
        ) : null}
      </div>
      {hub ? null : (
        <div className="node-title" title={data.title}>
          {data.title}
        </div>
      )}
      {data.subtitle ? <div className="node-sub">{data.subtitle}</div> : null}
      {data.kind === 'group' && data.count !== undefined ? (
        <div className="node-count">{data.count}</div>
      ) : null}
      {data.routes?.length ? (
        <div className="node-routes">
          {data.routes.map((route) => (
            <div key={route.id} className="node-route" title={route.label}>
              <span>{route.label}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={route.id}
                style={portStyle(route.port)}
              />
            </div>
          ))}
        </div>
      ) : null}
      {data.metrics?.length ? (
        <div className="node-metric">
          {data.metrics.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      ) : null}
      {data.kind === 'entry' || (hub && !data.routes?.length) ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}

const View = memo(FlowNodeView);

export const nodeTypes: NodeTypes = {
  client: memo(ClientNodeView),
  entry: View,
  hub: View,
  item: View,
  group: View,
};
