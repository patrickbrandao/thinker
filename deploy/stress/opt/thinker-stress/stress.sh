#!/bin/bash
# /opt/thinker-stress/stress.sh
# Stress do Thinker com o wwz-load (White Wizard).
# Uso: ./stress.sh <modo> [flags extras do wwz-load]
#   base       carga direto no wwz-openai (teto do simulador)
#   conc N     concorrencia fixa N pelo Thinker (padrao 100)
#   rps N      taxa fixa N req/s pelo Thinker (padrao 200)
#   rampa      taxa crescendo de 50 a 2000 req/s
#   sweep      degraus 50,100,200,400,800,1600 req/s
#   agentes N  N agentes multi-turno com ferramentas (padrao 100)
#   traefik N  concorrencia N passando pelo Traefik com TLS (padrao 100)
#   falhas N   concorrencia N no modelo virtual com falhas e fallback
#   top        painel ao vivo do wwz-openai
set -euo pipefail
cd "$(dirname "$0")"
. ./.env

IMG=${WWZ_LOAD_IMAGE:-white-wizard-load:local}
NET=${NET:-network_public}
THINKER=${THINKER:-http://thinker-app:2099}
DUR=${DUR:-60s}
MODEL=${MODEL:-auto}
STAMP=$(date -u +%Y%m%d-%H%M%S)
mkdir -p reports && chmod 777 reports

# executa o wwz-load num container descartavel na rede dos servicos
wl() {
  docker run --rm --network "$NET" \
    --ulimit nofile=1048576:1048576 \
    ${EXTRA_DOCKER_ARGS:-} \
    -e WWZ_LOAD_KEY="${KEY:-$THINKER_AGENT_KEY}" \
    -e WWZ_ADMIN_TOKEN="$WWZ_ADMIN_TOKEN" \
    -v "$PWD/reports:/reports" "$IMG" wwz-load "$@"
}

modo=${1:-conc}; shift || true
case "$modo" in
  base)
    KEY=$WWZ_KEY_1 wl run --target http://wwz-openai:8000 --concurrency "${1:-100}" \
      --duration "$DUR" --admin http://wwz-openai:9000 --output json --out /reports/base-$STAMP.json "${@:2}" ;;
  conc)
    wl run --target "$THINKER" --model "$MODEL" --concurrency "${1:-100}" --duration "$DUR" \
      --warmup 5s --output json --out /reports/conc-$STAMP.json "${@:2}" ;;
  rps)
    wl run --target "$THINKER" --model "$MODEL" --rps "${1:-200}" --duration "$DUR" \
      --max-inflight 20000 --output json --out /reports/rps-$STAMP.json "${@:2}" ;;
  rampa)
    wl run --target "$THINKER" --model "$MODEL" --ramp 50:2000:5m --step-duration 15s \
      --max-inflight 20000 --output json --out /reports/rampa-$STAMP.json "$@" ;;
  sweep)
    wl run --target "$THINKER" --model "$MODEL" --sweep --sweep-rates 50,100,200,400,800,1600 \
      --step-duration 30s --sweep-stop-error-pct 30 --max-inflight 20000 \
      --output json --out /reports/sweep-$STAMP.json "$@" ;;
  agentes)
    wl agents --target "$THINKER" --model "$MODEL" --agents "${1:-100}" --profile mixed \
      --turns 5 --duration "$DUR" --retries 2 --output json --out /reports/agentes-$STAMP.json "${@:2}" ;;
  traefik)
    EXTRA_DOCKER_ARGS="--add-host $THINKER_HOST:$TRAEFIK_IP" \
      wl run --target "https://$THINKER_HOST" --model "$MODEL" --concurrency "${1:-100}" \
      --duration "$DUR" --output json --out /reports/traefik-$STAMP.json "${@:2}" ;;
  falhas)
    wl run --target "$THINKER" --model wwz-falhas --concurrency "${1:-100}" --duration "$DUR" \
      --output json --out /reports/falhas-$STAMP.json "${@:2}" ;;
  top)
    docker run --rm -it --network "$NET" -e WWZ_ADMIN_TOKEN="$WWZ_ADMIN_TOKEN" "$IMG" \
      wwz-load top --admin http://wwz-openai:9000 ;;
  *) sed -n 3,15p "$0"; exit 2 ;;
esac

# resumo do ultimo relatorio
ultimo=$(ls -t reports/*.json 2>/dev/null | head -1 || true)
[ -n "$ultimo" ] && jq -c '(.total // {}) | {requests, ok, errors, rps, ttft_p50: .ttft_ms.p50, ttft_p99: .ttft_ms.p99, e2e_p99: .e2e_ms.p99, errors_by_type, sessions}' "$ultimo";
