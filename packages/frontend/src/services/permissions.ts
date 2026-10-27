import type { OrgRole } from './api/organizations.js';
import { t } from '../i18n/index.js';

/**
 * Role checks for the dashboard (ADR 0006 §5). They only shape the UI: the
 * backend's RolesGuard enforces the same table on every request.
 */

const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Display name of a role in the active language. */
export function roleLabel(role: OrgRole): string {
  return t(`org.roles.${role}`);
}

export const ALL_ROLES: OrgRole[] = ['owner', 'admin', 'member', 'viewer'];

/** True when `role` is at least `min`. */
export function hasRole(role: OrgRole | null | undefined, min: OrgRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

/** Harnesses, harness keys, playground. */
export const canEditHarnesses = (role: OrgRole | null | undefined) => hasRole(role, 'member');

/** Providers, credentials, routing, notifications. */
export const canManageProviders = (role: OrgRole | null | undefined) => hasRole(role, 'admin');

/** Add, remove and change the role of members; create accounts in the organization. */
export const canManageMembers = (role: OrgRole | null | undefined) => hasRole(role, 'admin');

/** Rename or delete the organization. */
export const canManageOrganization = (role: OrgRole | null | undefined) => hasRole(role, 'owner');

/** Roles the actor may grant. Admins never grant owner. */
export function assignableRoles(actor: OrgRole | null | undefined): OrgRole[] {
  if (actor === 'owner') return ALL_ROLES;
  if (actor === 'admin') return ['admin', 'member', 'viewer'];
  return [];
}

/** Whether the actor may change or remove a member holding `target`. Admins don't touch owners. */
export function canEditMember(actor: OrgRole | null | undefined, target: OrgRole): boolean {
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'owner';
  return false;
}
