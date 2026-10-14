import { mergeAnthropicBeta } from './anthropic-beta';

const ANTHROPIC_BETA = 'anthropic-beta';

/**
 * Fold caller-supplied extra headers (Playground request headers, provider-side
 * session hints) into the headers an adapter built for a provider request.
 *
 * The adapter always wins. A header name the adapter already sets is compared
 * case-insensitively, and the caller's copy is dropped, in any casing. Simply
 * spreading the adapter headers last is not enough: `{Authorization: a,
 * authorization: b}` keeps both keys and fetch comma-merges them into one
 * `Authorization: a, b` on the wire. Dropping the caller's copy means a header
 * the Playground blocklist forgot (a new adapter's credential, say) can still
 * not be replaced or duplicated.
 *
 * `anthropic-beta` is the one exception: the caller's flags are appended to the
 * adapter's through `mergeAnthropicBeta`, the same path proxy traffic uses, so
 * the flags a route depends on (the OAuth pair on a Claude subscription) stay
 * first and the caller's flags are sanitized.
 *
 * Among the caller's own headers the first spelling of a name wins, and it is
 * emitted under its trimmed name (the name it was compared by). Returns
 * `adapterHeaders` itself when there is nothing to add, so the common proxy
 * forward (no extra headers) allocates nothing.
 */
export function mergeExtraHeaders(
  adapterHeaders: Record<string, string>,
  extraHeaders: Record<string, string> | undefined,
): Record<string, string> {
  if (!extraHeaders) return adapterHeaders;
  const extraKeys = Object.keys(extraHeaders);
  if (extraKeys.length === 0) return adapterHeaders;

  const adapterKeyByName = new Map<string, string>();
  for (const key of Object.keys(adapterHeaders)) {
    adapterKeyByName.set(key.trim().toLowerCase(), key);
  }

  const merged: Record<string, string> = { ...adapterHeaders };
  const seen = new Set<string>();
  for (const key of extraKeys) {
    const name = key.trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const adapterKey = adapterKeyByName.get(name);
    if (name === ANTHROPIC_BETA) {
      const flags = mergeAnthropicBeta(
        adapterKey === undefined ? undefined : adapterHeaders[adapterKey],
        extraHeaders[key],
      );
      if (flags !== undefined) merged[adapterKey ?? ANTHROPIC_BETA] = flags;
      continue;
    }
    if (adapterKey !== undefined) continue;
    merged[key.trim()] = extraHeaders[key];
  }
  return merged;
}
