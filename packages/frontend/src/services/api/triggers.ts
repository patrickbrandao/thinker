import type {
  EmailTriggerProvider,
  HarnessTriggerEvent,
  SyslogFacility,
  SyslogFormat,
  SyslogSeverity,
  SyslogTransport,
  TriggerEventStatus,
  TriggerEventType,
  TriggerType,
  WebhookMethod,
  WorkspaceTriggerEvent,
} from 'thinker-shared';
import { fetchJson, fetchMutate } from './core.js';

/** Workspace delivery targets (e-mail, webhook, Telegram, syslog) and their delivery log. */

export interface EmailTriggerConfig {
  provider: EmailTriggerProvider;
  domain: string | null;
  from: string | null;
  /** Empty means the workspace owner's e-mail. */
  to: string[];
  subject: string;
  body: string;
}

export interface WebhookTriggerConfigView {
  method: WebhookMethod;
  url: string;
  content_type: string;
  body: string;
  /** Values are masked: `hint` is a short preview. */
  headers: Array<{ name: string; hint: string | null }>;
}

export interface WebhookTriggerConfigWrite extends Omit<WebhookTriggerConfigView, 'headers'> {
  /** Omitting `value` keeps the stored value for that header name. */
  headers: Array<{ name: string; value?: string }>;
}

export interface TelegramTriggerConfig {
  chat_id: string;
  thread_id: string | null;
  silent: boolean;
  text: string;
}

export interface SyslogTriggerConfig {
  host: string;
  port: number;
  transport: SyslogTransport;
  format: SyslogFormat;
  facility: SyslogFacility;
  app_name: string;
  message: string;
  severities: Record<string, SyslogSeverity>;
}

export type TriggerConfigView =
  EmailTriggerConfig | WebhookTriggerConfigView | TelegramTriggerConfig | SyslogTriggerConfig;

export type TriggerConfigWrite =
  EmailTriggerConfig | WebhookTriggerConfigWrite | TelegramTriggerConfig | SyslogTriggerConfig;

export interface TriggerView {
  id: string;
  name: string;
  type: TriggerType;
  enabled: boolean;
  config: TriggerConfigView;
  /** Masked hints like "re_ab12…"; null when not set. */
  secrets: Record<string, string | null>;
  max_retries: number;
  retry_delay_seconds: number;
  timeout_seconds: number;
  workspace_events: WorkspaceTriggerEvent[];
  harness_count: number;
  created_at: string;
  updated_at: string;
}

export interface TriggerWrite {
  name?: string;
  type?: TriggerType;
  enabled?: boolean;
  config?: TriggerConfigWrite;
  /** Non-empty string replaces, null clears, an absent field keeps. */
  secrets?: Record<string, string | null>;
  max_retries?: number;
  retry_delay_seconds?: number;
  timeout_seconds?: number;
  workspace_events?: WorkspaceTriggerEvent[];
}

export interface TriggerTestResult {
  success: boolean;
  status_code: number | null;
  error: string | null;
  response: string | null;
  duration_ms: number;
}

export interface TriggerEventItem {
  id: string;
  trigger_id: string | null;
  trigger_name: string;
  trigger_type: TriggerType;
  event_type: TriggerEventType;
  agent_name: string | null;
  status: TriggerEventStatus;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

export interface TriggerDeliveryLog {
  id: string;
  attempt: number;
  started_at: string;
  duration_ms: number;
  success: boolean;
  status_code: number | null;
  error: string | null;
  response: string | null;
}

export interface TriggerEventDetail {
  event: TriggerEventItem & { payload: Record<string, string> };
  logs: TriggerDeliveryLog[];
}

export interface TriggerEventFilters {
  trigger_id?: string;
  status?: string;
  event_type?: string;
  agent_name?: string;
  /** `created_at` of the last row already shown. */
  before?: string;
  limit?: number;
}

export interface HarnessTriggerBinding {
  trigger_id: string;
  events: HarnessTriggerEvent[];
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const id = (value: string) => encodeURIComponent(value);

export async function listTriggers(): Promise<TriggerView[]> {
  return (await fetchJson<{ triggers: TriggerView[] }>('/triggers', undefined, { cache: false }))
    .triggers;
}

export function createTrigger(data: TriggerWrite) {
  return fetchMutate<TriggerView>('/triggers', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
}

export function updateTrigger(triggerId: string, data: TriggerWrite) {
  return fetchMutate<TriggerView>(`/triggers/${id(triggerId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
}

export function deleteTrigger(triggerId: string) {
  return fetchMutate<{ deleted: true }>(`/triggers/${id(triggerId)}`, { method: 'DELETE' });
}

export function testTrigger(triggerId: string) {
  return fetchMutate<TriggerTestResult>(`/triggers/${id(triggerId)}/test`, { method: 'POST' });
}

export async function listTriggerEvents(filters: TriggerEventFilters = {}) {
  const params: Record<string, string | undefined> = {
    trigger_id: filters.trigger_id,
    status: filters.status,
    event_type: filters.event_type,
    agent_name: filters.agent_name,
    before: filters.before,
    limit: String(filters.limit ?? 50),
  };
  return (
    await fetchJson<{ events: TriggerEventItem[] }>('/triggers/events', params, { cache: false })
  ).events;
}

export function getTriggerEvent(eventId: string) {
  return fetchJson<TriggerEventDetail>(`/triggers/events/${id(eventId)}`, undefined, {
    cache: false,
  });
}

export function retryTriggerEvent(eventId: string) {
  return fetchMutate<{ ok: true }>(`/triggers/events/${id(eventId)}/retry`, { method: 'POST' });
}

export async function getHarnessTriggers(agentName: string): Promise<HarnessTriggerBinding[]> {
  return (
    await fetchJson<{ bindings: HarnessTriggerBinding[] }>(
      `/agents/${id(agentName)}/triggers`,
      undefined,
      { cache: false },
    )
  ).bindings;
}

export async function setHarnessTriggers(
  agentName: string,
  bindings: HarnessTriggerBinding[],
): Promise<HarnessTriggerBinding[]> {
  const res = await fetchMutate<{ bindings: HarnessTriggerBinding[] }>(
    `/agents/${id(agentName)}/triggers`,
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ bindings }) },
  );
  return res.bindings;
}
