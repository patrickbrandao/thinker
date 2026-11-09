import { McpServer } from '@modelcontextprotocol/server';
import type { McpOperator } from '../mcp-auth';
import type { McpToolDeps } from '../tool-deps';
import {
  findVirtualModel,
  registerVirtualModelTools,
  summarizeVirtualModel,
} from './virtual-models.tools';

// The auth instance is ESM-only; the tool files read nothing but the origin.
jest.mock('../../auth/auth.instance', () => ({ authOrigin: 'http://localhost:2099' }));

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

const TENANT = 'tenant-1';
const AGENT = { id: 'agent-1', tenant_id: TENANT, name: 'demo' };
const ROUTE = { provider: 'openai', authType: 'api_key', model: 'gpt-4o' };

const ROW = {
  id: 'vm-1',
  agent_id: 'agent-1',
  tenant_id: TENANT,
  name: 'Fast/Flash',
  enabled: true,
  override_route: ROUTE,
  fallback_routes: null,
  continue_on_default: false,
  response_mode: 'buffered',
};
const VIEW = { ...ROW, shadows: [], context_length: 1000, routable: true };

function makeDeps(): McpToolDeps {
  return {
    resolveAgent: { resolve: jest.fn().mockResolvedValue(AGENT) },
    virtualModels: {
      list: jest.fn().mockResolvedValue([ROW]),
      listViews: jest.fn().mockResolvedValue([VIEW]),
      create: jest.fn().mockResolvedValue(VIEW),
      update: jest.fn().mockResolvedValue(VIEW),
      setEnabled: jest.fn().mockResolvedValue(VIEW),
      setResponseMode: jest.fn().mockResolvedValue(VIEW),
      setOverride: jest.fn().mockResolvedValue(VIEW),
      clearOverride: jest.fn().mockResolvedValue(undefined),
      setFallbacks: jest.fn().mockResolvedValue([]),
      clearFallbacks: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as McpToolDeps;
}

function operator(overrides: Partial<McpOperator> = {}): McpOperator {
  return {
    userId: 'user-1',
    tenantId: TENANT,
    scopes: new Set(['mcp:read', 'mcp:write']),
    role: 'admin',
    ...overrides,
  };
}

function register(deps: McpToolDeps, op: McpOperator = operator()) {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  registerVirtualModelTools(server, deps, op);
  return tools;
}

async function call(tools: Map<string, Handler>, name: string, args: Record<string, unknown>) {
  const handler = tools.get(name);
  if (!handler) throw new Error(`no tool ${name}`);
  const res = (await handler(args)) as { content: { text: string }[]; isError?: boolean };
  const text = res.content[0].text;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return { text, data, error: res.isError === true };
}

describe('findVirtualModel', () => {
  it('finds a row by id', async () => {
    const deps = makeDeps();
    await expect(findVirtualModel(deps, 'agent-1', 'demo', 'vm-1')).resolves.toBe(ROW);
    expect(deps.virtualModels.list).toHaveBeenCalledWith('agent-1');
  });

  it('finds a row by name ignoring case', async () => {
    const deps = makeDeps();
    await expect(findVirtualModel(deps, 'agent-1', 'demo', 'FAST/flash')).resolves.toBe(ROW);
  });

  it('prefers an id match over a name match', async () => {
    const deps = makeDeps();
    const byName = { ...ROW, id: 'vm-2', name: 'vm-1' };
    (deps.virtualModels.list as jest.Mock).mockResolvedValue([byName, ROW]);
    await expect(findVirtualModel(deps, 'agent-1', 'demo', 'vm-1')).resolves.toBe(ROW);
  });

  it('lists the existing names when nothing matches', async () => {
    const deps = makeDeps();
    (deps.virtualModels.list as jest.Mock).mockResolvedValue([
      ROW,
      { ...ROW, id: 'vm-2', name: 'b' },
    ]);
    await expect(findVirtualModel(deps, 'agent-1', 'demo', 'ghost')).rejects.toThrow(
      'Virtual model "ghost" not found for "demo" (virtual models: Fast/Flash, b)',
    );
  });

  it('says so when the agent has no virtual models', async () => {
    const deps = makeDeps();
    (deps.virtualModels.list as jest.Mock).mockResolvedValue([]);
    await expect(findVirtualModel(deps, 'agent-1', 'demo', 'ghost')).rejects.toThrow(
      'Virtual model "ghost" not found for "demo" (it has no virtual models)',
    );
  });
});

describe('summarizeVirtualModel', () => {
  it('keeps only the readback fields', () => {
    const summary = summarizeVirtualModel({
      ...ROW,
      fallback_routes: [ROUTE],
    } as never);
    expect(summary).toEqual({
      id: 'vm-1',
      name: 'Fast/Flash',
      enabled: true,
      route: ROUTE,
      fallbacks: [ROUTE],
      continue_on_default: false,
      response_mode: 'buffered',
    });
  });

  it('normalizes missing routes to null and an empty list', () => {
    const summary = summarizeVirtualModel({
      ...ROW,
      override_route: undefined,
      fallback_routes: undefined,
    } as never);
    expect(summary.route).toBeNull();
    expect(summary.fallbacks).toEqual([]);
  });
});

describe('registerVirtualModelTools', () => {
  describe('access control', () => {
    it('gives an admin with a write scope every tool', () => {
      expect([...register(makeDeps()).keys()].sort()).toEqual([
        'thinker_routing_virtual_create',
        'thinker_routing_virtual_delete',
        'thinker_routing_virtual_list',
        'thinker_routing_virtual_update',
      ]);
    });

    it('gives an owner every tool', () => {
      expect(register(makeDeps(), operator({ role: 'owner' })).size).toBe(4);
    });

    it('hides the write tools from a read-only token', () => {
      const tools = register(makeDeps(), operator({ scopes: new Set(['mcp:read']) }));
      expect([...tools.keys()]).toEqual(['thinker_routing_virtual_list']);
    });

    it.each(['viewer', 'member'] as const)('hides the write tools from a %s', (role) => {
      const tools = register(makeDeps(), operator({ role }));
      expect([...tools.keys()]).toEqual(['thinker_routing_virtual_list']);
    });

    it('hides the write tools when the token carries no scope at all', () => {
      const tools = register(makeDeps(), operator({ scopes: new Set() }));
      expect([...tools.keys()]).toEqual(['thinker_routing_virtual_list']);
    });
  });

  describe('tenant scoping', () => {
    it.each([
      ['thinker_routing_virtual_list', { agent: 'demo' }],
      ['thinker_routing_virtual_create', { agent: 'demo', name: 'n' }],
      ['thinker_routing_virtual_update', { agent: 'demo', virtual: 'vm-1', enabled: false }],
      ['thinker_routing_virtual_delete', { agent: 'demo', virtual: 'vm-1' }],
    ])('%s resolves the agent in the operator tenant', async (name, args) => {
      const deps = makeDeps();
      await call(register(deps), name, args);
      expect(deps.resolveAgent.resolve).toHaveBeenCalledWith(TENANT, 'demo');
    });

    it('ignores a tenant id passed as tool input', async () => {
      const deps = makeDeps();
      await call(register(deps), 'thinker_routing_virtual_list', {
        agent: 'demo',
        tenantId: 'other-tenant',
        tenant_id: 'other-tenant',
      });
      expect(deps.resolveAgent.resolve).toHaveBeenCalledWith(TENANT, 'demo');
      expect(deps.virtualModels.listViews).toHaveBeenCalledWith('agent-1', TENANT);
    });

    it('uses the resolved agent tenant for every write', async () => {
      const deps = makeDeps();
      (deps.resolveAgent.resolve as jest.Mock).mockResolvedValue({
        id: 'agent-9',
        tenant_id: 'tenant-9',
      });
      const tools = register(deps);
      await call(tools, 'thinker_routing_virtual_create', { agent: 'demo', name: 'n', model: 'm' });
      expect(deps.virtualModels.create).toHaveBeenCalledWith(
        'agent-9',
        'tenant-9',
        expect.anything(),
      );
    });

    it('an agent outside the tenant fails without touching any virtual model', async () => {
      const deps = makeDeps();
      (deps.resolveAgent.resolve as jest.Mock).mockRejectedValue(new Error('Agent not found'));
      const tools = register(deps);
      for (const [name, args] of [
        ['thinker_routing_virtual_list', { agent: 'foreign' }],
        ['thinker_routing_virtual_create', { agent: 'foreign', name: 'n' }],
        ['thinker_routing_virtual_update', { agent: 'foreign', virtual: 'v', enabled: true }],
        ['thinker_routing_virtual_delete', { agent: 'foreign', virtual: 'v' }],
      ] as const) {
        const res = await call(tools, name, args);
        expect(res.error).toBe(true);
        expect(res.text).toBe('Agent not found');
      }
      const vm = deps.virtualModels as unknown as Record<string, jest.Mock>;
      for (const fn of Object.values(vm)) expect(fn).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the resolved agent (a row id of another agent is not found)', async () => {
      const deps = makeDeps();
      (deps.virtualModels.list as jest.Mock).mockResolvedValue([]);
      const res = await call(register(deps), 'thinker_routing_virtual_delete', {
        agent: 'demo',
        virtual: 'vm-of-another-agent',
      });
      expect(res.error).toBe(true);
      expect(res.text).toContain('not found');
      expect(deps.virtualModels.list).toHaveBeenCalledWith('agent-1');
      expect(deps.virtualModels.delete).not.toHaveBeenCalled();
    });
  });

  describe('thinker_routing_virtual_list', () => {
    it('returns the service views', async () => {
      const res = await call(register(makeDeps()), 'thinker_routing_virtual_list', {
        agent: 'demo',
      });
      expect(res.data).toEqual({ virtual_models: [VIEW] });
    });

    it('returns an error result instead of throwing when the service fails', async () => {
      const deps = makeDeps();
      (deps.virtualModels.listViews as jest.Mock).mockRejectedValue(new Error('db down'));
      const res = await call(register(deps), 'thinker_routing_virtual_list', { agent: 'demo' });
      expect(res).toMatchObject({ error: true, text: 'db down' });
    });

    it('renders a non-Error rejection as text', async () => {
      const deps = makeDeps();
      (deps.virtualModels.listViews as jest.Mock).mockRejectedValue('plain failure');
      const res = await call(register(deps), 'thinker_routing_virtual_list', { agent: 'demo' });
      expect(res).toMatchObject({ error: true, text: 'plain failure' });
    });
  });

  describe('thinker_routing_virtual_create', () => {
    it('sends only the supplied route pins', async () => {
      const deps = makeDeps();
      await call(register(deps), 'thinker_routing_virtual_create', {
        agent: 'demo',
        name: 'n',
        model: 'gpt-4o',
        key_label: 'Work',
      });
      expect(deps.virtualModels.create).toHaveBeenCalledWith('agent-1', TENANT, {
        name: 'n',
        override_route: { model: 'gpt-4o', keyLabel: 'Work' },
        fallback_routes: [],
      });
    });

    it.each([
      [{ auth_type: 'api_key' }],
      [{ key_label: 'Work' }],
      [{ provider: 'openai', auth_type: 'api_key' }],
    ])('rejects route pins %p without a model', async (pins) => {
      const deps = makeDeps();
      const res = await call(register(deps), 'thinker_routing_virtual_create', {
        agent: 'demo',
        name: 'n',
        ...pins,
      });
      expect(res.text).toBe('provider, auth_type and key_label need a model');
      expect(deps.virtualModels.create).not.toHaveBeenCalled();
    });

    it('returns exactly the service view and echoes nothing else from the input', async () => {
      const deps = makeDeps();
      const res = await call(register(deps), 'thinker_routing_virtual_create', {
        agent: 'demo',
        name: 'n',
        key_label: 'SENTINEL-LABEL',
        model: 'm',
      });
      expect(res.data).toEqual({ virtual_model: VIEW });
      expect(res.text).not.toContain('SENTINEL-LABEL');
    });
  });

  describe('thinker_routing_virtual_update', () => {
    it('rejects a new name with a bad format before any write', async () => {
      const deps = makeDeps();
      const res = await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        name: 'has space',
        enabled: false,
      });
      expect(res.error).toBe(true);
      expect(deps.virtualModels.setEnabled).not.toHaveBeenCalled();
      expect(deps.virtualModels.update).not.toHaveBeenCalled();
    });

    it('allows renaming a virtual model to a different case of its own name', async () => {
      const deps = makeDeps();
      const res = await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        name: 'FAST/FLASH',
      });
      expect(res.error).toBe(false);
      expect(deps.virtualModels.update).toHaveBeenCalledWith('agent-1', TENANT, 'vm-1', {
        name: 'FAST/FLASH',
      });
    });

    it('applies only the continue_on_default change when that is all that is passed', async () => {
      const deps = makeDeps();
      await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        continue_on_default: true,
      });
      expect(deps.virtualModels.update).toHaveBeenCalledWith('agent-1', TENANT, 'vm-1', {
        continue_on_default: true,
      });
      expect(deps.virtualModels.setOverride).not.toHaveBeenCalled();
      expect(deps.virtualModels.setEnabled).not.toHaveBeenCalled();
    });

    it('does not clear fallbacks separately when clear_model already dropped them', async () => {
      const deps = makeDeps();
      await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        clear_model: true,
        fallbacks: [],
      });
      expect(deps.virtualModels.clearOverride).toHaveBeenCalledTimes(1);
      expect(deps.virtualModels.clearFallbacks).not.toHaveBeenCalled();
    });

    it('rejects clear_model combined with non-empty fallbacks', async () => {
      const deps = makeDeps();
      const res = await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        clear_model: true,
        fallbacks: ['gpt-4o'],
      });
      expect(res.text).toBe('clear_model cannot be combined with model or fallbacks');
      expect(deps.virtualModels.clearOverride).not.toHaveBeenCalled();
    });

    it('rejects route pins without a model', async () => {
      const deps = makeDeps();
      const res = await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        provider: 'openai',
      });
      expect(res.text).toBe('provider, auth_type and key_label need a model');
    });

    it('rejects fallbacks for a row that has no primary and no new model', async () => {
      const deps = makeDeps();
      (deps.virtualModels.list as jest.Mock).mockResolvedValue([{ ...ROW, override_route: null }]);
      const res = await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        fallbacks: ['gpt-4o'],
      });
      expect(res.text).toBe('fallbacks require a model (the primary route)');
      expect(deps.virtualModels.setFallbacks).not.toHaveBeenCalled();
    });

    it('accepts fallbacks when the same call supplies the primary', async () => {
      const deps = makeDeps();
      (deps.virtualModels.list as jest.Mock).mockResolvedValue([{ ...ROW, override_route: null }]);
      const res = await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        model: 'gpt-4o',
        fallbacks: ['gpt-4o-mini'],
      });
      expect(res.error).toBe(false);
      expect(deps.virtualModels.setOverride).toHaveBeenCalledTimes(1);
      expect(deps.virtualModels.setFallbacks).toHaveBeenCalledTimes(1);
    });

    it('lists every step already applied when a later one fails', async () => {
      const deps = makeDeps();
      (deps.virtualModels.update as jest.Mock).mockRejectedValue(new Error('name taken'));
      const res = await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        model: 'gpt-4o-mini',
        response_mode: 'stream',
        name: 'renamed',
        enabled: false,
      });
      expect(res.text).toBe('name taken (already applied to "Fast/Flash": model, response_mode)');
      expect(deps.virtualModels.setEnabled).not.toHaveBeenCalled();
    });

    it('reads the final state back from the service, null when the row vanished', async () => {
      const deps = makeDeps();
      (deps.virtualModels.listViews as jest.Mock).mockResolvedValue([]);
      const res = await call(register(deps), 'thinker_routing_virtual_update', {
        agent: 'demo',
        virtual: 'vm-1',
        enabled: true,
      });
      expect(res.data).toEqual({ virtual_model: null });
    });
  });

  describe('thinker_routing_virtual_delete', () => {
    it('deletes by name (any case) and reports what was removed', async () => {
      const deps = makeDeps();
      const res = await call(register(deps), 'thinker_routing_virtual_delete', {
        agent: 'demo',
        virtual: 'fast/FLASH',
      });
      expect(res.data).toEqual({ ok: true, deleted: { id: 'vm-1', name: 'Fast/Flash' } });
      expect(deps.virtualModels.delete).toHaveBeenCalledWith('agent-1', 'vm-1');
    });

    it('deletes by id', async () => {
      const deps = makeDeps();
      await call(register(deps), 'thinker_routing_virtual_delete', {
        agent: 'demo',
        virtual: 'vm-1',
      });
      expect(deps.virtualModels.delete).toHaveBeenCalledWith('agent-1', 'vm-1');
    });

    it('reports an unknown virtual model as an error result', async () => {
      const deps = makeDeps();
      const res = await call(register(deps), 'thinker_routing_virtual_delete', {
        agent: 'demo',
        virtual: 'ghost',
      });
      expect(res.error).toBe(true);
      expect(res.text).toContain('Virtual model "ghost" not found');
    });

    it('reports a service failure as an error result', async () => {
      const deps = makeDeps();
      (deps.virtualModels.delete as jest.Mock).mockRejectedValue(new Error('constraint'));
      const res = await call(register(deps), 'thinker_routing_virtual_delete', {
        agent: 'demo',
        virtual: 'vm-1',
      });
      expect(res).toMatchObject({ error: true, text: 'constraint' });
    });
  });
});
