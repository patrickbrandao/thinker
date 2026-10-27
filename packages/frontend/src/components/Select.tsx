import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

export interface SelectOption {
  label: string;
  value: string;
  /** Optional icon rendered before the label (e.g. provider logo, platform icon). */
  icon?: ReactNode;
  disabled?: boolean;
  description?: string;
  /** Optional badge rendered after the label (e.g. "PRO" tag). */
  badge?: ReactNode;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  displayValue?: string;
  disabled?: boolean;
  /** Render the dropdown in document.body (inside modals and scroll boxes). */
  portal?: boolean;
  maxDropdownHeight?: number;
  ariaDescribedBy?: string;
}

/** Shared trigger look for Select and MultiSelect: a `.field` with a chevron. */
export const selectTriggerClass =
  'field flex cursor-pointer items-center justify-between gap-2 text-left';

/** Shared option look for Select and MultiSelect rows inside a `.menu`. */
export function selectOptionClass(selected: boolean, disabled?: boolean): string {
  return cx(
    'menu-item h-auto min-h-8 whitespace-normal py-1.5',
    selected && 'is-active',
    disabled && 'cursor-not-allowed opacity-50',
  );
}

export default function Select(props: SelectProps) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const openRef = useRef(open);
  openRef.current = open;

  const updateDropdownPosition = () => {
    const root = ref.current;
    const { portal, maxDropdownHeight } = latest.current;
    if (!portal || !root || typeof window === 'undefined') return;

    const gap = 4;
    const viewportMargin = 8;
    const minHeight = 96;
    const maxHeight = maxDropdownHeight ?? 320;
    const rect = root.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - gap - viewportMargin;
    const availableAbove = rect.top - gap - viewportMargin;
    const opensAbove = availableBelow < minHeight && availableAbove > availableBelow;
    const availableHeight = opensAbove ? availableAbove : availableBelow;
    const constrainedLeft = Math.min(
      Math.max(rect.left, viewportMargin),
      Math.max(viewportMargin, window.innerWidth - rect.width - viewportMargin),
    );

    setDropdownStyle({
      position: 'fixed',
      left: constrainedLeft,
      top: opensAbove ? rect.top - gap : rect.bottom + gap,
      width: rect.width,
      maxHeight: Math.max(minHeight, Math.min(maxHeight, availableHeight)),
      transform: opensAbove ? 'translateY(-100%)' : 'none',
    });
  };

  const openDropdown = () => {
    updateDropdownPosition();
    setOpen(true);
    if (props.portal && typeof window !== 'undefined') {
      window.requestAnimationFrame?.(updateDropdownPosition);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleViewportChange = () => {
      if (openRef.current) updateDropdownPosition();
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
    // Listeners read the latest props through refs, so they register once.
  }, []);

  const selected = props.options.find((o) => o.value === props.value);
  const selectedLabel = selected?.label ?? props.placeholder ?? t('ui.selectPlaceholder');

  const dropdown = (
    <div
      ref={dropdownRef}
      role="listbox"
      className={cx(
        'menu select-menu overflow-y-auto',
        props.portal ? 'is-portal z-[95]' : 'left-0 right-0 top-full mt-1 max-h-80',
      )}
      style={props.portal ? dropdownStyle : undefined}
    >
      {props.options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="option"
          className={selectOptionClass(props.value === opt.value, opt.disabled)}
          onClick={() => {
            if (opt.disabled) return;
            props.onChange(opt.value);
            setOpen(false);
          }}
          disabled={opt.disabled}
          aria-selected={props.value === opt.value}
          aria-disabled={opt.disabled}
        >
          {opt.icon}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{opt.label}</span>
            {opt.description ? <span className="text-xs text-faint">{opt.description}</span> : null}
          </span>
          {opt.badge}
        </button>
      ))}
    </div>
  );

  return (
    <div className="select relative min-w-0" ref={ref}>
      <button
        type="button"
        className={selectTriggerClass}
        onClick={() => {
          if (props.disabled) return;
          if (open) setOpen(false);
          else openDropdown();
        }}
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label ?? selectedLabel}
        aria-describedby={props.ariaDescribedBy}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          {!props.displayValue && selected?.icon ? selected.icon : null}
          {props.displayValue ?? selectedLabel}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cx('size-3.5 shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (props.portal ? createPortal(dropdown, document.body) : dropdown) : null}
    </div>
  );
}
