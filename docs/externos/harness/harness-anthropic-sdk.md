---
id: harness-anthropic-sdk
categoria: harness
entidade: Anthropic SDK
agente: harness-anthropic-sdk
thinker_ids: [anthropic-sdk]
revisado_em: 2026-11-03
versao_observada: "@anthropic-ai/sdk 1.4.0 (sdk-v1.4.0) e anthropic (PyPI) 2.4.0 (v2.4.0), API 2026-10-21; docs 2026-11-03"
---

# Anthropic SDK (harness)

Especificação mantida pelo agente `harness-anthropic-sdk` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Identificação: os dois repositórios semeados estão certos. "Anthropic SDK" = os SDKs oficiais da Anthropic para **TypeScript** (`@anthropic-ai/sdk`) e **Python** (`anthropic`), mantidos pela Stainless. Há SDKs irmãos (Go, Java, C#, PHP, Ruby, CLI `ant`) com o mesmo comportamento de cabeçalhos; não foram lidos no código. Confiança na identificação: alta.
- Superfície: **Anthropic Messages** (`POST /v1/messages`). Aponta-se para o gateway com `base_url` / `baseURL` (ou `ANTHROPIC_BASE_URL`) **sem `/v1`** (o SDK acrescenta `/v1/messages`) e uma credencial.
- **Mudança grande de 2026-10-21:** TypeScript 1.0.0 e Python 2.0.0 (e os SDKs irmãos) passaram a enviar `anthropic-version: 2026-10-21` (antes `2023-06-01`) e **a chave `api_key` agora vai em `Authorization: Bearer`, não mais em `x-api-key`**. A guia de migração da Anthropic manda gateways que liam `X-Api-Key` passarem a ler `Authorization`. O Thinker aceita os dois cabeçalhos, então não quebra; só a documentação do usuário ficou desatualizada (G7).
- O SDK **não envia nenhum cabeçalho de sessão ou de subagente** e não lê cabeçalhos de gateway. Sem `x-session-key` posto pelo app, toda chamada cai na sessão `default` do Thinker (G6).
- Endpoints extras usados por apps com o SDK: `POST /v1/messages/count_tokens` (**não existe no Thinker**, G1), `GET /v1/models` e `GET /v1/models/{id}` (formato OpenAI; o segundo não existe, G2). Batches e Files API não são servidos; não avaliados.
- Versões vistas: TypeScript **1.4.0** (2026-11-02), Python **2.4.0** (2026-11-02). Cadência: uma versão menor a cada uma ou duas semanas, geradas por Stainless a partir do OpenAPI.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| anthropic-sdk-typescript (código na tag; `src/client.ts`, `src/resources/`, CHANGELOG, MIGRATION) | <https://github.com/anthropics/anthropic-sdk-typescript> | `sdk-v1.4.0` (commit `ea8d7de`, 2026-11-02; clone raso lido) |
| anthropic-sdk-python (código na tag; `_client.py`, `_base_client.py`, `_constants.py`, CHANGELOG) | <https://github.com/anthropics/anthropic-sdk-python> | `v2.4.0` (commit `5752c13`, 2026-11-02; clone raso lido) |
| Guia de migração para a versão de API 2026-10-21 | <https://platform.claude.com/docs/en/api/migration-2026-10-21.md> | 2026-11-03 |
| Referência `POST /v1/messages` | <https://platform.claude.com/docs/en/api/messages/create.md> | 2026-11-03 |
| Erros da API | <https://platform.claude.com/docs/en/api/errors.md> | 2026-11-03 |
| Visão geral da API (cabeçalhos) | <https://platform.claude.com/docs/en/api/overview.md> | 2026-11-03 |
| Página do SDK TypeScript | <https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript.md> | 2026-11-03 |
| npm `@anthropic-ai/sdk` | <https://www.npmjs.com/package/@anthropic-ai/sdk> | 1.4.0 (`npm view`, 2026-11-03) |
| PyPI `anthropic` | <https://pypi.org/project/anthropic/> | 2.4.0 (tag GitHub; `pip` indisponível nesta máquina) |

Os repositórios foram clonados em `--depth 1` no scratchpad e só lidos. O repositório TypeScript tem tag `sdk-vX.Y.Z` (monorepo com `bedrock-sdk`, `vertex-sdk`, `foundry-sdk`, `aws-sdk`, `google-cloud-sdk`); o `latest` do GitHub aponta para o release do SDK principal.

## Contrato

### Configuração do gateway

- **URL base:** `baseURL` (TS) / `base_url` (Python) ou a variável `ANTHROPIC_BASE_URL`; padrão `https://api.anthropic.com`. O SDK acrescenta `/v1/messages` (e `/v1/messages/count_tokens`, `/v1/models`...), portanto a URL base **não** leva `/v1`. Precedência: argumento do construtor, depois a variável, depois a URL do perfil de credencial. Fonte: `src/client.ts` e `_client.py` nas tags acima.
- **Credencial (SDK TS 1.x, Python 2.x):** o cliente guarda **uma** credencial. `apiKey`/`api_key` (ou `ANTHROPIC_API_KEY`) e `authToken`/`auth_token` (ou `ANTHROPIC_AUTH_TOKEN`) **ambos viram `Authorization: Bearer <valor>`**; não há mais `x-api-key`. Dois valores no construtor levantam erro (`ValueError` no Python); com as duas variáveis de ambiente definidas, vale `ANTHROPIC_API_KEY` e há um aviso único. Fonte: `src/client.ts:1307-1322` (TS) e `_client.py:375-387` (Py); migração, seções "API keys are sent as Authorization: Bearer" e "A client holds one credential".
- **Versões anteriores (TS < 1.0, Python < 2.0):** `apiKey` ia em `x-api-key`, `authToken` em `Authorization: Bearer`, e um cliente podia enviar os dois (daí o `M006` do Thinker). Quem não atualizou continua com esse comportamento; o gateway deve aceitar ambos (hoje aceita).
- Para quem precisa de `x-api-key` (gateway antigo), a migração mostra como reinjetá-lo (hook `auth` do cliente HTTP / `fetch` próprio). `AnthropicFoundry` continua enviando `x-api-key`.
- `ANTHROPIC_CUSTOM_HEADERS` (linhas `Nome: Valor`, `\n`) é lida pelo construtor (`src/client.ts:1003-1011`, `_client.py:252`); `defaultHeaders` / `default_headers` por cliente e `headers` / `extra_headers` por requisição. É assim que um app envia `x-session-key`.
- Retentativas e tempo: `maxRetries`/`max_retries` padrão **2**; `timeout` padrão **10 minutos** (Python: conexão 5 s). Fonte: `_constants.py`, `src/client.ts:978-993`.
- Não streaming com `max_tokens` grande: o SDK calcula um tempo esperado (`3600 * max_tokens / 128000` s) e, se passar de 10 min, **recusa a chamada no cliente** pedindo streaming (`src/client.ts:1369-1378`); então apps com saídas longas usam `stream`.

### Seleção de modelo

- O app informa `model` (string) em cada chamada; o SDK não valida o id. As docs e exemplos usam `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`. O SDK só emite avisos de console para ids em lista interna de modelos descontinuados (`DEPRECATED_MODELS`, `src/resources/beta/messages/messages.ts`) e para `thinking.type=enabled` em alguns modelos; nada disso bloqueia.
- `model: "auto"` (id sintético do Thinker) é aceito pelo SDK sem reclamação, pois `model` é só uma string no tipo `Model` (união aberta com `string`).
- Listagem: `client.models.list()` (`GET /v1/models`, itera páginas com `after_id`/`before_id`/`limit`) e `client.models.retrieve(id)` (`GET /v1/models/{id}`). `ModelInfo` traz `id`, `type`, `display_name`, `created_at`, `deprecated_at`, `capabilities`. Os métodos de modelos não-beta não aceitam mais `betas` (use `client.beta.models`). Fonte: `src/resources/models.ts`; migração.

### Cabeçalhos e sessão

Enviados pelo SDK em toda requisição (TS `src/client.ts:2005-2026`, Py `_client.py:391-398` e `_base_client.py:2655-2665`):

| Cabeçalho | Valor | Observação |
|---|---|---|
| `Authorization` | `Bearer <chave>` | desde TS 1.0 / Py 2.0; antes `x-api-key` para `api_key` |
| `anthropic-version` | `2026-10-21` | antes `2023-06-01`; o app pode sobrescrever |
| `User-Agent` | `Anthropic/JS <versão>` (TS); `Anthropic/Python <versão>` ou `AsyncAnthropic/Python <versão>` (Python) | o formato é o nome da classe do cliente |
| `X-Stainless-Lang` | `js` / `python` | |
| `X-Stainless-Package-Version`, `-OS`, `-Arch`, `-Runtime`, `-Runtime-Version` | versão do SDK, SO, arquitetura, `node`/`deno`/`edge`/`browser:*` ou `CPython`, versão do runtime | |
| `X-Stainless-Retry-Count`, `X-Stainless-Timeout` | contador de retentativa e tempo limite em segundos | TS e Python (`_base_client.py:560-564`; o Python também envia `x-stainless-read-timeout` e `X-Stainless-Async`) |
| `anthropic-beta` | lista separada por vírgula, vem dos `betas` do app em `client.beta.*` (e `token-counting-2024-11-01` no `countTokens` beta) | repassar sem alterar; com credencial `credentials`/perfil o SDK acrescenta `oauth-2025-04-20` |
| `anthropic-dangerous-direct-browser-access` | `true` | só no navegador com `dangerouslyAllowBrowser` |

- **Sessão / subagente:** o SDK **não envia** cabeçalho de sessão, de conversa, de agente ou de dica de gateway. O único mecanismo é o app pôr o seu (`defaultHeaders: {"x-session-key": ...}` no cliente ou `headers` na chamada). Não há `traceparent` por padrão; o SDK tem spans OpenTelemetry opt-in (`ANTHROPIC_OPEN_TELEMETRY*`) que podem propagar `traceparent`/`tracestate`/`baggage` (`src/client.ts:789-806` e docs inline) `(não conferido na rede)`.
- **Query `?beta=true`:** versões antigas dos métodos `client.beta.messages.*` enviavam `POST /v1/messages?beta=true`. A partir de TS 1.3.0 e Python 2.3.0 ("stop sending query params hardcoded in endpoint paths", "read the beta route qualifier instead of the beta=true query") o SDK usa um qualificador interno e **não envia mais a query**; o gateway deve casar pelo caminho e ignorar a query. Fonte: CHANGELOG de TS 1.3.0 e Py 2.3.0, `src/internal/request-options.ts:149` `(não confirmado em captura de rede)`.
- **`x-api-key` x `Authorization` juntos:** o SDK novo só manda um. Um gateway que rejeita valores diferentes (`M006`) só vê isso com SDK antigo ou com cabeçalhos manuais.

### Outros endpoints

| Endpoint | Quando | Se falhar |
|---|---|---|
| `POST /v1/messages` | sempre (`stream: true` para SSE) | erro tipado: `BadRequestError`, `AuthenticationError`, `NotFoundError`, `RateLimitError`... |
| `POST /v1/messages/count_tokens` | `messages.countTokens` / `count_tokens` (e a versão beta) | 404 `NotFoundError`; o app que conta tokens quebra |
| `GET /v1/models`, `GET /v1/models/{id}` | `models.list` / `models.retrieve` | 404 em `retrieve`; `list` funciona se `data` vier, mas campos Anthropic ficam `undefined` |
| `POST /v1/messages/batches` e subrotas | Message Batches | não servido pelo Thinker; fora do escopo de roteamento |
| `POST /v1/files`, Skills, Admin API, Managed Agents (`client.beta.*`) | recursos específicos da Anthropic | não aplicável a um gateway multiprovedor `(não avaliado)` |

O SDK não chama endpoints de saúde, telemetria própria nem de atualização. Tráfego fora da base URL só ocorre com credenciais/perfis (federação de identidade): `POST /v1/oauth/token` na própria base URL ou no endpoint de identidade configurado.

### Recursos usados

Streaming SSE (`message_start`, `content_block_*`, `message_delta`, `message_stop`, `ping`, `error`; o SDK passou a entregar também eventos de nome desconhecido, TS 0.136.0); `cache_control` em `system`, `messages` e `tools`; `thinking` (`type: adaptive` preferido, `enabled` com `budget_tokens`, `disabled`); ferramentas client e server (`web_search`, `bash`, `text_editor`, `computer`, `code_execution`, `mcp_toolset`); `tool_choice` com `disable_parallel_tool_use`; imagens e **`document`** (PDF, texto, url, content, file) e `search_result`; `citations`; `output_config` (formato estruturado, `effort`, `task_budget`); `metadata.user_id`; `stop_sequences`; `service_tier`; `speed` (TS 0.135.0); `fallbacks` e outros campos beta ligados por `anthropic-beta` (`fallback-credit-2026-07-01`, `server-side-fallback-2026-07-01`, `thinking-binding-controls-2026-08-01`, `inline-tools-2026-09-15`, `mcp-client-2026-09-15`).

Mudanças da versão de API 2026-10-21 que afetam o gateway (migração, "Breaking changes"):

- `temperature`, `top_p`, `top_k` **deixaram de existir** nos tipos do SDK e dão 400 na API oficial; os SDKs novos não os enviam. Um gateway deve continuar aceitando-os de clientes antigos.
- `messages[]` aceita `role: "system"` (`SystemMessageParam`), `UserMessageParam`, `AssistantMessageParam` (tipos separados por papel).
- `document` em mensagem de assistente e `citations` em `text` de mensagem de usuário viram 400 na API oficial.
- Text Completions removido dos SDKs.
- `stop_reason` pode ser `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`, `model_context_window_exceeded` (`src/resources/messages/messages.ts:5270`).

### Erros e retentativas

- Forma do erro esperada: `{"type":"error","error":{"type":"...","message":"..."},"request_id":"req_..."}`; o SDK lê `error.type`/`message` e o cabeçalho `request-id` (exposto como `_request_id`). Tipos: `invalid_request_error` 400, `authentication_error` 401, `billing_error` 402, `permission_error` 403, `not_found_error` 404, `request_too_large` 413, `rate_limit_error` 429, `api_error` 500, `timeout_error` 504, `overloaded_error` 529. Fonte: erros da API.
- **Retentativa automática** (2 vezes por padrão, backoff 0,5 s a 8 s com jitter): conexão, **408, 409, 429, ≥ 500**. Obedece `x-should-retry: true|false` primeiro; depois `retry-after-ms`; depois `retry-after` (segundos, decimal permitido, ou data HTTP), usado apenas se entre 0 e 2^31-1 ms (sem o teto de 60 s do Claude Code). Em TS, um 401 com credencial por cache de token causa uma renovação única. Fonte: `src/client.ts:1855-1935`, `_base_client.py:881-940`.
- Timeouts de leitura em streaming: o padrão é o `timeout` global (10 min); não há ping/idle watchdog próprio. Uma queda de conexão no meio do SSE vira `APIConnectionError`/`RuntimeError` no consumidor (sem retentativa no meio do stream).
- Com SDK, um 5xx do gateway é tentado até 3 vezes no total; num gateway com cadeia de fallback cada tentativa repete a cadeia inteira. `x-should-retry: false` num erro definitivo evitaria isso.

### Snippet de setup do Thinker

Esperado: `base_url`/`baseURL` sem `/v1`, `auth_token`/`authToken` (funciona em qualquer versão do SDK, pois sempre vira Bearer) ou `api_key`, e `model: "auto"`. Para sessão estável, opcionalmente `default_headers={"x-session-key": "<id>"}`. O snippet atual do Thinker está **correto** (ver abaixo). Só a prosa de `docs/usuario/conectar-harnesses.md:131` está desatualizada para os SDKs novos.

## Como o Thinker implementa hoje

Branch/commit lido: worktree `onda2` em `0c93e2a`, 2026-11-03.

- Superfície: `anthropic-sdk` usa `messages` (`packages/shared/src/agent-type.ts:93`), rótulo "Anthropic SDK" (`:119`), grupo `app` (`:131`), ícone (`:154`).
- Snippets do assistente: Python `Anthropic(base_url=<sem /v1>, auth_token=<chave>)` e TypeScript `new Anthropic({ baseURL, authToken })`, ambos com `model: "auto"` e `max_tokens: 1024` (`packages/frontend/src/services/framework-snippets.ts:181-221`; escolha por `ToolkitId` em `:463-466`; `stripV1Suffix` em `:177`). Cabeçalhos personalizados entram por `default_headers`/`defaultHeaders` (`headerLine`). Estão corretos para TS 1.x e Python 2.x e para as versões anteriores.
- Documentação do usuário: `docs/usuario/conectar-harnesses.md:118-131`. Linha 131 diz que `api_key` "vira `x-api-key`"; isso vale só para SDK antigo (G7). O `agent-key-auth.guard.ts:159-163` repete o comentário de que o `x-api-key` é o padrão do SDK Anthropic.
- Autenticação: `agent-key-auth.guard.ts:164-202` aceita `Authorization: Bearer <chave>` (ou chave pura) e `x-api-key`; recusa valores diferentes com `M006` (`error-codes.ts:31-35`). Compatível com os dois formatos do SDK.
- Rotas: `GET /v1/models` (`proxy.controller.ts:176`, formato OpenAI `object: 'list'`, `:240-243`), `POST /v1/messages` (`:262`). Não existem `POST /v1/messages/count_tokens` (G1) nem `GET /v1/models/:id` (G2).
- Entrada Messages: o corpo vai a `messagesToChatCompletionsRequest` (`anthropic-messages-adapter.ts:320-384`) só para roteamento e para destinos não Anthropic; destinos Anthropic recebem o corpo original (`applyAnthropicMessagesMutations`). Na tradução: `role` diferente de `assistant` vira `user` (`:330`, G4); só `tool_result`, `text` e `image` são lidos em mensagens de usuário, o resto (`document`, `search_result`...) é descartado (`:184-241`, G5); `temperature`, `top_p`, `top_k`, `thinking`, `stop_sequences`, `metadata` são carregados (`:343-361`).
- Saída Messages: `stop_reason` mapeado de `finish_reason` para `end_turn`/`max_tokens`/`tool_use`/`refusal` (`:389-394`); erros têm `type: 'error'` + `error` com campos extras (`proxy-response-handler.ts:268`, `:374`); 5xx em modo `messages` vira `api_error` ou `overloaded_error` para 529 (`proxy-response-handler.ts:181-184`). O Thinker não define `request-id`, `x-should-retry` nem `retry-after-ms` nas respostas do proxy (o `retry-after` só existe em respostas locais de cooldown, `proxy-fallback.service.ts:766`).
- Versão da API: o Thinker ignora o `anthropic-version` recebido e envia `anthropic-version: 2023-06-01` aos provedores Anthropic (`provider-endpoints.ts:158,167,175`; `subscription-clients.ts:70`). As regras novas de 2026-10-21 (400 para `document` em assistente etc.) não são aplicadas pelo gateway, o que é benigno.
- Beta: `anthropic-beta` do chamador é lido e mesclado só quando o destino é `api.anthropic.com` (`anthropic-beta.ts`, `isAnthropicHost` em `:102`; ver dossiê harness-claude-code). Query `?beta=true` é ignorada pela rota Nest (o caminho é `v1/messages`).
- Sessão: lê somente `x-session-key` (`proxy.controller.ts:277` e `:899`) via `buildProxySessionScope` (`proxy-session-scope.ts:19-41`); sem ele, `sessionKey = 'default'` e `providerCacheKey`/`momentumKey` ficam indefinidos. O SDK não envia esse cabeçalho (G6). Nota: o `harness-session.ts` citado no escopo existe só em outra sessão e não foi encontrado nesta árvore; a lógica de sessão está em `proxy.controller.ts` e `provider-hooks.ts:41-68`.
- Atribuição do chamador: `classifyCaller` (`caller-classifier.ts:36-80`) lê `user-agent` e `x-stainless-*`; a regex de UA do SDK Anthropic (`:102`) espera `anthropic-sdk-*`/`anthropic-ai-*`, formato que os SDKs não enviam; sai como `stainless-python`/`stainless-js` (G3).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/anthropic-messages-adapter.ts`
- `packages/backend/src/routing/proxy/proxy-response-handler.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/otlp/guards/agent-key-auth.guard.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/frontend/src/services/framework-snippets.ts`
- `docs/usuario/conectar-harnesses.md`

Arquivos que citam `anthropic-sdk`:

- `packages/frontend/src/components/FrameworkSnippets.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/services/framework-snippets.ts`
- `packages/cli/src/provider-catalog.gen.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `POST /v1/messages/count_tokens` não existe; `messages.countTokens` do SDK (e a versão beta) recebe 404. Servir uma contagem aproximada local ou repassar à Anthropic. Mesma raiz da G3 de harness-claude-code. | backend-dev | [#371](https://github.com/patrickbrandao/thinker/issues/371) | resolvida (POST /v1/messages/count_tokens: Anthropic ou estimativa) |
| G2 | degradação | `GET /v1/models` só em formato OpenAI (sem `type`, `display_name`, `created_at`, paginação) e sem `GET /v1/models/{id}`; `models.list/retrieve` do SDK recebem campos `undefined` ou 404. Alinhar com G5 de harness-claude-code. | backend-dev | [#372](https://github.com/patrickbrandao/thinker/issues/372) | resolvida (/v1/models no formato Anthropic e /v1/models/{id}) |
| G3 | degradação | `classifyCaller` não reconhece `Anthropic/Python`, `AsyncAnthropic/Python` e `Anthropic/JS`; o tráfego fica como `stainless-python`/`stainless-js` nos logs. `caller-classifier.ts:102`. | backend-dev | [#373](https://github.com/patrickbrandao/thinker/issues/373) | resolvida (Anthropic/Python e Anthropic/JS reconhecidos) |
| G4 | degradação | Mensagens `role: "system"` dentro de `messages` (aceitas na API 2026-10-21, `SystemMessageParam`) viram `user` em rotas traduzidas (`anthropic-messages-adapter.ts:330`). | backend-dev | [#374](https://github.com/patrickbrandao/thinker/issues/374) | resolvida (adaptador de tradução corrigido, com teste) |
| G5 | degradação | Blocos `document` (PDF, texto) e `search_result` em mensagens de usuário são descartados em silêncio em rotas traduzidas (`anthropic-messages-adapter.ts:184-241`); o modelo responde sem o anexo. | backend-dev | [#375](https://github.com/patrickbrandao/thinker/issues/375) | resolvida (adaptador de tradução corrigido, com teste) |
| G6 | oportunidade | O SDK não envia cabeçalho de sessão: toda chamada de um harness `anthropic-sdk` cai em `default` (sem afinidade de cache nem momentum). O snippet poderia mostrar `default_headers={"x-session-key": ...}` e a doc explicar quando usar. Relacionada, mas com causa diferente, a #318 e #320 (clientes que enviam um id que o Thinker não lê). | frontend-dev | — | aberta |
| G7 | oportunidade | `docs/usuario/conectar-harnesses.md:131` diz que `api_key` "vira `x-api-key`"; nos SDKs TS 1.x / Python 2.x vira `Authorization: Bearer` (igual a `auth_token`). Corrigir o texto (e o comentário em `agent-key-auth.guard.ts:159-163`); o `M006` só ocorre com SDK antigo ou cabeçalhos manuais. | docs / frontend-dev | — | aberta |
| G8 | oportunidade | Enviar `x-should-retry: false` (e `request-id`) em erros definitivos do proxy no modo `messages`, para o SDK não repetir 2 vezes uma cadeia de fallback já esgotada e para expor `_request_id`. `(não confirmado se compensa)` | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa (TypeScript 1.4.0, Python 2.4.0, API 2026-10-21). Lidos o código dos clientes (cabeçalhos, autenticação, retentativas, erros, `User-Agent`) e a guia de migração. Descoberto que `api_key` agora vai em `Authorization: Bearer` e `anthropic-version` passou a `2026-10-21`. Abertas G1-G5 (#371-#375); G6-G8 registradas como oportunidade, sem issue. Não confirmado em captura de rede: ausência do `?beta=true` nas versões novas, cabeçalhos exatos do Python além dos de `_base_client.py`.
