import { useState, type KeyboardEvent } from 'react';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

export interface HeaderSuggestion {
  label: string;
  sublabel?: string;
  group?: string;
  value: string;
}

interface Props {
  id?: string;
  value: string;
  onInput: (v: string) => void;
  suggestions: HeaderSuggestion[];
  placeholder?: string;
  invalid?: boolean;
  errorMessage?: string;
  disabled?: boolean;
  freeFormHint?: string;
}

/**
 * Text input with a filtered suggestion list for header names. The
 * `header-combo*` classes are stable test hooks; the look comes from `.field`
 * and `.menu`.
 */
export default function HeaderComboBox(props: Props) {
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(-1);

  const q = props.value.trim().toLowerCase();
  const filtered = q
    ? props.suggestions.filter(
        (s) => s.value.toLowerCase().includes(q) || s.label.toLowerCase().includes(q),
      )
    : props.suggestions;

  const showFreeForm =
    props.value.trim() !== '' &&
    !props.suggestions.some((s) => s.value.toLowerCase() === props.value.trim().toLowerCase());

  const select = (val: string): void => {
    props.onInput(val);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHoverIdx(Math.min(hoverIdx + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHoverIdx(Math.max(hoverIdx - 1, -1));
    } else if (e.key === 'Enter' && hoverIdx >= 0) {
      e.preventDefault();
      const pick = filtered[hoverIdx];
      if (pick) select(pick.value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={cx('header-combo relative', props.invalid && 'header-combo--invalid')}>
      <input
        id={props.id}
        className={cx('header-combo__input field font-mono', props.invalid && 'border-danger')}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={props.invalid || undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          props.onInput(e.currentTarget.value);
          setOpen(true);
          setHoverIdx(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (filtered.length > 0 || showFreeForm) ? (
        <ul
          className="header-combo__menu menu left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto"
          role="listbox"
        >
          {filtered.map((item, idx) => (
            <li
              key={item.value}
              role="option"
              aria-selected={hoverIdx === idx}
              className={cx(
                'header-combo__option menu-item h-auto min-h-8 flex-col items-stretch gap-0.5 py-1.5',
                hoverIdx === idx && 'header-combo__option--hover is-active',
              )}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(item.value);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-ink">{item.label}</span>
                {item.group ? (
                  <span className="shrink-0 text-xs text-faint">{item.group}</span>
                ) : null}
              </div>
              {item.sublabel ? <div className="text-xs text-muted">{item.sublabel}</div> : null}
            </li>
          ))}
          {showFreeForm ? (
            <li
              className="header-combo__option header-combo__option--free menu-item h-auto min-h-8 py-1.5 text-muted"
              onMouseDown={(e) => {
                e.preventDefault();
                select(props.value.trim());
              }}
            >
              {props.freeFormHint ?? t('ui.customEntry', { value: props.value.trim() })}
            </li>
          ) : null}
        </ul>
      ) : null}
      {props.invalid && props.errorMessage ? (
        <div className="header-combo__error hint text-danger" role="alert">
          {props.errorMessage}
        </div>
      ) : null}
    </div>
  );
}
