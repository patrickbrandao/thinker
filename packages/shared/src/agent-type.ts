export const AGENT_CATEGORIES = ['personal', 'automation', 'app', 'coding'] as const;
export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

/**
 * Harness names are DNS labels: lowercase letters, digits and inner hyphens,
 * at most 63 characters. Names saved before this rule keep working.
 */
export const AGENT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const AGENT_NAME_MAX_LENGTH = 63;

/** Turns typed text into a DNS-label name as the user types. */
export function toAgentName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, AGENT_NAME_MAX_LENGTH);
}

export const AGENT_PLATFORMS = [
  'openclaw',
  'hermes',
  'nanobot',
  'craft',
  'claude-app',
  'n8n',
  'claude-code',
  'opencode',
  'codex',
  'deepseek-harness',
  'pi',
  'cline',
  'copilot-cli',
  'openai-sdk',
  'anthropic-sdk',
  'vercel-ai-sdk',
  'langchain',
  'curl',
  'other',
] as const;
export type AgentPlatform = (typeof AGENT_PLATFORMS)[number];

const AGENT_PLATFORM_SET = new Set<string>(AGENT_PLATFORMS);

/** Coerce persisted or untrusted platform values to the closed public enum. */
export function coerceAgentPlatform(value: string | null | undefined): AgentPlatform {
  return value && AGENT_PLATFORM_SET.has(value) ? (value as AgentPlatform) : 'other';
}

export const CATEGORY_LABELS: Readonly<Record<AgentCategory, string>> = {
  personal: 'AI agent',
  automation: 'Automation',
  app: 'App AI SDK',
  coding: 'Coding Assistant',
};

/**
 * Which proxy surface a platform's NATIVE traffic speaks. Single source of
 * truth for anything that impersonates or reasons about platform traffic
 * (CLI `routing test`, Wingman profiles, docs). Adding a platform above
 * without a surface here is a type error — the mapping can never go stale.
 */
export const API_SURFACES = ['chat_completions', 'messages', 'responses'] as const;
export type ApiSurface = (typeof API_SURFACES)[number];

export const PLATFORM_API_SURFACES: Readonly<Record<AgentPlatform, ApiSurface>> = {
  openclaw: 'chat_completions',
  hermes: 'chat_completions',
  nanobot: 'chat_completions',
  craft: 'chat_completions',
  'claude-app': 'messages',
  n8n: 'chat_completions',
  'claude-code': 'messages',
  opencode: 'chat_completions',
  codex: 'responses',
  'deepseek-harness': 'chat_completions',
  pi: 'chat_completions',
  cline: 'chat_completions',
  'copilot-cli': 'chat_completions',
  'openai-sdk': 'chat_completions',
  'anthropic-sdk': 'messages',
  'vercel-ai-sdk': 'chat_completions',
  langchain: 'chat_completions',
  curl: 'chat_completions',
  other: 'chat_completions',
};

export const PLATFORM_LABELS: Readonly<Record<AgentPlatform, string>> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes Agent',
  nanobot: 'Nanobot',
  craft: 'Craft Agent',
  'claude-app': 'Claude (APP)',
  n8n: 'n8n',
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
  'deepseek-harness': 'DeepSeek Harness',
  pi: 'Agent Pi',
  cline: 'Cline',
  'copilot-cli': 'Copilot CLI',
  'openai-sdk': 'OpenAI SDK',
  'anthropic-sdk': 'Anthropic SDK',
  'vercel-ai-sdk': 'Vercel AI SDK',
  langchain: 'LangChain',
  curl: 'cURL',
  other: 'Other',
};

// "Other" is offered only under App AI SDK; agents saved earlier with
// another category and "other" keep working, they just are not offered.
export const PLATFORMS_BY_CATEGORY: Readonly<Record<AgentCategory, readonly AgentPlatform[]>> = {
  personal: ['openclaw', 'hermes', 'nanobot', 'craft', 'claude-app'],
  automation: ['n8n'],
  app: ['openai-sdk', 'anthropic-sdk', 'vercel-ai-sdk', 'langchain', 'other'],
  coding: ['opencode', 'claude-code', 'codex', 'deepseek-harness', 'pi', 'cline', 'copilot-cli'],
};

export const PLATFORM_ICONS: Readonly<Partial<Record<AgentPlatform, string>>> = {
  openclaw: '/icons/openclaw.svg',
  hermes: '/icons/hermes.svg',
  nanobot: '/icons/nanobot.png',
  craft: '/icons/craft.png',
  'claude-app': '/icons/claude-app.svg',
  n8n: '/icons/n8n.svg',
  'claude-code': '/icons/providers/claude-code.svg',
  opencode: '/icons/providers/opencode.svg',
  codex: '/icons/codex.svg',
  'deepseek-harness': '/icons/providers/deepseek.svg',
  pi: '/icons/pi.svg',
  cline: '/icons/providers/cline-pass.png',
  'copilot-cli': '/icons/copilot.svg',
  'openai-sdk': '/icons/providers/openai.svg',
  'anthropic-sdk': '/icons/providers/anthropic.svg',
  'vercel-ai-sdk': '/icons/vercel-ai-sdk.svg',
  langchain: '/icons/langchain.svg',
  other: '/icons/other.svg',
};

/**
 * Variants drawn for the dark theme, keyed by the light icon. Icons without
 * one are used as is (monochrome marks are inverted by the dashboard).
 */
export const DARK_ICON_VARIANTS: Readonly<Record<string, string>> = {
  '/icons/copilot.svg': '/icons/copilot-dark.svg',
};

export function platformIcon(
  platform: string | null | undefined,
  category: string | null | undefined,
): string | undefined {
  if (!platform) return undefined;
  if (platform === 'other') {
    return category === 'personal' ? '/icons/other-agent.svg' : '/icons/other.svg';
  }
  // Object.hasOwn so a hostile string like "__proto__" or "constructor" can't
  // resolve to a value on Object.prototype.
  if (!Object.hasOwn(PLATFORM_ICONS, platform)) return undefined;
  return PLATFORM_ICONS[platform as AgentPlatform];
}
