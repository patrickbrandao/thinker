import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Filter } from 'lucide-react';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

interface FilterSelectProps {
  /** Plural noun for the trigger label, e.g. "providers" or "harnesses". */
  noun: string;
  /** All selectable item keys, in display order. */
  items: string[];
  /** Effective selected set (empty set semantics are the caller's business). */
  selected: Set<string>;
  /** Swatch color per item key. */
  colorMap: Record<string, string>;
  /** Optional display name resolver; defaults to the raw item key. */
  displayName?: (item: string) => string;
  onToggle: (item: string) => void;
  onSelectAll: () => void;
  onUnselectAll: () => void;
}

/**
 * Multi-select dropdown used to filter chart series (providers on the agent
 * Overview / ConnectionDetail, harnesses on the global Overview). Owns its
 * open state and outside-click/Escape dismissal. Each row shows the series
 * swatch and a switch reflecting whether the series is on.
 */
export default function FilterSelect(props: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const selectedCount = props.items.filter((item) => props.selected.has(item)).length;
  const label =
    selectedCount === props.items.length
      ? t('ui.filter.all', { noun: props.noun, count: props.items.length })
      : t('ui.filter.some', {
          selected: selectedCount,
          total: props.items.length,
          noun: props.noun,
        });

  return (
    <div className="filter-select relative" ref={rootRef}>
      <button
        type="button"
        className="filter-select-trigger btn btn-ghost btn-sm"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Filter aria-hidden="true" />
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cx('transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="filter-select-menu menu right-0 top-full mt-1 max-h-80 w-64 overflow-y-auto">
          <div className="flex justify-end px-1 pb-1">
            <button
              type="button"
              className="link-action text-xs disabled:cursor-default disabled:text-faint disabled:no-underline"
              disabled={selectedCount === props.items.length}
              onClick={() => props.onSelectAll()}
            >
              {t('ui.filter.selectAll')}
            </button>
          </div>
          {props.items.map((item) => {
            const isOn = props.selected.has(item);
            return (
              <button
                key={item}
                type="button"
                className="menu-item disabled:cursor-default"
                role="menuitemcheckbox"
                aria-checked={isOn}
                onClick={() => props.onToggle(item)}
                disabled={props.items.length <= 1}
              >
                <span
                  className="filter-select-swatch size-2.5 shrink-0 rounded-sm"
                  style={{ background: props.colorMap[item] }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {props.displayName ? props.displayName(item) : item}
                </span>
                {/* Visual switch; the row itself carries the checked state. */}
                <span
                  className="filter-select-toggle switch pointer-events-none shrink-0"
                  aria-hidden="true"
                  aria-checked={isOn}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
