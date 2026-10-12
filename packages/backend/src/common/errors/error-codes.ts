import { THINKER_ERRORS_DOCS_BASE, manifestErrorDocsUrl } from 'thinker-shared';

export { THINKER_ERRORS_DOCS_BASE };

const PEACOCK = '🦚';

export const THINKER_ERRORS = {
  M001: {
    title: 'Missing Authorization header',
    template:
      'Missing the Authorization header. Send your key as "Authorization: Bearer thk_<your-key>" or "x-api-key: thk_<your-key>".',
  },
  M002: {
    title: 'Empty Bearer token',
    template: 'The Bearer token is empty. Paste your Manifest key into it.',
  },
  M003: {
    title: 'Invalid key format',
    template:
      'That doesn\'t look right. Thinker keys start with "thk_". Grab yours from the dashboard.',
  },
  M004: {
    title: 'Key expired',
    template: 'This key has expired. Generate a new one here',
  },
  M005: {
    title: 'Key not recognized',
    template:
      "I don't recognize this key. It might have been rotated or deleted. Grab the current one from the dashboard.",
  },
  M006: {
    title: 'Conflicting API keys',
    template:
      'The Authorization and x-api-key headers carry different credentials. Send your key in only one of them, or the same key in both.',
  },
  M100: {
    title: 'Provider API key missing',
    template: 'No {provider} API key yet. Add one here: {dashboardUrl}',
  },
  M101: {
    title: 'No model to route to',
    template:
      'This harness has no model to route to yet. Pick a default model here: {dashboardUrl}',
  },
  M102: {
    title: 'Provider subscription credentials unusable',
    template:
      '{provider} subscription credentials could not be refreshed. Reconnect OAuth here: {dashboardUrl}',
  },
  M200: {
    title: 'Usage limit exceeded',
    template:
      'You hit your {metric} limit: {used} used, {threshold}/{period} allowed. Adjust it here: {dashboardUrl}',
  },
  M201: {
    title: 'Per-user rate limit exceeded',
    template: 'Too many requests — wait a few seconds and retry.',
  },
  M202: {
    title: 'Per-IP rate limit exceeded',
    template: 'Too many requests from this IP — wait a few seconds and retry.',
  },
  M203: {
    title: 'Concurrency limit exceeded',
    template: 'Too many concurrent requests. Give it a moment.',
  },
  M300: {
    title: 'Missing messages array',
    template: '`messages` array is required.',
  },
  M302: {
    title: 'Model not available',
    template:
      'Model "{model}" is not available for this agent. Use GET /v1/models to list available model IDs, or make the provider available for this agent here: {dashboardUrl}',
  },
  M500: {
    title: 'Internal server error',
    template: 'Something broke on our end. Try again in a moment.',
  },
} as const;

export type ManifestErrorCode = keyof typeof THINKER_ERRORS;

// Matches the peacock prefix written by formatManifestError, e.g. `[🦚 Manifest M102]`.
// The 🦚 is REQUIRED: only Manifest emits it, so a provider error body that merely
// echoes the text "Manifest M100" can never be mis-extracted into a Manifest code
// (which would then misclassify a provider round-trip as a Manifest config error).
const THINKER_ERROR_CODE_RE = /\[\s*🦚\s*Manifest\s+(M\d{3})\s*\]/;

export function formatManifestError(
  code: ManifestErrorCode,
  vars: Record<string, string | number> = {},
): string {
  const entry = THINKER_ERRORS[code];
  const interpolated = entry.template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
  return `[${PEACOCK} Manifest ${code}] ${interpolated} See ${manifestErrorDocsUrl(code)}`;
}

/**
 * Pull a registered Manifest error code out of a rendered message or JSON body
 * that embeds one (provider-attempt rows store the peacock text in
 * error_message but need error_code for filters/analytics).
 */
export function extractManifestErrorCode(
  text: string | null | undefined,
): ManifestErrorCode | null {
  if (!text) return null;
  const match = text.match(THINKER_ERROR_CODE_RE);
  if (!match) return null;
  const code = match[1] as ManifestErrorCode;
  return code in THINKER_ERRORS ? code : null;
}
