/**
 * Light client-side checks for IP prefix list entries. The server is the
 * authority (it normalizes single addresses to /32 or /128 and names any bad
 * entry); this only catches typos before a round trip.
 */

function isIpv4(s: string): boolean {
  const parts = s.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && (p === '0' || !p.startsWith('0')))
  );
}

function isIpv6(s: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return false;
  if ((s.startsWith(':') && !s.startsWith('::')) || (s.endsWith(':') && !s.endsWith('::')))
    return false;
  const doubles = s.split('::').length - 1;
  if (doubles > 1) return false;
  let groups = s.split(':');
  // An embedded IPv4 tail (::ffff:192.0.2.1) counts as two groups.
  const last = groups[groups.length - 1] ?? '';
  let tail = 0;
  if (last.includes('.')) {
    if (!isIpv4(last)) return false;
    groups = groups.slice(0, -1);
    tail = 2;
  }
  if (doubles === 1) {
    const [head = '', rest = ''] = s.split('::');
    const count = (part: string) => (part ? part.split(':').length : 0);
    const restGroups = rest.includes('.') ? count(rest) - 1 : count(rest);
    const used = count(head) + restGroups + tail;
    if (used > 7) return false;
    const named = groups.filter((g) => g !== '');
    return named.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
  }
  return groups.length + tail === 8 && groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
}

/** True for an IPv4/IPv6 address or CIDR prefix (203.0.113.0/24, 2001:db8::/48). */
export function isValidPrefix(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  const [addr = '', len, extra] = s.split('/');
  if (extra !== undefined) return false;
  const v4 = isIpv4(addr);
  const v6 = !v4 && isIpv6(addr);
  if (!v4 && !v6) return false;
  if (len === undefined) return true;
  if (!/^\d{1,3}$/.test(len)) return false;
  return Number(len) <= (v4 ? 32 : 128);
}

export interface ParsedLine {
  line: number;
  prefix: string;
  label: string | null;
  valid: boolean;
}

/**
 * Parses pasted text: one prefix per line, an optional label after a space
 * or `#`. Blank lines and lines that start with `#` are skipped.
 */
export function parsePrefixLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^([^\s#]+)\s*(?:#\s*)?(.*)$/.exec(line);
    const prefix = m?.[1] ?? line;
    const label = (m?.[2] ?? '').trim() || null;
    out.push({ line: i + 1, prefix, label, valid: isValidPrefix(prefix) });
  });
  return out;
}

/** The text form of entries, one per line, for the paste editor. */
export function formatPrefixLines(
  entries: Array<{ prefix: string; label: string | null }>,
): string {
  return entries.map((e) => (e.label ? `${e.prefix} ${e.label}` : e.prefix)).join('\n');
}
