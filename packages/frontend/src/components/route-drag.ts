import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AuthType } from '../services/api.js';

/**
 * Pointer-based drag for route chains (model manager). Native HTML5
 * drag-and-drop proved unreliable here (the drop never landed even though the
 * target highlighted), so a drag is tracked with plain pointer events: press,
 * move past a small threshold, release over the registered drop zone.
 */

/** A catalog model being added, or a flow row being moved. */
export type RouteDragPayload =
  | {
      kind: 'route';
      route: { model: string; provider: string; authType: AuthType; keyLabel?: string };
    }
  | { kind: 'flow'; index: number };

export interface RouteDropZone {
  el: HTMLElement;
  /** Pointer Y while it is over the zone, or null when it leaves / the drag ends. */
  onHover: (clientY: number | null, payload: RouteDragPayload) => void;
  onDrop: (payload: RouteDragPayload, clientY: number) => void;
}

const THRESHOLD_PX = 5;
let zone: RouteDropZone | null = null;

/** Registers the drop zone; returns the unregister function. */
export function registerRouteDropZone(z: RouteDropZone): () => void {
  zone = z;
  return () => {
    if (zone === z) zone = null;
  };
}

const insideZone = (x: number, y: number): boolean => {
  if (!zone) return false;
  const r = zone.el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

/**
 * Call from `onPointerDown`. A press that never moves past the threshold stays
 * a plain click; once it does, a label follows the pointer and the click that
 * the release would fire is swallowed.
 */
export function beginRouteDrag(
  event: ReactPointerEvent<HTMLElement>,
  payload: RouteDragPayload,
  label: string,
): void {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let ghost: HTMLDivElement | null = null;
  let hovering = false;

  const place = (x: number, y: number) => {
    if (ghost) ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
  };

  const start = () => {
    ghost = document.createElement('div');
    ghost.className = 'route-drag-ghost badge is-accent';
    ghost.textContent = label;
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      zIndex: '1000',
      pointerEvents: 'none',
      maxWidth: '280px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      boxShadow: '0 4px 14px rgb(0 0 0 / 0.25)',
    });
    document.body.appendChild(ghost);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  };

  const onMove = (e: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD_PX) return;
      start();
    }
    place(e.clientX, e.clientY);
    const over = insideZone(e.clientX, e.clientY);
    if (over) zone?.onHover(e.clientY, payload);
    else if (hovering) zone?.onHover(null, payload);
    hovering = over;
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    if (ghost) {
      ghost.remove();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    zone?.onHover(null, payload);
  };

  const swallowNextClick = () => {
    const stop = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    // A release outside any clickable element fires no click: drop the guard.
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  };

  const onUp = (e: PointerEvent) => {
    const dragged = ghost !== null;
    const target = dragged && insideZone(e.clientX, e.clientY) ? zone : null;
    cleanup();
    if (!dragged) return;
    swallowNextClick();
    target?.onDrop(payload, e.clientY);
  };
  const onCancel = () => cleanup();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}
