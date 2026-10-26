import { CliIo, clientFromFlags, printJson } from '../context';
import { resolveAgentKey } from './agent';
import { PLATFORM_CATALOG } from '../provider-catalog.gen';
import { slugifyAgentName } from '../slug';
import { CliError } from '../errors';
import {
  ParsedArgs,
  parseArgs,
  parseBooleanFlag,
  requirePositional,
  requireString,
  requireYes,
} from '../args';
import { ApiClient } from '../client';
import { assertModelsDiscovered } from './model-check';
import { CLI_USER_AGENT } from '../version';

const URL_ONLY = { strings: ['url'] } as const;

/**
 * The CLI exposes only the routing surfaces Thinker keeps long-term:
 * the DEFAULT route (one model + fallbacks), CUSTOM header-triggered tiers
 * and VIRTUAL models (public names a harness sends as `model`). The
 * deprecated complexity tiers (simple/standard/complex/reasoning) are
 * deliberately absent.
 */

function agentPath(agent: string, suffix: string): string {
  return `/routing/${encodeURIComponent(agent)}${suffix}`;
}

function parseModelsList(raw: string): string[] {
  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new CliError('missing_flag', '--fallbacks must be a comma-separated list of model ids');
  }
  return models;
}

interface TierAssignmentRow {
  tier?: string;
  override_route?: unknown;
  fallback_routes?: unknown;
}

interface VirtualModelListRow {
  name?: string;
  routable?: boolean;
  enabled?: boolean;
  override_route?: unknown;
  fallback_routes?: unknown;
  continue_on_default?: boolean;
  response_mode?: string;
  shadows?: unknown;
}

interface HeaderTierListRow {
  name?: string;
  header_key?: string;
  header_value?: string;
  enabled?: boolean;
  override_route?: unknown;
  fallback_routes?: unknown;
}

/**
 * The composite readback for everything `agent configure` writes: default
 * route + fallbacks, custom tiers with their triggers and routes, virtual
 * models with their chains, and the recording toggle. (The backend's /status endpoint only reports the
 * deprecated complexity-routing flag, so this composes the real config.)
 */
export async function routingStatus(io: CliIo, argv: string[]): Promise<void> {
  const args = parseArgs(argv, { ...URL_ONLY, maxPositionals: 1 });
  const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
  const { client } = clientFromFlags(io, args);

  const [tiers, customTiers, virtualModels, recording] = await Promise.all([
    client.request('GET', agentPath(agent, '/tiers')),
    client.request('GET', agentPath(agent, '/header-tiers')),
    client.request('GET', agentPath(agent, '/virtual-models')),
    client.request('GET', agentPath(agent, '/recording')),
  ]);

  const defaultTier = (Array.isArray(tiers) ? tiers : [])
    .filter((t): t is TierAssignmentRow => typeof t === 'object' && t !== null)
    .find((t) => t.tier === 'default');

  const custom = (Array.isArray(customTiers) ? customTiers : [])
    .filter((t): t is HeaderTierListRow => typeof t === 'object' && t !== null)
    .map((t) => ({
      name: t.name,
      trigger: `${t.header_key}: ${t.header_value}`,
      enabled: t.enabled,
      route: t.override_route ?? null,
      fallbacks: t.fallback_routes ?? [],
    }));

  const virtual = (Array.isArray(virtualModels) ? virtualModels : [])
    .filter((v): v is VirtualModelListRow => typeof v === 'object' && v !== null)
    .map((v) => ({
      name: v.name,
      enabled: v.enabled,
      route: v.override_route ?? null,
      fallbacks: v.fallback_routes ?? [],
      continue_on_default: v.continue_on_default ?? false,
      response_mode: v.response_mode,
      shadows: Array.isArray(v.shadows) ? v.shadows : [],
    }));

  // The server decides `routable` on the chain the proxy builds (own routes,
  // then only the `default` slot's chain with continue_on_default) from the
  // agent's catalog, so the CLI and the MCP status agree.
  const activeVirtual = (Array.isArray(virtualModels) ? virtualModels : [])
    .filter(
      (v): v is VirtualModelListRow =>
        typeof v === 'object' && v !== null && (v as VirtualModelListRow).routable === true,
    )
    .map((v) => v.name);

  printJson(io, {
    agent,
    default: {
      route: defaultTier?.override_route ?? null,
      fallbacks: defaultTier?.fallback_routes ?? [],
    },
    custom_tiers: custom,
    virtual_models: virtual,
    // `default` is what model "auto" routes to; these say whether requests
    // naming a virtual model route even when it is empty.
    routes_by_virtual_model: activeVirtual.length > 0,
    active_virtual_models: activeVirtual,
    recording: (recording as { enabled?: boolean } | null)?.enabled ?? null,
  });
}

export async function routingFallbacksGet(io: CliIo, argv: string[]): Promise<void> {
  const args = parseArgs(argv, { ...URL_ONLY, maxPositionals: 1 });
  const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
  const { client } = clientFromFlags(io, args);
  printJson(io, await client.request('GET', agentPath(agent, '/tiers/default/fallbacks')));
}

export async function routingFallbacksClear(io: CliIo, argv: string[]): Promise<void> {
  const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 1 });
  const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
  requireYes(args, `clear the default-route fallbacks of "${agent}"`);
  const { client } = clientFromFlags(io, args);
  printJson(io, await client.request('DELETE', agentPath(agent, '/tiers/default/fallbacks')));
}

interface HeaderTierRow {
  id?: string;
  name?: string;
}

async function findCustomTier(
  client: ApiClient,
  agent: string,
  nameOrId: string,
): Promise<{ id: string; name: string }> {
  const rows = (await client.request('GET', agentPath(agent, '/header-tiers'))) as unknown;
  const list = (Array.isArray(rows) ? rows : []).filter(
    (t): t is HeaderTierRow => typeof t === 'object' && t !== null,
  );
  const needle = nameOrId.toLowerCase();
  const hit = list.find(
    (t) => t.id === nameOrId || (typeof t.name === 'string' && t.name.toLowerCase() === needle),
  );
  if (!hit?.id) {
    throw new CliError(
      'not_found',
      `No custom tier "${nameOrId}" on agent "${agent}"`,
      'See thinker routing custom list',
      404,
    );
  }
  return { id: hit.id, name: typeof hit.name === 'string' ? hit.name : hit.id };
}

export const routingCustom = {
  list: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, { ...URL_ONLY, maxPositionals: 1 });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('GET', agentPath(agent, '/header-tiers')));
  },

  /**
   * Create a custom tier and route it in one command. The tier triggers on
   * `<header-key>: <header-value>` (defaults: x-thinker-tier: <name>), so a
   * caller opts in per request with a single header.
   *
   * Models are validated against the agent's discovered set — the same gate
   * `agent configure` applies, so the two ways of writing a route cannot
   * disagree — and the check runs BEFORE the tier is created so a typo does
   * not leave an unrouted tier behind. --force skips it.
   */
  create: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, {
      strings: [
        'url',
        'name',
        'model',
        'provider',
        'auth-type',
        'fallbacks',
        'header-key',
        'header-value',
      ],
      booleans: ['force'],
      maxPositionals: 1,
    });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const name = requireString(args, 'name');
    const model = requireString(args, 'model');
    const provider = requireString(args, 'provider');
    const fallbackModels = args.strings['fallbacks']
      ? parseModelsList(args.strings['fallbacks'])
      : [];
    const { client } = clientFromFlags(io, args);
    const normalized = await assertModelsDiscovered(
      client,
      agent,
      [model, ...fallbackModels],
      Boolean(args.booleans['force']),
      provider,
      args.strings['auth-type'] ?? 'api_key',
    );
    const routeModel = normalized[0];
    const normalizedFallbacks = normalized.slice(1);

    const tier = (await client.request('POST', agentPath(agent, '/header-tiers'), {
      body: {
        name,
        header_key: args.strings['header-key'] ?? 'x-thinker-tier',
        header_value: args.strings['header-value'] ?? name,
        badge_color: 'indigo',
      },
    })) as { id: string };

    const route = { model: routeModel, provider, authType: args.strings['auth-type'] ?? 'api_key' };
    let routeResult: unknown;
    let fallbacks: unknown;
    try {
      routeResult = await client.request(
        'PUT',
        agentPath(agent, `/header-tiers/${encodeURIComponent(tier.id)}/override`),
        { body: route },
      );
      if (normalizedFallbacks.length > 0) {
        fallbacks = await client.request(
          'PUT',
          agentPath(agent, `/header-tiers/${encodeURIComponent(tier.id)}/fallbacks`),
          { body: { models: normalizedFallbacks } },
        );
      }
    } catch (error) {
      // Roll back the tier so a failed route-write does not leave an enabled,
      // unrouted tier behind. Best-effort: surface the original error.
      await client
        .request('DELETE', agentPath(agent, `/header-tiers/${encodeURIComponent(tier.id)}`))
        .catch(() => undefined);
      throw error;
    }
    printJson(io, {
      agent,
      tier,
      route: routeResult,
      ...(fallbacks !== undefined ? { fallbacks } : {}),
    });
  },

  delete: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 2 });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const nameOrId = requirePositional(args, 1, '<tier-name-or-id>');
    const { client } = clientFromFlags(io, args);
    const tier = await findCustomTier(client, agent, nameOrId);
    requireYes(args, `delete custom tier "${tier.name}" of "${agent}"`);
    printJson(
      io,
      await client.request(
        'DELETE',
        agentPath(agent, `/header-tiers/${encodeURIComponent(tier.id)}`),
      ),
    );
  },
};

interface VirtualModelRow {
  id?: string;
  name?: string;
  override_route?: unknown;
}

const RESPONSE_MODES = ['buffered', 'stream'] as const;

/** A virtual model by id or by name, ignoring case like the proxy does. */
async function findVirtualModel(
  client: ApiClient,
  agent: string,
  nameOrId: string,
): Promise<{ id: string; name: string; hasPrimary: boolean; otherNames: string[] }> {
  const rows = (await client.request('GET', agentPath(agent, '/virtual-models'))) as unknown;
  const list = (Array.isArray(rows) ? rows : []).filter(
    (v): v is VirtualModelRow => typeof v === 'object' && v !== null,
  );
  const needle = nameOrId.toLowerCase();
  const hit =
    list.find((v) => v.id === nameOrId) ??
    list.find((v) => typeof v.name === 'string' && v.name.toLowerCase() === needle);
  if (!hit?.id) {
    throw new CliError(
      'not_found',
      `No virtual model "${nameOrId}" on agent "${agent}"`,
      'See thinker routing virtual list ' + agent,
      404,
    );
  }
  return {
    id: hit.id,
    name: typeof hit.name === 'string' ? hit.name : hit.id,
    hasPrimary: hit.override_route !== null && hit.override_route !== undefined,
    otherNames: list
      .filter((v) => v !== hit && typeof v.name === 'string')
      .map((v) => v.name as string),
  };
}

function virtualPath(agent: string, id: string, suffix = ''): string {
  return agentPath(agent, `/virtual-models/${encodeURIComponent(id)}${suffix}`);
}

/** --model plus its optional pins, as the API's route input. */
function primaryRouteFromFlags(args: ParsedArgs): Record<string, string> | null {
  const model = args.strings['model'];
  const pins = ['provider', 'auth-type', 'key-label'].filter((f) => args.strings[f] !== undefined);
  if (model === undefined) {
    if (pins.length > 0) {
      throw new CliError(
        'missing_flag',
        `${pins.map((f) => `--${f}`).join(', ')} need --model`,
        'They pin the primary route; pass --model with them',
      );
    }
    return null;
  }
  return {
    model,
    ...(args.strings['provider'] ? { provider: args.strings['provider'] } : {}),
    ...(args.strings['auth-type'] ? { authType: args.strings['auth-type'] } : {}),
    ...(args.strings['key-label'] ? { keyLabel: args.strings['key-label'] } : {}),
  };
}

function responseModeFlag(args: ParsedArgs): string | undefined {
  const mode = args.strings['response-mode'];
  if (mode !== undefined && !(RESPONSE_MODES as readonly string[]).includes(mode)) {
    throw new CliError('invalid_flag', `--response-mode must be ${RESPONSE_MODES.join(' or ')}`);
  }
  return mode;
}

const ROUTE_FLAGS = ['model', 'provider', 'auth-type', 'key-label', 'response-mode'] as const;

/**
 * Virtual models: public names a harness sends as `model` (and sees in
 * GET /v1/models), each with its own chain and an optional "continue on
 * Default". The server validates every route against the agent's providers
 * and answers 400 when one does not resolve, so no client-side model check
 * runs here.
 */
export const routingVirtual = {
  list: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, { ...URL_ONLY, maxPositionals: 1 });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('GET', agentPath(agent, '/virtual-models')));
  },

  create: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, {
      strings: ['url', 'name', ...ROUTE_FLAGS],
      repeatables: ['fallback'],
      booleans: ['continue-on-default'],
      maxPositionals: 1,
    });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const name = requireString(args, 'name');
    const primary = primaryRouteFromFlags(args);
    const fallbacks = args.lists['fallback'] ?? [];
    if (fallbacks.length > 0 && !primary) {
      throw new CliError('missing_flag', '--fallback needs --model (the primary route)');
    }
    const responseMode = responseModeFlag(args);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('POST', agentPath(agent, '/virtual-models'), {
        body: {
          name,
          ...(primary ? { override_route: primary } : {}),
          ...(fallbacks.length > 0
            ? { fallback_routes: fallbacks.map((model) => ({ model })) }
            : {}),
          ...(args.booleans['continue-on-default'] ? { continue_on_default: true } : {}),
          ...(responseMode ? { response_mode: responseMode } : {}),
        },
      }),
    );
  },

  /**
   * Change only what is passed. --model replaces the primary and keeps the
   * fallbacks; --fallback (repeatable) replaces the fallback list and
   * --clear-fallbacks empties it; --clear-model removes the primary and its
   * fallbacks. The writes are separate requests, not one transaction: route
   * writes go first, so a rejected route leaves the name and flags untouched,
   * and a failure after an earlier write lists the writes already applied.
   * A rename to a name already taken is refused before any write.
   */
  update: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, {
      strings: ['url', 'name', ...ROUTE_FLAGS],
      repeatables: ['fallback'],
      booleans: ['continue-on-default', 'no-continue-on-default', 'clear-fallbacks', 'clear-model'],
      maxPositionals: 2,
    });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const nameOrId = requirePositional(args, 1, '<virtual-name-or-id>');
    const primary = primaryRouteFromFlags(args);
    const fallbacks = args.lists['fallback'] ?? [];
    const clearFallbacks = Boolean(args.booleans['clear-fallbacks']);
    const clearModel = Boolean(args.booleans['clear-model']);
    const responseMode = responseModeFlag(args);
    if (args.booleans['continue-on-default'] && args.booleans['no-continue-on-default']) {
      throw new CliError(
        'invalid_flag',
        'Pass --continue-on-default or --no-continue-on-default, not both',
      );
    }
    if (fallbacks.length > 0 && clearFallbacks) {
      throw new CliError('invalid_flag', 'Pass --fallback or --clear-fallbacks, not both');
    }
    if (clearModel && (primary || fallbacks.length > 0)) {
      throw new CliError(
        'invalid_flag',
        '--clear-model cannot be combined with --model or --fallback',
      );
    }
    const continueOnDefault = args.booleans['continue-on-default']
      ? true
      : args.booleans['no-continue-on-default']
        ? false
        : undefined;
    const newName = args.strings['name'];
    if (
      !primary &&
      fallbacks.length === 0 &&
      !clearFallbacks &&
      !clearModel &&
      !responseMode &&
      continueOnDefault === undefined &&
      newName === undefined
    ) {
      throw new CliError(
        'missing_flag',
        'Nothing to change',
        'Pass --name, --model, --fallback, --clear-fallbacks, --clear-model, --response-mode or --[no-]continue-on-default',
      );
    }

    const { client } = clientFromFlags(io, args);
    const vm = await findVirtualModel(client, agent, nameOrId);
    if (fallbacks.length > 0 && !primary && !vm.hasPrimary) {
      throw new CliError('missing_flag', '--fallback needs --model (the primary route)');
    }
    if (
      newName !== undefined &&
      vm.otherNames.some((n) => n.toLowerCase() === newName.toLowerCase())
    ) {
      throw new CliError(
        'conflict',
        `A virtual model named "${newName}" already exists on agent "${agent}"`,
        undefined,
        409,
      );
    }

    const applied: string[] = [];
    const step = async (label: string, write: () => Promise<unknown>): Promise<unknown> => {
      try {
        const out = await write();
        applied.push(label);
        return out;
      } catch (error) {
        if (applied.length === 0) throw error;
        const suffix = ` (already applied to "${vm.name}": ${applied.join(', ')})`;
        if (error instanceof CliError) {
          throw new CliError(error.code, error.message + suffix, error.hint, error.status);
        }
        throw new CliError(
          'partial_update',
          (error instanceof Error ? error.message : String(error)) + suffix,
        );
      }
    };

    let view: unknown;
    if (clearModel) {
      await step('--clear-model', () =>
        client.request('DELETE', virtualPath(agent, vm.id, '/override')),
      );
    } else if (primary) {
      // The override endpoint takes the flat shape: its nested `route` needs
      // provider and auth type, which --model alone does not carry.
      const { keyLabel, ...flat } = primary;
      view = await step('--model', () =>
        client.request('PUT', virtualPath(agent, vm.id, '/override'), {
          body: { ...flat, ...(keyLabel ? { providerKeyLabel: keyLabel } : {}) },
        }),
      );
    }
    if (fallbacks.length > 0) {
      await step('--fallback', () =>
        client.request('PUT', virtualPath(agent, vm.id, '/fallbacks'), {
          body: { models: fallbacks },
        }),
      );
    } else if (clearFallbacks && !clearModel) {
      await step('--clear-fallbacks', () =>
        client.request('DELETE', virtualPath(agent, vm.id, '/fallbacks')),
      );
    }
    if (responseMode) {
      view = await step('--response-mode', () =>
        client.request('PATCH', virtualPath(agent, vm.id, '/response-mode'), {
          body: { response_mode: responseMode },
        }),
      );
    }
    if (newName !== undefined || continueOnDefault !== undefined) {
      view = await step(newName !== undefined ? '--name' : '--continue-on-default', () =>
        client.request('PUT', virtualPath(agent, vm.id), {
          body: {
            ...(newName !== undefined ? { name: newName } : {}),
            ...(continueOnDefault !== undefined ? { continue_on_default: continueOnDefault } : {}),
          },
        }),
      );
    }
    // Fallback and clear writes return no view; read the row back so the
    // output is always the virtual model as it now stands.
    if (view === undefined || fallbacks.length > 0 || clearFallbacks || clearModel) {
      const rows = (await client.request('GET', agentPath(agent, '/virtual-models'))) as unknown;
      view = (Array.isArray(rows) ? rows : []).find(
        (v) => typeof v === 'object' && v !== null && (v as VirtualModelRow).id === vm.id,
      );
    }
    printJson(io, view ?? null);
  },

  delete: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 2 });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const nameOrId = requirePositional(args, 1, '<virtual-name-or-id>');
    const { client } = clientFromFlags(io, args);
    const vm = await findVirtualModel(client, agent, nameOrId);
    requireYes(args, `delete virtual model "${vm.name}" of "${agent}"`);
    await client.request('DELETE', virtualPath(agent, vm.id));
    printJson(io, { ok: true, deleted: { id: vm.id, name: vm.name } });
  },

  enable: (io: CliIo, argv: string[]): Promise<void> => toggleVirtual(io, argv, true),
  disable: (io: CliIo, argv: string[]): Promise<void> => toggleVirtual(io, argv, false),
};

async function toggleVirtual(io: CliIo, argv: string[], enabled: boolean): Promise<void> {
  const args = parseArgs(argv, { ...URL_ONLY, maxPositionals: 2 });
  const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
  const nameOrId = requirePositional(args, 1, '<virtual-name-or-id>');
  const { client } = clientFromFlags(io, args);
  const vm = await findVirtualModel(client, agent, nameOrId);
  printJson(
    io,
    await client.request('PATCH', virtualPath(agent, vm.id, '/toggle'), { body: { enabled } }),
  );
}

const TEST_TIMEOUT_MS = 120_000;

/**
 * Which proxy surface a platform's real traffic uses — read from the
 * generated catalog (source of truth: thinker-shared PLATFORM_API_SURFACES),
 * so a platform added in Thinker gets the right test surface automatically.
 */
const SURFACE_BY_PLATFORM = new Map(PLATFORM_CATALOG.map((p) => [p.id, p.surface]));

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

/** OpenAI Responses API: reply lives in `output[].content[].output_text`. */
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
 * Whether the parsed body carries the fields the selected surface must return.
 * A 2xx with `{}` or `[]` must not read as a verified route.
 */
function hasSurfacePayload(surface: string, parsed: Record<string, unknown>): boolean {
  const nonEmpty = (value: unknown): boolean => Array.isArray(value) && value.length > 0;
  if (surface === 'messages') return nonEmpty(parsed['content']);
  if (surface === 'responses') return nonEmpty(parsed['output']);
  return nonEmpty(parsed['choices']);
}

/**
 * Send ONE real request through the agent's route to prove the config works
 * end-to-end — the closing move after `agent configure`. Not an inference
 * client: fixed shape, canned default prompt, facts-first output. Thinker
 * errors that the proxy wraps as HTTP-200 assistant text are unmasked into
 * real failures so a broken route can never look like an answer.
 */
export async function routingTest(io: CliIo, argv: string[]): Promise<number | void> {
  const args = parseArgs(argv, { strings: ['url', 'tier', 'model', 'as'] });
  const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
  const prompt = args.positionals.slice(1).join(' ').trim() || 'Reply with exactly: OK';

  // Surface selection: --as override, else the agent's own stored platform.
  // An unknown --as would silently fall back to chat_completions and test the
  // wrong surface, so it fails loudly — before any network call, like agent
  // create's --platform.
  let platform: string | undefined = args.strings['as'];
  if (platform !== undefined && !SURFACE_BY_PLATFORM.has(platform)) {
    throw new CliError(
      'invalid_platform',
      `Unknown platform: ${platform}. Valid platforms: ${[...SURFACE_BY_PLATFORM.keys()].join(', ')}`,
      'Run thinker agent platforms to list them',
    );
  }

  const resolved = await resolveAgentKey(io, args, agent);
  if (!platform) {
    const { client } = clientFromFlags(io, args);
    const info = (await client.request('GET', `/agents/${encodeURIComponent(agent)}`)) as {
      agent: { agent_platform?: string | null } | null;
    };
    platform = info.agent?.agent_platform ?? undefined;
  }
  const surface = SURFACE_BY_PLATFORM.get(platform ?? '') ?? 'chat_completions';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const started = Date.now();
  const endpoint =
    surface === 'messages'
      ? `${resolved.origin}/v1/messages`
      : surface === 'responses'
        ? `${resolved.origin}/v1/responses`
        : `${resolved.origin}/v1/chat/completions`;
  const requestBody =
    surface === 'messages'
      ? {
          // "auto" means "route me" on every public surface, /v1/messages
          // included — a concrete model is what the proxy reads as an explicit
          // route override. --model is that override when the caller wants it.
          model: args.strings['model'] ?? 'auto',
          max_tokens: 64,
          messages: [{ role: 'user', content: prompt }],
        }
      : surface === 'responses'
        ? {
            model: args.strings['model'] ?? 'auto',
            input: prompt,
          }
        : {
            model: args.strings['model'] ?? 'auto',
            messages: [{ role: 'user', content: prompt }],
          };
  let response: Response;
  let text: string;
  try {
    response = await io.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolved.key}`,
        'Content-Type': 'application/json',
        // Node's fetch sends `User-Agent: node` by default, which makes a CLI
        // test request indistinguishable from any other Node caller in the
        // gateway's caller_attribution. Same value ApiClient sends.
        'User-Agent': CLI_USER_AGENT,
        ...(surface === 'messages' ? { 'anthropic-version': '2023-06-01' } : {}),
        ...(args.strings['tier'] ? { 'x-thinker-tier': args.strings['tier'] } : {}),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    // Consume the body inside the abort scope so a stalled response cannot
    // hang the verifier after the timer was cleared.
    text = await response.text();
  } catch (error) {
    throw new CliError(
      'network_error',
      `Could not reach ${resolved.origin}: ${error instanceof Error ? error.message : String(error)}`,
      'Check the URL and that the Thinker server is running',
    );
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - started;

  let parsed: Record<string, unknown> = {};
  let parsedOk = false;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw === 'object' && raw !== null) {
      parsed = raw as Record<string, unknown>;
      parsedOk = true;
    }
  } catch {
    /* non-JSON body → handled below */
  }
  if (!response.ok) {
    const err = (parsed['error'] as { message?: string } | undefined)?.message;
    throw new CliError(
      'route_test_failed',
      err ?? `Route test failed with HTTP ${response.status}`,
      'See thinker routing status ' + agent,
      response.status,
    );
  }
  // A 2xx without the surface's payload is not a verified route; without this
  // the surface parser returns an empty reply and the test falsely passes.
  if (!parsedOk || !hasSurfacePayload(surface, parsed)) {
    throw new CliError(
      'route_test_failed',
      `Route test got HTTP ${response.status} but no ${surface} payload`,
      'See thinker routing status ' + agent,
      response.status,
    );
  }

  const result =
    surface === 'messages'
      ? parseMessagesSurface(parsed)
      : surface === 'responses'
        ? parseResponsesSurface(parsed)
        : parseCompletionSurface(parsed);
  // The gateway tags its own errors as `[🦚 <product> M###]`. Match any product
  // word so the check survives the server-side rename of that tag.
  if (/^\[🦚 [^\]\s]+ M\d+\]/.test(result.reply)) {
    throw new CliError('route_test_failed', result.reply, 'See thinker routing status ' + agent);
  }
  // How the proxy routed it: `virtual-model` plus the stored name when
  // --model matched an enabled virtual model.
  const routingReason = response.headers.get('x-thinker-reason');
  const virtualModel = response.headers.get('x-thinker-virtual-model');

  printJson(io, {
    agent,
    ok: true,
    surface,
    ...(platform ? { platform } : {}),
    requested_model: (requestBody as { model: string }).model,
    ...(args.strings['tier'] ? { tier: args.strings['tier'] } : {}),
    ...(routingReason ? { routing_reason: routingReason } : {}),
    ...(virtualModel ? { virtual_model: virtualModel } : {}),
    served_model: result.servedModel,
    duration_ms: durationMs,
    ...(result.tokens !== undefined ? { tokens: result.tokens } : {}),
    reply: result.reply,
  });
}

function toggleCommand(feature: 'recording') {
  return {
    get: async (io: CliIo, argv: string[]): Promise<void> => {
      const args = parseArgs(argv, { ...URL_ONLY, maxPositionals: 1 });
      const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
      const { client } = clientFromFlags(io, args);
      printJson(io, await client.request('GET', agentPath(agent, `/${feature}`)));
    },
    set: async (io: CliIo, argv: string[]): Promise<void> => {
      const args = parseArgs(argv, { strings: ['url', 'enabled'], maxPositionals: 1 });
      const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
      const enabled = parseBooleanFlag(requireString(args, 'enabled'), 'enabled');
      const { client } = clientFromFlags(io, args);
      printJson(
        io,
        await client.request('PATCH', agentPath(agent, `/${feature}`), { body: { enabled } }),
      );
    },
  };
}

export const routingRecording = toggleCommand('recording');

/**
 * Where the params of the selected route live: `--tier` (a tier name, the
 * default tier when omitted) or `--virtual` (a virtual model name). The two
 * are exclusive: a custom tier and a virtual model may share a name.
 */
function paramsRequest(
  agent: string,
  args: ParsedArgs,
): { path: string; query: Record<string, string | undefined> } {
  const tier = args.strings['tier'];
  const virtual = args.strings['virtual'];
  if (tier !== undefined && virtual !== undefined) {
    throw new CliError(
      'invalid_flag',
      'Pass --tier or --virtual, not both',
      '--tier names a tier (default or a custom tier), --virtual a virtual model',
    );
  }
  if (virtual !== undefined) {
    return {
      path: agentPath(agent, '/virtual-model-params'),
      query: { virtual, model: args.strings['model'] },
    };
  }
  return {
    path: agentPath(agent, `/tiers/${encodeURIComponent(tier ?? 'default')}/model-params`),
    query: { model: args.strings['model'] },
  };
}

/** `path=value`: the value is JSON when it parses (numbers, booleans, objects), else a string. */
function parseParamAssignment(raw: string): [string, unknown] {
  const eq = raw.indexOf('=');
  if (eq <= 0) {
    throw new CliError(
      'invalid_flag',
      `--set expects <path>=<value>, got "${raw}"`,
      'Example: --set reasoning.effort=high',
    );
  }
  const text = raw.slice(eq + 1);
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    // Not JSON: keep the literal string (e.g. `high`).
  }
  return [raw.slice(0, eq), value];
}

/**
 * Model params of one routed model, addressed as tier + model: `--tier` is
 * `default` (the default) or a custom tier's name, or `--virtual` names a
 * virtual model instead; `--model` defaults to the primary and may name one
 * of its fallbacks. Saved params override the values the calling app sends,
 * on requests Thinker routes (`model: "auto"`, a virtual model name, or a
 * matching custom-tier header); a request naming a model skips them.
 */
export const routingParams = {
  get: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, {
      strings: ['url', 'tier', 'virtual', 'model'],
      maxPositionals: 1,
    });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const target = paramsRequest(agent, args);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('GET', target.path, { query: target.query }));
  },
  set: async (io: CliIo, argv: string[]): Promise<void> => {
    const args = parseArgs(argv, {
      strings: ['url', 'tier', 'virtual', 'model'],
      repeatables: ['set', 'unset'],
      maxPositionals: 1,
    });
    const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));
    const target = paramsRequest(agent, args);
    const assignments = (args.lists['set'] ?? []).map(parseParamAssignment);
    const unset = args.lists['unset'] ?? [];
    if (assignments.length === 0 && unset.length === 0) {
      throw new CliError(
        'missing_flag',
        'Pass at least one --set <path>=<value> or --unset <path>',
        `Run thinker routing params get ${agent} to list the available params`,
      );
    }
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('PATCH', target.path, {
        query: target.query,
        body: {
          ...(assignments.length > 0 ? { set: Object.fromEntries(assignments) } : {}),
          ...(unset.length > 0 ? { unset } : {}),
        },
      }),
    );
  },
};
