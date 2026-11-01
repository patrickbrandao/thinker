import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import InfoTooltip from './InfoTooltip.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';
import { splitRequestLine } from '../services/request-line.js';

/**
 * Render an effective model parameter value as a readable string. Objects
 * and arrays get pretty-printed with two-space indent so future provider
 * knobs (`reasoning_effort`, `safety: { mode: 'permissive' }`, etc.) wrap
 * naturally inside the value cell instead of becoming an unbreakable
 * single-line token. `undefined` matches the em-dash convention used
 * elsewhere in this panel for absent telemetry.
 */
export function formatParamValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

/** A collapsible key/value table with a count badge (closed by default). */
function TogglePanel({
  title,
  idPrefix,
  rows,
  keyLabel,
  valueClass,
  tooltip,
}: {
  title: string;
  idPrefix: string;
  rows: Array<[string, string]>;
  keyLabel: string;
  valueClass: string;
  tooltip?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tableId = `${idPrefix}-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <div className={cx('toggle-panel mt-4', open && 'toggle-panel--open')}>
      <div className="toggle-panel__header flex items-center gap-1.5">
        <button
          type="button"
          className="msg-detail__section-title msg-detail__section-title--toggle eyebrow inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={tableId}
          onClick={() => setOpen((v) => !v)}
        >
          <span
            className={cx(
              'msg-detail__chevron inline-flex transition-transform',
              open && 'msg-detail__chevron--open rotate-90',
            )}
            aria-hidden="true"
          >
            <ChevronRight className="size-3" />
          </span>
          {title}
          <span className="msg-detail__count-badge badge mono">{rows.length}</span>
        </button>
        {tooltip}
      </div>
      {open ? (
        <div className="table-wrap mt-2" id={tableId}>
          <table className="data msg-detail__table">
            <thead>
              <tr>
                <th>{keyLabel}</th>
                <th>{t('messages.details.value')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="msg-detail__mono-xs font-mono text-xs">{k}</td>
                  <td className={cx('msg-detail__mono-xs font-mono text-xs', valueClass)}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function RequestHeadersSection({ headers }: { headers: Record<string, string> }) {
  const { requestLine, rest } = splitRequestLine(headers);
  const rows = Object.entries(rest).sort(([a], [b]) => a.localeCompare(b));
  if (requestLine) rows.unshift([t('messages.details.requestLine'), requestLine]);
  return (
    <TogglePanel
      title={t('messages.details.requestHeaders')}
      idPrefix="msg-detail-request-headers"
      rows={rows}
      keyLabel={t('messages.details.header')}
      valueClass="msg-detail__log-body break-all"
    />
  );
}

export function ModelParamsSection({ params }: { params: Record<string, unknown> }) {
  const rows = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]): [string, string] => [k, formatParamValue(v)]);
  return (
    <TogglePanel
      title={t('messages.details.modelParameters')}
      idPrefix="msg-detail-model-params"
      rows={rows}
      keyLabel={t('messages.details.parameter')}
      valueClass="msg-detail__param-value whitespace-pre-wrap break-words"
      tooltip={<InfoTooltip text={t('messages.details.modelParamsTooltip')} />}
    />
  );
}
