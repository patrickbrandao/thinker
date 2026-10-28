import { useState } from 'react';
import type { ResponseMode } from '../services/api.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

interface Props {
  responseMode: ResponseMode;
  onResponseModeChange: (mode: ResponseMode) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}

const RESPONSE_OPTIONS: Array<{ value: ResponseMode; label: () => string }> = [
  { value: 'buffered', label: () => t('models.outputControls.buffered') },
  { value: 'stream', label: () => t('models.outputControls.stream') },
];

/**
 * Buffered / stream response mode toggle. The `output-controls__segment*`
 * classes are stable test hooks; the look comes from `.segmented`.
 */
export default function OutputControls(props: Props) {
  const [saving, setSaving] = useState<ResponseMode | null>(null);
  const disabled = saving !== null || (props.disabled ?? false);
  const current = props.responseMode;

  const handleResponseChange = async (mode: ResponseMode) => {
    if (mode === props.responseMode || disabled) return;
    setSaving(mode);
    try {
      await props.onResponseModeChange(mode);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div
      className={cx(
        'output-controls flex items-center gap-2',
        props.compact && 'output-controls--compact',
      )}
    >
      <span className={cx('text-muted', props.compact ? 'text-xs' : 'text-sm')}>
        {t('models.outputControls.responseMode')}
      </span>
      <div className="segmented" role="group" aria-label={t('models.outputControls.responseMode')}>
        {RESPONSE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cx(
              'output-controls__segment inline-flex min-w-16 items-center justify-center disabled:cursor-not-allowed',
              current === option.value && 'output-controls__segment--active',
              saving === option.value && 'output-controls__segment--loading',
            )}
            aria-pressed={current === option.value}
            disabled={disabled}
            onClick={() => void handleResponseChange(option.value)}
          >
            {saving === option.value ? <span className="spinner" /> : option.label()}
          </button>
        ))}
      </div>
    </div>
  );
}
