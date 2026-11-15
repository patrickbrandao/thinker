#!/usr/bin/env bash
# One line per piece, the last sessions per agent, wwz spend and Go quota.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

piece() { # name port
  if port_up "$2"; then printf '  %-14s up    127.0.0.1:%s\n' "$1" "$2"; else printf '  %-14s DOWN  127.0.0.1:%s\n' "$1" "$2"; fi
}
echo "Pieces:"
piece wwz-opencode "$SIM_WWZ_OPENCODE_PORT"
piece wwz-oc-admin "$SIM_WWZ_OPENCODE_ADMIN_PORT"
piece wwz-openai "$SIM_WWZ_OPENAI_PORT"
piece wwz-oa-admin "$SIM_WWZ_OPENAI_ADMIN_PORT"
piece catalog "$SIM_CATALOG_PORT"
piece postgres "$SIM_PG_PORT"
piece backend "$SIM_API_PORT"
piece dashboard "$SIM_WEB_PORT"
if curl -fsS "$SIM_API/api/v1/health" >/dev/null 2>&1; then
  echo "  health: $(curl -fsS "$SIM_API/api/v1/health")"
fi

echo "Agents:"
if [ -f "$STATE/agents/pids" ]; then
  while read -r name pid; do
    state=stopped; kill -0 "$pid" 2>/dev/null && state="running ($pid)"
    echo "  $name: $state"
    tail -n 3 "$STATE/agents/$name.log" 2>/dev/null | sed 's/^/    /'
  done <"$STATE/agents/pids"
else
  echo "  none running"
fi

echo "wwz spend (spend_usd per entity):"
for p in "$SIM_WWZ_OPENCODE_ADMIN_PORT" "$SIM_WWZ_OPENAI_ADMIN_PORT"; do
  curl -fsS "http://127.0.0.1:$p/admin/entities" 2>/dev/null \
    | jq -r --arg p "$p" '(.entities // .)[]? | "  :\($p) \(.entity.kind)/\(.entity.id): spend_usd=\(.spend_usd // 0) requests=\(.requests // 0)"' 2>/dev/null \
    || echo "  :$p unavailable"
done

echo "OpenCode Go quota (sim-opencode-go-quota-key):"
curl -fsS "http://127.0.0.1:$SIM_WWZ_OPENCODE_PORT/inference/go/v1/usage" \
  -H 'authorization: Bearer sim-opencode-go-quota-key' -H 'x-opencode-session: sim-status' 2>/dev/null \
  | jq -r '.usage | to_entries[] | "  \(.key): \(.value.status) \(.value.percent)% used (resets \(.value.resetsAt))"' 2>/dev/null \
  || echo "  unavailable"
