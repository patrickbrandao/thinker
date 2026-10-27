import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import {
  ORGANIZATION_HEADER,
  getActiveOrganizationId,
  markPasswordChangeRequired,
  passwordChangeRequired,
  setActiveOrganizationId,
  withOrganizationHeader,
} from '../../src/services/org-context';
import { fetchJson, fetchMutate, ApiError } from '../../src/services/api/core';
import { loadMe, me, roleCan, setMe } from '../../src/services/session-store';
import {
  assignableRoles,
  canEditMember,
  canEditHarnesses,
  canManageOrganization,
  canManageProviders,
  hasRole,
} from '../../src/services/permissions';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  localStorage.clear();
  markPasswordChangeRequired(false);
  setMe(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('permissions', () => {
  it('ranks roles', () => {
    expect(hasRole('owner', 'admin')).toBe(true);
    expect(hasRole('member', 'admin')).toBe(false);
    expect(hasRole(null, 'viewer')).toBe(false);
  });

  it('follows the ADR 0006 table', () => {
    expect(canEditHarnesses('viewer')).toBe(false);
    expect(canEditHarnesses('member')).toBe(true);
    expect(canManageProviders('member')).toBe(false);
    expect(canManageProviders('admin')).toBe(true);
    expect(canManageOrganization('admin')).toBe(false);
    expect(canManageOrganization('owner')).toBe(true);
  });

  it('keeps admins away from owners', () => {
    expect(assignableRoles('admin')).not.toContain('owner');
    expect(assignableRoles('owner')).toContain('owner');
    expect(assignableRoles('member')).toEqual([]);
    expect(canEditMember('admin', 'owner')).toBe(false);
    expect(canEditMember('admin', 'member')).toBe(true);
    expect(canEditMember('owner', 'owner')).toBe(true);
    expect(canEditMember('viewer', 'viewer')).toBe(false);
  });
});

describe('organization header', () => {
  it('leaves headers untouched without an active organization', () => {
    const headers = { 'Content-Type': 'application/json' };
    expect(withOrganizationHeader(headers)).toBe(headers);
    expect(withOrganizationHeader()).toBeUndefined();
  });

  it('adds the header to plain objects and Headers', () => {
    setActiveOrganizationId('org-1');
    expect(withOrganizationHeader({ 'Content-Type': 'application/json' })).toEqual({
      'Content-Type': 'application/json',
      [ORGANIZATION_HEADER]: 'org-1',
    });
    const fromHeaders = withOrganizationHeader(new Headers({ a: 'b' })) as Record<string, string>;
    expect(fromHeaders[ORGANIZATION_HEADER]).toBe('org-1');
    expect(fromHeaders.a).toBe('b');
  });

  it('is sent by fetchJson and fetchMutate', async () => {
    setActiveOrganizationId('org-9');
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    vi.stubGlobal('fetch', fetchMock);
    await fetchJson('/agents', undefined, { cache: false });
    await fetchMutate('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ [ORGANIZATION_HEADER]: 'org-9' });
    }
  });
});

describe('password_change_required', () => {
  it('raises the flag from fetchJson', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { code: 'password_change_required' })),
    );
    await expect(fetchJson('/agents', undefined, { cache: false })).rejects.toThrow();
    expect(passwordChangeRequired()).toBe(true);
  });

  it('raises the flag from fetchMutate with a coded ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { code: 'password_change_required' })),
    );
    const err = await fetchMutate('/agents', { method: 'POST' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('password_change_required');
    expect(passwordChangeRequired()).toBe(true);
  });

  it('ignores other 403s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(403, { code: 'insufficient_role', message: 'no' })),
    );
    await expect(fetchMutate('/agents', { method: 'POST' })).rejects.toThrow('no');
    expect(passwordChangeRequired()).toBe(false);
  });
});

describe('loadMe', () => {
  const meBody = {
    userId: 'u1',
    isInstanceAdmin: false,
    mustChangePassword: false,
    organization: { id: 'org-2', name: 'Acme', role: 'viewer' },
  };

  it('stores the resolved organization and exposes the role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, meBody)));
    await loadMe();
    expect(getActiveOrganizationId()).toBe('org-2');
    expect(me()?.organization?.role).toBe('viewer');
    expect(roleCan.editHarnesses()).toBe(false);
    expect(roleCan.manageProviders()).toBe(false);
  });

  it('drops a refused stored organization and retries once', async () => {
    setActiveOrganizationId('gone');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, { code: 'not_a_member' }))
      .mockResolvedValueOnce(jsonResponse(200, meBody));
    vi.stubGlobal('fetch', fetchMock);
    await loadMe();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      [ORGANIZATION_HEADER]: 'gone',
    });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toBeUndefined();
    expect(getActiveOrganizationId()).toBe('org-2');
  });

  it('flags a pending password change', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { ...meBody, mustChangePassword: true })),
    );
    await loadMe();
    expect(passwordChangeRequired()).toBe(true);
  });

  it('allows everything while /me is unknown', () => {
    expect(roleCan.manageOrganization()).toBe(true);
  });
});
