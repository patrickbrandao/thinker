import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  AUTH_TYPES,
  MAX_VIRTUAL_MODEL_FALLBACKS,
  RESPONSE_MODES,
  validateVirtualModelName,
  type VirtualModelRouteInput,
} from 'thinker-shared';
import { McpOperator, MCP_WRITE_SCOPE } from '../mcp-auth';
import { McpToolDeps } from '../tool-deps';
import { result } from '../tool-result';
import type { VirtualModel } from '../../entities/virtual-model.entity';

/**
 * A virtual model by id or by name. Names match ignoring case, the way the
 * proxy matches the request's `model` (ADR 0004, section 5).
 */
export async function findVirtualModel(
  deps: McpToolDeps,
  agentId: string,
  agentName: string,
  nameOrId: string,
): Promise<VirtualModel> {
  const rows = await deps.virtualModels.list(agentId);
  const wanted = nameOrId.toLowerCase();
  const hit =
    rows.find((r) => r.id === nameOrId) ?? rows.find((r) => r.name.toLowerCase() === wanted);
  if (!hit) {
    const names = rows.map((r) => r.name).join(', ');
    throw new Error(
      `Virtual model "${nameOrId}" not found for "${agentName}"` +
        (names ? ` (virtual models: ${names})` : ' (it has no virtual models)'),
    );
  }
  return hit;
}

/** The compact readback `thinker_routing_status` prints for each virtual model. */
export function summarizeVirtualModel(
  row: Pick<
    VirtualModel,
    | 'id'
    | 'name'
    | 'enabled'
    | 'override_route'
    | 'fallback_routes'
    | 'continue_on_default'
    | 'response_mode'
  >,
) {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    route: row.override_route ?? null,
    fallbacks: row.fallback_routes ?? [],
    continue_on_default: row.continue_on_default,
    response_mode: row.response_mode,
  };
}

const routeFields = {
  model: z.string().min(1).optional().describe('Primary model of the chain.'),
  provider: z
    .string()
    .min(1)
    .optional()
    .describe('Pin the primary to this provider when the model id is ambiguous.'),
  auth_type: z.enum(AUTH_TYPES).optional(),
  key_label: z
    .string()
    .min(1)
    .max(50)
    .optional()
    .describe("Use this provider key for the primary instead of the provider's default key."),
};

function primaryRoute(input: {
  model?: string;
  provider?: string;
  auth_type?: (typeof AUTH_TYPES)[number];
  key_label?: string;
}): VirtualModelRouteInput {
  return {
    model: input.model!,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.auth_type ? { authType: input.auth_type } : {}),
    ...(input.key_label ? { keyLabel: input.key_label } : {}),
  };
}

/**
 * Virtual models (ADR 0004): public model names a harness sends in `model`,
 * each with its own chain (primary + up to 5 fallbacks) and an optional
 * "continue on Default". Same services as the dashboard and the CLI, so the
 * strict write-time route validation and the 400/404/409 messages are theirs.
 */
export function registerVirtualModelTools(
  server: McpServer,
  deps: McpToolDeps,
  operator: McpOperator,
): void {
  const canWrite = operator.scopes.has(MCP_WRITE_SCOPE);

  server.registerTool(
    'thinker_routing_virtual_list',
    {
      title: 'List virtual models',
      description:
        'List a harness’s virtual models: names it can send as `model` (and that GET /v1/models ' +
        'lists after auto), each with its chain, continue_on_default, enabled state, the real ' +
        'model ids it shadows, and its context_length.',
      inputSchema: z.object({ agent: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ agent: agentName }) =>
      result(
        (async () => {
          const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
          return { virtual_models: await deps.virtualModels.listViews(agent.id, agent.tenant_id) };
        })(),
      ),
  );

  if (!canWrite) return;

  server.registerTool(
    'thinker_routing_virtual_create',
    {
      title: 'Create a virtual model',
      description:
        'Create a virtual model: a public name (1-64 chars of A-Z a-z 0-9 . _ : - and inner /, ' +
        'unique per harness ignoring case, "auto" reserved) that routes through its own chain. ' +
        'model is the primary, fallbacks (max 5) follow it in order, and continue_on_default ' +
        'appends the Default chain after them. Every route must resolve to a model the ' +
        "harness's providers offer. A name equal to a real model id shadows it while enabled.",
      inputSchema: z.object({
        agent: z.string().min(1),
        name: z.string().min(1).max(64),
        ...routeFields,
        fallbacks: z.array(z.string().min(1)).max(MAX_VIRTUAL_MODEL_FALLBACKS).optional(),
        continue_on_default: z.boolean().optional(),
        response_mode: z.enum(RESPONSE_MODES).optional(),
      }),
    },
    async ({ agent: agentName, name, fallbacks, continue_on_default, response_mode, ...route }) =>
      result(
        (async () => {
          const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
          if (!route.model && (route.provider || route.auth_type || route.key_label)) {
            throw new Error('provider, auth_type and key_label need a model');
          }
          if (fallbacks && fallbacks.length > 0 && !route.model) {
            // Fallbacks with no primary are cleared with it everywhere else
            // (clearing the primary drops them), so reject the shape here.
            throw new Error('fallbacks require a model (the primary route)');
          }
          const created = await deps.virtualModels.create(agent.id, agent.tenant_id, {
            name,
            override_route: route.model ? primaryRoute(route) : null,
            fallback_routes: (fallbacks ?? []).map((model) => ({ model })),
            ...(continue_on_default !== undefined ? { continue_on_default } : {}),
            ...(response_mode ? { response_mode } : {}),
          });
          return { virtual_model: created };
        })(),
      ),
  );

  server.registerTool(
    'thinker_routing_virtual_update',
    {
      title: 'Update a virtual model',
      description:
        'Change a virtual model, found by name (ignoring case) or id. Only the fields you pass ' +
        'change. model replaces the primary and keeps the fallbacks; fallbacks replaces the ' +
        'fallback list ([] clears it); clear_model removes the primary and its fallbacks. ' +
        'enabled:false hides the name from /v1/models and stops it from shadowing a real model. ' +
        'The changes are applied one after another, routes first; if a later one fails, the ' +
        'error lists the ones already applied.',
      inputSchema: z.object({
        agent: z.string().min(1),
        virtual: z.string().min(1).describe('Name or id of the virtual model to change.'),
        name: z.string().min(1).max(64).optional().describe('New name.'),
        ...routeFields,
        fallbacks: z.array(z.string().min(1)).max(MAX_VIRTUAL_MODEL_FALLBACKS).optional(),
        clear_model: z.boolean().optional(),
        continue_on_default: z.boolean().optional(),
        response_mode: z.enum(RESPONSE_MODES).optional(),
        enabled: z.boolean().optional(),
      }),
    },
    async ({
      agent: agentName,
      virtual,
      name,
      fallbacks,
      clear_model,
      continue_on_default,
      response_mode,
      enabled,
      ...route
    }) =>
      result(
        (async () => {
          const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
          if (!route.model && (route.provider || route.auth_type || route.key_label)) {
            throw new Error('provider, auth_type and key_label need a model');
          }
          if (clear_model && (route.model || (fallbacks && fallbacks.length > 0))) {
            throw new Error('clear_model cannot be combined with model or fallbacks');
          }
          const nothing =
            name === undefined &&
            route.model === undefined &&
            fallbacks === undefined &&
            !clear_model &&
            continue_on_default === undefined &&
            response_mode === undefined &&
            enabled === undefined;
          if (nothing) throw new Error('Nothing to change');

          const row = await findVirtualModel(deps, agent.id, agentName, virtual);
          if (fallbacks && fallbacks.length > 0 && !route.model && !row.override_route) {
            throw new Error('fallbacks require a model (the primary route)');
          }

          // The cheap checks run before any write: the new name's format and
          // its uniqueness among this agent's virtual models.
          if (name !== undefined) {
            const checked = validateVirtualModelName(name);
            if (!checked.ok) throw new Error(checked.error);
            const siblings = await deps.virtualModels.list(agent.id);
            const lower = checked.name.toLowerCase();
            if (siblings.some((r) => r.id !== row.id && r.name.toLowerCase() === lower)) {
              throw new Error(
                `A virtual model named "${checked.name}" already exists on this agent`,
              );
            }
          }

          // The writes are separate service calls, not one transaction. Route
          // writes go first: they carry the strict catalog validation and are
          // the likeliest to fail, so a rejected route leaves the name and
          // flags untouched. The response mode follows them because its stream
          // guard checks the chain as it ends up. A failure after an earlier
          // step succeeded says which steps were already applied.
          const applied: string[] = [];
          const step = async (label: string, write: () => Promise<unknown>): Promise<void> => {
            try {
              await write();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              throw new Error(
                applied.length > 0
                  ? `${message} (already applied to "${row.name}": ${applied.join(', ')})`
                  : message,
              );
            }
            applied.push(label);
          };
          if (clear_model) {
            await step('clear_model', () => deps.virtualModels.clearOverride(agent.id, row.id));
          } else if (route.model) {
            await step('model', () =>
              deps.virtualModels.setOverride(
                agent.id,
                agent.tenant_id,
                row.id,
                primaryRoute(route),
              ),
            );
          }
          if (fallbacks !== undefined) {
            if (fallbacks.length > 0) {
              await step('fallbacks', () =>
                deps.virtualModels.setFallbacks(agent.id, agent.tenant_id, row.id, fallbacks),
              );
            } else if (!clear_model) {
              await step('fallbacks', () => deps.virtualModels.clearFallbacks(agent.id, row.id));
            }
          }
          if (response_mode !== undefined) {
            await step('response_mode', () =>
              deps.virtualModels.setResponseMode(agent.id, agent.tenant_id, row.id, response_mode),
            );
          }
          if (name !== undefined || continue_on_default !== undefined) {
            await step(
              [
                name !== undefined ? 'name' : '',
                continue_on_default !== undefined ? 'continue_on_default' : '',
              ]
                .filter(Boolean)
                .join(', '),
              () =>
                deps.virtualModels.update(agent.id, agent.tenant_id, row.id, {
                  ...(name !== undefined ? { name } : {}),
                  ...(continue_on_default !== undefined ? { continue_on_default } : {}),
                }),
            );
          }
          if (enabled !== undefined) {
            await step('enabled', () =>
              deps.virtualModels.setEnabled(agent.id, agent.tenant_id, row.id, enabled),
            );
          }
          const views = await deps.virtualModels.listViews(agent.id, agent.tenant_id);
          return { virtual_model: views.find((v) => v.id === row.id) ?? null };
        })(),
      ),
  );

  server.registerTool(
    'thinker_routing_virtual_delete',
    {
      title: 'Delete a virtual model',
      description:
        'Delete a virtual model, found by name (ignoring case) or id, with the model params ' +
        'saved for its chain. Requests that send its name then resolve as a real model id, or fail.',
      inputSchema: z.object({
        agent: z.string().min(1),
        virtual: z.string().min(1).describe('Name or id of the virtual model to delete.'),
      }),
    },
    async ({ agent: agentName, virtual }) =>
      result(
        (async () => {
          const agent = await deps.resolveAgent.resolve(operator.tenantId, agentName);
          const row = await findVirtualModel(deps, agent.id, agentName, virtual);
          await deps.virtualModels.delete(agent.id, row.id);
          return { ok: true, deleted: { id: row.id, name: row.name } };
        })(),
      ),
  );
}
