import { readFileSync } from 'fs';
import { CliIo, clientFromFlags, printJson } from '../context';
import { CliError } from '../errors';
import {
  FlagSpec,
  ParsedArgs,
  parseArgs,
  parseBooleanFlag,
  requirePositional,
  requireString,
  requireYes,
} from '../args';
import { readCredential } from '../secrets';
import { resolveDiscoveryAgent } from './provider';

/**
 * Workspace objects the dashboard manages beyond agents, providers and routes:
 * triggers, outbound proxies, alerts, limits, local servers, connection
 * settings, organizations and users. Each command is a thin wrapper over the
 * management API; create/update bodies come from typed flags plus the generic
 * body flags (`--data`, `--data-file`, `--data-stdin`, `--set path=value`), so
 * every field the API accepts is reachable without a dedicated flag.
 */

type Handler = (io: CliIo, argv: string[]) => Promise<void>;

const BODY_STRINGS = ['data', 'data-file'] as const;
const BODY_BOOLEANS = ['data-stdin'] as const;
const BODY_REPEATABLES = ['set'] as const;

const enc = encodeURIComponent;

function withBody(spec: FlagSpec): FlagSpec {
  return {
    ...spec,
    strings: [...(spec.strings ?? []), 'url', ...BODY_STRINGS],
    booleans: [...(spec.booleans ?? []), ...BODY_BOOLEANS],
    repeatables: [...(spec.repeatables ?? []), ...BODY_REPEATABLES],
  };
}

function parseJsonObject(text: string, source: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError('invalid_json', `${source} is not valid JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CliError('invalid_json', `${source} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** `a.b.c=value`: the value is JSON when it parses, else a string. */
export function applyAssignment(target: Record<string, unknown>, raw: string): void {
  const eq = raw.indexOf('=');
  if (eq <= 0) {
    throw new CliError(
      'invalid_flag',
      `--set expects <path>=<value>, got "${raw}"`,
      'Example: --set config.port=12201',
    );
  }
  const text = raw.slice(eq + 1);
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    // Not JSON: keep the literal string.
  }
  const path = raw.slice(0, eq).split('.');
  let node = target;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

/**
 * `--hop` values of an outbound profile, one line each: `<proxy-id>`, `direct`,
 * or a balanced line `affinity:<id>,<id>` / `request:<id>,<id>` with optional
 * `?on_failure=next_member|next_line&no_session=request|agent|first`.
 */
export function hopsToLines(
  hops: string[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!hops) return undefined;
  return hops.map((hop) => {
    const value = hop.trim();
    if (value === 'direct') return { mode: 'direct' };
    const match = /^(affinity|request):([^?]+)(?:\?(.*))?$/.exec(value);
    if (!match) return { mode: 'proxy', proxies: [value] };
    const line: Record<string, unknown> = {
      mode: match[1],
      proxies: match[2]!
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    };
    for (const [key, option] of new URLSearchParams(match[3] ?? '')) {
      if (key !== 'on_failure' && key !== 'no_session') {
        throw new CliError('invalid_flag', `Unknown --hop option ${key} (on_failure, no_session)`);
      }
      line[key] = option;
    }
    return line;
  });
}

/**
 * The request body: `--data`/`--data-file`/`--data-stdin` (one JSON object),
 * then the typed flags, then each `--set` on top.
 */
export async function readBody(
  io: CliIo,
  args: ParsedArgs,
  typed: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const sources = [
    args.strings['data'] !== undefined,
    args.strings['data-file'] !== undefined,
    Boolean(args.booleans['data-stdin']),
  ].filter(Boolean).length;
  if (sources > 1) {
    throw new CliError('invalid_flag', 'Use only one of --data, --data-file, --data-stdin');
  }
  let body: Record<string, unknown> = {};
  if (args.strings['data'] !== undefined) body = parseJsonObject(args.strings['data'], '--data');
  else if (args.strings['data-file'] !== undefined) {
    let text: string;
    try {
      text = readFileSync(args.strings['data-file'], 'utf8');
    } catch (error) {
      throw new CliError(
        'file_unreadable',
        `Cannot read ${args.strings['data-file']}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    body = parseJsonObject(text, args.strings['data-file']);
  } else if (args.booleans['data-stdin']) {
    body = parseJsonObject(await io.readStdin(), 'stdin');
  }
  for (const [key, value] of Object.entries(typed)) {
    if (value !== undefined) body[key] = value;
  }
  for (const raw of args.lists['set'] ?? []) applyAssignment(body, raw);
  return body;
}

function requireNonEmpty(body: Record<string, unknown>, hint: string): void {
  if (Object.keys(body).length === 0) {
    throw new CliError('missing_flag', 'Nothing to change', hint);
  }
}

function intFlag(args: ParsedArgs, name: string): number | undefined {
  const raw = args.strings[name];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new CliError('invalid_flag', `--${name} must be an integer`);
  }
  return n;
}

function numberFlag(args: ParsedArgs, name: string): number | undefined {
  const raw = args.strings[name];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new CliError('invalid_flag', `--${name} must be a number`);
  return n;
}

function boolFlag(args: ParsedArgs, name: string): boolean | undefined {
  const raw = args.strings[name];
  return raw === undefined ? undefined : parseBooleanFlag(raw, name);
}

function oneOf<T extends string>(
  args: ParsedArgs,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const raw = args.strings[name];
  if (raw === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new CliError('invalid_flag', `--${name} must be one of: ${allowed.join(', ')}`);
  }
  return raw as T;
}

/** A list endpoint answers with an array or `{ <key>: [...] }`. */
function rowsOf(value: unknown, key: string): Array<Record<string, unknown>> {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as never)[key])
      ? ((value as Record<string, unknown>)[key] as unknown[])
      : [];
  return list.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
}

/** Find a row by id, or by name (case-insensitive). */
function findRow(
  rows: Array<Record<string, unknown>>,
  needle: string,
  what: string,
  hint: string,
  nameKeys: string[] = ['name'],
): Record<string, unknown> & { id: string } {
  const lower = needle.toLowerCase();
  const hit = rows.find(
    (r) =>
      r['id'] === needle ||
      nameKeys.some((k) => typeof r[k] === 'string' && (r[k] as string).toLowerCase() === lower),
  );
  if (!hit || typeof hit['id'] !== 'string') {
    throw new CliError('not_found', `No ${what} "${needle}"`, hint, 404);
  }
  return hit as Record<string, unknown> & { id: string };
}

const simple =
  (
    method: string,
    path: (args: ParsedArgs) => string,
    spec: FlagSpec = {},
    query?: (args: ParsedArgs) => Record<string, string | undefined>,
  ): Handler =>
  async (io, argv) => {
    const args = parseArgs(argv, { ...spec, strings: [...(spec.strings ?? []), 'url'] });
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request(method, path(args), { query: query?.(args) }));
  };

// ─── Triggers ────────────────────────────────────────────────────────────────

async function triggerId(io: CliIo, args: ParsedArgs, index = 0): Promise<string> {
  const needle = requirePositional(args, index, '<trigger>');
  const { client } = clientFromFlags(io, args);
  const rows = rowsOf(await client.request('GET', '/triggers'), 'triggers');
  return findRow(rows, needle, 'trigger', 'See thinker trigger list').id;
}

const TRIGGER_TYPED = ['name', 'type', 'enabled', 'max-retries', 'retry-delay', 'timeout'];

function triggerTyped(args: ParsedArgs): Record<string, unknown> {
  return {
    name: args.strings['name'],
    type: args.strings['type'],
    enabled: boolFlag(args, 'enabled'),
    max_retries: intFlag(args, 'max-retries'),
    retry_delay_seconds: intFlag(args, 'retry-delay'),
    timeout_seconds: intFlag(args, 'timeout'),
    workspace_events: args.lists['event'],
  };
}

export const trigger: Record<string, Handler> = {
  list: simple('GET', () => '/triggers', { maxPositionals: 0 }),
  get: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], maxPositionals: 1 });
    const needle = requirePositional(args, 0, '<trigger>');
    const { client } = clientFromFlags(io, args);
    const rows = rowsOf(await client.request('GET', '/triggers'), 'triggers');
    printJson(io, findRow(rows, needle, 'trigger', 'See thinker trigger list'));
  },
  create: async (io, argv) => {
    const args = parseArgs(
      argv,
      withBody({ strings: TRIGGER_TYPED, repeatables: ['event'], maxPositionals: 0 }),
    );
    const body = await readBody(io, args, triggerTyped(args));
    if (!body['name'] || !body['type']) {
      throw new CliError(
        'missing_flag',
        '--name and --type are required (or in --data)',
        'Types: email, webhook, telegram, syslog, gelf, relp — config goes in --set config.<field>=<value>',
      );
    }
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('POST', '/triggers', { body }));
  },
  update: async (io, argv) => {
    const args = parseArgs(
      argv,
      withBody({ strings: TRIGGER_TYPED, repeatables: ['event'], maxPositionals: 1 }),
    );
    const id = await triggerId(io, args);
    const body = await readBody(io, args, triggerTyped(args));
    requireNonEmpty(body, 'Pass typed flags, --data or --set');
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('PATCH', `/triggers/${enc(id)}`, { body }));
  },
  delete: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 1 });
    const id = await triggerId(io, args);
    requireYes(args, `delete trigger ${args.positionals[0]}`);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('DELETE', `/triggers/${enc(id)}`));
  },
  test: async (io, argv) => {
    const args = parseArgs(argv, withBody({ maxPositionals: 1 }));
    const id = await triggerId(io, args);
    const body = await readBody(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('POST', `/triggers/${enc(id)}/test`, { body }));
  },
  events: simple(
    'GET',
    () => '/triggers/events',
    {
      strings: ['trigger-id', 'status', 'event-type', 'agent', 'before', 'limit'],
      maxPositionals: 0,
    },
    (a) => ({
      trigger_id: a.strings['trigger-id'],
      status: a.strings['status'],
      event_type: a.strings['event-type'],
      agent_name: a.strings['agent'],
      before: a.strings['before'],
      limit: a.strings['limit'],
    }),
  ),
  'event get': simple(
    'GET',
    (a) => `/triggers/events/${enc(requirePositional(a, 0, '<event-id>'))}`,
    { maxPositionals: 1 },
  ),
  'event retry': simple(
    'POST',
    (a) => `/triggers/events/${enc(requirePositional(a, 0, '<event-id>'))}/retry`,
    { maxPositionals: 1 },
  ),
  'bind get': simple('GET', (a) => `/agents/${enc(requirePositional(a, 0, '<agent>'))}/triggers`, {
    maxPositionals: 1,
  }),
  'bind set': async (io, argv) => {
    const args = parseArgs(argv, withBody({ maxPositionals: 1 }));
    const agent = requirePositional(args, 0, '<agent>');
    const body = await readBody(io, args);
    requireNonEmpty(body, 'Pass the bindings as --data (see thinker trigger bind get <agent>)');
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('PUT', `/agents/${enc(agent)}/triggers`, { body }));
  },
};

// ─── Outbound proxies ────────────────────────────────────────────────────────

const PROXY_TYPED = [
  'name',
  'scheme',
  'host',
  'port',
  'username',
  'password-env',
  'enabled',
  'connect-timeout-ms',
  'debug',
  'log-retention-days',
];

async function proxyTyped(io: CliIo, args: ParsedArgs): Promise<Record<string, unknown>> {
  const password =
    args.strings['password-env'] !== undefined || args.booleans['password-stdin']
      ? await readCredential(
          io,
          Boolean(args.booleans['password-stdin']),
          args.strings['password-env'],
          'password',
        )
      : undefined;
  return {
    name: args.strings['name'],
    scheme: args.strings['scheme'],
    host: args.strings['host'],
    port: intFlag(args, 'port'),
    username: args.strings['username'],
    password,
    auth: args.booleans['no-auth'] ? 'none' : undefined,
    enabled: boolFlag(args, 'enabled'),
    connect_timeout_ms: intFlag(args, 'connect-timeout-ms'),
    debug: args.strings['debug'],
    log_retention_days: intFlag(args, 'log-retention-days'),
  };
}

async function proxyServerId(io: CliIo, args: ParsedArgs): Promise<string> {
  const needle = requirePositional(args, 0, '<proxy>');
  const { client } = clientFromFlags(io, args);
  const rows = rowsOf(await client.request('GET', '/proxy-servers'), 'proxies');
  return findRow(rows, needle, 'proxy server', 'See thinker proxy server list').id;
}

async function proxyProfileId(io: CliIo, args: ParsedArgs): Promise<string> {
  const needle = requirePositional(args, 0, '<profile>');
  const { client } = clientFromFlags(io, args);
  const rows = rowsOf(await client.request('GET', '/proxy-profiles'), 'profiles');
  return findRow(rows, needle, 'proxy profile', 'See thinker proxy profile list').id;
}

export const proxy: Record<string, Handler> = {
  'server list': simple('GET', () => '/proxy-servers', { maxPositionals: 0 }),
  'server get': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], maxPositionals: 1 });
    const id = await proxyServerId(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('GET', `/proxy-servers/${enc(id)}`));
  },
  'server create': async (io, argv) => {
    const args = parseArgs(
      argv,
      withBody({
        strings: PROXY_TYPED,
        booleans: ['password-stdin', 'no-auth'],
        maxPositionals: 0,
      }),
    );
    const body = await readBody(io, args, await proxyTyped(io, args));
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('POST', '/proxy-servers', { body }));
  },
  'server update': async (io, argv) => {
    const args = parseArgs(
      argv,
      withBody({
        strings: PROXY_TYPED,
        booleans: ['password-stdin', 'no-auth'],
        maxPositionals: 1,
      }),
    );
    const id = await proxyServerId(io, args);
    const body = await readBody(io, args, await proxyTyped(io, args));
    requireNonEmpty(body, 'Pass typed flags, --data or --set');
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('PATCH', `/proxy-servers/${enc(id)}`, { body }));
  },
  'server delete': async (io, argv) => {
    const args = parseArgs(argv, {
      strings: ['url', 'mode', 'replace-with'],
      booleans: ['yes'],
      maxPositionals: 1,
    });
    const id = await proxyServerId(io, args);
    requireYes(args, `delete proxy server ${args.positionals[0]}`);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('DELETE', `/proxy-servers/${enc(id)}`, {
        query: { mode: args.strings['mode'], replace_with: args.strings['replace-with'] },
      }),
    );
  },
  'server test': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'target'], maxPositionals: 1 });
    const id = await proxyServerId(io, args);
    const { client } = clientFromFlags(io, args);
    // --url is the Thinker server; --target is the address fetched through the
    // proxy (default: the proxy's suggested test URL, as in the dashboard).
    let target = args.strings['target'];
    if (!target) {
      const proxy = (await client.request('GET', `/proxy-servers/${enc(id)}`)) as {
        suggested_test_url?: string | null;
      };
      target = proxy.suggested_test_url || 'https://api.openai.com/';
    }
    printJson(
      io,
      await client.request('POST', `/proxy-servers/${enc(id)}/test`, { body: { url: target } }),
    );
  },
  'server logs': async (io, argv) => {
    const args = parseArgs(argv, {
      strings: ['url', 'result', 'source-type', 'limit', 'before'],
      maxPositionals: 1,
    });
    const id = await proxyServerId(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('GET', `/proxy-servers/${enc(id)}/logs`, {
        query: {
          result: args.strings['result'],
          source_type: args.strings['source-type'],
          limit: args.strings['limit'],
          before: args.strings['before'],
        },
      }),
    );
  },
  'server stats': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'days'], maxPositionals: 1 });
    const id = await proxyServerId(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('GET', `/proxy-servers/${enc(id)}/stats`, {
        query: { days: args.strings['days'] },
      }),
    );
  },
  'profile list': simple('GET', () => '/proxy-profiles', { maxPositionals: 0 }),
  'profile create': async (io, argv) => {
    const args = parseArgs(
      argv,
      withBody({ strings: ['name'], repeatables: ['hop'], maxPositionals: 0 }),
    );
    const body = await readBody(io, args, {
      name: args.strings['name'],
      lines: hopsToLines(args.lists['hop']),
    });
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('POST', '/proxy-profiles', { body }));
  },
  'profile update': async (io, argv) => {
    const args = parseArgs(
      argv,
      withBody({ strings: ['name'], repeatables: ['hop'], maxPositionals: 1 }),
    );
    const id = await proxyProfileId(io, args);
    const body = await readBody(io, args, {
      name: args.strings['name'],
      lines: hopsToLines(args.lists['hop']),
    });
    requireNonEmpty(body, 'Pass --name, --hop, --data or --set');
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('PATCH', `/proxy-profiles/${enc(id)}`, { body }));
  },
  'profile delete': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 1 });
    const id = await proxyProfileId(io, args);
    requireYes(args, `delete proxy profile ${args.positionals[0]}`);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('DELETE', `/proxy-profiles/${enc(id)}`));
  },
  'assign list': simple(
    'GET',
    () => '/proxy-assignments',
    { strings: ['target-type'], maxPositionals: 0 },
    (a) => ({ target_type: a.strings['target-type'] }),
  ),
  'assign get': simple(
    'GET',
    (a) =>
      `/proxy-assignments/${enc(requirePositional(a, 0, '<target-type>'))}/${enc(requirePositional(a, 1, '<target-id>'))}`,
    { maxPositionals: 2 },
  ),
  'assign set': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'mode', 'profile'], maxPositionals: 2 });
    const targetType = requirePositional(args, 0, '<target-type>');
    const targetId = requirePositional(args, 1, '<target-id>');
    const mode = oneOf(args, 'mode', ['inherit', 'global', 'direct', 'profile'] as const);
    if (!mode) throw new CliError('missing_flag', '--mode is required');
    let profileId: string | undefined;
    if (mode === 'profile') {
      const needle = requireString(args, 'profile');
      const { client } = clientFromFlags(io, args);
      const rows = rowsOf(await client.request('GET', '/proxy-profiles'), 'profiles');
      profileId = findRow(rows, needle, 'proxy profile', 'See thinker proxy profile list').id;
    }
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('PUT', `/proxy-assignments/${enc(targetType)}/${enc(targetId)}`, {
        body: { mode, ...(profileId ? { profile_id: profileId } : {}) },
      }),
    );
  },
};

// ─── Alerts ──────────────────────────────────────────────────────────────────

export const alert: Record<string, Handler> = {
  list: simple(
    'GET',
    () => '/alerts/events',
    { strings: ['level', 'category', 'page', 'limit'], booleans: ['unread'], maxPositionals: 0 },
    (a) => ({
      level: a.strings['level'],
      category: a.strings['category'],
      unread: a.booleans['unread'] ? '1' : undefined,
      page: a.strings['page'],
      limit: a.strings['limit'],
    }),
  ),
  read: simple('POST', (a) => `/alerts/events/${enc(requirePositional(a, 0, '<alert-id>'))}/read`, {
    maxPositionals: 1,
  }),
  'read-all': simple(
    'POST',
    () => '/alerts/events/read-all',
    { strings: ['level', 'category'], maxPositionals: 0 },
    (a) => ({ level: a.strings['level'], category: a.strings['category'] }),
  ),
};

// ─── Limits (per-agent notification / block rules) ───────────────────────────

const LIMIT_METRICS = ['tokens', 'cost'] as const;
const LIMIT_PERIODS = ['hour', 'day', 'week', 'month'] as const;
const LIMIT_ACTIONS = ['notify', 'block', 'both'] as const;

function limitTyped(args: ParsedArgs): Record<string, unknown> {
  return {
    metric_type: oneOf(args, 'metric', LIMIT_METRICS),
    threshold: numberFlag(args, 'threshold'),
    period: oneOf(args, 'period', LIMIT_PERIODS),
    action: oneOf(args, 'action', LIMIT_ACTIONS),
  };
}

export const limit: Record<string, Handler> = {
  list: simple(
    'GET',
    () => '/notifications',
    { maxPositionals: 1 },
    (a) => ({
      agent_name: requirePositional(a, 0, '<agent>'),
    }),
  ),
  logs: simple(
    'GET',
    () => '/notifications/logs',
    { maxPositionals: 1 },
    (a) => ({
      agent_name: requirePositional(a, 0, '<agent>'),
    }),
  ),
  create: async (io, argv) => {
    const args = parseArgs(
      argv,
      withBody({ strings: ['metric', 'threshold', 'period', 'action'], maxPositionals: 1 }),
    );
    const agent = requirePositional(args, 0, '<agent>');
    const body = await readBody(io, args, { agent_name: agent, ...limitTyped(args) });
    for (const field of ['metric_type', 'threshold', 'period']) {
      if (body[field] === undefined) {
        throw new CliError('missing_flag', '--metric, --threshold and --period are required');
      }
    }
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('POST', '/notifications', { body }));
  },
  update: async (io, argv) => {
    const args = parseArgs(
      argv,
      withBody({
        strings: ['metric', 'threshold', 'period', 'action', 'active'],
        maxPositionals: 1,
      }),
    );
    const id = requirePositional(args, 0, '<limit-id>');
    const body = await readBody(io, args, {
      ...limitTyped(args),
      is_active: boolFlag(args, 'active'),
    });
    requireNonEmpty(body, 'Pass --metric, --threshold, --period, --action or --active');
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('PATCH', `/notifications/${enc(id)}`, { body }));
  },
  delete: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 1 });
    const id = requirePositional(args, 0, '<limit-id>');
    requireYes(args, `delete limit ${id}`);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('DELETE', `/notifications/${enc(id)}`));
  },
};

// ─── Local servers (Ollama, LM Studio, llama.cpp) ────────────────────────────

const LOCAL_TYPES = ['ollama', 'lmstudio', 'llamacpp'] as const;
const MODEL_CAPABILITIES = new Set(['tools', 'vision', 'reasoning']);

export const providerLocal: Record<string, Handler> = {
  /**
   * Registers a local server like the dashboard: probe through the type's
   * native API (models, context, capabilities), then create the provider
   * with the discovered models. Host/port default to the type's defaults.
   */
  add: async (io, argv) => {
    const args = parseArgs(argv, {
      strings: [
        'url',
        'agent',
        'type',
        'name',
        'alias',
        'scheme',
        'host',
        'port',
        'path-prefix',
        'request-timeout-ms',
        'probe-timeout-ms',
        'credential-env',
      ],
      booleans: ['credential-stdin'],
      maxPositionals: 0,
    });
    const type = oneOf(args, 'type', LOCAL_TYPES);
    if (!type) throw new CliError('missing_flag', `--type is required (${LOCAL_TYPES.join(', ')})`);
    const name = requireString(args, 'name');
    const agent = await resolveDiscoveryAgent(io, args);
    const { client } = clientFromFlags(io, args);

    const defaults = rowsOf(
      await client.request('GET', `/routing/${enc(agent)}/custom-providers/local-defaults`),
      'types',
    ).find((d) => d['type'] === type);
    const base =
      defaults && typeof defaults['config'] === 'object' && defaults['config'] !== null
        ? (defaults['config'] as Record<string, unknown>)
        : {};
    const localConfig: Record<string, unknown> = { ...base };
    const overrides: Record<string, unknown> = {
      scheme: oneOf(args, 'scheme', ['http', 'https'] as const),
      host: args.strings['host'],
      port: intFlag(args, 'port'),
      path_prefix: args.strings['path-prefix'],
      request_timeout_ms: intFlag(args, 'request-timeout-ms'),
      probe_timeout_ms: intFlag(args, 'probe-timeout-ms'),
    };
    for (const [k, v] of Object.entries(overrides)) if (v !== undefined) localConfig[k] = v;

    const hasCredential =
      Boolean(args.booleans['credential-stdin']) || Boolean(args.strings['credential-env']);
    const apiKey = hasCredential
      ? await readCredential(
          io,
          Boolean(args.booleans['credential-stdin']),
          args.strings['credential-env'],
          'credential',
        )
      : undefined;

    const probe = (await client.request('POST', `/routing/${enc(agent)}/custom-providers/probe`, {
      body: {
        provider_name: name,
        local_type: type,
        local_config: localConfig,
        ...(apiKey !== undefined ? { apiKey } : {}),
      },
    })) as { models?: Array<Record<string, unknown>>; version?: string; base_url?: string };
    const models = (probe.models ?? [])
      .filter((m) => typeof m?.['model_name'] === 'string')
      .map((m) => ({
        model_name: m['model_name'] as string,
        ...(typeof m['context_window'] === 'number' ? { context_window: m['context_window'] } : {}),
        ...(Array.isArray(m['capabilities'])
          ? {
              capabilities: (m['capabilities'] as unknown[]).filter(
                (c): c is string => typeof c === 'string' && MODEL_CAPABILITIES.has(c),
              ),
            }
          : {}),
      }));
    if (models.length === 0) {
      throw new CliError(
        'probe_empty',
        `${probe.base_url ?? type} answered but exposed no models`,
        'Load or pull at least one model on the server, then retry',
      );
    }
    const created = await client.request('POST', `/routing/${enc(agent)}/custom-providers`, {
      body: {
        name,
        ...(args.strings['alias'] !== undefined ? { alias: args.strings['alias'] } : {}),
        local_type: type,
        local_config: localConfig,
        ...(apiKey !== undefined ? { apiKey } : {}),
        models,
      },
    });
    printJson(io, {
      agent,
      server_version: probe.version ?? null,
      probed_models: models.length,
      provider: created,
    });
  },
  defaults: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'agent'], maxPositionals: 0 });
    const agent = await resolveDiscoveryAgent(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('GET', `/routing/${enc(agent)}/custom-providers/local-defaults`),
    );
  },
};

// ─── Connection settings ─────────────────────────────────────────────────────

/** `--x <n>` sets, `--x default` clears the override (null). */
function msOrDefault(args: ParsedArgs, name: string): number | null | undefined {
  const raw = args.strings[name];
  if (raw === undefined) return undefined;
  if (raw === 'default') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new CliError('invalid_flag', `--${name} must be milliseconds or "default"`);
  }
  return n;
}

export const connection: Record<string, Handler> = {
  set: async (io, argv) => {
    const args = parseArgs(argv, {
      strings: ['url', 'base-url', 'stream-idle-ms', 'stream-warmup-ms'],
      maxPositionals: 1,
    });
    const id = requirePositional(args, 0, '<connection-id>');
    const baseUrl = args.strings['base-url'];
    const idle = msOrDefault(args, 'stream-idle-ms');
    const warmup = msOrDefault(args, 'stream-warmup-ms');
    if (baseUrl === undefined && idle === undefined && warmup === undefined) {
      throw new CliError(
        'missing_flag',
        'Pass --base-url, --stream-idle-ms or --stream-warmup-ms',
        'Use "default" as the value to clear an override; ids come from thinker provider list',
      );
    }
    const { client } = clientFromFlags(io, args);
    const out: Record<string, unknown> = { id };
    if (baseUrl !== undefined) {
      out['base_url'] = await client.request(
        'PATCH',
        `/providers/connections/${enc(id)}/base-url`,
        {
          body: { base_url: baseUrl === 'default' ? null : baseUrl },
        },
      );
    }
    if (idle !== undefined) {
      out['stream_idle'] = await client.request(
        'PATCH',
        `/providers/connections/${enc(id)}/stream-idle`,
        { body: { stream_idle_timeout_ms: idle } },
      );
    }
    if (warmup !== undefined) {
      out['stream_warmup'] = await client.request(
        'PATCH',
        `/providers/connections/${enc(id)}/stream-warmup`,
        { body: { stream_warmup_ms: warmup } },
      );
    }
    printJson(io, out);
  },
};

// ─── Organizations (workspaces) and members ──────────────────────────────────

async function orgId(io: CliIo, args: ParsedArgs): Promise<string> {
  const needle = requirePositional(args, 0, '<org>');
  const { client } = clientFromFlags(io, args);
  const rows = rowsOf(await client.request('GET', '/organizations'), 'organizations');
  return findRow(rows, needle, 'organization', 'See thinker org list').id;
}

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

export const org: Record<string, Handler> = {
  list: simple('GET', () => '/organizations', { maxPositionals: 0 }),
  create: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'name'], maxPositionals: 0 });
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('POST', '/organizations', {
        body: { name: requireString(args, 'name') },
      }),
    );
  },
  rename: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'name'], maxPositionals: 1 });
    const id = await orgId(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('PATCH', `/organizations/${enc(id)}`, {
        body: { name: requireString(args, 'name') },
      }),
    );
  },
  delete: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 1 });
    const id = await orgId(io, args);
    requireYes(args, `delete organization ${args.positionals[0]}`);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('DELETE', `/organizations/${enc(id)}`));
  },
  'retention get': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], maxPositionals: 1 });
    const id = await orgId(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('GET', `/organizations/${enc(id)}/log-retention`));
  },
  'retention set': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'days'], maxPositionals: 1 });
    const raw = requireString(args, 'days');
    const days = raw === 'default' ? null : Number(raw);
    if (days !== null && (!Number.isInteger(days) || days < 1)) {
      throw new CliError('invalid_flag', '--days must be a positive integer or "default"');
    }
    const id = await orgId(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('PATCH', `/organizations/${enc(id)}/log-retention`, {
        body: { retention_days: days },
      }),
    );
  },
  members: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], maxPositionals: 1 });
    const id = await orgId(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('GET', `/organizations/${enc(id)}/members`));
  },
  'member add': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'email', 'name', 'role'], maxPositionals: 1 });
    const id = await orgId(io, args);
    const role = oneOf(args, 'role', ROLES) ?? 'member';
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('POST', `/organizations/${enc(id)}/members`, {
        body: {
          email: requireString(args, 'email'),
          ...(args.strings['name'] ? { name: args.strings['name'] } : {}),
          role,
        },
      }),
    );
  },
  'member role': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'role'], maxPositionals: 2 });
    const id = await orgId(io, args);
    const userId = requirePositional(args, 1, '<user-id>');
    const role = oneOf(args, 'role', ROLES);
    if (!role) throw new CliError('missing_flag', `--role is required (${ROLES.join(', ')})`);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('PATCH', `/organizations/${enc(id)}/members/${enc(userId)}`, {
        body: { role },
      }),
    );
  },
  'member remove': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 2 });
    const id = await orgId(io, args);
    const userId = requirePositional(args, 1, '<user-id>');
    requireYes(args, `remove member ${userId}`);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('DELETE', `/organizations/${enc(id)}/members/${enc(userId)}`),
    );
  },
};

// ─── Users (instance administrators only) ────────────────────────────────────

async function userId(io: CliIo, args: ParsedArgs): Promise<string> {
  const needle = requirePositional(args, 0, '<user>');
  const { client } = clientFromFlags(io, args);
  const rows = rowsOf(await client.request('GET', '/admin/users'), 'users');
  return findRow(rows, needle, 'user', 'See thinker user list', ['email']).id;
}

export const user: Record<string, Handler> = {
  list: simple('GET', () => '/admin/users', { maxPositionals: 0 }),
  create: async (io, argv) => {
    const args = parseArgs(argv, {
      strings: ['url', 'email', 'name', 'org', 'role'],
      booleans: ['instance-admin'],
      maxPositionals: 0,
    });
    const { client } = clientFromFlags(io, args);
    let organizationId: string | undefined;
    if (args.strings['org']) {
      const rows = rowsOf(await client.request('GET', '/organizations'), 'organizations');
      organizationId = findRow(
        rows,
        args.strings['org'],
        'organization',
        'See thinker org list',
      ).id;
    }
    printJson(
      io,
      await client.request('POST', '/admin/users', {
        body: {
          email: requireString(args, 'email'),
          name: requireString(args, 'name'),
          isInstanceAdmin: Boolean(args.booleans['instance-admin']),
          ...(organizationId
            ? { organizationId, role: oneOf(args, 'role', ROLES) ?? 'member' }
            : {}),
        },
      }),
    );
  },
  'reset-password': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 1 });
    const id = await userId(io, args);
    requireYes(args, `reset the password of ${args.positionals[0]}`);
    const { client } = clientFromFlags(io, args);
    printJson(io, await client.request('POST', `/admin/users/${enc(id)}/reset-password`));
  },
  'set-admin': async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url', 'enabled'], maxPositionals: 1 });
    const enabled = parseBooleanFlag(requireString(args, 'enabled'), 'enabled');
    const id = await userId(io, args);
    const { client } = clientFromFlags(io, args);
    printJson(
      io,
      await client.request('PATCH', `/admin/users/${enc(id)}`, {
        body: { isInstanceAdmin: enabled },
      }),
    );
  },
};

// ─── API keys (REST API, CLI and MCP) ────────────────────────────────────────

export const key: Record<string, Handler> = {
  list: simple('GET', () => '/api-keys', { maxPositionals: 0 }),
  create: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['name', 'expires-days', 'url'], maxPositionals: 0 });
    const name = requireString(args, 'name');
    const { client } = clientFromFlags(io, args);
    const body: Record<string, unknown> = { name };
    const days = intFlag(args, 'expires-days');
    if (days !== undefined) body['expires_in_days'] = days;
    printJson(io, await client.request('POST', '/api-keys', { body }));
  },
  revoke: async (io, argv) => {
    const args = parseArgs(argv, { strings: ['url'], booleans: ['yes'], maxPositionals: 1 });
    const needle = requirePositional(args, 0, '<id|name>');
    requireYes(args, `revoke API key ${needle}`);
    const { client } = clientFromFlags(io, args);
    const rows = rowsOf(await client.request('GET', '/api-keys'), 'keys');
    const id = findRow(rows, needle, 'API key', 'See thinker key list').id;
    printJson(io, await client.request('DELETE', `/api-keys/${enc(id)}`));
  },
};
