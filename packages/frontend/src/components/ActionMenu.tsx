import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Optional leading icon rendered before the label. */
  icon?: ReactNode;
}

interface ActionMenuProps {
  items: MenuItem[];
  /** Accessible label for the trigger button. Defaults to "Actions". */
  ariaLabel?: string;
  /** Extra class applied to the root wrapper (e.g. for per-surface positioning). */
  class?: string;
  className?: string;
}

/**
 * Generic kebab ("⋮") action menu: a trigger button that toggles a dropdown of
 * caller-supplied items. Closes on outside click or Escape. Reusable across
 * cards and detail views so each surface doesn't re-implement the popover
 * wiring. An `action-menu--open` modifier is reflected on the root so surfaces
 * can keep the trigger visible while the menu is open (e.g. hover-revealed
 * card kebabs). The `action-menu*` classes are stable hooks; the look comes
 * from `.icon-btn`, `.menu` and `.menu-item`.
 *
 * A11y: the dropdown is intentionally a plain list of buttons — it does NOT use
 * `role="menu"` / `role="menuitem"` (nor `aria-haspopup="menu"`), because those
 * roles promise full menu keyboard semantics (arrow-key roving focus, focus
 * management) that this component does not implement. Claiming them would
 * mislead assistive tech. The trigger keeps `aria-label` + `aria-expanded`,
 * which honestly describes a disclosure that toggles a group of buttons.
 */
export default function ActionMenu(props: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen on the document only while the menu is open. Cards render one menu
  // each, so always-on listeners would scale with the grid; gating keeps it to
  // at most the open menu's pair.
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={cx(
        'action-menu relative inline-flex',
        open && 'action-menu--open',
        props.class,
        props.className,
      )}
    >
      <button
        type="button"
        className="action-menu__trigger icon-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-label={props.ariaLabel ?? t('common.actions')}
        aria-expanded={open}
      >
        <MoreVertical aria-hidden="true" />
      </button>
      {open ? (
        <div className="action-menu__dropdown menu right-0 top-full mt-1">
          {props.items.map((item, i) => (
            <button
              key={`${i}-${item.label}`}
              type="button"
              className={cx(
                'action-menu__item menu-item',
                item.danger && 'action-menu__item--danger is-danger',
              )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
