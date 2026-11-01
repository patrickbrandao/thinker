/** Chain rules shared by the outbound proxy editor (mirrors the backend). */

export const DIRECT = 'direct';
/** First proxy plus up to 5 fallback items. */
export const MAX_CHAIN = 6;

export type ChainError = 'firstNotProxy' | 'tooLong' | 'duplicateProxy' | 'duplicateDirect';

/**
 * Validates a chain of proxy ids and 'direct'. An empty chain is valid (it
 * removes the binding). Returns the first broken rule, or null.
 */
export function validateChain(chain: string[]): ChainError | null {
  if (chain.length === 0) return null;
  if (chain[0] === DIRECT) return 'firstNotProxy';
  if (chain.length > MAX_CHAIN) return 'tooLong';
  if (chain.filter((x) => x === DIRECT).length > 1) return 'duplicateDirect';
  const proxies = chain.filter((x) => x !== DIRECT);
  if (new Set(proxies).size !== proxies.length) return 'duplicateProxy';
  return null;
}

/** Moves the item at `from` by `delta` positions, clamped to the list. */
export function moveItem<T>(list: T[], from: number, delta: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
