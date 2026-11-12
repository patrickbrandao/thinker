---
id: api-edenai
categoria: api
entidade: Eden AI
agente: api-edenai
thinker_ids: [edenai]
revisado_em: 2026-11-12
versao_observada: docs edenai.co/docs (v3) 2026-11-12 + catálogo ao vivo api.edenai.run/v3/models 2026-11-12
---

# Eden AI (acesso por API)

Especificação mantida pelo agente `api-edenai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

Gateway francês (UE) que revende mais de mil modelos de vários fornecedores com uma chave só. A API v3 é compatível com OpenAI em `https://api.edenai.run/v3` (Chat Completions e Responses) e aceita Anthropic Messages em `/v3/v1/messages`. Há um host UE (`https://api.eu.edenai.run`) que só roteia para fornecedores aprovados para a UE. O catálogo `GET /v3/models` é público, lista só LLMs (1.307 em 2026-11-12) e traz preços por token com nomes do LiteLLM (`input_cost_per_token`, `cache_read_input_token_cost`, `..._above_200k_tokens`). O usage traz cache de leitura e escrita; o `cost` em USD vem no nível superior da resposta.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs v3 (Mintlify) | <https://www.edenai.co/docs> (`/docs/llms.txt`, `/docs/llms-full.txt`) | 2026-11-12 |
| Chat Completions | <https://www.edenai.co/docs/v3/llms/chat-completions.md> | 2026-11-12 |
| Listagem de modelos | <https://www.edenai.co/docs/v3/llms/listing-models.md> | 2026-11-12 |
| Prompt caching | <https://www.edenai.co/docs/v3/llms/prompt-caching.md> | 2026-11-12 |
| OpenAPI | <https://api.edenai.run/v3/docs/openapi.json> | 2026-11-12 |
| Catálogo público | <https://api.edenai.run/v3/models> | 2026-11-12 (1.307 modelos) |

## Contrato

### Endpoints e protocolos

- Base OpenAI: `https://api.edenai.run/v3`; chat em `POST /v3/chat/completions` (não `/v3/llm/chat/completions`). Fonte: `chat-completions.md`, `first-llm-call.md`, OpenAPI.
- Host UE: `https://api.eu.edenai.run` com a mesma chave e os mesmos formatos; só fornecedores aprovados para a UE (Bedrock eu-west-1, Vertex UE, Azure EU Data Zone, Mistral, OVHcloud, Scaleway etc.), e o `/v3/models` de lá já vem filtrado. Fonte: `data-governance/eu-endpoint.md`.
- Autenticação: `Authorization: Bearer <chave>`. `x-api-key` (não confirmado).
- Chave: as de inferência começam com `sk-eden-` (só visto em exemplo mascarado; não confirmado como regra). Chaves de sandbox devolvem respostas simuladas sem custo. Chaves de gestão são separadas (`/v3/manage/*`).
- Protocolos: `POST /v3/chat/completions`; `POST /v3/responses` (estado salvo e `previous_response_id` só em fornecedores com Responses nativo); `POST /v3/v1/messages` (Anthropic, repasse nativo, com contagem de tokens). Também embeddings, rerank, imagens, áudio, vídeo e batches.
- Cabeçalho opcional `x-edenai-metadata: enabled` acrescenta `edenai_metadata` (fornecedor que atendeu, tentativas, região, BYOK).
- Fallback no corpo: `fallbacks: [...]`; nomes sem fornecedor fazem failover automático.

### Modelos

- `GET /v3/models` é público ("no API key is required"); 200 sem chave. `/v3/llm/models` responde igual (alias não documentado).
- Envelope OpenAI `{"object":"list","data":[...]}`. Campos: `id`, `owned_by`, `model_name`, `context_length`, `max_input_tokens`, `max_output_tokens`, `capabilities`, `pricing`, `list_pricing`, `discount`, `regions[{code,name}]`, `zero_data_retention`, `alias_of`.
- `capabilities`: `input_modalities`, `output_modalities`, `supports_reasoning`, `supports_function_calling`, `supports_prompt_caching`, `supports_response_schema`, `supports_parallel_function_calling` etc. Alguns modelos têm `capabilities: null` (ler como "não suportado").
- Só LLMs (outros tipos têm listas próprias como `/v3/embeddings/models`), mas 11 modelos Gemini de imagem têm `output_modalities: ["image","text"]`.
- Ids `fornecedor/modelo` (`openai/gpt-4o-mini`), alguns com mais barras (`fireworks_ai/accounts/...`), um sem barra; sufixo de região `@eu`/`@us`; aliases `-latest` e nomes sem fornecedor (Eden escolhe). O id vai inteiro.

### Capacidades

- Ferramentas: `tools`, `tool_choice` (`auto`, `required`, `none` ou nomeada).
- Visão por `input_modalities`.
- Raciocínio: `reasoning_effort` (`minimal`, `low`, `medium`, `high`, `max`, `xhigh`); `thinking: {type, budget_tokens}` documentado como só Claude (mínimo 1024; ignora `top_p`), com exemplo contraditório em Gemini. Campo do texto de raciocínio na resposta (não confirmado).
- Cache de prompt: OpenAI e DeepSeek automáticos; em Claude via Chat Completions o Eden insere marcadores `cache_control` efêmeros de 5 min se o cliente não mandar os próprios; preserva `cache_control` e `prompt_cache_breakpoint` sem traduzir; repassa `prompt_cache_key` e `prompt_cache_retention`. Roteamento fica preso ao fornecedor do cache por 10 min (`routing.sticky: false` desliga).

### Streaming e uso

- SSE `data: {chunk}` terminando em `data: [DONE]`; `finish_reason` `stop`, `length`, `content_filter`, `tool_calls`.
- Com `stream_options.include_usage: true`, o evento final de usage traz cache normalizado e `cost` antes do `[DONE]` (`prompt-caching.md`). Se `cost` fica dentro de `usage` ou no nível do chunk (não confirmado).
- Usage Chat: `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `prompt_tokens_details.cache_write_tokens`, `completion_tokens_details.reasoning_tokens`. Responses: `input_tokens_details.cached_tokens` e `cache_write_tokens`. Messages: `cache_read_input_tokens`, `cache_creation_input_tokens`.
- Resposta não streaming tem `"cost"` (USD, já com cache) e `"provider"` no nível superior.

### Preços

- USD por token (números) com chaves do LiteLLM: `input_cost_per_token`, `output_cost_per_token` (sempre), `cache_read_input_token_cost` (930 modelos), `cache_creation_input_token_cost` (364), faixas `_above_200k_tokens` e `_above_272k_tokens`, variantes `_priority`, `_flex`, `_batches`, `output_cost_per_reasoning_token`, `search_context_cost_per_query`.
- `pricing` é o preço com desconto; `list_pricing` é o de tabela. Algumas entradas trazem dados que não são preço dentro de `pricing` (ex.: `provider_specific_entry`).
- Sem margem sobre o fornecedor; taxa de 5,5% na compra de créditos (pré-pago via Stripe; pós-pago por contrato). BYOK suportado.

### Limites e erros

| HTTP | Significado | Classe |
|---|---|---|
| 400 | modelo desconhecido ou inativo | modelo |
| 401 | chave inválida ou token expirado | chave ruim |
| 402 | créditos insuficientes (corpo pode ser `{"error":"Insufficient credits"}`) | cota |
| 403 | guardrail, `no_compliant_provider`, `stored_state_not_allowed` | não retentar |
| 422 | corpo inválido | não retentar |
| 429 | limite de taxa (10 req/s por conta segundo `rate-limits.md`; a página de planos diz 7 req/s; não confirmado) | retentar com espera |
| 451 | `region_not_allowed` | não retentar |

- Corpo de erro OpenAI `{"error":{"message","type","param","code"}}`, com a exceção do 402 acima.
- Chaves em <https://app.edenai.run/settings/api-keys>.

## Como o Thinker implementa hoje

- Cadastro: `packages/shared/src/providers.ts:191` (id `edenai`, aliases `eden-ai` e `eden ai`; prefixo não exigido porque `sk-eden-` só aparece mascarado na doc; mínimo 20 caracteres).
- Proxy: base `EDEN_AI_BASE = https://api.edenai.run/v3` em `packages/backend/src/routing/proxy/provider-endpoints.ts:226`; endpoint em `:449` com formato `openai`, caminho `/chat/completions`, Bearer e `stream_options.include_usage`. O host UE se usa pela URL base editável da conexão (`https://api.eu.edenai.run/v3`).
- Id com barra preservado (`model-prefix.ts:24`); `reasoning_effort` repassado (`provider-client-converters.ts:142`); capacidade `stream` (`model-capabilities.ts:20`). `prompt_tokens_details.cache_write_tokens` já era lido em `stream-writer.ts`.
- Descoberta: `GET {base}/models` com Bearer (`provider-model-fetcher.service.ts:1350`), `parseEdenAi` em `:1159`: descarta saída não textual; lê `context_length`, preços base, cache de leitura e escrita, a primeira faixa `_above_200k_tokens`/`_above_272k_tokens` como `longContextPricing`, `supports_function_calling`, `supports_reasoning` e `input_modalities`. Ignora `_priority`, `_flex`, `_batches` e `list_pricing`.
- Dashboard: tile em `packages/frontend/src/services/providers.ts:295` (inicial `E`, sem logo), link da chave em `services/provider-api-key-urls.ts:9`.
- Testes: `packages/backend/src/model-discovery/provider-model-fetcher.aggregators.spec.ts`, `packages/backend/src/routing/proxy/__tests__/aggregator-endpoints.spec.ts`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/model-prefix.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/stream-writer.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O `cost` do Eden vem no nível superior da resposta (e talvez do chunk final), mas o Thinker só lê `usage.cost`; o custo cai nos preços do catálogo, que podem divergir com desconto ou BYOK. Confirmar a posição com chave real. | `providers` | sem issue (precisa de teste ao vivo) | aberta |
| G2 | oportunidade | Host UE `https://api.eu.edenai.run` só pela URL base editável; não há seletor de região. | `frontend-dev` | sem issue | aberta |
| G3 | oportunidade | Faixas `_priority`, `_flex`, `_batches` e `output_cost_per_reasoning_token` não são modeladas. | `providers` | sem issue | aberta |
| G4 | oportunidade | Prefixo `sk-eden-` não validado no dashboard até haver confirmação. | `providers` | sem issue | aberta |

## Histórico

- 2026-11-12: primeira revisão completa (docs v3, OpenAPI e catálogo ao vivo) junto com o cadastro do provedor (issue #132). Registradas G1 a G4.
