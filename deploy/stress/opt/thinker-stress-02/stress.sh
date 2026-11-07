#!/bin/bash
# /opt/thinker-stress-02/stress.sh
# Dispara e para o stress do tutorial thinker-with-white-wizard-02.md.
# Uso:
#   ./stress.sh iniciar               com freios: limites do compose, REPLICAS (3) e MAX_DEGRAUS (10)
#   ./stress.sh iniciar --sem-freios  secao 8.3: sem limite de CPU/memoria, fsync no banco,
#                                     uma replica por 4 nucleos e degraus sem fim
#   ./stress.sh status                geradores, replicas e ultimas amostras
#   ./stress.sh parar                 para o loop, volta a 1 replica e tira o override
# Ajustes (variaveis): REPLICAS, CONC, AGENTES, DEGRAU, MAX_DEGRAUS (ver loop.sh)
set -euo pipefail
cd "$(dirname "$0")"
. ./.env

OVERRIDE=/opt/thinker/docker-compose.override.yml

zera_wwz() {
  local i
  for i in perfeito falhas lento instavel; do
    docker run --rm --network network_public curlimages/curl:8.11.1 -s -X POST \
      "http://wwz-$i:9000/admin/reset" -H "Authorization: Bearer $WWZ_ADMIN_TOKEN" >/dev/null || true
  done
}

case "${1:-}" in
  iniciar)
    if [ "${2:-}" = "--sem-freios" ]; then
      echo "CUIDADO: sem limites, o stress disputa CPU, memoria e disco com os outros servicos do servidor.";
      read -r -p "Digite SIM para continuar: " ok
      [ "$ok" = "SIM" ] || { echo "cancelado"; exit 1; }
      cp sem-freios.override.yml "$OVERRIDE"
      (cd /opt/thinker && docker compose up -d --wait >/dev/null)
      REPLICAS=${REPLICAS:-$(( $(nproc) / 4 ))}
      export MAX_DEGRAUS=${MAX_DEGRAUS:-1000000}
    else
      rm -f "$OVERRIDE"
      REPLICAS=${REPLICAS:-3}
      export MAX_DEGRAUS=${MAX_DEGRAUS:-10}
    fi
    /opt/thinker/escala.sh "$REPLICAS" | tail -"$REPLICAS"
    zera_wwz
    docker exec thinker-postgres psql -U thinker -d thinker -qc 'select pg_stat_statements_reset()' >/dev/null || true
    mkdir -p reports
    # cada rodada comeca um loop.log novo; o anterior fica com a data
    [ -f reports/loop.log ] && mv reports/loop.log "reports/loop-$(date -u +%Y%m%d-%H%M%S).log"
    setsid nohup ./loop.sh iniciar > reports/loop.out 2>&1 < /dev/null &
    sleep 3
    echo "loop iniciado: $REPLICAS replicas, MAX_DEGRAUS=$MAX_DEGRAUS, DEGRAU=${DEGRAU:-120}s";
    echo "acompanhe: tail -f $(pwd)/reports/loop.log   |   pare: $(pwd)/stress.sh parar";
    ;;
  status)
    ./loop.sh status
    docker ps --filter name=thinker-app --format '{{.Names}} {{.Status}}' | sort -V
    [ -f "$OVERRIDE" ] && echo "modo: sem freios" || echo "modo: com freios"
    ;;
  parar)
    ./loop.sh parar
    rm -f "$OVERRIDE"
    /opt/thinker/escala.sh 1 | tail -1
    (cd /opt/thinker && rm -f docker-compose.replicas.yml && docker compose up -d --wait >/dev/null)
    echo "Thinker de volta a 1 replica, com os limites do compose";
    ;;
  *) sed -n '/^# Dispara/,/^set -euo/p' "$0" | sed '$d'; exit 2 ;;
esac
