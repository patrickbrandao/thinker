import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  /** True while a fetch is in flight (also during a refetch with data kept). */
  loading: boolean;
  /** Fetches again with the current inputs. Resolves with the new value. */
  reload: () => Promise<T | undefined>;
  /** Replaces the value locally (optimistic update), like Solid's mutate. */
  setData: (next: T | undefined | ((prev: T | undefined) => T | undefined)) => void;
}

/**
 * The data hook every page uses in place of Solid's createResource. Runs
 * `fetcher` on mount and whenever `deps` change; a response that arrives after
 * the inputs moved on is dropped, so a slow old request never overwrites a
 * newer one. Pass `enabled: false` to wait (e.g. until a name is known).
 * The previous value stays while refetching, so lists do not flash empty.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  options: { enabled?: boolean } = {},
): Resource<T> {
  const enabled = options.enabled !== false;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(enabled);
  const generation = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (): Promise<T | undefined> => {
    const id = ++generation.current;
    setLoading(true);
    try {
      const value = await fetcherRef.current();
      if (id === generation.current) {
        setData(value);
        setError(undefined);
      }
      return value;
    } catch (err) {
      if (id === generation.current) setError(err);
      return undefined;
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      generation.current++;
      setLoading(false);
      return;
    }
    void run();
    // `deps` are the caller's inputs, like useEffect's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { data, error, loading, reload: run, setData };
}
