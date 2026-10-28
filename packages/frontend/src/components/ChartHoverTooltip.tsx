import type uPlot from 'uplot';
import { t } from '../i18n/index.js';
import { monthShort } from '../services/overview-format.js';

/**
 * Shared column-hover tooltip for the stacked bar charts (Cost / Tokens /
 * Requests by provider-harness via MultiAgentTokenChart, and Requests by
 * status / Recovered requests via ReliabilityChart). One implementation so the
 * hover reads the same everywhere: snapped cursor, date header, one row per
 * series (swatch, name, value), underlined Total. The `agent-chart-tooltip*`
 * classes are stable hooks for tests; the look comes from the utilities.
 */

export interface HoverEntry {
  label: string;
  value: number;
  color: string;
}

export interface HoverTooltipState {
  visible: boolean;
  left: number;
  top: number;
  alignRight: boolean;
  date: string;
  entries: HoverEntry[];
  total: number;
}

export const HIDDEN_TOOLTIP: HoverTooltipState = {
  visible: false,
  left: 0,
  top: 0,
  alignRight: false,
  date: '',
  entries: [],
  total: 0,
};

/**
 * `cursor.move` hook: snap the vertical cursor line to the nearest data
 * column instead of following the pointer pixel by pixel.
 */
export function snapToBucket(u: uPlot, left: number, top: number): [number, number] {
  const idx = u.posToIdx(left);
  const snappedLeft =
    idx != null && u.data[0]?.[idx] != null ? Math.round(u.valToPos(u.data[0][idx]!, 'x')) : left;
  return [snappedLeft, top];
}

export function formatTooltipDate(epochSec: number, multiDay: boolean): string {
  const d = new Date(epochSec * 1000);
  const day = d.getDate();
  const mon = monthShort(d);
  const year = d.getFullYear();
  if (multiDay) return `${day} ${mon} ${year}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${year}, ${hh}:${mm}`;
}

const ROWS_PER_COL = 16;

export interface ChartHoverTooltipProps {
  state: HoverTooltipState;
  fmtVal: (v: number) => string;
  /** Host width, used to anchor from the right past the chart's midpoint. */
  hostWidth: () => number;
}

export default function ChartHoverTooltip({ state, fmtVal, hostWidth }: ChartHoverTooltipProps) {
  const visibleEntries = state.entries.filter((e) => e.value > 0);
  if (!state.visible || visibleEntries.length === 0) return null;

  const columns: HoverEntry[][] = [];
  for (let i = 0; i < visibleEntries.length; i += ROWS_PER_COL) {
    columns.push(visibleEntries.slice(i, i + ROWS_PER_COL));
  }

  return (
    <div
      className="agent-chart-tooltip pointer-events-none absolute z-20 min-w-44 rounded-surface border border-line bg-elev px-3.5 py-3 text-[13px] shadow-[var(--shadow-float)]"
      style={{
        left: state.alignRight ? 'auto' : state.left + 2,
        right: state.alignRight ? hostWidth() - state.left + 2 : 'auto',
        top: state.top,
      }}
    >
      <div className="agent-chart-tooltip__date mb-2 border-b border-line pb-2 font-medium text-muted">
        {state.date}
      </div>
      <div className="agent-chart-tooltip__columns flex gap-8">
        {columns.map((col, ci) => (
          <div key={ci} className="agent-chart-tooltip__list flex flex-col gap-1">
            {col.map((entry, ri) => (
              <div
                key={`${ri}-${entry.label}`}
                className="agent-chart-tooltip__row flex items-center gap-2"
              >
                <span
                  className="agent-chart-tooltip__swatch size-2.5 shrink-0 rounded-sm"
                  style={{ background: entry.color }}
                />
                <span className="agent-chart-tooltip__name min-w-0 flex-1 truncate text-ink">
                  {entry.label}
                </span>
                <span className="agent-chart-tooltip__value shrink-0 text-right tabular-nums text-muted">
                  {fmtVal(entry.value)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="agent-chart-tooltip__total mt-2 flex items-center justify-between border-t border-line pt-2 text-muted">
        <span>{t('overview.chart.total')}</span>
        <span className="agent-chart-tooltip__total-value font-bold tabular-nums text-ink">
          {fmtVal(state.total)}
        </span>
      </div>
    </div>
  );
}
