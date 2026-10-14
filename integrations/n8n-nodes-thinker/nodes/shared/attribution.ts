export const THINKER_ATTRIBUTION_HEADERS = {
	'User-Agent': 'n8n-nodes-thinker',
	'X-Title': 'n8n',
	'HTTP-Referer': 'https://n8n.io',
} as const;

/** Every Thinker agent API key starts with this prefix. */
export const THINKER_KEY_PREFIX = 'thk_';

/**
 * Returns an error message when the credential's API key is not a Thinker
 * agent key, or undefined when it looks valid. Checked before any request so a
 * key pasted from another provider never leaves n8n.
 */
export function invalidThinkerApiKey(apiKey: unknown): string | undefined {
	const key = typeof apiKey === 'string' ? apiKey.trim() : '';
	if (key.startsWith(THINKER_KEY_PREFIX)) return undefined;
	return `The Thinker API credential needs a Thinker agent API key starting with ${THINKER_KEY_PREFIX}. Create one in the Thinker dashboard or with "thinker agent create".`;
}
