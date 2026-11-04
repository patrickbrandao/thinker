/**
 * How a stored key is shown: the server-side mask (at least half hidden), or
 * dots when the server sent none. Never builds a mask from `key_prefix`.
 */
export function maskedKeyLabel(row: { key_masked?: string | null } | undefined | null): string {
  return row?.key_masked || '••••••••••••';
}
