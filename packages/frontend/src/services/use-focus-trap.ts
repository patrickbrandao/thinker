import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Trap Tab focus inside `container` while `open` is true and restore focus
 * to the previously-focused element on close.
 *
 * `aria-modal="true"` tells screen readers a dialog traps focus, but keyboard
 * users can still Tab their way out without this — so we wrap focus
 * imperatively at the first/last focusable element.
 */
export function useFocusTrap(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  options?: { initialFocus?: () => HTMLElement | null | undefined },
): void {
  const initialFocus = options?.initialFocus;
  useEffect(() => {
    if (!open) return;
    const root = container.current;
    if (!root) return;

    const previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;

    const initial = initialFocus?.();
    if (initial) {
      initial.focus();
    } else {
      const focusables = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) focusables[0]!.focus();
      else if (root.tabIndex >= 0 || root.hasAttribute('tabindex')) root.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const list = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);

    return () => {
      root.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
    // initialFocus is read once per open, like the dialog's first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, container]);
}
