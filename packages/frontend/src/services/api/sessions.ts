import { fetchJson } from './core.js';

/** A harness session (subagent sessions folded into their main session). */
export interface SessionSummary {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  started_at: string;
  last_at: string;
  requests: number;
  failed: number;
  in_flight: number;
  subagents: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost: number;
  models: string[];
  providers: string[];
}

export interface SessionPart {
  session_id: string;
  is_main: boolean;
  started_at: string;
  last_at: string;
  requests: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export interface SessionDetail extends SessionSummary {
  parent_session_id: string | null;
  parts: SessionPart[];
  client: { user_agent: string | null; project: string | null; client: string | null } | null;
}

/** One session in one period of the bubble chart. */
export interface TimelinePoint {
  session_id: string;
  agent_name: string | null;
  bucket: string;
  requests: number;
  failed: number;
  cost: number;
}

export interface SessionsTimeline {
  bucket: 'hour' | 'day' | 'week';
  from: string | null;
  points: TimelinePoint[];
  total_sessions: number;
  shown_sessions: number;
}

export type SessionFilters = {
  range?: string;
  agent_name?: string;
  has_errors?: string;
  has_subagents?: string;
};

export function getSessions(params: SessionFilters & { limit?: string; offset?: string }) {
  return fetchJson<{ items: SessionSummary[]; has_more: boolean }>('/sessions', params, {
    cache: false,
  });
}

export function getSession(id: string) {
  return fetchJson<SessionDetail>(`/sessions/${encodeURIComponent(id)}`, undefined, {
    cache: false,
  });
}

export function getSessionsTimeline(params: SessionFilters) {
  return fetchJson<SessionsTimeline>('/sessions/timeline', params, { cache: false });
}
