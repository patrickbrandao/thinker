#!/usr/bin/env bash
# Resource and behavior snapshot of the simulation (docs/dev/simulacao-pura.md):
# CPU and memory per piece, database and table sizes, recordings and logs on
# disk, request latency and error rate over the last window.
#
#   sim/metrics.sh                 # one human-readable snapshot (window: 5 min)
#   sim/metrics.sh watch [SECONDS] # every SECONDS (default 60), appends to sim/.state/metrics.csv
#   WINDOW_MIN=15 sim/metrics.sh   # change the latency/error window
set -uo pipefail
. "$(dirname "$0")/lib.sh"

WINDOW_MIN="${WINDOW_MIN:-5}"
CSV="$STATE/metrics.csv"

proc() { # name -> "cpu% rss_mb" of a process started by start_bg, or "- -"
  local f="$STATE/pids/$1.pid" pid
  [ -f "$f" ] || { echo "- -"; return; }
  pid="$(cat "$f")"
  ps -o %cpu=,rss= -p "$pid" 2>/dev/null | awk '{printf "%s %.0f\n", $1, $2/1024}' || echo "- -"
}

kb() { du -sk "$1" 2>/dev/null | cut -f1; }
files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }

sql() { docker exec "$SIM_PG_CONTAINER" psql -U thinker -d thinker_sim -Atc "$1" 2>/dev/null; }

snapshot() {
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  read -r BE_CPU BE_MB <<<"$(proc backend)"
  read -r OC_CPU OC_MB <<<"$(proc wwz-opencode)"
  read -r OA_CPU OA_MB <<<"$(proc wwz-openai)"
  read -r WEB_CPU WEB_MB <<<"$(proc web)"
  PG_STATS="$(docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' "$SIM_PG_CONTAINER" 2>/dev/null)"
  PG_CPU="$(echo "$PG_STATS" | awk '{print $1}' | tr -d '%')"
  PG_MEM="$(echo "$PG_STATS" | awk '{print $2}')"
  DB_MB="$(sql "select round(pg_database_size('thinker_sim')/1048576.0, 1)")"
  T_REQ_MB="$(sql "select round(pg_total_relation_size('requests')/1048576.0, 1)")"
  T_MSG_MB="$(sql "select round(pg_total_relation_size('agent_messages')/1048576.0, 1)")"
  REC_KB="$(kb "$STATE/rec")"; REC_FILES="$(files "$STATE/rec")"
  LOG_KB="$(kb "$STATE/logs")"
  AG_KB="$(kb "$STATE/agents")"; AG_FILES="$(files "$STATE/agents")"
  STATE_KB="$(kb "$STATE")"
  LAT="$(sql "select count(*),
      coalesce(round(percentile_cont(0.5) within group (order by duration_ms))::int, 0),
      coalesce(round(percentile_cont(0.95) within group (order by duration_ms))::int, 0),
      coalesce(round(percentile_cont(0.99) within group (order by duration_ms))::int, 0),
      count(*) filter (where status <> 'success'),
      coalesce(round(sum(cost_usd)::numeric, 6), 0)
    from agent_messages where timestamp > now() - interval '$WINDOW_MIN minutes'")"
  IFS='|' read -r N P50 P95 P99 FAILS COST <<<"${LAT:-0|0|0|0|0|0}"
  TOTAL_MSG="$(sql "select count(*) from agent_messages")"
}

print_human() {
  cat <<OUT
Snapshot $TS (window: last $WINDOW_MIN min)
Processes             cpu%    memory
  backend             ${BE_CPU:--}   ${BE_MB:--} MB
  dashboard (vite)    ${WEB_CPU:--}   ${WEB_MB:--} MB
  wwz-opencode        ${OC_CPU:--}   ${OC_MB:--} MB
  wwz-openai          ${OA_CPU:--}   ${OA_MB:--} MB
  postgres            ${PG_CPU:--}   ${PG_MEM:--}
Database
  thinker_sim         ${DB_MB:--} MB  (requests ${T_REQ_MB:--} MB, agent_messages ${T_MSG_MB:--} MB, ${TOTAL_MSG:-0} attempts total)
Disk (sim/.state)
  total               ${STATE_KB:-0} KB
  recordings          ${REC_KB:-0} KB in ${REC_FILES:-0} files
  logs                ${LOG_KB:-0} KB
  agent reports       ${AG_KB:-0} KB in ${AG_FILES:-0} files
Requests (window)
  attempts            ${N:-0}  (failed ${FAILS:-0})
  duration ms         p50 ${P50:-0}  p95 ${P95:-0}  p99 ${P99:-0}
  cost USD            ${COST:-0}
OUT
}

print_csv() {
  [ -f "$CSV" ] || echo "ts,backend_cpu,backend_mb,web_cpu,web_mb,wwz_oc_cpu,wwz_oc_mb,wwz_oa_cpu,wwz_oa_mb,pg_cpu,pg_mem,db_mb,requests_mb,agent_messages_mb,attempts_total,state_kb,rec_kb,rec_files,logs_kb,agents_kb,agents_files,window_min,attempts,failed,p50_ms,p95_ms,p99_ms,cost_usd" >"$CSV"
  echo "$TS,$BE_CPU,$BE_MB,$WEB_CPU,$WEB_MB,$OC_CPU,$OC_MB,$OA_CPU,$OA_MB,$PG_CPU,$PG_MEM,$DB_MB,$T_REQ_MB,$T_MSG_MB,$TOTAL_MSG,$STATE_KB,$REC_KB,$REC_FILES,$LOG_KB,$AG_KB,$AG_FILES,$WINDOW_MIN,$N,$FAILS,$P50,$P95,$P99,$COST" >>"$CSV"
}

case "${1:-}" in
  watch)
    every="${2:-60}"
    log "recording every ${every}s to sim/.state/metrics.csv (Ctrl-C to stop)"
    while true; do
      snapshot
      print_csv
      echo "$TS attempts=${N:-0} failed=${FAILS:-0} p95=${P95:-0}ms backend=${BE_CPU:--}%/${BE_MB:--}MB db=${DB_MB:--}MB rec=${REC_KB:-0}KB"
      sleep "$every"
    done
    ;;
  "")
    snapshot
    print_human
    ;;
  *)
    echo "usage: sim/metrics.sh [watch [SECONDS]]" >&2
    exit 2
    ;;
esac
