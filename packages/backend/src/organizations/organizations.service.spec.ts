import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MAX_LOG_RETENTION_DAYS } from '../config/recording-retention';
import type { OrganizationRole } from '../entities/organization-member.entity';
import { OrganizationsService, assertRole, organizationName } from './organizations.service';

const ORG = 'org-1';
const CALLER = 'caller';

function build(opts: { roles?: Record<string, OrganizationRole | null>; retention?: number } = {}) {
  const ds = { query: jest.fn() };
  const tenantRepo = {
    findOne: jest.fn().mockResolvedValue({ id: ORG, is_active: true, log_retention_days: null }),
    insert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const memberRepo = {
    exists: jest.fn().mockResolvedValue(false),
    count: jest.fn().mockResolvedValue(2),
    delete: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
  };
  const tenantCache = {
    // Missing key = not a member (403), null = member without a role.
    resolveAccess: jest.fn(async (userId: string) => {
      const roles = opts.roles ?? {};
      if (!(userId in roles)) {
        throw new ForbiddenException({ message: 'not a member', code: 'not_a_member' });
      }
      return { tenantId: ORG, role: roles[userId] };
    }),
    addMember: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn(),
  };
  const accounts = { findByEmail: jest.fn(), createAccount: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(opts.retention) };
  const service = new OrganizationsService(
    ds as never,
    tenantRepo as never,
    memberRepo as never,
    tenantCache as never,
    accounts as never,
    config as never,
  );
  return { service, ds, tenantRepo, memberRepo, tenantCache, accounts, config };
}

const memberRow = (userId: string, role: OrganizationRole) => ({
  userId,
  email: `${userId}@x.test`,
  name: userId,
  role,
  mustChangePassword: false,
});

describe('organizationName', () => {
  it('prefers the trimmed label and falls back to the internal name', () => {
    expect(organizationName({ name: 'uuid', organization_name: '  Acme ' })).toBe('Acme');
    expect(organizationName({ name: 'uuid', organization_name: '   ' })).toBe('uuid');
    expect(organizationName({ name: 'uuid', organization_name: null })).toBe('uuid');
  });
});

describe('assertRole', () => {
  it.each(['viewer', 'member', 'admin', 'owner'])('accepts %s', (role) => {
    expect(assertRole(role)).toBe(role);
  });
  it.each([undefined, null, '', 'root', 'OWNER', 3, {}])('rejects %p with 400', (role) => {
    expect(() => assertRole(role)).toThrow(BadRequestException);
  });
});

describe('OrganizationsService.listForUser', () => {
  it('passes the admin flag so only the instance admin sees every active organization', async () => {
    const { service, ds } = build();
    ds.query.mockResolvedValue([
      { id: 'a', name: 'a', organization_name: 'Zeta', role: 'member' },
      { id: 'b', name: 'b', organization_name: null, role: null },
    ]);
    const asAdmin = await service.listForUser('u1', true);
    expect(ds.query.mock.calls[0][1]).toEqual(['u1', true]);
    expect(ds.query.mock.calls[0][0]).toContain('t.is_active');
    // Non-member organizations read as owner for the instance admin.
    expect(asAdmin).toEqual([
      { id: 'a', name: 'Zeta', role: 'member' },
      { id: 'b', name: 'b', role: 'owner' },
    ]);
    await service.listForUser('u1', false);
    expect(ds.query.mock.calls[1][1]).toEqual(['u1', false]);
  });
});

describe('OrganizationsService.get / roleOf', () => {
  it('is 404 for an unknown or inactive organization', async () => {
    const { service, tenantRepo } = build();
    tenantRepo.findOne.mockResolvedValue(null);
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(tenantRepo.findOne).toHaveBeenCalledWith({ where: { id: 'nope', is_active: true } });
  });

  it('checks existence before membership', async () => {
    const { service, tenantRepo, tenantCache } = build();
    tenantRepo.findOne.mockResolvedValue(null);
    await expect(service.roleOf(CALLER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(tenantCache.resolveAccess).not.toHaveBeenCalled();
  });

  it('rejects a user who is not a member (403)', async () => {
    const { service } = build({ roles: {} });
    await expect(service.roleOf(CALLER, ORG)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('treats a member row without a role as viewer', async () => {
    const { service } = build({ roles: { [CALLER]: null } });
    await expect(service.roleOf(CALLER, ORG)).resolves.toBe('viewer');
  });
});

describe('OrganizationsService.require', () => {
  it.each<[OrganizationRole, OrganizationRole, boolean]>([
    ['viewer', 'viewer', true],
    ['viewer', 'member', false],
    ['member', 'admin', false],
    ['admin', 'admin', true],
    ['admin', 'owner', false],
    ['owner', 'owner', true],
    ['owner', 'viewer', true],
  ])('caller %s needing %s -> allowed=%s', async (have, need, allowed) => {
    const { service } = build({ roles: { [CALLER]: have } });
    const call = service.require(CALLER, ORG, need);
    if (allowed) await expect(call).resolves.toBe(have);
    else {
      await expect(call).rejects.toMatchObject({
        response: { code: 'insufficient_role' },
      });
    }
  });
});

describe('OrganizationsService.create', () => {
  it('requires a non-blank name', async () => {
    const { service, tenantRepo } = build();
    await expect(service.create('   ', CALLER)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(undefined as never, CALLER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tenantRepo.insert).not.toHaveBeenCalled();
  });

  it('creates an active organization and makes the creator its owner', async () => {
    const { service, tenantRepo, tenantCache } = build();
    const view = await service.create('  Acme  ', CALLER);
    expect(view).toMatchObject({ name: 'Acme', role: 'owner' });
    expect(tenantRepo.insert).toHaveBeenCalledWith({
      id: view.id,
      name: view.id,
      organization_name: 'Acme',
      is_active: true,
    });
    expect(tenantCache.addMember).toHaveBeenCalledWith(view.id, CALLER, 'owner');
  });
});

describe('OrganizationsService.rename', () => {
  it.each<OrganizationRole>(['viewer', 'member', 'admin'])('refuses a %s', async (role) => {
    const { service, tenantRepo } = build({ roles: { [CALLER]: role } });
    await expect(service.rename(CALLER, ORG, 'New')).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenantRepo.update).not.toHaveBeenCalled();
  });

  it('lets an owner rename and trims the label', async () => {
    const { service, tenantRepo } = build({ roles: { [CALLER]: 'owner' } });
    await expect(service.rename(CALLER, ORG, '  New  ')).resolves.toEqual({
      id: ORG,
      name: 'New',
    });
    expect(tenantRepo.update).toHaveBeenCalledWith({ id: ORG }, { organization_name: 'New' });
  });

  it('refuses a blank name', async () => {
    const { service } = build({ roles: { [CALLER]: 'owner' } });
    await expect(service.rename(CALLER, ORG, ' ')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OrganizationsService log retention', () => {
  it('lets any member read it and reports the configured default', async () => {
    const { service, tenantRepo } = build({ roles: { [CALLER]: 'viewer' }, retention: 14 });
    tenantRepo.findOne.mockResolvedValue({ id: ORG, is_active: true, log_retention_days: 7 });
    await expect(service.getLogRetention(CALLER, ORG)).resolves.toEqual({
      retention_days: 7,
      default_days: 14,
    });
  });

  it('falls back to the built-in 30 days when config has no value', async () => {
    const { service } = build({ roles: { [CALLER]: 'viewer' } });
    await expect(service.getLogRetention(CALLER, ORG)).resolves.toEqual({
      retention_days: null,
      default_days: 30,
    });
  });

  it('only owners write it', async () => {
    const { service, tenantRepo } = build({ roles: { [CALLER]: 'admin' } });
    await expect(service.setLogRetention(CALLER, ORG, 10)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tenantRepo.update).not.toHaveBeenCalled();
  });

  it('accepts null (follow the instance default) and valid integers', async () => {
    const { service, tenantRepo } = build({ roles: { [CALLER]: 'owner' } });
    await expect(service.setLogRetention(CALLER, ORG, null)).resolves.toMatchObject({
      retention_days: null,
    });
    await expect(
      service.setLogRetention(CALLER, ORG, MAX_LOG_RETENTION_DAYS),
    ).resolves.toMatchObject({ retention_days: MAX_LOG_RETENTION_DAYS });
    expect(tenantRepo.update).toHaveBeenLastCalledWith(
      { id: ORG },
      { log_retention_days: MAX_LOG_RETENTION_DAYS },
    );
  });

  it.each([0, -1, 1.5, MAX_LOG_RETENTION_DAYS + 1, '10', undefined, NaN])(
    'rejects %p with 400 and stores nothing',
    async (value) => {
      const { service, tenantRepo } = build({ roles: { [CALLER]: 'owner' } });
      await expect(service.setLogRetention(CALLER, ORG, value)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(tenantRepo.update).not.toHaveBeenCalled();
    },
  );
});

describe('OrganizationsService.deactivate', () => {
  it('needs an owner', async () => {
    const { service, tenantRepo } = build({ roles: { [CALLER]: 'admin' } });
    await expect(service.deactivate(CALLER, ORG)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenantRepo.update).not.toHaveBeenCalled();
  });

  it('flags the organization inactive and drops every member cached access', async () => {
    const { service, tenantRepo, memberRepo, tenantCache } = build({
      roles: { [CALLER]: 'owner' },
    });
    memberRepo.find.mockResolvedValue([{ user_id: 'a' }, { user_id: 'b' }]);
    await service.deactivate(CALLER, ORG);
    expect(tenantRepo.update).toHaveBeenCalledWith({ id: ORG }, { is_active: false });
    expect(memberRepo.find).toHaveBeenCalledWith({ where: { tenant_id: ORG } });
    expect(tenantCache.invalidate.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
  });
});

describe('OrganizationsService.listMembers', () => {
  it('is scoped to the organization in the path and open to viewers', async () => {
    const { service, ds } = build({ roles: { [CALLER]: 'viewer' } });
    ds.query.mockResolvedValue([memberRow('a', 'owner')]);
    await expect(service.listMembers(CALLER, ORG)).resolves.toHaveLength(1);
    expect(ds.query.mock.calls[0][1]).toEqual([ORG]);
  });

  it('is closed to non-members', async () => {
    const { service, ds } = build({ roles: {} });
    await expect(service.listMembers('stranger', ORG)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ds.query).not.toHaveBeenCalled();
  });
});

describe('OrganizationsService.addMember', () => {
  it('needs admin', async () => {
    const { service } = build({ roles: { [CALLER]: 'member' } });
    await expect(
      service.addMember(CALLER, ORG, { email: 'a@b.test', role: 'viewer' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an invalid role before anything else', async () => {
    const { service, accounts } = build({ roles: { [CALLER]: 'admin' } });
    await expect(
      service.addMember(CALLER, ORG, { email: 'a@b.test', role: 'god' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(accounts.findByEmail).not.toHaveBeenCalled();
  });

  it('stops an admin from granting owner', async () => {
    const { service, tenantCache } = build({ roles: { [CALLER]: 'admin' } });
    await expect(
      service.addMember(CALLER, ORG, { email: 'a@b.test', role: 'owner' }),
    ).rejects.toMatchObject({ response: { code: 'insufficient_role' } });
    expect(tenantCache.addMember).not.toHaveBeenCalled();
  });

  it.each(['', 'not-an-email', undefined])('requires a valid email (%p)', async (email) => {
    const { service } = build({ roles: { [CALLER]: 'admin' } });
    await expect(
      service.addMember(CALLER, ORG, { email: email as never, role: 'viewer' }),
    ).rejects.toThrow(/valid email/);
  });

  it('adds an existing account with the given role, with no temporary password', async () => {
    const { service, accounts, ds, tenantCache } = build({ roles: { [CALLER]: 'admin' } });
    accounts.findByEmail.mockResolvedValue({ id: 'existing' });
    ds.query.mockResolvedValue([memberRow('existing', 'member')]);
    const result = await service.addMember(CALLER, ORG, { email: 'a@b.test', role: 'member' });
    expect(tenantCache.addMember).toHaveBeenCalledWith(ORG, 'existing', 'member');
    expect(result).toEqual({ member: memberRow('existing', 'member'), temporaryPassword: null });
    expect(accounts.createAccount).not.toHaveBeenCalled();
  });

  it('conflicts when the account already belongs to the organization', async () => {
    const { service, accounts, memberRepo, tenantCache } = build({ roles: { [CALLER]: 'admin' } });
    accounts.findByEmail.mockResolvedValue({ id: 'existing' });
    memberRepo.exists.mockResolvedValue(true);
    await expect(
      service.addMember(CALLER, ORG, { email: 'a@b.test', role: 'viewer' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(memberRepo.exists).toHaveBeenCalledWith({
      where: { tenant_id: ORG, user_id: 'existing' },
    });
    expect(tenantCache.addMember).not.toHaveBeenCalled();
  });

  it('refuses an unknown email instead of creating an account', async () => {
    const { service, accounts, tenantCache } = build({ roles: { [CALLER]: 'owner' } });
    accounts.findByEmail.mockResolvedValue(null);
    await expect(
      service.addMember(CALLER, ORG, { email: 'new@b.test', name: 'New', role: 'owner' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(accounts.createAccount).not.toHaveBeenCalled();
    expect(tenantCache.addMember).not.toHaveBeenCalled();
  });
});

describe('OrganizationsService.addExistingMember', () => {
  it('needs admin and enforces the owner-grant rule', async () => {
    const { service, tenantCache } = build({
      roles: { member: 'member', admin: 'admin', owner: 'owner' },
    });
    await expect(service.addExistingMember('member', ORG, 'x', 'viewer')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.addExistingMember('admin', ORG, 'x', 'owner')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await service.addExistingMember('owner', ORG, 'x', 'owner');
    expect(tenantCache.addMember).toHaveBeenCalledTimes(1);
    expect(tenantCache.addMember).toHaveBeenCalledWith(ORG, 'x', 'owner');
  });
});

describe('OrganizationsService.allMemberships', () => {
  it('only reads active organizations and shows the display name', async () => {
    const { service, ds } = build();
    ds.query.mockResolvedValue([
      { userId: 'u', id: 't', name: 'uuid', organization_name: ' Acme ', role: 'admin' },
    ]);
    await expect(service.allMemberships()).resolves.toEqual([
      { userId: 'u', id: 't', name: 'Acme', role: 'admin' },
    ]);
    expect(ds.query.mock.calls[0][0]).toContain('t.is_active');
  });
});

describe('OrganizationsService.changeRole', () => {
  const setup = (callerRole: OrganizationRole, current: OrganizationRole, owners = 2) => {
    const ctx = build({ roles: { [CALLER]: callerRole } });
    ctx.ds.query.mockResolvedValue([memberRow('target', current)]);
    ctx.memberRepo.count.mockResolvedValue(owners);
    return ctx;
  };

  it('is 404 when the target is not a member of this organization', async () => {
    const { service, ds } = build({ roles: { [CALLER]: 'owner' } });
    ds.query.mockResolvedValue([]);
    await expect(service.changeRole(CALLER, ORG, 'ghost', 'viewer')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets an admin move a member between non-owner roles', async () => {
    const { service, tenantCache } = setup('admin', 'member');
    await service.changeRole(CALLER, ORG, 'target', 'viewer');
    expect(tenantCache.addMember).toHaveBeenCalledWith(ORG, 'target', 'viewer');
  });

  it('stops an admin from promoting someone to owner', async () => {
    const { service, tenantCache } = setup('admin', 'member');
    await expect(service.changeRole(CALLER, ORG, 'target', 'owner')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tenantCache.addMember).not.toHaveBeenCalled();
  });

  it('stops an admin from demoting an owner', async () => {
    const { service, tenantCache } = setup('admin', 'owner');
    await expect(service.changeRole(CALLER, ORG, 'target', 'member')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tenantCache.addMember).not.toHaveBeenCalled();
  });

  it('protects the last owner from demotion', async () => {
    const { service, tenantCache } = setup('owner', 'owner', 1);
    await expect(service.changeRole(CALLER, ORG, 'target', 'admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tenantCache.addMember).not.toHaveBeenCalled();
  });

  it('lets an owner demote another owner when one remains', async () => {
    const { service, tenantCache } = setup('owner', 'owner', 2);
    await service.changeRole(CALLER, ORG, 'target', 'admin');
    expect(tenantCache.addMember).toHaveBeenCalledWith(ORG, 'target', 'admin');
  });

  it('does not count owners when the role stays owner', async () => {
    const { service, memberRepo } = setup('owner', 'owner', 1);
    await service.changeRole(CALLER, ORG, 'target', 'owner');
    expect(memberRepo.count).not.toHaveBeenCalled();
  });

  it('rejects members and viewers', async () => {
    for (const role of ['member', 'viewer'] as const) {
      const { service } = setup(role, 'viewer');
      await expect(service.changeRole(CALLER, ORG, 'target', 'member')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });
});

describe('OrganizationsService.removeMember', () => {
  it('removes a member scoped to this organization and drops their cached access', async () => {
    const ctx = build({ roles: { [CALLER]: 'admin' } });
    ctx.ds.query.mockResolvedValue([memberRow('target', 'member')]);
    await ctx.service.removeMember(CALLER, ORG, 'target');
    expect(ctx.memberRepo.delete).toHaveBeenCalledWith({ tenant_id: ORG, user_id: 'target' });
    expect(ctx.tenantCache.invalidate).toHaveBeenCalledWith('target');
  });

  it('frees owner_user_id when the removed member created the organization', async () => {
    const ctx = build({ roles: { [CALLER]: 'admin' } });
    ctx.ds.query.mockResolvedValue([memberRow('target', 'member')]);
    await ctx.service.removeMember(CALLER, ORG, 'target');
    expect(ctx.tenantRepo.update).toHaveBeenCalledWith(
      { id: ORG, owner_user_id: 'target' },
      { owner_user_id: null },
    );
  });

  it('stops an admin from removing an owner', async () => {
    const ctx = build({ roles: { [CALLER]: 'admin' } });
    ctx.ds.query.mockResolvedValue([memberRow('target', 'owner')]);
    await expect(ctx.service.removeMember(CALLER, ORG, 'target')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ctx.memberRepo.delete).not.toHaveBeenCalled();
  });

  it('keeps the last owner', async () => {
    const ctx = build({ roles: { [CALLER]: 'owner' } });
    ctx.ds.query.mockResolvedValue([memberRow('target', 'owner')]);
    ctx.memberRepo.count.mockResolvedValue(1);
    await expect(ctx.service.removeMember(CALLER, ORG, 'target')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(ctx.memberRepo.delete).not.toHaveBeenCalled();
  });

  it('is 404 for an unknown member', async () => {
    const ctx = build({ roles: { [CALLER]: 'owner' } });
    ctx.ds.query.mockResolvedValue([]);
    await expect(ctx.service.removeMember(CALLER, ORG, 'ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
