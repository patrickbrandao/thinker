import {
  applyAssignment,
  connection,
  hopsToLines,
  proxy,
  providerLocal,
  trigger,
  limit,
} from './manage';
import { resolveCommand } from '../index';
import { fetchStub, makeIo } from '../../test/helpers';

const HOST = 'http://localhost:2099';

function setup(replies: Array<{ status: number; body: unknown }>, stdin?: string) {
  const stub = fetchStub(replies);
  const io = makeIo({
    env: { THINKER_URL: HOST, THINKER_API_KEY: 'thinker-key' },
    fetchImpl: stub.impl,
    ...(stdin !== undefined ? { stdin } : {}),
  });
  return { io, calls: stub.calls };
}

describe('applyAssignment', () => {
  it('nests dotted paths and parses JSON values', () => {
    const body: Record<string, unknown> = { config: { host: 'a' } };
    applyAssignment(body, 'config.port=12201');
    applyAssignment(body, 'config.compress=true');
    applyAssignment(body, 'name=graylog');
    expect(body).toEqual({ config: { host: 'a', port: 12201, compress: true }, name: 'graylog' });
  });

  it('rejects an assignment without a path', () => {
    expect(() => applyAssignment({}, '=x')).toThrow('--set expects');
  });
});

describe('dispatch', () => {
  it('resolves the new three-word commands', () => {
    expect(resolveCommand(['proxy', 'server', 'create', '--name', 'x'])?.key).toBe(
      'proxy server create',
    );
    expect(resolveCommand(['provider', 'local', 'add'])?.key).toBe('provider local add');
    expect(resolveCommand(['org', 'member', 'add', 'acme'])?.rest).toEqual(['acme']);
  });
});

describe('trigger', () => {
  it('create merges --data, typed flags and --set', async () => {
    const { io, calls } = setup([{ status: 201, body: { id: 't1' } }]);
    await trigger.create(io, [
      '--data',
      '{"config":{"host":"logs"},"enabled":false}',
      '--name',
      'Graylog',
      '--type',
      'gelf',
      '--event',
      'request.failed',
      '--set',
      'config.port=12201',
    ]);
    expect(calls[0].method).toBe('POST');
    expect(JSON.parse(calls[0].body!)).toEqual({
      config: { host: 'logs', port: 12201 },
      enabled: false,
      name: 'Graylog',
      type: 'gelf',
      workspace_events: ['request.failed'],
    });
  });

  it('update resolves a trigger by name', async () => {
    const { io, calls } = setup([
      { status: 200, body: { triggers: [{ id: 't1', name: 'Graylog' }] } },
      { status: 200, body: { id: 't1' } },
    ]);
    await trigger.update(io, ['graylog', '--enabled', 'true']);
    expect(calls[1].url).toBe(`${HOST}/api/v1/triggers/t1`);
    expect(JSON.parse(calls[1].body!)).toEqual({ enabled: true });
  });

  it('delete requires --yes', async () => {
    const { io } = setup([{ status: 200, body: { triggers: [{ id: 't1', name: 'x' }] } }]);
    await expect(trigger.delete(io, ['x'])).rejects.toThrow('without --yes');
  });
});

describe('proxy assign set', () => {
  it('resolves the profile name to its id', async () => {
    const { io, calls } = setup([
      { status: 200, body: { profiles: [{ id: 'p1', name: 'Chain' }] } },
      { status: 200, body: {} },
    ]);
    await proxy['assign set'](io, ['connection', 'c1', '--mode', 'profile', '--profile', 'chain']);
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].url).toBe(`${HOST}/api/v1/proxy-assignments/connection/c1`);
    expect(JSON.parse(calls[1].body!)).toEqual({ mode: 'profile', profile_id: 'p1' });
  });
});

describe('proxy profile create', () => {
  it('sends each --hop as a line, balanced lines with their options', async () => {
    const { io, calls } = setup([{ status: 201, body: {} }]);
    await proxy['profile create'](io, [
      '--name',
      'Balance-Dual',
      '--hop',
      'affinity:x1,x3?no_session=agent',
      '--hop',
      'request:x2, x4?on_failure=next_line',
      '--hop',
      'direct',
    ]);
    expect(JSON.parse(calls[0].body!)).toEqual({
      name: 'Balance-Dual',
      lines: [
        { mode: 'affinity', proxies: ['x1', 'x3'], no_session: 'agent' },
        { mode: 'request', proxies: ['x2', 'x4'], on_failure: 'next_line' },
        { mode: 'direct' },
      ],
    });
  });

  it('keeps plain proxy hops and refuses unknown options', () => {
    expect(hopsToLines(['x1'])).toEqual([{ mode: 'proxy', proxies: ['x1'] }]);
    expect(hopsToLines(undefined)).toBeUndefined();
    expect(() => hopsToLines(['request:a,b?weight=2'])).toThrow('Unknown --hop option');
  });
});

describe('limit create', () => {
  it('posts the rule for the agent', async () => {
    const { io, calls } = setup([{ status: 201, body: {} }]);
    await limit.create(io, [
      'bot',
      '--metric',
      'cost',
      '--threshold',
      '25.5',
      '--period',
      'month',
      '--action',
      'block',
    ]);
    expect(JSON.parse(calls[0].body!)).toEqual({
      agent_name: 'bot',
      metric_type: 'cost',
      threshold: 25.5,
      period: 'month',
      action: 'block',
    });
  });

  it('rejects an unknown period', async () => {
    const { io } = setup([]);
    await expect(
      limit.create(io, ['bot', '--metric', 'cost', '--threshold', '1', '--period', 'year']),
    ).rejects.toThrow('--period must be one of');
  });
});

describe('provider local add', () => {
  it('probes with the type defaults plus overrides, then registers the models', async () => {
    const { io, calls } = setup([
      {
        status: 200,
        body: [
          {
            type: 'lmstudio',
            config: { scheme: 'http', host: 'host.docker.internal', port: 1234 },
          },
        ],
      },
      {
        status: 200,
        body: {
          version: '0.3',
          base_url: 'http://mac:1234/v1',
          models: [
            {
              model_name: 'qwen3',
              context_window: 32768,
              capabilities: ['tools', 'embeddings'],
              loaded: true,
            },
          ],
        },
      },
      { status: 201, body: { id: 'cp1' } },
    ]);
    await providerLocal.add(io, [
      '--type',
      'lmstudio',
      '--name',
      'LM-Studio-Mac',
      '--host',
      'mac',
      '--agent',
      'bot',
    ]);
    const config = { scheme: 'http', host: 'mac', port: 1234 };
    expect(calls[0].url).toBe(`${HOST}/api/v1/routing/bot/custom-providers/local-defaults`);
    expect(JSON.parse(calls[1].body!)).toEqual({
      provider_name: 'LM-Studio-Mac',
      local_type: 'lmstudio',
      local_config: config,
    });
    expect(JSON.parse(calls[2].body!)).toEqual({
      name: 'LM-Studio-Mac',
      local_type: 'lmstudio',
      local_config: config,
      models: [{ model_name: 'qwen3', context_window: 32768, capabilities: ['tools'] }],
    });
    expect(io.lastJson()).toMatchObject({ server_version: '0.3', probed_models: 1 });
  });
});

describe('connection set', () => {
  it('sends one PATCH per setting and clears with "default"', async () => {
    const { io, calls } = setup([
      { status: 200, body: { id: 'c1', base_url: null } },
      { status: 200, body: { id: 'c1', stream_idle_timeout_ms: 90000 } },
    ]);
    await connection.set(io, ['c1', '--base-url', 'default', '--stream-idle-ms', '90000']);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `PATCH ${HOST}/api/v1/providers/connections/c1/base-url`,
      `PATCH ${HOST}/api/v1/providers/connections/c1/stream-idle`,
    ]);
    expect(JSON.parse(calls[0].body!)).toEqual({ base_url: null });
    expect(JSON.parse(calls[1].body!)).toEqual({ stream_idle_timeout_ms: 90000 });
  });
});
