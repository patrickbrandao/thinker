#!/usr/bin/env bash
# Seeds a "Demo Topologia" workspace in a LOCAL dev database with every
# topology combination (IPv4/IPv6/mapped clients, harnesses with and without
# traffic or routes, virtual models with fallbacks, auto routes, API-key,
# subscription, custom and local connections, proxy profiles with proxies only,
# proxies plus Direct, Direct only and empty) and generates requests, provider
# attempts, proxy logs and daily proxy stats relative to now.
#
#   scripts/dev/topology-demo.sh            # (re)create the demo, last 24 h of traffic
#   scripts/dev/topology-demo.sh --live     # same, then keep adding traffic every 10 s
#   scripts/dev/topology-demo.sh --remove   # drop the demo workspace
#
# Env: DEMO_PG_CONTAINER (default thinker-dev-prodcopy), DEMO_PG_DB
# (default thinker_dev_prodcopy), DEMO_OWNER_EMAIL (default the dev seed admin).
# Never point it at production: it deletes and rewrites the demo workspace.
set -euo pipefail

CONTAINER=${DEMO_PG_CONTAINER:-thinker-dev-prodcopy}
DB=${DEMO_PG_DB:-thinker_dev_prodcopy}
OWNER=${DEMO_OWNER_EMAIL:-admin@thinker.example.com}
MODE=${1:-}

psql_run() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d "$DB" "$@"; }

CLEANUP=$(cat <<'SQL'
DELETE FROM agent_messages WHERE tenant_id = 'demo-topo';
DELETE FROM requests WHERE tenant_id = 'demo-topo';
DELETE FROM proxy_logs WHERE tenant_id = 'demo-topo';
DELETE FROM proxy_usage_daily WHERE tenant_id = 'demo-topo';
DELETE FROM proxy_assignments WHERE tenant_id = 'demo-topo';
DELETE FROM proxy_bindings WHERE tenant_id = 'demo-topo';
DELETE FROM proxy_profiles WHERE tenant_id = 'demo-topo';
DELETE FROM proxy_servers WHERE tenant_id = 'demo-topo';
DELETE FROM topology_positions WHERE tenant_id = 'demo-topo';
DELETE FROM tier_assignments WHERE agent_id LIKE 'demo-topo-%';
DELETE FROM virtual_models WHERE tenant_id = 'demo-topo';
DELETE FROM agent_enabled_providers WHERE agent_id LIKE 'demo-topo-%';
DELETE FROM tenant_providers WHERE tenant_id = 'demo-topo';
DELETE FROM custom_providers WHERE tenant_id = 'demo-topo';
DELETE FROM agents WHERE tenant_id = 'demo-topo';
DELETE FROM organization_members WHERE tenant_id = 'demo-topo';
DELETE FROM tenants WHERE id = 'demo-topo';
SQL
)

if [ "$MODE" = "--remove" ]; then
  echo "BEGIN; $CLEANUP COMMIT;" | psql_run
  echo "Demo workspace removed."
  exit 0
fi

# Traffic generator: one row per scenario. `n` requests spread over the last
# 24 h, `burst` of them in the last minute (sizes the lines). A failed attempt
# on a scenario with a fallback is superseded by a successful one on the
# fallback connection. Egress: P = through the first proxy, P2 = first proxy
# failed then the second carried it, D = Direct item of the profile (after the
# proxies failed), N = plain direct (no profile), L = local server.
TRAFFIC=$(cat <<'SQL'
CREATE TEMP TABLE spec (
  name text, agent text, ip text, vm text, provider text, auth text, conn text, model text,
  egress text, n int, burst int, err numeric, err_http int,
  fb_provider text, fb_auth text, fb_conn text, fb_model text, fb_egress text
) ON COMMIT DROP;
INSERT INTO spec VALUES
  -- claude-code-dev: subscription through "Corporativo + direto" (some Direct), fallback to the API key (direct override)
  ('ccd-sub',  'demo-topo-a1', '203.0.113.10',               'demo-topo-vm-sonnet', 'anthropic', 'subscription', 'demo-topo-c-ant-sub', 'claude-sonnet-4-5', 'PD', :n_ccd, :b_ccd, 0.10, 429, 'anthropic', 'api_key', 'demo-topo-c-ant-key', 'claude-sonnet-4-5', 'N'),
  ('ccd-v6',   'demo-topo-a1', '2001:db8:85a3::8a2e:370:7334', 'demo-topo-vm-sonnet', 'anthropic', 'subscription', 'demo-topo-c-ant-sub', 'claude-sonnet-4-5', 'PD', :n_ccd6, :b_ccd6, 0.05, 529, 'anthropic', 'api_key', 'demo-topo-c-ant-key', 'claude-sonnet-4-5', 'N'),
  ('ccd-grok', 'demo-topo-a1', '203.0.113.10',               'demo-topo-vm-grok',   'xai',       'api_key',      'demo-topo-c-xai',     'grok-4',            'PD', :n_grok, :b_grok, 0.00, NULL, NULL, NULL, NULL, NULL, NULL),
  -- codex-ci: busiest line, OpenAI "Produção" through "Corporativo", fallback to "Backup" (direct)
  ('codex',    'demo-topo-a2', '198.51.100.7',               'demo-topo-vm-gpt',    'openai',    'api_key',      'demo-topo-c-oai-prod','gpt-5',             'P',  :n_codex, :b_codex, 0.08, 500, 'openai', 'api_key', 'demo-topo-c-oai-bkp', 'gpt-5', 'N'),
  ('codex-2',  'demo-topo-a2', '203.0.113.10',               'demo-topo-vm-gpt',    'openai',    'api_key',      'demo-topo-c-oai-prod','gpt-5',             'P2', :n_codex2, :b_codex2, 0.00, NULL, NULL, NULL, NULL, NULL, NULL),
  ('codex-mini','demo-topo-a2','198.51.100.7',               'demo-topo-vm-mini',   'mistral',   'api_key',      'demo-topo-c-mistral', 'mistral-small-latest','P', :n_mini, :b_mini, 0.00, NULL, NULL, NULL, NULL, NULL, NULL),
  -- openclaw-bot: auto routing to DeepSeek through "Somente direto", IPv4-mapped client, rate limits
  ('claw',     'demo-topo-a3', '::ffff:192.0.2.44',          NULL,                  'deepseek',  'api_key',      'demo-topo-c-ds',      'deepseek-chat',     'D',  :n_claw, :b_claw, 0.15, 429, NULL, NULL, NULL, NULL, NULL),
  -- hermes-batch: OpenRouter on the empty profile, most attempts fail and fall back to the internal gateway, which also fails
  ('hermes',   'demo-topo-a4', '2804:14c:5b2::1',            'demo-topo-vm-batch',  'openrouter','api_key',      'demo-topo-c-or',      'deepseek/deepseek-chat', 'N', :n_hermes, :b_hermes, 0.70, 402, 'custom:demo-topo-cp1', 'api_key', 'demo-topo-c-custom', 'llama-3.3-70b', 'N'),
  -- opencode-local: local servers (Ollama, LM Studio)
  ('local',    'demo-topo-a5', '10.0.5.20',                  'demo-topo-vm-local',  'ollama',    'local',        'demo-topo-c-ollama',  'qwen3:8b',          'L',  :n_local, :b_local, 0.05, 500, 'custom:demo-topo-cp2', 'local', 'demo-topo-c-lms', 'qwen2.5-coder-7b', 'L');

CREATE TEMP TABLE gen ON COMMIT DROP AS
SELECT s.*, g,
       :'run' || '-' || s.name || '-' || g AS rid,
       CASE WHEN g <= s.burst THEN now() - random() * interval '50 seconds'
            ELSE now() - interval '2 minutes' - random() * :'spread'::interval END AS ts,
       random() < s.err AS failed,
       random() AS pick,
       (200 + random() * 4000)::int AS tokens_in,
       (50 + random() * 1500)::int AS tokens_out
  FROM spec s, generate_series(1, s.n) g;

CREATE TEMP TABLE att ON COMMIT DROP AS
SELECT rid, rid || '-1' AS id, 1 AS attempt, ts, agent, ip, vm, provider, auth, conn, model,
       CASE WHEN egress = 'PD' THEN CASE WHEN pick < 0.25 THEN 'D' ELSE 'P' END ELSE egress END AS egress,
       CASE WHEN failed THEN 'failed' ELSE 'success' END AS status,
       CASE WHEN failed THEN err_http END AS http,
       failed AND fb_conn IS NOT NULL AS superseded,
       tokens_in, tokens_out
  FROM gen
UNION ALL
SELECT rid, rid || '-2', 2, ts + interval '2 seconds', agent, ip, vm, fb_provider, fb_auth, fb_conn, fb_model,
       fb_egress,
       CASE WHEN name = 'hermes' AND pick < 0.4 THEN 'failed' ELSE 'success' END,
       CASE WHEN name = 'hermes' AND pick < 0.4 THEN 503 END,
       false, tokens_in, tokens_out
  FROM gen WHERE failed AND fb_conn IS NOT NULL;

INSERT INTO requests (id, tenant_id, agent_id, agent_name, timestamp, duration_ms, status,
                      error_message, error_http_status, requested_model, caller_attribution, api_mode)
SELECT g.rid, 'demo-topo', g.agent, a.name, g.ts, (300 + random() * 9000)::int,
       CASE WHEN last.status = 'failed' THEN 'failed' ELSE 'success' END,
       CASE WHEN last.status = 'failed' THEN 'Upstream error (demo)' END,
       last.http, COALESCE(v.name, 'auto'),
       '{"sdk":"unknown","userAgent":"topology-demo/1.0","clientIp":"' || g.ip
         || '","clientIpSource":"socket"}',
       'chat'
  FROM gen g
  JOIN agents a ON a.id = g.agent
  LEFT JOIN virtual_models v ON v.id = g.vm
  JOIN LATERAL (SELECT status, http FROM att WHERE att.rid = g.rid ORDER BY attempt DESC LIMIT 1) last ON true;

INSERT INTO agent_messages (id, tenant_id, agent_id, agent_name, timestamp, duration_ms, status,
                            error_message, error_http_status, model, provider, auth_type,
                            tenant_provider_id, virtual_model_id, virtual_model_name,
                            input_tokens, output_tokens, cost_usd, caller_attribution,
                            request_id, attempt_number, superseded, egress, egress_hops,
                            fallback_index)
SELECT t.id, 'demo-topo', t.agent, a.name, t.ts, (300 + random() * 9000)::int, t.status,
       CASE WHEN t.status = 'failed' THEN 'Upstream error (demo)' END, t.http, t.model, t.provider,
       t.auth, t.conn, t.vm, v.name,
       CASE WHEN t.status = 'failed' THEN 0 ELSE t.tokens_in END,
       CASE WHEN t.status = 'failed' THEN 0 ELSE t.tokens_out END,
       CASE WHEN t.status = 'failed' OR t.auth = 'local' THEN 0
            ELSE round((t.tokens_in * 3 + t.tokens_out * 15) / 1e6::numeric, 6) END,
       '{"sdk":"unknown","userAgent":"topology-demo/1.0","clientIp":"' || t.ip
         || '","clientIpSource":"socket"}',
       t.rid, t.attempt, t.superseded,
       CASE t.egress
         WHEN 'P'  THEN jsonb_build_object('kind', 'proxy', 'proxy_id', ps.first_id, 'name', ps.first_name)
         WHEN 'P2' THEN jsonb_build_object('kind', 'proxy', 'proxy_id', ps.second_id, 'name', ps.second_name)
         ELSE jsonb_build_object('kind', 'direct', 'proxy_id', NULL, 'name', NULL) END,
       CASE t.egress
         WHEN 'P'  THEN jsonb_build_array(jsonb_build_object('kind', 'proxy', 'proxy_id', ps.first_id, 'name', ps.first_name, 'position', 1, 'result', 'ok', 'ms', 40))
         WHEN 'P2' THEN jsonb_build_array(
                         jsonb_build_object('kind', 'proxy', 'proxy_id', ps.first_id, 'name', ps.first_name, 'position', 1, 'result', 'timeout', 'ms', 10000),
                         jsonb_build_object('kind', 'proxy', 'proxy_id', ps.second_id, 'name', ps.second_name, 'position', 2, 'result', 'ok', 'ms', 55))
         -- Direct after the profile's proxies refused (or a Direct-only profile).
         WHEN 'D'  THEN CASE WHEN ps.first_id IS NULL
           THEN jsonb_build_array(jsonb_build_object('kind', 'direct', 'proxy_id', NULL, 'name', 'direct', 'position', 1, 'result', 'ok', 'ms', 30))
           ELSE jsonb_build_array(
                         jsonb_build_object('kind', 'proxy', 'proxy_id', ps.first_id, 'name', ps.first_name, 'position', 1, 'result', 'refused', 'ms', 12),
                         jsonb_build_object('kind', 'direct', 'proxy_id', NULL, 'name', 'direct', 'position', ps.direct_pos, 'result', 'ok', 'ms', 30)) END
         ELSE NULL END,
       CASE WHEN t.attempt > 1 THEN 0 END
  FROM att t
  JOIN agents a ON a.id = t.agent
  LEFT JOIN virtual_models v ON v.id = t.vm
  -- The chain of the connection's profile (its own assignment, else its provider default).
  LEFT JOIN LATERAL (
    SELECT max(b.proxy_id) FILTER (WHERE b.position = 1) AS first_id,
           max(s.name) FILTER (WHERE b.position = 1) AS first_name,
           max(b.proxy_id) FILTER (WHERE b.position = 2) AS second_id,
           max(s.name) FILTER (WHERE b.position = 2) AS second_name,
           COALESCE(max(b.position) FILTER (WHERE b.proxy_id IS NULL), 1) AS direct_pos
      FROM proxy_assignments pa
      JOIN proxy_bindings b ON b.tenant_id = pa.tenant_id AND b.target_type = 'profile'
                           AND b.target_id = pa.profile_id
      LEFT JOIN proxy_servers s ON s.id = b.proxy_id
     WHERE pa.tenant_id = 'demo-topo' AND pa.mode = 'profile'
       AND pa.profile_id = COALESCE(
             (SELECT profile_id FROM proxy_assignments x
               WHERE x.tenant_id = 'demo-topo' AND x.target_type = 'connection' AND x.target_id = t.conn),
             (SELECT profile_id FROM proxy_assignments x
               WHERE x.tenant_id = 'demo-topo' AND x.target_type = 'provider'
                 AND x.target_id = (CASE WHEN t.auth = 'subscription' THEN 'subscription' ELSE 'api_key' END)
                                   || ':' || t.provider))
  ) ps ON true;

-- Proxy logs: failures (first proxy down before the second one or Direct took over).
INSERT INTO proxy_logs (id, tenant_id, proxy_id, proxy_name, started_at, duration_ms, source_type,
                        source_id, source_label, destination, position, result, status_code, error)
SELECT m.id || '-hop1', 'demo-topo', h->>'proxy_id', h->>'name', m.timestamp, (h->>'ms')::int,
       'connection', m.tenant_provider_id, m.provider || ' / ' || tp.label,
       'api.' || replace(m.provider, 'custom:', '') || '.example:443', 1, h->>'result', NULL,
       CASE h->>'result' WHEN 'timeout' THEN 'connect timeout after 10000 ms'
                         ELSE 'connect ECONNREFUSED' END
  FROM agent_messages m
  JOIN tenant_providers tp ON tp.id = m.tenant_provider_id
  CROSS JOIN LATERAL jsonb_array_elements(m.egress_hops) h
 WHERE m.tenant_id = 'demo-topo' AND m.request_id LIKE :'run' || '-%'
   AND h->>'kind' = 'proxy' AND h->>'result' <> 'ok';

-- Daily proxy stats, one row per proxy, day and connection.
INSERT INTO proxy_usage_daily (tenant_id, proxy_id, proxy_name, day, source_type, source_id,
                               connections, successes, failures, failures_by_code, tunnel_ms_sum,
                               tunnel_ms_max, tunnel_samples, bytes_sent, bytes_received,
                               fallback_uses)
SELECT 'demo-topo', h->>'proxy_id', max(h->>'name'), m.timestamp::date, 'connection',
       m.tenant_provider_id, count(*),
       count(*) FILTER (WHERE h->>'result' = 'ok'),
       count(*) FILTER (WHERE h->>'result' <> 'ok'),
       COALESCE((SELECT jsonb_object_agg(r, c) FROM (SELECT x->>'result' r, count(*) c
                   FROM jsonb_array_elements(jsonb_agg(h)) x WHERE x->>'result' <> 'ok' GROUP BY 1) f),
                '{}'::jsonb),
       COALESCE(sum((h->>'ms')::int) FILTER (WHERE h->>'result' = 'ok'), 0),
       COALESCE(max((h->>'ms')::int) FILTER (WHERE h->>'result' = 'ok'), 0),
       count(*) FILTER (WHERE h->>'result' = 'ok'),
       count(*) * 4096, count(*) FILTER (WHERE h->>'result' = 'ok') * 16384,
       count(*) FILTER (WHERE (h->>'position')::int > 1)
  FROM agent_messages m
  CROSS JOIN LATERAL jsonb_array_elements(m.egress_hops) h
 WHERE m.tenant_id = 'demo-topo' AND m.request_id LIKE :'run' || '-%' AND h->>'kind' = 'proxy'
 GROUP BY h->>'proxy_id', m.timestamp::date, m.tenant_provider_id
ON CONFLICT (tenant_id, proxy_id, day, source_type, source_id) DO UPDATE SET
  connections = proxy_usage_daily.connections + EXCLUDED.connections,
  successes = proxy_usage_daily.successes + EXCLUDED.successes,
  failures = proxy_usage_daily.failures + EXCLUDED.failures,
  failures_by_code = proxy_usage_daily.failures_by_code || EXCLUDED.failures_by_code,
  tunnel_ms_sum = proxy_usage_daily.tunnel_ms_sum + EXCLUDED.tunnel_ms_sum,
  tunnel_ms_max = GREATEST(proxy_usage_daily.tunnel_ms_max, EXCLUDED.tunnel_ms_max),
  tunnel_samples = proxy_usage_daily.tunnel_samples + EXCLUDED.tunnel_samples,
  bytes_sent = proxy_usage_daily.bytes_sent + EXCLUDED.bytes_sent,
  bytes_received = proxy_usage_daily.bytes_received + EXCLUDED.bytes_received,
  fallback_uses = proxy_usage_daily.fallback_uses + EXCLUDED.fallback_uses;
SQL
)

traffic() {
  # $1 run id, $2 spread, then n/burst per scenario.
  local run=$1 spread=$2; shift 2
  { echo "BEGIN;"; echo "$TRAFFIC"; echo "COMMIT;"; } | psql_run -v run="$run" -v spread="$spread" "$@"
}

echo "Creating the demo workspace in $CONTAINER/$DB…"
psql_run -v owner="$OWNER" <<SQL
BEGIN;
$CLEANUP
SELECT id AS owner_id FROM "user" WHERE email = :'owner' \gset
INSERT INTO tenants (id, name, organization_name, owner_user_id) VALUES ('demo-topo', 'demo-topo', 'Demo Topologia', :'owner_id');
INSERT INTO organization_members (tenant_id, user_id, role) VALUES ('demo-topo', :'owner_id', 'owner');

INSERT INTO agents (id, name, tenant_id, display_name, agent_category, agent_platform) VALUES
  ('demo-topo-a1', 'claude-code-dev', 'demo-topo', 'claude-code-dev', 'coding', 'claude-code'),
  ('demo-topo-a2', 'codex-ci', 'demo-topo', 'codex-ci', 'coding', 'codex'),
  ('demo-topo-a3', 'openclaw-bot', 'demo-topo', 'openclaw-bot', 'personal', 'openclaw'),
  ('demo-topo-a4', 'hermes-batch', 'demo-topo', 'hermes-batch', 'personal', 'hermes'),
  ('demo-topo-a5', 'opencode-local', 'demo-topo', 'opencode-local', 'coding', 'opencode'),
  ('demo-topo-a6', 'n8n-idle', 'demo-topo', 'n8n-idle', 'automation', 'n8n'),
  ('demo-topo-a7', 'sdk-sem-rota', 'demo-topo', 'sdk-sem-rota', 'app', 'openai-sdk');

INSERT INTO custom_providers (id, tenant_id, name, base_url, models, api_kind, local_type) VALUES
  ('demo-topo-cp1', 'demo-topo', 'Gateway interno', 'https://llm.interno.example/v1', '[]', 'openai', NULL),
  ('demo-topo-cp2', 'demo-topo', 'LM Studio da sala', 'http://192.168.0.50:1234/v1', '[]', 'openai', 'lmstudio');

INSERT INTO tenant_providers (id, tenant_id, provider, auth_type, label, is_active) VALUES
  ('demo-topo-c-oai-prod', 'demo-topo', 'openai', 'api_key', 'Produção', true),
  ('demo-topo-c-oai-bkp', 'demo-topo', 'openai', 'api_key', 'Backup', true),
  ('demo-topo-c-mistral', 'demo-topo', 'mistral', 'api_key', 'Default', true),
  ('demo-topo-c-ant-sub', 'demo-topo', 'anthropic', 'subscription', 'Claude Max', true),
  ('demo-topo-c-ant-key', 'demo-topo', 'anthropic', 'api_key', 'Console', true),
  ('demo-topo-c-xai', 'demo-topo', 'xai', 'api_key', 'Default', true),
  ('demo-topo-c-ds', 'demo-topo', 'deepseek', 'api_key', 'Default', true),
  ('demo-topo-c-or', 'demo-topo', 'openrouter', 'api_key', 'Default', true),
  ('demo-topo-c-gem', 'demo-topo', 'gemini', 'api_key', 'Inativo', false),
  ('demo-topo-c-custom', 'demo-topo', 'custom:demo-topo-cp1', 'api_key', 'Default', true),
  ('demo-topo-c-ollama', 'demo-topo', 'ollama', 'local', 'Default', true),
  ('demo-topo-c-lms', 'demo-topo', 'custom:demo-topo-cp2', 'local', 'Default', true);

-- Proxy servers and profiles: proxies only, proxies + Direct, Direct only, empty.
INSERT INTO proxy_servers (id, tenant_id, name, scheme, host, port, enabled) VALUES
  ('demo-topo-s1', 'demo-topo', 'Squid SP', 'http', '10.10.0.10', 3128, true),
  ('demo-topo-s2', 'demo-topo', 'Squid RJ', 'http', '10.10.0.11', 3128, true),
  ('demo-topo-s3', 'demo-topo', 'Tinyproxy backup', 'http', '10.10.0.20', 8888, false);
INSERT INTO proxy_profiles (id, tenant_id, name) VALUES
  ('demo-topo-p1', 'demo-topo', 'Corporativo'),
  ('demo-topo-p2', 'demo-topo', 'Corporativo + direto'),
  ('demo-topo-p3', 'demo-topo', 'Somente direto'),
  ('demo-topo-p4', 'demo-topo', 'Vazio');
INSERT INTO proxy_bindings (tenant_id, target_type, target_id, position, proxy_id) VALUES
  ('demo-topo', 'profile', 'demo-topo-p1', 1, 'demo-topo-s1'),
  ('demo-topo', 'profile', 'demo-topo-p1', 2, 'demo-topo-s2'),
  ('demo-topo', 'profile', 'demo-topo-p2', 1, 'demo-topo-s1'),
  ('demo-topo', 'profile', 'demo-topo-p2', 2, 'demo-topo-s3'),
  ('demo-topo', 'profile', 'demo-topo-p2', 3, NULL),
  ('demo-topo', 'profile', 'demo-topo-p3', 1, NULL);
-- Connection-level, provider-default (inherited) and override-to-direct assignments.
INSERT INTO proxy_assignments (tenant_id, target_type, target_id, mode, profile_id) VALUES
  ('demo-topo', 'connection', 'demo-topo-c-oai-prod', 'profile', 'demo-topo-p1'),
  ('demo-topo', 'connection', 'demo-topo-c-mistral', 'profile', 'demo-topo-p1'),
  ('demo-topo', 'provider', 'subscription:anthropic', 'profile', 'demo-topo-p2'),
  ('demo-topo', 'provider', 'api_key:xai', 'profile', 'demo-topo-p2'),
  ('demo-topo', 'provider', 'api_key:anthropic', 'profile', 'demo-topo-p1'),
  ('demo-topo', 'connection', 'demo-topo-c-ant-key', 'direct', NULL),
  ('demo-topo', 'connection', 'demo-topo-c-ds', 'profile', 'demo-topo-p3'),
  ('demo-topo', 'connection', 'demo-topo-c-or', 'profile', 'demo-topo-p4');

-- Virtual models (primary + fallbacks) and auto routes.
INSERT INTO virtual_models (id, tenant_id, agent_id, name, enabled, sort_order, override_route, fallback_routes) VALUES
  ('demo-topo-vm-sonnet', 'demo-topo', 'demo-topo-a1', 'sonnet', true, 0,
   '{"provider":"anthropic","authType":"subscription","model":"claude-sonnet-4-5"}',
   '[{"provider":"anthropic","authType":"api_key","model":"claude-sonnet-4-5"}]'),
  ('demo-topo-vm-grok', 'demo-topo', 'demo-topo-a1', 'grok', true, 1,
   '{"provider":"xai","authType":"api_key","model":"grok-4"}', NULL),
  ('demo-topo-vm-gpt', 'demo-topo', 'demo-topo-a2', 'gpt', true, 0,
   '{"provider":"openai","authType":"api_key","model":"gpt-5","keyLabel":"Produção"}',
   '[{"provider":"openai","authType":"api_key","model":"gpt-5","keyLabel":"Backup"}]'),
  ('demo-topo-vm-mini', 'demo-topo', 'demo-topo-a2', 'mini', true, 1,
   '{"provider":"mistral","authType":"api_key","model":"mistral-small-latest"}', NULL),
  ('demo-topo-vm-batch', 'demo-topo', 'demo-topo-a4', 'batch', true, 0,
   '{"provider":"openrouter","authType":"api_key","model":"deepseek/deepseek-chat"}',
   '[{"provider":"custom:demo-topo-cp1","authType":"api_key","model":"llama-3.3-70b"}]'),
  ('demo-topo-vm-local', 'demo-topo', 'demo-topo-a5', 'local', true, 0,
   '{"provider":"ollama","authType":"local","model":"qwen3:8b"}',
   '[{"provider":"custom:demo-topo-cp2","authType":"local","model":"qwen2.5-coder-7b"}]');
INSERT INTO tier_assignments (id, tier, agent_id, override_route, fallback_routes) VALUES
  ('demo-topo-t3', 'default', 'demo-topo-a3',
   '{"provider":"deepseek","authType":"api_key","model":"deepseek-chat"}', NULL),
  ('demo-topo-t6', 'default', 'demo-topo-a6',
   '{"provider":"gemini","authType":"api_key","model":"gemini-2.5-flash"}',
   '[{"provider":"openai","authType":"api_key","model":"gpt-5-mini","keyLabel":"Backup"}]');
COMMIT;
SQL

traffic "demo-topo-r$(date +%s)" '22 hours' \
  -v n_ccd=180 -v b_ccd=6 -v n_ccd6=60 -v b_ccd6=2 -v n_grok=40 -v b_grok=1 \
  -v n_codex=420 -v b_codex=18 -v n_codex2=50 -v b_codex2=2 -v n_mini=90 -v b_mini=3 \
  -v n_claw=150 -v b_claw=4 -v n_hermes=80 -v b_hermes=2 -v n_local=120 -v b_local=5

psql_run -tA <<'SQL'
SELECT 'requests: ' || count(*) FROM requests WHERE tenant_id = 'demo-topo';
SELECT 'attempts: ' || count(*) FROM agent_messages WHERE tenant_id = 'demo-topo';
SELECT 'proxy logs: ' || count(*) FROM proxy_logs WHERE tenant_id = 'demo-topo';
SQL
echo "Done. Switch the dashboard to the \"Demo Topologia\" workspace."

if [ "$MODE" = "--live" ]; then
  echo "Live traffic every 10 s (Ctrl+C to stop)…"
  while sleep 10; do
    traffic "demo-topo-l$(date +%s)" '1 second' \
      -v n_ccd=$((RANDOM % 4)) -v b_ccd=4 -v n_ccd6=$((RANDOM % 2)) -v b_ccd6=2 \
      -v n_grok=$((RANDOM % 2)) -v b_grok=2 -v n_codex=$((2 + RANDOM % 6)) -v b_codex=8 \
      -v n_codex2=$((RANDOM % 2)) -v b_codex2=2 -v n_mini=$((RANDOM % 3)) -v b_mini=3 \
      -v n_claw=$((RANDOM % 3)) -v b_claw=3 -v n_hermes=$((RANDOM % 2)) -v b_hermes=2 \
      -v n_local=$((RANDOM % 3)) -v b_local=3
  done
fi
