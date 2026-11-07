# Thinker com White Wizard #2 – Todos os provedores, todos os harnesses, stress sem fim

Saudações. Nesse tutorial vou ensinar como estressar o **Thinker** com **todos** os provedores que o **White Wizard** simula, **dois harnesses de cada tipo** de cliente que o `wwz-load` sabe imitar e um **loop sem fim** que só para quando o servidor não tiver mais CPU, memória e disco para dar.

Pré-requisitos:

- O tutorial **#1** concluído (`thinker-with-white-wizard-01.md`): Thinker **0.31.6** ou mais novo em `/opt/thinker`, as imagens `white-wizard:local`, `white-wizard-panel:local` e `white-wizard-load:local`, o Traefik na `network_public` e os atalhos `thk`/`thki`;
- DNS de `wwz-todos-panel.seudominio.com.br` apontando para o servidor;
- Um servidor que você **aceita derrubar**. O loop da seção 8 não tem freio.

Os arquivos deste tutorial (e o `stress.sh` de disparo da seção 8.4) estão em [`deploy/stress/opt/`](../../deploy/stress/README.md), no mesmo caminho do servidor.

**CRÍTICO**: não rode este teste num servidor que tem outros serviços de produção. Ele foi feito para esgotar recursos; o kernel vai começar a matar processo por falta de memória e o disco vai encher de gravações. Você foi avisado.

## 1 – O que muda em relação ao #1

No #1 era um provedor, um harness e uma réplica. Agora:

- **4 instâncias do wwz**, cada uma com os **6 drivers** (OpenAI, Anthropic, OpenRouter, OpenCode, Gemini e Azure) e um comportamento:
  - **wwz-perfeito**: sem erro e latência zero;
  - **wwz-falhas**: **20%** de erros variados, inclusive no meio do stream;
  - **wwz-lento**: latência de cauda pesada (p99 do TTFT em 20 s);
  - **wwz-instavel**: 2% de erros e uma **janela de indisponibilidade** de 2 minutos a cada 10;
- **6 provedores nativos** no Thinker, cada um com **4 conexões** (uma por instância);
- **12 harnesses**, dois por tipo de cliente do `wwz-load`, com rota principal na instância de falhas e fallback em cascata;
- **N réplicas** do `thinker-app` atrás de um alias de rede;
- **Geradores eternos**: containers do `wwz-load` com `--restart unless-stopped`, adicionados em degraus.

O desenho:

```Text
geradores (st-N-h-*) --> thinker-pool:2099 --> thinker-app, thinker-app-2 ... thinker-app-N
                                                    |
                    +-------------------------------+-------------------------------+
                    v               v               v               v               |
              wwz-perfeito     wwz-falhas       wwz-lento      wwz-instavel         +--> thinker-postgres
              /openai /anthropic /openrouter /opencode /gemini /azure (em cada uma)
```

## 2 – Preparando

Crie o diretório do teste e confira que o Thinker do #1 está de pé:

```Bash
mkdir -p /opt/wwz-todos/run /opt/thinker-stress-02/reports;
docker ps --filter name=thinker --format '{{.Names}} {{.Image}} {{.Status}}';
    # thinker-app tmsoftbrasil/thinker:0.31.6 Up 2 hours (healthy)
    # thinker-postgres postgres:18-alpine Up 2 hours (healthy)
```

**CUIDADO**: o Thinker reaproveita a conexão quando a **chave se repete**, mesmo com outro rótulo. Por isso cada instância do wwz tem a sua própria chave; com uma chave só, as quatro "conexões" viram uma e a última base URL vence.

Gere as credenciais:

```Bash
cd /opt/wwz-todos;
umask 077;
( echo "DOMINIO=seudominio.com.br";
  echo "WWZ_ADMIN_TOKEN=$(openssl rand -hex 24)";
  echo "WWZ_PANEL_ADMIN_PASSWORD=$(openssl rand -hex 12)";
  for n in 1 2 3 4; do echo "WWZ_KEY_$n=wwz-key-$(openssl rand -hex 12)"; done;
) > .env;
chmod 600 .env;
```

## 3 – White Wizard com todos os drivers

#### 3.1 – Configuração

Um YAML só serve as quatro instâncias. Os perfis de erro e de latência entram por `envsubst` na hora de renderizar. Três detalhes que custaram horas de investigação:

- **OpenCode**: o Thinker descobre os modelos do OpenCode pelo **catálogo dele**, não pelo `/v1/models` da base configurada. O simulador precisa servir **os mesmos ids do catálogo real** (`glm-5.3`, `kimi-k3`, `big-pickle`), senão nada roteia;
- **Gratuitos do OpenCode**: como no real, são **200 requisições por dia**. Para stress, `free_requests_per_day` vai às alturas;
- **Claude**: o Claude Code pede `claude-sonnet-5-5` e companhia; esses ids existem só no driver `anthropic`.

Crie `/opt/wwz-todos/todos.yaml`:

```YAML
# /opt/wwz-todos/todos.yaml
# White Wizard com os seis drivers por prefixo. Modelo renderizado com envsubst:
# ${WWZ_KEY_1..4} (chaves) e ${WWZ_ERROS}/${WWZ_LATENCIA} (perfil desta instancia).
server:
  listen: ":8000"
  auth: keys
  reuseport: true
  concurrency: 1000000
  trusted_proxies: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]

admin:
  listen: ":9000"

store:
  event_stream: true

usage:
  extended: true

drivers:
  - {name: openai, prefix: /openai}
  - {name: anthropic, prefix: /anthropic}
  - {name: openrouter, prefix: /openrouter}
  # gratuitos: 200 requisicoes por dia por padrao, como no real
  - {name: opencode, prefix: /opencode, options: {free_requests_per_day: 1000000000}}
  - {name: gemini, prefix: /gemini}
  - {name: azure, prefix: /azure}

accounts:
  - {id: conta-stress}

keys:
  - {key: ${WWZ_KEY_1}, label: stress-1, account: conta-stress}
  - {key: ${WWZ_KEY_2}, label: stress-2, account: conta-stress}
  - {key: ${WWZ_KEY_3}, label: stress-3, account: conta-stress}
  - {key: ${WWZ_KEY_4}, label: stress-4, account: conta-stress}

profiles:
  latency:
    rapida: {ttft: 0ms, itl: 0ms}
    realista: {queue: {dist: lognormal, median: 20ms, p99: 300ms}, ttft: {dist: normal, mean: 450ms, stddev: 120ms}, itl: {dist: normal, mean: 18ms, stddev: 4ms}}
    cauda: {queue: {dist: lognormal, median: 50ms, p99: 8s}, ttft: {dist: lognormal, median: 800ms, p99: 20s}, itl: {dist: normal, mean: 30ms, stddev: 15ms}}
  errors:
    sem-erro: {rate: 0}
    falhas-20: {rate: 20, types: [rate_limit, server_error, overloaded, bad_gateway, gateway_timeout, connection_reset], mid_stream_rate: 6, mid_stream_types: [stream_truncated, stream_error_event]}
    instavel:
      rate: 2
      types: [server_error]
      outages:
        - {schedule: "0 */10 * * * *", duration: 2m, type: overloaded}

models:
  - {id: wwz-fast, owned_by: white-wizard, protocols: ["*"], context_window: 128000, capabilities: {tools: true, reasoning: true, json_schema: true}, latency: "${WWZ_LATENCIA}", errors: "${WWZ_ERROS}", generation: default}
  - {id: wwz-realistic, owned_by: white-wizard, protocols: ["*"], context_window: 128000, capabilities: {tools: true, reasoning: true}, latency: realista, errors: "${WWZ_ERROS}", generation: default}
  # ids que os clientes Anthropic e o Claude Code pedem
  - {id: claude-sonnet-5-5, owned_by: anthropic, drivers: [anthropic], protocols: [anthropic], context_window: 1000000, max_output: 128000, capabilities: {tools: true, reasoning: true, json_schema: true}, pricing: {input_per_m: 2, output_per_m: 10}, latency: "${WWZ_LATENCIA}", errors: "${WWZ_ERROS}", generation: default}
  - {id: claude-haiku-5-5, owned_by: anthropic, drivers: [anthropic], protocols: [anthropic], context_window: 1000000, max_output: 128000, capabilities: {tools: true, reasoning: true, json_schema: true}, pricing: {input_per_m: 0.1, output_per_m: 0.5}, latency: "${WWZ_LATENCIA}", errors: "${WWZ_ERROS}", generation: default}
  # ids do catalogo real do OpenCode: o Thinker descobre os modelos do OpenCode
  # pelo catalogo dele, nao pelo /v1/models da base configurada
  - {id: glm-5.3, owned_by: zhipu, drivers: [opencode], protocols: [openai], catalogs: {opencode-go: {}}, latency: "${WWZ_LATENCIA}", errors: "${WWZ_ERROS}", generation: default}
  - {id: kimi-k3, owned_by: moonshot, drivers: [opencode], protocols: [openai], catalogs: {opencode-go: {}}, latency: "${WWZ_LATENCIA}", errors: "${WWZ_ERROS}", generation: default}
  - {id: big-pickle, owned_by: opencode, drivers: [opencode], protocols: [openai], catalogs: {opencode: {pricing: {input_per_m: 0, output_per_m: 0}}}, latency: "${WWZ_LATENCIA}", errors: "${WWZ_ERROS}", generation: default}
```

Renderize as quatro instâncias e valide cada uma:

```Bash
cd /opt/wwz-todos;
set -a; . ./.env; set +a;
for inst in perfeito:sem-erro:rapida falhas:falhas-20:realista lento:sem-erro:cauda instavel:instavel:rapida; do
  n=${inst%%:*}; r=${inst#*:};
  WWZ_ERROS=${r%%:*} WWZ_LATENCIA=${r#*:} \
    envsubst '${WWZ_KEY_1} ${WWZ_KEY_2} ${WWZ_KEY_3} ${WWZ_KEY_4} ${WWZ_ERROS} ${WWZ_LATENCIA}' \
    < todos.yaml > run/$n.yaml;
  chmod 644 run/$n.yaml;
  docker run --rm -v $PWD/run/$n.yaml:/w.yaml:ro white-wizard:local validate -config /w.yaml | head -1;
done;
    # ok    config /w.yaml (7 models, 6 drivers, 4 keys)
    # ok    config /w.yaml (7 models, 6 drivers, 4 keys)
    # ok    config /w.yaml (7 models, 6 drivers, 4 keys)
    # ok    config /w.yaml (7 models, 6 drivers, 4 keys)
```

#### 3.2 – Compose

Só a instância **perfeito** grava no Valkey (é ela que o painel acompanha); as outras guardam contadores em memória, cada uma isolada. Crie `/opt/wwz-todos/docker-compose.yml`:

```YAML
# /opt/wwz-todos/docker-compose.yml
# White Wizard com os seis drivers em quatro instancias de comportamento
# diferente (perfeito, falhas, lento, instavel), Valkey e painel admin.
name: wwz-todos

x-wwz: &wwz
  image: white-wizard:local
  restart: unless-stopped
  read_only: true
  tmpfs: [/run, /tmp]
  security_opt: ["no-new-privileges:true"]
  cap_drop: [ALL]
  cpus: ${WWZ_CPUS:-4}
  mem_limit: ${WWZ_MEM:-8g}
  ulimits:
    nofile: {soft: 1048576, hard: 1048576}
  healthcheck:
    test: ["CMD", "/usr/local/bin/healthcheck", "http://127.0.0.1:9000/health/ready"]
    interval: 5s
    timeout: 3s
    retries: 10
  networks: [interna, network_public]

services:
  wwz-perfeito:
    <<: *wwz
    container_name: wwz-perfeito
    environment:
      WWZ_CONFIG: /etc/wwz/wwz.yaml
      WWZ_ADMIN_TOKEN: ${WWZ_ADMIN_TOKEN}
      WWZ_VALKEY_ADDR: wwz-todos-valkey:6379
      WWZ_LOG_LEVEL: warn
      GOGC: "200"
    volumes: ["./run/perfeito.yaml:/etc/wwz/wwz.yaml:ro"]
    depends_on:
      wwz-todos-valkey: {condition: service_healthy}

  wwz-falhas:
    <<: *wwz
    container_name: wwz-falhas
    environment: &memoria
      WWZ_CONFIG: /etc/wwz/wwz.yaml
      WWZ_ADMIN_TOKEN: ${WWZ_ADMIN_TOKEN}
      WWZ_STORE: memory
      WWZ_LOG_LEVEL: warn
      GOGC: "200"
    volumes: ["./run/falhas.yaml:/etc/wwz/wwz.yaml:ro"]

  wwz-lento:
    <<: *wwz
    container_name: wwz-lento
    environment: *memoria
    volumes: ["./run/lento.yaml:/etc/wwz/wwz.yaml:ro"]

  wwz-instavel:
    <<: *wwz
    container_name: wwz-instavel
    environment: *memoria
    volumes: ["./run/instavel.yaml:/etc/wwz/wwz.yaml:ro"]

  wwz-todos-valkey:
    image: valkey/valkey:8.1-alpine
    container_name: wwz-todos-valkey
    restart: unless-stopped
    user: "999:999"
    command: ["valkey-server", "--save", "", "--appendonly", "no", "--maxmemory", "2gb"]
    tmpfs: [/run, /data]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 2s
      retries: 10
    networks: [interna]

  wwz-todos-panel:
    image: white-wizard-panel:local
    container_name: wwz-todos-panel
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    environment:
      WWZ_PANEL_LISTEN: ":8100"
      WWZ_PANEL_DB: /data/panel.db
      WWZ_PANEL_PUBLIC_URL: https://wwz-todos-panel.${DOMINIO}
      WWZ_PANEL_VALKEY_ADDR: wwz-todos-valkey:6379
      WWZ_PANEL_WWZ_ADMIN_URL: http://wwz-perfeito:9000
      WWZ_ADMIN_TOKEN: ${WWZ_ADMIN_TOKEN}
      WWZ_PANEL_ADMIN_USER: admin
      WWZ_PANEL_ADMIN_PASSWORD: ${WWZ_PANEL_ADMIN_PASSWORD}
    volumes: [panel-data:/data]
    depends_on:
      wwz-perfeito: {condition: service_healthy}
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck", "http://127.0.0.1:8100/health/ready"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [interna, network_public]
    labels:
      traefik.enable: "true"
      traefik.docker.network: network_public
      traefik.http.routers.wwz-todos-panel.entrypoints: web,websecure
      traefik.http.routers.wwz-todos-panel.rule: Host(`wwz-todos-panel.${DOMINIO}`)
      traefik.http.routers.wwz-todos-panel.tls: "true"
      traefik.http.routers.wwz-todos-panel.tls.certresolver: letsencrypt
      traefik.http.routers.wwz-todos-panel.service: wwz-todos-panel
      traefik.http.services.wwz-todos-panel.loadbalancer.server.port: "8100"

volumes:
  panel-data: {name: wwz-todos-panel-data}

networks:
  interna:
    name: wwz-todos-interna
  network_public:
    external: true
    name: network_public
```

Para subir e conferir cada driver numa instância, execute:

```Bash
cd /opt/wwz-todos; . ./.env;
docker compose up -d --wait;

C="docker run --rm --network network_public curlimages/curl:8.11.1 -s";
W=http://wwz-perfeito:8000;
$C $W/openai/v1/models -H "Authorization: Bearer $WWZ_KEY_1" | jq -r '[.data[].id] | join(" ")';
    # wwz-fast wwz-realistic
$C $W/anthropic/v1/models -H "x-api-key: $WWZ_KEY_1" -H 'anthropic-version: 2023-06-01' | jq -r '[.data[].id] | join(" ")';
    # wwz-fast wwz-realistic claude-sonnet-5-5 claude-haiku-5-5
$C $W/openrouter/api/v1/models -H "Authorization: Bearer $WWZ_KEY_1" | jq -r '[.data[].id] | join(" ")';
    # white-wizard/wwz-fast white-wizard/wwz-realistic
$C $W/opencode/inference/go/v1/models -H "Authorization: Bearer $WWZ_KEY_1" | jq -r '[.data[].id] | join(" ")';
    # wwz-fast wwz-realistic glm-5.3 kimi-k3
$C "$W/gemini/v1beta/models?key=$WWZ_KEY_1" | jq -r '[.models[].name] | join(" ")';
    # models/wwz-fast models/wwz-realistic
$C $W/azure/openai/v1/models -H "api-key: $WWZ_KEY_1" | jq -r '[.data[].id] | join(" ")';
    # wwz-fast wwz-realistic
```

O painel fica em `https://wwz-todos-panel.seudominio.com.br` (usuário `admin`, senha no `.env`).

## 4 – Os provedores no Thinker

Cada driver do wwz vira um **provedor nativo** do Thinker com a base URL da conexão trocada (o mesmo truque do #1):

| Driver do wwz | Provedor no Thinker | Base URL da conexão |
| --- | --- | --- |
| `openai` | `openai` | `http://wwz-<inst>:8000/openai` |
| `anthropic` | `anthropic` | `http://wwz-<inst>:8000/anthropic` |
| `openrouter` | `openrouter` | `http://wwz-<inst>:8000/openrouter` |
| `gemini` | `gemini` | `http://wwz-<inst>:8000/gemini` |
| `opencode` (Go) | `opencode-go` | `http://wwz-<inst>:8000/opencode/inference/go/openai` |
| `opencode` (Zen) | `opencode` | `http://wwz-<inst>:8000/opencode/inference/openai` |
| `azure` | provedor **custom** OpenAI | `http://wwz-<inst>:8000/azure/openai/v1` |

O Thinker não tem provedor Azure nativo. O endpoint `/openai/v1` do Azure aceita `Authorization: Bearer`, então um provedor custom do tipo OpenAI resolve (`thk provider custom add --name wwz-azure --endpoint http://wwz-perfeito:8000/azure/openai/v1 --api openai --credential-stdin`). Ele fica fora do provisionamento automático para não poluir os fallbacks.

## 5 – Os 12 harnesses

O `wwz-load` imita seis tipos de cliente. Cada tipo ganha duas plataformas do Thinker que falam a mesma superfície:

| Cliente do wwz-load | Plataforma | Harnesses | Rota principal |
| --- | --- | --- | --- |
| `run` (SDK OpenAI, Chat Completions) | OpenAI SDK | `h-openai-sdk-1`, `-2` | `openai` / `wwz-fast`, `wwz-realistic` |
| `run --protocol anthropic` (SDK Anthropic, Messages) | Anthropic SDK | `h-anthropic-sdk-1`, `-2` | `anthropic` / `claude-haiku-5-5`, `claude-sonnet-5-5` |
| `agents --profile coder` (agente de código com ferramentas) | OpenCode | `h-opencode-1`, `-2` | `opencode-go` / `glm-5.3`, `kimi-k3` |
| `agents --profile pesquisa` (busca e fetch) | Hermes Agent | `h-hermes-1`, `-2` | `openrouter` / `white-wizard/wwz-fast`, `wwz-realistic` |
| `agents --profile chat` (histórico longo) | Open WebUI | `h-open-webui-1`, `-2` | `gemini` / `wwz-fast`; `opencode` / `big-pickle` |
| `claude-code` (Claude Code 2.1.308 byte a byte) | Claude Code | `h-claude-code-1`, `-2` | `anthropic` / `claude-sonnet-5-5`, `claude-haiku-5-5` |

Toda rota tem a mesma cascata: principal na **falhas**, fallback na **instavel** e por fim na **perfeito**. Cada harness exercita o failover do Thinker o tempo todo.

**CUIDADO**: o CLI (`--models`, `--fallback`) não fixa o **rótulo da chave** num fallback, só o nome do modelo, e uma rota com rótulo que não existe cai em qualquer conexão do provedor sem aviso. O script usa a API REST (`routes[].keyLabel`) com uma chave de API admin.

## 6 – Provisionando

O script cria os harnesses, as 24 conexões, as rotas com a cascata e guarda as chaves dos harnesses num arquivo `600`. É idempotente: rode de novo depois de mudar qualquer coisa.

Crie `/opt/thinker-stress-02/provisionar.sh`:

```Bash
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
```

O script lê as chaves do wwz do `.env` do próprio diretório. Junte os dois `.env` e rode:

```Bash
cd /opt/thinker-stress-02;
umask 077;
( grep -E '^(WWZ_KEY_[1-4]|WWZ_ADMIN_TOKEN)=' /opt/wwz-todos/.env;
  echo "WWZ_LOAD_IMAGE=white-wizard-load:local";
) > .env;
chmod 600 .env;
chmod +x provisionar.sh;
./provisionar.sh | tail -3;
    # rota h-claude-code-1 -> anthropic/claude-sonnet-5-5 (falhas -> instavel -> perfeito)
    # rota h-claude-code-2 -> anthropic/claude-haiku-5-5 (falhas -> instavel -> perfeito)
    # chaves em /opt/thinker-stress-02/harnesses.keys
```

Para provar que os 12 respondem, mande uma requisição real em cada um:

```Bash
for h in $(thk agent list | jq -r '.agents[].agent_name | select(startswith("h-"))'); do
  printf '%-18s ' $h; thk routing test $h "diga ok" </dev/null | jq -c '{ok, surface, served_model}';
done;
    # h-claude-code-2    {"ok":true,"surface":"messages","served_model":"claude-haiku-5-5"}
    # h-open-webui-2     {"ok":true,"surface":"chat_completions","served_model":"big-pickle"}
    # h-opencode-1       {"ok":true,"surface":"chat_completions","served_model":"glm-5.3"}
    # h-hermes-1         {"ok":true,"surface":"chat_completions","served_model":"white-wizard/wwz-fast"}
    # ...
```

## 7 – Escalando o Thinker

Uma réplica do Thinker entrega ~125 req/s (tutorial #1, seção 8). Para usar o servidor inteiro, suba réplicas. Todas entram no alias de rede **`thinker-pool`** (o DNS do Docker distribui as conexões) e no mesmo serviço do Traefik.

Crie `/opt/thinker/escala.sh`:

```Bash
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
```

Para subir 3 réplicas e medir, execute:

```Bash
chmod +x /opt/thinker/escala.sh;
/opt/thinker/escala.sh 3;
    # thinker-app Up 24 seconds (healthy)
    # thinker-app-2 Up 19 seconds (healthy)
    # thinker-app-3 Up 18 seconds (healthy)

# o alias responde com os tres IPs
docker run --rm --network network_public alpine:3.20 getent ahosts thinker-pool | awk '{print $1}' | sort -u | grep -v :;
    # 172.20.0.13
    # 172.20.0.14
    # 172.20.0.7

# o mesmo stress do #1, agora contra o pool
THINKER=http://thinker-pool:2099 DUR=25s /opt/thinker-stress/stress.sh conc 300;
    # {"requests":8460,"ok":8460,"errors":0,"rps":338.4,"ttft_p50":53.375,...}
```

Três réplicas, **338 req/s**: 2,75 vezes uma só, com cada `thinker-app` em ~1,3 CPU. A escala é quase linear até o Postgres virar o gargalo.

**CRÍTICO**: cada réplica abre até `DB_POOL_MAX + AUTH_DB_POOL_MAX` conexões no Postgres. Com 40 + 10 por réplica, 7 réplicas já passam de 350. Antes de subir mais, aumente o `max_connections` do `thinker-postgres` (no compose do #1) ou baixe o `DB_POOL_POR_REPLICA`.

## 8 – Stress sem fim

#### 8.1 – O loop

O `loop.sh` sobe um **lote** de 12 geradores (um por harness, cada um no seu tipo de cliente) a cada `DEGRAU` segundos. Os geradores rodam para sempre e reiniciam sozinhos. Depois de `MAX_DEGRAUS` (por padrão, um milhão) ele só segura a carga e registra amostras.

Crie `/opt/thinker-stress-02/loop.sh`:

```Bash
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
```

Para começar, solto do terminal (sobrevive ao logout), execute:

```Bash
cd /opt/thinker-stress-02;
chmod +x loop.sh;
setsid nohup ./loop.sh iniciar > reports/loop.out 2>&1 < /dev/null &

# um segundo loop e recusado (o PID fica em reports/loop.pid)
./loop.sh iniciar;
    # ja existe um loop rodando (./loop.sh parar)

# acompanhar
./loop.sh status;
tail -f reports/loop.log;
```

Os botões de ajuste, todos por variável de ambiente:

- **`CONC`**: concorrência de cada gerador `run` e `claude-code` (padrão 50);
- **`AGENTES`**: agentes de cada gerador `agents` (padrão 25);
- **`DEGRAU`**: segundos entre lotes (padrão 120);
- **`MAX_DEGRAUS`**: quantos lotes subir antes de só segurar (padrão: sem fim);
- **`ALVO`**: para onde mandar (padrão `http://thinker-pool:2099`; use `https://thinker.seudominio.com.br` com `--add-host` para incluir o Traefik).

Cada lote acrescenta 4 × 50 conexões de SDK, 2 × 50 sessões de Claude Code e 6 × 25 agentes com ferramentas. Em uma hora, com o degrau padrão, são 30 lotes: 9.000 clientes simultâneos.

Para parar tudo (o processo do loop e os geradores; sem matar o loop, ele subiria o próximo lote no degrau seguinte):

```Bash
/opt/thinker-stress-02/loop.sh parar;
    # geradores removidos
```

#### 8.2 – O que eu vi em dois degraus

Com 3 réplicas, `CONC=20`, `AGENTES=10` e dois lotes (24 geradores), em cerca de três minutos:

- **CPU**: as três réplicas presas em 1,1 a 1,4 CPU cada (o teto de um processo Node) e o Postgres em 1,6 CPU. Daqui para cima só com mais réplicas;
- **Failover**: a instância **falhas** recebeu 4.801 requisições e injetou 1.310 erros. Depois dos primeiros 429 o Thinker põe a rota em **cooldown** e manda direto para o fallback, sem nem tentar: a **instavel** recebeu 29.466 e a **perfeito** 594 (o segundo fallback, quando a instável falha);
- **Cliente**: o gerador `run` do `h-openai-sdk-1` fechou 3.499 requisições em 2 min 30 s com **7 erros**; os agentes `coder` do OpenCode, 77 sessões sem nenhuma falha;
- **A exceção**: os harnesses **Claude Code** receberam o 429 do cooldown em cerca de **80%** das requisições, sem descer a cascata. Veja a seção 10.

Para ver o mesmo no seu servidor, rode as consultas da seção 9 com o loop ligado.

#### 8.3 – Tirando os freios

Os limites do compose do #1 existem para proteger o resto do servidor. Para esgotar **tudo**, tire-os num override, sem mexer no arquivo original:

```YAML
# /opt/thinker/docker-compose.override.yml
# sem limite de CPU e memoria, banco com fsync de verdade (I/O)
services:
  thinker-app:
    cpus: 0
    mem_limit: 0
    environment:
      NODE_OPTIONS: --max-old-space-size=32768
  thinker-postgres:
    cpus: 0
    mem_limit: 0
    command: [postgres, -c, max_connections=2000, -c, shared_buffers=16GB, -c, synchronous_commit=on,
              -c, shared_preload_libraries=pg_stat_statements, -c, track_io_timing=on]
```

Os três recursos e o que consome cada um:

- **CPU**: réplicas do Thinker (`escala.sh` com uma por par de núcleos) e geradores;
- **Memória**: streams abertos (`wwz-lento` segura conexões por até 20 s), histórico dos agentes `chat` (20 turnos) e o `max-old-space-size` de cada réplica;
- **I/O**: cada requisição grava ~12 comandos no Postgres e um arquivo de gravação no volume `thinker_recordings`. Com `synchronous_commit=on`, todo commit espera o disco.

Aplique o override e as réplicas:

```Bash
cd /opt/thinker;
docker compose up -d --wait;
/opt/thinker/escala.sh $(( $(nproc) / 4 ));
```

O host também tem limites. Confira antes de culpar o Thinker:

```Bash
# arquivos abertos, fila de conexoes e portas efemeras
sysctl fs.file-max net.core.somaxconn net.ipv4.ip_local_port_range;
    # fs.file-max = 9223372036854775807
    # net.core.somaxconn = 4096
    # net.ipv4.ip_local_port_range = 32768	60999
```

Com dezenas de milhares de conexões, o `ip_local_port_range` padrão (28 mil portas por destino) acaba antes da CPU. Ajuste por sua conta e risco: é configuração do sistema.

#### 8.4 – Atalho: um comando para disparar

O [`deploy/stress/opt/thinker-stress-02/stress.sh`](../../deploy/stress/opt/thinker-stress-02/stress.sh) junta os passos acima. Copie-o com o `sem-freios.override.yml` para `/opt/thinker-stress-02/`:

```Bash
cd /opt/thinker-stress-02;
./stress.sh iniciar;                # com freios: 3 replicas, 10 degraus, limites do compose
./stress.sh iniciar --sem-freios;   # secao 8.3: pede confirmacao (digite SIM)
./stress.sh status;
./stress.sh parar;                  # para o loop, volta a 1 replica, tira o override
    # Thinker de volta a 1 replica, com os limites do compose
```

O override "sem freios" fica guardado fora de `/opt/thinker`: só vira `docker-compose.override.yml` (que o compose lê sozinho) no `--sem-freios`, e o `parar` o remove. Cada rodada começa um `reports/loop.log` novo e guarda o anterior com a data.

## 9 – Lendo os resultados

O `wwz-load` sem `--duration` só imprime o relatório quando para. Com o loop, os números vêm de três lugares.

Para ver os erros e os fallbacks por harness, rótulo da chave e posição na cascata (últimos 5 minutos), execute:

```Bash
docker exec thinker-postgres psql -U thinker -d thinker -c "
  select agent_name, provider_key_label rotulo, coalesce(fallback_index::text, '-') fb,
         status, count(*)
  from agent_messages
  where timestamp > now() - interval '5 min' and agent_name like 'h-%'
  group by 1, 2, 3, 4 order by 1, 5 desc";
```

Para ver o que cada instância do wwz recebeu e injetou, execute:

```Bash
cd /opt/wwz-todos; . ./.env;
for i in perfeito falhas lento instavel; do
  printf '%-9s ' $i;
  docker run --rm --network network_public curlimages/curl:8.11.1 -s http://wwz-$i:9000/admin/stats \
    -H "Authorization: Bearer $WWZ_ADMIN_TOKEN" | jq -c '.totals | {requests, errors_injected, rate_limited}';
done;
```

Para o consumo do servidor, a linha do `reports/loop.log` traz CPU e memória de cada container do teste a cada degrau. Junte com `vmstat 5` e `iostat -x 5` (pacote `sysstat`) para ver memória livre e fila de disco.

## 10 – Lacunas que esse ambiente expôs

Construir esse ambiente revelou três bugs no Thinker, já corrigidos:

- **0.31.4**: redes Docker em `198.18.0.0/15` (RFC 2544) e `2001:db8::/32` (RFC 3849) eram tratadas como **públicas**, e `http://wwz-openai:8000` era recusado; e o CLI dentro do container `read_only` falhava depois de criar o harness, ao gravar o cache da chave;
- **0.31.5**: com base URL própria, o OpenCode recebia o modelo **com o prefixo do catálogo** (`opencode-go/glm-5.3`) e respondia `Model is unavailable`;
- **0.31.6**: a conexão Anthropic com base URL própria não recebia o **`anthropic-beta`** do cliente, e todo turno do Claude Code voltava 400 (`messages.1.output_config: Extra inputs are not permitted`).

E um achado que **não é bug**: com o principal em cooldown, os harnesses Claude Code recebiam o 429 local (`Provider route temporarily cooling down after an upstream 429`) e nenhum fallback, enquanto o Anthropic SDK, com a mesma rota, descia a cascata. A diferença era o `model` do corpo: o gerador do SDK manda `auto`, o do Claude Code manda `claude-sonnet-5-5`, e um ID concreto é uma rota explícita, **sem fallback** (veja [`model` explícito](../usuario/provedores-e-roteamento.md#model-explícito)). Os cabeçalhos do Claude Code e a afinidade de sessão não entram nisso. O passo 4b cria um modelo virtual com o nome do ID, que devolve a cascata; o teste `proxy.service.claude-code-fallback.spec.ts` prova os três casos (`auto`, ID concreto e virtual).

E as lacunas que continuam abertas (contorne como mostrado):

- **Uma réplica = um núcleo**: ~125 req/s por processo; escala horizontal só com réplicas, e os guardrails `THINKER_*_MAX` valem por processo;
- **Descoberta do OpenCode**: vem do catálogo, ignora a base URL da conexão;
- **Chave repetida = mesma conexão**: o rótulo novo é ignorado;
- **Fallback sem rótulo pelo CLI**, e rótulo inexistente cai em qualquer conexão;
- **Desconectar só desativa**: a conexão fica `is_active=false` e volta ao reconectar com a mesma chave;
- **Sem Azure nativo**: provedor custom OpenAI;
- **`provider connect` sem `--base-url`**: a primeira validação vai ao provedor real;
- **Headers `x-wwz-*` não passam**: o comportamento do simulador fica todo no YAML;

## 11 – Limpeza

Para desmontar o teste #2 e voltar ao ambiente do #1, execute:

```Bash
# geradores
/opt/thinker-stress-02/loop.sh parar;

# volta a uma replica e remove o override
/opt/thinker/escala.sh 1;
rm -f /opt/thinker/docker-compose.override.yml;
cd /opt/thinker && docker compose up -d --wait;

# harnesses do teste (as conexoes ficam inativas depois que nenhuma rota as usa)
for h in $(thk agent list | jq -r '.agents[].agent_name | select(startswith("h-"))'); do
  thk agent delete $h --yes </dev/null;
done;
for p in openai anthropic openrouter gemini opencode-go opencode; do
  for l in perfeito falhas lento instavel; do thk provider disconnect $p --label $l --yes </dev/null; done;
done;

# o wwz de todos os drivers
cd /opt/wwz-todos && docker compose down -v;
```

Agora é contigo. Troque a cascata de fallback, coloque o Traefik no caminho, mude o perfil da instância de falhas pela API admin com o loop rodando e veja quanto tempo o Thinker leva para se recuperar. O servidor vai reclamar; deixe.

Terminamos por hoje!

Patrick Brandão, patrickbrandao@gmail.com

<p align="right"><em>“O que não provoca minha morte<br>faz com que eu fique mais forte.“</em><br>Friedrich Nietzsche</p>
