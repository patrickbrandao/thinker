import type { SystemEventInput } from './system-events.service';

/**
 * Module-level door to Alerts for code that lives outside Nest's injector
 * (the OAuth refresh coordinator, Better Auth hooks, catalog helpers).
 * `SystemEventsService` registers itself at startup; before that, and in unit
 * tests, alerts are dropped.
 */
let sink: ((input: SystemEventInput) => void) | null = null;
let userSink: ((user: UserRef, input: Omit<SystemEventInput, 'tenantId'>) => void) | null = null;

/** Who an authentication event is about: a known user, or only the e-mail typed. */
export interface UserRef {
  userId?: string | null;
  email?: string | null;
}

export function setUserAlertSink(
  fn: ((user: UserRef, input: Omit<SystemEventInput, 'tenantId'>) => void) | null,
): void {
  userSink = fn;
}

/** Records the event in every workspace the user belongs to (instance-level when none). */
export function emitUserAlert(user: UserRef, input: Omit<SystemEventInput, 'tenantId'>): void {
  try {
    userSink?.(user, input);
  } catch {
    // Alerts never break their caller.
  }
}

export function setAlertSink(fn: ((input: SystemEventInput) => void) | null): void {
  sink = fn;
}

export function emitAlert(input: SystemEventInput): void {
  try {
    sink?.(input);
  } catch {
    // Alerts never break their caller.
  }
}

/** catalog.sync_failed: an instance event, at most one per catalog and hour. */
export function alertCatalogFailure(catalog: string, detail: string): void {
  emitAlert({
    tenantId: null,
    level: 'warning',
    type: 'catalog.sync_failed',
    title: `Catalog sync failed: ${catalog}`,
    message: detail.slice(0, 1000),
    entityType: 'catalog',
    entityId: catalog,
    entityName: catalog,
    metadata: { source: catalog },
    dedupeKey: `catalog.sync_failed:${catalog}`,
    dedupeWindowMs: 60 * 60_000,
  });
}
