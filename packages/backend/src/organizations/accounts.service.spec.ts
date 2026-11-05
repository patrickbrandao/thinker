const signUpEmail = jest.fn();
const changePassword = jest.fn();
const hash = jest.fn();

jest.mock('../auth/auth.instance', () => ({
  auth: {
    api: {
      signUpEmail: (...args: unknown[]) => signUpEmail(...args),
      changePassword: (...args: unknown[]) => changePassword(...args),
    },
    $context: Promise.resolve({ password: { hash: (...args: unknown[]) => hash(...args) } }),
  },
}));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { isServerUserCreation } from '../auth/signup-policy';
import { AccountsService, generateTemporaryPassword } from './accounts.service';

type Row = Record<string, unknown>;

const account = (over: Partial<Row> = {}): Row => ({
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana',
  createdAt: '2026-01-01T00:00:00Z',
  isInstanceAdmin: false,
  mustChangePassword: false,
  ...over,
});

function build() {
  const ds = { query: jest.fn() };
  const profileRepo = { upsert: jest.fn().mockResolvedValue(undefined) };
  const tenantCache = { invalidate: jest.fn() };
  const service = new AccountsService(ds as never, profileRepo as never, tenantCache as never);
  return { service, ds, profileRepo, tenantCache };
}

/** SQL statements run so far, whitespace-collapsed. */
const sqls = (ds: { query: jest.Mock }) =>
  ds.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());

beforeEach(() => {
  signUpEmail.mockReset();
  changePassword.mockReset();
  hash.mockReset();
});

describe('generateTemporaryPassword', () => {
  it('is url-safe, long enough and different every time', () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(a).not.toBe(b);
  });
});

describe('AccountsService lookups', () => {
  it('finds by email case-insensitively and trims the input', async () => {
    const { service, ds } = build();
    ds.query.mockResolvedValue([account()]);
    await expect(service.findByEmail('  ANA@Example.com ')).resolves.toMatchObject({ id: 'u1' });
    expect(sqls(ds)[0]).toContain('LOWER(u.email) = LOWER($1)');
    expect(ds.query.mock.calls[0][1]).toEqual(['ANA@Example.com']);
  });

  it('returns null when nothing matches', async () => {
    const { service, ds } = build();
    ds.query.mockResolvedValue([]);
    await expect(service.findByEmail('nobody@example.com')).resolves.toBeNull();
    await expect(service.findById('missing')).resolves.toBeNull();
  });

  it('lists every account when no filter is given', async () => {
    const { service, ds } = build();
    ds.query.mockResolvedValue([account(), account({ id: 'u2' })]);
    await expect(service.listAccounts()).resolves.toHaveLength(2);
    expect(sqls(ds)[0]).toContain('WHERE TRUE');
  });
});

describe('AccountsService.createAccount', () => {
  it('refuses an email that already exists, without touching Better Auth', async () => {
    const { service, ds } = build();
    ds.query.mockResolvedValue([account()]);
    await expect(service.createAccount('Ana@Example.com', 'Ana')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it('creates the user as server-side creation with a normalized email and a temp password', async () => {
    const { service, ds, profileRepo } = build();
    let insideServerCreation = false;
    signUpEmail.mockImplementation(async () => {
      insideServerCreation = isServerUserCreation();
      return { user: { id: 'new-user' } };
    });
    ds.query
      .mockResolvedValueOnce([]) // findByEmail
      .mockResolvedValueOnce(undefined) // emailVerified
      .mockResolvedValueOnce(undefined) // delete session
      .mockResolvedValueOnce([account({ id: 'new-user', mustChangePassword: true })]); // findById

    const result = await service.createAccount('  New@Example.COM ', '  New User ', true);

    expect(insideServerCreation).toBe(true);
    const { body } = signUpEmail.mock.calls[0][0];
    expect(body.email).toBe('new@example.com');
    expect(body.name).toBe('New User');
    expect(body.password).toBe(result.temporaryPassword);
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(profileRepo.upsert).toHaveBeenCalledWith(
      { user_id: 'new-user', is_instance_admin: true, must_change_password: true },
      ['user_id'],
    );
    const statements = sqls(ds);
    expect(statements[1]).toContain('"emailVerified" = true');
    // The session signUpEmail opened server-side is nobody's: it is dropped.
    expect(statements[2]).toContain('DELETE FROM session');
    expect(result.account.id).toBe('new-user');
  });

  it('falls back to the email as the name when the name is blank', async () => {
    const { service, ds } = build();
    signUpEmail.mockResolvedValue({ user: { id: 'u9' } });
    ds.query.mockResolvedValue([]);
    await service.createAccount('blank@example.com', '   ').catch(() => undefined);
    expect(signUpEmail.mock.calls[0][0].body.name).toBe('blank@example.com');
  });

  it('is not an instance admin unless asked', async () => {
    const { service, ds, profileRepo } = build();
    signUpEmail.mockResolvedValue({ user: { id: 'u9' } });
    ds.query.mockResolvedValue([]);
    await service.createAccount('plain@example.com', 'Plain').catch(() => undefined);
    expect(profileRepo.upsert.mock.calls[0][0]).toMatchObject({ is_instance_admin: false });
  });

  it('fails with 400 and writes no profile when Better Auth returns no user id', async () => {
    const { service, ds, profileRepo } = build();
    signUpEmail.mockResolvedValue({});
    ds.query.mockResolvedValue([]);
    await expect(service.createAccount('x@example.com', 'X')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(profileRepo.upsert).not.toHaveBeenCalled();
  });

  it('propagates Better Auth failures untouched', async () => {
    const { service, ds } = build();
    signUpEmail.mockRejectedValue(new Error('boom'));
    ds.query.mockResolvedValue([]);
    await expect(service.createAccount('x@example.com', 'X')).rejects.toThrow('boom');
  });
});

describe('AccountsService.resetPassword', () => {
  it('is 404 for an unknown account', async () => {
    const { service, ds } = build();
    ds.query.mockResolvedValue([]);
    await expect(service.resetPassword('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates the credential hash, forces a change and ends every session', async () => {
    const { service, ds, profileRepo, tenantCache } = build();
    hash.mockResolvedValue('HASHED');
    ds.query
      .mockResolvedValueOnce([account()]) // findById
      .mockResolvedValueOnce([{ id: 'acc-1' }]) // UPDATE account ... RETURNING
      .mockResolvedValueOnce(undefined); // DELETE session

    const temp = await service.resetPassword('u1');

    expect(hash).toHaveBeenCalledWith(temp);
    const statements = sqls(ds);
    expect(statements[1]).toContain('UPDATE account SET password = $1');
    expect(ds.query.mock.calls[1][1]).toEqual(['HASHED', 'u1']);
    expect(statements.some((s) => s.startsWith('INSERT INTO account'))).toBe(false);
    expect(profileRepo.upsert).toHaveBeenCalledWith({ user_id: 'u1', must_change_password: true }, [
      'user_id',
    ]);
    expect(tenantCache.invalidate).toHaveBeenCalledWith('u1');
    expect(statements[statements.length - 1]).toContain('DELETE FROM session');
  });

  it('creates the credential row for an account that only had social sign-in', async () => {
    const { service, ds } = build();
    hash.mockResolvedValue('HASHED');
    ds.query
      .mockResolvedValueOnce([account()])
      .mockResolvedValueOnce([]) // no credential row updated
      .mockResolvedValue(undefined);
    await service.resetPassword('u1');
    const insert = ds.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO account'));
    expect(insert).toBeDefined();
    expect(insert![1][1]).toBe('u1');
    expect(insert![1][2]).toBe('HASHED');
  });
});

describe('AccountsService.changeOwnPassword', () => {
  const headers = new Headers({ cookie: 's=1' });

  it.each([
    ['', 'old-password'],
    ['short', 'old-password'],
    ['1234567', 'old-password'],
  ])('rejects a new password of %p (under 8 characters)', async (next, current) => {
    const { service } = build();
    await expect(service.changeOwnPassword('u1', headers, current, next)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('accepts exactly 8 characters', async () => {
    const { service } = build();
    changePassword.mockResolvedValue({});
    await expect(
      service.changeOwnPassword('u1', headers, 'old-password', '12345678'),
    ).resolves.toBeUndefined();
  });

  it('rejects reusing the current password', async () => {
    const { service } = build();
    await expect(
      service.changeOwnPassword('u1', headers, 'same-password', 'same-password'),
    ).rejects.toThrow(/different/);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('maps a Better Auth failure to "current password is wrong" and keeps the flag', async () => {
    const { service, profileRepo } = build();
    changePassword.mockRejectedValue(new Error('INVALID_PASSWORD'));
    await expect(
      service.changeOwnPassword('u1', headers, 'wrong-password', 'brand-new-password'),
    ).rejects.toThrow('The current password is wrong.');
    expect(profileRepo.upsert).not.toHaveBeenCalled();
  });

  it('forwards the caller headers, keeps other sessions and clears the temp-password flag', async () => {
    const { service, profileRepo, tenantCache } = build();
    changePassword.mockResolvedValue({});
    await service.changeOwnPassword('u1', headers, 'old-password', 'brand-new-password');
    expect(changePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: 'old-password',
        newPassword: 'brand-new-password',
        revokeOtherSessions: false,
      },
      headers,
    });
    expect(profileRepo.upsert).toHaveBeenCalledWith(
      { user_id: 'u1', must_change_password: false },
      ['user_id'],
    );
    expect(tenantCache.invalidate).toHaveBeenCalledWith('u1');
  });
});

describe('AccountsService.setInstanceAdmin', () => {
  it('is 404 for an unknown account', async () => {
    const { service, ds } = build();
    ds.query.mockResolvedValue([]);
    await expect(service.setInstanceAdmin('ghost', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to demote the last instance administrator', async () => {
    const { service, ds, profileRepo } = build();
    ds.query
      .mockResolvedValueOnce([account({ isInstanceAdmin: true })])
      .mockResolvedValueOnce([{ count: 0 }]);
    await expect(service.setInstanceAdmin('u1', false)).rejects.toBeInstanceOf(ConflictException);
    expect(profileRepo.upsert).not.toHaveBeenCalled();
  });

  it('demotes when another administrator remains', async () => {
    const { service, ds, profileRepo } = build();
    ds.query
      .mockResolvedValueOnce([account({ isInstanceAdmin: true })])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([account({ isInstanceAdmin: false })]);
    const result = await service.setInstanceAdmin('u1', false);
    expect(profileRepo.upsert).toHaveBeenCalledWith({ user_id: 'u1', is_instance_admin: false }, [
      'user_id',
    ]);
    expect(result.isInstanceAdmin).toBe(false);
  });

  it('promotes without counting administrators', async () => {
    const { service, ds, profileRepo } = build();
    ds.query
      .mockResolvedValueOnce([account()])
      .mockResolvedValueOnce([account({ isInstanceAdmin: true })]);
    const result = await service.setInstanceAdmin('u1', true);
    expect(ds.query).toHaveBeenCalledTimes(2);
    expect(profileRepo.upsert).toHaveBeenCalledWith({ user_id: 'u1', is_instance_admin: true }, [
      'user_id',
    ]);
    expect(result.isInstanceAdmin).toBe(true);
  });
});

describe('AccountsService.setActiveOrganization', () => {
  it('stores the choice and drops the cached access', async () => {
    const { service, profileRepo, tenantCache } = build();
    await service.setActiveOrganization('u1', 'org-2');
    expect(profileRepo.upsert).toHaveBeenCalledWith({ user_id: 'u1', active_tenant_id: 'org-2' }, [
      'user_id',
    ]);
    expect(tenantCache.invalidate).toHaveBeenCalledWith('u1');
  });
});
