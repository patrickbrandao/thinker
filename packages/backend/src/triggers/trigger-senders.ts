import { createHmac } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { connect } from 'node:net';
import { hostname } from 'node:os';
import { render } from '@react-email/render';
import {
  DEFAULT_SYSLOG_SEVERITIES,
  SYSLOG_FACILITIES,
  SYSLOG_SEVERITIES,
  type TriggerType,
} from 'thinker-shared';
import { ssrfSafeFetch } from '../common/utils/ssrf-safe-fetch';
import { ThresholdAlertEmail } from '../notifications/emails/threshold-alert';
import { TriggerEventEmail } from '../notifications/emails/trigger-event';
import { renderTemplate, type TemplateVars } from './trigger-template';
import type { TriggerConfig, TriggerSecrets } from './trigger-config';

export interface DeliveryResult {
  success: boolean;
  statusCode: number | null;
  error: string | null;
  response: string | null;
}

export interface DeliveryInput {
  type: TriggerType;
  config: TriggerConfig;
  secrets: TriggerSecrets;
  eventType: string;
  vars: TemplateVars;
  timeoutMs: number;
  /** Sender used when an e-mail trigger has no `from`. */
  defaultFrom: string;
  /** Recipient used when an e-mail trigger has no `to` (the workspace owner). */
  fallbackRecipient: () => Promise<string | null>;
}

export const MAX_RESPONSE_CHARS = 4096;

function truncate(text: string, max = MAX_RESPONSE_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Timed out';
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message}: ${cause.message}` : err.message;
  }
  return String(err);
}

/** Removes a secret from any text we keep (errors and responses are logged). */
function redact(text: string | null, secrets: Array<string | undefined>): string | null {
  if (text === null) return null;
  let out = text;
  // Short values would mangle ordinary text; real tokens and keys are longer.
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}

async function httpCall(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  secrets: Array<string | undefined> = [],
): Promise<DeliveryResult> {
  try {
    // Webhook URLs are tenant-supplied: never reach cloud metadata, even
    // through a name that resolves there at connect time (DNS rebinding).
    const res = await ssrfSafeFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = truncate(await res.text().catch(() => ''));
    return {
      success: res.ok,
      statusCode: res.status,
      error: res.ok ? null : redact(`HTTP ${res.status}`, secrets),
      response: redact(text, secrets),
    };
  } catch (err) {
    return {
      success: false,
      statusCode: null,
      error: redact(describe(err), secrets),
      response: null,
    };
  }
}

export async function deliver(input: DeliveryInput): Promise<DeliveryResult> {
  switch (input.type) {
    case 'webhook':
      return deliverWebhook(input);
    case 'telegram':
      return deliverTelegram(input);
    case 'email':
      return deliverEmail(input);
    case 'syslog':
      return deliverSyslog(input);
  }
}

async function deliverWebhook({ config, secrets, vars, timeoutMs, eventType }: DeliveryInput) {
  const method = String(config.method ?? 'POST');
  const contentType = String(config.content_type ?? 'application/json');
  const url = renderTemplate(String(config.url ?? ''), vars, 'url');
  const headers: Record<string, string> = {
    'User-Agent': 'Thinker-Triggers',
    'X-Thinker-Event': eventType,
    'X-Thinker-Delivery': vars['event.id'] ?? '',
  };
  for (const [name, value] of Object.entries(secrets.headers ?? {})) {
    headers[name] = renderTemplate(value, vars, 'line');
  }
  let body: string | undefined;
  if (method !== 'GET') {
    body = renderTemplate(
      String(config.body ?? ''),
      vars,
      /json/i.test(contentType) ? 'json' : 'raw',
    );
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = contentType;
    }
  }
  if (secrets.hmacSecret) {
    const signature = createHmac('sha256', secrets.hmacSecret)
      .update(body ?? '')
      .digest('hex');
    headers['X-Thinker-Signature'] = `sha256=${signature}`;
  }
  return httpCall(url, { method, headers, body, redirect: 'manual' }, timeoutMs, [
    ...Object.values(secrets.headers ?? {}),
    secrets.hmacSecret,
  ]);
}

const TELEGRAM_MAX = 4096;

async function deliverTelegram({ config, secrets, vars, timeoutMs }: DeliveryInput) {
  const text = renderTemplate(String(config.text ?? ''), vars, 'html');
  const payload: Record<string, unknown> = {
    chat_id: config.chat_id,
    text: text.length > TELEGRAM_MAX ? `${text.slice(0, TELEGRAM_MAX - 1)}…` : text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    disable_notification: config.silent === true,
  };
  if (config.thread_id) payload.message_thread_id = Number(config.thread_id);
  const result = await httpCall(
    `https://api.telegram.org/bot${secrets.botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    timeoutMs,
    [secrets.botToken],
  );
  if (!result.success && result.response) {
    try {
      const parsed = JSON.parse(result.response) as { description?: string };
      if (parsed.description) result.error = `${result.error}: ${parsed.description}`;
    } catch {
      // Not JSON: keep the HTTP status as the error.
    }
  }
  return result;
}

const EMAIL_BADGES: Record<string, string> = {
  'provider.failure': 'Provider failure',
  'credential.expired': 'Credential expired',
  'request.debug': 'Request',
  'harness.created': 'Harness created',
  'harness.deleted': 'Harness deleted',
  test: 'Test',
};

async function emailHtml(eventType: string, vars: TemplateVars, text: string) {
  if (eventType === 'limit.alert' || eventType === 'limit.block') {
    // The rich limit layout already says what `event.message` says; only a
    // customized body adds a note under it.
    const note = text.trim() === (vars['event.message'] ?? '').trim() ? undefined : text;
    return ThresholdAlertEmail({
      agentName: vars['harness.display_name'] || vars['harness.name'] || '',
      metricType: vars['rule.metric'] === 'cost' ? 'cost' : 'tokens',
      threshold: Number(vars['rule.threshold'] ?? 0),
      actualValue: Number(vars['value.actual'] ?? 0),
      period: vars['rule.period'] ?? '',
      timestamp: (vars['event.timestamp'] ?? '').replace('T', ' ').slice(0, 19),
      agentUrl: vars['harness.url'] ?? '',
      alertType: eventType === 'limit.alert' ? 'soft' : 'hard',
      periodResetDate: vars['period.reset'] || undefined,
      note,
    });
  }
  return TriggerEventEmail({
    badge: EMAIL_BADGES[eventType] ?? eventType,
    title: vars['event.title'] ?? eventType,
    text,
    timestamp: vars['event.timestamp'] ?? '',
    url: vars['request.url'] || vars['harness.url'] || undefined,
  });
}

async function deliverEmail(input: DeliveryInput): Promise<DeliveryResult> {
  const { config, secrets, vars, timeoutMs, eventType } = input;
  let to = Array.isArray(config.to) ? (config.to as string[]) : [];
  if (to.length === 0) {
    const fallback = await input.fallbackRecipient();
    if (!fallback) {
      return {
        success: false,
        statusCode: null,
        error: 'No recipient: the trigger has no addresses and the workspace owner has no e-mail',
        response: null,
      };
    }
    to = [fallback];
  }
  const subject = renderTemplate(String(config.subject ?? ''), vars, 'line');
  const text = renderTemplate(String(config.body ?? ''), vars, 'raw');
  const element = await emailHtml(eventType, vars, text);
  const html = await render(element);
  const plain = await render(element, { plainText: true });
  const domain = typeof config.domain === 'string' ? config.domain : null;
  const from =
    (typeof config.from === 'string' && config.from) ||
    (domain ? `Thinker <noreply@${domain}>` : `Thinker <${input.defaultFrom}>`);
  const apiKey = secrets.apiKey ?? '';

  switch (config.provider) {
    case 'resend':
      return httpCall(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, subject, html, text: plain }),
        },
        timeoutMs,
        [apiKey],
      );
    case 'sendgrid': {
      const match = from.match(/^(.*)<(.+)>$/);
      const fromObj = match
        ? { email: match[2].trim(), name: match[1].trim() || undefined }
        : { email: from };
      return httpCall(
        'https://api.sendgrid.com/v3/mail/send',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: to.map((email) => ({ email })) }],
            from: fromObj,
            subject,
            content: [
              { type: 'text/plain', value: plain },
              { type: 'text/html', value: html },
            ],
          }),
        },
        timeoutMs,
        [apiKey],
      );
    }
    case 'mailgun': {
      const form = new URLSearchParams();
      form.append('from', from);
      form.append('to', to.join(','));
      form.append('subject', subject);
      form.append('html', html);
      form.append('text', plain);
      form.append('o:tag', 'thinker');
      return httpCall(
        `https://api.mailgun.net/v3/${encodeURIComponent(domain ?? '')}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
          },
          body: form,
        },
        timeoutMs,
        [apiKey],
      );
    }
    default:
      return {
        success: false,
        statusCode: null,
        error: `Unknown e-mail provider ${String(config.provider)}`,
        response: null,
      };
  }
}

/** Severity for an event, honoring the per-trigger map. */
export function syslogSeverity(
  config: TriggerConfig,
  eventType: string,
  vars: TemplateVars,
): number {
  const severities = (config.severities ?? {}) as Record<string, string>;
  const key =
    eventType === 'request.debug' && vars['request.status'] && vars['request.status'] !== 'success'
      ? 'request.debug.failed'
      : eventType;
  const name = severities[key] ?? DEFAULT_SYSLOG_SEVERITIES[key] ?? 'info';
  const index = (SYSLOG_SEVERITIES as readonly string[]).indexOf(name);
  return index >= 0 ? index : 6;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sdEscape(value: string): string {
  return value.replace(/[\\"\]]/g, (c) => `\\${c}`);
}

/** Builds one syslog line (no trailing newline). */
export function formatSyslog(
  config: TriggerConfig,
  eventType: string,
  vars: TemplateVars,
  now = new Date(),
): string {
  const facility = Math.max(
    0,
    (SYSLOG_FACILITIES as readonly string[]).indexOf(String(config.facility)),
  );
  const pri = facility * 8 + syslogSeverity(config, eventType, vars);
  const host = hostname().replace(/\s+/g, '-') || '-';
  const app = String(config.app_name || 'thinker');
  const msg = renderTemplate(String(config.message ?? ''), vars, 'line');
  if (config.format === 'rfc3164') {
    const day = String(now.getDate()).padStart(2, ' ');
    const time = now.toTimeString().slice(0, 8);
    return `<${pri}>${MONTHS[now.getMonth()]} ${day} ${time} ${host} ${app}[${process.pid}]: ${msg}`;
  }
  const sd =
    `[thinker@32473 event="${sdEscape(eventType)}"` +
    (vars['harness.name'] ? ` harness="${sdEscape(vars['harness.name'])}"` : '') +
    (vars['workspace.id'] ? ` workspace="${sdEscape(vars['workspace.id'])}"` : '') +
    ']';
  const msgId = eventType.replace(/[^\x21-\x7e]/g, '').slice(0, 32) || '-';
  return `<${pri}>1 ${now.toISOString()} ${host} ${app} ${process.pid} ${msgId} ${sd} ${msg}`;
}

function deliverSyslog({
  config,
  vars,
  timeoutMs,
  eventType,
}: DeliveryInput): Promise<DeliveryResult> {
  const line = formatSyslog(config, eventType, vars);
  const host = String(config.host);
  const port = Number(config.port);
  const target = `${host}:${port}`;
  const ok = (via: string): DeliveryResult => ({
    success: true,
    statusCode: null,
    error: null,
    response: `Sent ${Buffer.byteLength(line)} bytes via ${via} to ${target}`,
  });
  const fail = (err: unknown): DeliveryResult => ({
    success: false,
    statusCode: null,
    error: describe(err),
    response: null,
  });

  return new Promise((resolve) => {
    if (config.transport === 'tcp') {
      const socket = connect({ host, port });
      let settled = false;
      const done = (result: DeliveryResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeoutMs, () =>
        done(fail(new Error(`Timed out connecting to ${target}`))),
      );
      socket.on('error', (err) => done(fail(err)));
      socket.on('connect', () => {
        socket.end(`${line}\n`, () => done(ok('tcp')));
      });
      return;
    }
    const socket = createSocket(host.includes(':') ? 'udp6' : 'udp4');
    const timer = setTimeout(() => {
      socket.close();
      resolve(fail(new Error(`Timed out sending to ${target}`)));
    }, timeoutMs);
    socket.send(Buffer.from(line), port, host, (err) => {
      clearTimeout(timer);
      socket.close();
      resolve(err ? fail(err) : ok('udp'));
    });
  });
}
