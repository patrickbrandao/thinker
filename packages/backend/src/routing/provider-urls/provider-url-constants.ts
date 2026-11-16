/**
 * Built-in URLs of the subscription login flows and their side calls. A leaf
 * module (no imports): the OAuth services and `defaultProviderUrl` both read
 * these, so the default the dashboard shows is the URL the flow uses.
 */
export const OPENAI_OAUTH_URLS = {
  authorize: 'https://auth.openai.com/oauth/authorize',
  token: 'https://auth.openai.com/oauth/token',
  revoke: 'https://auth.openai.com/oauth/revoke',
} as const;

export const GEMINI_OAUTH_URLS = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
} as const;

export const XAI_OAUTH_URLS = {
  authorize: 'https://auth.x.ai/oauth2/authorize',
  token: 'https://auth.x.ai/oauth2/token',
  revoke: 'https://auth.x.ai/oauth2/revoke',
} as const;

export const ANTHROPIC_OAUTH_URLS = {
  authorize: 'https://claude.ai/oauth/authorize',
  token: 'https://api.anthropic.com/v1/oauth/token',
  redirect: 'https://console.anthropic.com/oauth/code/callback',
} as const;

export const COPILOT_URLS = {
  deviceCode: 'https://github.com/login/device/code',
  deviceToken: 'https://github.com/login/oauth/access_token',
  tokenExchange: 'https://api.github.com/copilot_internal/v2/token',
} as const;

/** CodeAssist (Gemini subscription): onboarding and inference host. */
export const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com';

export const OPENCODE_CONSOLE_SERVER = 'https://opencode.ai/console';
/** OpenCode Go allowance meter: rolling 5-hour, weekly and monthly windows. */
export const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
