import { useEffect, useId, useState } from 'react';
import { t } from '../i18n/index.js';

const PRESET_DAYS = [1, 3, 7, 14, 30, 60, 90, 180, 365];
const MAX_DAYS = 3650;

/** Preset day counts, plus `current` when it is a value set elsewhere (API, MCP). */
export function retentionOptions(current: number | null | undefined): number[] {
  const days = [...PRESET_DAYS];
  if (current && !days.includes(current)) days.push(current);
  return days.sort((a, b) => a - b);
}

/**
 * Harness log retention. "Retention control" picks Global (follows the
 * organization, `value` null) or Custom; Custom adds a "Retention days" row
 * with a whole-number field and a list of suggested values.
 */
export default function LogRetentionSelect({
  value,
  globalDays,
  onChange,
  disabled,
  idPrefix = 'log-retention',
}: {
  value: number | null;
  globalDays: number | null;
  onChange: (days: number | null) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const custom = value !== null;
  const labelId = useId();
  // Typed text, committed on blur or Enter so a half-typed number never saves.
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);

  const commit = () => {
    const days = Number(draft);
    if (/^\d+$/.test(draft) && days >= 1 && days <= MAX_DAYS) {
      if (days !== value) onChange(days);
    } else {
      setDraft(value === null ? '' : String(value));
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,150px)_1fr] items-center gap-x-3 gap-y-2">
      <span id={labelId} className="text-sm text-dim">
        {t('harnesses.retention.control')}
      </span>
      <div className="segmented w-fit" role="radiogroup" aria-labelledby={labelId}>
        <button
          type="button"
          id={`${idPrefix}-global`}
          role="radio"
          aria-checked={!custom}
          aria-pressed={!custom}
          disabled={disabled}
          onClick={() => custom && onChange(null)}
        >
          {t('harnesses.retention.global')}
          {globalDays !== null ? ` (${t('harnesses.retention.days', globalDays)})` : ''}
        </button>
        <button
          type="button"
          id={`${idPrefix}-custom`}
          role="radio"
          aria-checked={custom}
          aria-pressed={custom}
          disabled={disabled}
          onClick={() => !custom && onChange(globalDays ?? 30)}
        >
          {t('harnesses.retention.custom')}
        </button>
      </div>

      {custom ? (
        <>
          <label htmlFor={`${idPrefix}-days`} className="text-sm text-dim">
            {t('harnesses.retention.daysLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id={`${idPrefix}-days`}
              className="field w-[110px]"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DAYS}
              step={1}
              value={draft}
              disabled={disabled}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                }
              }}
            />
            <select
              id={`${idPrefix}-suggested`}
              className="field w-[150px]"
              aria-label={t('harnesses.retention.suggested')}
              value={value !== null && PRESET_DAYS.includes(value) ? value : ''}
              disabled={disabled}
              onChange={(e) => {
                if (e.currentTarget.value) onChange(Number(e.currentTarget.value));
              }}
            >
              <option value="">{t('harnesses.retention.suggested')}</option>
              {PRESET_DAYS.map((days) => (
                <option key={days} value={days}>
                  {t('harnesses.retention.days', days)}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}
    </div>
  );
}
