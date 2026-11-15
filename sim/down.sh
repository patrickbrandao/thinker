#!/usr/bin/env bash
# Stops agents, dashboard, backend, catalog and mocks. Keeps Postgres and
# sim/.state (data preserved).
set -uo pipefail
. "$(dirname "$0")/lib.sh"
"$SIM_DIR/agents/stop.sh"
stop_pid web; stop_port web "$SIM_WEB_PORT"
stop_pid backend; stop_port backend "$SIM_API_PORT"
stop_pid catalog
stop_pid wwz-openai; stop_port wwz-openai "$SIM_WWZ_OPENAI_PORT"
stop_pid wwz-opencode; stop_port wwz-opencode "$SIM_WWZ_OPENCODE_PORT"
log "down (Postgres $SIM_PG_CONTAINER and sim/.state kept)"
