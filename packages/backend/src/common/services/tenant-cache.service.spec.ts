import { ForbiddenException } from '@nestjs/common';
import { TenantCacheService } from './tenant-cache.service';

type Member = { tenant_id: string; user_id: string; role: string; created_at: string };

function setup(opts: {
  members?: Member[];
  profile?: Record<string, unknown> | null;
  activeTenants?: string[];
}) {
  const members = [...(opts.members ?? [])];
  const active = new Set(opts.activeTenants ?? members.map((m) => m.tenant_id));
  const tenantRepo = {
    find: jest.fn(async ({ where }: { where: { id: { _value: string[] } } }) =>
      where.id._value.filter((id) => active.has(id)).map((id) => ({ id })),
    ),
    exists: jest.fn(async ({ where }: { where: { id: string } }) => active.has(where.id)),
    insert: jest.fn(async ({ id }: { id: string }) => {
      active.add(id);
    }),
    findOne: jest.fn(),
  };
  const memberRepo = {
    find: jest.fn(async ({ where }: { where: { user_id: string } }) =>
      members.filter((m) => m.user_id === where.user_id),
    ),
    upsert: jest.fn(async (row: Member) => {
      members.push({ ...row, created_at: '2026-10-27' });
    }),
  };
  const profileRepo = { findOne: jest.fn(async () => opts.profile ?? null) };
  const service = new TenantCacheService(
    tenantRepo as never,
    memberRepo as never,
    profileRepo as never,
  );
  return { service, tenantRepo, memberRepo, profileRepo };
}

const m = (tenant_id: string, role: string): Member => ({
  tenant_id,
  user_id: 'u1',
  role,
  created_at: '2026-10-01',
});

describe('TenantCacheService (ADR 0006)', () => {
  it('returns no organization for a user without memberships', async () => {
    const { service } = setup({});
    await expect(service.resolveAccess('u1')).resolves.toMatchObject({
      tenantId: null,
      role: null,
    });
  });

  it('picks the first membership, or the saved active one', async () => {
    const first = setup({ members: [m('t1', 'owner'), m('t2', 'viewer')] });
    await expect(first.service.resolveAccess('u1')).resolves.toMatchObject({
      tenantId: 't1',
      role: 'owner',
    });
    const saved = setup({
      members: [m('t1', 'owner'), m('t2', 'viewer')],
      profile: { active_tenant_id: 't2' },
    });
    await expect(saved.service.resolveAccess('u1')).resolves.toMatchObject({
      tenantId: 't2',
      role: 'viewer',
    });
  });

  it('honours a requested organization the user belongs to', async () => {
    const { service } = setup({ members: [m('t1', 'owner'), m('t2', 'member')] });
    await expect(service.resolveAccess('u1', 't2')).resolves.toMatchObject({
      tenantId: 't2',
      role: 'member',
    });
  });

  it('refuses a requested organization the user does not belong to', async () => {
    const { service } = setup({ members: [m('t1', 'owner')], activeTenants: ['t1', 't9'] });
    await expect(service.resolveAccess('u1', 't9')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the instance admin act as owner in any active organization', async () => {
    const { service } = setup({
      members: [],
      profile: { is_instance_admin: true },
      activeTenants: ['t9'],
    });
    await expect(service.resolveAccess('u1', 't9')).resolves.toMatchObject({
      tenantId: 't9',
      role: 'owner',
      isInstanceAdmin: true,
    });
  });

  it('drops deactivated organizations', async () => {
    const { service } = setup({ members: [m('t1', 'owner')], activeTenants: [] });
    await expect(service.resolve('u1')).resolves.toBeNull();
  });

  it('reports the forced password change flag', async () => {
    const { service } = setup({ profile: { must_change_password: true } });
    await expect(service.resolveAccess('u1')).resolves.toMatchObject({ mustChangePassword: true });
  });

  it('caches access until invalidated', async () => {
    const { service, memberRepo } = setup({ members: [m('t1', 'owner')] });
    await service.resolve('u1');
    await service.resolve('u1');
    expect(memberRepo.find).toHaveBeenCalledTimes(1);
    service.invalidate('u1');
    await service.resolve('u1');
    expect(memberRepo.find).toHaveBeenCalledTimes(2);
  });

  it('ensureForUser creates a personal organization owned by the user', async () => {
    const { service, tenantRepo, memberRepo } = setup({});
    const id = await service.ensureForUser('u1');
    expect(tenantRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ id, owner_user_id: 'u1' }),
    );
    expect(memberRepo.upsert).toHaveBeenCalledWith(
      { tenant_id: id, user_id: 'u1', role: 'owner' },
      ['tenant_id', 'user_id'],
    );
    await expect(service.resolve('u1')).resolves.toBe(id);
  });

  it('ensureForUser returns an existing membership without creating', async () => {
    const { service, tenantRepo } = setup({ members: [m('t1', 'member')] });
    await expect(service.ensureForUser('u1')).resolves.toBe('t1');
    expect(tenantRepo.insert).not.toHaveBeenCalled();
  });
});
