/**
 * Per provider/model parameter policy, applied once to the final wire body
 * right before it is sent. Each rule removes, renames or pins a request field
 * that a given upstream rejects, so the protocol adapters stay generic.
 *
 * Every rule documents its source in the dossier of the entity
 * (`docs/externos/`); keep the rule list there in sync when adding one.
 */

export interface ParamPolicyContext {
  /** Registry key of the resolved endpoint (`anthropic`, `groq`, ...). */
  endpointKey: string;
  /** Wire format of the endpoint (`anthropic`, `google`, `chatgpt`, `openai`). */
  format: string | undefined;
  /** Model id as sent upstream (vendor prefix stripped). */
  model: string;
  /**
   * The caller's request before the adapter cleaned it (Chat Completions
   * view). Rules read intent from it, e.g. a `reasoning_effort` the generic
   * sanitizer drops for providers that spell effort differently.
   */
  source?: Record<string, unknown>;
}

interface ParamRule {
  /** Short id written to the log when the rule changes a body. */
  id: string;
  applies(ctx: ParamPolicyContext): boolean;
  /** Mutates `body`; returns true when it changed something. */
  apply(body: Record<string, unknown>, ctx: ParamPolicyContext): boolean;
}

export interface ClaudeVersion {
  family: string;
  major: number;
  minor: number;
}

/**
 * Parse a Claude model id (`claude-opus-4-7`, `claude-sonnet-4-20250514`,
 * `anthropic.claude-fable-5-1-v1:0`, `claude-3-5-sonnet-latest`). A trailing
 * date is not a minor version.
 */
export function parseClaudeVersion(model: string): ClaudeVersion | null {
  const id = model.toLowerCase();
  const modern = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (modern) {
    const minor = modern[3] && modern[3].length <= 2 ? Number(modern[3]) : 0;
    return { family: modern[1], major: Number(modern[2]), minor };
  }
  const legacy = /claude-(\d+)(?:-(\d+))?-([a-z]+)/.exec(id);
  if (legacy) {
    return { family: legacy[3], major: Number(legacy[1]), minor: Number(legacy[2] ?? 0) };
  }
  return null;
}

function atLeast(v: ClaudeVersion, major: number, minor: number): boolean {
  return v.major > major || (v.major === major && v.minor >= minor);
}

/** Claude 4.7 and later reject non-default `temperature`/`top_p`/`top_k`. */
export function claudeRejectsSampling(model: string): boolean {
  const v = parseClaudeVersion(model);
  return !!v && atLeast(v, 4, 7);
}

/**
 * Fable 5.1, Mythos 5.1, Opus 5.5 and Sonnet 5.5 (and later) accept only
 * `tool_choice` `auto` and `none`.
 */
export function claudeRejectsForcedToolChoice(model: string): boolean {
  const v = parseClaudeVersion(model);
  if (!v) return false;
  if (v.family === 'fable' || v.family === 'mythos') return true;
  return (v.family === 'opus' || v.family === 'sonnet') && atLeast(v, 5, 5);
}

function deleteFields(body: Record<string, unknown>, fields: readonly string[]): boolean {
  let changed = false;
  for (const field of fields) {
    if (field in body) {
      delete body[field];
      changed = true;
    }
  }
  return changed;
}

const isAnthropicWire = (ctx: ParamPolicyContext) => ctx.format === 'anthropic';
const isOpenAiWire = (ctx: ParamPolicyContext) => ctx.format === 'openai';
const isChatGptWire = (ctx: ParamPolicyContext) => ctx.format === 'chatgpt';

/** Drop a forced `tool_choice` (required / named), keeping auto and none. */
function relaxToolChoice(body: Record<string, unknown>): boolean {
  const choice = body.tool_choice;
  if (choice === undefined || choice === 'auto' || choice === 'none') return false;
  body.tool_choice = 'auto';
  return true;
}

/** The effort the caller asked for, on either wire shape. */
function requestedEffort(
  body: Record<string, unknown>,
  source?: Record<string, unknown>,
): string | undefined {
  const reasoning = body.reasoning as Record<string, unknown> | undefined;
  const value = body.reasoning_effort ?? reasoning?.effort ?? source?.reasoning_effort;
  return typeof value === 'string' ? value : undefined;
}

/** Map an OpenAI effort onto a provider's levels (closest, never `none`). */
function mapEffort(effort: string, levels: Record<string, string>): string | undefined {
  return levels[effort];
}

const LOW_HIGH_MAX: Record<string, string> = {
  none: 'low',
  minimal: 'low',
  low: 'low',
  medium: 'high',
  high: 'high',
  xhigh: 'max',
  max: 'max',
};

// Kimi K3 (api-moonshot G2): thinking always on, effort low|high|max, server-fixed sampling.
const KIMI_K3_RE = /^(?:kimi-)?k3(?:[.-]|$)/i;
// Kimi K2.6 / K2.7-code: fixed sampling, `thinking` enabled|disabled.
const KIMI_K2_RE = /^(?:kimi-)?k2\.[67](?:[.-]|$)/i;
const KIMI_FIXED_FIELDS = ['temperature', 'top_p', 'n', 'presence_penalty', 'frequency_penalty'];
// Gemini 3.6+, 3.8, 3.5 Flash-Lite and 4 ignore sampling and will 400 on it (api-gemini G6).
const GEMINI_NO_SAMPLING_RE = /^gemini-(?:3\.(?:[6-9]|\d{2,})|3\.5-flash-lite|[4-9](?:[.-]|$))/i;
const GEMINI_3_PLUS_RE = /^gemini-(?:[3-9])(?:[.-]|$)/i;
// xAI reasoning models reject penalties and stop (api-xai G1).
const XAI_REASONING_RE = /^grok-(?:4\.(?:[3-9]|\d{2,})|build)/i;
// GLM 5.3 cannot turn reasoning off; effort low|high|max (api-zai G2).
const GLM_53_RE = /^glm-5\.3(?:[.-]|$)/i;
// GPT-6 (api-openai G2): Astra and 6.1 Sol reject effort none (6.1 Sol also minimal).
const GPT6_RE = /^gpt-6(?:[.-]|$)/i;
const GPT6_NO_NONE_RE = /^gpt-6(?:-astra|\.1-sol)(?:-|$)/i;
const GPT6_SAMPLING_FIELDS = ['temperature', 'top_p', 'top_logprobs', 'logprobs'];
// Gemini 3.8 Flash and 4 Argon reject MINIMAL (api-gemini G1).
const GEMINI_NO_MINIMAL_RE = /^gemini-(?:3\.8|4)(?:[.-]|$)/i;
const GEMINI_25_RE = /^gemini-2\.5-/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Anthropic `thinking` from the caller: enabled budget, adaptive or disabled. */
function sourceThinking(
  source?: Record<string, unknown>,
): { type: string; budget?: number } | null {
  const thinking = source?.thinking;
  if (!isRecord(thinking) || typeof thinking.type !== 'string') return null;
  const budget = typeof thinking.budget_tokens === 'number' ? thinking.budget_tokens : undefined;
  return { type: thinking.type, budget };
}

/** Claude effort level for an OpenAI effort (api-anthropic G5). */
function claudeEffort(effort: string, model: string): string | undefined {
  const v = parseClaudeVersion(model);
  const top = v && v.major >= 5 ? undefined : 'high';
  switch (effort) {
    case 'none':
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
    case 'high':
      return effort;
    case 'xhigh':
    case 'max':
      return top ?? effort;
    default:
      return undefined;
  }
}

/** Gemini `thinkingConfig` for a caller effort or Anthropic thinking (api-gemini G1). */
function geminiThinkingConfig(
  model: string,
  effort: string | undefined,
  thinking: { type: string; budget?: number } | null,
): Record<string, unknown> | undefined {
  if (GEMINI_25_RE.test(model)) {
    const canDisable = !/^gemini-2\.5-pro/i.test(model);
    if (thinking?.type === 'enabled' && thinking.budget) return { thinkingBudget: thinking.budget };
    const level = effort ?? (thinking?.type === 'disabled' ? 'none' : undefined);
    const budgets: Record<string, number> = {
      none: canDisable ? 0 : 1024,
      minimal: 1024,
      low: 1024,
      medium: 8192,
      high: 24576,
      xhigh: 24576,
      max: 24576,
    };
    return level && budgets[level] !== undefined ? { thinkingBudget: budgets[level] } : undefined;
  }
  if (!GEMINI_3_PLUS_RE.test(model)) return undefined;
  let level = effort;
  if (!level && thinking) {
    if (thinking.type === 'disabled') level = 'minimal';
    else if (thinking.budget !== undefined) {
      level = thinking.budget <= 2048 ? 'low' : thinking.budget <= 16384 ? 'medium' : 'high';
    }
  }
  if (!level) return undefined;
  const floor = GEMINI_NO_MINIMAL_RE.test(model) ? 'LOW' : 'MINIMAL';
  const levels: Record<string, string> = {
    none: floor,
    minimal: floor,
    low: 'LOW',
    medium: 'MEDIUM',
    high: 'HIGH',
    xhigh: 'HIGH',
    max: 'HIGH',
  };
  return levels[level] ? { thinkingLevel: levels[level] } : undefined;
}

const RULES: ParamRule[] = [
  {
    // docs/externos/api/api-anthropic.md G3 (#403)
    id: 'anthropic-sampling-4.7+',
    applies: (ctx) => isAnthropicWire(ctx) && claudeRejectsSampling(ctx.model),
    apply: (body) => deleteFields(body, ['temperature', 'top_p', 'top_k']),
  },
  {
    // docs/externos/api/api-anthropic.md G4 (#404): downgrade, keep the
    // parallel flag that rides on the choice.
    id: 'anthropic-forced-tool-choice',
    applies: (ctx) => isAnthropicWire(ctx) && claudeRejectsForcedToolChoice(ctx.model),
    apply: (body) => {
      const choice = body.tool_choice as Record<string, unknown> | undefined;
      if (!choice || typeof choice !== 'object') return false;
      if (choice.type !== 'any' && choice.type !== 'tool') return false;
      const next: Record<string, unknown> = { type: 'auto' };
      if (choice.disable_parallel_tool_use !== undefined) {
        next.disable_parallel_tool_use = choice.disable_parallel_tool_use;
      }
      body.tool_choice = next;
      return true;
    },
  },
  {
    // docs/externos/api/api-anthropic.md G5 (#405): Chat Completions effort
    // becomes `output_config.effort` on Claude 4.6+.
    id: 'anthropic-effort',
    applies: (ctx) => {
      if (!isAnthropicWire(ctx)) return false;
      const v = parseClaudeVersion(ctx.model);
      return !!v && atLeast(v, 4, 6);
    },
    apply: (body, ctx) => {
      const effort = ctx.source?.reasoning_effort;
      if (typeof effort !== 'string') return false;
      const config = isRecord(body.output_config) ? body.output_config : {};
      if (config.effort !== undefined) return false;
      const mapped = claudeEffort(effort, ctx.model);
      if (!mapped) return false;
      body.output_config = { ...config, effort: mapped };
      return true;
    },
  },
  {
    // docs/externos/api/api-gemini.md G1 (#421)
    id: 'gemini-thinking-config',
    applies: (ctx) => ctx.format === 'google',
    apply: (body, ctx) => {
      const inner = isRecord(body.request) ? body.request : body;
      const config = isRecord(inner.generationConfig) ? inner.generationConfig : {};
      if (config.thinkingConfig !== undefined) return false;
      const thinkingConfig = geminiThinkingConfig(
        ctx.model,
        requestedEffort({}, ctx.source),
        sourceThinking(ctx.source),
      );
      if (!thinkingConfig) return false;
      inner.generationConfig = { ...config, thinkingConfig };
      return true;
    },
  },
  {
    // docs/externos/api/api-openrouter.md G1 (#432): Anthropic thinking is not
    // an OpenRouter parameter; its `reasoning` object carries the budget.
    id: 'openrouter-thinking',
    applies: (ctx) => ctx.endpointKey === 'openrouter',
    apply: (body, ctx) => {
      const thinking = sourceThinking(ctx.source) ?? sourceThinking(body);
      if (!thinking) return false;
      delete body.thinking;
      if (body.reasoning === undefined && body.reasoning_effort === undefined) {
        if (thinking.type === 'disabled') body.reasoning = { effort: 'none' };
        else if (thinking.budget) body.reasoning = { max_tokens: thinking.budget };
        else body.reasoning = { enabled: true };
      }
      return true;
    },
  },
  {
    // docs/externos/assinatura/sub-ollama-cloud.md G1 (#338)
    // local-ollama G3: the same OpenAI-compat limits apply to a local Ollama.
    id: 'ollama-cloud-unsupported',
    applies: (ctx) =>
      (ctx.endpointKey === 'ollama-cloud' || ctx.endpointKey === 'ollama') && isOpenAiWire(ctx),
    apply: (body) => {
      const dropped = deleteFields(body, ['user', 'n', 'logit_bias', 'logprobs', 'top_logprobs']);
      return deleteFields(body, ['tool_choice']) || dropped;
    },
  },
  {
    // docs/externos/api/api-groq.md G1 (#413)
    id: 'groq-unsupported',
    applies: (ctx) => ctx.endpointKey === 'groq',
    apply: (body) => {
      let changed = deleteFields(body, ['logprobs', 'top_logprobs', 'logit_bias']);
      if (body.n !== undefined && body.n !== 1) changed = deleteFields(body, ['n']) || changed;
      if (Array.isArray(body.messages)) {
        for (const message of body.messages as Record<string, unknown>[]) {
          if (message && typeof message === 'object' && 'name' in message) {
            delete message.name;
            changed = true;
          }
        }
      }
      return changed;
    },
  },
  {
    // docs/externos/api/api-moonshot.md G2 (#420)
    id: 'kimi-k3-fixed-params',
    applies: (ctx) => ctx.endpointKey === 'moonshot' && KIMI_K3_RE.test(ctx.model),
    apply: (body, ctx) => {
      let changed = deleteFields(body, [...KIMI_FIXED_FIELDS, 'thinking']);
      const effort = requestedEffort(body, ctx.source);
      const mapped = effort ? mapEffort(effort, LOW_HIGH_MAX) : undefined;
      if (mapped && body.reasoning_effort !== mapped) {
        body.reasoning_effort = mapped;
        changed = true;
      }
      return changed;
    },
  },
  {
    // docs/externos/assinatura/sub-moonshot.md G1 (#342): the Kimi Coding Plan
    // K3 / K3.1 Pro answer 400 when thinking is turned off.
    id: 'kimi-coding-k3-thinking',
    applies: (ctx) => ctx.endpointKey === 'moonshot-subscription' && KIMI_K3_RE.test(ctx.model),
    apply: (body) => {
      const thinking = body.thinking as Record<string, unknown> | undefined;
      return thinking?.type === 'disabled' ? deleteFields(body, ['thinking']) : false;
    },
  },
  {
    // docs/externos/api/api-moonshot.md G2 (#420)
    id: 'kimi-k2-fixed-params',
    applies: (ctx) => ctx.endpointKey === 'moonshot' && KIMI_K2_RE.test(ctx.model),
    apply: (body, ctx) => {
      let changed = deleteFields(body, KIMI_FIXED_FIELDS);
      const effort = requestedEffort(body, ctx.source);
      if (effort !== undefined) {
        changed = deleteFields(body, ['reasoning_effort']) || changed;
        if (body.thinking === undefined) {
          body.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' };
          changed = true;
        }
      }
      const thinking = body.thinking as Record<string, unknown> | undefined;
      if (thinking?.type !== 'disabled' && Array.isArray(body.tools)) {
        changed = relaxToolChoice(body) || changed;
      }
      return changed;
    },
  },
  {
    // docs/externos/api/api-gemini.md G6 (#426)
    id: 'gemini-sampling',
    applies: (ctx) => ctx.format === 'google' && GEMINI_3_PLUS_RE.test(ctx.model),
    apply: (body, ctx) => {
      // CodeAssist wraps the generateContent body in `request`.
      const inner = (body.request as Record<string, unknown> | undefined) ?? body;
      const config = inner.generationConfig as Record<string, unknown> | undefined;
      if (!config) return false;
      const fields = GEMINI_NO_SAMPLING_RE.test(ctx.model)
        ? ['temperature', 'topP', 'topK', 'candidateCount']
        : ['candidateCount'];
      return deleteFields(config, fields);
    },
  },
  {
    // docs/externos/api/api-xai.md G1 (#433)
    id: 'xai-reasoning-params',
    applies: (ctx) => ctx.endpointKey.startsWith('xai') && XAI_REASONING_RE.test(ctx.model),
    apply: (body, ctx) => {
      if (/non-reasoning/i.test(ctx.model)) return false;
      return deleteFields(body, ['presence_penalty', 'frequency_penalty', 'stop']);
    },
  },
  {
    // docs/externos/api/api-zai.md G2 (#439)
    id: 'glm-5.3-reasoning',
    applies: (ctx) => ctx.endpointKey.startsWith('zai') && GLM_53_RE.test(ctx.model),
    apply: (body, ctx) => {
      let changed = false;
      const thinking = body.thinking as Record<string, unknown> | undefined;
      if (thinking?.type === 'disabled') changed = deleteFields(body, ['thinking']);
      const effort = requestedEffort(body, ctx.source);
      if (effort !== undefined) {
        const mapped = mapEffort(effort, LOW_HIGH_MAX);
        if (mapped && mapped !== body.reasoning_effort) {
          body.reasoning_effort = mapped;
          changed = true;
        }
      }
      return changed;
    },
  },
  {
    // docs/externos/api/api-openai.md G2 (#441)
    id: 'gpt-6-reasoning',
    applies: (ctx) =>
      (ctx.endpointKey === 'openai' || ctx.endpointKey === 'openai-responses') &&
      GPT6_RE.test(ctx.model) &&
      (isOpenAiWire(ctx) || isChatGptWire(ctx)),
    apply: (body, ctx) => {
      let changed = false;
      const noNone = GPT6_NO_NONE_RE.test(ctx.model);
      const reasoning = body.reasoning as Record<string, unknown> | undefined;
      const fix = (effort: unknown) =>
        noNone && (effort === 'none' || effort === 'minimal') ? 'low' : effort;
      if (
        body.reasoning_effort !== undefined &&
        fix(body.reasoning_effort) !== body.reasoning_effort
      ) {
        body.reasoning_effort = fix(body.reasoning_effort);
        changed = true;
      }
      if (reasoning?.effort !== undefined && fix(reasoning.effort) !== reasoning.effort) {
        reasoning.effort = fix(reasoning.effort);
        changed = true;
      }
      const effort = requestedEffort(body);
      const reasoningOn = noNone || (effort !== undefined && effort !== 'none');
      if (reasoningOn) changed = deleteFields(body, GPT6_SAMPLING_FIELDS) || changed;
      return changed;
    },
  },
];

/**
 * Apply every matching rule to `body` in place. Returns the ids of the rules
 * that changed it, for the request log.
 */
export function applyParamPolicy(body: Record<string, unknown>, ctx: ParamPolicyContext): string[] {
  const applied: string[] = [];
  for (const rule of RULES) {
    if (rule.applies(ctx) && rule.apply(body, ctx)) applied.push(rule.id);
  }
  return applied;
}
