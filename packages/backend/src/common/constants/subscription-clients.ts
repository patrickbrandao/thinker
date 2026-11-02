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

export const CODEX_CLI_VERSION = '0.159.2';
export const CODEX_CLI_ORIGINATOR = 'codex_cli_rs';
export const CODEX_CLI_USER_AGENT = 'codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown';

export const OPENCODE_CLIENT_VERSION = '2.2.5';
export const OPENCODE_CLIENT_NAME = 'cli';
export const OPENCODE_USER_AGENT = `opencode/latest/${OPENCODE_CLIENT_VERSION}/${OPENCODE_CLIENT_NAME}`;
/** The key OpenCode sends when it has none: unlocks only the free models. */
export const OPENCODE_FREE_KEY = 'public';

export const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.280 (external, sdk-cli)';
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

export const COPILOT_EDITOR_VERSION = 'vscode/1.100.0';
export const COPILOT_PLUGIN_VERSION = 'copilot/1.300.0';
