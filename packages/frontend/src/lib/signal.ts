import { useSyncExternalStore } from 'react';

/**
 * A tiny global store: call it to read, `.set` to write, `useSignal` to
 * re-render a component when it changes. Module-level state (session, toasts,
 * SSE pings, locale) lives in these so plain TypeScript and React share it.
 */
export interface Signal<T> {
  (): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const read = (() => value) as Signal<T>;
  read.set = (next) => {
    const resolved = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
    if (Object.is(resolved, value)) return;
    value = resolved;
    for (const listener of [...listeners]) listener();
  };
  read.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return read;
}

/** Subscribes the component to a signal and returns its current value. */
export function useSignal<T>(source: Signal<T>): T {
  return useSyncExternalStore(source.subscribe, source, source);
}
