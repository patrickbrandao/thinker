import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProxyServersController } from './proxy-servers.controller';
import { MIN_ROLE_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import type { TenantContext } from '../common/decorators/tenant-context.decorator';

/**
 * The controller is a thin shell over ProxyServersService: it must pass the
 * tenant of the request (never one from the body), create the personal
 * organization lazily on the first mutation, and stay admin-only.
 */
function build() {
  const proxies = {
    list: jest.fn().mockResolvedValue('list'),
    get: jest.fn().mockResolvedValue('get'),
    create: jest.fn().mockResolvedValue('create'),
    update: jest.fn().mockResolvedValue('update'),
    remove: jest.fn().mockResolvedValue('remove'),
    test: jest.fn().mockResolvedValue('test'),
    logs: jest.fn().mockResolvedValue('logs'),
    stats: jest.fn().mockResolvedValue('stats'),
    listProfiles: jest.fn().mockResolvedValue('listProfiles'),
    createProfile: jest.fn().mockResolvedValue('createProfile'),
    updateProfile: jest.fn().mockResolvedValue('updateProfile'),
    removeProfile: jest.fn().mockResolvedValue('removeProfile'),
    listAssignments: jest.fn().mockResolvedValue('listAssignments'),
    getAssignment: jest.fn().mockResolvedValue('getAssignment'),
    setAssignment: jest.fn().mockResolvedValue('setAssignment'),
  };
  const tenantCache = { ensureForUser: jest.fn().mockResolvedValue('personal-org') };
  const controller = new ProxyServersController(proxies as never, tenantCache as never);
  return { controller, proxies, tenantCache };
}

const ctx: TenantContext = { tenantId: 't1', userId: 'u1', role: 'admin' };
const noOrg: TenantContext = { tenantId: null, userId: 'u9', role: null };

describe('ProxyServersController delegation', () => {
  it('scopes every read to the tenant of the request context', async () => {
    const { controller, proxies } = build();
    await controller.list(ctx);
    await controller.get(ctx, 'p1');
    await controller.logs(ctx, 'p1', { result: 'failure', limit: '10' });
    await controller.stats(ctx, 'p1', '7');
    await controller.listProfiles(ctx);
    await controller.listAssignments(ctx, 'connection');
    await controller.getAssignment(ctx, 'connection', 'c1');
    expect(proxies.list).toHaveBeenCalledWith('t1');
    expect(proxies.get).toHaveBeenCalledWith('t1', 'p1');
    expect(proxies.logs).toHaveBeenCalledWith('t1', 'p1', { result: 'failure', limit: '10' });
    expect(proxies.stats).toHaveBeenCalledWith('t1', 'p1', '7');
    expect(proxies.listProfiles).toHaveBeenCalledWith('t1');
    expect(proxies.listAssignments).toHaveBeenCalledWith('t1', 'connection');
    expect(proxies.getAssignment).toHaveBeenCalledWith('t1', 'connection', 'c1');
  });

  it('scopes every mutation to the tenant of the request context', async () => {
    const { controller, proxies } = build();
    await controller.update(ctx, 'p1', { name: 'x' });
    await controller.remove(ctx, 'p1', 'replace', 'p2');
    await controller.test(ctx, 'p1', { url: 'http://x' });
    await controller.updateProfile(ctx, 'pr1', { name: 'n' });
    await controller.removeProfile(ctx, 'pr1', 'remove');
    await controller.setAssignment(ctx, 'trigger', 'tr1', { mode: 'direct' });
    expect(proxies.update).toHaveBeenCalledWith('t1', 'p1', { name: 'x' });
    expect(proxies.remove).toHaveBeenCalledWith('t1', 'p1', 'replace', 'p2');
    expect(proxies.test).toHaveBeenCalledWith('t1', 'p1', { url: 'http://x' });
    expect(proxies.updateProfile).toHaveBeenCalledWith('t1', 'pr1', { name: 'n' });
    expect(proxies.removeProfile).toHaveBeenCalledWith('t1', 'pr1', 'remove');
    expect(proxies.setAssignment).toHaveBeenCalledWith('t1', 'trigger', 'tr1', {
      mode: 'direct',
    });
  });

  it('passes a null tenant through to reads, which answer empty or 404', async () => {
    const { controller, proxies } = build();
    await controller.list(noOrg);
    await controller.stats(noOrg, 'p1');
    expect(proxies.list).toHaveBeenCalledWith(null);
    expect(proxies.stats).toHaveBeenCalledWith(null, 'p1', undefined);
  });

  it('creates with the context tenant and records the creating user', async () => {
    const { controller, proxies, tenantCache } = build();
    await controller.create(ctx, { name: 'A' });
    await controller.createProfile(ctx, { name: 'P', chain: ['p1'] });
    expect(proxies.create).toHaveBeenCalledWith('t1', 'u1', { name: 'A' });
    expect(proxies.createProfile).toHaveBeenCalledWith('t1', { name: 'P', chain: ['p1'] });
    expect(tenantCache.ensureForUser).not.toHaveBeenCalled();
  });

  it('creates the personal organization on the first mutation of a user without one', async () => {
    const { controller, proxies, tenantCache } = build();
    await controller.create(noOrg, { name: 'A' });
    await controller.createProfile(noOrg, { name: 'P', chain: [] });
    expect(tenantCache.ensureForUser).toHaveBeenCalledTimes(2);
    expect(tenantCache.ensureForUser).toHaveBeenCalledWith('u9');
    expect(proxies.create).toHaveBeenCalledWith('personal-org', 'u9', { name: 'A' });
    expect(proxies.createProfile).toHaveBeenCalledWith('personal-org', { name: 'P', chain: [] });
  });

  it('treats a missing body as an empty one, so the service answers 400', async () => {
    const { controller, proxies } = build();
    await controller.create(ctx, undefined as never);
    await controller.update(ctx, 'p1', undefined as never);
    await controller.createProfile(ctx, undefined as never);
    await controller.updateProfile(ctx, 'pr1', undefined as never);
    expect(proxies.create).toHaveBeenCalledWith('t1', 'u1', {});
    expect(proxies.update).toHaveBeenCalledWith('t1', 'p1', {});
    expect(proxies.createProfile).toHaveBeenCalledWith('t1', {});
    expect(proxies.updateProfile).toHaveBeenCalledWith('t1', 'pr1', {});
  });

  it('forwards the delete query (mode, replace_with) untouched', async () => {
    const { controller, proxies } = build();
    await controller.remove(ctx, 'p1');
    await controller.remove(ctx, 'p1', 'remove');
    await controller.removeProfile(ctx, 'pr1');
    expect(proxies.remove).toHaveBeenNthCalledWith(1, 't1', 'p1', undefined, undefined);
    expect(proxies.remove).toHaveBeenNthCalledWith(2, 't1', 'p1', 'remove', undefined);
    expect(proxies.removeProfile).toHaveBeenCalledWith('t1', 'pr1', undefined);
  });

  it('returns what the service returns', async () => {
    const { controller } = build();
    await expect(controller.get(ctx, 'p1')).resolves.toBe('get');
    await expect(controller.setAssignment(ctx, 'provider', 'x', {})).resolves.toBe('setAssignment');
  });
});

describe('ProxyServersController role gate', () => {
  const reflector = new Reflector();
  const meta = reflector.get(MIN_ROLE_KEY, ProxyServersController);

  it('requires the admin role, reads included', () => {
    expect(meta).toEqual({ role: 'admin', includeReads: true });
  });

  function guard(method: string, role: TenantContext['role']) {
    const request = { method, tenantContext: { tenantId: 't1', userId: 'u', role } };
    const context = {
      getHandler: () => ProxyServersController.prototype.list,
      getClass: () => ProxyServersController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
    return () => new RolesGuard(reflector).canActivate(context);
  }

  it.each(['viewer', 'member'] as const)('RolesGuard refuses a %s on reads and writes', (role) => {
    expect(guard('GET', role)).toThrow(ForbiddenException);
    expect(guard('POST', role)).toThrow(ForbiddenException);
    expect(guard('DELETE', role)).toThrow(ForbiddenException);
  });

  it.each(['admin', 'owner'] as const)('RolesGuard admits an %s', (role) => {
    expect(guard('GET', role)()).toBe(true);
    expect(guard('PUT', role)()).toBe(true);
  });
});
