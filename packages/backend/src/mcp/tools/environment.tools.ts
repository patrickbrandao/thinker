import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PLATFORM_SETUP_SNIPPETS } from 'thinker-shared';
import { authOrigin } from '../../auth/auth.instance';
import { canWrite as operatorCanWrite, McpOperator } from '../mcp-auth';
import { McpToolDeps } from '../tool-deps';
import { ok, result } from '../tool-result';

/** The masked stand-in for an agent key in setup text — never a shell substitution. */
function maskedKeyRef(slug: string): string {
  // Pin the origin so the command targets the server that produced the setup,
  // not whatever host the CLI is configured for.
  return `<THINKER_AGENT_KEY — run: thinker agent key show ${slug} --raw --url ${authOrigin}>`;
}

/**
 * Render a platform's setup instructions. Templates come from thinker-shared —
 * the same source the dashboard and CLI render — so the wiring guidance cannot
 * drift between surfaces. Platforms with no first-class snippet get generic
 * OpenAI-compatible guidance.
 */
function renderSetup(platform: string | null, keyRef: string, canWrite: boolean): string {
  const template = platform ? PLATFORM_SETUP_SNIPPETS[platform] : undefined;
  if (template) {
    return template(`${authOrigin}/v1`, keyRef);
  }
  const lines = [
    "Point your tool's OpenAI-compatible client at Thinker:",
    `  base URL: ${authOrigin}/v1`,
    `  API key:  ${keyRef}`,
  ];
  // `thinker_agent_env` is a write tool, so only name it when it is available.
  if (canWrite) lines.push('Or wire it via env: use thinker_agent_env to get the export lines.');
  return lines.join('\n');
}

/**
 * Setup and environment tools, plus the operating guide. These mirror the CLI's
 * `agent setup`, `agent env`, and `skill show`. Both key-bearing tools require
 * mcp:write: even the CLI treats a key read as a privileged operation.
 */
export function registerEnvironmentTools(
  server: McpServer,
  deps: McpToolDeps,
  operator: McpOperator,
): void {
  const canWrite = operatorCanWrite(operator, 'admin');

  server.registerTool(
    'thinker_agent_setup',
    {
      title: 'Agent setup instructions',
      description:
        'Return platform setup instructions for a harness. The key is masked unless reveal is true (requires mcp:write).',
      inputSchema: z.object({ agent: z.string().min(1), reveal: z.boolean().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ agent: agentName, reveal }) =>
      result(
        (async () => {
          const info = await deps.lifecycle.findAgentInfo(operator.tenantId, agentName);
          if (!info) throw new Error(`Agent "${agentName}" not found`);
          let keyRef = maskedKeyRef(info.agent_name);
          if (reveal) {
            if (!canWrite) throw new Error('mcp:write scope is required to reveal the key');
            const key = await deps.apiKeys.getKeyForAgent(operator.tenantId, info.agent_name);
            if (!key.fullKey) throw new Error('No active key for this agent');
            keyRef = key.fullKey;
          }
          return {
            agent: info.agent_name,
            platform: info.agent_platform ?? null,
            setup: renderSetup(info.agent_platform ?? null, keyRef, canWrite),
            ...(!reveal && canWrite ? { hint: 'Pass reveal:true to embed the real key' } : {}),
          };
        })(),
      ),
  );

  if (!canWrite) return;

  server.registerTool(
    'thinker_agent_env',
    {
      title: 'Agent environment variables',
      description:
        'Return the dotenv/shell lines that point a harness at Thinker (THINKER_AGENT_KEY + THINKER_AGENT_URL).',
      inputSchema: z.object({ agent: z.string().min(1), export: z.boolean().optional() }),
    },
    async ({ agent: agentName, export: useExport }) =>
      result(
        (async () => {
          const info = await deps.lifecycle.findAgentInfo(operator.tenantId, agentName);
          if (!info) throw new Error(`Agent "${agentName}" not found`);
          const key = await deps.apiKeys.getKeyForAgent(operator.tenantId, info.agent_name);
          if (!key.fullKey) throw new Error('No active key for this agent');
          const prefix = useExport ? 'export ' : '';
          return {
            agent: info.agent_name,
            THINKER_AGENT_KEY: key.fullKey,
            THINKER_AGENT_URL: `${authOrigin}/v1`,
            lines: [
              `${prefix}THINKER_AGENT_KEY=${key.fullKey}`,
              `${prefix}THINKER_AGENT_URL=${authOrigin}/v1`,
            ],
          };
        })(),
      ),
  );
}

/**
 * The operating guide. An MCP client already sees the tool list; this returns
 * the higher-level workflow the CLI ships as its agent skill.
 */
export function registerGuideTool(server: McpServer): void {
  server.registerTool(
    'thinker_guide',
    {
      title: 'Thinker operating guide',
      description: 'Return the recommended workflow for managing a Thinker workspace.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      ok({
        workflow: [
          'Call thinker_doctor first when anything looks wrong — it separates a bad URL from a bad credential.',
          'Harnesses: thinker_agent_list, then thinker_agent_get. Create with thinker_agent_create; the returned key is shown once.',
          'Providers: thinker_provider_catalog lists what is connectable; thinker_provider_connect stores a tenant-wide connection and discovers its models.',
          'Routing: thinker_routing_status tells you whether a harness can route. Configure the default chain with the newer agent configure surface, or per-agent fallbacks with thinker_routing_fallbacks_set.',
          'Virtual models: public names a harness sends as model (e.g. "deepseek/flash"), each with its own chain and optional continue_on_default. thinker_routing_virtual_list, then _create/_update/_delete; thinker_routing_status lists them too.',
          'Model params (reasoning effort, temperature, …): thinker_routing_params_get lists what a route accepts and what is saved; thinker_routing_params_set saves values that override what the harness sends on routed requests (model "auto" or a virtual model name). Address the route by tier ("default") or by virtual (a virtual model name), and model.',
          'Verify end-to-end with thinker_routing_test — it sends one real request through the selected platform surface; pass a virtual model name as model to test that chain.',
          'A connection that is active with zero cached models is unusable; run thinker_provider_refresh.',
        ],
      }),
  );
}
