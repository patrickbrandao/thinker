---
id: sub-openai
categoria: assinatura
entidade: ChatGPT Plus / Pro / Team (Codex)
agente: sub-openai
thinker_ids: [openai]
revisado_em: 2026-11-03
versao_observada: openai/codex rust-v0.166.0 (6ff1e1c), docs 2026-11-03
---

# ChatGPT Plus / Pro / Team (Codex) (assinatura)

Especificação mantida pelo agente `sub-openai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Thinker usa o login ChatGPT (OAuth PKCE do Codex CLI) e fala com o backend privado `https://chatgpt.com/backend-api/codex/*` em Responses API, imitando o Codex CLI (`originator: codex_cli_rs`).
- A última release estável do cliente é `rust-v0.166.0` (2026-10-29); o Thinker fixa `0.159.2`. O `client_version` filtra os modelos devolvidos por `/codex/models` (G1).
- Catálogo atual (embutido no Codex 0.166.0): `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol/terra/luna`, `gpt-5.5`. O Thinker não conhece `gpt-6.1-terra` (G2) e fixa contexto de 1.050.000 onde o Codex usa 272K (G3).
- Cota esgotada chega como 429 `usage_limit_reached` com `resets_at`; o Thinker aplica cooldown de 15 s (G4).
- O Codex envia `ChatGPT-Account-ID`; o Thinker não (G5, não confirmado ao vivo).
- Termos de uso para tráfego de terceiros via gateway: nenhuma fonte primária encontrada que autorize ou proíba; tratar como risco (ver "Clientes permitidos e termos").

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Codex repository (login, client, models) | <https://github.com/openai/codex> | tag `rust-v0.166.0`, commit 6ff1e1c (2026-10-29) |
| Codex releases | <https://github.com/openai/codex/releases> | estável `rust-v0.166.0`; pré-lançamento `rust-v0.167.0-alpha.4` (2026-11-03) |
| Using Codex with your ChatGPT plan | <https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan> | não lido (HTTP 403 ao buscar em 2026-11-03) |
| Codex pricing (substitui developers.openai.com/codex/pricing, 308) | <https://learn.chatgpt.com/docs/pricing> | 2026-11-03 |
| Codex auth (substitui developers.openai.com/codex/auth, 308) | <https://learn.chatgpt.com/docs/auth> | 2026-11-03 |

Os links `developers.openai.com/codex/*` redirecionam (308) para `learn.chatgpt.com/docs/*`.

## Contrato

### Planos

Fonte: <https://learn.chatgpt.com/docs/pricing> (2026-11-03).

| Plano | Preço | Codex |
|---|---|---|
| Free | US$ 0 | GPT-6 Luna, velocidade padrão |
| Go | US$ 8/mês | GPT-6 Luna |
| Plus | US$ 20/mês | web, CLI, IDE, iOS; GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Luna; créditos extras |
| Pro | a partir de US$ 100/mês (100/200/500) | inclui Plus; Ultrafast no plano de US$ 500; sem limite de 5 h hoje |
| Business | US$ 20/usuário/mês (anual) | 2+ usuários, créditos extras, SSO/MFA |
| Enterprise / Edu | sob consulta | sem limites fixos com preço flexível (usa créditos) |

O enum de planos do cliente (`protocol/src/account.rs`) tem: `free`, `go`, `plus`, `pro`, `prolite`, `promax`, `team`, `self_serve_business_prolite`, `self_serve_business_usage_based`, `business`, `ent26`, `enterprise_cbp_*`, `enterprise`, `edu`, `edu_plus` (lista parcial).

Limites locais por janela de 5 h (Plus e Business padrão, estimativa): GPT-6 Astra 5-45, GPT-6.1 Sol 15-160, GPT-6.1 Terra 35-285, GPT-6 Sol 15-150, GPT-6 Luna 350-3.000 mensagens; limites semanais podem valer. Fast mode consome 2,5x da franquia e 2x créditos; Ultrafast 8x e 6x.

### Autenticação

Fonte: `codex-rs/login/src/server.rs`, `login/src/auth/manager.rs`, tag `rust-v0.166.0`; <https://learn.chatgpt.com/docs/auth>.

| Item | Valor |
|---|---|
| Fluxo | Authorization code + PKCE S256 no navegador; callback em loopback `http://127.0.0.1:<porta>/auth/callback` (porta padrão 1455) |
| Também existe | device code (`codex login --device-auth`, beta, habilitado pelo admin) e `--with-access-token` (token de acesso de automação, Enterprise) |
| Issuer | `https://auth.openai.com` (`/oauth/authorize`, `/oauth/token`) |
| `client_id` | `app_EMoamEEZ73f0CkXaXp7hrann` (override `CODEX_APP_SERVER_LOGIN_CLIENT_ID`) |
| Escopos | `openid profile email offline_access api.connectors.read api.connectors.invoke` |
| Extras do authorize | `id_token_add_organizations=true`, `codex_cli_simplified_flow=true`, `originator=<originator>`; opcionais `allowed_workspace_id`, `current_workspace_id`, `login_hint`, `connection` |
| Refresh | POST `https://auth.openai.com/oauth/token`, `grant_type=refresh_token`, `client_id`, `refresh_token` (form-urlencoded; `login/src/oauth/client.rs`) |
| Renovação preventiva | o cliente renova quando o último refresh tem mais de 8 dias (`TOKEN_REFRESH_INTERVAL`), e após 401 |
| Erros de refresh | `refresh_token_expired`, `refresh_token_reused` (rotação: o token antigo morre), `refresh_token_invalidated`; HTTP 401 ou 400 `invalid_grant` são permanentes, o resto é transitório |
| Claims do id_token | `https://api.openai.com/auth` com `chatgpt_account_id` e `chatgpt_plan_type` (`login/src/token_data.rs`) |

### Endpoints

Base `https://chatgpt.com/backend-api` (`agent-identity/src/lib.rs` aceita também `…/backend-api/codex` e `chat.openai.com`; staging em `chatgpt-staging.com`).

| Uso | Endpoint |
|---|---|
| Inferência | `POST {base}/codex/responses` (Responses API; SSE; o cliente também usa WebSocket) |
| Modelos | `GET {base}/codex/models?client_version=<versão>` |
| Uso/limites | `GET {base}/wham/usage` (estilo `ChatGptApi`; estilo Codex `/api/codex/usage`) |
| Conta | `GET {base}/wham/accounts/check`, `GET {base}/wham/profiles/me` |

Corpo de `/codex/responses` (`codex-api/src/common.rs`, `ResponsesApiRequest`): `model`, `stream`, `service_tier?`, `input[]`, `tools?`, `tool_choice`, `parallel_tool_calls`, `reasoning`, `store` (false), `stream_options?`, `include` (sempre `reasoning.encrypted_content`), `prompt_cache_key?`, `text?`, `client_metadata?` (`x-openai-subagent`, `x-codex-turn-metadata`, `x-codex-window-id`, `installation_id`), `access_programs?`.

Resposta de `/codex/models` (`protocol/src/openai_models.rs`, `ModelInfo`): `slug`, `display_name`, `description`, `visibility` (`list`/`hide`/`none`), `supported_in_api`, `priority`, `context_window`, `max_context_window`, `supported_reasoning_levels`, `default_reasoning_level`, `service_tiers`, `input_modalities`, `support_verbosity`, `upgrade{model, migration_markdown}` entre outros.

Catálogo embutido no Codex 0.166.0 (`models-manager/models.json`; fallback do cliente, o valor ao vivo pode diferir):

| slug | visibility | context_window | max_context_window |
|---|---|---|---|
| gpt-6-astra | list | 272000 | 872000 |
| gpt-6.1-sol | list | 272000 | 872000 |
| gpt-6.1-terra | list | 500000 | 872000 |
| gpt-6-sol | list | 272000 | 872000 |
| gpt-6-luna | list | 272000 | 872000 |
| gpt-5.6-sol / terra / luna | list | 272000 | 872000 |
| gpt-5.5 | list | 272000 | 272000 |
| gpt-daybreak-blue-latest, gpt-daybreak-red-latest, codex-auto-review | hide | 272000-372000 | 372000-872000 |

### Identificação do cliente

Fonte: `codex-api/src/endpoint/responses.rs`, `codex-api/src/requests/headers.rs`, `login/src/auth/default_client.rs`, `model-provider/src/bearer_auth_provider.rs`, `core/src/client.rs`.

| Cabeçalho | Valor / quando |
|---|---|
| `Authorization` | `Bearer <access_token>` |
| `ChatGPT-Account-ID` | `chatgpt_account_id` do id_token, em toda chamada autenticada por ChatGPT |
| `originator` | `codex_cli_rs` por padrão (override interno `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`) |
| `User-Agent` | `codex_cli_rs/<versão> (<SO> <versão>; <arquitetura>) <terminal>` |
| `session-id`, `thread-id` | ids estáveis da conversa; `thread-id` também vai em `x-client-request-id` |
| `x-codex-turn-state` | token sticky devolvido pela resposta e reenviado no resto do turno |
| `x-openai-subagent` | `review`, `compact`, `memory_consolidation`, `collab_spawn` ou rótulo livre, em subagentes |
| `x-codex-beta-features` | lista de recursos beta ativos |
| `OpenAI-Beta` | flags de recursos (WebSocket entre eles) |
| `X-OpenAI-Fedramp: true` | contas FedRAMP |

Gate de versão: só `client_version` em `/codex/models` (modelos novos exigem versão recente). Nenhuma fonte indica que o `User-Agent` seja validado (o comentário do Thinker diz que não é) (não confirmado).

### Clientes permitidos e termos

- A documentação de auth recomenda chave de API para automação e CI; o login ChatGPT é descrito para o app, CLI e IDE do Codex. Token de acesso programático existe apenas por meio de admins Enterprise (`--with-access-token`).
- Nenhuma fonte primária lida afirma se tráfego de um gateway de terceiros com o OAuth do Codex é permitido ou causa ação na conta. Termos de uso da OpenAI/ChatGPT não foram lidos nesta revisão (a central de ajuda devolveu 403). Tratar como risco de suspensão (não confirmado), semelhante ao caso do Gemini (#324).
- Administradores podem forçar método de login e workspace (`forced_login_method`, `forced_chatgpt_workspace_id`).

### Cotas e uso

- Janelas: 5 horas (primária) e semanal (secundária); Pro hoje sem limite de 5 h. Créditos pagam o excedente nos planos com crédito.
- Cabeçalhos em respostas (`codex-api/src/rate_limits.rs`): `x-codex-primary-used-percent`, `x-codex-primary-window-minutes`, `x-codex-primary-reset-at`, `x-codex-secondary-primary-used-percent`, `…-window-minutes`, `…-reset-at`, `x-codex-credits-has-credits`, `x-codex-credits-unlimited`, `x-codex-credits-balance`, `x-codex-active-limit`, e por família `x-<limite>-primary-*` com `x-<limite>-limit-name`.
- Uso restante também em `GET /wham/usage` (campos de janelas primária e secundária, `additional_rate_limits`, `credits`, `plan_type`).

### Erros

Fonte: `codex-api/src/api_bridge.rs`.

| Situação | Sinal |
|---|---|
| Janela de uso esgotada | 429, `error.type = usage_limit_reached`, com `plan_type`, `resets_at`, `limit_window_minutes`; cabeçalhos `x-codex-*` |
| Plano sem Codex | 429 `usage_not_included` |
| Cota/crédito | 429 `insufficient_quota` ou `code` em `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded` |
| Sobrecarga | `server_is_overloaded` |
| Política | 400 com código `cyber_policy`, `bio_policy`, `invalid_prompt`, `misalignment_policy_violation` |
| Bloqueio regional | 403 com corpo "Cloudflare" e "blocked" |
| Autorização | cabeçalho `x-openai-authorization-error`; 401 dispara refresh do token |
| Rastreio | `x-request-id`, `x-oai-request-id`, `cf-ray` |

Modelo fora do plano: o bloqueio do Thinker cita 400 "not supported with a ChatGPT account" para `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1-codex(-max)` (comentário em `provider-model-fetcher.service.ts:475`; mensagem original não reconferida).

## Como o Thinker implementa hoje

- Autenticação: OAuth PKCE em popup com callback em `localhost:1455` (`packages/backend/src/routing/oauth/openai/openai-oauth.service.ts:12-29`): authorize `https://auth.openai.com/oauth/authorize`, token `…/oauth/token`, revoke `…/oauth/revoke`, escopo `openid profile email offline_access`, `client_id` `app_EMoamEEZ73f0CkXaXp7hrann` (override `OPENAI_OAUTH_CLIENT_ID`), sem parâmetros extras do Codex. A base (`routing/oauth/core/redirect-pkce-oauth.base.ts:132,160-175,241-262`) monta redirect `http://localhost:<porta>/auth/callback` e faz refresh form-urlencoded com `grant_type`, `refresh_token`, `client_id`; o blob guarda só `access_token`, `refresh_token` e expiração (sem id_token nem `account_id`).
- Constantes (`packages/backend/src/common/constants/subscription-clients.ts:21-23`): `CODEX_CLI_VERSION = '0.159.2'`, `CODEX_CLI_ORIGINATOR = 'codex_cli_rs'`, `CODEX_CLI_USER_AGENT = 'codex_cli_rs/0.0.0 (Unknown 0; unknown) unknown'` (sintético).
- Inferência: endpoint `openai-subscription`, base `https://chatgpt.com/backend-api`, path `/codex/responses`, formato `chatgpt`, cabeçalhos `Authorization`, `Content-Type`, `originator`, `user-agent` (`routing/proxy/provider-endpoints.ts:184,204-223`). O corpo é adaptado com `defaultInstructions`, `inputList`, `forceStream` e remoção de campos não suportados, inclusive `max_output_tokens` (`routing/proxy/provider-client.ts:825-895`).
- Afinidade de cache (`routing/proxy/codex-session-affinity.ts`, usada em `provider-client.ts:502-577`): envia `session-id` e `thread-id` derivados por SHA-256 do `prompt_cache_key` do chamador (UUID v4 sintético), injeta `prompt_cache_key`, reenvia `x-codex-turn-state` com TTL deslizante de 5 min (máx. 10.000 entradas) e descarta o token em respostas de erro. Não envia `x-client-request-id`, `x-openai-subagent` nem `ChatGPT-Account-ID`.
- Modelos: `GET https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLI_VERSION}` com os mesmos cabeçalhos; o parser aceita só `visibility === 'list'` e usa `context_window ?? 200000` (`model-discovery/provider-model-fetcher.service.ts:731-749,866-876`). Bloqueados à mão: `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1-codex-max`, `gpt-5.1-codex` (`:473-480`).
- Config de assinatura (`packages/shared/src/subscription/configs.ts:70-100`): rótulo "ChatGPT Plus/Pro/Team", `popup_oauth`, `knownModels` exatos (`gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`), `maxContextWindow` 200000 e `modelContextWindows` de 1.050.000 para os GPT-6 e GPT-5.6; o mapa fixo tem prioridade sobre o valor do provedor (`model-discovery/model-fallback.ts:157-190`). Prompt caching `true`, batching `false`.
- Rate limit: 429 sem `Retry-After` usa cooldown de 15 s; só OpenCode e `insufficient_quota` contam como cota esgotada (`routing/proxy/proxy-fallback.service.ts:125-131,794-811`). Os cabeçalhos `x-codex-*` e `/wham/usage` não são lidos.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/codex-session-affinity.ts`
- `packages/backend/src/routing/proxy/chatgpt-adapter.ts`
- `packages/backend/src/routing/proxy/chatgpt-helpers.ts`
- `packages/backend/src/routing/proxy/chatgpt-response-qualifier.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/routing/oauth/openai/openai-oauth.service.ts`
- `packages/backend/src/routing/oauth/openai/openai-oauth.controller.ts`
- `packages/backend/src/routing/oauth/core/redirect-pkce-oauth.base.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `CODEX_CLI_VERSION` 0.159.2; estável atual 0.166.0; `client_version` filtra modelos | `providers` | [#348](https://github.com/patrickbrandao/thinker/issues/348) | aberta |
| G2 | degradação | `knownModels` exato sem `gpt-6.1-terra`; `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark` fora do catálogo 0.166.0 | `providers` | [#350](https://github.com/patrickbrandao/thinker/issues/350) | resolvida (lista de modelos atualizada) |
| G3 | degradação | contexto fixo de 1.050.000 sobrepõe o `context_window` (Codex: 272K, teto 872K; valor ao vivo não confirmado) | `providers` | [#351](https://github.com/patrickbrandao/thinker/issues/351) | resolvida (janela de contexto por modelo) |
| G4 | degradação | 429 `usage_limit_reached` recebe cooldown de 15 s; `resets_at` ignorado | `backend-dev` | [#352](https://github.com/patrickbrandao/thinker/issues/352) | resolvida (cooldown até o reset lido do corpo do erro) |
| G5 | degradação | sem `ChatGPT-Account-ID`, sem `id_token_add_organizations`/`codex_cli_simplified_flow` e escopos `api.connectors.*` (contas multi-workspace; não confirmado) | `providers` | [#353](https://github.com/patrickbrandao/thinker/issues/353) | aberta |
| G6 | oportunidade | ler `x-codex-*` e `GET /wham/usage` para mostrar uso restante e `resets_at` da assinatura; enviar `x-client-request-id`, `x-openai-subagent` e User-Agent real | `backend-dev` | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra `openai/codex` `rust-v0.166.0` e docs de preços e auth em learn.chatgpt.com; central de ajuda OpenAI inacessível (403). Abertas G1-G5 (#348, #350-#353); G6 só registrada. Pendente de conta real: valores ao vivo de `/codex/models`, necessidade de `ChatGPT-Account-ID`, termos de uso para gateways.
