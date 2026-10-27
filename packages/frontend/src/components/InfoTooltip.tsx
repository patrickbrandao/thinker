import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/index.js';
import { cx } from './ui.js';

interface Pos {
  top: number;
  left: number;
  placement: 'above' | 'below';
}

/** A small "i" icon that shows `text` in a floating bubble on hover, focus or click. */
export default function InfoTooltip({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const iconRef = useRef<HTMLSpanElement>(null);

  const updatePos = () => {
    const icon = iconRef.current;
    if (!icon) return;
    const rect = icon.getBoundingClientRect();
    const placement = rect.top < 72 ? 'below' : 'above';
    const left = Math.min(Math.max(rect.left + rect.width / 2, 16), window.innerWidth - 16);
    setPos({
      top: placement === 'above' ? rect.top - 8 : rect.bottom + 8,
      left,
      placement,
    });
  };

  const show = () => {
    updatePos();
    setExpanded(true);
  };

  const hide = () => setExpanded(false);

  // Hide while the page scrolls: the bubble is fixed and would drift away.
  useEffect(() => {
    if (!expanded) return;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [expanded]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (expanded) hide();
      else show();
    } else if (e.key === 'Escape') {
      hide();
    }
  };

  return (
    <span
      ref={iconRef}
      className={cx(
        'info-tooltip inline-flex cursor-help items-center align-middle text-faint hover:text-dim focus-visible:text-dim',
        expanded && 'is-active text-dim',
      )}
      tabIndex={0}
      role="button"
      aria-label={t('ui.infoAria', { text })}
      aria-expanded={expanded}
      onKeyDown={handleKeyDown}
      onClick={() => (expanded ? hide() : show())}
      onMouseEnter={show}
      onMouseLeave={hide}
      onBlur={hide}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      {expanded && pos
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[80] max-w-xs rounded-control border border-line bg-elev px-2.5 py-1.5 text-xs font-normal leading-snug text-dim shadow-[var(--shadow-float)]"
              style={{
                top: pos.top,
                left: pos.left,
                transform:
                  pos.placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
