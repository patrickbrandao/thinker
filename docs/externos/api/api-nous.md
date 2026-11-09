---
id: api-nous
categoria: api
entidade: NousResearch API
agente: api-nous
thinker_ids: [nous]
revisado_em: 2026-11-04
versao_observada: gateway inference-api.nousresearch.com /v1/models 2026-11-04 (383 entradas); hermes-agent docs 2026-11-04
---

# NousResearch API (acesso por API)

Especificação mantida pelo agente `api-nous` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md). Dossiê irmão (assinatura OAuth): [sub-nous](../assinatura/sub-nous.md). Harness: [harness-hermes](../harness/harness-hermes.md).

## Resumo

- O gateway de inferência da Nous (`https://inference-api.nousresearch.com/v1`) é um agregador compatível com OpenAI Chat Completions, Responses, Completions e Anthropic Messages. O catálogo (383 entradas em 2026-11-04) espelha o formato do OpenRouter e é majoritariamente de terceiros (OpenAI, Qwen, Google, Anthropic, DeepSeek...). Os modelos Hermes 4 da própria Nous não aparecem na listagem pública lida (não confirmado se estão só atrás de chave).
- Chaves de API são geradas no Portal e **sempre consomem créditos pré-pagos**, não a franquia dos planos (página inicial do Portal, via busca; ver também [sub-nous](../assinatura/sub-nous.md) G1).
- O Thinker usa só `/v1/chat/completions` com Bearer e descobre modelos com o parser OpenRouter; funciona. Lacunas: custo de cache ignorado (#417) e modelos com `expiration_date` não filtrados (#418).
- Confiança: média. A listagem de modelos foi lida de verdade (endpoint público sem chave); a documentação oficial da API (`portal.nousresearch.com/api-docs`) respondeu 429 e não foi lida; nada foi testado com chave real.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Catálogo vivo (público, sem chave) | <https://inference-api.nousresearch.com/v1/models> | 2026-11-04 |
| Nous Portal (chaves, planos, créditos) | <https://portal.nousresearch.com> | 2026-11-04 (só resumo de busca) |
| Referência de API do Portal | <https://portal.nousresearch.com/api-docs> | não lida (HTTP 429 em 2026-11-04) |
| Docs do Hermes: integração Nous Portal | <https://hermes-agent.nousresearch.com/docs/integrations/nous-portal> | 2026-11-04 |
| Código do cliente oficial | <https://github.com/NousResearch/hermes-agent> | v0.22.7 (via sub-nous) |

A semente `portal.nousresearch.com` foi confirmada como hub de conta, chave e cobrança.

## Contrato

### Endpoints e protocolos

- Base: `https://inference-api.nousresearch.com` (docs do Hermes usam `.../v1`). Região única, sem escolha.
- Auth: `Authorization: Bearer <chave>`. Chave criada no Portal, seção de API keys (Cline docs e busca, 2026-11-04). Uma requisição sem credencial com modelo inexistente devolve 404 com corpo `{"status":404,"message":"Model '...' not found. The requested model does not exist in our configuration or OpenRouter catalog."}`, ou seja, a validação de modelo ocorre antes da de chave (observado 2026-11-04).
- Protocolos servidos por modelo, segundo o campo `endpoints` da listagem (274 modelos): `/api/v1/chat/completions`, `/api/v1/completions`, `/api/v1/messages`, `/api/v1/responses`. O prefixo `/api` é herdado do catálogo OpenRouter; no gateway da Nous o caminho é `/v1/...`.
- `POST /v1/messages` existe (Anthropic Messages): sem corpo válido devolve 400 `invalid_request_error` "model: field required" (observado 2026-11-04). Compatibilidade de cabeçalhos (`anthropic-version`, `x-api-key`) não confirmada.
- Variantes `:batch` (43) só aceitam `/api/v1/batches`; 35 modelos de embeddings aceitam `/api/v1/embeddings`; 2 modelos de imagem `/api/v1/images`; 31 entradas não têm `endpoints` (aliases `~vendor/...-latest` e semelhantes, não confirmado).
- Roteamento interno é misto: alguns modelos passam pelo OpenRouter, outros por outros backends, então opções específicas do OpenRouter podem ser ignoradas (docs do Hermes, 2026-11-04).
- Cabeçalho de resposta `X-Nous-Token-Sharing` é exposto via CORS (observado); significado não confirmado.
- Gateway separado para camada gratuita anônima: `https://welcome-api.nousresearch.com/v1` (ver [sub-nous](../assinatura/sub-nous.md)).

### Modelos

- Listagem: `GET /v1/models`, **sem autenticação**, resposta `{ "data": [...] }` de ~550 KB, formato OpenRouter. Campos por modelo: `id`, `canonical_slug`, `name`, `created`, `description`, `context_length`, `architecture` (`modality`, `input_modalities`, `output_modalities`, `tokenizer`), `pricing`, `top_provider` (`context_length`, `max_completion_tokens`), `supported_parameters`, `default_parameters`, `reasoning`, `knowledge_cutoff`, `expiration_date`, `endpoints`, `aliases`, `frontier`, `synthesizedFreeVariant`.
- Ids com barra (`anthropic/claude-sonnet-5.5`, `openai/...`, `z-ai/...`); a barra faz parte do id e não pode ser removida.
- Distribuição (2026-11-04): openai 80, qwen 42, google 34, mistralai 22, z-ai 21, anthropic 20, deepseek 17, moonshotai 10, x-ai 9, amazon 8, minimax 7, bytedance-seed 6. Saída: 343 só texto, 36 embeddings, 2 imagem+texto, 2 texto+áudio.
- Aliases móveis `~vendor/<família>-latest` (19, ex.: `~deepseek/deepseek-pro-latest`, `~openai/gpt-sol-latest`) apontam para o modelo mais novo da família.
- Variantes gratuitas `:free` (3): `upstage/solar-mini4:free`, `stepfun/step-3.7-flash:free`, `reflection/beam-1.0-501b-a23b:free`.
- Aposentadorias anunciadas por `expiration_date` (11): `minimax/minimax-m1`, `m2`, `m2.1` em 2026-11-05; `inception/mercury-2`, `2.5`, `3` em 2026-11-08; `bytedance-seed/seed-1.6`, `seed-1.6-flash`, `seed-2.0-code` em 2026-11-11; `minimax/minimax-m3.1-flash` e `z-ai/glm-4.5` em 2026-12-31.
- Hermes 4 70B/405B (modelos próprios da Nous): citados pelos docs do Hermes como com desconto e não recomendados para agentes; não presentes na listagem lida (não confirmado).

### Capacidades

- Descritas por modelo em `supported_parameters` (contagem em 383): `tools` 347, `tool_choice` 342, `response_format` 320, `structured_outputs` 302, `reasoning` 282, `include_reasoning` 251, `reasoning_effort` 187, `max_completion_tokens` 79, `parallel_tool_calls` 19, `web_search_options` 9; amostragem (`temperature`, `top_p`, `top_k`, `min_p`, `seed`, `logprobs`, `repetition_penalty`...) varia.
- Visão e arquivos: `architecture.input_modalities` (`text`, `image`, `file`).
- Raciocínio: objeto `reasoning` por modelo (ex.: `mandatory: true` nos Claude 5.5 observados); parâmetros `reasoning`, `reasoning_effort`, `include_reasoning`.
- Contexto e saída máxima: `context_length` e `top_provider.max_completion_tokens` (ex.: Claude Sonnet 5.5, 1.000.000 de contexto e 128.000 de saída).
- Cache de prompt: depende do modelo de origem; sinalizado pelos campos de preço `input_cache_read` / `input_cache_write` (ver Preços). Semântica de ativação (automática ou via `cache_control`) não confirmada.

### Streaming e uso

Não confirmado nas fontes lidas (documentação da API não acessível). Por ser camada tipo OpenRouter, espera-se `usage` com `prompt_tokens_details.cached_tokens` e `completion_tokens_details.reasoning_tokens` e `stream_options.include_usage` (não confirmado).

### Preços

- Em `pricing`, valores em USD por token, como string: `prompt` e `completion` em todos; `input_cache_read` (276), `input_cache_write` (91), `input_cache_write_1h` (17), `web_search` (115, por chamada), `image`, `audio`, `internal_reasoning` (27), `overrides` (68, preço por faixa de contexto, não confirmado o formato), `original` (9).
- Exemplo (Claude Sonnet 5.5 batch): `prompt` 1e-6, `completion` 5e-6, `input_cache_read` 5e-8, `input_cache_write` 1,25e-6, `web_search` 0,01.
- Chave de API sempre debita créditos pré-pagos (Portal, via busca; não confirmado em fonte primária). Hermes 4: Cline docs citam US$ 0,09 / 0,37 por 1M (405B) e 0,05 / 0,20 (70B); fonte secundária, não confirmado.

### Limites e erros

- Limites, cotas e códigos de erro não documentados nas fontes lidas. O gateway da assinatura usa 402 ao esgotar a janela e cabeçalhos `x-nous-credits-*` (ver [sub-nous](../assinatura/sub-nous.md)); se valem para chaves de API, não foi confirmado.
- Observado: 404 para modelo desconhecido (sem checar chave); 400 `invalid_request_error` no `/v1/messages` sem `model`.

### Parâmetros

Sem lista de parâmetros obrigatórios ou proibidos publicada nas fontes lidas. Opções específicas de OpenRouter podem ser ignoradas conforme o backend do modelo (docs do Hermes).

## Como o Thinker implementa hoje

Estado conferido no código em 2026-11-04:

- Registro do provedor: id `nous`, nome `NousResearch`, `requiresApiKey: true`, `minKeyLength: 10`, sem prefixo de chave (`packages/shared/src/providers.ts:333-343`).
- Base URL `https://inference-api.nousresearch.com` (`packages/backend/src/routing/proxy/provider-endpoints.ts:198`); entrada `nous` usa `openaiHeaders` (Bearer), caminho fixo `/v1/chat/completions`, formato `openai`, uso de stream com `openaiStreamUsage` (`provider-endpoints.ts:378-384`, `:96`). Nenhum uso de `/v1/messages`, `/v1/responses` ou embeddings.
- Descoberta de modelos: `GET https://inference-api.nousresearch.com/v1/models` com Bearer, parser `parseOpenRouter` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:70`, `:937-941`, `:627-665`). O parser descarta ids `:batch` e entradas cuja saída não seja só texto (isso remove embeddings e imagem corretamente), lê só `pricing.prompt`/`completion`, `context_length`, modalidades; `capabilityReasoning` é sempre `false`; `qualityScore: 3`.
- O id do modelo não é cortado na barra (`packages/backend/src/routing/proxy/provider-client.ts:340-360`), correto para ids como `anthropic/claude-sonnet-5.5`.
- Link para criar chave: `https://portal.nousresearch.com` (`packages/frontend/src/services/provider-api-key-urls.ts:44`). Cartão de configuração do provedor em `packages/frontend/src/services/providers.ts:452-465`, ícone em `ProviderIcon.tsx`.
- Sem tabela de preços conhecidos para `nous` (`known-model-prices.ts` não cita o provedor); o preço vem só da listagem.
- Na assinatura, `nous` é tratado como token colado (ver [sub-nous](../assinatura/sub-nous.md), issue #343).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | A listagem traz `input_cache_read`, `input_cache_write` e `input_cache_write_1h` (276, 91 e 17 modelos) e `parseOpenRouter` só lê `prompt`/`completion`: custo de cache impreciso. Arquivo: `provider-model-fetcher.service.ts:627-665`. Mesma causa de #408 (Kilo). | providers | [#417](https://github.com/patrickbrandao/thinker/issues/417) | resolvida (cache read/write lidos do catálogo) |
| G2 | degradação | 11 modelos trazem `expiration_date` (3 em 2026-11-05, 3 em 11-08, 3 em 11-11) e o Thinker os continua oferecendo; após a data falham. Filtrar vencidos na descoberta. | providers | [#418](https://github.com/patrickbrandao/thinker/issues/418) | resolvida (filtro de não-chat/aposentados na descoberta) |
| G3 | oportunidade | `/v1/messages` (Anthropic) e `/v1/responses` estão disponíveis em 274 modelos; o Thinker só fala Chat Completions. Rotas Anthropic/Responses poderiam passar sem tradução. Não registrada como issue (ganho incerto, compatibilidade não confirmada). | providers | — | aberta |
| G4 | oportunidade | Overrides de preço por faixa (`pricing.overrides`, 68 modelos) e `reasoning`/`reasoning_effort` por modelo não são usados (`capabilityReasoning` fixo em `false`). Mesma classe de #317 (OpenCode). Sem issue. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Catálogo público lido (383 modelos), `/v1/messages` e 404 de modelo desconhecido observados; docs da API do Portal indisponíveis (429), contrato de uso, limites e erros ficou parcial. Issues #417 e #418 abertas.
