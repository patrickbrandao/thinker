import { UnauthorizedException } from '@nestjs/common';
import { INSTANCE_ADMIN_KEY, MIN_ROLE_KEY } from '../common/decorators/roles.decorator';
import type { TenantContext } from '../common/decorators/tenant-context.decorator';
import {
  AdminUsersController,
  MeAccountController,
  OrganizationsController,
} from './organizations.controller';

const ctx = (over: Partial<TenantContext> = {}): TenantContext => ({
  tenantId: 'org-1',
  userId: 'user-1',
  role: 'owner',
  isInstanceAdmin: false,
  ...over,
});
const anonymous = ctx({ userId: null });

function orgService() {
  return {
    listForUser: jest.fn().mockResolvedValue([{ id: 'o', name: 'O', role: 'owner' }]),
    create: jest.fn().mockResolvedValue({ id: 'new', name: 'N', role: 'owner' }),
    rename: jest.fn().mockResolvedValue({ id: 'o', name: 'R' }),
    deactivate: jest.fn().mockResolvedValue(undefined),
    getLogRetention: jest.fn().mockResolvedValue({ retention_days: null, default_days: 30 }),
    setLogRetention: jest.fn().mockResolvedValue({ retention_days: 5, default_days: 30 }),
    listMembers: jest.fn().mockResolvedValue([{ userId: 'm' }]),
    addMember: jest.fn().mockResolvedValue({ member: {}, temporaryPassword: null }),
    changeRole: jest.fn().mockResolvedValue({ userId: 'm', role: 'admin' }),
    removeMember: jest.fn().mockResolvedValue(undefined),
    roleOf: jest.fn().mockResolvedValue('member'),
    addExistingMember: jest.fn().mockResolvedValue(undefined),
    assertCanAddMember: jest.fn().mockResolvedValue('member'),
    allMemberships: jest.fn().mockResolvedValue([]),
  };
}

function accountsService() {
  return {
    changeOwnPassword: jest.fn().mockResolvedValue(undefined),
    setActiveOrganization: jest.fn().mockResolvedValue(undefined),
    listAccounts: jest.fn().mockResolvedValue([]),
    createAccount: jest.fn().mockResolvedValue({
      account: { id: 'acc-1' },
      temporaryPassword: 'tmp',
    }),
    resetPassword: jest.fn().mockResolvedValue('tmp2'),
    setInstanceAdmin: jest.fn().mockResolvedValue({ id: 'acc-1', isInstanceAdmin: true }),
  };
}

describe('OrganizationsController', () => {
  it('is readable by any authenticated user; creating is instance-admin only', () => {
    const proto = OrganizationsController.prototype;
    expect(Reflect.getMetadata(MIN_ROLE_KEY, OrganizationsController)).toMatchObject({
      role: 'viewer',
    });
    expect(Reflect.getMetadata(INSTANCE_ADMIN_KEY, proto.create)).toBe(true);
    expect(Reflect.getMetadata(INSTANCE_ADMIN_KEY, proto.list)).toBeUndefined();
  });

  it('passes the caller and the instance-admin flag to the listing', async () => {
    const orgs = orgService();
    const controller = new OrganizationsController(orgs as never);
    await expect(controller.list(ctx({ isInstanceAdmin: true }))).resolves.toEqual({
      organizations: [{ id: 'o', name: 'O', role: 'owner' }],
    });
    expect(orgs.listForUser).toHaveBeenCalledWith('user-1', true);
    await controller.list(ctx());
    expect(orgs.listForUser).toHaveBeenLastCalledWith('user-1', false);
  });

  it('fails closed with 401 on every route when there is no user (env API key)', async () => {
    const controller = new OrganizationsController(orgService() as never);
    const calls: Array<() => unknown> = [
      () => controller.list(anonymous),
      () => controller.create(anonymous, { name: 'x' }),
      () => controller.rename(anonymous, 'o', { name: 'x' }),
      () => controller.remove(anonymous, 'o'),
      () => controller.logRetention(anonymous, 'o'),
      () => controller.setLogRetention(anonymous, 'o', {}),
      () => controller.members(anonymous, 'o'),
      () => controller.addMember(anonymous, 'o', { email: 'a@b', role: 'viewer' }),
      () => controller.changeRole(anonymous, 'o', 'm', { role: 'viewer' }),
      () => controller.removeMember(anonymous, 'o', 'm'),
    ];
    for (const call of calls) {
      // Some handlers are async and some throw synchronously: cover both.
      await expect((async () => call())()).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('always acts on the :id in the path, never on the active organization of the context', async () => {
    const orgs = orgService();
    const controller = new OrganizationsController(orgs as never);
    const c = ctx({ tenantId: 'active-org' });
    await controller.rename(c, 'path-org', { name: 'N' });
    await controller.remove(c, 'path-org');
    await controller.members(c, 'path-org');
    await controller.changeRole(c, 'path-org', 'm1', { role: 'admin' });
    await controller.removeMember(c, 'path-org', 'm1');
    expect(orgs.rename).toHaveBeenCalledWith('user-1', 'path-org', 'N');
    expect(orgs.deactivate).toHaveBeenCalledWith('user-1', 'path-org');
    expect(orgs.listMembers).toHaveBeenCalledWith('user-1', 'path-org');
    expect(orgs.changeRole).toHaveBeenCalledWith('user-1', 'path-org', 'm1', 'admin');
    expect(orgs.removeMember).toHaveBeenCalledWith('user-1', 'path-org', 'm1');
  });

  it('wraps results the way the dashboard expects', async () => {
    const controller = new OrganizationsController(orgService() as never);
    await expect(controller.remove(ctx(), 'o')).resolves.toEqual({ ok: true });
    await expect(controller.removeMember(ctx(), 'o', 'm')).resolves.toEqual({ ok: true });
    await expect(controller.members(ctx(), 'o')).resolves.toEqual({ members: [{ userId: 'm' }] });
    await expect(controller.changeRole(ctx(), 'o', 'm', { role: 'admin' })).resolves.toEqual({
      member: { userId: 'm', role: 'admin' },
    });
  });

  it('tolerates a missing body so the service answers with a 400, not a crash', async () => {
    const orgs = orgService();
    const controller = new OrganizationsController(orgs as never);
    await controller.create(ctx(), undefined as never);
    expect(orgs.create).toHaveBeenCalledWith(undefined, 'user-1');
    await controller.setLogRetention(ctx(), 'o', undefined as never);
    expect(orgs.setLogRetention).toHaveBeenCalledWith('user-1', 'o', null);
    await controller.addMember(ctx(), 'o', undefined as never);
    expect(orgs.addMember).toHaveBeenCalledWith('user-1', 'o', {});
  });

  it('maps an absent retention_days to null (follow the instance default)', async () => {
    const orgs = orgService();
    const controller = new OrganizationsController(orgs as never);
    await controller.setLogRetention(ctx(), 'o', {});
    expect(orgs.setLogRetention).toHaveBeenCalledWith('user-1', 'o', null);
    await controller.setLogRetention(ctx(), 'o', { retention_days: 9 });
    expect(orgs.setLogRetention).toHaveBeenLastCalledWith('user-1', 'o', 9);
  });
});

describe('MeAccountController', () => {
  const request = (headers: Record<string, string | string[] | undefined>) =>
    ({ headers }) as never;

  it('converts Node headers to a Fetch Headers (arrays appended, undefined skipped)', async () => {
    const accounts = accountsService();
    const controller = new MeAccountController(accounts as never, orgService() as never);
    await controller.changePassword(
      ctx(),
      request({ cookie: 'session=abc', 'x-multi': ['a', 'b'], skipped: undefined }),
      { currentPassword: 'old', newPassword: 'new-password' },
    );
    const headers = accounts.changeOwnPassword.mock.calls[0][1] as Headers;
    expect(headers.get('cookie')).toBe('session=abc');
    expect(headers.get('x-multi')).toBe('a, b');
    expect(headers.has('skipped')).toBe(false);
  });

  it('passes the authenticated user, not anything from the body', async () => {
    const accounts = accountsService();
    const controller = new MeAccountController(accounts as never, orgService() as never);
    const body = { currentPassword: 'old', newPassword: 'new-password', userId: 'victim' };
    await expect(controller.changePassword(ctx(), request({}), body)).resolves.toEqual({
      ok: true,
    });
    expect(accounts.changeOwnPassword).toHaveBeenCalledWith(
      'user-1',
      expect.any(Headers),
      'old',
      'new-password',
    );
  });

  it('turns a missing body into empty strings so the service rejects it with 400', async () => {
    const accounts = accountsService();
    const controller = new MeAccountController(accounts as never, orgService() as never);
    await controller.changePassword(ctx(), request({}), undefined as never);
    expect(accounts.changeOwnPassword).toHaveBeenCalledWith('user-1', expect.any(Headers), '', '');
  });

  it('refuses a password change without a user (401)', async () => {
    const accounts = accountsService();
    const controller = new MeAccountController(accounts as never, orgService() as never);
    await expect(
      controller.changePassword(anonymous, request({}), { currentPassword: 'a', newPassword: 'b' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accounts.changeOwnPassword).not.toHaveBeenCalled();
  });

  it('checks membership before saving the active organization', async () => {
    const accounts = accountsService();
    const orgs = orgService();
    const controller = new MeAccountController(accounts as never, orgs as never);
    await expect(controller.setActive(ctx(), { organizationId: 'org-2' })).resolves.toEqual({
      ok: true,
    });
    expect(orgs.roleOf).toHaveBeenCalledWith('user-1', 'org-2');
    expect(accounts.setActiveOrganization).toHaveBeenCalledWith('user-1', 'org-2');
  });

  it('does not save an organization the user cannot enter', async () => {
    const accounts = accountsService();
    const orgs = orgService();
    orgs.roleOf.mockRejectedValue(new Error('not_a_member'));
    const controller = new MeAccountController(accounts as never, orgs as never);
    await expect(controller.setActive(ctx(), { organizationId: 'foreign' })).rejects.toThrow(
      'not_a_member',
    );
    expect(accounts.setActiveOrganization).not.toHaveBeenCalled();
  });

  it('refuses switching without a user (401)', async () => {
    const controller = new MeAccountController(accountsService() as never, orgService() as never);
    await expect(controller.setActive(anonymous, { organizationId: 'o' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('AdminUsersController', () => {
  it('is instance-admin only at the class level', () => {
    expect(Reflect.getMetadata(INSTANCE_ADMIN_KEY, AdminUsersController)).toBe(true);
  });

  it('joins each account with only its own memberships and drops the internal userId', async () => {
    const accounts = accountsService();
    const orgs = orgService();
    accounts.listAccounts.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]);
    orgs.allMemberships.mockResolvedValue([
      { userId: 'u1', id: 'a', name: 'A', role: 'owner' },
      { userId: 'u2', id: 'a', name: 'A', role: 'viewer' },
      { userId: 'u1', id: 'b', name: 'B', role: 'member' },
    ]);
    const controller = new AdminUsersController(accounts as never, orgs as never);
    const { users } = await controller.list();
    expect(users[0].organizations).toEqual([
      { id: 'a', name: 'A', role: 'owner' },
      { id: 'b', name: 'B', role: 'member' },
    ]);
    expect(users[1].organizations).toEqual([{ id: 'a', name: 'A', role: 'viewer' }]);
    expect(users[2].organizations).toEqual([]);
  });

  it('creates an account and returns the temporary password once', async () => {
    const accounts = accountsService();
    const orgs = orgService();
    const controller = new AdminUsersController(accounts as never, orgs as never);
    await expect(
      controller.create(ctx(), { email: 'a@b.test', name: 'A', isInstanceAdmin: true }),
    ).resolves.toEqual({ user: { id: 'acc-1' }, temporaryPassword: 'tmp' });
    expect(accounts.createAccount).toHaveBeenCalledWith('a@b.test', 'A', true);
    expect(orgs.addExistingMember).not.toHaveBeenCalled();
  });

  it('only an explicit true makes the account an instance admin', async () => {
    const accounts = accountsService();
    const controller = new AdminUsersController(accounts as never, orgService() as never);
    await controller.create(ctx(), {
      email: 'a@b.test',
      name: 'A',
      isInstanceAdmin: 'yes' as never,
    });
    expect(accounts.createAccount).toHaveBeenCalledWith('a@b.test', 'A', false);
    await controller.update('acc-1', { isInstanceAdmin: 1 as never });
    expect(accounts.setInstanceAdmin).toHaveBeenCalledWith('acc-1', false);
  });

  it('adds the new account to the requested organization, defaulting to member', async () => {
    const accounts = accountsService();
    const orgs = orgService();
    const controller = new AdminUsersController(accounts as never, orgs as never);
    await controller.create(ctx(), { email: 'a@b.test', name: 'A', organizationId: 'org-9' });
    expect(orgs.addExistingMember).toHaveBeenCalledWith('user-1', 'org-9', 'acc-1', 'member');
    await controller.create(ctx(), {
      email: 'b@b.test',
      name: 'B',
      organizationId: 'org-9',
      role: 'admin',
    });
    expect(orgs.addExistingMember).toHaveBeenLastCalledWith('user-1', 'org-9', 'acc-1', 'admin');
  });

  it('wraps reset and update results', async () => {
    const controller = new AdminUsersController(accountsService() as never, orgService() as never);
    await expect(controller.resetPassword('acc-1')).resolves.toEqual({ temporaryPassword: 'tmp2' });
    await expect(controller.update('acc-1', { isInstanceAdmin: true })).resolves.toEqual({
      user: { id: 'acc-1', isInstanceAdmin: true },
    });
  });

  // The membership is validated before the account (and its one-time
  // temporary password) exists, so a refusal never leaves an orphan account.
  it('does not create the account when the requested membership would be refused', async () => {
    const accounts = accountsService();
    const orgs = orgService();
    orgs.assertCanAddMember.mockRejectedValue(new Error('refused'));
    const controller = new AdminUsersController(accounts as never, orgs as never);
    await expect(
      controller.create(ctx(), { email: 'a@b.test', name: 'A', organizationId: 'o', role: 'god' }),
    ).rejects.toThrow('refused');
    expect(accounts.createAccount).not.toHaveBeenCalled();
  });
});
