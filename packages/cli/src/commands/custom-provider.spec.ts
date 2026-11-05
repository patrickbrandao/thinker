import { providerCustom } from './custom-provider';
import { fetchStub, makeIo } from '../../test/helpers';

const HOST = 'http://localhost:2099';
const AGENTS = { status: 200, body: { agents: [{ agent_name: 'john' }] } };

function setup(
  replies: Array<{ status: number; body: unknown }>,
  env: Record<string, string> = {},
  stdin?: string,
) {
  const stub = fetchStub(replies);
  const io = makeIo({
    env: { THINKER_URL: HOST, THINKER_API_KEY: 'thinker-key', ...env },
    fetchImpl: stub.impl,
    ...(stdin !== undefined ? { stdin } : {}),
  });
  return { io, calls: stub.calls };
}

describe('providerCustom.add', () => {
  it('probes then registers, reusing the discovered models', async () => {
    const { io, calls } = setup([
      AGENTS,
      { status: 200, body: { models: [{ model_name: 'llama-4' }, { model_name: 'qwen-3' }] } },
      { status: 201, body: { id: 'cp-1', name: 'LiteLLM' } },
    ]);
    await providerCustom.add(io, ['--name', 'LiteLLM', '--endpoint', 'http://gw:4000']);

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${HOST}/api/v1/agents`,
      `POST ${HOST}/api/v1/routing/john/custom-providers/probe`,
      `POST ${HOST}/api/v1/routing/john/custom-providers`,
    ]);
    expect(JSON.parse(calls[1].body!)).toEqual({
      base_url: 'http://gw:4000',
      provider_name: 'LiteLLM',
    });
    expect(JSON.parse(calls[2].body!)).toEqual({
      name: 'LiteLLM',
      base_url: 'http://gw:4000',
      models: [{ model_name: 'llama-4' }, { model_name: 'qwen-3' }],
    });
    expect(io.lastJson()).toEqual({
      agent: 'john',
      probed_models: 2,
      provider: { id: 'cp-1', name: 'LiteLLM' },
    });
  });

  it('skips the agent lookup when --agent is given and slugifies it', async () => {
    const { io, calls } = setup([
      { status: 200, body: { models: [{ model_name: 'm' }] } },
      { status: 201, body: {} },
    ]);
    await providerCustom.add(io, [
      '--name',
      'x',
      '--endpoint',
      'http://x:1',
      '--agent',
      'My Agent',
    ]);
    expect(calls[0].url).toBe(`${HOST}/api/v1/routing/my-agent/custom-providers/probe`);
    expect(calls).toHaveLength(2);
  });

  it('url-encodes the agent in the path', async () => {
    const { io, calls } = setup([
      { status: 200, body: { models: [{ model_name: 'm' }] } },
      { status: 201, body: {} },
    ]);
    await providerCustom.add(io, ['--name', 'x', '--endpoint', 'http://x:1', '--agent', 'a_b']);
    expect(calls[0].url).toContain('/routing/a-b/');
  });

  it('forwards --api to both the probe and the registration', async () => {
    const { io, calls } = setup([
      { status: 200, body: { models: [{ model_name: 'm' }] } },
      { status: 201, body: {} },
    ]);
    await providerCustom.add(io, [
      '--name',
      'x',
      '--endpoint',
      'http://x:1',
      '--agent',
      'john',
      '--api',
      'anthropic',
    ]);
    expect(JSON.parse(calls[0].body!).api_kind).toBe('anthropic');
    expect(JSON.parse(calls[1].body!).api_kind).toBe('anthropic');
  });

  it('sends the credential from an env var to the server and never prints it', async () => {
    const { io, calls } = setup(
      [
        { status: 200, body: { models: ['m1', 'm2'] } },
        { status: 201, body: { id: 'cp' } },
      ],
      { MY_KEY: '  sk-super-secret  ' },
    );
    await providerCustom.add(io, [
      '--name',
      'x',
      '--endpoint',
      'http://x:1',
      '--agent',
      'john',
      '--credential-env',
      'MY_KEY',
    ]);
    expect(JSON.parse(calls[0].body!).apiKey).toBe('sk-super-secret');
    expect(JSON.parse(calls[1].body!).apiKey).toBe('sk-super-secret');
    expect(io.lines.join('\n')).not.toContain('sk-super-secret');
    expect(io.errLines.join('\n')).not.toContain('sk-super-secret');
  });

  it('reads the credential from stdin', async () => {
    const { io, calls } = setup(
      [
        { status: 200, body: { models: ['m'] } },
        { status: 201, body: {} },
      ],
      {},
      'sk-from-stdin\n',
    );
    await providerCustom.add(io, [
      '--name',
      'x',
      '--endpoint',
      'http://x:1',
      '--agent',
      'john',
      '--credential-stdin',
    ]);
    expect(JSON.parse(calls[0].body!).apiKey).toBe('sk-from-stdin');
    expect(io.lines.join('\n')).not.toContain('sk-from-stdin');
  });

  it('normalizes a model list of plain strings and drops malformed entries', async () => {
    const { io, calls } = setup([
      {
        status: 200,
        body: { models: ['a', { model_name: 'b' }, { model_name: 5 }, {}, null, { other: 1 }] },
      },
      { status: 201, body: {} },
    ]);
    await providerCustom.add(io, ['--name', 'x', '--endpoint', 'http://x:1', '--agent', 'john']);
    expect(JSON.parse(calls[1].body!).models).toEqual([{ model_name: 'a' }, { model_name: 'b' }]);
    expect((io.lastJson() as { probed_models: number }).probed_models).toBe(2);
  });

  it.each([
    ['empty models', { models: [] }],
    ['no models field', {}],
    ['only malformed models', { models: [{}, null] }],
  ])('fails with probe_empty on %s and never registers', async (_label, body) => {
    const { io, calls } = setup([{ status: 200, body }]);
    await expect(
      providerCustom.add(io, ['--name', 'x', '--endpoint', 'http://x:1', '--agent', 'john']),
    ).rejects.toMatchObject({ code: 'probe_empty' });
    expect(calls).toHaveLength(1);
  });

  it('fails when the probe itself errors, before registering', async () => {
    const { io, calls } = setup([{ status: 502, body: { message: 'unreachable' } }]);
    await expect(
      providerCustom.add(io, ['--name', 'x', '--endpoint', 'http://x:1', '--agent', 'john']),
    ).rejects.toMatchObject({ status: 502 });
    expect(calls).toHaveLength(1);
  });

  it('requires --name and --endpoint before any request', async () => {
    const { io, calls } = setup([AGENTS]);
    await expect(providerCustom.add(io, ['--endpoint', 'http://x:1'])).rejects.toMatchObject({
      code: 'missing_flag',
    });
    await expect(providerCustom.add(io, ['--name', 'x'])).rejects.toMatchObject({
      code: 'missing_flag',
    });
    expect(calls).toHaveLength(0);
  });

  it('rejects an unknown --api kind', async () => {
    const { io, calls } = setup([AGENTS]);
    await expect(
      providerCustom.add(io, ['--name', 'x', '--endpoint', 'http://x:1', '--api', 'grpc']),
    ).rejects.toMatchObject({ code: 'invalid_flag' });
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty credential source before any request', async () => {
    const { io, calls } = setup([AGENTS]);
    await expect(
      providerCustom.add(io, [
        '--name',
        'x',
        '--endpoint',
        'http://x:1',
        '--credential-env',
        'UNSET_VAR',
      ]),
    ).rejects.toMatchObject({ code: 'credential_empty' });
    expect(calls).toHaveLength(0);
  });

  it('rejects both credential sources together', async () => {
    const { io } = setup([AGENTS], { K: 'v' }, 'v');
    await expect(
      providerCustom.add(io, [
        '--name',
        'x',
        '--endpoint',
        'http://x:1',
        '--credential-env',
        'K',
        '--credential-stdin',
      ]),
    ).rejects.toMatchObject({ code: 'credential_source_required' });
  });

  it('fails with no_agents when none exists and --agent is absent', async () => {
    const { io } = setup([{ status: 200, body: { agents: [] } }]);
    await expect(
      providerCustom.add(io, ['--name', 'x', '--endpoint', 'http://x:1']),
    ).rejects.toMatchObject({ code: 'no_agents' });
  });

  it('rejects positional arguments', async () => {
    const { io } = setup([AGENTS]);
    await expect(
      providerCustom.add(io, ['stray', '--name', 'x', '--endpoint', 'http://x:1']),
    ).rejects.toMatchObject({ code: 'unexpected_argument' });
  });
});

describe('providerCustom.list', () => {
  it('prints the providers of the first agent', async () => {
    const { io, calls } = setup([AGENTS, { status: 200, body: [{ id: 'cp-1', name: 'x' }] }]);
    await providerCustom.list(io, []);
    expect(calls[1].method).toBe('GET');
    expect(calls[1].url).toBe(`${HOST}/api/v1/routing/john/custom-providers`);
    expect(io.lastJson()).toEqual([{ id: 'cp-1', name: 'x' }]);
  });

  it('honours --agent', async () => {
    const { io, calls } = setup([{ status: 200, body: [] }]);
    await providerCustom.list(io, ['--agent', 'Other']);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${HOST}/api/v1/routing/other/custom-providers`);
  });

  it('rejects positionals', async () => {
    const { io } = setup([]);
    await expect(providerCustom.list(io, ['x'])).rejects.toMatchObject({
      code: 'unexpected_argument',
    });
  });
});

describe('providerCustom.remove', () => {
  const ROWS = {
    status: 200,
    body: [
      { id: 'cp-1', name: 'My LiteLLM' },
      { id: 'cp-2', name: 'Other' },
    ],
  };

  it('requires the name or id', async () => {
    const { io, calls } = setup([]);
    await expect(providerCustom.remove(io, ['--yes'])).rejects.toMatchObject({
      code: 'missing_argument',
    });
    expect(calls).toHaveLength(0);
  });

  it('resolves by name ignoring case and deletes by id', async () => {
    const { io, calls } = setup([AGENTS, ROWS, { status: 200, body: { ok: true } }]);
    await providerCustom.remove(io, ['my litellm', '--yes']);
    expect(calls[2].method).toBe('DELETE');
    expect(calls[2].url).toBe(`${HOST}/api/v1/routing/john/custom-providers/cp-1`);
    expect(io.lastJson()).toEqual({ ok: true });
  });

  it('resolves by id', async () => {
    const { io, calls } = setup([AGENTS, ROWS, { status: 200, body: { ok: true } }]);
    await providerCustom.remove(io, ['cp-2', '--yes']);
    expect(calls[2].url).toBe(`${HOST}/api/v1/routing/john/custom-providers/cp-2`);
  });

  it('url-encodes the id in the delete path', async () => {
    const { io, calls } = setup([
      { status: 200, body: [{ id: 'a/b c', name: 'weird' }] },
      { status: 200, body: {} },
    ]);
    await providerCustom.remove(io, ['weird', '--yes', '--agent', 'john']);
    expect(calls[1].url).toBe(`${HOST}/api/v1/routing/john/custom-providers/a%2Fb%20c`);
  });

  it('refuses to delete without --yes', async () => {
    const { io, calls } = setup([AGENTS, ROWS]);
    await expect(providerCustom.remove(io, ['cp-1'])).rejects.toMatchObject({
      code: 'confirmation_required',
    });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('404s on an unknown provider and never deletes', async () => {
    const { io, calls } = setup([AGENTS, ROWS]);
    await expect(providerCustom.remove(io, ['ghost', '--yes'])).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it.each([
    ['a non-array body', { not: 'a list' }],
    ['a null body', null],
  ])('404s on %s', async (_label, body) => {
    const { io } = setup([AGENTS, { status: 200, body }]);
    await expect(providerCustom.remove(io, ['x', '--yes'])).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('ignores list rows that are not objects or lack an id', async () => {
    const { io } = setup([AGENTS, { status: 200, body: ['x', null, { name: 'noid' }] }]);
    await expect(providerCustom.remove(io, ['noid', '--yes'])).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('propagates a server failure on delete', async () => {
    const { io } = setup([AGENTS, ROWS, { status: 409, body: { message: 'in use by a route' } }]);
    await expect(providerCustom.remove(io, ['cp-1', '--yes'])).rejects.toMatchObject({
      status: 409,
    });
  });
});
