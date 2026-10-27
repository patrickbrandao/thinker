import { fetchJson, fetchMutate, type FetchMutateOptions } from './core.js';

/** Organization roles, lowest to highest (ADR 0006). */
export type OrgRole = 'viewer' | 'member' | 'admin' | 'owner';

export interface OrganizationRef {
  id: string;
  name: string;
  role: OrgRole;
}

export interface MeResponse {
  tenantId?: string;
  userId: string;
  authMethod?: string | null;
  expiresAt?: string | null;
  isInstanceAdmin: boolean;
  mustChangePassword: boolean;
  organization: OrganizationRef | null;
}

export interface OrganizationMember {
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  mustChangePassword: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  isInstanceAdmin: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  organizations: OrganizationRef[];
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const orgPath = (id: string, suffix = '') => `/organizations/${encodeURIComponent(id)}${suffix}`;

/* ── Current user ─────────────────────────────────────── */

export function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
  options?: FetchMutateOptions,
): Promise<{ ok: true }> {
  return fetchMutate('/me/password', json({ currentPassword, newPassword }), options);
}

export function setActiveOrganization(organizationId: string): Promise<{ ok: true }> {
  return fetchMutate('/me/active-organization', json({ organizationId }, 'PUT'), {
    silent: true,
  });
}

/* ── Organizations ────────────────────────────────────── */

export function listOrganizations(): Promise<{ organizations: OrganizationRef[] }> {
  return fetchJson('/organizations', undefined, { cache: false });
}

export function createOrganization(name: string): Promise<OrganizationRef> {
  return fetchMutate('/organizations', json({ name }));
}

export function renameOrganization(
  id: string,
  name: string,
): Promise<{ id: string; name: string }> {
  return fetchMutate(orgPath(id), json({ name }, 'PATCH'));
}

export function deleteOrganization(id: string): Promise<{ ok: true }> {
  return fetchMutate(orgPath(id), { method: 'DELETE' });
}

/* ── Members ──────────────────────────────────────────── */

export function listMembers(orgId: string): Promise<{ members: OrganizationMember[] }> {
  return fetchJson(orgPath(orgId, '/members'), undefined, { cache: false });
}

export function addMember(
  orgId: string,
  body: { email: string; name?: string; role: OrgRole },
): Promise<{ member: OrganizationMember; temporaryPassword: string | null }> {
  return fetchMutate(orgPath(orgId, '/members'), json(body));
}

export function updateMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<{ member: OrganizationMember }> {
  return fetchMutate(
    orgPath(orgId, `/members/${encodeURIComponent(userId)}`),
    json({ role }, 'PATCH'),
  );
}

export function removeMember(orgId: string, userId: string): Promise<{ ok: true }> {
  return fetchMutate(orgPath(orgId, `/members/${encodeURIComponent(userId)}`), {
    method: 'DELETE',
  });
}

/* ── Instance admin ───────────────────────────────────── */

export function listAdminUsers(): Promise<{ users: AdminUser[] }> {
  return fetchJson('/admin/users', undefined, { cache: false });
}

export function createAdminUser(body: {
  email: string;
  name: string;
  isInstanceAdmin?: boolean;
  organizationId?: string;
  role?: OrgRole;
}): Promise<{ user: AdminUser; temporaryPassword: string }> {
  return fetchMutate('/admin/users', json(body));
}

export function resetUserPassword(userId: string): Promise<{ temporaryPassword: string }> {
  return fetchMutate(`/admin/users/${encodeURIComponent(userId)}/reset-password`, {
    method: 'POST',
  });
}

export function setInstanceAdmin(
  userId: string,
  isInstanceAdmin: boolean,
): Promise<{ user: AdminUser }> {
  return fetchMutate(
    `/admin/users/${encodeURIComponent(userId)}`,
    json({ isInstanceAdmin }, 'PATCH'),
  );
}
