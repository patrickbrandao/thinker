/**
 * Event triggers: workspace-scoped delivery targets (e-mail, HTTP webhook,
 * Telegram, remote log) that harnesses point at instead of each carrying its
 * own notification settings.
 */

export const TRIGGER_TYPES = ['email', 'webhook', 'telegram', 'syslog'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** Events a harness can route to a trigger (stored on the harness binding). */
export const HARNESS_TRIGGER_EVENTS = [
  'limit.alert',
  'limit.block',
  'provider.failure',
  'credential.expired',
  'request.debug',
] as const;

/** Workspace events, subscribed on the trigger itself (no harness binding exists yet/anymore). */
export const WORKSPACE_TRIGGER_EVENTS = ['harness.created', 'harness.deleted'] as const;

export const TRIGGER_EVENT_TYPES = [
  ...HARNESS_TRIGGER_EVENTS,
  ...WORKSPACE_TRIGGER_EVENTS,
  'test',
] as const;

export type HarnessTriggerEvent = (typeof HARNESS_TRIGGER_EVENTS)[number];
export type WorkspaceTriggerEvent = (typeof WORKSPACE_TRIGGER_EVENTS)[number];
export type TriggerEventType = (typeof TRIGGER_EVENT_TYPES)[number];

export const TRIGGER_EVENT_STATUSES = ['pending', 'delivering', 'delivered', 'failed'] as const;
export type TriggerEventStatus = (typeof TRIGGER_EVENT_STATUSES)[number];

export const EMAIL_TRIGGER_PROVIDERS = ['resend', 'mailgun', 'sendgrid'] as const;
export type EmailTriggerProvider = (typeof EMAIL_TRIGGER_PROVIDERS)[number];

export const WEBHOOK_METHODS = ['POST', 'PUT', 'PATCH', 'GET'] as const;
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];

export const SYSLOG_TRANSPORTS = ['udp', 'tcp'] as const;
export const SYSLOG_FORMATS = ['rfc5424', 'rfc3164'] as const;
export type SyslogTransport = (typeof SYSLOG_TRANSPORTS)[number];
export type SyslogFormat = (typeof SYSLOG_FORMATS)[number];

/** RFC 5424 severities, index = numeric code. */
export const SYSLOG_SEVERITIES = [
  'emerg',
  'alert',
  'crit',
  'err',
  'warning',
  'notice',
  'info',
  'debug',
] as const;
export type SyslogSeverity = (typeof SYSLOG_SEVERITIES)[number];

/** RFC 5424 facilities, index = numeric code. */
export const SYSLOG_FACILITIES = [
  'kern',
  'user',
  'mail',
  'daemon',
  'auth',
  'syslog',
  'lpr',
  'news',
  'uucp',
  'cron',
  'authpriv',
  'ftp',
  'ntp',
  'security',
  'console',
  'solaris-cron',
  'local0',
  'local1',
  'local2',
  'local3',
  'local4',
  'local5',
  'local6',
  'local7',
] as const;
export type SyslogFacility = (typeof SYSLOG_FACILITIES)[number];

/**
 * Severity per event. `request.debug` uses `info` for a successful request
 * and the `request.debug.failed` entry when the request failed.
 */
export const DEFAULT_SYSLOG_SEVERITIES: Record<string, SyslogSeverity> = {
  'limit.alert': 'warning',
  'limit.block': 'err',
  'provider.failure': 'err',
  'credential.expired': 'err',
  'request.debug': 'info',
  'request.debug.failed': 'err',
  'harness.created': 'notice',
  'harness.deleted': 'notice',
  test: 'info',
};

/** Delivery property bounds and defaults. */
export const TRIGGER_LIMITS = {
  maxRetries: { min: 0, max: 10, default: 3 },
  retryDelaySeconds: { min: 1, max: 3600, default: 30 },
  timeoutSeconds: { min: 1, max: 60, default: 10 },
} as const;

/** Template variables, grouped by the events that fill them. */
export const TRIGGER_VARIABLES: Array<{ name: string; events: 'all' | TriggerEventType[] }> = [
  { name: 'event.id', events: 'all' },
  { name: 'event.type', events: 'all' },
  { name: 'event.timestamp', events: 'all' },
  { name: 'event.title', events: 'all' },
  { name: 'event.message', events: 'all' },
  { name: 'event.json', events: 'all' },
  { name: 'workspace.id', events: 'all' },
  { name: 'workspace.name', events: 'all' },
  { name: 'trigger.name', events: 'all' },
  { name: 'delivery.attempt', events: 'all' },
  { name: 'harness.id', events: 'all' },
  { name: 'harness.name', events: 'all' },
  { name: 'harness.display_name', events: 'all' },
  { name: 'harness.url', events: 'all' },
  { name: 'rule.id', events: ['limit.alert', 'limit.block'] },
  { name: 'rule.metric', events: ['limit.alert', 'limit.block'] },
  { name: 'rule.threshold', events: ['limit.alert', 'limit.block'] },
  { name: 'rule.period', events: ['limit.alert', 'limit.block'] },
  { name: 'value.actual', events: ['limit.alert', 'limit.block'] },
  { name: 'period.start', events: ['limit.alert', 'limit.block'] },
  { name: 'period.end', events: ['limit.alert', 'limit.block'] },
  { name: 'period.reset', events: ['limit.block'] },
  { name: 'request.id', events: ['request.debug', 'provider.failure'] },
  { name: 'request.status', events: ['request.debug', 'provider.failure'] },
  { name: 'request.model', events: ['request.debug', 'provider.failure'] },
  { name: 'request.requested_model', events: ['request.debug', 'provider.failure'] },
  { name: 'request.provider', events: ['request.debug', 'provider.failure'] },
  { name: 'request.tier', events: ['request.debug', 'provider.failure'] },
  { name: 'request.input_tokens', events: ['request.debug'] },
  { name: 'request.output_tokens', events: ['request.debug'] },
  { name: 'request.tokens', events: ['request.debug'] },
  { name: 'request.cost', events: ['request.debug'] },
  { name: 'request.latency_ms', events: ['request.debug', 'provider.failure'] },
  { name: 'request.error', events: ['request.debug', 'provider.failure'] },
  { name: 'request.http_status', events: ['request.debug', 'provider.failure'] },
  { name: 'request.url', events: ['request.debug', 'provider.failure'] },
  { name: 'failure.count', events: ['provider.failure'] },
  { name: 'connection.id', events: ['credential.expired'] },
  { name: 'connection.provider', events: ['credential.expired'] },
  { name: 'connection.label', events: ['credential.expired'] },
  { name: 'connection.http_status', events: ['credential.expired'] },
  { name: 'connection.error', events: ['credential.expired'] },
  { name: 'actor.email', events: ['harness.created', 'harness.deleted'] },
];

export const DEFAULT_TRIGGER_TEMPLATES = {
  email: { subject: '[Thinker] {{event.title}}', body: '{{event.message}}' },
  webhook: { body: '{{event.json}}', contentType: 'application/json' },
  telegram: { text: '<b>{{event.title}}</b>\n{{event.message}}' },
  syslog: { message: '{{event.title}}: {{event.message}}' },
} as const;
