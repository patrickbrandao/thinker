import { run } from '../index';
import { saveAgentKey } from '../keystore';
import { fetchStub, makeIo } from '../../test/helpers';

const HOST = 'http://localhost:2099';
const BASE = `${HOST}/api/v1/routing/john/virtual-models`;

function authedIo(
  replies: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
) {
  const stub = fetchStub(replies);
  const io = makeIo({
    env: { THINKER_URL: HOST, THINKER_API_KEY: 'env-key' },
    fetchImpl: stub.impl,
  });
  return { io, calls: stub.calls };
}

const VIEW = {
  id: 'vm-1',
  name: 'DeepSeek/Flash',
  enabled: true,
  override_route: { provider: 'deepseek', authType: 'api_key', model: 'deepseek-chat' },
  fallback_routes: null,
  continue_on_default: false,
  response_mode: 'buffered',
  shadows: [],
  context_length: 64000,
};
const LIST = { status: 200, body: [VIEW] };

describe('routing virtual', () => {
  it('list reads the agent virtual models', async () => {
    const { io, calls } = authedIo([LIST]);
    expect(await run(io, ['routing', 'virtual', 'list', 'John'])).toBe(0);
    expect(calls[0]).toMatchObject({ method: 'GET', url: BASE });
    expect(io.lastJson()).toEqual([VIEW]);
  });

  it('create sends the name, the pinned primary, repeated fallbacks and the flags in one POST', async () => {
    const { io, calls } = authedIo([{ status: 201, body: VIEW }]);
    expect(
      await run(io, [
        'routing',
        'virtual',
        'create',
        'john',
        '--name',
        'DeepSeek/Flash',
        '--model',
        'deepseek-chat',
        '--provider',
        'deepseek',
        '--auth-type',
        'api_key',
        '--key-label',
        'Work',
        '--fallback',
        'gpt-4o',
        '--fallback',
        'anthropic/claude-sonnet-4-5',
        '--continue-on-default',
        '--response-mode',
        'stream',
      ]),
    ).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: BASE });
    expect(JSON.parse(calls[0].body!)).toEqual({
      name: 'DeepSeek/Flash',
      override_route: {
        model: 'deepseek-chat',
        provider: 'deepseek',
        authType: 'api_key',
        keyLabel: 'Work',
      },
      fallback_routes: [{ model: 'gpt-4o' }, { model: 'anthropic/claude-sonnet-4-5' }],
      continue_on_default: true,
      response_mode: 'stream',
    });
    expect(io.lastJson()).toEqual(VIEW);
  });

  it('create with only a name is a pure continue-on-Default alias', async () => {
    const { io, calls } = authedIo([{ status: 201, body: VIEW }]);
    expect(
      await run(io, [
        'routing',
        'virtual',
        'create',
        'john',
        '--name',
        'cheap',
        '--continue-on-default',
      ]),
    ).toBe(0);
    expect(JSON.parse(calls[0].body!)).toEqual({ name: 'cheap', continue_on_default: true });
  });

  it('create rejects bad input before any request', async () => {
    const cases: Array<[string[], string]> = [
      [['--model', 'm'], 'missing_flag'],
      [['--name', 'x', '--fallback', 'gpt-4o'], 'missing_flag'],
      [['--name', 'x', '--provider', 'openai'], 'missing_flag'],
      [['--name', 'x', '--response-mode', 'fast'], 'invalid_flag'],
      [['--name', 'x', '--fallbacks', 'a,b'], 'unknown_flag'],
    ];
    for (const [flags, error] of cases) {
      const { io, calls } = authedIo([]);
      expect(await run(io, ['routing', 'virtual', 'create', 'john', ...flags])).toBe(1);
      expect(io.lastJson()).toMatchObject({ error });
      expect(calls).toHaveLength(0);
    }
  });

  it('create surfaces the server validation error', async () => {
    const { io } = authedIo([
      { status: 400, body: { message: 'Model "nope" is not available for this agent' } },
    ]);
    expect(
      await run(io, ['routing', 'virtual', 'create', 'john', '--name', 'x', '--model', 'nope']),
    ).toBe(1);
    expect(io.lastJson()).toMatchObject({
      message: 'Model "nope" is not available for this agent',
      status: 400,
    });
  });

  it('update finds the row by name ignoring case and writes routes before metadata', async () => {
    const { io, calls } = authedIo([
      LIST,
      { status: 200, body: VIEW },
      { status: 200, body: [] },
      { status: 200, body: VIEW },
      { status: 200, body: { ...VIEW, name: 'flash' } },
      { status: 200, body: [{ ...VIEW, name: 'flash' }] },
    ]);
    expect(
      await run(io, [
        'routing',
        'virtual',
        'update',
        'john',
        'deepseek/FLASH',
        '--model',
        'deepseek-reasoner',
        '--key-label',
        'Work',
        '--fallback',
        'gpt-4o',
        '--response-mode',
        'stream',
        '--name',
        'flash',
        '--no-continue-on-default',
      ]),
    ).toBe(0);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${BASE}`,
      `PUT ${BASE}/vm-1/override`,
      `PUT ${BASE}/vm-1/fallbacks`,
      `PATCH ${BASE}/vm-1/response-mode`,
      `PUT ${BASE}/vm-1`,
      `GET ${BASE}`,
    ]);
    expect(JSON.parse(calls[1].body!)).toEqual({
      model: 'deepseek-reasoner',
      providerKeyLabel: 'Work',
    });
    expect(JSON.parse(calls[2].body!)).toEqual({ models: ['gpt-4o'] });
    expect(JSON.parse(calls[3].body!)).toEqual({ response_mode: 'stream' });
    expect(JSON.parse(calls[4].body!)).toEqual({ name: 'flash', continue_on_default: false });
    expect(io.lastJson()).toMatchObject({ id: 'vm-1', name: 'flash' });
  });

  it('update refuses a taken name before writing, and reports a partial update', async () => {
    const two = { status: 200, body: [VIEW, { ...VIEW, id: 'vm-2', name: 'Other' }] };
    const { io, calls } = authedIo([two]);
    expect(
      await run(io, [
        'routing',
        'virtual',
        'update',
        'john',
        'vm-1',
        '--model',
        'gpt-4o',
        '--name',
        'OTHER',
      ]),
    ).toBe(1);
    expect(io.lastJson()).toMatchObject({ error: 'conflict', status: 409 });
    expect(calls).toHaveLength(1);

    const { io: io2, calls: calls2 } = authedIo([
      LIST,
      { status: 200, body: VIEW },
      { status: 400, body: { message: 'Fallback "nope" is not available' } },
    ]);
    expect(
      await run(io2, [
        'routing',
        'virtual',
        'update',
        'john',
        'vm-1',
        '--model',
        'gpt-4o',
        '--fallback',
        'nope',
        '--name',
        'x',
      ]),
    ).toBe(1);
    expect(io2.lastJson()).toMatchObject({
      message: 'Fallback "nope" is not available (already applied to "DeepSeek/Flash": --model)',
      status: 400,
    });
    expect(calls2).toHaveLength(3);

    const { io: io3 } = authedIo([LIST, { status: 400, body: { message: 'bad model' } }]);
    expect(
      await run(io3, ['routing', 'virtual', 'update', 'john', 'vm-1', '--model', 'nope']),
    ).toBe(1);
    expect(io3.lastJson()).toMatchObject({ message: 'bad model' });
  });

  it('update prints the view the last write returned when no read-back is needed', async () => {
    const { io, calls } = authedIo([LIST, { status: 200, body: { ...VIEW, enabled: true } }]);
    expect(
      await run(io, ['routing', 'virtual', 'update', 'john', 'vm-1', '--continue-on-default']),
    ).toBe(0);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1].body!)).toEqual({ continue_on_default: true });
  });

  it('update clears fallbacks, or the primary with its fallbacks', async () => {
    const { io, calls } = authedIo([LIST, { status: 200, body: { ok: true } }, LIST]);
    expect(
      await run(io, ['routing', 'virtual', 'update', 'john', 'vm-1', '--clear-fallbacks']),
    ).toBe(0);
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: `${BASE}/vm-1/fallbacks` });

    const { io: io2, calls: calls2 } = authedIo([LIST, { status: 200, body: { ok: true } }, LIST]);
    expect(
      await run(io2, [
        'routing',
        'virtual',
        'update',
        'john',
        'vm-1',
        '--clear-model',
        '--clear-fallbacks',
      ]),
    ).toBe(0);
    expect(calls2.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${BASE}`,
      `DELETE ${BASE}/vm-1/override`,
      `GET ${BASE}`,
    ]);
  });

  it('update rejects empty, contradictory and orphan-fallback changes', async () => {
    const local: Array<[string[], string]> = [
      [[], 'missing_flag'],
      [['--continue-on-default', '--no-continue-on-default'], 'invalid_flag'],
      [['--fallback', 'a', '--clear-fallbacks'], 'invalid_flag'],
      [['--clear-model', '--model', 'm'], 'invalid_flag'],
      [['--key-label', 'Work'], 'missing_flag'],
    ];
    for (const [flags, error] of local) {
      const { io, calls } = authedIo([]);
      expect(await run(io, ['routing', 'virtual', 'update', 'john', 'vm-1', ...flags])).toBe(1);
      expect(io.lastJson()).toMatchObject({ error });
      expect(calls).toHaveLength(0);
    }

    const { io, calls } = authedIo([{ status: 200, body: [{ ...VIEW, override_route: null }] }]);
    expect(
      await run(io, ['routing', 'virtual', 'update', 'john', 'vm-1', '--fallback', 'gpt-4o']),
    ).toBe(1);
    expect(io.lastJson()).toMatchObject({ error: 'missing_flag' });
    expect(calls).toHaveLength(1);

    const { io: io2 } = authedIo([{ status: 200, body: [] }]);
    expect(await run(io2, ['routing', 'virtual', 'update', 'john', 'ghost', '--name', 'x'])).toBe(
      1,
    );
    expect(io2.lastJson()).toMatchObject({
      error: 'not_found',
      hint: 'See thinker routing virtual list john',
    });
  });

  it('delete requires --yes and reports what it deleted', async () => {
    const { io, calls } = authedIo([LIST]);
    expect(await run(io, ['routing', 'virtual', 'delete', 'john', 'DeepSeek/Flash'])).toBe(1);
    expect(io.lastJson()).toMatchObject({ error: 'confirmation_required' });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);

    const { io: io2, calls: calls2 } = authedIo([LIST, { status: 200, body: { ok: true } }]);
    expect(
      await run(io2, ['routing', 'virtual', 'delete', 'john', 'deepseek/flash', '--yes']),
    ).toBe(0);
    expect(calls2[1]).toMatchObject({ method: 'DELETE', url: `${BASE}/vm-1` });
    expect(io2.lastJson()).toEqual({ ok: true, deleted: { id: 'vm-1', name: 'DeepSeek/Flash' } });
  });

  it('enable and disable toggle the row', async () => {
    const { io, calls } = authedIo([LIST, { status: 200, body: { ...VIEW, enabled: false } }]);
    expect(await run(io, ['routing', 'virtual', 'disable', 'john', 'DeepSeek/Flash'])).toBe(0);
    expect(calls[1]).toMatchObject({ method: 'PATCH', url: `${BASE}/vm-1/toggle` });
    expect(JSON.parse(calls[1].body!)).toEqual({ enabled: false });

    const { io: io2, calls: calls2 } = authedIo([LIST, { status: 200, body: VIEW }]);
    expect(await run(io2, ['routing', 'virtual', 'enable', 'john', 'vm-1'])).toBe(0);
    expect(JSON.parse(calls2[1].body!)).toEqual({ enabled: true });
  });
});

describe('routing status with virtual models', () => {
  const status = (defaultRoute: unknown, virtualModels: unknown[]) =>
    authedIo([
      { status: 200, body: [{ tier: 'default', override_route: defaultRoute }] },
      { status: 200, body: [] },
      { status: 200, body: virtualModels },
      { status: 200, body: { enabled: true } },
    ]);

  it('reports routing by virtual model when the default route is empty', async () => {
    const { io } = status(null, [
      VIEW,
      { ...VIEW, id: 'vm-2', name: 'off', enabled: false },
      { ...VIEW, id: 'vm-3', name: 'onDefault', override_route: null, continue_on_default: true },
    ]);
    expect(await run(io, ['routing', 'status', 'john'])).toBe(0);
    expect(io.lastJson()).toMatchObject({
      default: { route: null },
      routes_by_virtual_model: true,
      active_virtual_models: ['DeepSeek/Flash'],
    });
  });

  it('counts a continue-on-Default virtual model only when the default route exists', async () => {
    const onDefault = {
      ...VIEW,
      name: 'onDefault',
      override_route: null,
      continue_on_default: true,
    };
    const { io } = status(null, [onDefault]);
    expect(await run(io, ['routing', 'status', 'john'])).toBe(0);
    expect(io.lastJson()).toMatchObject({
      routes_by_virtual_model: false,
      active_virtual_models: [],
    });

    const { io: io2 } = status({ model: 'gpt-4o' }, [onDefault]);
    expect(await run(io2, ['routing', 'status', 'john'])).toBe(0);
    expect(io2.lastJson()).toMatchObject({ active_virtual_models: ['onDefault'] });
  });
});

describe('routing params --virtual', () => {
  it('get and set address the virtual model through its own endpoint', async () => {
    const view = { virtual: 'DeepSeek/Flash', route: {}, models: [], params: [] };
    const { io, calls } = authedIo([{ status: 200, body: view }]);
    expect(await run(io, ['routing', 'params', 'get', 'john', '--virtual', 'deepseek/flash'])).toBe(
      0,
    );
    expect(calls[0].url).toBe(
      `${HOST}/api/v1/routing/john/virtual-model-params?virtual=deepseek%2Fflash`,
    );
    expect(io.lastJson()).toEqual(view);

    const { io: io2, calls: calls2 } = authedIo([{ status: 200, body: view }]);
    expect(
      await run(io2, [
        'routing',
        'params',
        'set',
        'john',
        '--virtual',
        'DeepSeek/Flash',
        '--model',
        'gpt-4o',
        '--set',
        'temperature=0.2',
      ]),
    ).toBe(0);
    expect(calls2[0].method).toBe('PATCH');
    expect(calls2[0].url).toBe(
      `${HOST}/api/v1/routing/john/virtual-model-params?virtual=DeepSeek%2FFlash&model=gpt-4o`,
    );
    expect(JSON.parse(calls2[0].body!)).toEqual({ set: { temperature: 0.2 } });
  });

  it('refuses --tier together with --virtual before any request', async () => {
    const both = ['john', '--tier', 'deep', '--virtual', 'deep'];
    for (const argv of [
      ['get', ...both],
      ['set', ...both, '--set', 'temperature=1'],
    ]) {
      const { io, calls } = authedIo([]);
      expect(await run(io, ['routing', 'params', ...argv])).toBe(1);
      expect(io.lastJson()).toMatchObject({
        error: 'invalid_flag',
        message: 'Pass --tier or --virtual, not both',
      });
      expect(calls).toHaveLength(0);
    }
  });
});

describe('routing test with a virtual model', () => {
  it('sends the virtual name as model and reports the virtual model and reason', async () => {
    const { io, calls } = authedIo([
      {
        status: 200,
        body: { model: 'deepseek-chat', choices: [{ message: { content: 'OK' } }] },
        headers: {
          'X-Thinker-Reason': 'virtual-model',
          'X-Thinker-Virtual-Model': 'DeepSeek/Flash',
        },
      },
    ]);
    saveAgentKey(io.env, HOST, 'john', 'k');
    expect(
      await run(io, ['routing', 'test', 'john', '--as', 'openclaw', '--model', 'deepseek/flash']),
    ).toBe(0);
    expect(JSON.parse(calls[0].body!).model).toBe('deepseek/flash');
    expect(io.lastJson()).toMatchObject({
      ok: true,
      requested_model: 'deepseek/flash',
      routing_reason: 'virtual-model',
      virtual_model: 'DeepSeek/Flash',
      served_model: 'deepseek-chat',
    });
  });

  it('omits the virtual model when the request did not match one', async () => {
    const { io } = authedIo([
      {
        status: 200,
        body: { model: 'gpt-4o', choices: [{ message: { content: 'OK' } }] },
        headers: { 'X-Thinker-Reason': 'default' },
      },
    ]);
    saveAgentKey(io.env, HOST, 'john', 'k');
    expect(await run(io, ['routing', 'test', 'john', '--as', 'openclaw'])).toBe(0);
    const out = io.lastJson() as Record<string, unknown>;
    expect(out['routing_reason']).toBe('default');
    expect(out).not.toHaveProperty('virtual_model');
  });
});
