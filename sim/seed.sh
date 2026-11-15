#!/usr/bin/env bash
# Initial data, only through Thinker's public API (no SQL): admin, three
# harnesses, provider connections pointed at the mocks (per-account URL
# overrides, ADR 0012), default routes, the Go -> OpenAI fallback, recording.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
load_env
command -v jq >/dev/null || die "jq is required"

JAR="$STATE/cookies.txt"
ORIGIN="$SIM_API"
OPENCODE_KEY_FREE="public"
OPENCODE_GO_KEY="sim-opencode-go-quota-key"
OPENAI_KEY="sk-sim-openai-unlimited-billed-key-0000000000000000000"

# api METHOD PATH [JSON]: prints the body; fails on a non-2xx status.
api() {
  local out code
  out="$(mktemp)"
  code="$(curl -sS -o "$out" -w '%{http_code}' -X "$1" "$SIM_API$2" \
    -b "$JAR" -c "$JAR" -H "origin: $ORIGIN" -H 'content-type: application/json' \
    ${3:+--data "$3"})"
  if [ "${code:0:1}" != "2" ]; then
    printf '[sim] %s %s -> HTTP %s: %s\n' "$1" "$2" "$code" "$(head -c 600 "$out")" >&2
    rm -f "$out"
    return 1
  fi
  cat "$out"
  rm -f "$out"
}

# 1. Admin through /setup.
EMAIL="admin@sim.local"
if [ ! -f "$STATE/admin.txt" ]; then
  PASSWORD="Sim-$(openssl rand -hex 12)"
  umask 077
  printf 'email=%s\npassword=%s\nurl=http://127.0.0.1:%s\n' "$EMAIL" "$PASSWORD" "$SIM_WEB_PORT" >"$STATE/admin.txt"
  chmod 600 "$STATE/admin.txt"
fi
PASSWORD="$(sed -n 's/^password=//p' "$STATE/admin.txt")"
if [ "$(api GET /api/v1/setup/status | jq -r .needsSetup)" = "true" ]; then
  api POST /api/v1/setup/admin "$(jq -nc --arg e "$EMAIL" --arg p "$PASSWORD" --arg t "$THINKER_SETUP_TOKEN" \
    '{email:$e,name:"Sim Admin",password:$p,setupToken:$t}')" >/dev/null
  log "admin $EMAIL created (sim/.state/admin.txt)"
fi
rm -f "$JAR"
api POST /api/auth/sign-in/email "$(jq -nc --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')" >/dev/null
log "signed in"

# 2. Harnesses (keys to keys.env).
: >"$STATE/keys.env.tmp"
create_agent() { # name platform (an existing harness gets a new key)
  local body key
  if body="$(api POST /api/v1/agents "$(jq -nc --arg n "$1" --arg p "$2" \
    '{name:$n,agent_category:"coding",agent_platform:$p,record_messages:true}')" 2>/dev/null)"; then
    :
  else
    body="$(api POST "/api/v1/agents/$1/rotate-key")"
  fi
  key="$(printf '%s' "$body" | jq -r .apiKey)"
  [ -n "$key" ] && [ "$key" != "null" ] || die "no key for $1"
  printf '%s=%s\n' "$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')_KEY" "$key" >>"$STATE/keys.env.tmp"
  log "harness $1 ($2) created"
}
create_agent sim-opencode-free opencode

# 3. Connections (tenant-wide; harnesses created afterwards inherit them).
CONNECTED="$(api GET /api/v1/providers | jq -r '(if type=="array" then . else (.providers // []) end)[] | .provider')"
connect() { # provider key urlOverrides-json (skipped when already connected)
  if printf '%s\n' "$CONNECTED" | grep -qx "$1"; then log "connection $1 exists"; return 0; fi
  api POST /api/v1/routing/sim-opencode-free/providers "$(jq -nc --arg p "$1" --arg k "$2" --argjson u "$3" \
    '{provider:$p,apiKey:$k,authType:"api_key",urlOverrides:$u}')" >/dev/null
  log "connection $1 -> $(printf '%s' "$3" | jq -r .inference)"
}
connect opencode "$OPENCODE_KEY_FREE" "{\"inference\":\"http://127.0.0.1:$SIM_WWZ_OPENCODE_PORT/inference\"}"
connect opencode-go "$OPENCODE_GO_KEY" "{\"inference\":\"http://127.0.0.1:$SIM_WWZ_OPENCODE_PORT/inference/go\"}"
connect openai "$OPENAI_KEY" "{\"inference\":\"http://127.0.0.1:$SIM_WWZ_OPENAI_PORT\"}"

create_agent sim-opencode-go opencode
create_agent sim-codex codex
mv "$STATE/keys.env.tmp" "$STATE/keys.env"
chmod 600 "$STATE/keys.env"

# 4. Default routes, fallback and recording.
route() { # agent provider model
  api PUT "/api/v1/routing/$1/tiers/default" "$(jq -nc --arg p "$2" --arg m "$3" \
    '{model:$m,route:{provider:$p,authType:"api_key",model:$m}}')" >/dev/null
  api PATCH "/api/v1/routing/$1/recording" '{"enabled":true}' >/dev/null
  log "route $1: default -> $2/$3"
}
route sim-opencode-free opencode opencode/big-pickle
route sim-opencode-go opencode-go opencode-go/deepseek-v4.1-flash
route sim-codex openai gpt-5.5
api PUT /api/v1/routing/sim-opencode-go/tiers/default/fallbacks \
  '{"models":["gpt-5.5-mini"],"routes":[{"provider":"openai","authType":"api_key","model":"gpt-5.5-mini"}]}' >/dev/null
log "fallback sim-opencode-go: openai/gpt-5.5-mini"

date -u +%FT%TZ >"$STATE/seeded"
log "seed done"
