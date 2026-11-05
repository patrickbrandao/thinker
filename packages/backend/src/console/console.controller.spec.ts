import { MIN_ROLE_KEY } from '../common/decorators/roles.decorator';
import type { TenantContext } from '../common/decorators/tenant-context.decorator';
import { ConsoleController } from './console.controller';

const withTenant = (): TenantContext => ({ tenantId: 'org-1', userId: 'u', role: 'viewer' });
const noTenant = (): TenantContext => ({ tenantId: null, userId: 'u', role: null });

function build() {
  const consoleService = {
    search: jest.fn().mockResolvedValue([{ type: 'harness' }]),
    alerts: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const topologyService = {
    build: jest.fn().mockResolvedValue({ range: 'x' }),
    savePositions: jest.fn().mockResolvedValue(undefined),
    resetPositions: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new ConsoleController(consoleService as never, topologyService as never);
  return { controller, consoleService, topologyService };
}

describe('ConsoleController roles', () => {
  it('is readable by viewers, while saving or resetting the canvas needs member', () => {
    const proto = ConsoleController.prototype;
    expect(Reflect.getMetadata(MIN_ROLE_KEY, ConsoleController)).toMatchObject({ role: 'viewer' });
    expect(Reflect.getMetadata(MIN_ROLE_KEY, proto.savePositions)).toMatchObject({
      role: 'member',
    });
    expect(Reflect.getMetadata(MIN_ROLE_KEY, proto.resetPositions)).toMatchObject({
      role: 'member',
    });
  });
});

describe('ConsoleController search and alerts', () => {
  it('searches the active organization only', async () => {
    const { controller, consoleService } = build();
    await expect(controller.search(withTenant(), 'abc')).resolves.toEqual({
      results: [{ type: 'harness' }],
    });
    expect(consoleService.search).toHaveBeenCalledWith('org-1', 'abc');
  });

  it('treats a missing q as empty', async () => {
    const { controller, consoleService } = build();
    await controller.search(withTenant(), undefined);
    expect(consoleService.search).toHaveBeenCalledWith('org-1', '');
  });

  it('answers empty, without querying, for a user with no organization', async () => {
    const { controller, consoleService } = build();
    await expect(controller.search(noTenant(), 'abc')).resolves.toEqual({ results: [] });
    await expect(controller.alerts(noTenant())).resolves.toEqual({ items: [], total: 0 });
    expect(consoleService.search).not.toHaveBeenCalled();
    expect(consoleService.alerts).not.toHaveBeenCalled();
  });

  it('reads alerts of the active organization', async () => {
    const { controller, consoleService } = build();
    await controller.alerts(withTenant());
    expect(consoleService.alerts).toHaveBeenCalledWith('org-1');
  });
});

describe('ConsoleController topology', () => {
  it.each([
    [undefined, '24h'],
    ['bogus', '24h'],
    ['0m', '24h'],
    ['7w', '24h'],
    ['live', 'live'],
    ['15m', '15m'],
    ['24h', '24h'],
    ['7d', '7d'],
  ])('range %p resolves to %p', async (range, expected) => {
    const { controller, topologyService } = build();
    await controller.topology(withTenant(), range);
    expect(topologyService.build).toHaveBeenCalledWith('org-1', expected, undefined);
  });

  it('uses the explicit interval only with a valid pair', async () => {
    const { controller, topologyService } = build();
    await controller.topology(
      withTenant(),
      'interval',
      '2026-11-03T00:00:00Z',
      '2026-11-03T06:00:00Z',
    );
    expect(topologyService.build).toHaveBeenCalledWith('org-1', 'interval', {
      from: new Date('2026-11-03T00:00:00Z'),
      to: new Date('2026-11-03T06:00:00Z'),
    });
    await controller.topology(withTenant(), 'interval', 'soon', undefined);
    expect(topologyService.build).toHaveBeenLastCalledWith('org-1', '24h', undefined);
  });

  it('ignores from/to unless the range is "interval"', async () => {
    const { controller, topologyService } = build();
    await controller.topology(withTenant(), '7d', '2026-11-03T00:00:00Z', '2026-11-03T06:00:00Z');
    expect(topologyService.build).toHaveBeenCalledWith('org-1', '7d', undefined);
  });

  it('returns an empty canvas for a user with no organization', async () => {
    const { controller, topologyService } = build();
    await expect(controller.topology(noTenant(), '7d')).resolves.toEqual({
      range: '7d',
      clients: [],
      harnesses: [],
      providers: [],
      proxies: [],
      servers: [],
      egress: [],
      links: [],
      positions: {},
    });
    expect(topologyService.build).not.toHaveBeenCalled();
  });
});

describe('ConsoleController positions', () => {
  it('saves positions for the active organization', async () => {
    const { controller, topologyService } = build();
    const positions = [{ id: 'internet', x: 1, y: 2 }];
    await controller.savePositions(withTenant(), { positions });
    expect(topologyService.savePositions).toHaveBeenCalledWith('org-1', positions);
  });

  it.each([undefined, {}, { positions: 'nope' }, { positions: null }])(
    'ignores a body without a positions array (%p)',
    async (body) => {
      const { controller, topologyService } = build();
      await controller.savePositions(withTenant(), body as never);
      expect(topologyService.savePositions).not.toHaveBeenCalled();
    },
  );

  it('does nothing without an organization', async () => {
    const { controller, topologyService } = build();
    await controller.savePositions(noTenant(), { positions: [{ id: 'a', x: 1, y: 1 }] });
    await controller.resetPositions(noTenant());
    expect(topologyService.savePositions).not.toHaveBeenCalled();
    expect(topologyService.resetPositions).not.toHaveBeenCalled();
  });

  it('resets the canvas of the active organization', async () => {
    const { controller, topologyService } = build();
    await controller.resetPositions(withTenant());
    expect(topologyService.resetPositions).toHaveBeenCalledWith('org-1');
  });
});
