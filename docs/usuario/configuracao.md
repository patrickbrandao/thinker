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
| `API_KEY` | vazio | Credencial opcional de operador para acesso programático via cabeçalho `X-API-Key`. Não está ligada a nenhum usuário, então não abre as rotas do admin da instância (**Users**). |
| `CLI_TOKEN_TTL_DAYS` / `CLI_TOKEN_ABSOLUTE_TTL_DAYS` | `30` / `90` | Validade deslizante e teto absoluto dos tokens da CLI (`thinker login`). |

## Gravações de requisições

O Thinker grava o corpo das requisições e respostas dos provedores (por harness; ligado por padrão em harnesses novos), cifrado com `THINKER_ENCRYPTION_KEY`. Imagens em base64 embutidas são removidas.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_RECORDING_RETENTION_DAYS` | `30` | Retenção padrão de logs, em dias. A organização pode trocá-la em Organização → Retenção de logs, e cada harness em Configurações (Global ou Personalizada). Precisa ser um inteiro positivo, senão o boot falha. Uma tarefa diária às 02:00 apaga os corpos gravados e os cabeçalhos/parâmetros das requisições expiradas; tokens, custos e status ficam. |
| `THINKER_RECORDING_STORAGE` | `auto` | `auto`, `s3`, `filesystem` ou `disabled`. Em `auto`, credenciais S3 completas têm prioridade; senão usa o disco. |
| `THINKER_RECORDING_FILESYSTEM_PATH` | `/data/request-recordings` | Diretório local (o compose monta o volume `thinker_request_recordings` ali). |
| `THINKER_RECORDING_S3_BUCKET`, `_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | vazio | Armazenamento compatível com S3. Use-o em deploy com mais de uma réplica. |
| `THINKER_RECORDING_S3_FORCE_PATH_STYLE` | `false` | `true` para S3 com endereçamento por caminho (MinIO e similares). |

## Identidade visual do painel

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_TITLE` | `Thinker` | Título mostrado ao lado da logomarca, no canto superior esquerdo do painel. |
| `THINKER_LOGO_URL` | logomarca do Thinker | URL da logomarca do canto superior esquerdo e da tela de login. Aceita caminho relativo ou URL `http(s)` absoluta; a origem da URL absoluta é liberada no `img-src` da CSP. |
| `THINKER_HIDE_INFO` | `false` | `true` esconde a versão do Thinker e o link da documentação no topo do painel. |

## Catálogos públicos de modelos e preços

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_CATALOG_SYNC` | `true` | `false` desliga a busca em `openrouter.ai` e `models.dev` e a do catálogo do OpenCode em `models.opencode.ai` (no boot e a cada 5 minutos, só com conta OpenCode); o catálogo do OpenCode passa a ser buscado em `opencode.ai/inference/...` no primeiro uso do provedor. Os custos passam a vir do snapshot de preços embutido na imagem, com os preços do OpenRouter e do models.dev do dia do build (a data aparece como última sincronização). O mesmo snapshot cobre uma falha da primeira busca. Veja [Privacidade](privacidade.md). |
| `THINKER_ALERTS_RETENTION_DAYS` | `90` | Dias que os alertas (página Alertas, tabela `system_events`) ficam guardados; uma limpeza diária apaga os mais antigos. |
| `THINKER_GEMINI_STORE` | `false` | O Thinker manda `store: false` em toda requisição à API Gemini (chave do AI Studio), para o Google não guardar prompts e respostas nos projetos pagos novos, que guardam por padrão desde 26/10/2026. `true` deixa a decisão com a configuração do projeto. |
| `THINKER_HTTP_PROXY` | (vazio) | Proxy HTTP de saída global (`http://[usuário:senha@]host:porta` ou `https://...`, TLS até o proxy). Vale para todo tráfego de saída que está em "Global" na Configuração de Proxy: provedores e conexões sem perfil, OAuth, catálogos públicos, provedores customizados, gatilhos e e-mail. Falha do proxy = falha da chamada (`provider_proxy_failed`, HTTP 502), nunca saída direta. URL inválida derruba o boot. |
| `THINKER_NO_PROXY` | (vazio) | Hosts que não passam pelo proxy global: nomes, sufixos (`.empresa.com` ou `empresa.com`), IPs e CIDRs, separados por vírgula; `*` desliga o proxy global. Sempre inclui `localhost`, `127.0.0.1`, `::1` e os hosts de `OLLAMA_HOST`, `THINKER_LMSTUDIO_BASE_URL` e `THINKER_LLAMACPP_BASE_URL`. |

## Provedores locais

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `THINKER_PROVIDER_PRIVATE_URLS` | `admin-only` | Quem pode cadastrar provedor custom com URL privada/LAN e conectar Ollama, LM Studio e llama.cpp: `allow` (quem conecta provedores), `admin-only` (admin da instância e owner da organização) ou `deny` (ninguém). Também vale para a URL de gatilhos webhook: fora da política, ela precisa ser `https` em endereço público. Metadados de nuvem ficam bloqueados em qualquer modo, inclusive na entrega dos webhooks. A regra vale em toda requisição, não só no cadastro: uma URL salva por quem não podia usar destino privado nunca chega à rede interna, mesmo que o DNS dela mude depois. Veja [Organizações](organizacoes.md). |
| `OLLAMA_HOST` | `http://host.docker.internal:11434` (compose) | Pré-preenche esquema, host e porta de um **novo** servidor Ollama (aceita `host`, `host:porta` ou URL; `0.0.0.0` vira o host do container). Na atualização para a versão com servidores locais, as conexões Ollama existentes viram um servidor neste endereço. |
| `THINKER_LMSTUDIO_BASE_URL` | vazio | Pré-preenche um novo servidor LM Studio (URL `http(s)` absoluta, com ou sem `/v1`). Valor inválido é ignorado. |
| `THINKER_LLAMACPP_BASE_URL` | vazio | Pré-preenche um novo servidor llama.cpp, com as mesmas regras (padrão sem a variável: porta 9931). |

Cada servidor local guarda a própria configuração (host, porta, prefixo, chave, timeouts); essas variáveis não são configuração global escondida. Fora do Docker o host padrão é `localhost` (e `host.containers.internal` no Podman).

## Proxy e limites

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PROVIDER_TIMEOUT_MS` | `180000` | Tempo máximo, por tentativa, de uma chamada ao provedor. Deixe abaixo do timeout do cliente para o fallback ter tempo de rodar. |
| `STREAM_WARMUP_MS` | `15000` | Espera pelo primeiro trecho de uma resposta em streaming antes de tentar o fallback. |
| `THINKER_LOCAL_STREAM_WARMUP_MS` | `60000` | A mesma espera para provedores locais (Ollama, LM Studio, llama.cpp), que demoram para carregar um modelo frio. Nunca fica abaixo de `STREAM_WARMUP_MS`. |
| `THINKER_EMPTY_RESPONSE_FALLBACK` | `true` | Uma resposta 200 sem streaming, sem conteúdo e com zero tokens (comum em modelos gratuitos do OpenRouter) vira falha e aciona o fallback. `false` desliga. |
| `THINKER_EMBEDDED_ERROR_CHECK` | `true` | Uma resposta 200 sem streaming cujo corpo só traz `error` (o OpenRouter devolve assim as falhas do provedor) vira o status real do erro, aciona o fallback e é registrada como falha. |
| `THINKER_STREAM_ERROR_PEEK` | `all` | Em streaming, o que fazer com um erro que chega antes do primeiro conteúdo (depois de keepalives): `all` trata qualquer erro como falha da tentativa (fallback e nova tentativa), `context` só erro de janela de contexto, `off` repassa ao cliente. |
| `THINKER_STREAM_PEEK_MS` | `20000` | Espera máxima pelo primeiro conteúdo depois do primeiro byte. Passado o limite, o stream segue para o cliente como está. |
| `THINKER_STREAM_PEEK_MAX_BYTES` | `262144` | Bytes retidos no máximo enquanto espera o primeiro conteúdo. |
| `THINKER_UPSTREAM_RETRY_MODE` | `last-route` | Nova tentativa na mesma rota quando o provedor devolve um erro transitório: `last-route` só quando não sobra rota de fallback, `always` sempre antes do fallback, `off` nunca. Erro de janela de contexto nunca é repetido. |
| `THINKER_UPSTREAM_RETRIES` | `1` | Quantas novas tentativas na mesma rota (0 a 5; 0 desliga). |
| `THINKER_UPSTREAM_RETRY_DELAY_MS` | `1000` | Espera antes de cada nova tentativa (0 a 60000). |
| `THINKER_UPSTREAM_RETRY_STATUSES` | `500,502,503` | Status que contam como transitórios. O 504 fica fora de propósito: repetir um timeout dobra a espera. |
| `THINKER_LIVE_CONTEXT` | `true` | Relê a cada 60 s o contexto real (`n_ctx`) de servidores llama.cpp e usa o menor entre ele e o cadastrado. `THINKER_LIVE_CONTEXT_TTL_MS`, `THINKER_LIVE_CONTEXT_FAIL_TTL_MS` (30000), `THINKER_LIVE_CONTEXT_TIMEOUT_MS` (1500) e `THINKER_LIVE_CONTEXT_STALE_MS` (600000) ajustam o cache. |
| `THINKER_SERVED_PROVIDER_CAPTURE` | `true` | Grava em cada tentativa quem de fato serviu (o campo `provider` do OpenRouter), o id da geração e o modelo respondido. Aparece como "Served by" no detalhe da mensagem e pode ser filtrado na lista. |
| `STREAM_IDLE_TIMEOUT_MS` | `180000` | Silêncio máximo entre eventos de streaming antes de falhar a tentativa (HTTP 504). |
| `CODEX_SEMANTIC_OUTPUT_TIMEOUT_MS` | `60000` | Espera por texto ou saída de ferramenta úteis do ChatGPT Codex. |
| `THINKER_BEDROCK_RUNTIME_CHAT_VIA_RESPONSES` | `true` | Pedidos Chat Completions com function tools e esforço de raciocínio para perfis CRIS de GPT no Bedrock Runtime (e qualquer pedido com tools para o GPT-6 Astra) vão para a Responses do Runtime, porque o Chat Completions do Runtime os rejeita. Só o valor exato `false` desliga. Nessa rota, `temperature`, `top_p`, `stop`, `seed` e afins não são repassados. |
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
