---
id: api-opencode
categoria: api
entidade: OpenCode (API: paid and free models)
agente: api-opencode
thinker_ids: [opencode]
revisado_em: 2026-11-03
versao_observada: opencode v2.2.5 (9bbb8ce); catálogo /inference/v1/models e docs Zen em 2026-11-03
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
| OpenCode repository | <https://github.com/anomalyco/opencode> | tag `v2.2.5` (9bbb8ce, 2026-10-30) |
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
- `Retry-After` / `retry-after-ms` são honrados pelo cliente oficial (`ai/src/route/executor.ts`).

### Headers do cliente oficial (v2.2.5)

`core/src/session/model-request.ts`: `User-Agent: opencode/<channel>/<version>/<name>` (`app.ts`), `x-opencode-client: <name>`, `x-opencode-session`, `x-opencode-session-id`, `x-opencode-parent-session-id` (subagente), `x-opencode-project`, `x-session-affinity`, `X-Session-Id`, `x-parent-session-id` (subagente). Fora de inferência: `x-opencode-org-id` (workspace do Console). Quais são exigidos pelo servidor além de UA/`x-opencode-client` e `x-opencode-session`: (não confirmado).

## Como o Thinker implementa hoje

- Bases `https://opencode.ai/inference` e `.../inference/go`, quatro endpoints por provedor: `opencode` (Chat), `-responses`, `-anthropic`, `-google` (`packages/backend/src/routing/proxy/provider-endpoints.ts:195`, `:610-611`, `:621-662`).
- Headers: `User-Agent: opencode/latest/2.2.5/cli` e `x-opencode-client: cli` em todo request (`subscription-clients.ts:25-27`, `provider-endpoints.ts:616`); `x-opencode-session` com a chave de sessão ou do agente (`packages/backend/src/routing/proxy/provider-hooks.ts:51-53`, `:67-68`). Anthropic envia `x-api-key` e `Authorization: Bearer` (`provider-endpoints.ts:641-647`); Google `x-goog-api-key` e caminhos `:generateContent` / `:streamGenerateContent` (`:650-659`).
- Escolha do endpoint: `ProviderClient.resolveOpencodeEndpoint` consulta `OpencodeCatalogService.resolveFormat` e cai na heurística por família (`provider-client.ts:634-635`, `:654-671`, `:1069-1076`). A heurística erra para `qwen3.5/3.6/3.8-flash` no pago (catálogo diz Messages) e qualquer fora do catálogo; os docs dizem que a tradução do Console cobre, então o impacto é baixo (não confirmado).
- Catálogo: `OpencodeCatalogService` busca `opencode.ai/inference[/go]/v1/models`, cache de 1 h, backoff de 5 min com último bom, aquecimento só com provedor cadastrado e `THINKER_CATALOG_SYNC` (`model-discovery/opencode-catalog.service.ts:45`, `:52-57`, `:331-`). O parse usa uma única chave `api` na ordem chat > responses > messages > google (`:52`, `:338`), lê `limit`, `capabilities`, preços base e multiplicadores só de horário (`:381-`).
- Modo gratuito: chave `public` (`subscription-clients.ts:29`); descoberta mostra só modelos de preço zero quando a chave é `public` (`provider-model-fetcher.service.ts:1401`, `model-discovery.service.ts:258`).
- Modelos descobertos: `opencode/<id>` com preços, cache, reasoning, imagem; Go grava preço 0 (cota) (`provider-model-fetcher.service.ts:1516-1545`).
- Custo: `costInputs` usa preço de lista do catálogo, `ignoreReportedCost` só no Go (`opencode-catalog.service.ts:224`).
- Cota esgotada: regex `freeusagelimiterror|gousagelimiterror|budgetlimiterror|creditlimitexceeded|insufficient_quota` e espera até 24 h (`routing/proxy/proxy-fallback.service.ts:127-132`).
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
| G1 | degradação | O catálogo traz faixas de preço por contexto (`input/output.overrides`, `when.context.gt`) que o parse ignora; contexto longo é cobrado a preço base (`opencode-catalog.service.ts:331-`). Sugestão: modelar a faixa no `PricingEntry`. | providers | [#317](https://github.com/patrickbrandao/thinker/issues/317) | aberta |
| G2 | degradação | `gemini-4-argon` tem multiplicador por data (`when.date.gte 2026-12-01`, fator 2) descartado por `parseMultipliers`; custo ficará 50% abaixo do real a partir de 2026-12-01. | providers | [#319](https://github.com/patrickbrandao/thinker/issues/319) | aberta |
| G3 | oportunidade | O cliente oficial envia também `x-opencode-session-id`, `x-session-affinity`, `X-Session-Id`, `x-opencode-project` (e pai de subagente). Se o servidor usar afinidade para cache, enviar esses headers pode melhorar acerto de cache. (não confirmado) Exige teste real. | backend-dev | — | aberta |
| G4 | oportunidade | Docs Zen: todo modelo de texto funciona por qualquer API (tradução do Console). A heurística de família (`provider-client.ts:1069`) poderia ser dispensada ou o fallback sem catálogo cair em Chat Completions. Confirmar com chamada real. | providers | — | aberta |
| G5 | oportunidade | Capacidades por modelo no catálogo (`reasoning.effort`, `cache.explicit` com ttl/breakpoints, parâmetros não aceitos como `temperature: false`) não são usadas no roteamento e na sanitização de parâmetros. | providers | — | aberta |

## Histórico

- 2026-11-03: primeira revisão completa. Fontes lidas: catálogos vivos (80 + 28 modelos), docs Zen, cliente `v2.2.5`, models.dev. Contrato escrito; Thinker alinhado em bases, protocolo por modelo, UA 2.2.5 e erro de cota. Abertas G1, G2 (issues #317, #319); G3-G5 como oportunidade sem issue. Uma chamada com a chave pública a um modelo gratuito confirmou o 429 `FreeUsageLimitError` e que `/zen/v1` ainda responde.
