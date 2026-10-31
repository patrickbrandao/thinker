import {
  DEFAULT_SYSLOG_SEVERITIES,
  DEFAULT_TRIGGER_TEMPLATES,
  TRIGGER_LIMITS,
  TRIGGER_VARIABLES,
  type EmailTriggerProvider,
  type SyslogFacility,
  type SyslogFormat,
  type SyslogSeverity,
  type SyslogTransport,
  type TriggerEventType,
  type TriggerType,
  type WebhookMethod,
  type WorkspaceTriggerEvent,
} from 'thinker-shared';
import { t, type TranslationKey } from '../../i18n/index.js';
import type {
  EmailTriggerConfig,
  SyslogTriggerConfig,
  TelegramTriggerConfig,
  TriggerConfigWrite,
  TriggerView,
  TriggerWrite,
  WebhookTriggerConfigView,
} from '../../services/api/triggers.js';

/** Secret fields per trigger type; `required` ones must be set on create. */
export const SECRET_FIELDS: Record<TriggerType, Array<{ key: string; required: boolean }>> = {
  email: [{ key: 'apiKey', required: true }],
  webhook: [{ key: 'hmacSecret', required: false }],
  telegram: [{ key: 'botToken', required: true }],
  syslog: [],
};

const EVENT_LABELS: Record<string, TranslationKey> = {
  'limit.alert': 'triggers.events.limitAlert',
  'limit.block': 'triggers.events.limitBlock',
  'provider.failure': 'triggers.events.providerFailure',
  'credential.expired': 'triggers.events.credentialExpired',
  'request.debug': 'triggers.events.requestDebug',
  'request.debug.failed': 'triggers.events.requestDebugFailed',
  'harness.created': 'triggers.events.harnessCreated',
  'harness.deleted': 'triggers.events.harnessDeleted',
  test: 'triggers.events.test',
};

/** Human label of an event type (or a syslog severity key); unknown types show as-is. */
export function eventLabel(event: TriggerEventType | string): string {
  const key = EVENT_LABELS[event];
  return key ? t(key) : event;
}

export function triggerTypeLabel(type: TriggerType | string, provider?: string): string {
  switch (type) {
    case 'email':
      return provider ? kindLabel(`email:${provider}` as TriggerKind) : t('triggers.types.email');
    case 'webhook':
      return t('triggers.types.webhook');
    case 'telegram':
      return t('triggers.types.telegram');
    case 'syslog':
      return t('triggers.types.syslog');
    default:
      return type;
  }
}

/** The e-mail provider of a trigger, undefined for other types. */
export function providerOf(trigger: Pick<TriggerView, 'type' | 'config'>): string | undefined {
  return trigger.type === 'email'
    ? (trigger.config as EmailTriggerConfig | undefined)?.provider
    : undefined;
}

/** The trigger test screen, optionally preselecting a trigger and a harness. */
export function triggerTestPath(triggerId?: string, harness?: string): string {
  const params = new URLSearchParams();
  if (triggerId) params.set('trigger', triggerId);
  if (harness) params.set('harness', harness);
  const query = params.toString();
  return `/triggers/test${query ? `?${query}` : ''}`;
}

/**
 * What the type picker offers: each e-mail provider is its own choice, the
 * rest map 1:1 to a trigger type. Stored as `type` + `config.provider`.
 */
export const TRIGGER_KINDS = [
  'email:resend',
  'email:mailgun',
  'email:sendgrid',
  'webhook',
  'telegram',
  'syslog',
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

const KIND_LABELS: Record<TriggerKind, TranslationKey> = {
  'email:resend': 'triggers.types.emailResend',
  'email:mailgun': 'triggers.types.emailMailgun',
  'email:sendgrid': 'triggers.types.emailSendgrid',
  webhook: 'triggers.types.webhook',
  telegram: 'triggers.types.telegram',
  syslog: 'triggers.types.syslog',
};

export function kindLabel(kind: TriggerKind): string {
  const key = KIND_LABELS[kind];
  return key ? t(key) : kind;
}

export function kindOf(type: TriggerType, provider?: string): TriggerKind {
  return type === 'email' ? (`email:${provider ?? 'resend'}` as TriggerKind) : type;
}

export function splitKind(kind: TriggerKind): {
  type: TriggerType;
  provider?: EmailTriggerProvider;
} {
  if (kind.startsWith('email:')) {
    return { type: 'email', provider: kind.slice(6) as EmailTriggerProvider };
  }
  return { type: kind as TriggerType };
}

/** Variables the gateway computes on every delivery; the test screen does not offer them. */
const COMPUTED_VARS = new Set([
  'event.id',
  'event.type',
  'event.json',
  'event.timestamp',
  'trigger.name',
  'delivery.attempt',
  'workspace.id',
  'workspace.name',
]);

/** The variables a simulated event of this type carries, in display order. */
export function testVariables(event: TriggerEventType): string[] {
  return TRIGGER_VARIABLES.filter(
    (v) =>
      !COMPUTED_VARS.has(v.name) &&
      (v.events === 'all' || (v.events as readonly string[]).includes(event)),
  ).map((v) => v.name);
}

/** Realistic default values for a simulated event, prefilled on the test screen. */
export function sampleVars(
  event: TriggerEventType,
  harness: { name: string; displayName?: string } = { name: 'my-harness' },
): Record<string, string> {
  const h = harness.name;
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const requestId = '00000000-0000-4000-8000-000000000001';
  const titles: Record<string, [string, string]> = {
    test: ['Test event', 'This is a simulated test event sent from Thinker.'],
    'limit.alert': [
      `${h} exceeded the cost threshold`,
      `${h} used $12.40 this day, over the $10.00 threshold. Requests are still being processed.`,
    ],
    'limit.block': [
      `${h} has been blocked`,
      `${h} reached the $10.00 cost limit per day ($10.02). New requests are blocked until the period resets on ${dayEnd.toISOString()}.`,
    ],
    'provider.failure': [
      `${h}: provider failure (openai)`,
      'All routes failed for a request to gpt-5: upstream returned HTTP 503.',
    ],
    'credential.expired': [
      'Credential rejected: anthropic "work key"',
      `anthropic rejected the connection "work key" with HTTP 401 while serving ${h}. Reconnect or replace the key.`,
    ],
    'request.debug': [
      `${h}: request gpt-5`,
      'openai answered gpt-5 in 1840 ms, 1520 tokens, $0.004210.',
    ],
    'harness.created': [`Harness ${h} created`, `The harness ${h} (${h}) was created.`],
    'harness.deleted': [`Harness ${h} deleted`, `The harness ${h} (${h}) was deleted.`],
  };
  const [title, message] = titles[event] ?? titles.test!;
  const values: Record<string, string> = {
    'event.title': title,
    'event.message': message,
    'harness.id': '00000000-0000-4000-8000-0000000000aa',
    'harness.name': h,
    'harness.display_name': harness.displayName ?? h,
    'harness.url': `${origin}/harnesses/${encodeURIComponent(h)}`,
    'rule.id': '00000000-0000-4000-8000-0000000000bb',
    'rule.metric': 'cost',
    'rule.threshold': '10',
    'rule.period': 'day',
    'value.actual': event === 'limit.block' ? '10.02' : '12.4',
    'period.start': dayStart.toISOString(),
    'period.end': dayEnd.toISOString(),
    'period.reset': dayEnd.toISOString(),
    'request.id': requestId,
    'request.status': event === 'provider.failure' ? 'failed' : 'success',
    'request.model': 'gpt-5',
    'request.requested_model': 'auto',
    'request.provider': 'openai',
    'request.tier': 'standard',
    'request.input_tokens': '1200',
    'request.output_tokens': '320',
    'request.tokens': '1520',
    'request.cost': '0.004210',
    'request.latency_ms': '1840',
    'request.error': event === 'provider.failure' ? 'upstream returned HTTP 503' : '',
    'request.http_status': event === 'provider.failure' ? '503' : '',
    'request.url': `${origin}/requests/${requestId}`,
    'failure.count': '1',
    'connection.id': '00000000-0000-4000-8000-0000000000cc',
    'connection.provider': 'anthropic',
    'connection.label': 'work key',
    'connection.http_status': '401',
    'connection.error': 'invalid x-api-key',
    'actor.email': 'admin@example.com',
  };
  return Object.fromEntries(testVariables(event).map((name) => [name, values[name] ?? '']));
}

export interface HeaderRow {
  /** Name stored on the server, when the row came from a saved trigger. */
  storedName: string | null;
  hint: string | null;
  name: string;
  value: string;
}

/** Editable state of the trigger editor. Numbers stay strings while typing. */
export interface TriggerForm {
  name: string;
  type: TriggerType;
  enabled: boolean;
  email: {
    provider: EmailTriggerProvider;
    domain: string;
    from: string;
    to: string;
    subject: string;
    body: string;
  };
  webhook: {
    method: WebhookMethod;
    url: string;
    content_type: string;
    body: string;
    headers: HeaderRow[];
  };
  telegram: { chat_id: string; thread_id: string; silent: boolean; text: string };
  syslog: {
    host: string;
    port: string;
    transport: SyslogTransport;
    format: SyslogFormat;
    facility: SyslogFacility;
    app_name: string;
    message: string;
    severities: Record<string, SyslogSeverity>;
  };
  /** Typed secret values; blank keeps the stored one. */
  secrets: Record<string, string>;
  /** Secrets the user asked to remove. */
  clearSecrets: string[];
  max_retries: string;
  retry_delay_seconds: string;
  timeout_seconds: string;
  workspace_events: WorkspaceTriggerEvent[];
}

/** A new trigger: every type's templates prefilled, so switching type keeps sensible defaults. */
export function emptyForm(): TriggerForm {
  return {
    name: '',
    type: 'webhook',
    enabled: true,
    email: {
      provider: 'resend',
      domain: '',
      from: '',
      to: '',
      subject: DEFAULT_TRIGGER_TEMPLATES.email.subject,
      body: DEFAULT_TRIGGER_TEMPLATES.email.body,
    },
    webhook: {
      method: 'POST',
      url: '',
      content_type: DEFAULT_TRIGGER_TEMPLATES.webhook.contentType,
      body: DEFAULT_TRIGGER_TEMPLATES.webhook.body,
      headers: [],
    },
    telegram: {
      chat_id: '',
      thread_id: '',
      silent: false,
      text: DEFAULT_TRIGGER_TEMPLATES.telegram.text,
    },
    syslog: {
      host: '',
      port: '514',
      transport: 'udp',
      format: 'rfc5424',
      facility: 'user',
      app_name: 'thinker',
      message: DEFAULT_TRIGGER_TEMPLATES.syslog.message,
      severities: { ...DEFAULT_SYSLOG_SEVERITIES },
    },
    secrets: {},
    clearSecrets: [],
    max_retries: String(TRIGGER_LIMITS.maxRetries.default),
    retry_delay_seconds: String(TRIGGER_LIMITS.retryDelaySeconds.default),
    timeout_seconds: String(TRIGGER_LIMITS.timeoutSeconds.default),
    workspace_events: [],
  };
}

/** Editor state for a saved trigger. */
export function formFromTrigger(trigger: TriggerView): TriggerForm {
  const form = emptyForm();
  form.name = trigger.name;
  form.type = trigger.type;
  form.enabled = trigger.enabled;
  form.max_retries = String(trigger.max_retries);
  form.retry_delay_seconds = String(trigger.retry_delay_seconds);
  form.timeout_seconds = String(trigger.timeout_seconds);
  form.workspace_events = [...(trigger.workspace_events ?? [])];
  switch (trigger.type) {
    case 'email': {
      const c = trigger.config as EmailTriggerConfig;
      form.email = {
        provider: c.provider,
        domain: c.domain ?? '',
        from: c.from ?? '',
        to: (c.to ?? []).join(', '),
        subject: c.subject ?? '',
        body: c.body ?? '',
      };
      break;
    }
    case 'webhook': {
      const c = trigger.config as WebhookTriggerConfigView;
      form.webhook = {
        method: c.method,
        url: c.url ?? '',
        content_type: c.content_type ?? '',
        body: c.body ?? '',
        headers: (c.headers ?? []).map((h) => ({
          storedName: h.name,
          hint: h.hint ?? null,
          name: h.name,
          value: '',
        })),
      };
      break;
    }
    case 'telegram': {
      const c = trigger.config as TelegramTriggerConfig;
      form.telegram = {
        chat_id: c.chat_id ?? '',
        thread_id: c.thread_id ?? '',
        silent: !!c.silent,
        text: c.text ?? '',
      };
      break;
    }
    case 'syslog': {
      const c = trigger.config as SyslogTriggerConfig;
      form.syslog = {
        host: c.host ?? '',
        port: String(c.port ?? 514),
        transport: c.transport,
        format: c.format,
        facility: c.facility,
        app_name: c.app_name ?? '',
        message: c.message ?? '',
        severities: { ...DEFAULT_SYSLOG_SEVERITIES, ...(c.severities ?? {}) },
      };
      break;
    }
  }
  return form;
}

/** `ops@x.io, b@x.io;c@x.io` → three addresses. */
export function splitRecipients(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const LIMIT_FIELDS = [
  ['max_retries', TRIGGER_LIMITS.maxRetries],
  ['retry_delay_seconds', TRIGGER_LIMITS.retryDelaySeconds],
  ['timeout_seconds', TRIGGER_LIMITS.timeoutSeconds],
] as const;

/**
 * Client-side checks; the backend validates again and its 400 messages are
 * shown as they come. Keys are field ids of the editor.
 */
export function validateForm(form: TriggerForm, saved: TriggerView | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = t('triggers.editor.errors.nameRequired');
  for (const field of SECRET_FIELDS[form.type]) {
    if (!field.required) continue;
    const typed = (form.secrets[field.key] ?? '').trim();
    const stored = saved && saved.type === form.type ? saved.secrets?.[field.key] : null;
    if (!typed && !stored)
      errors[`secret.${field.key}`] = t('triggers.editor.errors.secretRequired');
  }
  switch (form.type) {
    case 'email':
      if (form.email.provider === 'mailgun' && !form.email.domain.trim())
        errors['email.domain'] = t('triggers.editor.errors.domainRequired');
      break;
    case 'webhook':
      if (!/^https?:\/\/\S+$/i.test(form.webhook.url.trim()))
        errors['webhook.url'] = t('triggers.editor.errors.urlRequired');
      if (
        form.webhook.headers.some(
          (h) => !h.name.trim() || (!h.value && (!h.storedName || h.storedName !== h.name.trim())),
        )
      )
        errors['webhook.headers'] = t('triggers.editor.errors.headerIncomplete');
      break;
    case 'telegram':
      if (!form.telegram.chat_id.trim())
        errors['telegram.chat_id'] = t('triggers.editor.errors.chatIdRequired');
      break;
    case 'syslog': {
      if (!form.syslog.host.trim())
        errors['syslog.host'] = t('triggers.editor.errors.hostRequired');
      const port = Number(form.syslog.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        errors['syslog.port'] = t('triggers.editor.errors.portInvalid');
      break;
    }
  }
  for (const [key, bounds] of LIMIT_FIELDS) {
    const n = Number(form[key]);
    if (form[key].trim() === '' || !Number.isInteger(n) || n < bounds.min || n > bounds.max)
      errors[key] = t('triggers.editor.errors.outOfRange');
  }
  return errors;
}

function configFor(form: TriggerForm): TriggerConfigWrite {
  switch (form.type) {
    case 'email':
      return {
        provider: form.email.provider,
        domain: form.email.domain.trim() || null,
        from: form.email.from.trim() || null,
        to: splitRecipients(form.email.to),
        subject: form.email.subject,
        body: form.email.body,
      };
    case 'webhook':
      return {
        method: form.webhook.method,
        url: form.webhook.url.trim(),
        content_type: form.webhook.content_type.trim(),
        body: form.webhook.body,
        headers: form.webhook.headers.map((h) => {
          const name = h.name.trim();
          // A saved header left blank keeps its stored value.
          return h.value || h.storedName !== name ? { name, value: h.value } : { name };
        }),
      };
    case 'telegram':
      return {
        chat_id: form.telegram.chat_id.trim(),
        thread_id: form.telegram.thread_id.trim() || null,
        silent: form.telegram.silent,
        text: form.telegram.text,
      };
    case 'syslog':
      return {
        host: form.syslog.host.trim(),
        port: Number(form.syslog.port),
        transport: form.syslog.transport,
        format: form.syslog.format,
        facility: form.syslog.facility,
        app_name: form.syslog.app_name.trim(),
        message: form.syslog.message,
        severities: form.syslog.severities,
      };
  }
}

/**
 * The POST/PATCH body. Secrets follow the API: a typed value replaces, null
 * clears, and a field left out keeps what is stored.
 */
export function buildPayload(form: TriggerForm, isCreate: boolean): TriggerWrite {
  const secrets: Record<string, string | null> = {};
  for (const field of SECRET_FIELDS[form.type]) {
    const typed = (form.secrets[field.key] ?? '').trim();
    if (typed) secrets[field.key] = typed;
    else if (!isCreate && form.clearSecrets.includes(field.key)) secrets[field.key] = null;
  }
  return {
    name: form.name.trim(),
    ...(isCreate ? { type: form.type } : {}),
    enabled: form.enabled,
    config: configFor(form),
    ...(Object.keys(secrets).length ? { secrets } : {}),
    max_retries: Number(form.max_retries),
    retry_delay_seconds: Number(form.retry_delay_seconds),
    timeout_seconds: Number(form.timeout_seconds),
    workspace_events: form.workspace_events,
  };
}
