import type { ChainItem, ProfileLineInput, ProxyProfile } from '../../services/api/proxies.js';

/** Line rules shared by the outbound profile editor (mirrors the backend). */

export const DIRECT = 'direct';
/** At most 6 lines; a balanced line holds any number of proxies. */
export const MAX_LINES = 6;

export type ChainError =
  'firstNotProxy' | 'tooLong' | 'duplicateProxy' | 'duplicateDirect' | 'emptyLine';

export function isBalanced(mode: ProfileLineInput['mode']): boolean {
  return mode === 'affinity' || mode === 'request';
}

export function newLine(mode: ProfileLineInput['mode'], proxies: string[] = []): ProfileLineInput {
  return { mode, proxies, on_failure: 'next_member', no_session: 'request' };
}

/**
 * Validates profile lines. An empty list is valid (the caller decides).
 * Returns the first broken rule, or null.
 */
export function validateLines(lines: ProfileLineInput[]): ChainError | null {
  if (lines.length === 0) return null;
  if (lines[0]!.mode === 'direct') return 'firstNotProxy';
  if (lines.length > MAX_LINES) return 'tooLong';
  if (lines.filter((l) => l.mode === 'direct').length > 1) return 'duplicateDirect';
  if (lines.some((l) => l.mode !== 'direct' && l.proxies.length === 0)) return 'emptyLine';
  const proxies = lines.flatMap((l) => (l.mode === 'direct' ? [] : l.proxies));
  if (new Set(proxies).size !== proxies.length) return 'duplicateProxy';
  return null;
}

/** Editor lines of a stored profile (older payloads without `lines`: one line per item). */
export function profileLines(profile: ProxyProfile): ProfileLineInput[] {
  if (profile.lines) {
    return profile.lines.map((l) => ({
      mode: l.mode,
      proxies: l.mode === 'direct' ? [] : l.members.map((m) => m.proxy_id ?? ''),
      on_failure: l.on_failure,
      no_session: l.no_session,
    }));
  }
  return profile.chain.map((item) =>
    item.kind === 'direct' ? newLine('direct') : newLine('proxy', [item.proxy_id ?? '']),
  );
}

/** Flattened chain items grouped by line, in order. */
export function groupChain(chain: ChainItem[]): ChainItem[][] {
  const groups: ChainItem[][] = [];
  let current: number | undefined;
  chain.forEach((item, i) => {
    const line = item.line ?? i + 1;
    if (line !== current || groups.length === 0) {
      groups.push([]);
      current = line;
    }
    groups[groups.length - 1]!.push(item);
  });
  return groups;
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
