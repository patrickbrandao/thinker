/**
 * Alerts (system events): what happened in a workspace or the instance —
 * model changes, credential and OAuth failures, limits, trigger failures,
 * audit trail, authentication and catalog sync.
 */

export const SYSTEM_EVENT_LEVELS = ['error', 'warning', 'info'] as const;
export type SystemEventLevel = (typeof SYSTEM_EVENT_LEVELS)[number];

export const SYSTEM_EVENT_CATEGORIES = [
  'models',
  'credentials',
  'limits',
  'triggers',
  'audit',
  'auth',
  'catalog',
] as const;
export type SystemEventCategory = (typeof SYSTEM_EVENT_CATEGORIES)[number];

/** Seen by every member of the workspace. */
export const OPERATIONAL_EVENT_CATEGORIES: readonly SystemEventCategory[] = [
  'models',
  'credentials',
  'limits',
  'triggers',
];
/** Seen by owners and admins of the workspace only. */
export const ADMIN_EVENT_CATEGORIES: readonly SystemEventCategory[] = ['audit', 'auth'];
/** Instance events (no workspace), seen by instance administrators only. */
export const INSTANCE_EVENT_CATEGORIES: readonly SystemEventCategory[] = ['catalog'];

export const SYSTEM_EVENT_TYPES = [
  'model.added',
  'model.removed',
  'model.error',
  'credential.expired',
  'oauth.refresh_failed',
  'limit.alert',
  'limit.block',
  'trigger.failed',
  'audit.created',
  'audit.updated',
  'audit.deleted',
  'user.login',
  'user.logout',
  'user.login_failed',
  'user.password_changed',
  'catalog.sync_failed',
] as const;
export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[number];

/** Category of each event type. */
export const SYSTEM_EVENT_CATEGORY: Record<SystemEventType, SystemEventCategory> = {
  'model.added': 'models',
  'model.removed': 'models',
  'model.error': 'models',
  'credential.expired': 'credentials',
  'oauth.refresh_failed': 'credentials',
  'limit.alert': 'limits',
  'limit.block': 'limits',
  'trigger.failed': 'triggers',
  'audit.created': 'audit',
  'audit.updated': 'audit',
  'audit.deleted': 'audit',
  'user.login': 'auth',
  'user.logout': 'auth',
  'user.login_failed': 'auth',
  'user.password_changed': 'auth',
  'catalog.sync_failed': 'catalog',
};

/** Days alerts are kept by default (`THINKER_ALERTS_RETENTION_DAYS`). */
export const DEFAULT_ALERTS_RETENTION_DAYS = 90;

/** One alert as the API returns it. */
export interface SystemEventView {
  id: string;
  tenant_id: string | null;
  level: SystemEventLevel;
  category: SystemEventCategory;
  type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  read_by_user_id: string | null;
  read_by_email: string | null;
  read_by_name: string | null;
}
