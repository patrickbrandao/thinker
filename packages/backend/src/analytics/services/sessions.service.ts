import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { computeCutoff, sqlSanitizeCost } from '../../common/utils/postgres-sql';
import { rangeToInterval } from '../../common/utils/range.util';
import { SUCCESS_STATUS_SQL_LIST, sqlIsFailedStatus } from './query-helpers';

/**
 * Harness sessions, read from `requests.session_id` (see harness-session.ts).
 * A subagent session (`parent_session_id`) folds into its main session, so a
 * session's totals include the requests of every subagent it spawned.
 */

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
  /** Main session of a subagent session opened directly. */
  parent_session_id: string | null;
  parts: SessionPart[];
  client: { user_agent: string | null; project: string | null; client: string | null } | null;
}

const safeCost = sqlSanitizeCost('m.cost_usd');
const SUCCESS = `(m.status IS NULL OR m.status IN (${SUCCESS_STATUS_SQL_LIST}))`;

/** Aggregates over `q` (requests with a `root`) and `m` (their attempts). */
const AGGREGATES = `
  MIN(q.timestamp) AS started_at,
  MAX(q.timestamp + make_interval(secs => COALESCE(q.duration_ms, 0) / 1000.0)) AS last_at,
  COUNT(DISTINCT q.id)::int AS requests,
  COUNT(DISTINCT q.id) FILTER (WHERE ${sqlIsFailedStatus('q.status')})::int AS failed,
  COUNT(DISTINCT q.id) FILTER (WHERE q.status = 'pending')::int AS in_flight,
  COALESCE(SUM(m.input_tokens), 0)::bigint AS input_tokens,
  COALESCE(SUM(m.output_tokens), 0)::bigint AS output_tokens,
  COALESCE(SUM(m.cache_read_tokens), 0)::bigint AS cache_read_tokens,
  COALESCE(SUM(m.cache_creation_tokens), 0)::bigint AS cache_creation_tokens,
  COALESCE(SUM(${safeCost}), 0)::float AS cost`;

const SUMMARY_COLUMNS = `
  q.root AS id,
  q.agent_id,
  MAX(q.agent_name) AS agent_name,
  ${AGGREGATES},
  COUNT(DISTINCT q.session_id) FILTER (WHERE q.session_id <> q.root)::int AS subagents,
  COALESCE(ARRAY_AGG(DISTINCT m.model) FILTER (WHERE m.model IS NOT NULL AND ${SUCCESS}), '{}') AS models,
  COALESCE(ARRAY_AGG(DISTINCT m.provider) FILTER (WHERE m.provider IS NOT NULL AND ${SUCCESS}), '{}') AS providers`;

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function toSummary(row: Row): SessionSummary {
  return {
    id: String(row.id),
    agent_id: (row.agent_id as string | null) ?? null,
    agent_name: (row.agent_name as string | null) ?? null,
    started_at: iso(row.started_at),
    last_at: iso(row.last_at),
    requests: num(row.requests),
    failed: num(row.failed),
    in_flight: num(row.in_flight),
    subagents: num(row.subagents),
    input_tokens: num(row.input_tokens),
    output_tokens: num(row.output_tokens),
    cache_read_tokens: num(row.cache_read_tokens),
    cache_creation_tokens: num(row.cache_creation_tokens),
    cost: num(row.cost),
    models: (row.models as string[] | null) ?? [],
    providers: (row.providers as string[] | null) ?? [],
  };
}

@Injectable()
export class SessionsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Sessions with activity in `range`, latest first. */
  async list(params: {
    tenantId: string;
    range?: string;
    agentName?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: SessionSummary[]; has_more: boolean }> {
    const args: unknown[] = [params.tenantId];
    const where = ['r.tenant_id = $1', 'r.session_id IS NOT NULL'];
    if (params.range) {
      args.push(computeCutoff(rangeToInterval(params.range)));
      where.push(`r.timestamp >= $${args.length}`);
    }
    if (params.agentName) {
      args.push(params.agentName);
      where.push(
        `r.agent_id IN (SELECT id FROM agents WHERE tenant_id = $1 AND name = $${args.length} AND deleted_at IS NULL)`,
      );
    }
    args.push(params.limit + 1, params.offset);
    const rows: Row[] = await this.ds.query(
      `WITH active AS (
         SELECT COALESCE(r.parent_session_id, r.session_id) AS root, r.agent_id,
                MAX(r.timestamp) AS seen
           FROM requests r
          WHERE ${where.join(' AND ')}
          GROUP BY 1, 2
          ORDER BY seen DESC
          LIMIT $${args.length - 1} OFFSET $${args.length}
       ), q AS (
         SELECT r.*, a.root, a.seen
           FROM active a
           JOIN requests r ON r.tenant_id = $1 AND r.agent_id IS NOT DISTINCT FROM a.agent_id
                          AND (r.session_id = a.root OR r.parent_session_id = a.root)
       )
       SELECT ${SUMMARY_COLUMNS}, MAX(q.seen) AS seen
         FROM q LEFT JOIN agent_messages m ON m.request_id = q.id
        GROUP BY q.root, q.agent_id
        ORDER BY seen DESC`,
      args,
    );
    return {
      items: rows.slice(0, params.limit).map(toSummary),
      has_more: rows.length > params.limit,
    };
  }

  /** One session with a breakdown per subagent session, or null. */
  async get(
    tenantId: string,
    sessionId: string,
    withClient: boolean,
  ): Promise<SessionDetail | null> {
    const scope = `FROM requests r
       WHERE r.tenant_id = $1 AND (r.session_id = $2 OR r.parent_session_id = $2)`;
    const [summaryRows, partRows, parentRows] = await Promise.all([
      this.ds.query(
        `WITH q AS (SELECT r.*, $2::varchar AS root ${scope})
         SELECT ${SUMMARY_COLUMNS}
           FROM q LEFT JOIN agent_messages m ON m.request_id = q.id
          GROUP BY q.root, q.agent_id
          ORDER BY requests DESC`,
        [tenantId, sessionId],
      ) as Promise<Row[]>,
      this.ds.query(
        `WITH q AS (SELECT r.* ${scope})
         SELECT q.session_id, ${AGGREGATES}
           FROM q LEFT JOIN agent_messages m ON m.request_id = q.id
          GROUP BY q.session_id
          ORDER BY started_at`,
        [tenantId, sessionId],
      ) as Promise<Row[]>,
      this.ds.query(
        `SELECT parent_session_id FROM requests
          WHERE tenant_id = $1 AND session_id = $2 AND parent_session_id IS NOT NULL
          LIMIT 1`,
        [tenantId, sessionId],
      ) as Promise<Row[]>,
    ]);
    if (summaryRows.length === 0) return null;

    let client: SessionDetail['client'] = null;
    if (withClient) {
      const [latest] = (await this.ds.query(
        `SELECT request_headers FROM requests
          WHERE tenant_id = $1 AND session_id = $2 AND request_headers IS NOT NULL
          ORDER BY timestamp DESC LIMIT 1`,
        [tenantId, sessionId],
      )) as Row[];
      const headers = parseHeaders(latest?.request_headers);
      if (headers) {
        client = {
          user_agent: headers['user-agent'] ?? null,
          project: headers['x-opencode-project'] ?? null,
          client: headers['x-opencode-client'] ?? headers['originator'] ?? null,
        };
      }
    }

    return {
      ...toSummary(summaryRows[0]),
      parent_session_id: (parentRows[0]?.parent_session_id as string | undefined) ?? null,
      parts: partRows.map((row) => ({
        session_id: String(row.session_id),
        is_main: row.session_id === sessionId,
        started_at: iso(row.started_at),
        last_at: iso(row.last_at),
        requests: num(row.requests),
        failed: num(row.failed),
        input_tokens: num(row.input_tokens),
        output_tokens: num(row.output_tokens),
        cost: num(row.cost),
      })),
      client,
    };
  }
}

function parseHeaders(raw: unknown): Record<string, string> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, string>;
  try {
    return JSON.parse(String(raw)) as Record<string, string>;
  } catch {
    return null;
  }
}
