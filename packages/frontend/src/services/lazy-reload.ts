import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_KEY = 'thinker:chunk-reload';

/**
 * Wrap a dynamic import with retry-via-reload. On import failure,
 * sets a sessionStorage flag and reloads the page. The flag prevents
 * infinite reload loops — if the reload itself fails, the error
 * propagates normally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err: unknown) => {
      // With storage blocked there is no loop guard, so skip the reload
      // and surface the import error instead of reloading forever.
      if (!readFlag() && setFlag()) {
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      clearReloadFlag();
      throw err;
    }),
  );
}

function readFlag(): boolean {
  try {
    return !!sessionStorage.getItem(RELOAD_KEY);
  } catch {
    return false;
  }
}

/** Sets the loop guard. Returns false when sessionStorage is unavailable. */
function setFlag(): boolean {
  try {
    sessionStorage.setItem(RELOAD_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears the loop guard. Runs at startup, so it must never throw: a browser
 * with storage blocked would otherwise fail to load the app at all.
 */
export function clearReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* storage disabled */
  }
}
