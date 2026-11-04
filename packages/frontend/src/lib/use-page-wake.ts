import { useEffect, useRef } from 'react';

/**
 * Calls `onWake` while `enabled` whenever the page comes back to the
 * foreground (visible again, or its window focused). A hidden or covered page
 * gets its timers throttled to about once a minute, so a poll waiting on a
 * sign-in finished in another window uses this to catch up at once.
 */
export function usePageWake(enabled: boolean, onWake: () => void): void {
  const latest = useRef(onWake);
  latest.current = onWake;
  useEffect(() => {
    if (!enabled) return;
    const wake = () => {
      if (document.visibilityState === 'visible') latest.current();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [enabled]);
}
