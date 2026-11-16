#!/usr/bin/env bash
# Stops every agent loop started by run.sh (and its running wwz-load).
set -uo pipefail
. "$(cd "$(dirname "$0")/.." && pwd)/lib.sh"
PIDS="$STATE/agents/pids"
[ -f "$PIDS" ] || exit 0
while read -r name pid; do
  [ -n "${pid:-}" ] || continue
  pkill -TERM -P "$pid" 2>/dev/null
  kill -TERM "$pid" 2>/dev/null && log "agent $name stopped"
done <"$PIDS"
rm -f "$PIDS"
