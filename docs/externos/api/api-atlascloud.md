---
id: api-atlascloud
categoria: api
entidade: Atlas Cloud
agente: api-atlascloud
thinker_ids: [atlascloud]
revisado_em: 2026-11-12
versao_observada: docs atlascloud.ai 2026-11-12 + catálogo ao vivo api.atlascloud.ai/v1/models 2026-11-12
---

# Atlas Cloud (acesso por API)

Especificação mantida pelo agente `api-atlascloud` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

Agregador com chave `apikey-...` que serve modelos abertos (DeepSeek, Qwen, GLM, Kimi, MiniMax) e de fornecedores fechados (Claude, GPT, Gemini, Grok) pelos protocolos OpenAI (Chat Completions e Responses), Anthropic Messages e Gemini. Base OpenAI: `https://api.atlascloud.ai/v1`. O catálogo `GET /v1/models` é público, traz só modelos de texto (138 em 2026-11-12) e preços em USD por token como string, com faixa de contexto longo em `pricing.overrides`. O gateway força `stream_options.include_usage`. Os nomes dos campos de tokens em cache e de raciocínio no usage não estão documentados.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs (protocolos LLM) | <https://www.atlascloud.ai/docs/llm-protocols> | 2026-11-12 |
| Docs (chaves, erros, cobrança) | <https://www.atlascloud.ai/docs/api-keys>, `/docs/errors`, `/docs/billing/model-billing`, `/docs/billing/examples` | 2026-11-12 |
| Changelog | <https://www.atlascloud.ai/docs/changelog> | 2026-11-12 |
| Catálogo público | <https://api.atlascloud.ai/v1/models> | 2026-11-12 (138 modelos) |
| Catálogo do console (não documentado) | <https://console.atlascloud.ai/api/v1/models> | 2026-11-12 (608 modelos, todos os tipos) |
| Repositórios oficiais | <https://github.com/AtlasCloudAI> (`atlas-cloud-skills`, nó n8n, plugin OpenCode) | 2026-11-12 |

## Contrato

### Endpoints e protocolos

- Base OpenAI: `https://api.atlascloud.ai/v1` (o `/v1` é obrigatório). SDKs Anthropic e Gemini usam a raiz `https://api.atlascloud.ai`. Mídia (imagem e vídeo) fica em `https://api.atlascloud.ai/api/v1`. Só um host documentado; outras regiões (não confirmado). Fonte: `llm-protocols`, `api-keys`.
- Autenticação: `Authorization: Bearer <chave>` (recomendado, vale para todos os protocolos); também `x-api-key` (desde 2026-02, changelog), `x-goog-api-key` e `?key=` só no Gemini.
- Chave: começa com `apikey-` (`llm-protocols`). Comprimento mínimo não documentado (não confirmado). Chaves têm escopo; chave do Coding Plan num modelo fora do plano dá 403.

| Protocolo | Caminho |
|---|---|
| OpenAI Chat Completions (padrão, maior cobertura) | `POST /v1/chat/completions` |
| OpenAI Responses | `POST /v1/responses` (`previous_response_id`, `store`, `include` ignorados) |
| OpenAI Completions (poucos modelos) | `POST /v1/completions` |
| Anthropic Messages | `POST /v1/messages` (`cache_control` ignorado em protocolo traduzido; `tool_choice:"any"` vira `required`; até 4 `stop_sequences`) |
| Gemini | `POST /v1beta/models/{m}:generateContent` e `:streamGenerateContent?alt=sse` |

- Não existem: `/v1/embeddings`, `/v1/rerank`, `/v1/audio/*`, `/v1/messages/count_tokens`.
- Reescritas do gateway: insere o system prompt "You are a helpful assistant." quando falta; troca `max_completion_tokens` por `max_tokens`; normaliza `enable_thinking`, `thinking.type` e `reasoning_effort:"none"`; envia linhas SSE de keep-alive começando com `:`; corpo acima de 50 MB dá 413.

### Modelos

- `GET /v1/models` é público (200 sem chave). Envelope fora do padrão OpenAI: `{"code":200,"msg":"succeed","data":[...]}`.
- Campos por modelo: `id`, `name`, `context_length`, `max_output_length`, `quantization`, `input_modalities` (`text`, `image`, `video`, `audio`), `output_modalities`, `pricing`; em parte dos modelos, `supported_features` (`tools`, `reasoning`, `json_mode`, `structured_outputs`; ausente em todos os modelos Anthropic, OpenAI, Google e xAI), `supported_sampling_parameters`, `is_ready` (significado não documentado).
- Só modelos de texto, mas geradores de imagem aparecem com `output_modalities: ["text"]` (`openai/gpt-image-2`, `google/gemini-*-image`): filtrar pelo id.
- O campo `supported_apis` citado na doc não existe em `/v1/models`; o catálogo do console tem `supported_protocols` (`openai.chat.completions`, `gemini.generate`, `openai.images`, `systemone`). Três modelos são só Gemini (não confirmado se respondem em Chat Completions).
- Ids `vendor/modelo`, em geral minúsculos (`deepseek-ai/deepseek-v4-pro`, `zai-org/glm-5.1`, `anthropic/claude-sonnet-4.6`); exceções `deepseek-ai/DeepSeek-V3.2-Exp` e `autojev` (sem vendor). Sufixos como `-coding`, `-ccmax`, `-aws`, `-az` sem significado documentado (não confirmado). O id vai inteiro, com a barra.

### Capacidades

- Ferramentas: `tools`, `tool_choice`, `parallel_tool_calls` repassados nos modelos com `tools`.
- Visão e multimodal: `image_url`, `video_url` (extensão Atlas), `input_audio` (só Base64).
- Saída estruturada: `response_format` `json_object` e `json_schema`.
- Raciocínio: flag `reasoning`; `reasoning_effort` aceito e normalizado. O campo do texto de raciocínio na resposta Chat (`reasoning_content` ou outro) não está documentado (não confirmado).
- Cache de prompt: cobrado com taxa de entrada em cache; como ativar em Chat Completions não está documentado (não confirmado).

### Streaming e uso

- O gateway força `stream_options.include_usage: true`; o chunk final traz o usage. Chat termina com `data: [DONE]`; Anthropic e Responses não.
- Erro no meio do stream chega como evento dentro de um HTTP 200.
- Usage documentado: só `prompt_tokens`, `completion_tokens`, `total_tokens`. Campos de cache e de raciocínio (não confirmado; a cobrança cita entrada em cache, então algum campo deve existir).

### Preços

- `/v1/models`: USD por token, strings decimais em `pricing.prompt`, `completion`, `input_cache_read`, `image`, `request`. 44 modelos têm `pricing.overrides: [{prompt, completion, input_cache_read, min_context: 200000}]` (faixa de contexto longo). Sem preço de escrita de cache nesse endpoint.
- O catálogo do console traz por milhão de tokens `cache_creation_price` e `cache_creation_1h_price`, mas é não documentado.
- Cobrança por milhão de tokens, separando entrada, entrada em cache e saída (exemplo `zai-org/glm-5.2`: US$ 1,40 / 0,26 / 4,40 por milhão, igual ao catálogo × 1e6). Cobrado pelo `usage` da resposta; falhas não são cobradas. Há preço por horário (pico e fora de pico) em alguns modelos (changelog 2026-07).

### Limites e erros

| HTTP | Significado | Classe |
|---|---|---|
| 400 | requisição malformada | não retentar |
| 401 | chave inválida (caminho errado também dá 401, porque a autenticação vem antes do roteamento) | chave ruim |
| 402 | saldo insuficiente ou cota do Coding Plan esgotada | cota |
| 403 | sem permissão ou escopo da chave | não retentar |
| 404 | modelo inexistente ou indisponível para a conta | modelo |
| 413 | corpo acima de 50 MB | reduzir |
| 429 | limite de taxa por conta e por modelo | retentar com espera |
| 451 | bloqueado na região | não retentar |
| 500, 503, 504 | erro do servidor | retentar |

- Sem cabeçalhos `X-RateLimit-*` nem `Retry-After`; toda resposta tem `X-Request-ID`.
- Corpo de erro: `{"code":401,"msg":"unauthorized","request_id":"...","data":null}` (não é o formato OpenAI).
- Chaves criadas em <https://www.atlascloud.ai/console/api-keys>; a chave aparece uma vez só.

## Como o Thinker implementa hoje

- Cadastro: `packages/shared/src/providers.ts:106` (id `atlascloud`, aliases `atlas-cloud` e `atlas cloud`, prefixo `apikey-` exigido pelo dashboard, mínimo 20 caracteres).
- Proxy: base `ATLAS_CLOUD_BASE = https://api.atlascloud.ai/v1` em `packages/backend/src/routing/proxy/provider-endpoints.ts:225`; endpoint em `:442` com formato `openai`, caminho `/chat/completions`, `openaiHeaders` (Bearer) e `stream_options.include_usage`.
- O id do modelo vai com a barra (`packages/backend/src/routing/proxy/model-prefix.ts:23`); `reasoning_effort` é repassado (`provider-client-converters.ts:141`); os modelos ganham a capacidade `stream` (`model-discovery/model-capabilities.ts:15`).
- Descoberta: `GET {base}/models` com Bearer (`provider-model-fetcher.service.ts:1345`), `parseAtlasCloud` em `:1093`: descarta geradores de imagem pelo id e saídas não textuais; lê `context_length`, `prompt`/`completion`/`input_cache_read`, a faixa `overrides[].min_context` como `longContextPricing`, `tools` e `reasoning` de `supported_features` e `input_modalities`.
- Dashboard: tile em `packages/frontend/src/services/providers.ts:283` (inicial `AC`, sem logo), link da chave em `services/provider-api-key-urls.ts:3`.
- Testes: `packages/backend/src/model-discovery/provider-model-fetcher.aggregators.spec.ts`, `packages/backend/src/routing/proxy/__tests__/aggregator-endpoints.spec.ts`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/model-prefix.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Nomes dos campos de cache e de raciocínio no usage do Chat Completions não documentados; o Thinker lê os nomes OpenAI (`prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`). Confirmar com chave real. | `providers` | sem issue (precisa de teste ao vivo) | aberta |
| G2 | oportunidade | Modelos Anthropic têm `supported_features` ausente, então `capabilityCode`/`capabilityReasoning` ficam `false` até o models.dev completar. Mudança: inferir pelo vendor ou ler `supported_protocols` do console. | `providers` | sem issue | aberta |
| G3 | oportunidade | Preço de escrita de cache e preço por horário não são lidos (só existem no catálogo não documentado do console e no changelog). | `providers` | sem issue | aberta |
| G4 | oportunidade | Rota nativa `POST /v1/messages` não usada; harnesses Anthropic passam pela tradução Chat do Thinker. | `providers` | sem issue | aberta |

## Histórico

- 2026-11-12: primeira revisão completa (docs e catálogo ao vivo) junto com o cadastro do provedor (issue #132). Registradas G1 a G4.
