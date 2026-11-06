import { SetMetadata } from '@nestjs/common';

export type AuditAction = 'created' | 'updated' | 'deleted';

export interface AuditSpec {
  /** Entity kind shown in the alert (`harness`, `connection`, `trigger`...). */
  entity: string;
  action: AuditAction;
  /** Route param that holds the entity id (default `id`). */
  idParam?: string;
  /** Table and column used to read the entity name before an update or delete. */
  lookup?: { table: string; nameColumn: string; idColumn?: string; tenantScoped?: boolean };
  /** Route params whose values name the entity when nothing else does (joined with " / "). */
  nameParams?: string[];
}

export const AUDIT_KEY = 'thinker:audit';

/**
 * Marks a mutating handler for the audit trail (Alerts, category `audit`).
 * The interceptor records who did it, the action, the entity and only the
 * names of the fields sent — never their values.
 */
export const Audit = (spec: AuditSpec) => SetMetadata(AUDIT_KEY, spec);
