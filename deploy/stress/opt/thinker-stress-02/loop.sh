#!/bin/bash
# /opt/thinker-stress-02/loop.sh
# Stress sem fim: a cada degrau sobe mais um lote de geradores (um por
# harness), que rodam para sempre (--restart unless-stopped), ate esgotar
# CPU, memoria e I/O do servidor. Nunca para sozinho.
# Uso:
#   ./loop.sh iniciar     sobe degraus ate MAX_DEGRAUS e segura a carga
#   ./loop.sh status      geradores, consumo e ultimo degrau
#   ./loop.sh parar       remove todos os geradores
set -euo pipefail
cd "$(dirname "$0")"
. ./.env

IMG=${WWZ_LOAD_IMAGE:-white-wizard-load:local}
NET=${NET:-network_public}
ALVO=${ALVO:-http://thinker-pool:2099}  # alias comum a todas as replicas
CONC=${CONC:-50}                       # concorrencia de cada gerador
AGENTES=${AGENTES:-25}                 # agentes de cada gerador agents
DEGRAU=${DEGRAU:-120}                  # segundos entre degraus
MAX_DEGRAUS=${MAX_DEGRAUS:-1000000}    # na pratica, sem fim
ROTULO=thinker.stress=loop

chave() { grep "^$1=" harnesses.keys | cut -d= -f2-; }

# gera <nome> <harness> <args do wwz-load...>
gera() {
  local nome=$1 h=$2; shift 2
  docker run -d --name "$nome" --label "$ROTULO" --restart unless-stopped \
    --network "$NET" --ulimit nofile=1048576:1048576 \
    --log-driver local --log-opt max-size=10m \
    -e WWZ_LOAD_KEY="$(chave "$h")" "$IMG" wwz-load "$@" >/dev/null
}

# um lote: um gerador por harness, cada um no seu tipo de cliente
lote() {
  local n=$1 h
  for h in h-openai-sdk-1 h-openai-sdk-2; do
    gera "st-$n-$h" "$h" run --target "$ALVO" --model auto --concurrency "$CONC" --duration 0 --progress 30s --timeout 300s
  done
  for h in h-anthropic-sdk-1 h-anthropic-sdk-2; do
    gera "st-$n-$h" "$h" run --target "$ALVO" --protocol anthropic --model auto --concurrency "$CONC" --duration 0 --progress 30s --timeout 300s
  done
  for h in h-opencode-1 h-opencode-2; do
    gera "st-$n-$h" "$h" agents --target "$ALVO" --model auto --profile coder --agents "$AGENTES" --turns 8 --duration 876000h --progress 30s
  done
  for h in h-hermes-1 h-hermes-2; do
    gera "st-$n-$h" "$h" agents --target "$ALVO" --model auto --profile pesquisa --agents "$AGENTES" --turns 6 --duration 876000h --progress 30s
  done
  for h in h-open-webui-1 h-open-webui-2; do
    gera "st-$n-$h" "$h" agents --target "$ALVO" --model auto --profile chat --agents "$AGENTES" --turns 20 --duration 876000h --progress 30s
  done
  for h in h-claude-code-1 h-claude-code-2; do
    gera "st-$n-$h" "$h" claude-code run --target "$ALVO" --auth api-key --key "$(chave "$h")" --model claude-sonnet-5-5 --concurrency "$CONC" --turns 3 --duration 876000h
  done
}

amostra() {
  local n=$1
  printf '%s degrau=%s geradores=%s ' "$(date -u +%FT%TZ)" "$n" "$(docker ps -q --filter label=$ROTULO | wc -l)"
  docker stats --no-stream --format '{{.Name}}={{.CPUPerc}}/{{.MemUsage}}' \
    $(docker ps --format '{{.Names}}' | grep -E '^(thinker-|wwz-(perfeito|falhas|lento|instavel)$)') | tr '\n' ' '
  echo
}

case "${1:-}" in
  iniciar)
    if [ -f reports/loop.pid ] && kill -0 "$(cat reports/loop.pid)" 2>/dev/null; then
      echo "ja existe um loop rodando (./loop.sh parar)"; exit 1;
    fi
    mkdir -p reports
    echo $$ > reports/loop.pid
    n=$(docker ps -a --filter label=$ROTULO --format '{{.Names}}' | sed -n 's/^st-\([0-9]*\)-.*/\1/p' | sort -n | tail -1)
    n=${n:-0}
    while [ "$n" -lt "$MAX_DEGRAUS" ]; do
      n=$((n + 1))
      lote "$n"
      amostra "$n" | tee -a reports/loop.log
      sleep "$DEGRAU"
    done
    while true; do amostra "$n" | tee -a reports/loop.log; sleep "$DEGRAU"; done
    ;;
  status)
    docker ps --filter label=$ROTULO --format '{{.Names}} {{.Status}}' | sort -V | tail -20
    tail -5 reports/loop.log 2>/dev/null || true
    ;;
  parar)
    [ -f reports/loop.pid ] && kill "$(cat reports/loop.pid)" 2>/dev/null || true
    rm -f reports/loop.pid
    docker ps -aq --filter label=$ROTULO | xargs -r docker rm -f >/dev/null
    echo "geradores removidos";
    ;;
  *) sed -n '/^# Stress sem fim/,/^set -euo/p' "$0" | sed '$d'; exit 2 ;;
esac
