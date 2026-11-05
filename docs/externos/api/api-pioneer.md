---
id: api-pioneer
categoria: api
entidade: Pioneer
agente: api-pioneer
thinker_ids: [pioneer]
revisado_em: 2026-11-04
versao_observada: docs.fastino.ai 2026-11-04 (OpenAPI v2.0.0)
---

# Pioneer (acesso por API)

Especificação mantida pelo agente `api-pioneer` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- **A Pioneer virou Fastino.** O host `api.pioneer.ai` foi aposentado: responde HTTP 410 `host_retired` com `moved_to` apontando para `https://api.fastino.ai`. `pioneer.ai` e `docs.pioneer.ai` não resolvem mais (DNS). A empresa é Fastino Labs (<https://fastino.ai>), painel em <https://agent.fastino.ai>, docs em <https://docs.fastino.ai>.
- Chaves novas começam com `fast_sk_`; as `pio_sk_` estão aposentadas.
- O path de chat não mudou: `POST /v1/chat/completions`, com `X-API-Key` (Bearer também aceito).
- O catálogo é pequeno (14 modelos em `/v1/models`): dois Nemotron da NVIDIA, dois fine-tunes Nemotron da Fastino (decoders de chat) e encoders GLiNER/GLiGuard (não são chat). Hoje o Thinker não funciona com este provider (G1, G2).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs Fastino (índice para agentes) | <https://docs.fastino.ai/llms.txt> | 2026-11-04 |
| OpenAPI oficial | <https://docs.fastino.ai/openapi.json> | v2.0.0, 2026-11-04 |
| Autenticação | <https://docs.fastino.ai/authentication.md> | 2026-11-04 |
| Erros e retries | <https://docs.fastino.ai/troubleshooting/errors.md>, `.../retries.md` | 2026-11-04 |
| Preços | <https://docs.fastino.ai/pricing.md> | 2026-11-04 |
| Catálogo vivo (público, sem chave) | <https://api.fastino.ai/v1/models>, <https://api.fastino.ai/v1/base-models> | 2026-11-04 |
| Site da empresa | <https://fastino.ai> | publicado 2026-10-29 |
| Pioneer site antigo (semente) | <https://pioneer.ai> | morto (DNS não resolve) |

Observação: as páginas de docs trazem um bloco "Agent instructions" dirigido a agentes; foi tratado como dado e ignorado.

## Contrato

### Endpoints e protocolos

Base URL única: `https://api.fastino.ai` (produção). Existem `https://api-stg.fastino.ai` e `https://api-dev.fastino.ai` (citados só na mensagem de 410; não confirmado que sejam públicos). Sem regiões.

Autenticação: `X-API-Key: <chave>` nas chamadas nativas; SDKs compatíveis com OpenAI/Anthropic enviam `Authorization: Bearer <chave>` e a mesma chave serve (docs/authentication). Chaves criadas em agent.fastino.ai > Settings > API Keys; a API pública não gerencia chaves. Formato `fast_sk_...`; `pio_sk_...` aposentado.

| Endpoint | Protocolo | Observações |
|---|---|---|
| `POST /v1/chat/completions` | OpenAI Chat Completions | `model` e `messages` obrigatórios; aceita `stream`, `tools`, `tool_choice`, `response_format`, `reasoning`, `temperature`, `max_tokens` etc.; extensões Fastino `schema`, `task_type`, `include_spans`, `include_confidence`, `threshold` (GLiNER) |
| `POST /v1/responses` | OpenAI Responses | `model` obrigatório; `previous_response_id`, `prompt_cache_key`, `store` presentes no schema |
| `POST /v1/messages` | Anthropic Messages | `anthropic-version` faz o erro vir em formato Anthropic; `thinking`, `output_config`, `cache_control` no schema |
| `POST /v1/systemone` | nativo (GLiDE) | só `fastino/GLiDE`; não é chat |
| `POST /v1/gliner-2` (+ `/async`, `/jobs/{id}`) | nativo (GLiNER) | extração; não é chat |
| `GET /v1/models` | lista compat | pública, aceita chamada sem chave |
| `GET /v1/base-models` | catálogo rico | público; filtra por inferência/treino |
| `/v1/training/*`, `/v1/datasets*`, `/v1/inferences*` | treino, datasets, histórico | fora do escopo do gateway |

Fonte: OpenAPI v2.0.0 (2026-11-04). Quais modelos aceitam cada protocolo de chat não está documentado por modelo (não confirmado); os decoders (Nemotron) são os candidatos a chat.

### Modelos

`GET /v1/models` (sem chave, 2026-11-04) devolve `data[]` com `id`, `display_name`, `max_input_tokens`, `max_tokens`, `deprecated`, `capabilities{...}` e preços `input/output/cache_read/cache_write_price_per_million`, além de `object`, `created`, `owned_by`. `GET /v1/base-models` devolve `models[]` com `task_type` (`decoder`, `encoder`, `systemone`), `context_window`, `max_output_tokens`, `is_chat_model`, `supports_inference`, `supports_on_demand_inference`, `supports_image_input`, `deprecated`, `replacement_model`, `deprecation_date`, `sunset_date`.

| id | task_type | contexto | saída máx | US$/1M in / out |
|---|---|---|---|---|
| `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4` | decoder | 262144 | 4096 | 0,08 / 0,45 (cache leitura 0,04) |
| `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` | decoder | 65536 | 4096 | 0,07 / 0,20 (cache leitura 0,035) |
| `fastino/Fastino-Nemotron-3.5-Lightning-Finance` | decoder | 8192 | 4096 | 0,50 / 0,50 |
| `fastino/Fastino-Nemotron-3.5-Lightning-Healthcare` | decoder | 8192 | 4096 | 0,50 / 0,50 |
| `fastino/GLiDE` | systemone | 65536 | n/d | 0,04 / 0 (só em `/base-models`) |
| `fastino/gliner2-*`, `fastino/gliner2.5-*`, `fastino/GLiNER-2.5-Decide`, `fastino/gliguard-*`, `fastino/gliner2-privacy-filter-PII-multi` | encoder | 2048 a 8192 | n/d | 0,03 a 0,15 |

- Todos `deprecated: false`; nenhuma aposentadoria anunciada na data da revisão.
- `/base-models` marca `is_chat_model: true` até para encoders; portanto esse campo não separa chat de não-chat, use `task_type` (não confirmado se é a intenção da Fastino).
- Modelos fine-tuned do usuário (via treino) são servidos por deploy próprio e retornam 409 enquanto não estão provisionados (docs/errors); aparecer ou não em `/v1/models` com chave é não confirmado.

### Capacidades

- Em `/v1/models` todos os modelos trazem `capabilities.*.supported: false` (inclusive `image_input` do "Super-VL" e `thinking`); os flags não parecem refletir a realidade (não confirmado). O "VL" sugere visão, `supports_image_input` é `false` em `/base-models`.
- O schema aceita `tools`/`tool_choice`/`response_format`/`reasoning`, mas não há doc dizendo quais modelos honram (não confirmado).
- Prompt caching: preços de cache leitura/escrita aparecem no catálogo; semântica de ativação não documentada (não confirmado).

### Streaming e uso

`stream: true` suportado nos três protocolos de chat. Respostas de sucesso trazem os headers `X-Fastino-Served-Model` (modelo canônico que atendeu) e `X-Fastino-Data-Retention` (`zero`, `not-stored` ou `stored`); ausentes em erros e em streams que falham antes do despacho. Campos de `usage` (cached/reasoning) não estão detalhados na doc (não confirmado). `store: false` desliga o histórico de inferência.

### Preços

Fonte: <https://docs.fastino.ai/pricing.md> (2026-11-04), US$ por 1M tokens; coincide com os valores de `/v1/models` na tabela acima. Treino cobra por GPU-minuto (config jobs) ou por token (interativo), fora do escopo. Há créditos pré-pagos, teto de gasto diário/mensal e overage por plano; tiers gratuitos não estão documentados na parte lida (não confirmado).

### Limites e erros

Envelope padrão `{"error":{"message","type","param","code"}}`; validação (422) acrescenta `error.errors[]`.

| Status | Significado | Retentar? |
|---|---|---|
| 401 | chave ausente, malformada, expirada ou revogada (inclui `pio_sk_` aposentada) | não |
| 402 | sem créditos: `out_of_credits`, `funding_required`, `spend_limit_reached`, `billing_required` (corpo `{code,message,resolution_url}`) | não |
| 403 | `credit_ceiling_reached` ou `card_required` (mesmo formato do 402) | não |
| 404 | modelo/recurso inexistente | não |
| 409 | modelo existe mas não está servível (só treino, ou deploy ainda provisionando) | depois do provisionamento |
| 410 | host aposentado (`host_retired`, `moved_to`) | não, trocar URL |
| 413 | corpo grande demais | não |
| 422 | validação | não |
| 425 | modelo aquecendo (`code: model_warming`, `Retry-After`) | sim |
| 429 | rate limit (`Retry-After`, `X-RateLimit-Scope`, `X-RateLimit-Code`; corpo com `code`, `scope`, `detail`) | sim |
| 451 | modelo indisponível por restrição de exportação/sanções | não |
| 500 / 503 | erro do servidor / indisponível | 503 sim, com backoff |
| 529 | só em `/v1/messages` (Anthropic-compat), sobrecarga | sim, manual |

Cold start: a doc recomenda read timeout de pelo menos 300 s para modelos ociosos. Limites numéricos de rate limit não estão documentados (não confirmado).

## Como o Thinker implementa hoje

Estado conferido no código em 2026-11-04 (worktree `onda3`):

- Base URL `https://api.pioneer.ai` (`provider-endpoints.ts:202`), endpoint `pioneer` em `provider-endpoints.ts:330-336`: formato `openai`, path `/v1/chat/completions` (`openaiPath`, linha 96), headers `X-API-Key` + `Content-Type` (`pioneerHeaders`, linhas 91-94), `openaiStreamUsage`.
- O id do modelo é enviado inteiro, sem remover prefixo de vendor (`provider-client.ts:340-361`), correto porque os ids têm barra (`nvidia/...`, `fastino/...`).
- Descoberta (`provider-model-fetcher.service.ts`): `GET https://api.pioneer.ai/v1/models` com `X-API-Key` (linhas 71, 508-510, 1334-1366), enriquece com `GET https://api.pioneer.ai/base-models` sem chave (linhas 72, 302-330, 1368+) usando `label`, `context_window`, `input/output_price_per_million`, `is_chat_model`, `supports_image_input`. Timeout 5 s (`FETCH_TIMEOUT_MS`, linha 54). Falha em `/v1/models` devolve lista vazia.
- Filtro de não-chat para pioneer: `/(?:gliner|gliguard|privacy-filter|^fastino\/)/i` (linha 466).
- Chave: `keyPrefix 'pio_sk_'`, `minKeyLength 20`, placeholder `pio_sk_...` (`packages/shared/src/providers.ts:419-429`); teste em `packages/frontend/tests/services/providers.test.ts:142-157,618-627`.
- Roteamento por prefixo `pioneer/` (`provider-inference.ts:24`); provider "capability-only" sincronizado com models.dev (`models-dev-sync.service.ts:64`, `model-capabilities.ts:148`, `model-discovery.service.ts:807`).
- UI: URL da chave `https://pioneer.ai` (`provider-api-key-urls.ts:22`), ícone `pioneer.svg` e detecção por URL `pioneer.ai` (`ProviderIcon.tsx:116,747-748,775`), subtítulo em `providerSetup` en/pt-BR.
- Sem tratamento específico de 425 (`model_warming`) nem do 410; o timeout de inferência é o global `PROVIDER_TIMEOUT_MS` (`provider-client.ts:143-144`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `pioneer`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | quebra | `api.pioneer.ai` responde 410 `host_retired`; Thinker usa esse host para inferência, `/v1/models` e `/base-models`. Trocar para `https://api.fastino.ai` (`provider-endpoints.ts:202`, `provider-model-fetcher.service.ts:71-72`, spec do fetcher). | providers | [#445](https://github.com/patrickbrandao/thinker/issues/445) | resolvida (host api.fastino.ai) |
| G2 | quebra | Chaves `pio_sk_` aposentadas; novas são `fast_sk_`. Validação em `shared/providers.ts:426-428` e no frontend rejeita chaves novas. | providers | [#446](https://github.com/patrickbrandao/thinker/issues/446) | resolvida (prefixo fast_sk_, pio_sk_ aceito como legado) |
| G3 | degradação | Rebranding Pioneer para Fastino: link de chave morto (`provider-api-key-urls.ts:22`), ícone por URL só reconhece `pioneer.ai`, textos de setup. | frontend-dev | [#447](https://github.com/patrickbrandao/thinker/issues/447) | resolvida (nome Fastino, link agent.fastino.ai, ícone por fastino.ai) |
| G4 | degradação | Filtro `^fastino\/` (fetcher linha 466) esconde os decoders de chat `fastino/Fastino-Nemotron-3.5-Lightning-*`; filtrar por `task_type` de `/base-models`. | providers | [#448](https://github.com/patrickbrandao/thinker/issues/448) | aberta |
| G5 | oportunidade | `/v1/responses` e `/v1/messages` (Anthropic-compat) existem; `/v1/models` expõe preço de cache leitura/escrita. Thinker usa só Chat Completions e ignora preços de cache. Sem issue (baixo valor, catálogo pequeno). | providers | — | aberta |
| G6 | oportunidade | Tratar 425 `model_warming` como retentável com `Retry-After` e permitir read timeout de 300 s para cold start. Sem issue. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Descoberta a aposentadoria de `api.pioneer.ai` (410) e a migração para Fastino (`api.fastino.ai`, chaves `fast_sk_`). Contrato escrito a partir do OpenAPI v2.0.0, docs e catálogos públicos. Abertas G1 a G4 (#445 a #448).
