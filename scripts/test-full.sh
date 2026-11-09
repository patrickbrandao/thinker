#!/usr/bin/env bash
# Full test mode ("teste completo"): everything the CI runs, locally, in one go.
# Runs only when asked (never from ship.sh or a hook).
#
#   scripts/test-full.sh                 all stages
#   scripts/test-full.sh --skip e2e      skip stages by name (comma separated)
#   scripts/test-full.sh --only unit     run only the named stages
#   scripts/test-full.sh --fail-fast     stop at the first failing stage
#
# Stages (in order): static, build, unit, scripts, e2e, contracts
#   static    eslint, i18n check, design registry, typecheck (TS 6 and TS 7)
#   build     shared, backend, frontend, CLI; fails if a build changes tracked files
#   unit      backend (UTC and America/Sao_Paulo), frontend, shared, CLI
#   scripts   node --test scripts/*.test.js
#   e2e       backend e2e on a disposable PostgreSQL, in UTC and America/Sao_Paulo
#   contracts gateway contracts, only when THINKER_BASE_URL points at a running
#             instance (never the maintainer's own one on :2099)
#
# The built-image stage (compose smoke, harness matrix) needs isolated ports and
# volumes: run it with the `qa-docker` agent (docs/dev/guia.md, "Teste completo").
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
LOG_DIR="${THINKER_TEST_LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/thinker-test-full.XXXXXX")}"
mkdir -p "$LOG_DIR"
ALL_STAGES=(static build unit scripts e2e contracts)
SKIP=","
ONLY=""
FAIL_FAST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --skip) SKIP=",$2,"; shift 2 ;;
    --only) ONLY=",$2,"; shift 2 ;;
    --fail-fast) FAIL_FAST=1; shift ;;
    -h | --help) sed -n 2,22p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

RESULTS=()
FAILED=0

selected() {
  if [ -n "$ONLY" ]; then [[ "$ONLY" == *",$1,"* ]]; else [[ "$SKIP" != *",$1,"* ]]; fi
}

# step <stage> <label> <command...>: runs one command, logs it, records the result.
step() {
  local stage=$1 label=$2
  shift 2
  local log="$LOG_DIR/${stage}-$(printf %s "$label" | tr -c "A-Za-z0-9._-" _).log"
  local start=$SECONDS
  printf '  → %-48s ' "$label"
  if "$@" >"$log" 2>&1; then
    printf 'ok   (%ss)\n' "$((SECONDS - start))"
    RESULTS+=("PASS|$stage|$label|$((SECONDS - start))|")
  else
    printf 'FAIL (%ss)  log: %s\n' "$((SECONDS - start))" "$log"
    RESULTS+=("FAIL|$stage|$label|$((SECONDS - start))|$log")
    FAILED=1
    [ "$FAIL_FAST" = 1 ] && summary && exit 1
  fi
}

skip_step() {
  printf '  → %-48s skipped (%s)\n' "$2" "$3"
  RESULTS+=("SKIP|$1|$2|0|$3")
}

summary() {
  echo
  echo "== Summary (logs in $LOG_DIR)"
  local pass=0 fail=0 skipped=0 r
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r status stage label secs extra <<<"$r"
    case $status in PASS) pass=$((pass + 1)) ;; FAIL) fail=$((fail + 1)) ;; SKIP) skipped=$((skipped + 1)) ;; esac
    [ "$status" = FAIL ] && echo "  FAIL  $stage / $label  ($extra)"
  done
  echo "  $pass passed, $fail failed, $skipped skipped"
}

stage_static() {
  step static "eslint" npm run lint
  step static "i18n catalogs" npm run check:i18n --workspace=thinker-frontend
  step static "design registry" npm run design:registry:check
  step static "typecheck (TypeScript 6)" npm run typecheck --workspaces --if-present
  step static "typecheck (TypeScript 7)" npm run typecheck:ts7
}

stage_build() {
  local before after
  before=$(git status --porcelain --untracked-files=all)
  step build "shared" npm run build --workspace=packages/shared
  step build "backend" npm run build --workspace=packages/backend
  step build "frontend" npm run build --workspace=packages/frontend
  step build "cli" npm run build --workspace=packages/cli
  after=$(git status --porcelain --untracked-files=all)
  if [ "$before" = "$after" ]; then
    step build "generated files are up to date" true
  else
    step build "generated files are up to date" bash -c 'echo "a build changed tracked or untracked files:"; diff <(printf "%s\n" "$0") <(printf "%s\n" "$1"); exit 1' "$before" "$after"
  fi
}

stage_unit() {
  # Shared is consumed from its build output by every other package.
  step unit "shared build" npm run build --workspace=packages/shared
  step unit "backend (UTC)" env TZ=UTC npm test --workspace=packages/backend
  step unit "backend (America/Sao_Paulo)" env TZ=America/Sao_Paulo npm test --workspace=packages/backend
  step unit "frontend" npm test --workspace=packages/frontend
  step unit "shared" npm test --workspace=packages/shared
  step unit "cli" npm test --workspace=packages/cli
}

stage_scripts() {
  step scripts "repo scripts" npm run test:scripts
}

stage_e2e() {
  if ! docker info >/dev/null 2>&1; then
    skip_step e2e "backend e2e" "Docker is not running"
    FAILED=1
    return
  fi
  step e2e "backend e2e (UTC)" env TZ=UTC npm run test:e2e:docker --workspace=packages/backend
  step e2e "backend e2e (America/Sao_Paulo)" env TZ=America/Sao_Paulo npm run test:e2e:docker --workspace=packages/backend
}

stage_contracts() {
  case "${THINKER_BASE_URL:-}" in
    "") skip_step contracts "gateway contracts" "THINKER_BASE_URL not set" ;;
    *:2099 | *:2099/*) skip_step contracts "gateway contracts" "refusing the maintainer's instance on :2099"; FAILED=1 ;;
    *) step contracts "gateway contracts" node --test contracts/gateway/tests/*.test.mjs ;;
  esac
}

echo "Thinker full test mode  ($ROOT)"
for s in "${ALL_STAGES[@]}"; do
  selected "$s" || continue
  echo "== $s"
  "stage_$s"
done
summary
exit "$FAILED"
