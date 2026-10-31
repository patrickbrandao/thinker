import {
  DEFAULT_SYSLOG_SEVERITIES,
  DEFAULT_TRIGGER_TEMPLATES,
  EMAIL_TRIGGER_PROVIDERS,
  SYSLOG_FACILITIES,
  SYSLOG_FORMATS,
  SYSLOG_SEVERITIES,
  SYSLOG_TRANSPORTS,
  TRIGGER_LIMITS,
  TRIGGER_TYPES,
  WEBHOOK_METHODS,
  WORKSPACE_TRIGGER_EVENTS,
  type TriggerType,
} from 'thinker-shared';
import { DOMAIN_RE } from '../notifications/services/email-provider-validation';

/** Secrets kept in `triggers.secrets_encrypted`, by type. */
export interface TriggerSecrets {
  apiKey?: string;
  botToken?: string;
  hmacSecret?: string;
  headers?: Record<string, string>;
}

export type TriggerConfig = Record<string, unknown>;

export interface TriggerInput {
  name?: unknown;
  type?: unknown;
  enabled?: unknown;
  config?: unknown;
  secrets?: unknown;
  max_retries?: unknown;
  retry_delay_seconds?: unknown;
  timeout_seconds?: unknown;
  workspace_events?: unknown;
}

export interface NormalizedTrigger {
  name: string;
  type: TriggerType;
  enabled: boolean;
  config: TriggerConfig;
  secrets: TriggerSecrets;
  max_retries: number;
  retry_delay_seconds: number;
  timeout_seconds: number;
  workspace_events: string[];
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/;
const MAX_TEMPLATE = 20_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function template(value: unknown, fallback: string, field: string, errors: string[]): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    errors.push(`${field} must be a string`);
    return fallback;
  }
  if (value.length > MAX_TEMPLATE) errors.push(`${field} is too long`);
  return value;
}

function boundedInt(
  value: unknown,
  bounds: { min: number; max: number; default: number },
  field: string,
  errors: string[],
): number {
  if (value === undefined || value === null) return bounds.default;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push(`${field} must be an integer`);
    return bounds.default;
  }
  if (value < bounds.min || value > bounds.max) {
    errors.push(`${field} must be between ${bounds.min} and ${bounds.max}`);
  }
  return value;
}

/**
 * Secret patch semantics: a non-empty string replaces, null clears, absent
 * keeps what is stored.
 */
function patchSecret(
  patch: Record<string, unknown>,
  key: 'apiKey' | 'botToken' | 'hmacSecret',
  current: TriggerSecrets,
  next: TriggerSecrets,
): void {
  if (!(key in patch)) {
    if (current[key]) next[key] = current[key];
    return;
  }
  const value = patch[key];
  if (typeof value === 'string' && value.trim()) next[key] = value.trim();
}

/**
 * Validates a create (no `existing`) or a partial update merged over the
 * stored trigger. Returns the full normalized trigger or the list of errors.
 */
export function normalizeTrigger(
  input: TriggerInput,
  existing?: NormalizedTrigger,
): { value: NormalizedTrigger } | { errors: string[] } {
  const errors: string[] = [];

  const type = (existing?.type ?? input.type) as TriggerType;
  if (!TRIGGER_TYPES.includes(type)) {
    return { errors: [`type must be one of ${TRIGGER_TYPES.join(', ')}`] };
  }

  const name = input.name === undefined && existing ? existing.name : str(input.name);
  if (!name) errors.push('name is required');
  else if (name.length > 100) errors.push('name must be at most 100 characters');

  const enabled =
    input.enabled === undefined ? (existing?.enabled ?? true) : input.enabled === true;

  const max_retries = boundedInt(
    input.max_retries ?? existing?.max_retries,
    TRIGGER_LIMITS.maxRetries,
    'max_retries',
    errors,
  );
  const retry_delay_seconds = boundedInt(
    input.retry_delay_seconds ?? existing?.retry_delay_seconds,
    TRIGGER_LIMITS.retryDelaySeconds,
    'retry_delay_seconds',
    errors,
  );
  const timeout_seconds = boundedInt(
    input.timeout_seconds ?? existing?.timeout_seconds,
    TRIGGER_LIMITS.timeoutSeconds,
    'timeout_seconds',
    errors,
  );

  let workspace_events = existing?.workspace_events ?? [];
  if (input.workspace_events !== undefined) {
    if (
      !Array.isArray(input.workspace_events) ||
      input.workspace_events.some(
        (e) => !(WORKSPACE_TRIGGER_EVENTS as readonly unknown[]).includes(e),
      )
    ) {
      errors.push(`workspace_events must only contain ${WORKSPACE_TRIGGER_EVENTS.join(', ')}`);
    } else {
      workspace_events = [...new Set(input.workspace_events as string[])];
    }
  }

  if (input.config !== undefined && !isObject(input.config))
    errors.push('config must be an object');
  if (input.secrets !== undefined && input.secrets !== null && !isObject(input.secrets)) {
    errors.push('secrets must be an object');
  }
  const configIn: Record<string, unknown> = {
    ...(existing?.config ?? {}),
    ...(isObject(input.config) ? input.config : {}),
  };
  const secretPatch = isObject(input.secrets) ? input.secrets : {};
  const current = existing?.secrets ?? {};
  const secrets: TriggerSecrets = {};
  let config: TriggerConfig = {};

  switch (type) {
    case 'email': {
      const provider = str(configIn.provider);
      if (!(EMAIL_TRIGGER_PROVIDERS as readonly string[]).includes(provider)) {
        errors.push(`config.provider must be one of ${EMAIL_TRIGGER_PROVIDERS.join(', ')}`);
      }
      const domain = str(configIn.domain).toLowerCase() || null;
      if (domain && !DOMAIN_RE.test(domain)) errors.push('config.domain is not a valid domain');
      if (provider === 'mailgun' && !domain) errors.push('config.domain is required for Mailgun');
      const from = str(configIn.from) || null;
      const toRaw = configIn.to ?? [];
      const to = Array.isArray(toRaw)
        ? [...new Set(toRaw.map((v) => str(v).toLowerCase()).filter(Boolean))]
        : [];
      if (!Array.isArray(toRaw)) errors.push('config.to must be a list of e-mail addresses');
      for (const addr of to) if (!EMAIL_RE.test(addr)) errors.push(`invalid e-mail: ${addr}`);
      if (to.length > 20) errors.push('config.to accepts at most 20 addresses');
      patchSecret(secretPatch, 'apiKey', current, secrets);
      if (!secrets.apiKey) errors.push('secrets.apiKey is required');
      config = {
        provider,
        domain,
        from,
        to,
        subject: template(
          configIn.subject,
          DEFAULT_TRIGGER_TEMPLATES.email.subject,
          'config.subject',
          errors,
        ),
        body: template(configIn.body, DEFAULT_TRIGGER_TEMPLATES.email.body, 'config.body', errors),
      };
      break;
    }
    case 'webhook': {
      const method = str(configIn.method).toUpperCase() || 'POST';
      if (!(WEBHOOK_METHODS as readonly string[]).includes(method)) {
        errors.push(`config.method must be one of ${WEBHOOK_METHODS.join(', ')}`);
      }
      const url = str(configIn.url);
      if (!/^https?:\/\/[^\s/]+/i.test(url)) errors.push('config.url must be an http(s) URL');
      const headers: Record<string, string> = {};
      const names: string[] = [];
      const headersIn = configIn.headers ?? [];
      if (!Array.isArray(headersIn)) errors.push('config.headers must be a list');
      else {
        for (const entry of headersIn) {
          if (!isObject(entry)) continue;
          const headerName = str(entry.name);
          if (!HEADER_NAME_RE.test(headerName)) {
            errors.push(`invalid header name: ${headerName || '(empty)'}`);
            continue;
          }
          const value =
            typeof entry.value === 'string' && entry.value !== ''
              ? entry.value
              : (current.headers?.[headerName] ?? undefined);
          if (value === undefined) {
            errors.push(`header ${headerName} needs a value`);
            continue;
          }
          if (/[\r\n]/.test(value)) errors.push(`header ${headerName} must be a single line`);
          if (!names.includes(headerName)) names.push(headerName);
          headers[headerName] = value;
        }
      }
      if (names.length > 30) errors.push('at most 30 headers');
      secrets.headers = headers;
      patchSecret(secretPatch, 'hmacSecret', current, secrets);
      config = {
        method,
        url,
        content_type: str(configIn.content_type) || DEFAULT_TRIGGER_TEMPLATES.webhook.contentType,
        body: template(
          configIn.body,
          DEFAULT_TRIGGER_TEMPLATES.webhook.body,
          'config.body',
          errors,
        ),
        headers: names.map((n) => ({ name: n })),
      };
      break;
    }
    case 'telegram': {
      const chatId = str(configIn.chat_id);
      if (!/^(-?\d+|@[A-Za-z0-9_]{5,})$/.test(chatId)) {
        errors.push('config.chat_id must be a numeric chat id or an @channel username');
      }
      const threadId = str(configIn.thread_id) || null;
      if (threadId && !/^\d+$/.test(threadId)) errors.push('config.thread_id must be numeric');
      patchSecret(secretPatch, 'botToken', current, secrets);
      if (!secrets.botToken) errors.push('secrets.botToken is required');
      else if (!/^\d+:[A-Za-z0-9_-]+$/.test(secrets.botToken)) {
        errors.push('secrets.botToken does not look like a Telegram bot token');
      }
      config = {
        chat_id: chatId,
        thread_id: threadId,
        silent: configIn.silent === true,
        text: template(
          configIn.text,
          DEFAULT_TRIGGER_TEMPLATES.telegram.text,
          'config.text',
          errors,
        ),
      };
      break;
    }
    case 'syslog': {
      const host = str(configIn.host);
      if (!host || /[\s/]/.test(host)) errors.push('config.host is required');
      const port = configIn.port ?? 514;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push('config.port must be between 1 and 65535');
      }
      const transport = str(configIn.transport) || 'udp';
      if (!(SYSLOG_TRANSPORTS as readonly string[]).includes(transport)) {
        errors.push('config.transport must be udp or tcp');
      }
      const format = str(configIn.format) || 'rfc5424';
      if (!(SYSLOG_FORMATS as readonly string[]).includes(format)) {
        errors.push('config.format must be rfc5424 or rfc3164');
      }
      const facility = str(configIn.facility) || 'local0';
      if (!(SYSLOG_FACILITIES as readonly string[]).includes(facility)) {
        errors.push('config.facility is not a syslog facility');
      }
      const appName = str(configIn.app_name) || 'thinker';
      if (!/^[\x21-\x7e]{1,48}$/.test(appName)) errors.push('config.app_name is invalid');
      const severities: Record<string, string> = { ...DEFAULT_SYSLOG_SEVERITIES };
      if (isObject(configIn.severities)) {
        for (const [key, value] of Object.entries(configIn.severities)) {
          if (!(key in DEFAULT_SYSLOG_SEVERITIES)) continue;
          if (!(SYSLOG_SEVERITIES as readonly unknown[]).includes(value)) {
            errors.push(`severity for ${key} is invalid`);
          } else severities[key] = value as string;
        }
      }
      config = {
        host,
        port,
        transport,
        format,
        facility,
        app_name: appName,
        message: template(
          configIn.message,
          DEFAULT_TRIGGER_TEMPLATES.syslog.message,
          'config.message',
          errors,
        ),
        severities,
      };
      break;
    }
  }

  if (errors.length > 0) return { errors };
  return {
    value: {
      name,
      type,
      enabled,
      config,
      secrets,
      max_retries,
      retry_delay_seconds,
      timeout_seconds,
      workspace_events,
    },
  };
}

function hint(secret: string | undefined): string | null {
  if (!secret) return null;
  return secret.length <= 8 ? '••••' : `${secret.slice(0, 6)}…`;
}

/** Public config: secrets reduced to hints, webhook header values masked. */
export function publicView(
  config: TriggerConfig,
  secrets: TriggerSecrets,
  type: TriggerType,
): { config: TriggerConfig; secrets: Record<string, string | null> } {
  switch (type) {
    case 'email':
      return { config: stripInternal(config), secrets: { apiKey: hint(secrets.apiKey) } };
    case 'telegram':
      return { config: stripInternal(config), secrets: { botToken: hint(secrets.botToken) } };
    case 'webhook': {
      const headers = Array.isArray(config.headers)
        ? (config.headers as Array<{ name: string }>).map((h) => ({
            name: h.name,
            hint: maskHeader(secrets.headers?.[h.name]),
          }))
        : [];
      return {
        config: { ...stripInternal(config), headers },
        secrets: { hmacSecret: hint(secrets.hmacSecret) },
      };
    }
    default:
      return { config: stripInternal(config), secrets: {} };
  }
}

/** Drops bookkeeping keys (the migration's `key_hint`) from the public config. */
function stripInternal(config: TriggerConfig): TriggerConfig {
  const rest = { ...config };
  delete rest.key_hint;
  return rest;
}

function maskHeader(value: string | undefined): string {
  if (!value) return '';
  return value.length <= 6 ? '••••' : `${value.slice(0, 4)}…`;
}
