import { t } from '../i18n/index.js';

const PRESET_DAYS = [1, 3, 7, 14, 30, 60, 90, 180, 365];

/** Preset day counts, plus `current` when it is a value set elsewhere (API, MCP). */
export function retentionOptions(current: number | null | undefined): number[] {
  const days = [...PRESET_DAYS];
  if (current && !days.includes(current)) days.push(current);
  return days.sort((a, b) => a - b);
}

/**
 * Harness log retention: Global follows the organization (`value` null),
 * Custom keeps the chosen number of days.
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
  const shown = value ?? globalDays;
  return (
    <div className="grid grid-cols-2 gap-2">
      <select
        id={`${idPrefix}-mode`}
        className="field"
        aria-label={t('harnesses.retention.label')}
        value={custom ? 'custom' : 'global'}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value === 'custom' ? (globalDays ?? 30) : null)}
      >
        <option value="global">{t('harnesses.retention.global')}</option>
        <option value="custom">{t('harnesses.retention.custom')}</option>
      </select>
      <select
        id={`${idPrefix}-days`}
        className="field"
        aria-label={t('harnesses.retention.label')}
        value={shown ?? ''}
        disabled={disabled || !custom}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      >
        {shown === null ? <option value="">…</option> : null}
        {retentionOptions(shown).map((days) => (
          <option key={days} value={days}>
            {t('harnesses.retention.days', days)}
          </option>
        ))}
      </select>
    </div>
  );
}
