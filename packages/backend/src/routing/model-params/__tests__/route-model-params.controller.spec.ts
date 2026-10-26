import { RouteModelParamsController } from '../route-model-params.controller';

describe('RouteModelParamsController', () => {
  const ctx = { tenantId: 'tenant-1', userId: 'user-1' };
  const view = { tier: 'default', route: {}, models: [], params: [] };
  const routeParams = {
    get: jest.fn().mockResolvedValue(view),
    update: jest.fn().mockResolvedValue(view),
  };
  const resolveAgent = {
    resolve: jest.fn().mockResolvedValue({ id: 'agent-1', tenant_id: 'tenant-1' }),
  };
  const controller = new RouteModelParamsController(routeParams as never, resolveAgent as never);

  it('reads the params of a tier route for the resolved agent', async () => {
    await expect(
      controller.get(ctx, { agentName: 'demo', tier: 'deep' }, { model: 'gpt-5' }),
    ).resolves.toBe(view);
    expect(resolveAgent.resolve).toHaveBeenCalledWith('tenant-1', 'demo');
    expect(routeParams.get).toHaveBeenCalledWith('agent-1', 'deep', 'gpt-5', 'tenant-1');
  });

  it('applies a set/unset change to a tier route', async () => {
    await expect(
      controller.update(
        ctx,
        { agentName: 'demo', tier: 'default' },
        {},
        { set: { 'reasoning.effort': 'high' }, unset: ['temperature'] },
      ),
    ).resolves.toBe(view);
    expect(routeParams.update).toHaveBeenCalledWith(
      'agent-1',
      'default',
      undefined,
      { set: { 'reasoning.effort': 'high' }, unset: ['temperature'] },
      'tenant-1',
    );
  });

  it('addresses a virtual model by name through its own selector', async () => {
    await expect(
      controller.getVirtual(ctx, { agentName: 'demo' }, { virtual: 'deepseek/flash' }),
    ).resolves.toBe(view);
    expect(routeParams.get).toHaveBeenCalledWith(
      'agent-1',
      { virtual: 'deepseek/flash' },
      undefined,
      'tenant-1',
    );

    await expect(
      controller.updateVirtual(
        ctx,
        { agentName: 'demo' },
        { virtual: 'deepseek/flash', model: 'gpt-5' },
        { set: { temperature: 0.2 } },
      ),
    ).resolves.toBe(view);
    expect(routeParams.update).toHaveBeenCalledWith(
      'agent-1',
      { virtual: 'deepseek/flash' },
      'gpt-5',
      { set: { temperature: 0.2 }, unset: undefined },
      'tenant-1',
    );
  });
});
