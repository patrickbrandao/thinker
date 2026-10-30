/**
 * Console primitives (skill: components.md). Pages build on these and on the
 * classes in styles/base.css and shell.css; colors only from tokens.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, type LinkProps } from 'react-router';
import { X } from 'lucide-react';
import { useFocusTrap } from '../services/use-focus-trap.js';
import { t } from '../i18n/index.js';

/** Joins class names, skipping falsy ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';
type Size = 'sm' | 'md' | 'lg';

function buttonClass(variant: Variant = 'primary', size: Size = 'md', block?: boolean) {
  return cx(
    'btn',
    variant !== 'primary' && `btn-${variant}`,
    size !== 'md' && `btn-${size}`,
    block && 'btn-block',
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  busy?: boolean;
}

export function Button({
  variant,
  size,
  block,
  busy,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClass(variant, size, block), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  block,
  className,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; block?: boolean }) {
  return <Link className={cx(buttonClass(variant, size, block), className)} {...rest} />;
}

export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      className={cx('icon-btn', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('panel', className)}>
      {title || actions ? (
        <div className="panel-head">
          {title ? (
            <h2>
              {icon}
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cx('panel-body', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Label + control + hint. Pass the control as children with className="field". */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="hint" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'info' | 'outline';

export function Badge({
  tone = 'neutral',
  mono,
  children,
  className,
  title,
}: {
  tone?: Tone;
  mono?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cx('badge', tone !== 'neutral' && `is-${tone}`, mono && 'mono', className)}
      title={title}
    >
      {children}
    </span>
  );
}

export function Status({
  tone = 'off',
  pulse,
  children,
}: {
  tone?: 'ok' | 'off' | 'warn' | 'danger';
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx('status', tone !== 'off' && `is-${tone}`, pulse && 'is-pulse')}>
      {children}
    </span>
  );
}

export interface TabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  count?: number;
  icon?: ReactNode;
  to?: string;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  className,
  label,
}: {
  items: TabItem<K>[];
  value: K;
  onChange?: (key: K) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cx('tabs', className)} role="tablist" aria-label={label}>
      {items.map((item) => {
        const content = (
          <>
            {item.icon}
            {item.label}
            {item.count !== undefined ? <span className="count">{item.count}</span> : null}
          </>
        );
        return item.to ? (
          <Link
            key={item.key}
            to={item.to}
            role="tab"
            aria-selected={value === item.key}
            className={cx('tab', value === item.key && 'is-active')}
          >
            {content}
          </Link>
        ) : (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={value === item.key}
            className={cx('tab', value === item.key && 'is-active')}
            onClick={() => onChange?.(item.key)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

/** Closes something when a pointer goes down outside `ref` or Escape is pressed. */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}

/**
 * Dropdown menu. `trigger` receives the props to spread on its button.
 * Placement: `align` right/left, `up` opens above the trigger.
 */
export function Menu({
  trigger,
  children,
  align = 'left',
  up,
  className,
  label,
}: {
  trigger: (props: {
    onClick: () => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
  }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'left' | 'right';
  up?: boolean;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger({
        onClick: () => setOpen((o) => !o),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': id,
      })}
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={cx('menu', className)}
          style={{
            [align === 'right' ? 'right' : 'left']: 0,
            ...(up ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' }),
          }}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[data-menu-close]')) close();
          }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  to,
  onSelect,
  danger,
  active,
  meta,
  href,
}: {
  icon?: ReactNode;
  children: ReactNode;
  to?: string;
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
  active?: boolean;
  meta?: ReactNode;
}) {
  const className = cx('menu-item', danger && 'is-danger', active && 'is-active');
  const content = (
    <>
      {icon}
      <span className="truncate">{children}</span>
      {meta ? <span className="menu-meta">{meta}</span> : null}
    </>
  );
  if (to)
    return (
      <Link to={to} role="menuitem" className={className} data-menu-close onClick={onSelect}>
        {content}
      </Link>
    );
  if (href)
    return (
      <a
        href={href}
        role="menuitem"
        className={className}
        data-menu-close
        target="_blank"
        rel="noopener noreferrer"
      >
        {content}
      </a>
    );
  return (
    <button type="button" role="menuitem" className={className} data-menu-close onClick={onSelect}>
      {content}
    </button>
  );
}

export const MenuSeparator = () => <div className="menu-sep" role="separator" />;
export const MenuHeading = ({ children }: { children: ReactNode }) => (
  <div className="menu-heading">{children}</div>
);

/** Modal dialog in a portal: Escape and the backdrop close it, focus is trapped. */
export function Modal({
  open,
  title,
  onClose,
  wide,
  children,
  label,
}: {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={cx('modal', wide && 'wide')}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        tabIndex={-1}
      >
        {title ? (
          <div className="modal-head">
            <h2>{title}</h2>
            <IconButton label={t('common.close')} onClick={onClose}>
              <X />
            </IconButton>
          </div>
        ) : null}
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A non-modal window: no backdrop, the page behind stays usable and a click
 * outside never closes it. Dragged by its title bar; resized from its corner;
 * closed by its X or Escape. The title bar and `footer` stay put while the
 * body scrolls.
 */
export function FloatingWindow({
  open,
  title,
  onClose,
  footer,
  className,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const rect = ref.current?.getBoundingClientRect();
    if (!d || !rect) return;
    // Keep the title bar on screen so the window can always be grabbed again.
    const x = Math.min(Math.max(event.clientX - d.dx, 0), window.innerWidth - rect.width);
    const y = Math.min(Math.max(event.clientY - d.dy, 0), window.innerHeight - 48);
    setPos({ x, y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return createPortal(
    <div
      ref={ref}
      className={cx('floating-window', className)}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={pos ? { left: pos.x, top: pos.y, transform: 'none' } : undefined}
    >
      <div
        className="modal-head floating-window-head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <h2>{title}</h2>
        <IconButton label={t('common.close')} onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="modal-body floating-window-body">{children}</div>
      {footer ? <div className="floating-window-foot">{footer}</div> : null}
    </div>,
    document.body,
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {description ? <p className="max-w-md text-sm">{description}</p> : null}
      {action}
    </div>
  );
}

export function Skel({ width, height }: { width?: number | string; height?: number | string }) {
  return <span className="skel" style={{ width, height }} aria-hidden="true" />;
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export function Avatar({ name }: { name: string | null | undefined }) {
  const initial = (name ?? '').trim().charAt(0) || '?';
  return (
    <span className="avatar" aria-hidden="true">
      {initial}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}
