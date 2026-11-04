---
id: api-byteplus
categoria: api
entidade: BytePlus ModelArk
agente: api-byteplus
thinker_ids: [byteplus]
revisado_em: 2026-11-04
versao_observada: docs ModelArk 2026-11-04 (via Context7 /websites/byteplus_en_modelark; modelos seed-2-0-*-2602/2603, glm-5-2-260617, deepseek-v4-*-ga)
---

# BytePlus ModelArk (acesso por API)

Especificação mantida pelo agente `api-byteplus` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- A API paga (pay-as-you-go) do ModelArk fica em `https://ark.ap-southeast.bytepluses.com/api/v3`, com `Authorization: Bearer $ARK_API_KEY`. É outro host-caminho que o do Coding Plan (`/api/coding`), e usar a base errada gera cobrança avulsa.
- **O Thinker não tem provedor para essa API.** O id `byteplus` cobre só o Coding Plan (dossiê `sub-byteplus`). Quem tem chave paga do ModelArk não consegue registrá-la (G1, issue #397).
- Protocolos: Chat Completions (`/chat/completions`), Responses (`/responses`) e uma API Messages estilo Anthropic. O raciocínio é controlado por `thinking.type` (`enabled`/`disabled`/`auto`), não por `reasoning_effort`.
- Modelos têm ids com sufixo de data (`seed-2-0-lite-260228`) ou ids de endpoint `ep-...`; contas podem ser proibidas de usar o id de modelo direto.
- Confiança média: o corpo das docs é SPA; os fatos vêm de trechos indexados pelo Context7 (páginas de 2026), sem acesso a preços numéricos nem à lista completa de modelos.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| ModelArk docs (base URL e autenticação) | <https://docs.byteplus.com/en/docs/modelark/base-url-and-authentication> | 2026-11-04 (via Context7) |
| Chat API | <https://docs.byteplus.com/en/docs/modelark/chat-api> | 2026-11-04 |
| Responses API | <https://docs.byteplus.com/en/docs/modelark/create-model-responses-api> | 2026-11-04 |
| Messages API (estilo Anthropic) | <https://docs.byteplus.com/en/docs/modelark/messages-api> | 2026-11-04 |
| Códigos de erro | <https://docs.byteplus.com/en/docs/modelark/error-codes> | 2026-11-04 |
| ListModelActivations / GetFoundationModel (plano de controle) | <https://docs.byteplus.com/en/docs/modelark/2596258> | 2026-11-04 |
| Pricing | <https://docs.byteplus.com/en/docs/ModelArk/1544106> | não lido (SPA; preços não carregam) |

Dica: as docs são renderizadas no cliente; para preços e lista de modelos com contexto/saída é preciso um navegador real.

## Contrato

### Endpoints e protocolos

| Item | Valor | Fonte |
|---|---|---|
| Base da API de dados | `https://ark.ap-southeast.bytepluses.com/api/v3` (região ap-southeast; outras regiões não confirmado) | base-url-and-authentication |
| Autenticação | `Authorization: Bearer $ARK_API_KEY` (chave de longo prazo do console; há também assinatura por access key) | idem |
| Chat Completions | `POST /api/v3/chat/completions` | chat-api |
| Responses | `POST /api/v3/responses`, `GET /api/v3/responses/{id}/input_items` | create-model-responses-api |
| Messages (estilo Anthropic) | documentada em messages-api; caminho exato (`/api/v3/messages`?) (não confirmado) | messages-api |
| Chat com cache de contexto | `POST /api/v3/context/chat/completions`, exige endpoint id | context-cache-conversation-api |
| Cabeçalho opcional | `x-is-encrypted: true` ativa criptografia da sessão de inferência, sem custo | sdk-common-examples |
| Coding Plan | base distinta (`/api/coding`); não usar na API paga e vice-versa | base-url-and-authentication; ver `sub-byteplus` |

### Modelos

- Ids de modelo levam sufixo de data de versão: `seed-2-0-lite-260228`, `seed-2-0-mini`, `seed-1-6-250615`, `glm-5-2-260617`, `deepseek-v4-pro-ga-260813`, `deepseek-v4-flash-ga-260731`, `deepseek-r1-250528`. A família ByteDance aparece como "Dola-Seed-2.0" (mini, lite, pro).
- Também se chama o modelo por **endpoint id** (`ep-...`). Algumas contas só podem usar endpoint id (erro 404 `InvalidEndpointOrModel.ModelIDAccessDisabled`). Chat com cache de contexto exige endpoint id.
- O modelo precisa estar ativado na conta; senão 404 `ModelNotOpen`.
- Não há `GET /models` na API de dados confirmado nas docs lidas (não confirmado). A listagem oficial fica no plano de controle (`ListModelActivations`, `ListFoundationModels`, `Action`+`Version=2024-01-01`, assinatura de access key, não de chave Bearer), com `IsDeprecated`, `State`, `ChargeItems` (com `WithPrice=true`) e `FoundationModelName`.
- Aposentadoria: o plano de controle expõe `IsDeprecated` e `Status: Retiring`; datas de EOL específicas não foram lidas (não confirmado).

### Capacidades

- Raciocínio: `thinking: {"type": "enabled" | "disabled" | "auto"}` (Chat; na Messages usa `adaptive` em vez de `auto`). Ligado por padrão em modelos de raciocínio. Resposta traz a cadeia em `reasoning_content` (Chat) ou itens `reasoning` com `summary` (Responses); `reasoning.encrypted_content` via `include` a partir de `seed-2-0-pro-260328`.
- `max_completion_tokens` (modelos que suportam, ex. `deepseek-r1-250528`, faixa [0, 64k]) exclui `max_tokens`; padrão de `max_tokens` é 4k.
- Ferramentas: `tool_calls` de tipo `function`; o doc avisa que o JSON de `arguments` pode ser inválido.
- Saída estruturada: `response_format` `text`/`json_object`/`json_schema` (beta, `strict` padrão `false`); na Messages é `output_format`.
- Visão: entradas de imagem/vídeo em modelos multimodais; `file_id` de Files API nos Seed 2.0 (Mini 260215+, Lite, Pro). Áudio: tokens `audio_tokens` existem em alguns modelos.
- Cache: modo implícito (automático) e explícito (`caching: {"type":"enabled"}` na Responses, `context_id` na API de contexto). Na Responses, `instructions` não combina com cache. Limites de contexto e saída por modelo: (não confirmado; tabela de modelos não lida).
- Contexto cacheado e `tools`/`thinking`/`response_format` são incompatíveis na API de contexto.

### Streaming e uso

- Chat: `usage.prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens` (também `audio_cached_tokens`, `audio_tokens`), `completion_tokens_details.reasoning_tokens`.
- Em streaming o `usage` só vem se `stream_options.include_usage=true` (chunk extra com `choices: []` antes de `data: [DONE]`). Exceções documentadas: `glm-5-2-260617`, `deepseek-v4-pro-ga-260813`, `deepseek-v4-flash-ga-260731` devolvem uso por padrão.
- Responses: `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`.
- Messages: `cache_creation_input_tokens` volta sempre 0 (cobrança de criação de cache não suportada).
- Na multi-turno por `previous_response_id`, a doc recomenda cerca de 100 ms entre requisições (senão podem falhar).

### Preços

- Cobrança por token, unidades "thousand tokens"; itens `InferencePrompt` e `InferenceCompletion`, com `MultiChargeItems` para faixas por tamanho de entrada. Preços numéricos: (não confirmado, página de pricing não renderiza sem JS).
- `service_tier`: `default`, `auto` (pacote de garantia de TPM), `fast` (baixa latência) e `flex` (offline, cerca de metade do preço na doc de vídeo; para texto não confirmado).
- Cada modelo ativado pode ter cota gratuita inicial (`InitialInferenceFreeUsage`, ex. 1.000.000 tokens).
- O preço de token em cache é cobrado a uma taxa menor (valores não confirmados).

### Limites e erros

| HTTP | Código | Significado | Tratar como |
|---|---|---|---|
| 404 | `ModelNotOpen` | modelo não ativado na conta | configuração (não retentável) |
| 404 | `InvalidEndpointOrModel.NotFound` | modelo/endpoint não existe ou sem acesso | modelo inválido |
| 404 | `InvalidEndpointOrModel.ModelIDAccessDisabled` | conta só aceita endpoint id | configuração |
| 404 | `UnsupportedModel` | modelo sem suporte ao Coding Plan | só no Coding Plan |
| 429 | `RateLimitExceeded.EndpointRPMExceeded` / `EndpointTPMExceeded` / `EndpointFlexTPMExceeded` | limite do endpoint | retentável com espera |
| 429 | `ModelAccountRpmRateLimitExceeded` / `ModelAccountTpmRateLimitExceeded` / `ModelAccountFlexTpmRateLimitExceeded` | limite da conta por modelo | retentável com espera |
| 429 | `APIAccountRpmRateLimitExceeded`, `AccountRateLimitExceeded` | limite de API da conta | retentável com espera |
| 429 | `QuotaExceeded` | cota gratuita do modelo esgotada (ou fila de tarefas cheia) | cota; não retentável no caso gratuito |
| 429 | `ServerOverloaded` | sobrecarga; comum em rajada ou endpoint ocioso | retentável com backoff |

Erro de chave inválida (401 `AuthenticationError`): (não confirmado, não apareceu nos trechos lidos).

## Como o Thinker implementa hoje

Estado conferido no código em 2026-11-04:

- Não existe provedor para a API paga `/api/v3`. O único id é `byteplus`, que aponta para o Coding Plan: `BYTEPLUS_CODING_BASE = https://ark.ap-southeast.bytepluses.com/api/coding` (`packages/backend/src/routing/proxy/provider-endpoints.ts:185`), Chat em `/v3/chat/completions` (`:295-301`) e variante Anthropic `byteplus-anthropic` em `/v1/messages` (`:302-308`).
- Registro do provedor, aliases `byteplus-plan`, `modelark`, `modelark-coding-plan`, placeholder "ModelArk Coding Plan API key", sem prefixo de chave e `minKeyLength: 10` (`packages/shared/src/providers.ts:122-132`).
- Descoberta de modelos: `GET https://ark.ap-southeast.bytepluses.com/api/coding/v3/models` filtrado pela lista fixa `knownModels` da assinatura (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:56`, `:342-345`, `:882-886`; `packages/shared/src/subscription/configs.ts:47`).
- Link de criação de chave: console BytePlus, região ap-southeast-1 (`packages/frontend/src/services/provider-api-key-urls.ts:41`).
- O mapeamento `byteplus` -> `byteplus-anthropic` em `packages/backend/src/routing/proxy/provider-hooks.ts:20`; `anthropic-beta.ts:98` exclui BytePlus dos betas Anthropic.
- Uso em stream: o ramo OpenAI usa `openaiStreamUsage` (inclui `stream_options.include_usage`), então o uso chega.
- Sem tradução de `thinking` e sem tratamento específico dos códigos de erro do ModelArk.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/shared/src/subscription/configs.ts`

Arquivos que citam `byteplus`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | oportunidade | Não há provedor para a API paga do ModelArk (`/api/v3`, chave `ARK_API_KEY`); o id `byteplus` cobre só o Coding Plan. Falta base, caminho `/chat/completions`, descoberta (sem `GET /models` confirmado; usar lista fixa ou plano de controle), tradução de `thinking`, tratamento de 404 `ModelNotOpen`/`ModelIDAccessDisabled` e de 429 `ServerOverloaded`/`*RateLimitExceeded*`, e suporte a endpoint id `ep-...`. | providers | [#397](https://github.com/patrickbrandao/thinker/issues/397) | aberta |
| G2 | oportunidade | Sem preços/contexto da API paga (tabela de modelos e pricing não lidas); `known-model-prices.ts` não tem Seed 2.0. Depende de G1 e de leitura com navegador real. | providers | (ver #397) | aberta |

Relação com `sub-byteplus`: lista desatualizada do Coding Plan é a G1 daquele dossiê (#329); aqui não se repete.

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Contrato escrito a partir das docs ModelArk (Context7); confirmado que o Thinker só cobre o Coding Plan; aberta a G1 (#397). Preços e limites de contexto por modelo ficaram sem confirmação.
