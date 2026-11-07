# Thinker com White Wizard #1 – Stress com OpenAI simulado

Saudações. Nesse tutorial vou ensinar como montar um ambiente de **stress** para o **Thinker** usando o **White Wizard** (wwz) como provedor **OpenAI** simulado – carga pesada, erros reais de provedor e nenhum centavo gasto em token.

Pré-requisitos:

- **Servidor Debian** (12 ou 13) com **Docker** 29+ e **Docker Compose** 5+;
- **Thinker 0.31.6** ou mais novo (as versões anteriores têm três bugs que esse ambiente expõe; lista na seção 8);
- **Traefik** rodando na rede Docker **`network_public`**, com os entrypoints `web` e `websecure` e um certresolver chamado **`letsencrypt`**;
- **DNS** apontando para o servidor: `thinker.seudominio.com.br`, `wwz-openai.seudominio.com.br` e `wwz-openai-panel.seudominio.com.br`;
- Acesso ao repositório do **White Wizard** (`github.com/patrickbrandao/white-wizard`);
- `jq`, `envsubst` (pacote `gettext-base`) e `openssl` no servidor.

Todos os comandos rodam como **root** no servidor. Onde aparecer `seudominio.com.br`, troque pelo seu domínio.

## 1 – Como funciona

O teste tem três peças, cada uma num container:

- **wwz-openai**: o simulador. Fala o dialeto da API da OpenAI byte a byte (`/v1/chat/completions`, `/v1/responses`, `/v1/models`), com latência, limites (RPM, TPM, concorrência) e erros configuráveis por chave;
- **thinker-app** + **thinker-postgres**: o gateway sob teste. Recebe as requisições dos harnesses, roteia para o provedor e grava tudo (requisições, tokens, custo, gravações);
- **wwz-load**: o gerador de carga. Joga o papel do cliente: SDK OpenAI, agente multi-turno com ferramentas, rampa, sweep, distribuído em vários workers.

O caminho da requisição:

```Text
wwz-load (harness) --> thinker-app:2099 --> wwz-openai:8000
     |                      |
     |                      +--> thinker-postgres (requests, agent_messages)
     +--> (opcional) Traefik TLS --> thinker-app
```

O wwz é o **boi de piranha** do teste: ele precisa ser muito mais rápido que o Thinker, senão você mede o simulador e não o gateway. Uma instância com 4 núcleos entrega milhares de req/s; o Thinker, como vamos ver, fica bem abaixo disso.

## 2 – Preparando o servidor

Crie os diretórios e confira a rede do Traefik:

```Bash
# diretorios do teste
mkdir -p /opt/wwz-openai /opt/thinker /opt/thinker-stress/reports;

# a rede do Traefik precisa existir
docker network inspect network_public --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}';
    # network_public 172.20.0.0/16
```

Anote o IP do Traefik nessa rede, vamos usar para o teste via TLS e no `TRUSTED_PROXIES` do Thinker:

```Bash
# IP do container do Traefik na network_public
docker inspect traefik-app --format '{{(index .NetworkSettings.Networks "network_public").IPAddress}}';
    # 172.20.255.253
```

#### 2.1 – Construindo as imagens do White Wizard

O White Wizard não publica imagem; construa as três (servidor, painel e gerador de carga) a partir do repositório:

```Bash
# clonar o repositorio
cd /opt/wwz-openai;
git clone --depth 1 https://github.com/patrickbrandao/white-wizard.git src;
cd src;

# wwz (simulador), wwz-panel (painel) e wwz-load (gerador de carga + wwz-tools)
docker build --target wwz       -t white-wizard:local       .;
docker build --target wwz-panel -t white-wizard-panel:local .;
docker build --target wwz-load  -t white-wizard-load:local  .;

docker images | grep white-wizard;
    # white-wizard-load:local    ...  13MB
    # white-wizard-panel:local   ...  12MB
    # white-wizard:local         ...  13MB
```

## 3 – White Wizard somente OpenAI

#### 3.1 – Credenciais

Gere o token do control plane, a senha do painel e três chaves de inferência. Nada disso sai do servidor:

```Bash
cd /opt/wwz-openai;
umask 077;
( echo "DOMINIO=seudominio.com.br";
  echo "WWZ_ADMIN_TOKEN=$(openssl rand -hex 24)";
  echo "WWZ_PANEL_ADMIN_PASSWORD=$(openssl rand -hex 12)";
  echo "WWZ_KEY_1=wwz-key-$(openssl rand -hex 12)";
  echo "WWZ_KEY_2=wwz-key-$(openssl rand -hex 12)";
  echo "WWZ_KEY_3=wwz-key-$(openssl rand -hex 12)";
) > .env;
chmod 600 .env;
```

#### 3.2 – Configuração do simulador

Cada chave cai numa **conta** com limites e perfis próprios. Assim a mesma instância simula três "contas OpenAI" bem diferentes:

- **conta-01**: sem limite, sem erro, latência zero. É a que mede o teto do Thinker;
- **conta-02**: limites de um tier alto, 5% de erros e latência realista;
- **conta-03**: limites apertados (600 RPM, 50 simultâneas) e **20%** de erros, inclusive no meio do stream. É a que testa o failover.

Crie o arquivo `/opt/wwz-openai/wwz.yaml`:

```YAML
# /opt/wwz-openai/wwz.yaml
# White Wizard somente OpenAI, para estressar o Thinker.
server:
  listen: ":8000"
  auth: keys
  reuseport: true
  concurrency: 1000000
  trusted_proxies: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16]

admin:
  listen: ":9000"

# eventos no Valkey para o painel (wwz-panel)
store:
  event_stream: true
  event_sample: 1

drivers:
  - {name: openai}

# contas: da 01 (ilimitada e perfeita) a 03 (apertada e com falhas)
accounts:
  - {id: conta-01}
  - {id: conta-02, limits: {rpm: 60000, tpm: 10000000, concurrency: 5000}}
  - {id: conta-03, limits: {rpm: 600, tpm: 100000, concurrency: 50}}

keys:
  - {key: ${WWZ_KEY_1}, label: conta-01, account: conta-01, errors: sem-erro, latency: rapida}
  - {key: ${WWZ_KEY_2}, label: conta-02, account: conta-02, errors: erro-05, latency: realista}
  - {key: ${WWZ_KEY_3}, label: conta-03, account: conta-03, errors: erro-20, latency: realista}

profiles:
  latency:
    rapida: {ttft: 0ms, itl: 0ms}
    realista: {queue: {dist: lognormal, median: 20ms, p99: 300ms}, ttft: {dist: normal, mean: 450ms, stddev: 120ms}, itl: {dist: normal, mean: 18ms, stddev: 4ms}}
  errors:
    sem-erro: {rate: 0}
    erro-05: {rate: 5, types: [rate_limit, server_error, overloaded], mid_stream_rate: 1}
    erro-20: {rate: 20, types: [rate_limit, server_error, overloaded, bad_gateway, gateway_timeout, connection_reset], mid_stream_rate: 6, mid_stream_types: [stream_truncated, stream_error_event]}

models:
  - id: wwz-fast
    owned_by: white-wizard
    protocols: [openai]
    context_window: 128000
    capabilities: {tools: true, reasoning: true, json_schema: true}
    generation: default
  - id: gpt-5-sim
    owned_by: white-wizard
    protocols: [openai]
    context_window: 400000
    capabilities: {tools: true, reasoning: true, json_schema: true}
    latency: realista
    generation: default
```

**CUIDADO**: o wwz **não expande variáveis** dentro do YAML. Renderize com `envsubst` (só as três chaves) e valide antes de subir:

```Bash
cd /opt/wwz-openai;
set -a; . ./.env; set +a;
mkdir -p run;
envsubst '${WWZ_KEY_1} ${WWZ_KEY_2} ${WWZ_KEY_3}' < wwz.yaml > run/wwz.yaml;
chmod 644 run/wwz.yaml;

# validar (o -config e obrigatorio; sem ele o arquivo e lido como cenario)
docker run --rm -v $PWD/run/wwz.yaml:/w.yaml:ro white-wizard:local validate -config /w.yaml | head -1;
    # ok    config /w.yaml (2 models, 1 drivers, 3 keys)
```

#### 3.3 – Compose (API, Valkey e painel admin)

O painel (`wwz-panel`) lê os eventos e os contadores pelo **Valkey**, então ele entra junto. Crie `/opt/wwz-openai/docker-compose.yml`:

```YAML
# /opt/wwz-openai/docker-compose.yml
# White Wizard somente OpenAI: API (wwz-openai), Valkey e painel admin.
name: wwz-openai

services:
  wwz-openai:
    image: white-wizard:local
    container_name: wwz-openai
    restart: unless-stopped
    read_only: true
    tmpfs: [/run, /tmp]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    cpus: ${WWZ_CPUS:-4}
    mem_limit: ${WWZ_MEM:-8g}
    ulimits:
      nofile: {soft: 1048576, hard: 1048576}
    environment:
      WWZ_CONFIG: /etc/wwz/wwz.yaml
      WWZ_ADMIN_TOKEN: ${WWZ_ADMIN_TOKEN}
      WWZ_VALKEY_ADDR: wwz-openai-valkey:6379
      WWZ_LOG_LEVEL: warn
      GOGC: "200"
    volumes: ["./run/wwz.yaml:/etc/wwz/wwz.yaml:ro"]
    depends_on:
      wwz-openai-valkey: {condition: service_healthy}
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck", "http://127.0.0.1:9000/health/ready"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [interna, network_public]
    labels:
      traefik.enable: "true"
      traefik.docker.network: network_public
      traefik.http.routers.wwz-openai.entrypoints: web,websecure
      traefik.http.routers.wwz-openai.rule: Host(`wwz-openai.${DOMINIO}`)
      traefik.http.routers.wwz-openai.tls: "true"
      traefik.http.routers.wwz-openai.tls.certresolver: letsencrypt
      traefik.http.routers.wwz-openai.service: wwz-openai
      traefik.http.services.wwz-openai.loadbalancer.server.port: "8000"

  wwz-openai-valkey:
    image: valkey/valkey:8.1-alpine
    container_name: wwz-openai-valkey
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

  wwz-openai-panel:
    image: white-wizard-panel:local
    container_name: wwz-openai-panel
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    environment:
      WWZ_PANEL_LISTEN: ":8100"
      WWZ_PANEL_DB: /data/panel.db
      WWZ_PANEL_PUBLIC_URL: https://wwz-openai-panel.${DOMINIO}
      WWZ_PANEL_VALKEY_ADDR: wwz-openai-valkey:6379
      WWZ_PANEL_WWZ_ADMIN_URL: http://wwz-openai:9000
      WWZ_ADMIN_TOKEN: ${WWZ_ADMIN_TOKEN}
      WWZ_PANEL_ADMIN_USER: admin
      WWZ_PANEL_ADMIN_PASSWORD: ${WWZ_PANEL_ADMIN_PASSWORD}
    volumes: [panel-data:/data]
    depends_on:
      wwz-openai: {condition: service_healthy}
    healthcheck:
      test: ["CMD", "/usr/local/bin/healthcheck", "http://127.0.0.1:8100/health/ready"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [interna, network_public]
    labels:
      traefik.enable: "true"
      traefik.docker.network: network_public
      traefik.http.routers.wwz-openai-panel.entrypoints: web,websecure
      traefik.http.routers.wwz-openai-panel.rule: Host(`wwz-openai-panel.${DOMINIO}`)
      traefik.http.routers.wwz-openai-panel.tls: "true"
      traefik.http.routers.wwz-openai-panel.tls.certresolver: letsencrypt
      traefik.http.routers.wwz-openai-panel.service: wwz-openai-panel
      traefik.http.services.wwz-openai-panel.loadbalancer.server.port: "8100"

volumes:
  panel-data: {name: wwz-openai-panel-data}

networks:
  interna:
    name: wwz-openai-interna
  network_public:
    external: true
    name: network_public
```

Repare: o **control plane** (porta 9000) não tem router no Traefik. Ele só é alcançado pela rede Docker, pelo painel e pelo `wwz-load top`.

#### 3.4 – Subindo e testando

Para subir a stack, execute:

```Bash
cd /opt/wwz-openai;
docker compose up -d --wait;
docker ps --filter name=wwz-openai --format '{{.Names}} {{.Status}}';
    # wwz-openai-panel Up 5 seconds (healthy)
    # wwz-openai Up 10 seconds (healthy)
    # wwz-openai-valkey Up 15 seconds (healthy)
```

Teste a API simulada pela rede Docker (é por ela que o Thinker vai falar):

```Bash
cd /opt/wwz-openai; . ./.env;

# listar modelos
docker run --rm --network network_public curlimages/curl:8.11.1 -s \
  http://wwz-openai:8000/v1/models -H "Authorization: Bearer $WWZ_KEY_1" | jq -r '.data[].id';
    # wwz-fast
    # gpt-5-sim

# um chat completion
docker run --rm --network network_public curlimages/curl:8.11.1 -s \
  http://wwz-openai:8000/v1/chat/completions -H "Authorization: Bearer $WWZ_KEY_1" \
  -H 'content-type: application/json' \
  -d '{"model":"wwz-fast","messages":[{"role":"user","content":"oi"}],"max_tokens":20}' \
  | jq -c '{model, usage}';
    # {"model":"wwz-fast","usage":{"prompt_tokens":8,"completion_tokens":20,"total_tokens":28,...}}

# contadores do control plane
docker run --rm --network network_public curlimages/curl:8.11.1 -s \
  http://wwz-openai:9000/admin/stats -H "Authorization: Bearer $WWZ_ADMIN_TOKEN" | jq -c .totals;
    # {"requests":1,"in_flight":0,"streams_open":0,"errors_injected":0,...}
```

#### 3.5 – Painel admin

Abra `https://wwz-openai-panel.seudominio.com.br` e entre com o usuário **admin** e a senha do `.env`:

```Bash
grep WWZ_PANEL_ADMIN_PASSWORD /opt/wwz-openai/.env;
```

No painel você vê uso por chave, eventos, bloqueios e políticas. Para mexer no simulador com o teste rodando (sem reiniciar nada), use a API admin – por exemplo, fazer o `wwz-fast` devolver 500 em tudo e depois voltar ao normal:

```Bash
cd /opt/wwz-openai; . ./.env;
A="docker run --rm -i --network network_public curlimages/curl:8.11.1 -s";

# wwz-fast passa a dar 100% de server_error
$A http://wwz-openai:9000/admin/config -H "Authorization: Bearer $WWZ_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"models":{"wwz-fast":{"errors":{"rate":100,"types":["server_error"]}}}}';

# volta ao normal
$A http://wwz-openai:9000/admin/config -H "Authorization: Bearer $WWZ_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"models":{"wwz-fast":{"errors":"none"}}}';

# zera os contadores entre rodadas
$A -X POST http://wwz-openai:9000/admin/reset -H "Authorization: Bearer $WWZ_ADMIN_TOKEN";
```

## 4 – Rodando o Thinker

#### 4.1 – Credenciais

O Thinker exige duas chaves diferentes (sessão e criptografia em repouso). O token de setup fixo deixa criar o primeiro admin sem caçar o token no log:

```Bash
cd /opt/thinker;
umask 077;
( echo "DOMINIO=seudominio.com.br";
  echo "THINKER_VERSION=latest";
  echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)";
  echo "THINKER_ENCRYPTION_KEY=$(openssl rand -hex 32)";
  echo "THINKER_SETUP_TOKEN=$(openssl rand -hex 24)";
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)";
  echo "THINKER_ADMIN_EMAIL=stress@thinker.local";
  echo "THINKER_ADMIN_PASSWORD=$(openssl rand -hex 16)";
  echo "TRUSTED_PROXIES=172.20.255.253";
) > .env;
chmod 600 .env;
```

Troque o `TRUSTED_PROXIES` pelo IP do Traefik que você anotou na seção 2.

#### 4.2 – Compose

O compose oficial do Thinker é feito para uso normal. Para stress, quatro coisas mudam e são **obrigatórias**:

- **Guardrails do proxy**: por padrão o Thinker aceita só **10** requisições simultâneas por tenant (`THINKER_CONCURRENCY_MAX`), **200/min** por tenant (`THINKER_RATE_MAX_REQUESTS`) e **500/min** por IP (`THINKER_IP_RATE_MAX_REQUESTS`). Sem levantar isso, o teste mede o erro **M201**, não o gateway;
- **URLs privadas**: o simulador está em `http://wwz-openai:8000`, um endereço privado. `THINKER_PROVIDER_PRIVATE_URLS=allow` libera;
- **Catálogos públicos desligados** (`THINKER_CATALOG_SYNC=false`): o teste não depende da internet;
- **Postgres afinado**: `max_connections`, `shared_buffers`, `synchronous_commit=off` e `pg_stat_statements` para ver o que cada requisição custa no banco.

Crie `/opt/thinker/docker-compose.yml`:

```YAML
# /opt/thinker/docker-compose.yml
# Thinker para teste de stress (thinker-app + thinker-postgres) atras do Traefik.
name: thinker

services:
  thinker-postgres:
    image: postgres:18-alpine
    container_name: thinker-postgres
    restart: unless-stopped
    shm_size: 2g
    cpus: 8
    mem_limit: 16g
    environment:
      POSTGRES_USER: thinker
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: thinker
    command:
      - postgres
      - -c
      - max_connections=400
      - -c
      - shared_buffers=4GB
      - -c
      - effective_cache_size=12GB
      - -c
      - work_mem=16MB
      - -c
      - maintenance_work_mem=512MB
      - -c
      - wal_buffers=64MB
      - -c
      - max_wal_size=8GB
      - -c
      - checkpoint_timeout=15min
      - -c
      - synchronous_commit=off
      - -c
      - random_page_cost=1.1
      - -c
      - track_io_timing=on
      - -c
      - shared_preload_libraries=pg_stat_statements
      - -c
      - pg_stat_statements.track=top
    volumes: [pgdata:/var/lib/postgresql]
    healthcheck:
      test: pg_isready -U thinker
      interval: 5s
      timeout: 3s
      retries: 10
    security_opt: ["no-new-privileges:true"]
    networks: [interna]

  thinker-app:
    image: tmsoftbrasil/thinker:${THINKER_VERSION:-latest}
    container_name: thinker-app
    restart: unless-stopped
    stop_grace_period: 30s
    cpus: 8
    mem_limit: 8g
    pids_limit: 4096
    ulimits:
      nofile: {soft: 1048576, hard: 1048576}
    read_only: true
    tmpfs: ["/tmp:size=256m"]
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    environment:
      PORT: "2099"
      DATABASE_URL: postgresql://thinker:${POSTGRES_PASSWORD}@thinker-postgres:5432/thinker
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}
      THINKER_ENCRYPTION_KEY: ${THINKER_ENCRYPTION_KEY}
      THINKER_SETUP_TOKEN: ${THINKER_SETUP_TOKEN}
      BETTER_AUTH_URL: https://thinker.${DOMINIO}
      TRUSTED_PROXIES: ${TRUSTED_PROXIES}
      # provedores simulados na rede Docker (http://wwz-*:8000) sao URLs privadas
      THINKER_PROVIDER_PRIVATE_URLS: allow
      # sem catalogos publicos: o teste nao depende da internet
      THINKER_CATALOG_SYNC: "false"
      # guardrails do proxy levantados para o stress (padroes: 10, 200/min, 500/min)
      THINKER_CONCURRENCY_MAX: ${THINKER_CONCURRENCY_MAX:-100000}
      THINKER_RATE_MAX_REQUESTS: ${THINKER_RATE_MAX_REQUESTS:-100000000}
      THINKER_IP_RATE_MAX_REQUESTS: ${THINKER_IP_RATE_MAX_REQUESTS:-100000000}
      THROTTLE_LIMIT: "10000"
      DB_POOL_MAX: ${DB_POOL_MAX:-80}
      AUTH_DB_POOL_MAX: "10"
      PROVIDER_TIMEOUT_MS: "180000"
      THINKER_RECORDING_STORAGE: auto
      THINKER_RECORDING_FILESYSTEM_PATH: /data/request-recordings
      NODE_OPTIONS: --max-old-space-size=6144
      UV_THREADPOOL_SIZE: "16"
    volumes: [recordings:/data/request-recordings]
    depends_on:
      thinker-postgres: {condition: service_healthy}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:2099/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      start_period: 90s
      retries: 3
    networks:
      interna: {}
      network_public:
        # alias comum: as replicas do tutorial #2 entram nele
        aliases: [thinker-pool]
    labels:
      traefik.enable: "true"
      traefik.docker.network: network_public
      traefik.http.routers.thinker.entrypoints: web,websecure
      traefik.http.routers.thinker.rule: Host(`thinker.${DOMINIO}`)
      traefik.http.routers.thinker.tls: "true"
      traefik.http.routers.thinker.tls.certresolver: letsencrypt
      traefik.http.services.thinker.loadbalancer.server.port: "2099"

volumes:
  pgdata: {name: thinker_pgdata}
  recordings: {name: thinker_recordings}

networks:
  interna:
    name: thinker-interna
    internal: true
  network_public:
    external: true
    name: network_public
```

**CRÍTICO**: a rede `thinker-interna` é `internal: true`. O Postgres nunca fica alcançável fora do par app/banco, nem pelo Traefik.

#### 4.3 – Subindo

Para subir o Thinker e ligar a extensão de estatísticas do Postgres, execute:

```Bash
cd /opt/thinker;
docker compose up -d --wait;
docker exec thinker-postgres psql -U thinker -d thinker -qc 'create extension if not exists pg_stat_statements';

# saude pelo Traefik, com TLS (o certificado sai em alguns segundos)
curl -s --resolve thinker.seudominio.com.br:443:172.20.255.253 https://thinker.seudominio.com.br/api/v1/health;
    # {"status":"healthy",...}
```

**CUIDADO**: de dentro do servidor, `curl https://thinker.seudominio.com.br` pode ficar pendurado para sempre. Muito NAT não faz **hairpin** (o IP público não volta para a própria máquina). Por isso o `--resolve` para o IP do Traefik; da sua máquina, o domínio responde normalmente.

#### 4.4 – Primeiro administrador

O assistente `/setup` aceita o token fixo do `.env`. Crie o admin pela API, de dentro da rede Docker:

```Bash
cd /opt/thinker; . ./.env;
jq -n --arg e "$THINKER_ADMIN_EMAIL" --arg p "$THINKER_ADMIN_PASSWORD" --arg t "$THINKER_SETUP_TOKEN" \
  '{email: $e, name: "Stress Admin", password: $p, setupToken: $t}' \
  | docker run --rm -i --network network_public curlimages/curl:8.11.1 -s \
      -X POST http://thinker-app:2099/api/v1/setup/admin -H 'content-type: application/json' --data-binary @-;
    # {"ok":true}
```

Com esse e-mail e senha você entra no dashboard em `https://thinker.seudominio.com.br`.

#### 4.5 – O CLI dentro do container

A imagem traz o CLI `thinker`. Dentro do container ele usa a própria `THINKER_ENCRYPTION_KEY` para gerar um token root de 5 minutos, sem login. Crie dois atalhos:

```Bash
# sem stdin (a maioria dos comandos)
alias thk='docker exec -e XDG_CONFIG_HOME=/tmp/thinker-cli thinker-app thinker';
# com stdin (para passar credenciais por pipe)
alias thki='docker exec -i -e XDG_CONFIG_HOME=/tmp/thinker-cli thinker-app thinker';

thk doctor | jq -c '.checks[] | {name, ok}';
    # {"name":"config","ok":true}
    # {"name":"host","ok":true}
    # {"name":"auth","ok":true}
    # ...
```

Dois detalhes que custam caro se ignorados:

- **`XDG_CONFIG_HOME=/tmp/thinker-cli`**: o container é `read_only` e o CLI guarda um cache das chaves dos harnesses. O `/tmp` é o único lugar gravável;
- **`-i` só quando precisa**: `docker exec -i` dentro de um script lê o **stdin do script inteiro** e engole os comandos seguintes. Em loop ou heredoc, use `thk ... </dev/null`.

## 5 – Provedor e harness

#### 5.1 – Harness genérico padrão OpenAI

O harness genérico é a plataforma **Other** da categoria **App AI SDK**, que fala **Chat Completions**:

```Bash
thk agent create --name wwz-generico --category app --platform other --if-absent | jq -c '{agent, keyPrefix}';
    # {"agent":{"agent_name":"wwz-generico",...,"agent_platform":"other"},"keyPrefix":"thk_..."}
```

#### 5.2 – Conta OpenAI API apontando para o simulador

Aqui está o pulo do gato: o provedor **OpenAI nativo** do Thinker aceita trocar a **base URL** da conexão. Conecte com a chave da conta-01 e aponte para o `wwz-openai`:

```Bash
cd /opt/wwz-openai; . ./.env;

# conecta a conta (rotulo conta-01) e guarda o id da conexao
ID=$(printf '%s' "$WWZ_KEY_1" | thki provider connect openai --credential-stdin \
       --agent wwz-generico --label conta-01 | jq -r .id);

# base URL do simulador (sem /v1: o Thinker acrescenta o caminho)
thk connection set $ID --base-url http://wwz-openai:8000 | jq -c .base_url;
    # {"id":"...","base_url":"http://wwz-openai:8000","default_base_url":"https://api.openai.com"}

# redescobre os modelos, agora no simulador
thk provider refresh openai --agent wwz-generico | jq -c .refresh;
    # {"ok":true,"model_count":2,...}
thk models wwz-generico --provider openai | jq -r '.models[].model';
    # wwz-fast
    # gpt-5-sim
```

**CUIDADO**: o `provider connect` valida e descobre modelos **antes** de você trocar a base URL, ou seja, a chave do simulador vai uma vez para `api.openai.com` (que responde 401 e o Thinker usa o catálogo embutido). Com chave de simulador, tudo bem. Nunca faça isso com uma chave real que não deveria sair do servidor.

Repita para as contas 02 e 03 (vamos usar a 03 no failover):

```Bash
cd /opt/wwz-openai; . ./.env;
for n in 2 3; do
  k=$(grep "^WWZ_KEY_$n=" .env | cut -d= -f2-);
  ID=$(printf '%s' "$k" | thki provider connect openai --credential-stdin --agent wwz-generico --label conta-0$n | jq -r .id);
  thk connection set $ID --base-url http://wwz-openai:8000 </dev/null >/dev/null;
done;
thk provider refresh openai --agent wwz-generico >/dev/null;
thk provider list | jq -r '.providers[] | select(.provider=="openai") | .connections[] | "\(.label) \(.base_url) \(.cached_model_count)"';
    # conta-01 http://wwz-openai:8000 2
    # conta-02 http://wwz-openai:8000 2
    # conta-03 http://wwz-openai:8000 2
```

#### 5.3 – Rota padrão

Aponte o `auto` do harness para o `wwz-fast` da conta-01 e mande uma requisição real:

```Bash
thk agent configure wwz-generico --models wwz-fast --provider openai --key-label conta-01 | jq -c .route.override_route;
    # {"provider":"openai","authType":"api_key","model":"wwz-fast","keyLabel":"conta-01"}

thk routing test wwz-generico "diga ok" | jq -c '{ok, served_model, duration_ms}';
    # {"ok":true,"served_model":"wwz-fast","duration_ms":88}
```

#### 5.4 – Modelos virtuais para o teste

Dois **modelos virtuais** completam o cenário:

- **wwz-stream**: mesma rota, em modo `stream` (a rota padrão é `buffered`: o Thinker segura a resposta inteira para poder trocar de provedor no meio);
- **wwz-falhas**: principal na **conta-03** (20% de erros, limites apertados) com fallback no `wwz-fast`. É aqui que o failover do Thinker apanha.

```Bash
thk routing virtual create wwz-generico --name wwz-stream --model wwz-fast --provider openai \
  --key-label conta-01 --response-mode stream | jq -c '{name, response_mode}';
thk routing virtual create wwz-generico --name wwz-falhas --model wwz-fast --provider openai \
  --key-label conta-03 --fallback gpt-5-sim | jq -c '{name}';

thk routing virtual list wwz-generico | jq -r '.[] | .name';
    # wwz-stream
    # wwz-falhas
```

#### 5.5 – Chave do harness para o gerador

Guarde a chave do harness e o resto do que o gerador precisa num `.env` próprio:

```Bash
cd /opt/thinker-stress;
umask 077;
( echo "THINKER_AGENT_KEY=$(thk agent key show wwz-generico --raw)";
  grep -E '^(WWZ_KEY_1|WWZ_ADMIN_TOKEN)=' /opt/wwz-openai/.env;
  echo "THINKER_HOST=thinker.seudominio.com.br";
  echo "TRAEFIK_IP=172.20.255.253";
  echo "WWZ_LOAD_IMAGE=white-wizard-load:local";
) > .env;
chmod 600 .env;
```

## 6 – Ferramentas de stress

O `wwz-load` roda num container descartável na `network_public`, falando direto com `thinker-app:2099`. Para não decorar flag, eu enlatei os modos num script.

Crie `/opt/thinker-stress/stress.sh`:

```Bash
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
```

Dê permissão de execução:

```Bash
chmod +x /opt/thinker-stress/stress.sh;
```

#### 6.1 – Linha de base: o simulador sozinho

Antes de culpar o Thinker, meça o wwz sem ele:

```Bash
cd /opt/thinker-stress;
DUR=20s ./stress.sh base 20;
    # {"requests":141089,"ok":141089,"errors":0,"rps":7054.45,"ttft_p50":1.411,"ttft_p99":6.895,...}
```

Esse número é o seu **teto**: tudo que o Thinker entregar abaixo dele é o custo do gateway.

#### 6.2 – Concorrência fixa, taxa fixa, rampa e sweep

Os quatro modos de carga do `wwz-load`, pelo Thinker:

- **conc N**: malha fechada, N clientes que mandam a próxima assim que a anterior volta. Mede vazão máxima;
- **rps N**: malha aberta, uma partida a cada 1/N s, não importa a latência. Mede como a fila cresce quando o gateway não aguenta;
- **rampa**: a taxa sobe linearmente; mostra onde o joelho da curva aparece;
- **sweep**: degraus de taxa e parada automática quando os erros passam de 30%.

```Bash
cd /opt/thinker-stress;
# vazao maxima: 100 clientes
DUR=20s ./stress.sh conc 100;
    # {"requests":2458,"ok":2458,"errors":0,"rps":122.9,"ttft_p50":804.863,"ttft_p99":919.551,...}

# abaixo do teto: 100 req/s
DUR=20s ./stress.sh rps 100;
    # {"requests":2000,"ok":2000,"errors":0,"rps":100,"ttft_p50":7.087,"ttft_p99":26.943,...}

# degraus ate quebrar
./stress.sh sweep;
jq -c '.steps[] | {target_rps, rps, errors, p50: .ttft_ms.p50}' $(ls -t reports/sweep-*.json | head -1);
    # {"target_rps":50,"rps":50,"errors":0,"p50":6.351}
    # {"target_rps":100,"rps":100,"errors":0,"p50":6.927}
    # {"target_rps":200,"rps":200,"errors":942,"p50":2711.551}
    # {"target_rps":400,"rps":400,"errors":7856,"p50":5881.855}
    # ...

# streaming de verdade (modelo virtual)
MODEL=wwz-stream ./stress.sh conc 200;
```

Leia os dois primeiros números juntos: com 100 clientes o Thinker entrega ~123 req/s e o TTFT p50 vai a 800 ms – é **fila**, não processamento. Com 100 req/s (abaixo do teto) o mesmo TTFT p50 cai para **7 ms**. O sweep mostra o joelho entre 100 e 200 req/s: dali para cima a fila cresce até o timeout de 60 s do cliente.

Os relatórios completos (percentis, tokens/s, erros por tipo) ficam em `/opt/thinker-stress/reports/*.json`.

#### 6.3 – Agentes multi-turno com ferramentas

O `wwz-load agents` é o **simulador de agente**: N agentes, cada um com sessões de vários turnos, nos perfis `coder` (ler, escrever, editar arquivo, rodar comando), `pesquisa` (busca e fetch) e `chat` (histórico crescente). Cada tool call que o modelo pede é **executada** pelo catálogo do `wwz-tools` e o resultado volta na conversa, como num harness de verdade:

```Bash
cd /opt/thinker-stress;
DUR=60s ./stress.sh agentes 200;
    # {"requests":8741,"ok":8741,"errors":0,"rps":129.54,...,"sessions":{"started":1359,"completed":1359,"failed":0,...}}

# ferramentas chamadas e resultado
jq -c '.total.tools' $(ls -t reports/agentes-*.json | head -1);
    # {"calls_by_name":{"edit_file":314,"fetch_url":605,"list_dir":319,"read_file":943,...},"outcomes":{"natural_error":2182,"success":1453}}
```

O histórico cresce a cada turno, então o tamanho do corpo também cresce: é o teste que mais pesa nas **gravações** e no Postgres.

#### 6.4 – Pelo Traefik, com TLS

Para incluir o proxy reverso e o TLS na medição, o gerador resolve o domínio público para o IP interno do Traefik (o NAT de muitos servidores não faz **hairpin**: de dentro do servidor, o IP público não volta para ele mesmo):

```Bash
cd /opt/thinker-stress;
DUR=20s ./stress.sh traefik 50;
    # {"requests":2531,"ok":2531,"errors":0,"rps":126.55,"ttft_p50":398.335,...}
```

#### 6.5 – Falhas e failover

O virtual `wwz-falhas` manda tudo para a conta-03 (20% de erros e 50 simultâneas). Com 200 clientes, o limite estoura e os erros do meio do stream aparecem. Compare o que o cliente recebeu com o que o simulador injetou:

```Bash
cd /opt/thinker-stress;
DUR=20s ./stress.sh falhas 200;
    # {"requests":2481,"ok":2477,"errors":4,...,"errors_by_type":{"stream_error/server_error":4}}

docker run --rm --network network_public curlimages/curl:8.11.1 -s \
  http://wwz-openai:9000/admin/stats -H "Authorization: Bearer $(grep ^WWZ_ADMIN_TOKEN= .env | cut -d= -f2-)" \
  | jq -c '.totals | {requests, errors_injected, rate_limited}';
```

Cada erro injetado que **não** chegou ao cliente é um fallback que funcionou. Os poucos que chegam são erros **no meio do stream**: depois que o primeiro byte saiu, não há como trocar de provedor.

## 7 – Observando

Com uma carga rodando, abra outros terminais.

Para ver CPU e memória dos containers, execute:

```Bash
docker stats thinker-app thinker-postgres wwz-openai;
```

Para o painel ao vivo do simulador (req/s, erros, TTFT por modelo e por chave), execute:

```Bash
/opt/thinker-stress/stress.sh top;
```

Para ver o que cada requisição custa no banco, zere as estatísticas, rode uma carga e liste as consultas mais caras:

```Bash
docker exec thinker-postgres psql -U thinker -d thinker -qc 'select pg_stat_statements_reset()';
DUR=20s /opt/thinker-stress/stress.sh conc 100;
docker exec thinker-postgres psql -U thinker -d thinker -P pager=off -c "
  select calls, round(total_exec_time::numeric) total_ms, round(mean_exec_time::numeric,2) mean_ms,
         left(regexp_replace(query, '\s+', ' ', 'g'), 80) consulta
  from pg_stat_statements order by total_exec_time desc limit 10";
    #  calls | total_ms | mean_ms | consulta
    #   2249 |     1293 |    0.57 | INSERT INTO "agent_messages"(...
    #   3836 |      956 |    0.25 | UPDATE "agent_messages" SET "recording_key" = ...
    #   2249 |      433 |    0.19 | INSERT INTO "requests"(...
```

No dashboard do Thinker, a página do harness `wwz-generico` mostra requisições, tokens e custo em tempo real, e o painel do wwz mostra o lado do provedor.

## 8 – O que eu medi e as lacunas

Num servidor de 56 núcleos, com os limites do compose acima e o `wwz-fast` (latência zero):

- **wwz-openai direto**: ~7.000 req/s com 20 clientes e 4 núcleos;
- **Thinker, uma réplica**: **110 a 130 req/s**, não importa a concorrência (20, 100 ou 200), com ~7 ms por requisição quando não há fila; O `thinker-app` fica em ~1,2 a 1,5 CPU: o gargalo é o **event loop** de um processo Node só, não o banco (cada requisição gasta ~12 comandos SQL e ~5 ms no Postgres);
- **Gravação de mensagens**: desligar (`thk routing recording set wwz-generico --enabled false`) sobe de ~112 para ~130 req/s;
- **Modo buffered**: na rota padrão o TTFT é igual ao E2E (o Thinker entrega a resposta inteira). Para medir TTFT de verdade, use o virtual `wwz-stream` com o perfil `realista`.

As lacunas que esse ambiente expõe:

- **Um processo por container**: o Thinker não usa mais de um núcleo para o proxy. Escalar é subir réplicas (tutorial #2), e os guardrails (`THINKER_*_MAX`) valem **por processo**;
- **Headers `x-wwz-*` não passam**: o Thinker não repassa headers arbitrários do cliente ao provedor (e está certo). `--tool-prob`, `--scenario` e `--seed` do `wwz-load` não chegam ao simulador; o comportamento tem que estar no YAML do wwz (`generation.tool_calls`, cenários casados por conteúdo);
- **Descoberta antes da base URL**: o `provider connect` não aceita `--base-url`, então a primeira descoberta vai para o provedor real (seção 5.2);
- **Fallback com rótulo de chave**: o CLI (`--models`, `--fallback`) só aceita nomes de modelo. Fixar o rótulo da chave num fallback só pela API REST (`PUT /api/v1/routing/<harness>/tiers/default/fallbacks` com `routes[].keyLabel`);
- **Chave repetida = mesma conexão**: conectar de novo com a mesma chave e outro rótulo devolve a conexão que já existe. Uma conta, uma chave;
- **Hairpin NAT**: de dentro do servidor, o domínio público pode não alcançar o próprio Traefik; use os nomes da rede Docker ou `--add-host`.

E os três bugs que esse ambiente encontrou, já corrigidos: redes Docker em `198.18.0.0/15` e `2001:db8::/32` vistas como públicas e o CLI quebrando no container `read_only` (**0.31.4**); o prefixo do catálogo indo para o OpenCode com base URL própria (**0.31.5**); e o `anthropic-beta` do Claude Code sumindo na conexão Anthropic com base URL própria (**0.31.6**).

## 9 – Limpeza

Para zerar o teste e começar de novo, execute:

```Bash
# zera os contadores do simulador
docker run --rm --network network_public curlimages/curl:8.11.1 -s -X POST \
  http://wwz-openai:9000/admin/reset -H "Authorization: Bearer $(grep ^WWZ_ADMIN_TOKEN= /opt/wwz-openai/.env | cut -d= -f2-)";

# apaga relatorios antigos
rm -f /opt/thinker-stress/reports/*.json;
```

Para remover tudo, inclusive o banco do Thinker:

```Bash
cd /opt/thinker && docker compose down -v;
cd /opt/wwz-openai && docker compose down -v;
```

**CUIDADO**: o `down -v` apaga os volumes `thinker_pgdata` e `thinker_recordings`. Sem volta.

Agora é contigo. Troque os perfis de latência e erro do wwz, aperte os limites das contas e descubra onde o seu Thinker dobra os joelhos. No tutorial #2 o stress fica sério: todos os provedores, todos os harnesses e um loop que não para.

Terminamos por hoje!

Patrick Brandão, patrickbrandao@gmail.com

<p align="right"><em>“Conhece o teu inimigo e conhece-te a ti mesmo;<br>em cem batalhas nunca correrás perigo.“</em><br>Sun Tzu</p>
