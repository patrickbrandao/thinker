#!/bin/bash
# /opt/thinker/escala.sh
# Sobe N replicas do Thinker (thinker-app + thinker-app-2..N) atras do mesmo
# alias de rede (thinker-pool) e do mesmo servico do Traefik.
# Uso: ./escala.sh N      (N=1 volta a uma replica so)
set -euo pipefail
cd /opt/thinker
N=${1:?informe o numero de replicas}
POOL=${DB_POOL_POR_REPLICA:-40}

{
  echo "# gerado por escala.sh: replicas extras do thinker-app"
  if [ "$N" -lt 2 ]; then echo "services: {}"; else echo "services:"; fi
  i=2
  while [ "$i" -le "$N" ]; do
    cat <<EOF
  thinker-app-$i:
    extends: {file: docker-compose.yml, service: thinker-app}
    container_name: thinker-app-$i
    environment:
      RUN_MIGRATIONS_ON_BOOT: "false"
      DB_POOL_MAX: "$POOL"
    depends_on:
      thinker-app: {condition: service_healthy}
EOF
    i=$((i + 1))
  done
} > docker-compose.replicas.yml

# replicas que sobraram de uma escala maior
for c in $(docker ps -a --format '{{.Names}}' | grep -E '^thinker-app-[0-9]+$' || true); do
  if [ "${c#thinker-app-}" -gt "$N" ]; then docker rm -f "$c" >/dev/null; echo "removida $c"; fi;
done

DB_POOL_MAX=$POOL docker compose -f docker-compose.yml -f docker-compose.replicas.yml up -d --wait
docker ps --filter name=thinker-app --format '{{.Names}} {{.Status}}' | sort -V
