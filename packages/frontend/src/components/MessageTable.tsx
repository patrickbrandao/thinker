import { Fragment, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MessageRow, MessageColumnKey } from './message-table-types.js';
import MessageDetails from './MessageDetails.js';
import { columnHeader, renderCell, type CellRenderContext } from './message-table-cells.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

export interface MessageTableProps {
  items: MessageRow[];
  columns: MessageColumnKey[];
  agentName?: string;
  customProviderName?: (model: string) => string | undefined;
  agentPlatformLookup?: (
    name: string,
  ) => { platform: string | null; category: string | null } | undefined;
  onFallbackErrorClick?: (model: string) => void;
  onTriggerClick?: (id: string) => void;
  rowIdPrefix?: string;
  showHeaderTooltips?: boolean;
  expandable?: boolean;
  /** When set, clicking a row calls this instead of expanding inline (drawer mode). */
  onRowSelect?: (id: string) => void;
  /** The currently selected row ID (for focus highlight in drawer mode). */
  selectedRowId?: string | null;
}

const noCustomName = () => undefined;

function cellContext(props: MessageTableProps): CellRenderContext {
  return {
    agentName: props.agentName,
    customProviderName: props.customProviderName ?? noCustomName,
    agentPlatformLookup: props.agentPlatformLookup,
    onFallbackErrorClick: props.onFallbackErrorClick,
    onTriggerClick: props.onTriggerClick,
  };
}

function renderCells(columns: MessageColumnKey[], item: MessageRow, ctx: CellRenderContext) {
  return columns.map((col) => <Fragment key={col}>{renderCell(col, item, ctx)}</Fragment>);
}

function ExpandableRow({
  item,
  tableProps,
  rowId,
}: {
  item: MessageRow;
  tableProps: MessageTableProps;
  rowId?: string;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const useDrawer = !!tableProps.onRowSelect;
  const selected = useDrawer && tableProps.selectedRowId === item.id;
  const toggleLabel = expanded
    ? t('messages.table.collapseDetails')
    : t('messages.table.expandDetails');

  const handleRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, [role="button"]')) return;
    if (useDrawer) tableProps.onRowSelect!(item.id);
    else setExpanded((v) => !v);
  };

  return (
    <>
      <tr
        id={rowId}
        className={cx(
          'msg-row--clickable cursor-pointer',
          expanded && 'msg-row--expanded',
          selected && 'msg-row--selected is-selected',
        )}
        onClick={handleRowClick}
      >
        {renderCells(tableProps.columns, item, cellContext(tableProps))}
        {!useDrawer ? (
          <td className="msg-detail__chevron-cell w-8 text-right">
            <button
              type="button"
              className={cx(
                'msg-detail__chevron-btn icon-btn',
                expanded && 'msg-detail__chevron-btn--open',
              )}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              aria-expanded={expanded}
              aria-label={toggleLabel}
              title={toggleLabel}
            >
              <ChevronDown
                aria-hidden="true"
                className={cx('size-3.5 transition-transform', expanded && 'rotate-180')}
              />
            </button>
          </td>
        ) : null}
      </tr>
      {expanded && !useDrawer ? (
        <tr className="msg-detail__row">
          <td colSpan={tableProps.columns.length + 1} className="msg-detail__cell bg-sunken">
            <MessageDetails messageId={item.id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function MessageTable(props: MessageTableProps) {
  const ctx = cellContext(props);
  const rowId = (item: MessageRow) =>
    props.rowIdPrefix ? `${props.rowIdPrefix}${item.id}` : undefined;
  return (
    <table className="data data-table">
      <thead>
        <tr>
          {props.columns.map((col) => (
            <th key={col} data-col={col}>
              {columnHeader(col, props.showHeaderTooltips)}
            </th>
          ))}
          {props.expandable ? <th className="msg-detail__chevron-th" /> : null}
        </tr>
      </thead>
      <tbody>
        {props.items.map((item) =>
          props.expandable ? (
            <ExpandableRow key={item.id} item={item} tableProps={props} rowId={rowId(item)} />
          ) : (
            <tr key={item.id} id={rowId(item)}>
              {renderCells(props.columns, item, ctx)}
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}
