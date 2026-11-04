/** The label prefix for a provider's connections: its id (`custom` for custom providers). */
function connectionLabelPrefix(providerId: string): string {
  return providerId.startsWith('custom:') ? 'custom' : providerId.toLowerCase();
}

/**
 * The next connection name for a provider: `<provider>-N` with the lowest N not
 * taken among `existing` (case-insensitive), so a removed `anthropic-1` is
 * suggested again before `anthropic-3`.
 */
export function suggestNextProviderKeyLabel(existing: string[], providerId: string): string {
  const prefix = connectionLabelPrefix(providerId);
  const taken = new Set(existing.map((label) => label.toLowerCase()));
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
