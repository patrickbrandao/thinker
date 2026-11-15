/**
 * Lab only: an in-browser stand-in for the gateway's live session feed.
 *
 * A scenario (one harness session) compiles into a timeline of wire events,
 * the same events a real SSE endpoint would push. `SimServer` plays that
 * timeline, keeps every emitted event (the replay buffer behind
 * Last-Event-ID), and builds a snapshot for a client that joins mid-session.
 * `applyEvent` is the client reducer that rebuilds the chat from the feed.
 */

// ------------------------------------------------------------------ wire

export type WireType =
  | 'snapshot'
  | 'message.appended'
  | 'request.started'
  | 'block.started'
  | 'block.delta'
  | 'block.stopped'
  | 'request.completed'
  | 'request.failed'
  | 'request.cancelled'
  | 'heartbeat';

export interface WireEvent {
  id: number;
  type: WireType;
  /** Server clock, ms. */
  ts: number;
  data: Record<string, unknown>;
}

export type BlockType = 'thinking' | 'text' | 'tool_use';

// ------------------------------------------------------------- scenarios

export interface SessionMeta {
  sessionId: string;
  title: string;
  harness: string;
  agent: string;
  /** Model name the harness asked for (may be a virtual model). */
  requestedModel: string;
  protocol: Protocol;
}

export type Protocol = 'anthropic-messages' | 'openai-responses' | 'openai-chat';

interface ScriptBlock {
  type: BlockType;
  text: string;
  name?: string;
  toolCallId?: string;
}

interface Attempt {
  model: string;
  provider: string;
  route: string;
  ttftMs: number;
  /** Protocol spoken to the provider when Thinker translates (default: the harness protocol). */
  upstream?: Protocol;
  endpoint?: string;
  /**
   * The provider fails. With `cut`, it fails mid-stream: the blocks stream up
   * to that point (block index, fraction of its text) and then the error.
   */
  fail?: {
    status: number;
    message: string;
    afterMs: number;
    cut?: { block: number; fraction: number };
  };
  /** The harness closes the connection (user pressed Esc) at this point. */
  cancel?: { block: number; fraction: number };
  blocks?: ScriptBlock[];
  stopReason?: string;
  usage?: { input: number; output: number; cacheRead: number; reasoning?: number };
  costUsd?: number;
}

type Step =
  | { kind: 'system'; text: string }
  | { kind: 'user'; text: string; delayMs?: number }
  | {
      kind: 'tool_result';
      toolCallId: string;
      name: string;
      text: string;
      isError?: boolean;
      delayMs: number;
    }
  | { kind: 'request'; attempts: Attempt[] };

export interface Scenario {
  id: string;
  label: string;
  session: SessionMeta;
  steps: Step[];
}

const CLAUDE_SYSTEM =
  'You are a coding agent running in the user terminal. Use the tools to read and edit files. Be concise.';

export const SCENARIOS: Scenario[] = [
  {
    id: 'claude-code',
    label: 'Claude Code: tool loop, thinking, 429 then fallback',
    session: {
      sessionId: 'ses_7f3a91c2',
      title: 'Fix duplicated entries in /v1/models',
      harness: 'Claude Code',
      agent: 'claude-code-macbook',
      requestedModel: 'claude-opus-5-5',
      protocol: 'anthropic-messages',
    },
    steps: [
      { kind: 'system', text: CLAUDE_SYSTEM },
      {
        kind: 'user',
        text: 'The /v1/models endpoint returns duplicated entries when two providers expose the same model. Fix it.',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'claude-opus-5-5',
            provider: 'Claude Max (subscription)',
            route: 'tier: complex',
            ttftMs: 900,
            blocks: [
              {
                type: 'thinking',
                text: 'The user reports duplicates in /v1/models when two providers expose the same model. The list is probably built by concatenating each provider catalog without deduplicating by model id. I should find where the model list is assembled before changing anything. A grep for the controller handler is the fastest start.',
              },
              { type: 'text', text: "I'll find where the model list is built." },
              {
                type: 'tool_use',
                name: 'Grep',
                toolCallId: 'toolu_01',
                text: JSON.stringify({
                  pattern: 'listModels',
                  path: 'packages/backend/src',
                  output_mode: 'content',
                }),
              },
            ],
            stopReason: 'tool_use',
            usage: { input: 18420, output: 212, cacheRead: 16800 },
            costUsd: 0,
          },
        ],
      },
      {
        kind: 'tool_result',
        toolCallId: 'toolu_01',
        name: 'Grep',
        delayMs: 700,
        text: 'packages/backend/src/proxy/models.controller.ts:42:  async listModels(@Req() req) {\npackages/backend/src/proxy/models.service.ts:18:  listModels(agentId: string): ModelEntry[] {',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'claude-opus-5-5',
            provider: 'Claude Max (subscription)',
            route: 'tier: complex',
            ttftMs: 700,
            blocks: [
              {
                type: 'thinking',
                text: 'models.service.ts line 18 is the one that builds the list. Reading it will show whether it flattens provider catalogs.',
              },
              {
                type: 'tool_use',
                name: 'Read',
                toolCallId: 'toolu_02',
                text: JSON.stringify({
                  file_path: 'packages/backend/src/proxy/models.service.ts',
                  offset: 10,
                  limit: 30,
                }),
              },
            ],
            stopReason: 'tool_use',
            usage: { input: 18790, output: 96, cacheRead: 18400 },
            costUsd: 0,
          },
        ],
      },
      {
        kind: 'tool_result',
        toolCallId: 'toolu_02',
        name: 'Read',
        delayMs: 400,
        text: '18  listModels(agentId: string): ModelEntry[] {\n19    const out: ModelEntry[] = [];\n20    for (const p of this.providers(agentId)) {\n21      out.push(...p.catalog.map((m) => ({ id: m.id, owned_by: p.name })));\n22    }\n23    return out;\n24  }',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'claude-opus-5-5',
            provider: 'Claude Max (subscription)',
            route: 'tier: complex',
            ttftMs: 0,
            fail: {
              status: 429,
              message: 'rate_limit_error: 5-hour usage limit reached',
              afterMs: 650,
            },
          },
          {
            model: 'anthropic/claude-opus-5-5',
            provider: 'OpenRouter (API key)',
            route: 'fallback #1',
            upstream: 'openai-chat',
            endpoint: 'https://openrouter.ai/api/v1/chat/completions',
            ttftMs: 1100,
            blocks: [
              {
                type: 'thinking',
                text: 'Confirmed: the loop pushes every catalog entry, so the same id appears once per provider. The fix is to keep the first occurrence per id, which also respects provider priority since providers() is already ordered. A Map keyed by id keeps insertion order.',
              },
              {
                type: 'text',
                text: 'The loop appends every catalog entry, so a model offered by two providers shows up twice. I will dedupe by id, keeping the first provider (highest priority).',
              },
              {
                type: 'tool_use',
                name: 'Edit',
                toolCallId: 'toolu_03',
                text: JSON.stringify({
                  file_path: 'packages/backend/src/proxy/models.service.ts',
                  old_string:
                    'out.push(...p.catalog.map((m) => ({ id: m.id, owned_by: p.name })));',
                  new_string:
                    'for (const m of p.catalog) if (!seen.has(m.id)) seen.set(m.id, { id: m.id, owned_by: p.name });',
                }),
              },
            ],
            stopReason: 'tool_use',
            usage: { input: 19210, output: 318, cacheRead: 0 },
            costUsd: 0.1024,
          },
        ],
      },
      {
        kind: 'tool_result',
        toolCallId: 'toolu_03',
        name: 'Edit',
        delayMs: 300,
        text: 'The file packages/backend/src/proxy/models.service.ts has been updated.',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'claude-opus-5-5',
            provider: 'Claude Max (subscription)',
            route: 'tier: complex (primary back)',
            ttftMs: 800,
            blocks: [
              {
                type: 'text',
                text: 'Done. **What changed** in `models.service.ts`:\n\n- the list is now built in a `Map` keyed by model id;\n- the first provider wins, so the routing priority is respected;\n- the response order is unchanged.\n\n```ts\nconst seen = new Map<string, ModelEntry>();\nfor (const p of this.providers(agentId))\n  for (const m of p.catalog) if (!seen.has(m.id)) seen.set(m.id, { id: m.id, owned_by: p.name });\nreturn [...seen.values()];\n```\n\nWant me to add a unit test for the duplicate case?',
              },
            ],
            stopReason: 'end_turn',
            usage: { input: 19620, output: 164, cacheRead: 19100 },
            costUsd: 0,
          },
        ],
      },
    ],
  },
  {
    id: 'codex',
    label: 'Codex: reasoning summary and parallel tool calls',
    session: {
      sessionId: 'ses_c0d3x512',
      title: 'Why is the build slow?',
      harness: 'Codex CLI',
      agent: 'codex-devbox',
      requestedModel: 'thinker/auto',
      protocol: 'openai-responses',
    },
    steps: [
      {
        kind: 'system',
        text: 'You are Codex, a coding agent. Prefer shell commands to inspect the repository.',
      },
      { kind: 'user', text: 'The frontend build takes almost 2 minutes. Find out why.' },
      {
        kind: 'request',
        attempts: [
          {
            model: 'gpt-5.5-codex',
            provider: 'ChatGPT Pro (subscription)',
            route: 'virtual model thinker/auto → coding',
            ttftMs: 1400,
            blocks: [
              {
                type: 'thinking',
                text: '**Inspecting the build setup**\n\nI need the Vite config and the dependency list to see whether something heavy is being bundled or type-checked during build. Both reads are independent, so I can run them in parallel.',
              },
              {
                type: 'tool_use',
                name: 'shell',
                toolCallId: 'call_A1',
                text: JSON.stringify({ command: ['cat', 'packages/frontend/vite.config.ts'] }),
              },
              {
                type: 'tool_use',
                name: 'shell',
                toolCallId: 'call_A2',
                text: JSON.stringify({ command: ['npx', 'vite-bundle-visualizer', '--json'] }),
              },
            ],
            stopReason: 'tool_calls',
            usage: { input: 9120, output: 188, cacheRead: 0, reasoning: 96 },
            costUsd: 0,
          },
        ],
      },
      {
        kind: 'tool_result',
        toolCallId: 'call_A1',
        name: 'shell',
        delayMs: 300,
        text: "export default defineConfig({\n  plugins: [react(), tailwind(), checker({ typescript: true })],\n  build: { sourcemap: true, minify: 'terser' },\n});",
      },
      {
        kind: 'tool_result',
        toolCallId: 'call_A2',
        name: 'shell',
        delayMs: 1600,
        text: '{"largest": [{"name": "highlight.js (all languages)", "kb": 1840}, {"name": "@xyflow/react", "kb": 410}]}',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'gpt-5.5-codex',
            provider: 'ChatGPT Pro (subscription)',
            route: 'virtual model thinker/auto → coding',
            ttftMs: 1200,
            blocks: [
              {
                type: 'thinking',
                text: '**Weighing the causes**\n\nThree costs stack up: the type checker plugin runs a full tsc during build, terser is much slower than esbuild, and highlight.js is imported with every language.',
              },
              {
                type: 'text',
                text: "Three things slow the build:\n\n1. `vite-plugin-checker` runs a full TypeScript check inside `vite build`. Run `tsc --noEmit` in CI instead.\n2. `minify: 'terser'` is several times slower than the default esbuild minifier.\n3. `highlight.js` is imported whole (1.8 MB). Import `highlight.js/lib/core` and register only the languages you use.\n\nFixing 1 and 2 alone usually brings a build like this under 30 s.",
              },
            ],
            stopReason: 'stop',
            usage: { input: 11480, output: 241, cacheRead: 9000, reasoning: 62 },
            costUsd: 0,
          },
        ],
      },
    ],
  },
];

const LONG_THINKING = [
  'The user asks for a migration plan from a single PostgreSQL instance to a primary with two replicas, without downtime.',
  'First constraint: the application writes continuously, so a dump and restore is out. Streaming replication with a base backup is the usual path: pg_basebackup from the primary, then the replica follows the WAL.',
  'Second: the app must not send writes to replicas. They use a single DATABASE_URL today, so either a pooler that routes reads (pgcat, or PgBouncer with two pools) or two URLs in the app. Two URLs is simpler and explicit; a router hides lag problems.',
  'Third: replication lag. Read-after-write paths (the dashboard right after saving) must stay on the primary. That needs a rule in the code, not only infrastructure.',
  'Fourth: failover. Without Patroni or similar, promotion is manual. For a first step manual promotion with a runbook is acceptable; automating it can come later.',
  'Order of work: WAL settings and a replication user on the primary (needs a restart for wal_level if it is minimal, so check it first), base backups for each replica, verify lag with pg_stat_replication, then switch read-only queries in the app behind a flag.',
  'I should present this as numbered phases with the one restart risk called out, and keep it short enough to act on.',
].join(' ');

SCENARIOS.push(
  {
    id: 'hermes',
    label: 'Hermes: several prompts, long thinking, user cancels',
    session: {
      sessionId: 'ses_h3rm35aa',
      title: 'Plan a PostgreSQL replica rollout',
      harness: 'Hermes Agent',
      agent: 'hermes-ops',
      requestedModel: 'deepseek-v4',
      protocol: 'openai-chat',
    },
    steps: [
      {
        kind: 'system',
        text: 'You are Hermes, an operations assistant. Answer with concrete steps.',
      },
      {
        kind: 'user',
        text: 'We run a single PostgreSQL 17. Plan the move to a primary with two read replicas, no downtime.',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'deepseek-v4',
            provider: 'DeepSeek (API key)',
            route: 'direct',
            ttftMs: 1600,
            blocks: [
              { type: 'thinking', text: LONG_THINKING },
              {
                type: 'text',
                text: '**Phase 1: prepare the primary**\n- Check `wal_level` (needs `replica`). If it is `minimal`, plan **one restart** in a quiet window: the only downtime risk.\n- Create a `replicator` role and allow it in `pg_hba.conf`.\n\n**Phase 2: build the replicas**\n- `pg_basebackup -R` on each node; they start following the WAL.\n- Watch `pg_stat_replication` until lag stays under a second.\n\n**Phase 3: move reads**\n- Add `DATABASE_READ_URL` and send read-only queries there behind a flag.\n- Keep read-after-write screens on the primary.\n\n**Phase 4: failover**\n- Write a manual promotion runbook now; automate with Patroni later.',
              },
            ],
            stopReason: 'stop',
            usage: { input: 820, output: 1180, cacheRead: 0, reasoning: 640 },
            costUsd: 0.0021,
          },
        ],
      },
      {
        kind: 'user',
        delayMs: 1500,
        text: 'Now write the full pg_hba.conf and postgresql.conf for each node.',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'deepseek-v4',
            provider: 'DeepSeek (API key)',
            route: 'direct',
            ttftMs: 1200,
            cancel: { block: 1, fraction: 0.35 },
            blocks: [
              {
                type: 'thinking',
                text: 'Full configuration files for three nodes is long. Start with the primary postgresql.conf, then pg_hba.conf, then the replica differences.',
              },
              {
                type: 'text',
                text: "### Primary: `postgresql.conf`\n\n```ini\nlisten_addresses = '*'\nwal_level = replica\nmax_wal_senders = 10\nmax_replication_slots = 10\nwal_keep_size = 2GB\nhot_standby = on\n```\n\n### Primary: `pg_hba.conf`\n\n```\nhost replication replicator 10.0.0.0/24 scram-sha-256\nhost all all 10.0.0.0/24 scram-sha-256\n```\n\n### Replicas\nSame file, plus `primary_conninfo` written by `pg_basebackup -R`.",
              },
            ],
          },
        ],
      },
      {
        kind: 'user',
        delayMs: 1200,
        text: 'Too long, never mind. Just the two settings I must not forget.',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'deepseek-v4',
            provider: 'DeepSeek (API key)',
            route: 'direct',
            ttftMs: 900,
            blocks: [
              {
                type: 'text',
                text: '1. `wal_level = replica` on the primary (restart if it changes).\n2. A `host replication` line for the replicator role in `pg_hba.conf`.',
              },
            ],
            stopReason: 'stop',
            usage: { input: 1420, output: 46, cacheRead: 1024 },
            costUsd: 0.0002,
          },
        ],
      },
    ],
  },
  {
    id: 'openclaw',
    label: 'OpenClaw: stream cut mid-answer, then no route left',
    session: {
      sessionId: 'ses_0pcl4w77',
      title: 'Draft the release announcement',
      harness: 'OpenClaw',
      agent: 'openclaw-home',
      requestedModel: 'thinker/writer',
      protocol: 'openai-chat',
    },
    steps: [
      { kind: 'system', text: 'You are a helpful personal assistant.' },
      {
        kind: 'user',
        text: 'Write a short announcement for the v2 release of my app: faster sync and offline mode.',
      },
      {
        kind: 'request',
        attempts: [
          {
            model: 'glm-5',
            provider: 'GLM Coding Plan (subscription)',
            route: 'virtual model thinker/writer',
            upstream: 'anthropic-messages',
            endpoint: 'https://api.z.ai/api/anthropic/v1/messages',
            ttftMs: 1000,
            fail: {
              status: 502,
              message: 'upstream stream ended without message_stop',
              afterMs: 0,
              cut: { block: 0, fraction: 0.45 },
            },
            blocks: [
              {
                type: 'text',
                text: '**v2 is here.** Sync is now up to 5× faster, and the app keeps working offline: edits are saved on your device and sync as soon as you are back online. Update from the store today.',
              },
            ],
          },
          {
            model: 'gpt-5.5-mini',
            provider: 'OpenAI (API key)',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            route: 'fallback #1',
            ttftMs: 700,
            blocks: [
              {
                type: 'text',
                text: '**v2 is here.** Sync is up to 5× faster, and offline mode keeps you working without a connection: your edits sync the moment you are back online. Update today.',
              },
            ],
            stopReason: 'stop',
            usage: { input: 64, output: 41, cacheRead: 0 },
            costUsd: 0.0001,
          },
        ],
      },
      { kind: 'user', delayMs: 1500, text: 'Translate it to Portuguese.' },
      {
        kind: 'request',
        attempts: [
          {
            model: 'glm-5',
            provider: 'GLM Coding Plan (subscription)',
            route: 'virtual model thinker/writer',
            upstream: 'anthropic-messages',
            endpoint: 'https://api.z.ai/api/anthropic/v1/messages',
            ttftMs: 0,
            fail: { status: 500, message: 'internal_error', afterMs: 900 },
          },
          {
            model: 'gpt-5.5-mini',
            provider: 'OpenAI (API key)',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            route: 'fallback #1',
            ttftMs: 0,
            fail: {
              status: 503,
              message: 'The engine is currently overloaded, please try again later',
              afterMs: 600,
            },
          },
        ],
      },
    ],
  },
);

// --------------------------------------------------------------- compile

interface Timed {
  delayMs: number;
  type: WireType;
  data: Record<string, unknown>;
}

/** Splits text into stream-sized pieces (a word or a few characters). */
function chunk(text: string, json: boolean): string[] {
  if (json) {
    const out: string[] = [];
    for (let i = 0; i < text.length;) {
      const n = 4 + Math.floor(Math.random() * 8);
      out.push(text.slice(i, i + n));
      i += n;
    }
    return out;
  }
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

const DELTA_MS: Record<BlockType, number> = { thinking: 22, text: 32, tool_use: 14 };

/** Neutral conversation, rendered per protocol for the provider request body. */
type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; blocks: ScriptBlock[] }
  | { role: 'tool'; toolCallId: string; name: string; text: string };

const DEFAULT_ENDPOINT: Record<Protocol, string> = {
  'anthropic-messages': 'https://api.anthropic.com/v1/messages',
  'openai-responses': 'https://chatgpt.com/backend-api/codex/responses',
  'openai-chat': 'https://api.deepseek.com/v1/chat/completions',
};

const AUTH_HEADER: Record<Protocol, Record<string, string>> = {
  'anthropic-messages': { authorization: 'Bearer ••••••••', 'anthropic-version': '2023-06-01' },
  'openai-responses': { authorization: 'Bearer ••••••••' },
  'openai-chat': { authorization: 'Bearer ••••••••' },
};

const parseArgs = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

export function buildBody(
  protocol: Protocol,
  model: string,
  system: string,
  turns: Turn[],
): Record<string, unknown> {
  if (protocol === 'anthropic-messages') {
    const messages: { role: string; content: unknown[] }[] = [];
    for (const t of turns) {
      if (t.role === 'user')
        messages.push({ role: 'user', content: [{ type: 'text', text: t.text }] });
      else if (t.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: t.toolCallId, content: t.text };
        const last = messages.at(-1);
        if (last?.role === 'user' && (last.content[0] as { type: string }).type === 'tool_result')
          last.content.push(block);
        else messages.push({ role: 'user', content: [block] });
      } else
        messages.push({
          role: 'assistant',
          content: t.blocks.map((b) =>
            b.type === 'thinking'
              ? { type: 'thinking', thinking: b.text, signature: 'EuYB…' }
              : b.type === 'text'
                ? { type: 'text', text: b.text }
                : { type: 'tool_use', id: b.toolCallId, name: b.name, input: parseArgs(b.text) },
          ),
        });
    }
    return {
      model,
      max_tokens: 32000,
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 16000 },
      system,
      messages,
      tools: '[…tool definitions…]',
    };
  }
  if (protocol === 'openai-responses') {
    const input: unknown[] = [];
    for (const t of turns) {
      if (t.role === 'user')
        input.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: t.text }],
        });
      else if (t.role === 'tool')
        input.push({ type: 'function_call_output', call_id: t.toolCallId, output: t.text });
      else
        for (const b of t.blocks)
          input.push(
            b.type === 'thinking'
              ? {
                  type: 'reasoning',
                  summary: [{ type: 'summary_text', text: b.text }],
                  encrypted_content: 'gAAAA…',
                }
              : b.type === 'text'
                ? {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: b.text }],
                  }
                : { type: 'function_call', call_id: b.toolCallId, name: b.name, arguments: b.text },
          );
    }
    return {
      model,
      stream: true,
      store: false,
      instructions: system,
      reasoning: { effort: 'high', summary: 'auto' },
      input,
      tools: '[…tool definitions…]',
    };
  }
  const messages: unknown[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: t.text });
    else if (t.role === 'tool')
      messages.push({ role: 'tool', tool_call_id: t.toolCallId, content: t.text });
    else {
      const calls = t.blocks.filter((b) => b.type === 'tool_use');
      messages.push({
        role: 'assistant',
        content:
          t.blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('') || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((b) => ({
                id: b.toolCallId,
                type: 'function',
                function: { name: b.name, arguments: b.text },
              })),
            }
          : {}),
      });
    }
  }
  return { model, stream: true, stream_options: { include_usage: true }, messages };
}

export function compile(scenario: Scenario): Timed[] {
  const out: Timed[] = [];
  const turns: Turn[] = [];
  let system = '';
  let seq = 0;
  let req = 0;
  for (const step of scenario.steps) {
    if (step.kind === 'system') {
      system = step.text;
      out.push({
        delayMs: 50,
        type: 'message.appended',
        data: { seq: seq++, role: 'system', text: step.text },
      });
    } else if (step.kind === 'user') {
      turns.push({ role: 'user', text: step.text });
      out.push({
        delayMs: step.delayMs ?? 500,
        type: 'message.appended',
        data: { seq: seq++, role: 'user', text: step.text },
      });
    } else if (step.kind === 'tool_result') {
      turns.push({ role: 'tool', toolCallId: step.toolCallId, name: step.name, text: step.text });
      out.push({
        delayMs: step.delayMs,
        type: 'message.appended',
        data: {
          seq: seq++,
          role: 'tool',
          toolCallId: step.toolCallId,
          name: step.name,
          text: step.text,
          isError: !!step.isError,
        },
      });
    } else {
      req += 1;
      const requestId = `req_${String(req).padStart(3, '0')}`;
      for (const [i, a] of step.attempts.entries()) {
        const attemptId = `${requestId}.${i + 1}`;
        const upstream = a.upstream ?? scenario.session.protocol;
        out.push({
          delayMs: i === 0 ? 120 : 250,
          type: 'request.started',
          data: {
            requestId,
            attemptId,
            attempt: i + 1,
            model: a.model,
            provider: a.provider,
            route: a.route,
            upstream,
            endpoint: a.endpoint ?? DEFAULT_ENDPOINT[upstream],
            headers: { 'content-type': 'application/json', ...AUTH_HEADER[upstream] },
            body: buildBody(upstream, a.model, system, turns),
          },
        });
        const stopAt = a.fail?.cut ?? a.cancel;
        if (a.fail && !a.fail.cut) {
          out.push({
            delayMs: a.fail.afterMs,
            type: 'request.failed',
            data: {
              requestId,
              attemptId,
              status: a.fail.status,
              message: a.fail.message,
              next: i + 1 < step.attempts.length ? 'fallback' : 'give_up',
            },
          });
          continue;
        }
        let first = true;
        let streamMs = 0;
        let stopped = false;
        for (const [index, b] of (a.blocks ?? []).entries()) {
          if (stopped) break;
          out.push({
            delayMs: first ? a.ttftMs : 80,
            type: 'block.started',
            data: {
              requestId,
              attemptId,
              index,
              type: b.type,
              name: b.name,
              toolCallId: b.toolCallId,
            },
          });
          first = false;
          let pieces = chunk(b.text, b.type === 'tool_use');
          if (stopAt && stopAt.block === index) {
            pieces = pieces.slice(0, Math.max(1, Math.floor(pieces.length * stopAt.fraction)));
            stopped = true;
          }
          for (const piece of pieces) {
            const d = DELTA_MS[b.type] * (0.6 + Math.random() * 0.8);
            streamMs += d;
            out.push({
              delayMs: d,
              type: 'block.delta',
              data: { requestId, attemptId, index, delta: piece },
            });
          }
          if (!stopped)
            out.push({ delayMs: 20, type: 'block.stopped', data: { requestId, attemptId, index } });
        }
        if (a.fail) {
          out.push({
            delayMs: 300,
            type: 'request.failed',
            data: {
              requestId,
              attemptId,
              status: a.fail.status,
              message: a.fail.message,
              interrupted: true,
              next: i + 1 < step.attempts.length ? 'fallback' : 'give_up',
            },
          });
          continue;
        }
        if (a.cancel) {
          out.push({
            delayMs: 120,
            type: 'request.cancelled',
            data: {
              requestId,
              attemptId,
              reason: 'client_closed',
              latencyMs: Math.round(a.ttftMs + streamMs),
            },
          });
          continue;
        }
        turns.push({ role: 'assistant', blocks: a.blocks ?? [] });
        out.push({
          delayMs: 60,
          type: 'request.completed',
          data: {
            requestId,
            attemptId,
            stopReason: a.stopReason,
            usage: a.usage,
            costUsd: a.costUsd ?? 0,
            ttftMs: a.ttftMs,
            latencyMs: Math.round(a.ttftMs + streamMs + 200),
          },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- client

export interface LiveBlock {
  type: BlockType;
  text: string;
  /** Deltas as they arrived (the inspector rebuilds the provider frames from them). */
  chunks: string[];
  name?: string;
  toolCallId?: string;
  done: boolean;
  startedTs: number;
  endedTs?: number;
}

export type AttemptStatus = 'waiting' | 'streaming' | 'done' | 'failed' | 'cancelled';

export interface LiveAttempt {
  kind: 'attempt';
  requestId: string;
  attemptId: string;
  attempt: number;
  model: string;
  provider: string;
  route: string;
  upstream: Protocol;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  status: AttemptStatus;
  startedTs: number;
  endedTs?: number;
  blocks: LiveBlock[];
  stopReason?: string;
  usage?: { input: number; output: number; cacheRead: number; reasoning?: number };
  costUsd?: number;
  ttftMs?: number;
  latencyMs?: number;
  error?: { status: number; message: string; next: string; interrupted?: boolean };
}

export interface LiveMessage {
  kind: 'message';
  seq: number;
  role: 'system' | 'user' | 'tool';
  text: string;
  name?: string;
  toolCallId?: string;
  isError?: boolean;
  ts: number;
}

export type LiveItem = LiveAttempt | LiveMessage;

export interface LiveState {
  lastEventId: number;
  /** Server time of the last applied event (the "now" of a replay). */
  lastTs: number;
  items: LiveItem[];
  totals: { requests: number; input: number; output: number; costUsd: number };
}

export const emptyState = (): LiveState => ({
  lastEventId: 0,
  lastTs: 0,
  items: [],
  totals: { requests: 0, input: 0, output: 0, costUsd: 0 },
});

function findAttempt(s: LiveState, attemptId: unknown): LiveAttempt | undefined {
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i]!;
    if (it.kind === 'attempt' && it.attemptId === attemptId) return it;
  }
  return undefined;
}

/** Client reducer. Mutates `s` in place (the caller batches renders per frame). */
export function applyEvent(s: LiveState, ev: WireEvent): void {
  const d = ev.data as Record<string, any>;
  if (ev.type === 'snapshot') {
    Object.assign(s, structuredClone(d.state as LiveState));
    s.lastEventId = ev.id;
    return;
  }
  s.lastEventId = ev.id;
  s.lastTs = ev.ts;
  switch (ev.type) {
    case 'message.appended':
      s.items.push({
        kind: 'message',
        seq: d.seq,
        role: d.role,
        text: d.text,
        name: d.name,
        toolCallId: d.toolCallId,
        isError: d.isError,
        ts: ev.ts,
      });
      break;
    case 'request.started':
      if (d.attempt === 1) s.totals.requests += 1;
      s.items.push({
        kind: 'attempt',
        requestId: d.requestId,
        attemptId: d.attemptId,
        attempt: d.attempt,
        model: d.model,
        provider: d.provider,
        route: d.route,
        upstream: d.upstream,
        endpoint: d.endpoint,
        headers: d.headers,
        body: d.body,
        status: 'waiting',
        startedTs: ev.ts,
        blocks: [],
      });
      break;
    case 'block.started': {
      const a = findAttempt(s, d.attemptId);
      if (!a) break;
      a.status = 'streaming';
      a.blocks[d.index] = {
        type: d.type,
        text: '',
        chunks: [],
        name: d.name,
        toolCallId: d.toolCallId,
        done: false,
        startedTs: ev.ts,
      };
      break;
    }
    case 'block.delta': {
      const b = findAttempt(s, d.attemptId)?.blocks[d.index];
      if (b) {
        b.text += d.delta;
        b.chunks.push(d.delta);
      }
      break;
    }
    case 'block.stopped': {
      const b = findAttempt(s, d.attemptId)?.blocks[d.index];
      if (b) {
        b.done = true;
        b.endedTs = ev.ts;
      }
      break;
    }
    case 'request.completed': {
      const a = findAttempt(s, d.attemptId);
      if (!a) break;
      Object.assign(a, {
        status: 'done',
        endedTs: ev.ts,
        stopReason: d.stopReason,
        usage: d.usage,
        costUsd: d.costUsd,
        ttftMs: d.ttftMs,
        latencyMs: d.latencyMs,
      });
      s.totals.input += d.usage?.input ?? 0;
      s.totals.output += d.usage?.output ?? 0;
      s.totals.costUsd += d.costUsd ?? 0;
      break;
    }
    case 'request.failed':
    case 'request.cancelled': {
      const a = findAttempt(s, d.attemptId);
      if (!a) break;
      for (const b of a.blocks) if (!b.done) b.endedTs = ev.ts;
      if (ev.type === 'request.failed') {
        Object.assign(a, {
          status: 'failed',
          endedTs: ev.ts,
          error: { status: d.status, message: d.message, next: d.next, interrupted: d.interrupted },
        });
      } else {
        Object.assign(a, {
          status: 'cancelled',
          endedTs: ev.ts,
          stopReason: d.reason,
          latencyMs: d.latencyMs,
        });
      }
      break;
    }
    case 'heartbeat':
      break;
  }
}

/** Rebuilds the state from a list of events (a replay from history). */
export function reduceEvents(events: WireEvent[]): LiveState {
  const s = emptyState();
  for (const ev of events) applyEvent(s, ev);
  return s;
}

// ------------------------------------------------- provider frames (inspector)

const sse = (event: string | null, data: unknown) =>
  `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n`;

/** The provider's own stream for one attempt, rebuilt from the recorded deltas. */
export function providerFrames(a: LiveAttempt): string[] {
  const out: string[] = [];
  const done = a.status === 'done';
  if (a.upstream === 'anthropic-messages') {
    out.push(
      sse('message_start', {
        type: 'message_start',
        message: { id: `msg_${a.attemptId}`, model: a.model, role: 'assistant', content: [] },
      }),
    );
    a.blocks.forEach((b, index) => {
      const start =
        b.type === 'tool_use'
          ? { type: 'tool_use', id: b.toolCallId, name: b.name, input: {} }
          : b.type === 'thinking'
            ? { type: 'thinking', thinking: '' }
            : { type: 'text', text: '' };
      out.push(
        sse('content_block_start', { type: 'content_block_start', index, content_block: start }),
      );
      for (const c of b.chunks) {
        const delta =
          b.type === 'thinking'
            ? { type: 'thinking_delta', thinking: c }
            : b.type === 'text'
              ? { type: 'text_delta', text: c }
              : { type: 'input_json_delta', partial_json: c };
        out.push(sse('content_block_delta', { type: 'content_block_delta', index, delta }));
      }
      if (b.done) out.push(sse('content_block_stop', { type: 'content_block_stop', index }));
    });
    if (done) {
      out.push(
        sse('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: a.stopReason },
          usage: { output_tokens: a.usage?.output },
        }),
      );
      out.push(sse('message_stop', { type: 'message_stop' }));
    }
  } else if (a.upstream === 'openai-responses') {
    out.push(
      sse('response.created', {
        type: 'response.created',
        response: { id: `resp_${a.attemptId}`, model: a.model, status: 'in_progress' },
      }),
    );
    a.blocks.forEach((b, output_index) => {
      const item =
        b.type === 'thinking'
          ? { type: 'reasoning' }
          : b.type === 'text'
            ? { type: 'message', role: 'assistant' }
            : { type: 'function_call', call_id: b.toolCallId, name: b.name };
      out.push(
        sse('response.output_item.added', {
          type: 'response.output_item.added',
          output_index,
          item,
        }),
      );
      const ev =
        b.type === 'thinking'
          ? 'response.reasoning_summary_text.delta'
          : b.type === 'text'
            ? 'response.output_text.delta'
            : 'response.function_call_arguments.delta';
      for (const c of b.chunks) out.push(sse(ev, { type: ev, output_index, delta: c }));
      if (b.done)
        out.push(
          sse('response.output_item.done', { type: 'response.output_item.done', output_index }),
        );
    });
    if (done)
      out.push(
        sse('response.completed', {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: {
              input_tokens: a.usage?.input,
              output_tokens: a.usage?.output,
              output_tokens_details: { reasoning_tokens: a.usage?.reasoning ?? 0 },
            },
          },
        }),
      );
  } else {
    let toolIndex = 0;
    for (const b of a.blocks) {
      const ti = b.type === 'tool_use' ? toolIndex++ : 0;
      b.chunks.forEach((c, k) => {
        const delta =
          b.type === 'thinking'
            ? { reasoning_content: c }
            : b.type === 'text'
              ? { content: c }
              : {
                  tool_calls: [
                    {
                      index: ti,
                      ...(k === 0
                        ? {
                            id: b.toolCallId,
                            type: 'function',
                            function: { name: b.name, arguments: c },
                          }
                        : { function: { arguments: c } }),
                    },
                  ],
                };
        out.push(
          sse(null, {
            id: `chatcmpl-${a.attemptId}`,
            model: a.model,
            choices: [{ index: 0, delta }],
          }),
        );
      });
    }
    if (done) {
      out.push(
        sse(null, {
          choices: [{ index: 0, delta: {}, finish_reason: a.stopReason }],
          usage: { prompt_tokens: a.usage?.input, completion_tokens: a.usage?.output },
        }),
      );
      out.push(sse(null, '[DONE]'));
    }
  }
  return out;
}

// ---------------------------------------------------------------- server

export type Delivery = 'live' | 'replay' | 'snapshot';
type Listener = (ev: WireEvent, how: Delivery) => void;

export class SimServer {
  readonly scenario: Scenario;
  private timeline: Timed[];
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hb: ReturnType<typeof setInterval> | null = null;
  private log: WireEvent[] = [];
  private nextId = 1;
  private clients = new Set<Listener>();
  private watchers = new Set<() => void>();
  speed = 1;
  playing = false;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.timeline = compile(scenario);
  }

  get progress() {
    return { done: this.cursor, total: this.timeline.length, emitted: this.log.length };
  }

  get finished() {
    return this.cursor >= this.timeline.length;
  }

  /** Persisted events (what GET /sessions/:id/events would return). */
  history(untilId = Infinity): WireEvent[] {
    return this.log.filter((e) => e.id <= untilId);
  }

  /** Notified on every state change of the simulation (lab controls). */
  watch(fn: () => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  private changed() {
    for (const w of this.watchers) w();
  }

  private emit(type: WireType, data: Record<string, unknown>) {
    const ev: WireEvent = { id: this.nextId++, type, ts: Date.now(), data };
    if (type !== 'heartbeat') this.log.push(ev);
    for (const c of this.clients) c(ev, 'live');
  }

  private schedule() {
    if (!this.playing || this.finished) {
      if (this.finished) this.playing = false;
      this.changed();
      return;
    }
    const next = this.timeline[this.cursor]!;
    this.timer = setTimeout(() => {
      this.cursor += 1;
      this.emit(next.type, next.data);
      this.changed();
      this.schedule();
    }, next.delayMs / this.speed);
  }

  play() {
    if (this.playing || this.finished) return;
    this.playing = true;
    this.hb ??= setInterval(() => this.emit('heartbeat', {}), 15000);
    this.schedule();
  }

  pause() {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.changed();
  }

  /** Emits the next event now (while paused). */
  step() {
    if (this.playing || this.finished) return;
    const next = this.timeline[this.cursor++]!;
    this.emit(next.type, next.data);
    this.changed();
  }

  dispose() {
    this.pause();
    if (this.hb) clearInterval(this.hb);
    this.clients.clear();
    this.watchers.clear();
  }

  /**
   * Opens a client stream. With `lastEventId` the server replays what the
   * client missed; without it (a fresh join) it sends one snapshot built from
   * every event so far, in-flight blocks included.
   */
  connect(listener: Listener, lastEventId: number | null): () => void {
    if (lastEventId == null) {
      const state = reduceEvents(this.log);
      const lastId = this.log.at(-1)?.id ?? 0;
      listener(
        {
          id: lastId,
          type: 'snapshot',
          ts: Date.now(),
          data: { session: this.scenario.session, state },
        },
        'snapshot',
      );
    } else {
      for (const ev of this.log) if (ev.id > lastEventId) listener(ev, 'replay');
    }
    this.clients.add(listener);
    return () => this.clients.delete(listener);
  }
}

/** The event as it goes on the wire (text/event-stream). */
export function toSseFrame(ev: WireEvent): string {
  return `id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify({ ts: ev.ts, ...ev.data })}\n`;
}
