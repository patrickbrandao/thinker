import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { INSTANCE_ADMIN_KEY, MIN_ROLE_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

function run(opts: {
  method?: string;
  ctx?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}): boolean {
  const reflector = {
    getAllAndOverride: (key: string) => opts.meta?.[key],
  } as unknown as Reflector;
  const request = { method: opts.method ?? 'GET', tenantContext: opts.ctx };
  const context = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
  return new RolesGuard(reflector).canActivate(context);
}

const ctx = (role: string | null, extra: Record<string, unknown> = {}) => ({
  tenantId: 't1',
  userId: 'u1',
  role,
  ...extra,
});

describe('RolesGuard (ADR 0006)', () => {
  it('lets every role read', () => {
    expect(run({ ctx: ctx('viewer') })).toBe(true);
  });

  it('needs member for any mutation by default', () => {
    expect(() => run({ method: 'POST', ctx: ctx('viewer') })).toThrow(ForbiddenException);
    expect(run({ method: 'POST', ctx: ctx('member') })).toBe(true);
  });

  it('applies MinRole to mutations only, unless includeReads', () => {
    const meta = { [MIN_ROLE_KEY]: { role: 'admin', includeReads: false } };
    expect(run({ method: 'GET', ctx: ctx('member'), meta })).toBe(true);
    expect(() => run({ method: 'PUT', ctx: ctx('member'), meta })).toThrow(ForbiddenException);
    expect(run({ method: 'PUT', ctx: ctx('owner'), meta })).toBe(true);
    const reads = { [MIN_ROLE_KEY]: { role: 'admin', includeReads: true } };
    expect(() => run({ method: 'GET', ctx: ctx('member'), meta: reads })).toThrow(
      ForbiddenException,
    );
  });

  it('restricts InstanceAdminOnly to the instance admin', () => {
    const meta = { [INSTANCE_ADMIN_KEY]: true };
    expect(() => run({ ctx: ctx('owner'), meta })).toThrow(ForbiddenException);
    expect(run({ ctx: ctx('viewer', { isInstanceAdmin: true }), meta })).toBe(true);
  });

  it('treats a user with no organization yet as the owner of their first one', () => {
    expect(run({ method: 'POST', ctx: { tenantId: null, userId: 'u1', role: null } })).toBe(true);
  });

  it('skips public routes and requests without a tenant context', () => {
    expect(run({ method: 'POST', meta: { [IS_PUBLIC_KEY]: true }, ctx: ctx('viewer') })).toBe(true);
    expect(run({ method: 'POST' })).toBe(true);
  });
});
