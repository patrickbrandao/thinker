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
