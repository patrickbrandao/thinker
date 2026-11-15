#!/usr/bin/env bash
# Starts one background loop per line of agents.conf. Each loop runs one
# wwz-load agents session at a time against Thinker, then sleeps a random
# pause. Idempotent: a loop already running is left alone.
set -euo pipefail
. "$(cd "$(dirname "$0")/.." && pwd)/lib.sh"
[ -f "$STATE/keys.env" ] || die "no sim/.state/keys.env (run sim/seed.sh)"
mkdir -p "$STATE/agents"
PIDS="$STATE/agents/pids"
touch "$PIDS"

agent_loop() { # name key model profile turns think min max ua
  local name="$1" key="$2" model="$3" profile="$4" turns="$5" think="$6" min="$7" max="$8" ua="$9"
  local dir="$STATE/agents/$name" n=0 day session rc pause
  mkdir -p "$dir"
  trap 'exit 0' TERM INT
  while :; do
    n=$((n + 1))
    day="$(date -u +%Y%m%d)"
    session="sim-$name-$day-$n"
    rc=0
    "$WWZ_BIN/wwz-load" agents --target "$SIM_API" --protocol openai --stream \
      --key "$key" --model "$model" --profile "$profile" --agents 1 --sessions 1 \
      --turns "$turns" --max-tool-rounds 4 --think-time "$think" --retries 0 --progress 0 \
      --header "x-session-key: $session" --header "user-agent: $ua" \
      --output json --out "$dir/$session.json" >>"$STATE/agents/$name.err" 2>&1 || rc=$?
    printf '%s %s rc=%s %s\n' "$(date -u +%FT%TZ)" "$session" "$rc" \
      "$(jq -c '{ok: .total.sessions.completed, failed: .total.sessions.failed, requests: .total.requests, errors: .total.errors, tool_calls: .total.tool_calls}' "$dir/$session.json" 2>/dev/null || echo '{}')" \
      >>"$STATE/agents/$name.log"
    pause=$((min + RANDOM % (max - min + 1)))
    sleep "$pause" &
    wait $! || true
  done
}

while read -r name harness model profile turns think min max ua; do
  case "$name" in ''|'#'*) continue ;; esac
  if grep -q "^$name " "$PIDS" 2>/dev/null; then
    pid="$(grep "^$name " "$PIDS" | awk '{print $2}')"
    if kill -0 "$pid" 2>/dev/null; then log "agent $name already running ($pid)"; continue; fi
    grep -v "^$name " "$PIDS" >"$PIDS.tmp" || true; mv "$PIDS.tmp" "$PIDS"
  fi
  var="$(printf '%s' "$harness" | tr 'a-z-' 'A-Z_')_KEY"
  key="$(sed -n "s/^$var=//p" "$STATE/keys.env")"
  [ -n "$key" ] || die "no $var in keys.env"
  agent_loop "$name" "$key" "$model" "$profile" "$turns" "$think" "$min" "$max" "$ua" </dev/null >/dev/null 2>&1 &
  echo "$name $!" >>"$PIDS"
  log "agent $name started ($!), log sim/.state/agents/$name.log"
done <"$SIM_DIR/agents/agents.conf"
