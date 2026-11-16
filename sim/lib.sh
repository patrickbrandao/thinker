# Shared helpers for the sim/ scripts (bash 3.2 compatible). Source it.
SIM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SIM_DIR/.." && pwd)"
STATE="$SIM_DIR/.state"
WWZ_REPO="${WWZ_REPO:-$HOME/Projects/white-wizard}"
WWZ_BIN="$WWZ_REPO/bin"
SIM_PG_CONTAINER="thk-sim-pg"
SIM_PG_VOLUME="thk-sim-pg-data"
SIM_PG_IMAGE="${THINKER_SIM_PG_IMAGE:-postgres:18-alpine}"
# shellcheck disable=SC1091
. "$SIM_DIR/ports.env"
SIM_API="http://127.0.0.1:$SIM_API_PORT"

log() { printf '[sim] %s\n' "$*"; }
die() { printf '[sim] error: %s\n' "$*" >&2; exit 1; }

port_up() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# wait_port PORT SECONDS NAME
wait_port() {
  local i=0
  while [ "$i" -lt "$2" ]; do
    port_up "$1" && return 0
    sleep 1
    i=$((i + 1))
  done
  die "$3 did not open port $1 in $2 s (see $STATE/logs)"
}

# wait_http URL SECONDS NAME
wait_http() {
  local i=0
  while [ "$i" -lt "$2" ]; do
    curl -fsS -o /dev/null "$1" 2>/dev/null && return 0
    sleep 1
    i=$((i + 1))
  done
  die "$3 did not answer $1 in $2 s (see $STATE/logs)"
}

# start_bg NAME PORT CWD CMD...: runs CMD in the background unless PORT is open.
start_bg() {
  local name="$1" port="$2" cwd="$3"
  shift 3
  if port_up "$port"; then
    log "$name already up on $port"
    return 0
  fi
  mkdir -p "$STATE/logs" "$STATE/pids"
  (
    cd "$cwd" || exit 1
    nohup "$@" >>"$STATE/logs/$name.log" 2>&1 &
    echo $! >"$STATE/pids/$name.pid"
  )
  log "$name starting on $port (log: sim/.state/logs/$name.log)"
}

# stop_pid NAME: stops a process started by start_bg.
stop_pid() {
  local f="$STATE/pids/$1.pid" pid
  [ -f "$f" ] || return 0
  pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    local i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
    kill -9 "$pid" 2>/dev/null
    log "$1 stopped"
  fi
  rm -f "$f"
}

# stop_port NAME PORT: last resort for a process listening on PORT that was
# started from this worktree (never anything else).
stop_port() {
  local pids pid
  pids="$(lsof -nP -t -iTCP:"$2" -sTCP:LISTEN 2>/dev/null)"
  for pid in $pids; do
    if lsof -p "$pid" 2>/dev/null | grep -q "$REPO_DIR\|$WWZ_BIN"; then
      kill "$pid" 2>/dev/null && log "$1 (pid $pid on $2) stopped"
    fi
  done
}

load_env() {
  [ -f "$STATE/env" ] || die "no $STATE/env (run sim/up.sh)"
  set -a
  # shellcheck disable=SC1091
  . "$STATE/env"
  set +a
}
