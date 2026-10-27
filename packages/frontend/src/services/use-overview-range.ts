import { useState } from 'react';
import { COMPACT_COLUMNS } from '../components/message-table-types.js';
import { t } from '../i18n/index.js';

export const RANGE_STORAGE_KEY = 'thinker_chart_range';
export const VALID_RANGES = new Set(['24h', '7d', '30d', '90d', '365d']);

const RANGES = ['24h', '7d', '30d', '90d', '365d'] as const;

/** Range selector options, labelled in the active language. Call from JSX. */
export function rangeOptions(): Array<{ label: string; value: string }> {
  return RANGES.map((value) => ({ label: t(`overview.range.${value}`), value }));
}

/**
 * Shared range state + localStorage persistence for Overview pages.
 * Returns `range`, `setRange`, and `handleRangeChange`.
 * `handleRangeChange` persists the new value and, when `markUserSelected` is
 * provided, calls it so the smart-range cascade in the per-agent Overview knows
 * the user made an explicit choice.
 */
export function useOverviewRange(options?: { markUserSelected?: () => void }) {
  const [range, setRange] = useState(() => {
    try {
      const saved = localStorage.getItem(RANGE_STORAGE_KEY);
      return saved && VALID_RANGES.has(saved) ? saved : '30d';
    } catch {
      return '30d';
    }
  });

  const handleRangeChange = (value: string) => {
    setRange(value);
    options?.markUserSelected?.();
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, value);
    } catch {
      // Storage blocked: the range lasts for this page only.
    }
  };

  return { range, setRange, handleRangeChange };
}

/**
 * Shared Messages-table columns for the Overview pages. Kept as a hook so callers
 * stay stable, though the column set is now the same everywhere.
 */
export function useOverviewColumns() {
  return { columns: COMPACT_COLUMNS };
}
