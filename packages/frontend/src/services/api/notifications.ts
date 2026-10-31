import { fetchJson, fetchMutate } from './core.js';

export interface NotificationRule {
  id: string;
  agent_name: string;
  metric_type: 'tokens' | 'cost';
  threshold: number;
  period: 'hour' | 'day' | 'week' | 'month';
  action: 'notify' | 'block' | 'both';
  is_active: boolean;
  trigger_count: number;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  sent_at: string;
  actual_value: number;
  threshold_value: number;
  metric_type: 'tokens' | 'cost';
  period_start: string;
  period_end: string;
  agent_name: string;
}

export function getNotificationLogs(agentName: string) {
  return fetchJson<NotificationLog[]>('/notifications/logs', { agent_name: agentName });
}

export function getNotificationRules(agentName: string) {
  return fetchJson<NotificationRule[]>('/notifications', { agent_name: agentName });
}

export function createNotificationRule(data: {
  agent_name: string;
  metric_type: string;
  threshold: number;
  period: string;
  action?: string;
}) {
  return fetchMutate('/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function updateNotificationRule(id: string, data: Record<string, unknown>) {
  return fetchMutate(`/notifications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteNotificationRule(id: string) {
  return fetchMutate(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
