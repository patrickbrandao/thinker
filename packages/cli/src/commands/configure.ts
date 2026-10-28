import { ApiClient } from '../client';
import { CliIo, clientFromFlags, printJson } from '../context';
import { CliError } from '../errors';
import { parseArgs, parseBooleanFlag, requirePositional, requireString } from '../args';
import { slugifyAgentName } from '../slug';
import { assertModelsDiscovered } from './model-check';

function agentPath(agent: string, suffix: string): string {
  return `/routing/${encodeURIComponent(agent)}${suffix}`;
}

/**
 * The human front door for agent configuration — one verb, one line:
 *
 *   thinker agent configure <name> --models <primary,fb1,fb2> --provider <p>
 *   thinker agent configure <name> --recording false
 *
 * --models is the FULL desired chain: first entry is the route, the rest are
 * fallbacks, and stating a single model clears any existing fallbacks. It
 * writes the DEFAULT route.
 *
 * Every named model is checked against the agent's discovered models before
 * anything is written; --force skips that check.
 */
export async function agentConfigure(io: CliIo, argv: string[]): Promise<void> {
  const args = parseArgs(argv, {
    strings: ['url', 'models', 'provider', 'auth-type', 'key-label', 'recording'],
    booleans: ['force'],
    maxPositionals: 1,
  });
  const agent = slugifyAgentName(requirePositional(args, 0, '<agent-name>'));

  const wantsRoute =
    args.strings['models'] !== undefined ||
    args.strings['provider'] !== undefined ||
    args.strings['auth-type'] !== undefined ||
    args.strings['key-label'] !== undefined;
  const wantsRecording = args.strings['recording'] !== undefined;
  if (!wantsRoute && !wantsRecording) {
    throw new CliError(
      'missing_flag',
      'Nothing to configure — pass --models + --provider and/or --recording',
    );
  }

  const { client } = clientFromFlags(io, args);
  const output: Record<string, unknown> = { agent };

  if (wantsRoute) {
    const models = requireString(args, 'models')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (models.length === 0) {
      throw new CliError('missing_flag', '--models must be a comma-separated list of model ids');
    }
    const provider = requireString(args, 'provider');
    const authType = args.strings['auth-type'] ?? 'api_key';
    const normalized = await assertModelsDiscovered(
      client,
      agent,
      models,
      Boolean(args.booleans['force']),
      provider,
      authType,
    );
    const route = {
      model: normalized[0],
      provider,
      authType,
      ...(args.strings['key-label'] ? { providerKeyLabel: args.strings['key-label'] } : {}),
    };
    const fallbacks = normalized.slice(1);

    output['route'] = await client.request('PUT', agentPath(agent, '/tiers/default'), {
      body: route,
    });
    output['fallbacks'] = await setOrClearFallbacks(
      client,
      agentPath(agent, '/tiers/default/fallbacks'),
      fallbacks,
    );
  }

  if (wantsRecording) {
    const enabled = parseBooleanFlag(args.strings['recording'] as string, 'recording');
    output['recording'] = await client.request('PATCH', agentPath(agent, '/recording'), {
      body: { enabled },
    });
  }

  printJson(io, output);
}

/** --models states the whole chain: extra entries set fallbacks, a lone entry clears them. */
async function setOrClearFallbacks(
  client: ApiClient,
  path: string,
  fallbacks: string[],
): Promise<unknown> {
  if (fallbacks.length > 0) {
    return client.request('PUT', path, { body: { models: fallbacks } });
  }
  await client.request('DELETE', path);
  return [];
}
