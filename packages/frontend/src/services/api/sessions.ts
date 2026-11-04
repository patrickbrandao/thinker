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

export function getSessions(params: {
  range?: string;
  agent_name?: string;
  limit?: string;
  offset?: string;
}) {
  return fetchJson<{ items: SessionSummary[]; has_more: boolean }>('/sessions', params, {
    cache: false,
  });
}

export function getSession(id: string) {
  return fetchJson<SessionDetail>(`/sessions/${encodeURIComponent(id)}`, undefined, {
    cache: false,
  });
}
