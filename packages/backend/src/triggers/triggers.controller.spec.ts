import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import type { TenantContext } from '../common/decorators/tenant-context.decorator';
import { PRIVATE_URLS_ENV } from '../common/utils/private-url-policy';
import type { OrganizationRole } from '../entities/organization-member.entity';
import { TriggersController } from './triggers.controller';
import type { TriggersService } from './triggers.service';

const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  tenantId: 'tenant-1',
  userId: 'user-1',
  role: 'owner',
  isInstanceAdmin: false,
  ...over,
});

function setup() {
  const service = {
    list: jest.fn().mockResolvedValue({ triggers: [] }),
    listEvents: jest.fn().mockResolvedValue({ events: [] }),
    getEvent: jest.fn().mockResolvedValue({ event: {}, logs: [] }),
    retryEvent: jest.fn().mockResolvedValue({ ok: true }),
    create: jest.fn().mockResolvedValue({ id: 't1' }),
    update: jest.fn().mockResolvedValue({ id: 't1' }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
    test: jest.fn().mockResolvedValue({ success: true }),
    getBindings: jest.fn().mockResolvedValue({ bindings: [] }),
    setBindings: jest.fn().mockResolvedValue({ bindings: [] }),
  };
  const controller = new TriggersController(service as unknown as TriggersService);
  return { controller, service };
}

describe('TriggersController', () => {
  const savedPolicy = process.env[PRIVATE_URLS_ENV];
  afterEach(() => {
    if (savedPolicy === undefined) delete process.env[PRIVATE_URLS_ENV];
    else process.env[PRIVATE_URLS_ENV] = savedPolicy;
  });

  describe('delegation and tenant scoping', () => {
    it('lists the triggers of the caller tenant', async () => {
      const { controller, service } = setup();
      await expect(controller.list(ctx())).resolves.toEqual({ triggers: [] });
      expect(service.list).toHaveBeenCalledWith('tenant-1');
    });

    it('passes a null tenant through so the service returns empty data', async () => {
      const { controller, service } = setup();
      await controller.list(ctx({ tenantId: null }));
      expect(service.list).toHaveBeenCalledWith(null);
    });

    it('lists events of the caller tenant with the raw query filters', async () => {
      const { controller, service } = setup();
      const query = { trigger_id: 't1', status: 'failed', limit: '10' };
      await controller.listEvents(ctx(), query);
      expect(service.listEvents).toHaveBeenCalledWith('tenant-1', query);
    });

    it('reads, retries, updates, removes and tests inside the caller tenant', async () => {
      const { controller, service } = setup();
      await controller.getEvent(ctx(), 'e1');
      await controller.retryEvent(ctx(), 'e1');
      await controller.update(ctx(), 't1', { name: 'x' });
      await controller.remove(ctx(), 't1');
      await controller.test(ctx(), 't1', { event_type: 'limit.alert' });
      expect(service.getEvent).toHaveBeenCalledWith('tenant-1', 'e1');
      expect(service.retryEvent).toHaveBeenCalledWith('tenant-1', 'e1');
      expect(service.update).toHaveBeenCalledWith('tenant-1', 't1', { name: 'x' }, true);
      expect(service.remove).toHaveBeenCalledWith('tenant-1', 't1');
      expect(service.test).toHaveBeenCalledWith('tenant-1', 't1', 'user-1', {
        event_type: 'limit.alert',
      });
    });

    it('treats a missing body as an empty object', async () => {
      const { controller, service } = setup();
      await controller.create(ctx(), undefined as never);
      await controller.update(ctx(), 't1', undefined as never);
      await controller.test(ctx(), 't1', undefined);
      expect(service.create).toHaveBeenCalledWith(expect.anything(), {}, true);
      expect(service.update).toHaveBeenCalledWith('tenant-1', 't1', {}, true);
      expect(service.test).toHaveBeenCalledWith('tenant-1', 't1', 'user-1', {});
    });

    it('hands the whole tenant context to create (it may need to provision the tenant)', async () => {
      const { controller, service } = setup();
      const context = ctx({ tenantId: null });
      await controller.create(context, { name: 'x' });
      expect(service.create).toHaveBeenCalledWith(context, { name: 'x' }, true);
    });

    it('reads and writes harness bindings by name inside the caller tenant', async () => {
      const { controller, service } = setup();
      await controller.getBindings(ctx(), 'bot');
      await controller.setBindings(ctx(), 'bot', { bindings: [] });
      expect(service.getBindings).toHaveBeenCalledWith('tenant-1', 'bot');
      expect(service.setBindings).toHaveBeenCalledWith('tenant-1', 'bot', { bindings: [] });
    });

    it('lets service errors reach the caller unchanged', async () => {
      const { controller, service } = setup();
      service.getEvent.mockRejectedValue(new Error('Event not found'));
      await expect(controller.getEvent(ctx(), 'nope')).rejects.toThrow('Event not found');
    });
  });

  describe('private webhook destinations', () => {
    beforeEach(() => delete process.env[PRIVATE_URLS_ENV]);

    it.each([
      ['owner', false, true],
      ['admin', false, false],
      ['admin', true, true],
    ] as const)(
      'create as %s (instance admin: %s) allows private: %s',
      async (role, isInstanceAdmin, allowed) => {
        const { controller, service } = setup();
        await controller.create(ctx({ role, isInstanceAdmin }), { name: 'x' });
        expect(service.create.mock.calls[0][2]).toBe(allowed);
      },
    );

    it('update follows the same policy', async () => {
      const { controller, service } = setup();
      await controller.update(ctx({ role: 'admin' }), 't1', {});
      expect(service.update.mock.calls[0][3]).toBe(false);
    });

    it('honours the instance policy', async () => {
      const { controller, service } = setup();
      process.env[PRIVATE_URLS_ENV] = 'deny';
      await controller.create(ctx({ role: 'owner' }), {});
      expect(service.create.mock.calls[0][2]).toBe(false);
      process.env[PRIVATE_URLS_ENV] = 'allow';
      await controller.create(ctx({ role: 'admin' }), {});
      expect(service.create.mock.calls[1][2]).toBe(true);
    });
  });

  describe('role requirements (through the real RolesGuard)', () => {
    const guard = new RolesGuard(new Reflector());
    const proto = TriggersController.prototype;

    function allowed(
      handler: keyof TriggersController,
      method: string,
      role: OrganizationRole | null,
    ) {
      const request = { method, tenantContext: ctx({ role, tenantId: 'tenant-1' }) };
      const context = {
        getHandler: () => proto[handler],
        getClass: () => TriggersController,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      try {
        return guard.canActivate(context);
      } catch {
        return false;
      }
    }

    // [handler, http method, minimum role]
    const routes: Array<[keyof TriggersController, string, OrganizationRole]> = [
      ['list', 'GET', 'viewer'],
      ['getBindings', 'GET', 'viewer'],
      ['setBindings', 'PUT', 'member'],
      ['listEvents', 'GET', 'admin'],
      ['getEvent', 'GET', 'admin'],
      ['retryEvent', 'POST', 'admin'],
      ['create', 'POST', 'admin'],
      ['update', 'PATCH', 'admin'],
      ['remove', 'DELETE', 'admin'],
      ['test', 'POST', 'admin'],
    ];
    const order: OrganizationRole[] = ['viewer', 'member', 'admin', 'owner'];

    it.each(routes)('%s (%s) needs at least %s', (handler, method, min) => {
      for (const role of order) {
        expect(allowed(handler, method, role)).toBe(order.indexOf(role) >= order.indexOf(min));
      }
    });

    it('keeps delivery logs (server responses) away from members and viewers', () => {
      expect(allowed('listEvents', 'GET', 'member')).toBe(false);
      expect(allowed('getEvent', 'GET', 'viewer')).toBe(false);
    });
  });
});
