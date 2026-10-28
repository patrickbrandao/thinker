import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

/**
 * Icon button that copies `text` to the clipboard and shows a check for 2s.
 * `copy-btn` is a stable hook for tests and for parents that position it.
 */
export default function CopyButton({
  text,
  disabled,
  className,
}: {
  text: string;
  disabled?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFailed(false), 2000);
    }
  };

  const label = disabled
    ? t('ui.copy.disabled')
    : copied
      ? t('common.copied')
      : failed
        ? t('ui.copy.failed')
        : t('ui.copy.toClipboard');

  return (
    <button
      type="button"
      className={cx(
        'icon-btn copy-btn',
        copied && 'text-ok',
        failed && 'text-danger',
        disabled && 'is-disabled cursor-not-allowed opacity-50',
        className,
      )}
      onClick={handleCopy}
      disabled={disabled}
      title={disabled ? t('ui.copy.revealFirst') : t('common.copy')}
      aria-label={label}
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  );
}
