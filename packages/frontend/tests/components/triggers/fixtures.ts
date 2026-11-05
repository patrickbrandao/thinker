import type {
  TriggerDeliveryLog,
  TriggerEventDetail,
  TriggerEventItem,
  TriggerView,
} from '../../../src/services/api/triggers';

const base = {
  enabled: true,
  max_retries: 3,
  retry_delay_seconds: 30,
  timeout_seconds: 10,
  workspace_events: [],
  harness_count: 0,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

export const webhookTrigger = (over: Partial<TriggerView> = {}): TriggerView => ({
  ...base,
  id: 't1',
  name: 'ops-hook',
  type: 'webhook',
  config: {
    method: 'POST',
    url: 'https://x.io/h',
    content_type: 'application/json',
    body: '{{event.json}}',
    headers: [{ name: 'Authorization', hint: 'Bea…' }],
  },
  secrets: { hmacSecret: 'abc…' },
  ...over,
});

export const emailTrigger = (over: Partial<TriggerView> = {}): TriggerView => ({
  ...base,
  id: 't2',
  name: 'ops-mail',
  type: 'email',
  config: {
    provider: 'mailgun',
    domain: 'mg.example.com',
    from: 'alerts@mg.example.com',
    to: ['a@x.io', 'b@x.io'],
    subject: 'Subject {{event.title}}',
    body: 'Body',
  },
  secrets: { apiKey: 'key-ab…' },
  ...over,
});

export const telegramTrigger = (over: Partial<TriggerView> = {}): TriggerView => ({
  ...base,
  id: 't3',
  name: 'ops-chat',
  type: 'telegram',
  config: { chat_id: '-100123', thread_id: null, silent: true, text: 'Hello' },
  secrets: { botToken: '1234…' },
  ...over,
});

export const syslogTrigger = (over: Partial<TriggerView> = {}): TriggerView => ({
  ...base,
  id: 't4',
  name: 'ops-syslog',
  type: 'syslog',
  config: {
    host: 'logs.example.com',
    port: 6514,
    transport: 'tcp',
    format: 'rfc5424',
    facility: 'user',
    app_name: 'thinker',
    message: 'm',
    severities: { 'limit.alert': 'crit' },
  },
  secrets: {},
  ...over,
});

export const eventItem = (over: Partial<TriggerEventItem> = {}): TriggerEventItem => ({
  id: 'e1',
  trigger_id: 't1',
  trigger_name: 'ops-hook',
  trigger_type: 'webhook',
  event_type: 'limit.alert',
  agent_name: 'my-bot',
  status: 'delivered',
  attempts: 1,
  next_attempt_at: null,
  last_error: null,
  created_at: '2026-10-02T10:00:00.000Z',
  delivered_at: '2026-10-02T10:00:01.000Z',
  ...over,
});

export const deliveryLog = (over: Partial<TriggerDeliveryLog> = {}): TriggerDeliveryLog => ({
  id: 'log1',
  attempt: 1,
  started_at: '2026-10-02T10:00:00.000Z',
  duration_ms: 250,
  success: true,
  status_code: 200,
  error: null,
  response: null,
  ...over,
});

export const eventDetail = (
  event: Partial<TriggerEventItem> = {},
  logs: TriggerDeliveryLog[] = [deliveryLog()],
  payload: Record<string, string> = { 'event.title': 'Limit exceeded' },
): TriggerEventDetail => ({ event: { ...eventItem(event), payload }, logs });
