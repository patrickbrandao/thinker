#!/usr/bin/env bash
# down.sh, then removes the Postgres container, its volume and sim/.state.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
"$SIM_DIR/down.sh"
docker rm -f "$SIM_PG_CONTAINER" >/dev/null 2>&1 && log "$SIM_PG_CONTAINER removed"
docker volume rm "$SIM_PG_VOLUME" >/dev/null 2>&1 && log "volume $SIM_PG_VOLUME removed"
rm -rf "$STATE"
log "reset: back to zero"
