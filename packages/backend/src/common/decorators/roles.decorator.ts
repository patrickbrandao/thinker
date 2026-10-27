import { SetMetadata } from '@nestjs/common';
import type { OrganizationRole } from '../../entities/organization-member.entity';

export const MIN_ROLE_KEY = 'thinker:minRole';
export const INSTANCE_ADMIN_KEY = 'thinker:instanceAdmin';

export interface MinRoleMetadata {
  role: OrganizationRole;
  /** Also require the role on GET/HEAD (e.g. OAuth starts that mutate). */
  includeReads: boolean;
}

/**
 * Lowest organization role allowed to change things through a handler or
 * controller (ADR 0006). Reads stay open to `viewer` unless `includeReads`.
 * Without the decorator, reads need `viewer` and every other method `member`.
 */
export const MinRole = (role: OrganizationRole, opts: { includeReads?: boolean } = {}) =>
  SetMetadata(MIN_ROLE_KEY, { role, includeReads: opts.includeReads ?? false });

/** Restricts a handler or controller to the instance administrator. */
export const InstanceAdminOnly = () => SetMetadata(INSTANCE_ADMIN_KEY, true);
