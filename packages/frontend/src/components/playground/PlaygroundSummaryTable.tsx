import { BadgeCheck, Star } from 'lucide-react';
import type { PlaygroundColumn } from '../../services/playground-store.js';
import {
  formatCost,
  formatDuration,
  formatNumber,
  formatTrend,
} from '../../services/formatters.js';
import { getProvider } from '../../services/provider-utils.js';
import { resolveProviderId } from '../../services/routing-utils.js';
import { providerIcon } from '../ProviderIcon.jsx';
import { cx } from '../ui.jsx';
import { t } from '../../i18n/index.js';

function WinnerBadge() {
  return (
    <span className="playground-summary__winner-icon inline-flex text-ok">
      <BadgeCheck size={15} aria-hidden="true" />
    </span>
  );
}

function providerIdFor(col: PlaygroundColumn): string {
  return resolveProviderId(col.provider) ?? col.provider.toLowerCase();
}

interface Props {
  columns: readonly PlaygroundColumn[];
  /** playground_columns.id the user marked best, or null. */
  bestColumnId?: string | null;
  /** Toggle a column as best. Absent ⇒ rows are not clickable (read-only). */
  onMarkBest?: (col: PlaygroundColumn) => void;
}

interface MetricCell {
  raw: number | null;
  display: string;
  isWinner: boolean;
  delta: string | null;
}

function mkCell(
  raw: number | null,
  display: string,
  winner: number | null,
  lowerIsBetter: boolean,
): MetricCell {
  if (raw == null || winner == null) {
    return { raw, display, isWinner: false, delta: null };
  }
  const isWinner = raw === winner;
  if (isWinner) return { raw, display, isWinner: true, delta: null };
  if (winner === 0) return { raw, display, isWinner: false, delta: null };
  const ratio = (raw - winner) / winner;
  const deltaPct = lowerIsBetter ? ratio * 100 : -ratio * 100;
  return { raw, display, isWinner: false, delta: formatTrend(deltaPct) };
}

function CellValue({ cell }: { cell: MetricCell }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="playground-summary__value">{cell.display}</span>
      {cell.isWinner ? <WinnerBadge /> : null}
      {cell.delta ? (
        <span className="playground-summary__delta text-xs text-faint">{cell.delta}</span>
      ) : null}
    </span>
  );
}

/** Side-by-side comparison of the successful columns (shown from two up). */
export default function PlaygroundSummaryTable({ columns, bestColumnId, onMarkBest }: Props) {
  const successColumns = columns.filter((c) => c.status === 'success' && c.metrics);
  if (successColumns.length < 2) return null;

  const costs = successColumns.map((c) => c.metrics?.cost).filter((v): v is number => v != null);
  const durations = successColumns.map((c) => c.metrics?.durationMs ?? 0);
  // No "winner" for output tokens — fewer tokens is not better, it just
  // means a shorter answer. Only cost and speed have a meaningful minimum.
  const winners = {
    cost: costs.length > 0 ? Math.min(...costs) : null,
    duration: durations.length > 0 ? Math.min(...durations) : null,
  };

  const isBest = (col: PlaygroundColumn): boolean =>
    col.columnDbId != null && col.columnDbId === bestColumnId;

  return (
    <section
      className="playground-summary flex flex-col gap-2"
      aria-label={t('playground.summary.label')}
    >
      <h2 className="playground-summary__title text-sm font-semibold text-ink">
        {t('playground.summary.title')}
      </h2>
      <div className="table-wrap">
        <table className="playground-summary__table data">
          <thead>
            <tr>
              <th scope="col">{t('playground.summary.provider')}</th>
              <th scope="col">{t('playground.summary.model')}</th>
              <th scope="col">{t('playground.summary.cost')}</th>
              <th scope="col">{t('playground.summary.outputTokens')}</th>
              <th scope="col">{t('playground.summary.duration')}</th>
              <th scope="col" className="text-center">
                {t('playground.summary.best')}
              </th>
            </tr>
          </thead>
          <tbody>
            {successColumns.map((col) => {
              const cost = mkCell(
                col.metrics?.cost ?? null,
                col.metrics?.cost != null ? (formatCost(col.metrics.cost) ?? '—') : '—',
                winners.cost,
                true,
              );
              const duration = mkCell(
                col.metrics?.durationMs ?? null,
                formatDuration(col.metrics?.durationMs ?? 0),
                winners.duration,
                true,
              );
              const provId = providerIdFor(col);
              const providerName = getProvider(provId)?.name ?? col.provider;
              const clickable = !!onMarkBest && col.columnDbId != null;
              const best = isBest(col);
              const pick = (): void => {
                if (clickable) onMarkBest?.(col);
              };
              return (
                <tr
                  key={col.id}
                  className={cx(
                    best && 'playground-summary__row--best is-selected',
                    clickable && 'playground-summary__row--clickable cursor-pointer',
                  )}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-pressed={clickable ? best : undefined}
                  aria-label={
                    clickable
                      ? t('playground.summary.markBest', { name: col.displayName ?? '' })
                      : undefined
                  }
                  onClick={pick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      pick();
                    }
                  }}
                >
                  <td className="playground-summary__provider">
                    <span className="flex items-center gap-2">
                      <span className="inline-flex shrink-0">{providerIcon(provId, 16)}</span>
                      <span className="playground-summary__provider-name">{providerName}</span>
                    </span>
                  </td>
                  <th
                    scope="row"
                    className="row-title static bg-transparent normal-case tracking-normal text-[13px]"
                  >
                    {col.displayName}
                  </th>
                  <td className="font-mono tabular-nums">
                    <CellValue cell={cost} />
                  </td>
                  <td className="font-mono tabular-nums">
                    <span className="playground-summary__value">
                      {formatNumber(col.metrics?.outputTokens ?? 0)}
                    </span>
                  </td>
                  <td className="font-mono tabular-nums">
                    <CellValue cell={duration} />
                  </td>
                  <td className="playground-summary__best-cell text-center">
                    <span
                      className={cx(
                        'playground-summary__best-star inline-flex',
                        best ? 'playground-summary__best-star--on text-warn' : 'text-faint',
                      )}
                    >
                      <Star size={16} fill={best ? 'currentColor' : 'none'} aria-hidden="true" />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
