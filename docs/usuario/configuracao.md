# Configuração

Toda a configuração vem de variáveis de ambiente. No Compose, ponha-as no `.env` ao lado do `docker-compose.yml` (o modelo é o [`docker/.env.example`](../../docker/.env.example)) e rode `docker compose up -d` para aplicar. O compose só repassa ao container as variáveis que lista; variáveis que ele não conhece, no `.env`, não chegam ao servidor.

O Thinker lê apenas nomes `THINKER_*` para as variáveis próprias. Os nomes herdados do Manifest (`MANIFEST_*`, `REQUEST_RECORDING_*`) **não são lidos**: no boot o servidor avisa, pelo nome (nunca pelo valor), quais variáveis antigas ainda estão definidas e qual as substitui.

## Obrigatórias

| Variável | Descrição |
| --- | --- |
| `BETTER_AUTH_SECRET` | Segredo de assinatura das sessões, no mínimo 32 caracteres. `openssl rand -hex 32`. |
| `THINKER_ENCRYPTION_KEY` | Cifra em repouso as chaves de provedores, os tokens OAuth e as gravações. Mínimo de 32 caracteres, diferente de `BETTER_AUTH_SECRET`, sem fallback: o servidor não inicia sem ela. |
| `DATABASE_URL` | URL do PostgreSQL. O compose já define `postgresql://thinker:thinker@postgres:5432/thinker`. |

## Chave de cifragem e rotação

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_ENCRYPTION_KEY_PREVIOUS` | vazio | Só durante uma rotação: a chave antiga (mínimo de 32 caracteres). Depois do boot, as credenciais armazenadas são regravadas com a chave nova. Remova quando o log disser que não sobrou nada. As gravações de requisições **não** são regravadas. |

O passo a passo, inclusive para quem dependia do antigo fallback para `BETTER_AUTH_SECRET`, está em [Instalação com Docker](instalacao-docker.md#rotação-da-chave-de-cifragem).

## Cadastro e acesso

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_SETUP_TOKEN` | vazio | Token do primeiro setup escolhido pelo operador (mínimo de 16 caracteres; gere com `openssl rand -hex 24`). Com ele, dá para subir o serviço e enviar o token a quem vai criar o administrador, sem consultar o log. Ele nunca é impresso e deixa de valer quando o primeiro administrador existe. Vazio: o Thinker gera um token aleatório e o imprime no log. Valor com menos de 16 caracteres impede o boot. |
| `THINKER_ALLOW_SIGNUP` | `false` | Desde a v0.3 o admin cria as contas ([Organizações](organizacoes.md)), então raramente é preciso. Com `true`, reabre o cadastro por e-mail e login social, mas só depois que o primeiro administrador existe. O primeiro administrador sempre vem do assistente `/setup`, com o token de uso único do log. |
| `BETTER_AUTH_URL` | `http://localhost:<PORT>` | URL pública. Deve ser igual à do navegador e alcançável de dentro do container (o MCP busca o JWKS nela). |
| `BETTER_AUTH_ALLOWED_HOSTS` | vazio | Hosts extras que podem servir o dashboard e a API, separados por vírgula (aceita `*.exemplo.com`). |
| `PORT` | `2099` | Porta do servidor; no compose, também a porta publicada. |
| `HOST_PORT` | `PORT` | Só a porta do lado do host. |
| `HOST_BIND_ADDRESS` | `127.0.0.1` | Interface onde o compose publica a porta. `0.0.0.0` expõe na rede. |
| `TRUSTED_PROXIES` | vazio (faixas privadas) | Proxies reversos cujos `X-Forwarded-For`/`X-Real-IP` são aceitos: IPs ou CIDRs IPv4/IPv6 separados por vírgula. Vazio confia nas faixas privadas e reservadas; com valor, só nos prefixos listados. Uma entrada inválida impede o boot. Veja [proxy reverso](instalacao-docker.md#proxy-reverso-com-https). |
| `THINKER_DISABLE_HSTS` | vazio | `1` silencia o aviso de que o servidor está em HTTP puro. |
| `THINKER_CORS_ORIGINS` | vazio | Origens de navegador extras que podem chamar o gateway (separadas por vírgula). O dashboard é de mesma origem e não precisa. |
| `MCP_ENABLED` | ligado | `false` desliga o servidor MCP remoto (`/api/v1/mcp`). O MCP exige `BETTER_AUTH_URL` em HTTPS (ou localhost) e se desliga sozinho em HTTP de LAN. |
| `THINKER_CIMD_ALLOW_PRIVATE` | `false` | `true` deixa clientes MCP cuja URL de metadados (CIMD) resolve para endereço privado ou loopback fazerem login. Endereços de metadata de nuvem continuam bloqueados. |
| `API_KEY` | vazio | Credencial opcional de operador para acesso programático via cabeçalho `X-API-Key`. |
| `CLI_TOKEN_TTL_DAYS` / `CLI_TOKEN_ABSOLUTE_TTL_DAYS` | `30` / `90` | Validade deslizante e teto absoluto dos tokens da CLI (`thinker login`). |

## Gravações de requisições

O Thinker grava o corpo das requisições e respostas dos provedores (por harness; ligado por padrão em harnesses novos), cifrado com `THINKER_ENCRYPTION_KEY`. Imagens em base64 embutidas são removidas.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_RECORDING_RETENTION_DAYS` | `30` | Retenção, em dias, única para a instância. Precisa ser um inteiro positivo, senão o boot falha. Uma tarefa diária apaga o que passou do prazo. `365` mantém o comportamento antigo. |
| `THINKER_RECORDING_STORAGE` | `auto` | `auto`, `s3`, `filesystem` ou `disabled`. Em `auto`, credenciais S3 completas têm prioridade; senão usa o disco. |
| `THINKER_RECORDING_FILESYSTEM_PATH` | `/data/request-recordings` | Diretório local (o compose monta o volume `thinker_request_recordings` ali). |
| `THINKER_RECORDING_S3_BUCKET`, `_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | vazio | Armazenamento compatível com S3. Use-o em deploy com mais de uma réplica. |
| `THINKER_RECORDING_S3_FORCE_PATH_STYLE` | `false` | `true` para S3 com endereçamento por caminho (MinIO e similares). |

## Catálogos públicos de modelos e preços

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_CATALOG_SYNC` | `true` | `false` desliga a busca em `openrouter.ai`, `models.dev` e (com provedor OpenCode Go) `raw.githubusercontent.com`. Os custos passam a vir do snapshot de preços embutido na imagem, com os preços do OpenRouter e do models.dev do dia do build (a data aparece como última sincronização). O mesmo snapshot cobre uma falha da primeira busca. Veja [Privacidade](privacidade.md). |

## Provedores locais

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_PROVIDER_PRIVATE_URLS` | `admin-only` | Quem pode cadastrar provedor custom com URL privada/LAN e conectar Ollama, LM Studio e llama.cpp: `allow` (quem conecta provedores), `admin-only` (admin da instância e owner da organização) ou `deny` (ninguém). Metadados de nuvem ficam bloqueados em qualquer modo. Veja [Organizações](organizacoes.md). |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` (compose) | Endpoint do Ollama. |
| `THINKER_LMSTUDIO_BASE_URL` | `http://host.docker.internal:1234` | Servidor do provedor embutido LM Studio, com ou sem `/v1`. Valor que não seja uma URL `http(s)` absoluta é ignorado, com aviso no boot. |
| `THINKER_LLAMACPP_BASE_URL` | `http://host.docker.internal:8080` | Servidor do provedor embutido llama.cpp, com as mesmas regras. |

Fora do Docker o padrão de host é `localhost` (e `host.containers.internal` no Podman).

## Proxy e limites

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PROVIDER_TIMEOUT_MS` | `180000` | Tempo máximo, por tentativa, de uma chamada ao provedor. Deixe abaixo do timeout do cliente para o fallback ter tempo de rodar. |
| `STREAM_WARMUP_MS` | `15000` | Espera pelo primeiro trecho de uma resposta em streaming antes de tentar o fallback. |
| `THINKER_LOCAL_STREAM_WARMUP_MS` | `60000` | A mesma espera para provedores locais (Ollama, LM Studio, llama.cpp), que demoram para carregar um modelo frio. Nunca fica abaixo de `STREAM_WARMUP_MS`. |
| `THINKER_EMPTY_RESPONSE_FALLBACK` | `true` | Uma resposta 200 sem streaming, sem conteúdo e com zero tokens (comum em modelos gratuitos do OpenRouter) vira falha e aciona o fallback. `false` desliga. |
| `STREAM_IDLE_TIMEOUT_MS` | `180000` | Silêncio máximo entre eventos de streaming antes de falhar a tentativa (HTTP 504). |
| `CODEX_SEMANTIC_OUTPUT_TIMEOUT_MS` | `60000` | Espera por texto ou saída de ferramenta úteis do ChatGPT Codex. |
| `THINKER_CONCURRENCY_MAX` | `10` | Requisições simultâneas por tenant, por processo (erro M203). |
| `THINKER_RATE_MAX_REQUESTS` | `200` | Requisições por minuto por tenant, por processo (M201). |
| `THINKER_IP_RATE_MAX_REQUESTS` | `500` | Requisições por minuto por IP, por processo (M202). |
| `THROTTLE_LIMIT` / `THROTTLE_TTL` | `100` / `60000` | Limite das rotas da API de gestão: requisições por janela e janela em ms. |

Valores inválidos dos limites `THINKER_*_MAX*` voltam ao padrão.

## E-mail e login social (opcionais)

Sem provedor de e-mail, a verificação de cadastro é dispensada e a redefinição de senha não envia nada.

| Variável | Descrição |
| --- | --- |
| `EMAIL_PROVIDER` | `resend`, `mailgun` ou `sendgrid`. |
| `EMAIL_API_KEY` | Chave do provedor de e-mail. |
| `EMAIL_DOMAIN` | Domínio de envio (obrigatório no Mailgun). |
| `EMAIL_FROM` | Remetente. Obrigatório quando `EMAIL_PROVIDER` está definido: sem ele o Thinker não sobe e a mensagem de erro cita a variável. `NOTIFICATION_FROM_EMAIL` ainda é aceita como nome antigo. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Login social; cada um liga quando o par está completo. A URL de callback é `${BETTER_AUTH_URL}/api/auth/callback/<provedor>`. O login social só entra em contas que já existem. |
| `OPENAI_OAUTH_CLIENT_ID`, `MINIMAX_OAUTH_CLIENT_ID` | Substituem o cliente OAuth embutido, se você registrou o seu. |

## Banco de dados e operação

**Fuso horário:** o Thinker grava e compara todos os horários em UTC. O processo e cada sessão do PostgreSQL são fixados em UTC na inicialização, então um `TZ` definido no ambiente é ignorado (o log de boot avisa). Não é preciso configurar nada.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `thinker` | Senha do PostgreSQL embutido. Se mudar, mude também `DATABASE_URL` (caracteres especiais em percent-encoding). |
| `DB_POOL_MAX` / `AUTH_DB_POOL_MAX` | `10` / `5` | Tamanho dos pools de conexão (aplicação e Better Auth). |
| `RUN_MIGRATIONS_ON_BOOT` | `true` | `false` em réplicas que não devem migrar. |
| `SHUTDOWN_DRAIN_MS` | `10000` | Prazo, em ms, para terminar requisições em andamento ao receber SIGTERM. |
| `THINKER_VERSION` | `latest` | Tag da imagem usada pelo compose (por exemplo `0.1`). |
| `AGENT_USAGE_DAILY_WORKER`, `_READS`, `_READ_TENANTS`, `_BATCH_SIZE`, `_RUN_BUDGET_MS` | automático | Agregação diária de uso por harness. Os padrões servem; veja o `.env.example`. |

`NODE_ENV=production` e `SEED_DATA=false` são fixos no compose. A imagem é um artefato de produção e o gerador de dados de demonstração se recusa a rodar nela.
