import { useEffect, useRef, useState } from 'react';
import RequestDrawer from './RequestDrawer.js';

interface DrawerWindow {
  key: number;
  messageId: string;
  pinned: boolean;
  /** Opened while other windows were open: starts floating, cascaded. */
  floating: boolean;
  cascade: number;
}

export interface RequestDrawerStackProps {
  /** The request picked in the page; drives the one unpinned window. */
  messageId: string | null;
  /** Called when the unpinned window closes, so the page clears its selection. */
  onClose: () => void;
}

const BASE_Z = 65;

/**
 * Request windows with pinning. The unpinned window follows the page's
 * selection; a pinned window keeps its request, and the next selection opens
 * a new (unpinned) window next to it. Each window closes on its own.
 */
export default function RequestDrawerStack({ messageId, onClose }: RequestDrawerStackProps) {
  const [windows, setWindows] = useState<DrawerWindow[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const nextKey = useRef(1);

  // Route each new selection to the unpinned window, or open one.
  useEffect(() => {
    if (!messageId) {
      setWindows((prev) => prev.filter((w) => w.pinned));
      return;
    }
    setWindows((prev) => {
      const free = prev.find((w) => !w.pinned);
      if (free) {
        return free.messageId === messageId
          ? prev
          : prev.map((w) => (w === free ? { ...w, messageId } : w));
      }
      const key = nextKey.current++;
      setOrder((o) => [...o.filter((k) => k !== key), key]);
      return [
        ...prev,
        {
          key,
          messageId,
          pinned: false,
          floating: prev.length > 0,
          cascade: prev.length,
        },
      ];
    });
  }, [messageId]);

  const raise = (key: number) =>
    setOrder((o) => (o[o.length - 1] === key ? o : [...o.filter((k) => k !== key), key]));

  const close = (win: DrawerWindow) => {
    setWindows((prev) => prev.filter((w) => w.key !== win.key));
    setOrder((o) => o.filter((k) => k !== win.key));
    if (!win.pinned) onClose();
  };

  const togglePin = (win: DrawerWindow) => {
    if (win.pinned) {
      // Unpinning: this window takes over the selection; drop any other free one.
      setWindows((prev) =>
        prev
          .filter((w) => w.pinned || w.key === win.key)
          .map((w) => (w.key === win.key ? { ...w, pinned: false } : w)),
      );
    } else {
      setWindows((prev) => prev.map((w) => (w.key === win.key ? { ...w, pinned: true } : w)));
      // The page's selection now belongs to no window: the next click opens a new one.
      onClose();
    }
  };

  return (
    <>
      {windows.map((win) => (
        <RequestDrawer
          key={win.key}
          messageId={win.messageId}
          pinned={win.pinned}
          onTogglePin={() => togglePin(win)}
          startFloating={win.floating}
          cascade={win.cascade}
          zIndex={BASE_Z + Math.max(0, order.indexOf(win.key))}
          onActivate={() => raise(win.key)}
          onClose={() => close(win)}
        />
      ))}
    </>
  );
}
