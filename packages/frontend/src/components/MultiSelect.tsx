import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';
import { selectOptionClass, selectTriggerClass } from './Select.js';

export interface MultiSelectOption {
  label: string;
  value: string;
  /** Optional icon rendered before the label (e.g. provider logo). */
  icon?: ReactNode;
  description?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  /** Selected values. Empty means "no filter" (everything). */
  values: string[];
  onChange: (values: string[]) => void;
  /** Trigger text when nothing is selected (the "All …" reading). */
  placeholder: string;
  label?: string;
}

/**
 * A Select-styled dropdown whose options toggle instead of replacing each
 * other. The dropdown stays open across clicks so several options can be
 * picked in one visit; the trigger summarizes the selection (placeholder,
 * the single label, or "N selected").
 */
export default function MultiSelect(props: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isSelected = (value: string) => props.values.includes(value);
  const toggle = (value: string) => {
    props.onChange(
      isSelected(value) ? props.values.filter((v) => v !== value) : [...props.values, value],
    );
  };

  let triggerLabel: string;
  if (props.values.length === 0) triggerLabel = props.placeholder;
  else if (props.values.length === 1) {
    const opt = props.options.find((o) => o.value === props.values[0]);
    triggerLabel = opt?.label ?? props.placeholder;
  } else triggerLabel = t('ui.selectedCount', { count: props.values.length });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const root = ref.current;
      if (!root) return;
      // Asked AFTER the option's own handler has run. When a caller derives its
      // options from the selection — the Requests log's model filter does, so a
      // picked model stays listed even if it leaves the range window — toggling
      // rebuilds the option nodes, and `contains` on the clicked-and-replaced
      // node would call it "outside" and shut the menu after one pick.
      // composedPath() is the path captured when the event was dispatched, so it
      // still names this dropdown for a replaced option, and still does NOT name
      // it for an outside element that removed itself.
      const path = e.composedPath();
      const inside = path.length > 0 ? path.includes(root) : root.contains(e.target as Node);
      if (!inside) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const checkbox = (checked: boolean) => (
    <input
      type="checkbox"
      checked={checked}
      readOnly
      tabIndex={-1}
      aria-hidden="true"
      className="pointer-events-none mt-0.5 shrink-0 accent-[var(--accent)]"
    />
  );

  return (
    <div className="select relative min-w-0" ref={ref}>
      <button
        type="button"
        className={selectTriggerClass}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label ?? triggerLabel}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          aria-hidden="true"
          className={cx('size-3.5 shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div
          className="menu select-menu left-0 top-full mt-1 max-h-80 w-max min-w-full max-w-[min(360px,90vw)] overflow-y-auto"
          role="listbox"
          aria-multiselectable="true"
        >
          <button
            type="button"
            role="option"
            className={cx(selectOptionClass(props.values.length === 0), 'items-start')}
            aria-selected={props.values.length === 0}
            onClick={() => props.onChange([])}
          >
            {checkbox(props.values.length === 0)}
            <span>{props.placeholder}</span>
          </button>
          {props.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              className={cx(selectOptionClass(isSelected(opt.value)), 'items-start')}
              onClick={() => toggle(opt.value)}
              aria-selected={isSelected(opt.value)}
            >
              {checkbox(isSelected(opt.value))}
              {opt.icon}
              <span className="flex min-w-0 flex-col">
                <span>{opt.label}</span>
                {opt.description ? (
                  <span className="text-xs text-faint">{opt.description}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
