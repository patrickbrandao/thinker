#!/bin/bash
# /opt/thinker-stress-02/provisionar.sh
# Provisiona no Thinker: provedores apontando para as instancias do wwz,
# 12 harnesses (2 por tipo de cliente do wwz-load) e as rotas de cada um.
# Idempotente: pode rodar de novo depois de mudar algo.
set -euo pipefail
cd "$(dirname "$0")"
. ./.env

T="docker exec -e XDG_CONFIG_HOME=/tmp/thinker-cli thinker-app thinker"
TI="docker exec -i -e XDG_CONFIG_HOME=/tmp/thinker-cli thinker-app thinker"

# conecta <provedor> <rotulo> <chave> <base-url>: cria a conexao (se faltar) e
# aponta a base. Uma chave por instancia: o Thinker reaproveita a conexao
# quando a chave se repete, mesmo com outro rotulo.
conecta() {
  local p=$1 rotulo=$2 k=$3 base=$4 id
  id=$($T provider list </dev/null | jq -r --arg p "$p" --arg l "$rotulo" \
    '.providers[] | select(.provider==$p) | .connections[] | select(.label==$l and .is_active) | .id' | head -1)
  if [ -z "$id" ]; then
    id=$(printf '%s' "$k" | $TI provider connect "$p" --credential-stdin --agent h-openai-sdk-1 --label "$rotulo" | jq -r .id)
  fi
  $T connection set "$id" --base-url "$base" </dev/null >/dev/null
  echo "conexao $p/$rotulo -> $base";
}

# 1 - harnesses: nome plataforma categoria
while read -r nome plat cat; do
  $T agent create --name "$nome" --platform "$plat" --category "$cat" --if-absent </dev/null >/dev/null
  echo "harness $nome ($plat)";
done <<'EOF'
h-openai-sdk-1 openai-sdk app
h-openai-sdk-2 openai-sdk app
h-anthropic-sdk-1 anthropic-sdk app
h-anthropic-sdk-2 anthropic-sdk app
h-opencode-1 opencode coding
h-opencode-2 opencode coding
h-hermes-1 hermes personal
h-hermes-2 hermes personal
h-open-webui-1 open-webui automation
h-open-webui-2 open-webui automation
h-claude-code-1 claude-code coding
h-claude-code-2 claude-code coding
EOF

# 2 - provedores: uma conexao por instancia do wwz (rotulo = instancia)
n=0
for inst in perfeito falhas lento instavel; do
  n=$((n + 1)); k=$(grep "^WWZ_KEY_$n=" .env | cut -d= -f2-)
  W=http://wwz-$inst:8000
  conecta openai "$inst" "$k" "$W/openai"
  conecta anthropic "$inst" "$k" "$W/anthropic"
  conecta openrouter "$inst" "$k" "$W/openrouter"
  conecta gemini "$inst" "$k" "$W/gemini"
  conecta opencode-go "$inst" "$k" "$W/opencode/inference/go/openai"
  conecta opencode "$inst" "$k" "$W/opencode/inference/openai"
done
$T provider refresh </dev/null >/dev/null

# 3 - habilita todos os provedores em todos os harnesses
harnesses=$($T agent list </dev/null | jq -r '.agents[].agent_name | select(startswith("h-"))')
for h in $harnesses; do
  for p in openai anthropic openrouter gemini opencode-go opencode; do
    for inst in perfeito falhas lento instavel; do
      $T agent provider enable "$h" "$p" --label "$inst" </dev/null >/dev/null 2>&1 || true
    done
  done
done

# 4 - rota padrao: <harness> <provedor> <modelo>. Principal na instancia
# "falhas"; fallbacks em "instavel" e "perfeito" (cada harness exercita o
# failover). O CLI nao fixa o rotulo da chave nos fallbacks; a API REST fixa.
if [ -z "${THINKER_API_KEY:-}" ]; then
  k=$($T key create --name stress-02 </dev/null | jq -r '.key // .apiKey // .raw_key')
  echo "THINKER_API_KEY=$k" >> .env
  THINKER_API_KEY=$k
fi
api() {
  docker run --rm -i --network network_public curlimages/curl:8.11.1 -s -f -X "$1" \
    "http://thinker-app:2099/api/v1$2" -H "X-API-Key: $THINKER_API_KEY" \
    -H 'content-type: application/json' --data-binary @-
}
while read -r h p m; do
  $T agent configure "$h" --models "$m" --provider "$p" --key-label falhas --force </dev/null >/dev/null
  jq -n --arg p "$p" --arg m "$m" '{models: [$m, $m], routes: [
      {provider: $p, authType: "api_key", model: $m, keyLabel: "instavel"},
      {provider: $p, authType: "api_key", model: $m, keyLabel: "perfeito"}]}' \
    | api PUT "/routing/$h/tiers/default/fallbacks" >/dev/null
  echo "rota $h -> $p/$m (falhas -> instavel -> perfeito)";
done <<'EOF'
h-openai-sdk-1 openai wwz-fast
h-openai-sdk-2 openai wwz-realistic
h-anthropic-sdk-1 anthropic claude-haiku-5-5
h-anthropic-sdk-2 anthropic claude-sonnet-5-5
h-opencode-1 opencode-go opencode-go/glm-5.3
h-opencode-2 opencode-go opencode-go/kimi-k3
h-hermes-1 openrouter white-wizard/wwz-fast
h-hermes-2 openrouter white-wizard/wwz-realistic
h-open-webui-1 gemini wwz-fast
h-open-webui-2 opencode opencode/big-pickle
h-claude-code-1 anthropic claude-sonnet-5-5
h-claude-code-2 anthropic claude-haiku-5-5
EOF

# 4b - o gerador do Claude Code manda um ID concreto (claude-sonnet-5-5), e ID
# concreto e rota explicita, sem fallback. Um modelo virtual com esse nome, sem
# principal e com Continue on Default, herda a cadeia do tier default
# (falhas -> instavel -> perfeito)
for h in h-claude-code-1 h-claude-code-2; do
  jq -n '{name: "claude-sonnet-5-5", continue_on_default: true}' \
    | api POST "/routing/$h/virtual-models" >/dev/null
  echo "virtual $h claude-sonnet-5-5 -> cadeia do default";
done

# 5 - chaves dos harnesses num arquivo 600 (lido pelo loop)
umask 077
: > harnesses.keys
for h in $harnesses; do
  printf '%s=%s\n' "$h" "$($T agent key show "$h" --raw </dev/null)" >> harnesses.keys
done
echo "chaves em $(pwd)/harnesses.keys";
