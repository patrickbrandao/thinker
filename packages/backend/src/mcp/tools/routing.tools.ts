import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { PLATFORM_API_SURFACES, type JsonValue } from 'thinker-shared';
import { authOrigin } from '../../auth/auth.instance';
import { canWrite as operatorCanWrite, McpOperator } from '../mcp-auth';
import { McpToolDeps } from '../tool-deps';
import { result } from '../tool-result';
import { resolveRoutingStatus } from '../../routing/routing-status';
import {
  describeUnresolvedModel,
  matchesModelName,
  resolveModelRoute,
} from '../../routing/routing-core/resolve-model-route';
import type { RouteParamsTarget } from '../../routing/model-params/route-model-params.service';
import { registerVirtualModelTools, summarizeVirtualModel } from './virtual-models.tools';

const AUTH_TYPES = ['api_key', 'subscription', 'local'] as const;
const ROUTE_TEST_TIMEOUT_MS = 120_000;

/** --models states the whole chain: extra entries set fallbacks, a lone entry clears them. */
async function setOrClear<T>(
  set: () => Promise<T>,
  clear: () => Promise<void>,
  fallbacks: string[],
): Promise<T | []> {
  if (fallbacks.length > 0) return set();
  await clear();
  return [];
}

interface SurfaceResult {
  reply: string;
  servedModel: string | null;
  tokens?: number;
}

function parseCompletionSurface(parsed: Record<string, unknown>): SurfaceResult {
  const choice = (parsed['choices'] as Array<Record<string, unknown>> | undefined)?.[0];
  const message = choice?.['message'] as { content?: string } | undefined;
  const usage = parsed['usage'] as
    { prompt_tokens?: number; completion_tokens?: number } | undefined;
  return {
    reply: message?.content ?? '',
    servedModel: typeof parsed['model'] === 'string' ? parsed['model'] : null,
    ...(usage?.prompt_tokens !== undefined
      ? { tokens: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) }
      : {}),
  };
}

function parseMessagesSurface(parsed: Record<string, unknown>): SurfaceResult {
  const blocks = parsed['content'] as Array<Record<string, unknown>> | undefined;
  const textBlock = blocks?.find((b) => b['type'] === 'text');
  const usage = parsed['usage'] as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    reply: typeof textBlock?.['text'] === 'string' ? (textBlock['text'] as string) : '',
    servedModel: typeof parsed['model'] === 'string' ? parsed['model'] : null,
    ...(usage?.input_tokens !== undefined
      ? { tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) }
      : {}),
  };
}

function parseResponsesSurface(parsed: Record<string, unknown>): SurfaceResult {
  const output = parsed['output'] as Array<Record<string, unknown>> | undefined;
  let reply = '';
  for (const item of output ?? []) {
    if (item['type'] !== 'message') continue;
    const content = item['content'] as Array<Record<string, unknown>> | undefined;
    for (const part of content ?? []) {
      if (part['type'] === 'output_text' && typeof part['text'] === 'string') reply += part['text'];
    }
  }
  const usage = parsed['usage'] as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    reply,
    servedModel: typeof parsed['model'] === 'string' ? parsed['model'] : null,
    ...(usage?.input_tokens !== undefined
      ? { tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) }
      : {}),
  };
}

/**
 * `tier` and `virtual` are separate selectors (ADR 0004, section 9): a tier
 * and a virtual model may share a name, so neither may stand in for the other.
 */
function paramsTarget(tier?: string, virtual?: string): string | RouteParamsTarget | undefined {
  if (tier !== undefined && virtual !== undefined) {
    throw new Error('Pass tier or virtual, not both');
  }
  return virtual !== undefined ? { virtual } : tier;
}

function hasSurfacePayload(surface: string, parsed: Record<string, unknown>): boolean {
  const nonEmpty = (value: unknown): boolean => Array.isArray(value) && value.length > 0;
  if (surface === 'messages') return nonEmpty(parsed['content']);
  if (surface === 'responses') return nonEmpty(parsed['output']);
  return nonEmpty(parsed['choices']);
}

/**
 * Routing tools: readiness, default-tier fallbacks, per-agent recording
 * switch and the virtual models. A virtual model is a public name the harness
 * sends as `model` (see virtual-models.tools.ts).
 */
export function registerRoutingTools(
  server: McpServer,
  deps: McpToolDeps,
  operator: McpOperator,
): void {
  const canWrite = operatorCanWrite(operator, 'admin');
  server.registerTool(
    'thinker_routing_status',
    {
      title: 'Routing status',
      description:
        'Report whether a harness can route, and why not. enabled and reason refer to requests ' +
        'with model "auto" (status_for: "auto"); routes_by_virtual_model and ' +
        'active_virtual_models say whether requests naming a virtual model can route, and ' +
        'reason is "auto_not_routable" when only those can (auto_reason then keeps why auto ' +
        'cannot). Also lists the virtual models ' +
        '(names the harness can send as `model`) with their chains.',
      inputSchema: z.object({ agent: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ agent: agentName }) =>
      result(
        (async () => {
          const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
          const [status, virtualModels] = await Promise.all([
            resolveRoutingStatus({
              providers: await deps.providers.getProviders(agent.tenant_id),
              hasRoutableTier: () => deps.tiers.hasRoutableTier(agent.id),
              pricingCacheSize: () => deps.pricingSync.getAll().size,
            }),
            deps.virtualModels.listViews(agent.id, agent.tenant_id),
          ]);
          // The shared RoutingStatus (also served to the dashboard) answers
          // for "auto" only. With no active provider nothing routes, virtual
          // models included.
          // `routable` is computed on the chain the proxy builds (own routes,
          // then only the `default` slot's chain), from the catalog snapshot
          // and the agent's provider records, as the proxy judges availability.
          const active =
            status.reason === 'no_provider'
              ? []
              : virtualModels.filter((v) => v.routable === true).map((v) => v.name);
          const onlyVirtual = !status.enabled && active.length > 0;
          return {
            status_for: 'auto' as const,
            enabled: status.enabled,
            reason: onlyVirtual ? 'auto_not_routable' : status.reason,
            // Why auto cannot route, kept when the reason above is replaced.
            ...(onlyVirtual ? { auto_reason: status.reason } : {}),
            routes_by_virtual_model: active.length > 0,
            active_virtual_models: active,
            virtual_models: virtualModels.map(summarizeVirtualModel),
          };
        })(),
      ),
  );

  server.registerTool(
    'thinker_routing_fallbacks_get',
    {
      title: 'Get fallbacks',
      description: 'Read the fallback chain of a tier (default tier by default).',
      inputSchema: z.object({ agent: z.string().min(1), tier: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ agent: agentName, tier }) =>
      result(
        (async () => {
          const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
          return { fallbacks: await deps.tiers.getFallbacks(agent.id, tier ?? 'default') };
        })(),
      ),
  );

  if (canWrite)
    server.registerTool(
      'thinker_routing_fallbacks_set',
      {
        title: 'Set fallbacks',
        description: 'Replace the fallback chain of a tier. One entry clears the rest.',
        inputSchema: z.object({
          agent: z.string().min(1),
          models: z.array(z.string().min(1)).max(5),
          tier: z.string().min(1).optional(),
        }),
      },
      async ({ agent: agentName, models, tier }) =>
        result(
          (async () => {
            const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
            const fallbacks = await deps.tiers.setFallbacks(
              agent.id,
              agent.tenant_id,
              tier ?? 'default',
              models,
            );
            return { fallbacks };
          })(),
        ),
    );

  if (canWrite)
    server.registerTool(
      'thinker_routing_fallbacks_clear',
      {
        title: 'Clear fallbacks',
        description: 'Remove the fallback chain from a tier.',
        inputSchema: z.object({ agent: z.string().min(1), tier: z.string().min(1).optional() }),
      },
      async ({ agent: agentName, tier }) =>
        result(
          (async () => {
            const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
            await deps.tiers.clearFallbacks(agent.id, tier ?? 'default');
            return { ok: true };
          })(),
        ),
    );

  server.registerTool(
    'thinker_routing_params_get',
    {
      title: 'Get model params',
      description:
        'List the params a routed model accepts (type, allowed values, description) with their saved ' +
        'values, e.g. reasoning.effort or temperature. Address the route by tier ("default") ' +
        'or by virtual (a virtual model name), not both; model defaults to the ' +
        'primary and may name one of its fallbacks. Routes a virtual model borrows from the ' +
        'Default chain use the default tier params. current: null means the provider default applies.',
      inputSchema: z.object({
        agent: z.string().min(1),
        tier: z.string().min(1).optional(),
        virtual: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ agent: agentName, tier, virtual, model }) =>
      result(
        (async () => {
          const target = paramsTarget(tier, virtual);
          const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
          return deps.routeModelParams.get(agent.id, target, model, agent.tenant_id);
        })(),
      ),
  );

  if (canWrite)
    server.registerTool(
      'thinker_routing_params_set',
      {
        title: 'Set model params',
        description:
          'Set or unset params on a routed model. Saved params override the values the caller sends ' +
          'on routed requests (model "auto" or a virtual model name); ' +
          'a request naming a concrete model skips them. Address the route by tier or by ' +
          'virtual, not both. ' +
          'set maps a param path to its value ({"reasoning.effort": "high"}); unset lists paths to ' +
          'remove. Other saved params are kept. Read thinker_routing_params_get first for valid paths.',
        inputSchema: z.object({
          agent: z.string().min(1),
          tier: z.string().min(1).optional(),
          virtual: z.string().min(1).optional(),
          model: z.string().min(1).optional(),
          set: z.record(z.string().min(1), z.unknown()).optional(),
          unset: z.array(z.string().min(1)).max(50).optional(),
        }),
      },
      async ({ agent: agentName, tier, virtual, model, set, unset }) =>
        result(
          (async () => {
            const target = paramsTarget(tier, virtual);
            const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
            return deps.routeModelParams.update(
              agent.id,
              target,
              model,
              { set: set as Record<string, JsonValue> | undefined, unset },
              agent.tenant_id,
            );
          })(),
        ),
    );

  server.registerTool(
    'thinker_routing_recording_get',
    {
      title: 'Get recording state',
      description: 'Report whether request recording is on for a harness.',
      inputSchema: z.object({ agent: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ agent: agentName }) =>
      result(
        (async () => {
          const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
          return { enabled: await deps.recording.isRecording(agent.id) };
        })(),
      ),
  );

  if (canWrite)
    server.registerTool(
      'thinker_routing_recording_set',
      {
        title: 'Set recording state',
        description: 'Turn request recording on or off for a harness.',
        inputSchema: z.object({ agent: z.string().min(1), enabled: z.boolean() }),
      },
      async ({ agent: agentName, enabled }) =>
        result(
          (async () => {
            const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
            await deps.agentRepo.update(agent.id, { record_messages: enabled });
            deps.resolveAgent.invalidate(agent.tenant_id, agentName);
            return { enabled };
          })(),
        ),
    );

  if (canWrite)
    server.registerTool(
      'thinker_routing_test',
      {
        title: 'Test a route end-to-end',
        description:
          'Send one real request through the harness route and the platform surface it uses. ' +
          'model defaults to "auto" and may be a virtual model name or a concrete model id; the ' +
          'result reports the routing reason and, for a virtual model, its name. Spends provider tokens.',
        inputSchema: z.object({
          agent: z.string().min(1),
          prompt: z.string().min(1).optional(),
          model: z
            .string()
            .min(1)
            .optional()
            .describe('"auto" (default), a virtual model name, or a concrete model id.'),
          as: z.string().min(1).optional().describe('Force a platform surface (e.g. claude-code).'),
        }),
      },
      async ({ agent: agentName, prompt, model, as: platformOverride }) =>
        result(
          (async () => {
            const info = await deps.lifecycle.findAgentInfo(operator.tenantId, agentName);
            if (!info) throw new Error(`Agent "${agentName}" not found`);
            if (
              platformOverride !== undefined &&
              !Object.prototype.hasOwnProperty.call(PLATFORM_API_SURFACES, platformOverride)
            ) {
              throw new Error(`Unknown platform: ${platformOverride}`);
            }
            const platform = platformOverride ?? info.agent_platform ?? undefined;
            const surface =
              (platform
                ? (PLATFORM_API_SURFACES as Record<string, string>)[platform]
                : undefined) ?? 'chat_completions';
            const key = await deps.apiKeys.getKeyForAgent(operator.tenantId, info.agent_name);
            if (!key.fullKey) throw new Error('No active key for this agent');

            const endpoint =
              surface === 'messages'
                ? `${authOrigin}/v1/messages`
                : surface === 'responses'
                  ? `${authOrigin}/v1/responses`
                  : `${authOrigin}/v1/chat/completions`;
            const text = prompt ?? 'Reply with exactly: OK';
            const requestedModel = model ?? 'auto';
            const body =
              surface === 'messages'
                ? {
                    model: requestedModel,
                    max_tokens: 64,
                    messages: [{ role: 'user', content: text }],
                  }
                : surface === 'responses'
                  ? { model: requestedModel, input: text }
                  : { model: requestedModel, messages: [{ role: 'user', content: text }] };

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), ROUTE_TEST_TIMEOUT_MS);
            const started = Date.now();
            let response: Response;
            let raw: string;
            try {
              response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${key.fullKey}`,
                  'Content-Type': 'application/json',
                  ...(surface === 'messages' ? { 'anthropic-version': '2023-06-01' } : {}),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
              });
              raw = await response.text();
            } finally {
              clearTimeout(timer);
            }
            const durationMs = Date.now() - started;

            let parsed: Record<string, unknown> = {};
            let parsedOk = false;
            try {
              const value: unknown = JSON.parse(raw);
              if (typeof value === 'object' && value !== null) {
                parsed = value as Record<string, unknown>;
                parsedOk = true;
              }
            } catch {
              /* non-JSON body → handled below */
            }
            if (!response.ok) {
              const message = (parsed['error'] as { message?: string } | undefined)?.message;
              throw new Error(message ?? `Route test failed with HTTP ${response.status}`);
            }
            if (!parsedOk || !hasSurfacePayload(surface, parsed)) {
              throw new Error(`Route test got HTTP ${response.status} but no ${surface} payload`);
            }
            const surfaceResult =
              surface === 'messages'
                ? parseMessagesSurface(parsed)
                : surface === 'responses'
                  ? parseResponsesSurface(parsed)
                  : parseCompletionSurface(parsed);
            if (/^\[🦚 Thinker M\d+\]/.test(surfaceResult.reply)) {
              throw new Error(surfaceResult.reply);
            }
            // How the proxy routed it: `virtual-model` plus the stored name
            // when `model` matched an enabled virtual model (ADR 0004, §8).
            const routingReason = response.headers.get('x-thinker-reason');
            const virtualModel = response.headers.get('x-thinker-virtual-model');
            return {
              agent: info.agent_name,
              ok: true,
              surface,
              ...(platform ? { platform } : {}),
              requested_model: requestedModel,
              ...(routingReason ? { routing_reason: routingReason } : {}),
              ...(virtualModel ? { virtual_model: virtualModel } : {}),
              served_model: surfaceResult.servedModel,
              duration_ms: durationMs,
              ...(surfaceResult.tokens !== undefined ? { tokens: surfaceResult.tokens } : {}),
              reply: surfaceResult.reply,
            };
          })(),
        ),
    );

  if (canWrite)
    server.registerTool(
      'thinker_agent_configure',
      {
        title: 'Configure an agent',
        description:
          'Set the default route and fallback chain, and/or toggle recording. `models` is the full chain: first is the route, the rest are fallbacks.',
        inputSchema: z.object({
          agent: z.string().min(1),
          models: z.array(z.string().min(1)).min(1).max(6).optional(),
          provider: z.string().min(1).optional(),
          auth_type: z.enum(AUTH_TYPES).optional(),
          key_label: z.string().min(1).max(50).optional(),
          recording: z.boolean().optional(),
          force: z.boolean().optional().describe('Skip the discovered-model check.'),
        }),
      },
      async ({ agent: agentName, models, provider, auth_type, key_label, recording, force }) =>
        result(
          (async () => {
            const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
            const output: Record<string, unknown> = { agent: agentName };
            const wantsRoute =
              models !== undefined ||
              provider !== undefined ||
              auth_type !== undefined ||
              key_label !== undefined;
            if (!wantsRoute && recording === undefined) {
              throw new Error('Nothing to configure — pass models + provider and/or recording');
            }

            if (wantsRoute) {
              if (!models || models.length === 0 || !provider) {
                throw new Error('models and provider are required together');
              }
              const primary = models[0];
              const fallbacks = models.slice(1);
              const available = await deps.modelDiscovery.getModelsForAgent(
                agent.tenant_id,
                agent.id,
              );
              // Resolve the route the way it will be stored: scoped to its
              // provider, and to its auth type when one was given.
              const primaryRoute = resolveModelRoute(primary, available, {
                provider,
                authType: auth_type,
              });
              if (!force) {
                if (!primaryRoute.ok) {
                  throw new Error(
                    `${describeUnresolvedModel(primary, primaryRoute.reason, available, {
                      provider,
                      authType: auth_type,
                    })} Refresh models or pass force:true.`,
                  );
                }
                const missing = fallbacks.filter(
                  (name) => !available.some((m) => matchesModelName(m, name)),
                );
                if (missing.length > 0) {
                  throw new Error(
                    `Not in the models discovered for "${agentName}": ${missing.join(', ')}. ` +
                      'Refresh models or pass force:true.',
                  );
                }
              }
              // An omitted auth_type follows discovery, so a subscription model
              // is never stored as a metered api_key route.
              const authType =
                auth_type ?? (primaryRoute.ok ? primaryRoute.route.authType : 'api_key');
              output['route'] = await deps.tiers.setOverride(
                agent.id,
                agent.tenant_id,
                'default',
                primary,
                provider,
                authType,
                key_label,
              );
              output['fallbacks'] = await setOrClear(
                () => deps.tiers.setFallbacks(agent.id, agent.tenant_id, 'default', fallbacks),
                () => deps.tiers.clearFallbacks(agent.id, 'default'),
                fallbacks,
              );
            }
            if (recording !== undefined) {
              await deps.agentRepo.update(agent.id, { record_messages: recording });
              deps.resolveAgent.invalidate(agent.tenant_id, agentName);
              output['recording'] = { enabled: recording };
            }
            return output;
          })(),
        ),
    );

  registerVirtualModelTools(server, deps, operator);
}
