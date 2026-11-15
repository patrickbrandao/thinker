import { getActiveOrganizationId } from '../org-context.js';
import type { LiveEvent, LiveSessionMeta } from 'thinker-shared';
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

/** One page of a session's live-feed events (replay history). */
export interface SessionEventsPage {
  session: LiveSessionMeta;
  events: LiveEvent[];
  next_after: number | null;
}

/** `GET /sessions/:id/events`: the session's events, oldest first, in pages. */
export function getSessionEvents(
  id: string,
  params: { after?: number; until?: number; limit?: number } = {},
) {
  const q: Record<string, string | undefined> = {
    after: params.after != null ? String(params.after) : undefined,
    until: params.until != null ? String(params.until) : undefined,
    limit: params.limit != null ? String(params.limit) : undefined,
  };
  return fetchJson<SessionEventsPage>(`/sessions/${encodeURIComponent(id)}/events`, q, {
    cache: false,
  });
}

/** URL of the session's live SSE feed (`GET /sessions/:id/live`). */
/**
 * EventSource cannot send headers, so the active organization travels as
 * `?organization=` (the backend accepts it on this route only, with the same
 * membership check as the header).
 */
export function sessionLiveUrl(id: string, lastEventId?: number | null): string {
  const params = new URLSearchParams();
  const org = getActiveOrganizationId();
  if (org) params.set('organization', org);
  if (lastEventId) params.set('lastEventId', String(lastEventId));
  const qs = params.toString();
  return `/api/v1/sessions/${encodeURIComponent(id)}/live${qs ? `?${qs}` : ''}`;
}
