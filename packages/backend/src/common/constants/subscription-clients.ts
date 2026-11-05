/**
 * Client identification strings sent to subscription backends that gate model
 * lists or requests by client version. Lifted into one place so bumping a
 * version when an upstream releases a new model is a single edit.
 *
 * Codex (`https://chatgpt.com/backend-api/codex/...`): the `client_version`
 * URL param is enforced — older versions silently receive an older model
 * subset. Bump `CODEX_CLI_VERSION` to track the current `openai/codex` CLI
 * release. The user-agent string is not enforced, so it stays synthetic.
 *
 * Copilot (`https://api.githubcopilot.com/...`): GitHub validates the
 * `Editor-Version` and `Editor-Plugin-Version` headers; both are bumped
 * together when GitHub deprecates an older pair.
 *
 * OpenCode (`https://opencode.ai/inference/...`): the free models answer only
 * the OpenCode client, recognized by its user agent and `x-opencode-*`
 * headers, so every OpenCode request carries them (ADR 0009). Bump
 * `OPENCODE_CLIENT_VERSION` to track the `anomalyco/opencode` release.
 */

export const CODEX_CLI_VERSION = '0.166.0';
export const CODEX_CLI_ORIGINATOR = 'codex_cli_rs';
export const CODEX_CLI_USER_AGENT = 'codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown';

export const OPENCODE_CLIENT_VERSION = '2.2.5';
export const OPENCODE_CLIENT_NAME = 'cli';
export const OPENCODE_USER_AGENT = `opencode/latest/${OPENCODE_CLIENT_VERSION}/${OPENCODE_CLIENT_NAME}`;
/** The key OpenCode sends when it has none: unlocks only the free models. */
export const OPENCODE_FREE_KEY = 'public';

/** Whether `apiKey` is a provider's shared free key rather than an account's own. */
export function isSharedFreeKey(provider: string, apiKey: string): boolean {
  return provider.toLowerCase() === 'opencode' && apiKey === OPENCODE_FREE_KEY;
}

/**
 * Grok Build (`xai-org/grok-build`): the subscription token is accepted only
 * by `cli-chat-proxy.grok.com` with the CLI's own headers (sub-xai G1). The
 * maintainer chose to follow the official client and warn in the UI.
 */
export const GROK_CLI_VERSION = '1.0.45';
export const GROK_CLI_PROXY_BASE = 'https://cli-chat-proxy.grok.com';
export const GROK_CLI_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-XAI-Token-Auth': 'xai-grok-cli',
  'x-authenticateresponse': 'authenticate-response',
  'x-grok-client-version': GROK_CLI_VERSION,
  'x-grok-client-mode': 'headless',
  'x-grok-client-identifier': 'grok-shell',
  'User-Agent': `grok-shell/${GROK_CLI_VERSION}`,
});

export const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.318 (external, sdk-cli)';
export const CLAUDE_CODE_STAINLESS_PACKAGE_VERSION = '0.80.0';
export const CLAUDE_CODE_STAINLESS_RUNTIME_VERSION = 'v24.14.0';
export const CLAUDE_CODE_BETA_FLAGS = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'context-management-2025-06-27',
  'effort-2025-11-24',
].join(',');

export function claudeCodeStainlessArch(arch = process.arch): string {
  switch (arch) {
    case 'arm64':
      return 'arm64';
    case 'x64':
      return 'x64';
    default:
      return `Other:${arch}`;
  }
}

export function claudeCodeStainlessOs(platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return 'MacOS';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
    case 'freebsd':
      return 'FreeBSD';
    default:
      return `Other:${platform}`;
  }
}

export const buildClaudeCodeSubscriptionHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-beta': CLAUDE_CODE_BETA_FLAGS,
  'anthropic-dangerous-direct-browser-access': 'true',
  'user-agent': CLAUDE_CODE_USER_AGENT,
  'x-app': 'cli',
  'x-stainless-arch': claudeCodeStainlessArch(),
  'x-stainless-helper-method': 'stream',
  'x-stainless-lang': 'js',
  'x-stainless-os': claudeCodeStainlessOs(),
  'x-stainless-package-version': CLAUDE_CODE_STAINLESS_PACKAGE_VERSION,
  'x-stainless-retry-count': '0',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': CLAUDE_CODE_STAINLESS_RUNTIME_VERSION,
  'x-stainless-timeout': '600',
});

// Copilot Chat 0.72.0 in VS Code 1.144.0 (sub-copilot G1).
export const COPILOT_EDITOR_VERSION = 'vscode/1.144.0';
export const COPILOT_PLUGIN_VERSION = 'copilot-chat/0.72.0';
export const COPILOT_USER_AGENT = 'GitHubCopilotChat/0.72.0';
/** Mistral Vibe CLI identity for the Vibe subscription (sub-mistral G2). */
export const MISTRAL_VIBE_USER_AGENT = 'Mistral-Vibe/3.0.4';
