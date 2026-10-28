import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import type { RoutingProvider } from '../services/api.js';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

interface RouteKeyChipProps {
  keys: RoutingProvider[];
  currentLabel?: string | null;
  modelLabel: string;
  usedLabels?: Set<string>;
  onPick: (label: string | null) => void | Promise<void>;
  buttonClass: string;
  disabled?: boolean;
  allowClear?: boolean;
  leadingMargin?: boolean;
  menuMinWidth?: number;
  stopPropagation?: boolean;
}

/** Small pill that pins a route to one API key of its provider. */
export default function RouteKeyChip(props: RouteKeyChipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const stop = (event: SyntheticEvent) => {
    if (props.stopPropagation) event.stopPropagation();
  };
  const displayLabel = props.currentLabel ?? props.keys[0]?.label ?? '';
  const usedLabels = props.usedLabels ?? new Set<string>();

  return (
    <span ref={containerRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        className={cx(
          props.buttonClass,
          'inline-flex max-w-24 cursor-pointer items-center gap-0.5 overflow-hidden whitespace-nowrap rounded-full border border-line bg-s2 px-2 py-0.5 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-60',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('routing.keyChip.label', {
          model: props.modelLabel,
          current: displayLabel,
        })}
        title={displayLabel}
        disabled={props.disabled}
        onClick={(event) => {
          stop(event);
          setOpen(!open);
        }}
        style={props.leadingMargin ? { marginLeft: 4 } : undefined}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label={t('routing.keyChip.choose')}
          onClick={stop}
          className="menu right-0 top-full z-10 mt-1 flex list-none flex-col gap-0.5"
          style={{ minWidth: props.menuMinWidth ?? 160 }}
        >
          {props.allowClear && props.currentLabel ? (
            <li className="mb-0.5 border-b border-line pb-1">
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="menu-item w-full text-xs text-muted"
                onClick={(event) => {
                  stop(event);
                  setOpen(false);
                  void props.onPick(null);
                }}
              >
                {t('routing.keyChip.clear')}
              </button>
            </li>
          ) : null}
          {props.keys.map((key) => {
            const isUsedElsewhere = usedLabels.has(key.label.toLowerCase());
            const isSelected = props.currentLabel
              ? props.currentLabel.toLowerCase() === key.label.toLowerCase()
              : displayLabel.toLowerCase() === key.label.toLowerCase();
            const shouldPick = (props.currentLabel ?? '').toLowerCase() !== key.label.toLowerCase();
            return (
              <li key={key.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={props.disabled || isUsedElsewhere}
                  className={cx(
                    'menu-item w-full text-xs',
                    isSelected && 'is-active',
                    isUsedElsewhere && 'cursor-not-allowed opacity-40',
                  )}
                  onClick={(event) => {
                    stop(event);
                    setOpen(false);
                    if (shouldPick) void props.onPick(key.label);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'size-1.5 shrink-0 rounded-full bg-current',
                      !isSelected && 'invisible',
                    )}
                  />
                  {key.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </span>
  );
}
