---
id: api-opencode
categoria: api
entidade: OpenCode (API: paid and free models)
agente: api-opencode
thinker_ids: [opencode]
revisado_em: 2026-11-18
versao_observada: opencode v2.3.2 (c0ad18b) e console legado v1.19.6 (f4e363c); docs Console em 2026-11-18 (revisão parcial: chaves de API)
---

# OpenCode (API: paid and free models) (acesso por API)

Especificação mantida pelo agente `api-opencode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O OpenCode (antigo "Zen") serve inferência paga por uso e modelos gratuitos em `https://opencode.ai/inference/...`, uma base por protocolo (Chat Completions, Responses, Messages, Google). O catálogo público `GET /inference/v1/models` (sem autenticação) diz, por modelo, qual protocolo, base URL, preços, limites e capacidades.
- Os modelos gratuitos só atendem o cliente OpenCode (chave `public` + User-Agent/`x-opencode-client`); modelos pagos e o Go aceitam outros clientes (docs Zen). O Thinker se identifica como OpenCode em tudo (ADR 0009, escolha do mantenedor).
- O Thinker está alinhado com o contrato atual: bases, rota por protocolo via catálogo, versão do cliente `2.2.5` igual à última release (2026-10-30), cota esgotada tratada.
- Lacunas reais são de precisão de custo: faixas de preço por contexto longo (`overrides`) e o multiplicador por data do `gemini-4-argon` (dobra em 2026-12-01) não são lidos. Duas issues abertas (G1, G2).
- Nesta revisão o catálogo trazia 80 modelos (pago) e 28 (Go).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| OpenCode Zen docs | <https://opencode.ai/docs/zen/> | lida em 2026-11-03 (redireciona 302; sem data de versão) |
| OpenCode repository | <https://github.com/anomalyco/opencode> | tag `v2.3.2` (c0ad18b, 2026-11-18); backend legado do Console em `packages/console/*` só na linha `v1.19.6` (f4e363c, 2026-11-17) |
| Docs da Console (API, chaves, orçamentos) | <https://opencode.ai/docs/console/api>, <https://opencode.ai/docs/console/budgets>; fonte em `services/site/src/docs/content/console/` | lidas em 2026-11-18 (`v2.3.2`) |
| Catálogo pago (API) | <https://opencode.ai/inference/v1/models> | 2026-11-03, 80 modelos |
| Catálogo Go (API) | <https://opencode.ai/inference/go/v1/models> | 2026-11-03, 28 modelos |
| ADR 0009 (internal) | [0009-opencode-catalogo-proprio-e-modelos-gratuitos.md](../../adr/0009-opencode-catalogo-proprio-e-modelos-gratuitos.md) | 2026-11-02 |
| models.dev catalog | <https://models.dev> | `api.json` 2026-11-03: `opencode` (132 modelos) e `opencode-go` (37), base `https://opencode.ai/inference/openai/v1` |

Código do cliente lido: `packages/core/src/session/model-request.ts` (headers), `app.ts` (User-Agent), `plugin/provider/opencode.ts` (chave `public`), `session/to-session-error.ts` (erros) na tag `v2.2.5`.

## Contrato

### Endpoints e protocolos

Base `https://opencode.ai/inference` (Go: `https://opencode.ai/inference/go`). Fonte: catálogo `api.<protocolo>.base_url` e docs Zen.

| Protocolo (chave `api` do catálogo) | URL | Modelos (2026-11-03) |
|---|---|---|
| `chat-completions` | `{base}/openai/v1/chat/completions` | GLM 5.x, DeepSeek V4.x, Kimi K2.5-K3, MiniMax M2.5-M3, Mistral Large 4, Qwen3.8 Max, e todos os gratuitos |
| `responses` | `{base}/openai/v1/responses` | GPT 5.x/6.x, Grok 4.5-4.7 e Build, Muse |
| `messages` | `{base}/anthropic/v1/messages` | Claude (Fable, Opus, Sonnet, Haiku), Qwen 3.5/3.6/3.8 Flash |
| `generate-content` | `{base}/google/v1beta/models/<id>` (`:generateContent` / `:streamGenerateContent`) | Gemini 3.x e 4 Argon |
| Jev (SystemOne) | `{base}/systemone/v1/systemone` | modelo de decisão tipado, fora de escopo (ADR 0009) |

- Cada modelo do catálogo declara exatamente um protocolo. No Go o mapeamento difere do pago: `minimax-m3` e `qwen3.8-max` são `messages` no Go, mas `chat-completions` no pago; `qwen3.8-flash` é `messages` nos dois. Por isso o catálogo de cada provedor é a fonte, não a família.
- Segundo os docs Zen, todo modelo de texto também funciona pelas outras APIs (o Console traduz); lista completa de bases em `/console/harnesses#base-urls` (não lida). (não confirmado em chamada real)
- Os caminhos antigos `/zen/v1/...` ainda respondem (testado só o erro de cota igual ao de `/inference`); os docs atuais não os citam. O catálogo e o medidor Go usam `opencode.ai/zen/go/v1/usage` (cliente v2.2.5, `core/src/usage-limits.ts`).
- Autenticação: chave do Console como `Authorization: Bearer <key>` (OpenAI/Responses); Anthropic aceita `x-api-key` e Bearer (Bearer é o que o cliente usa com token OAuth do Console); Google usa `x-goog-api-key` (não conferido na fonte). Sem chave, o cliente oficial usa `Bearer public` e só habilita modelos com preço zero (`plugin/provider/opencode.ts`).
- Login do Console: device code em `{server}/auth/device/code` e `/auth/device/token` (cliente v2.2.5).

### Modelos

- Listagem: `GET /inference/v1/models` e `/inference/go/v1/models`, públicos. Formato: `{"object":"list","data":[...]}`; cada item tem `id`, `name`, `type` (`chat` em todos hoje), `family`, `canonical_id` (Go), `modalities.{input,output}`, `capabilities`, `limit.{context,input,output}`, `cost`, `api`, `knowledge`, `release_date`.
- Ids são nus (`glm-5.3`), o Thinker prefixa com `opencode/` ou `opencode-go/`.
- Gratuitos no pago (preço 0): `big-pickle`, `beam-free`, `flint-40b-free`, `mimo-v2.6-flash-free`, `nemotron-3.5-super-vl-free`, `nemotron-3.5-lightning-free`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `pulse-alpha-free`, `crouton-alpha-free`. Os docs também citam Nemotron 3 Ultra Free e Jev 1.13 Free (ausentes do catálogo de chat). No Go: `beam-free`, `iceman-contributor-free`, e `muse-spark-*-contributor` quase de graça.
- Aposentadorias: a tabela "deprecated" dos docs lista datas (p.ex. família Codex em 2026-07-23, Claude Sonnet 4 em 2026-06-15, GLM 5 em 2026-05-14); o catálogo é a lista viva.
- `pulse-alpha-free` e `beam-free` têm restrição geográfica (docs).

### Capacidades

Do campo `capabilities` do catálogo (por modelo):

- `tools.supported`; por protocolo, `api.<p>.capabilities.tools` com `strict`, `choice` (`auto|none|required|tool`), `search`, `freeform`.
- `reasoning.supported` e `reasoning.effort` (ex.: Claude Opus 5 `low..max`, GPT 5.5 `none..xhigh`, DeepSeek V4.1 Flash `low|high|max`).
- Em chat-completions, o raciocínio vem em `reasoning_content` (`api.compatibility.reasoning_field`).
- `structured_output`, `temperature`/`top_p`/`top_k` (false em Claude Opus 5 e GPT 5.5: parâmetros não aceitos), `system_updates`, `effort_updates`.
- Cache explícito (Claude): `cache.explicit` com `ttl` `5m|1h`, `max_breakpoints: 4`, `min_tokens: 512`.
- Contexto/saída por modelo em `limit` (ex.: Claude Opus 5 1.000.000 / 128.000; GPT 5.5 1.050.000 / 128.000). Modalidades de entrada incluem imagens e, no Gemini, áudio/vídeo.

### Streaming e uso

- Cada protocolo se comporta como o upstream nativo (SSE de Chat Completions, Responses, Messages, Gemini). Campos de uso: `cached` / escrita de cache seguem o protocolo; preço de escrita de cache só existe onde o catálogo traz `cache.write`.
- Requisições levam sessão em `x-opencode-session` (pina a sessão a um upstream). O cliente oficial envia mais (ver "Headers do cliente").
- `usage.cost`, quando devolvido pelo gateway, vale no pago; no Go dentro da cota é $0 (ADR 0009 item 6).

### Preços

- Preços em USD por 1M tokens em `cost.text.input.price`, `output.price`, `input.cache.read/write`.
- **Faixas por contexto**: `cost.text.input.overrides` / `output.overrides` com `when.context.gt` (100K, 200K, 256K, 272K, 512K conforme modelo) e novos `price`/`cache`. Ex.: `gpt-5.5` 5 -> 10 acima de 272K; `claude-sonnet-4-5` 3 -> 6 acima de 200K.
- **Multiplicadores** `cost.multipliers[].{when, factor}`: horário de pico no Go (`deepseek-v4.1-flash`, `deepseek-v4-pro`: seg-sex, 01:00-04:00 e 06:00-10:00 UTC, fator 2) e por data (`gemini-4-argon`: a partir de 2026-12-01 fator 2; até lá o preço de 2/10 já inclui o desconto de 50%, docs).
- `cost.audio` existe nos Gemini (não usado pelo Thinker).
- Taxa de processamento de crédito: 4,6% + $0,31 (docs). Modelos baratos (Haiku, Nano, Flash) podem aparecer no uso por geração de título de sessão.

### Limites e erros

- Cota gratuita diária por IP, reinicia 00:00 UTC, não publicada. Esgotada: HTTP 429 com corpo `{"type":"error","error":{"type":"FreeUsageLimitError","message":"Free usage limit reached. Free models work in OpenCode ..."}}` (reproduzido em 2026-11-03 com a chave pública).
- Outros tipos tratados pelo cliente oficial: `GoUsageLimitError` (`to-session-error.ts`). O Thinker ainda reconhece `BudgetLimitError`, `CreditLimitExceeded`, `insufficient_quota`.
- Modelos gratuitos de outro cliente: 403 ou 429 (ADR 0009); 401 para chave inválida (esperado, não verificado).
- Orçamento de política atingido: 429 `BudgetLimitError` com `metadata.{coverage, resetsAt}` (ver "Chaves de API do Console").
- `Retry-After` / `retry-after-ms` são honrados pelo cliente oficial (`ai/src/route/executor.ts`).

### Headers do cliente oficial (v2.2.5)

`core/src/session/model-request.ts`: `User-Agent: opencode/<channel>/<version>/<name>` (`app.ts`), `x-opencode-client: <name>`, `x-opencode-session`, `x-opencode-session-id`, `x-opencode-parent-session-id` (subagente), `x-opencode-project`, `x-session-affinity`, `X-Session-Id`, `x-parent-session-id` (subagente). Fora de inferência: `x-opencode-org-id` (workspace do Console). Quais são exigidos pelo servidor além de UA/`x-opencode-client` e `x-opencode-session`: (não confirmado).

### Chaves de API do Console (propriedades)

Pesquisa para comparar com as chaves de harness do Thinker. O Console está no meio de uma migração: as chaves novas (`oc_sk_...`) vivem num backend novo que **não está no repositório público**; as chaves antigas (`sk-...`) vivem no backend legado `packages/console/*` (linha `v1.19.6`, f4e363c, 2026-11-17), que hoje só roteia para o novo quando o workspace foi migrado (`migrated_at`). Os docs da Console estão em `services/site/src/docs/content/console/` na tag `v2.3.2` (c0ad18b, 2026-11-18) e batem com <https://opencode.ai/docs/console/api> e `/docs/console/budgets` lidos em 2026-11-18.

Legenda da coluna "Base": **doc** = documentado; **fonte** = lido no código; **observado** = visto em sonda.

| Propriedade | Chave nova `oc_sk_` (Console atual) | Chave legada `sk-` | Base |
|---|---|---|---|
| Formato | prefixo `oc_sk_`, depois um identificador, `_` e o segredo (exemplo dos docs: `oc_sk_1a2b3c4d5e6f_...`; tamanho exato não documentado); mostrada inteira uma vez, depois só o prefixo | `sk-` + 64 alfanuméricos, guardada em texto puro (`key` varchar 255, índice único global); a UI mostra `key.slice(0,7)...key.slice(-4)` e só ao dono | doc `console/api/index.mdx`; fonte `console/core/src/key.ts` (`create`, `list`), `schema/key.sql.ts` |
| Tipos | **Pessoal** (age como o membro, qualquer membro cria para si) e **de conta de serviço** (membro não humano, criada por owner/admin) | só pessoal (`userID` obrigatório) | doc `console/api/index.mdx`; fonte `key.sql.ts` |
| Campos | nome, workspace (fixo na criação, sem header de workspace), expiração, permissões; conta de serviço tem nome próprio | `id` (`key_...`), `workspaceID`, `name` (1-255), `key`, `userID`, `timeCreated`, `timeUpdated`, `timeDeleted`, `timeUsed` (coluna existe, mas nada no código a atualiza) | doc; fonte `key.sql.ts`, `drizzle/types.ts`, `identifier.ts` |
| Escopo | uma chave = um workspace; se o workspace exige SSO, a chave pessoal só funciona com sessão SSO ativa (exceto owners) | um workspace | doc `console/api/index.mdx`, `console/sso.mdx` |
| Expiração | opcional: Never, 1 day, 7 days, 30 days ou Custom (1-365 dias); chave expirada não renova, cria-se outra | não existe | doc |
| Desativar / revogar | só **revogar** (não há "desativar" e reativar). Dono revoga em Account > Personal API keys; owner/admin pelo membro ou pela conta de serviço. Revogação automática ao sair/ser removido do workspace ou desprovisionado via SCIM (inclui as chaves de conta de serviço que a pessoa criou), ao remover a conta de serviço e ao apagar o workspace | soft delete (`timeDeleted`); só admin remove chave de outro usuário | doc `console/api/index.mdx`, `members.mdx`, `workspaces.mdx`; fonte `key.ts` (`remove`) |
| Rotação | sem rotação in-place: cria-se nova e revoga-se a antiga. Conta de serviço com permissão "This account's API keys" cria e revoga chaves da própria conta (novas sempre Restricted, sem esse recurso) | não | doc |
| Edição | owner/admin renomeia chave de conta de serviço e muda permissões ("Edit...") | não | doc |
| Permissões | **All**, **Restricted** (por recurso: Models Read/Request, Usage, Budgets, Members, Providers, Billing, Workspace settings, SSO, Service accounts, This account's API keys) e **Read only** (lista modelos, não chama). Membro comum só cria chave "lista e chama modelos". Teto: o papel atual de quem a chave representa (rebaixar o membro encolhe a chave). Chaves antigas "Inference only" aparecem como Restricted + Models Request | não | doc |
| Último uso | não documentado | `timeUsed` sem escrita no código lido | doc (ausente); fonte |
| Orçamento | **não há orçamento por chave.** Orçamento mensal em USD (até 2 casas) por política em Controls: workspace inteiro, todos os membros (cada um ou compartilhado), membros por tag, membros específicos, todas as contas de serviço ou contas específicas. Uso de chave pessoal conta no membro; de conta de serviço, na conta. Todas as políticas aplicáveis valem (a menor vence). Reset dia 1 às 00:00 UTC; `$0` bloqueia; mudar no meio do mês conta o gasto já feito. Cobertura "All spend" ou modelos escolhidos (um limite para o conjunto ou um por modelo). Não contam: modelos gratuitos e Go dentro do plano; contam BYOK com preço, web search e Go extra | `billing.monthlyLimit` (workspace) e `user.monthlyLimit` (membro), em dólares inteiros, mês calendário UTC | doc `console/budgets.mdx`; fonte `schema/billing.sql.ts`, `user.sql.ts`, `handler.ts` (`validateBilling`) |
| Leitura do orçamento | `GET {console}/api/policies/current-budgets` com Bearer + `x-org-id`: lista `{ruleID, limitDollars, spentDollars, scope: each\|combined, per: set\|model, coverage: all\|models, models[], vendors[], inputPriceAtLeast?, picked, shared, resetsAt}`; chave de conta de serviço recebe 403 | n/a | sdk `anomalyco/opencode@v2.3.2` `packages/core/src/usage-limits.ts`, `packages/schema/src/usage-limits.ts` |
| Rate limit | não documentado por chave; só limites por modelo (ex.: LongCat 2.5 Free, 100 req/dia) | por chave e modelo, por minuto: `rateLimit` do modelo ou 1000 req/min, contador em Redis com TTL 60 s; anônimo usa limite por IP | doc `console/models.mdx`; fonte `routes/zen/util/keyRateLimiter.ts`, `ipRateLimiter.ts` |
| Lista de IPs permitidos | **não existe** (nem por chave nem por workspace) | não existe; o IP (`x-real-ip`, IPv6 truncado em /64) só serve para cota gratuita, trial e rate limit anônimo | doc (ausente em `console/*`); fonte `handler.ts` |
| Modelos permitidos | por permissão da chave (Models Request ou não), regras de modelo do membro e políticas Providers/Tools do workspace (entregues ao cliente OpenCode como `policies`); não há lista de modelos por chave | por workspace: linha em `model` desliga o modelo (`ModelError` "Model is disabled", HTTP 401) | doc `console/api/index.mdx`, `console/index.mdx`, `policies.mdx`; fonte `schema/model.sql.ts`, `handler.ts` (`validateModelSettings`) |
| Retenção / privacidade | por workspace, não por chave: Settings > Privacy com regiões permitidas (padrão Europa e EUA; Global para DeepSeek e LongCat) e "Allow paid endpoints that train on request data" (padrão desligado). Retenção por modelo/upstream fixa (0 a 55 dias, tabela Privacy) | `workspace.region` (`us\|eu\|sg\|cn`), `allow_training`, `is_blocked`, flags por upstream | doc `console/go.mdx`, `console/models.mdx#privacy`; fonte `schema/workspace.sql.ts` |
| Logs | Activity > Logs por requisição (membro vê os seus; owner/admin vê todos), uso por dia/modelo/pessoa, export CSV de 7/30/90 dias; uso legado grava `keyID` e `sessionID` por requisição | `usage.keyID` | doc `console/budgets.mdx`, `members.mdx`; fonte `schema/billing.sql.ts` (`UsageTable`) |

Erros ligados à chave (corpo sempre `{"type":"error","error":{"type","message"}}`, mais `metadata` em 429):

| Situação | Status | Corpo | Base |
|---|---|---|---|
| Sem chave em modelo pago | 401 | `error.type: "AuthError"`, `"Missing API key."`; header `x-opencode-log-id` | observado (sonda 2026-11-18: `POST /inference/openai/v1/chat/completions`, `glm-5.3`, sem `Authorization`) |
| Chave inválida, revogada ou expirada | 401 | legado: `AuthError` "Invalid API key."; novo: só o status documentado | doc `console/api/index.mdx`; fonte `handler.ts` (`authenticate`) |
| Fora das permissões da chave | 403 | não documentado | doc |
| Modelo gratuito de cliente que não é OpenCode | 403 | não documentado | doc `console/api/inference.mdx` |
| Orçamento de política atingido | 429 | `error.type: "BudgetLimitError"`, mensagem "Policy budget exceeded" ou "A budget policy for this model has been reached.", `metadata: {coverage: "all"\|"models", resetsAt}`; no Gemini, envelope Google `RESOURCE_EXHAUSTED` com `ErrorInfo{reason: "BudgetLimitError", domain: "opencode.ai", metadata}`. Não diz qual política | doc `console/budgets.mdx`; sdk `@v2.3.2` `packages/core/test/session-error.test.ts`, `core/src/session/to-session-error.ts` |
| Limite mensal legado (workspace / membro), sem saldo | 401 | `MonthlyLimitError`, `UserLimitError`, `CreditsError` | fonte `handler.ts` (o legado devolve 401, não 429) |
| Crédito esgotado (novo) | 402 | `CreditLimitExceeded` "Credit limit exceeded." | sdk `@v2.3.2` `session-error.test.ts` |
| Região ou política de dados | 403 | `RegionError`, `DataPolicyError` | fonte `handler.ts` |

### Formato na rede

Pendente: estrutura de pedido e resposta ainda não pesquisada (regras em [`.claude/external-research.md`](../../../.claude/external-research.md#wire-format)). Até a revisão, use a seção canônica do protocolo base listada no [índice](../README.md#formato-na-rede) e trate qualquer diferença desta entidade como não verificada.

## Como o Thinker implementa hoje

- Bases `https://opencode.ai/inference` e `.../inference/go`, quatro endpoints por provedor: `opencode` (Chat), `-responses`, `-anthropic`, `-google` (`packages/backend/src/routing/proxy/provider-endpoints.ts:195`, `:610-611`, `:621-662`).
- Headers: `User-Agent: opencode/latest/2.2.5/cli` e `x-opencode-client: cli` em todo request (`subscription-clients.ts:25-27`, `provider-endpoints.ts:616`); `x-opencode-session` com a chave de sessão ou do agente (`packages/backend/src/routing/proxy/provider-hooks.ts:51-53`, `:67-68`). Anthropic envia `x-api-key` e `Authorization: Bearer` (`provider-endpoints.ts:641-647`); Google `x-goog-api-key` e caminhos `:generateContent` / `:streamGenerateContent` (`:650-659`).
- Escolha do endpoint: `ProviderClient.resolveOpencodeEndpoint` consulta `OpencodeCatalogService.resolveFormat` e cai na heurística por família (`provider-client.ts:634-635`, `:654-671`, `:1069-1076`). A heurística erra para `qwen3.5/3.6/3.8-flash` no pago (catálogo diz Messages) e qualquer fora do catálogo; os docs dizem que a tradução do Console cobre, então o impacto é baixo (não confirmado).
- Catálogo: `OpencodeCatalogService` busca `opencode.ai/inference[/go]/v1/models`, cache de 1 h, backoff de 5 min com último bom, aquecimento só com provedor cadastrado e `THINKER_CATALOG_SYNC` (`model-discovery/opencode-catalog.service.ts:45`, `:52-57`, `:331-`). O parse usa uma única chave `api` na ordem chat > responses > messages > google (`:52`, `:338`), lê `limit`, `capabilities`, preços base e multiplicadores só de horário (`:381-`).
- Modo gratuito: chave `public` (`subscription-clients.ts:29`); descoberta mostra só modelos de preço zero quando a chave é `public` (`provider-model-fetcher.service.ts:1401`, `model-discovery.service.ts:258`).
- Modelos descobertos: `opencode/<id>` com preços, cache, reasoning, imagem; Go grava preço 0 (cota) (`provider-model-fetcher.service.ts:1516-1545`).
- Custo: `costInputs` usa preço de lista do catálogo, `ignoreReportedCost` só no Go (`opencode-catalog.service.ts:224`).
- Cota esgotada: regex `freeusagelimiterror|gousagelimiterror|budgetlimiterror|creditlimitexceeded|insufficient_quota|credit_balance_exhausted` (`routing/proxy/quota-reset.ts:19-20`); sem prazo no corpo, a rota esfria 1 h (padrão), teto 24 h (`routing/proxy/proxy-fallback.service.ts:165-166`, `:905-932`). `metadata.resetsAt` do `BudgetLimitError` não é lido.
- Alias `opencode-zen` / `opencodezen` (`packages/shared/src/providers.ts:443-454`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `opencode`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.controller.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`
- `packages/frontend/src/pages/integrations/McpServer.tsx`
- `packages/frontend/src/services/api/oauth.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/agent-type.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O catálogo traz faixas de preço por contexto (`input/output.overrides`, `when.context.gt`) que o parse ignora; contexto longo é cobrado a preço base (`opencode-catalog.service.ts:331-`). Sugestão: modelar a faixa no `PricingEntry`. | providers | [#317](https://github.com/patrickbrandao/thinker/issues/317) | resolvida (faixa por contexto e multiplicador por data lidos do catálogo) |
| G2 | degradação | `gemini-4-argon` tem multiplicador por data (`when.date.gte 2026-12-01`, fator 2) descartado por `parseMultipliers`; custo ficará 50% abaixo do real a partir de 2026-12-01. | providers | [#319](https://github.com/patrickbrandao/thinker/issues/319) | resolvida (faixa por contexto e multiplicador por data lidos do catálogo) |
| G3 | oportunidade | O cliente oficial envia também `x-opencode-session-id`, `x-session-affinity`, `X-Session-Id`, `x-opencode-project` (e pai de subagente). Se o servidor usar afinidade para cache, enviar esses headers pode melhorar acerto de cache. (não confirmado) Exige teste real. | backend-dev | — | aberta |
| G4 | oportunidade | Docs Zen: todo modelo de texto funciona por qualquer API (tradução do Console). A heurística de família (`provider-client.ts:1069`) poderia ser dispensada ou o fallback sem catálogo cair em Chat Completions. Confirmar com chamada real. | providers | — | aberta |
| G6 | oportunidade | O 429 `BudgetLimitError` do Console traz `metadata.resetsAt` (reset do orçamento, dia 1 00:00 UTC) e `coverage` (`all` pausa o workspace; `models` só aquele modelo). `parseQuotaSignal` só casa o regex genérico, então a rota volta a ser tentada a cada 1 h (`quota-reset.ts:19-20`, `proxy-fallback.service.ts:166`). Sugestão: ler `resetsAt` (também no `ErrorInfo.metadata` do envelope Google), respeitando o teto de 24 h. | backend-dev | — | aberta |
| G5 | oportunidade | Capacidades por modelo no catálogo (`reasoning.effort`, `cache.explicit` com ttl/breakpoints, parâmetros não aceitos como `temperature: false`) não são usadas no roteamento e na sanitização de parâmetros. | providers | — | aberta |

## Histórico

- 2026-11-18: revisão parcial, só chaves de API do Console (pedido para planejar várias chaves por harness e listas de IP). Lidos: docs da Console `v2.3.2` (api, budgets, members, workspaces, go, models, policies), backend legado `packages/console/*` em `v1.19.6`, `usage-limits.ts` e `to-session-error.ts` do cliente `v2.3.2`. Nova subseção "Chaves de API do Console". Sonda sem credencial confirmou 401 `AuthError` "Missing API key." e o header `x-opencode-log-id`. Aberta G6 (oportunidade, sem issue). Catálogo, preços e protocolos não foram revistos nesta rodada.
- 2026-11-03: primeira revisão completa. Fontes lidas: catálogos vivos (80 + 28 modelos), docs Zen, cliente `v2.2.5`, models.dev. Contrato escrito; Thinker alinhado em bases, protocolo por modelo, UA 2.2.5 e erro de cota. Abertas G1, G2 (issues #317, #319); G3-G5 como oportunidade sem issue. Uma chamada com a chave pública a um modelo gratuito confirmou o 429 `FreeUsageLimitError` e que `/zen/v1` ainda responde.
