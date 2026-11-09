import { BadRequestException } from '@nestjs/common';

/**
 * Outbound profile lines. A profile is an ordered list of lines; each line is
 * a single proxy, "Direct", or several proxies balanced by session affinity or
 * per request (tmp/PROXY-BALANCE-SPEC.md).
 */
export const LINE_MODES = ['proxy', 'direct', 'affinity', 'request'] as const;
export type LineMode = (typeof LINE_MODES)[number];
export const ON_FAILURE = ['next_member', 'next_line'] as const;
export type OnFailure = (typeof ON_FAILURE)[number];
export const NO_SESSION = ['request', 'agent', 'first'] as const;
export type NoSession = (typeof NO_SESSION)[number];

export interface ProfileLine {
  mode: LineMode;
  /** Proxy ids in order; empty for Direct, one for a proxy line. */
  proxies: string[];
  on_failure: OnFailure;
  no_session: NoSession;
}

export const MAX_PROFILE_LINES = 6;

function bad(message: string): never {
  throw new BadRequestException([message]);
}

const DEFAULTS = { on_failure: 'next_member', no_session: 'request' } as const;

export function directLine(): ProfileLine {
  return { mode: 'direct', proxies: [], ...DEFAULTS };
}

export function isBalanced(mode: LineMode): mode is 'affinity' | 'request' {
  return mode === 'affinity' || mode === 'request';
}

/** Legacy `chain` input ([proxyId | "direct", ...]): one line per item. */
export function linesFromChain(chain: unknown): unknown[] {
  if (!Array.isArray(chain)) bad('chain must be an array');
  return chain.map((item) =>
    item === 'direct' || item === null ? { mode: 'direct' } : { mode: 'proxy', proxies: [item] },
  );
}

function pickOne<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback: T,
): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    bad(`${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

/**
 * Validates profile lines: at most 6 lines, the first is not Direct, Direct at
 * most once, every proxy known and used once in the whole profile. A balanced
 * line with a single proxy becomes a proxy line.
 */
export function validateLines(input: unknown, known: Set<string>): ProfileLine[] {
  if (!Array.isArray(input)) bad('lines must be an array');
  if (input.length > MAX_PROFILE_LINES) bad(`A profile has at most ${MAX_PROFILE_LINES} lines`);
  const seen = new Set<string>();
  let direct = false;
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object') bad('Each line must be an object');
    const item = raw as Record<string, unknown>;
    const mode = pickOne(item.mode, LINE_MODES, 'mode', 'proxy');
    if (mode === 'direct') {
      if (index === 0) bad('The first line of a profile must use a proxy');
      if (direct) bad('"Direct" can appear only once');
      direct = true;
      return directLine();
    }
    const proxies = item.proxies ?? [];
    if (!Array.isArray(proxies)) bad('proxies must be an array');
    if (proxies.length === 0) bad('A proxy line needs at least one proxy server');
    if (mode === 'proxy' && proxies.length > 1) {
      bad('A proxy line has one proxy server; use a balanced line for more');
    }
    for (const id of proxies) {
      if (typeof id !== 'string' || !known.has(id)) bad(`Unknown proxy ${String(id)}`);
      if (seen.has(id)) bad('A proxy can appear only once in a profile');
      seen.add(id);
    }
    const balanced = isBalanced(mode) && proxies.length > 1;
    return {
      mode: balanced ? mode : 'proxy',
      proxies: [...(proxies as string[])],
      on_failure: balanced
        ? pickOne(item.on_failure, ON_FAILURE, 'on_failure', DEFAULTS.on_failure)
        : DEFAULTS.on_failure,
      no_session:
        balanced && mode === 'affinity'
          ? pickOne(item.no_session, NO_SESSION, 'no_session', DEFAULTS.no_session)
          : DEFAULTS.no_session,
    };
  });
}

/**
 * Removes or replaces one proxy in a profile's lines. Returns null when no
 * proxy is left. A balanced line left with one proxy becomes a proxy line, an
 * empty line goes, and a leading Direct moves behind the next proxy line.
 */
export function rewriteLines(
  lines: ProfileLine[],
  proxyId: string,
  replacement: string | null,
): ProfileLine[] | null {
  const used = new Set(lines.flatMap((l) => l.proxies));
  const out: ProfileLine[] = [];
  for (const line of lines) {
    if (line.mode === 'direct') {
      out.push(line);
      continue;
    }
    const proxies: string[] = [];
    for (const id of line.proxies) {
      if (id !== proxyId) {
        proxies.push(id);
        continue;
      }
      if (replacement && !used.has(replacement)) {
        proxies.push(replacement);
        used.add(replacement);
      }
    }
    if (proxies.length === 0) continue;
    out.push({ ...line, proxies, mode: proxies.length === 1 ? 'proxy' : line.mode });
  }
  if (!out.some((l) => l.mode !== 'direct')) return null;
  if (out[0]!.mode === 'direct') {
    const next = out.findIndex((l) => l.mode !== 'direct');
    const [line] = out.splice(next, 1);
    out.splice(0, 1, line!, directLine());
  }
  return out;
}

/** Rows of a profile: lines in order, then items in order (null = Direct). */
export function groupLines(
  rows: Array<{
    line: number | null;
    position: number;
    proxy_id: string | null;
    mode?: string | null;
    on_failure?: string | null;
    no_session?: string | null;
  }>,
): ProfileLine[] {
  const byLine = new Map<number, ProfileLine>();
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    const key = row.line ?? row.position;
    let line = byLine.get(key);
    if (!line) {
      const mode = (LINE_MODES as readonly string[]).includes(row.mode ?? '')
        ? (row.mode as LineMode)
        : row.proxy_id === null
          ? 'direct'
          : 'proxy';
      line = {
        mode,
        proxies: [],
        on_failure: (row.on_failure as OnFailure) ?? DEFAULTS.on_failure,
        no_session: (row.no_session as NoSession) ?? DEFAULTS.no_session,
      };
      byLine.set(key, line);
    }
    if (row.proxy_id !== null) line.proxies.push(row.proxy_id);
  }
  return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line);
}
