---
id: api-openrouter
categoria: api
entidade: OpenRouter
agente: api-openrouter
thinker_ids: [openrouter]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04 (catálogo /api/v1/models com 455 modelos)
---

# OpenRouter (acesso por API)

Especificação mantida pelo agente `api-openrouter` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

O OpenRouter é um agregador: uma chave `Authorization: Bearer` dá acesso a ~455 modelos de dezenas de fornecedores, com roteamento entre provedores, fallback e cobrança unificada sem acréscimo sobre o preço do fornecedor. O Thinker o usa só por Chat Completions (`/api/v1/chat/completions`) e também consome o catálogo público (ADR 0003). O que mudou de relevante: o endpoint serve também Responses e Anthropic Messages nativos para 382 modelos, `usage` agora vem sempre (parâmetros `usage.include` e `stream_options.include_usage` foram descontinuados), `X-OpenRouter-Title` substitui `X-Title` (o antigo segue aceito), há `expiration_date` por modelo e variantes `:batch`. A única lacuna relevante é o `thinking` da Anthropic Messages não virar `reasoning` (G1, issue #432).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://openrouter.ai/docs/quickstart> | 2026-11-04 |
| Models API | <https://openrouter.ai/api/v1/models> | 2026-11-04 (455 modelos, resposta lida direto) |
| API reference | <https://openrouter.ai/docs/api/reference/overview> | 2026-11-04 |
| Erros | <https://openrouter.ai/docs/api/reference/errors-and-debugging> | 2026-11-04 |
| Limites | <https://openrouter.ai/docs/api/reference/limits> | 2026-11-04 |
| Streaming | <https://openrouter.ai/docs/api/reference/streaming> | 2026-11-04 |
| Roteamento de provedores | <https://openrouter.ai/docs/guides/routing/provider-selection> | 2026-11-04 |
| Variantes de modelo | <https://openrouter.ai/docs/guides/routing/model-variants> | 2026-11-04 |
| Reasoning | <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens> | 2026-11-04 |
| Prompt caching | <https://openrouter.ai/docs/guides/best-practices/prompt-caching> | 2026-11-04 |
| Usage accounting | <https://openrouter.ai/docs/guides/administration/usage-accounting> | 2026-11-04 |
| Atribuição de app | <https://openrouter.ai/docs/app-attribution> | 2026-11-04 |
| Announcements | <https://openrouter.ai/announcements> | 2026-11-04 (última: 2026-10-30) |
| OpenAPI | <https://openrouter.ai/openapi.json> | não lido |

## Contrato

### Endpoints e protocolos

- Base: `https://openrouter.ai/api/v1`. Autenticação: `Authorization: Bearer <chave>` ([overview](https://openrouter.ai/docs/api/reference/overview)). Sem seleção de região no host; roteamento regional (EUA ou UE) é por requisição/conta ("In-Region Routing", anúncio de 2026-09-09; forma exata não confirmada) e o filtro `region` existe no catálogo.
- Protocolos servidos: `POST /api/v1/chat/completions` (OpenAI-like), `POST /api/v1/responses` (descrito como forma primária), `POST /api/v1/messages` (Anthropic Messages) e `POST /api/v1/completions`. O campo `endpoints` de cada modelo do catálogo diz quais se aplicam: 382 de 455 modelos listam os quatro; `/api/v1/batches` aparece em 73, `/api/v1/images` em 10 e `/api/alpha/extractions` em 1 (lido em 2026-11-04).
- Outros: `GET /api/v1/generation?id=` (estatísticas e custo de uma requisição), `GET /api/v1/key` (saldo/limite da chave e uso diário dos modelos gratuitos).
- Cabeçalhos de atribuição (opcionais, [app-attribution](https://openrouter.ai/docs/app-attribution)): `HTTP-Referer` (URL do app, identificador único; sem ele não há página do app nem ranking), `X-OpenRouter-Title` (nome; `X-Title` segue aceito), `X-OpenRouter-Categories` (até 2 categorias minúsculas separadas por vírgula, ≤30 caracteres; inválidas são descartadas) e `X-OpenRouter-App-Visibility: hidden` (fora dos rankings públicos). Em localhost o título é obrigatório para rastrear.
- Roteamento de provedores: objeto `provider` no corpo: `order`, `only`, `ignore`, `allow_fallbacks` (padrão `true`), `require_parameters` (padrão `false`), `data_collection` (`allow`|`deny`), `zdr`, `enforce_distillable_text`, `quantizations`, `sort` (`price`|`throughput`|`latency`, ou objeto `by`/`partition`), `preferred_min_throughput`, `preferred_max_latency`, `max_price` ([provider-selection](https://openrouter.ai/docs/guides/routing/provider-selection)). `models: []` (lista de fallback entre modelos) existe, mas não está na página de parâmetros (não confirmado em detalhe).
- Afinidade de sessão: o OpenRouter mantém o mesmo provedor para pedidos seguintes por 10 minutos de inatividade, a fim de manter o cache quente; `session_id` (corpo) ou `x-session-id` (cabeçalho) fixa a sessão desde o primeiro pedido. Não vale com `provider.order` manual ([prompt-caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)).

### Modelos

- `GET /api/v1/models`: parâmetros opcionais de filtro/ordem (`output_modalities` padrão `text`, `supported_parameters`, `region`, `q`, `sort`, `limit` padrão 500 e máximo 1000, `offset`). A resposta traz `data`, `total_count` e `links.next`. A doc lista bearer global; se o endpoint funciona anônimo não está dito, mas o Thinker o consulta sem chave e a resposta foi obtida assim em 2026-11-04.
- Campos do modelo: `id`, `canonical_slug` (pode diferir do `id`; ex.: `tencent/hy4` -> `tencent/hy4-20261104`), `name` ("Fornecedor: Modelo"), `created`, `context_length`, `architecture` (`input_modalities`, `output_modalities`), `pricing`, `top_provider` (`context_length`, `max_completion_tokens`), `supported_parameters`, `default_parameters`, `endpoints`, `reasoning` (`mandatory`, `default_enabled`, `default_effort`, `supported_efforts`; ausente em modelos sem raciocínio), `expiration_date` (ISO, modelo pode sair depois dela), `knowledge_cutoff`, `alias_target`, `benchmarks`.
- Ids têm formato `fornecedor/modelo`. Sufixos de catálogo aparecem como entradas próprias: `:free` (14 hoje) e `:batch` (modelo cobrado com 50% de desconto pela Batch API, anúncio de 2026-09-22; não serve o endpoint síncrono). `:thinking` e `:extended` estão descontinuados. Sufixos de roteamento valem em qualquer id e não aparecem no catálogo: `:nitro` (ordena por vazão), `:floor` (ordena por preço), `:exacto` (qualidade em tool calling); `:online` está descontinuado em favor da ferramenta de servidor `openrouter:web_search` ([model-variants](https://openrouter.ai/docs/guides/routing/model-variants)).
- Aposentadorias anunciadas pelo próprio catálogo (`expiration_date`, lido em 2026-11-04): `minimax/minimax-m2`, `m2.1`, `m2.7`, `m2-her` em 2026-11-05; `inception/mercury-2`, `2.5`, `3` em 2026-11-08; `bytedance-seed/seed-1.6`, `seed-1.6-flash`, `seed-2.0-code` em 2026-11-11; `z-ai/glm-4.7`, `glm-4.5v` em 2026-12-31.

### Capacidades

- `supported_parameters` por modelo (contagens em 455): `max_tokens` 438, `response_format` 393, `tools` 390, `tool_choice` 382, `structured_outputs` 380, `temperature` 343, `reasoning` e `include_reasoning` 338, `reasoning_effort` 217, `verbosity` 103, `parallel_tool_calls` 21, `web_search_options` 18.
- Entrada: `text+image->text` e variantes com `file`, `audio`, `video`; saída só texto na grande maioria, alguns com `image` ou `audio`.
- Reasoning ([doc](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)): objeto `reasoning` com `effort` (`max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`), `max_tokens` (orçamento; Anthropic mínimo 1024), `enabled`, `exclude` (só Chat Completions; tokens continuam cobrados). Resposta em Chat Completions: `message.reasoning` (texto) e `reasoning_details` (array de `reasoning.summary`, `reasoning.encrypted`, `reasoning.text`, com `id`, `format`, `index`); em streaming vêm em `choices[].delta`. Num laço de ferramentas é preciso devolver `reasoning`/`reasoning_details` inalterados e na mesma ordem. Tokens de raciocínio contam contra o limite de saída.
- Prompt caching ([doc](https://openrouter.ai/docs/guides/best-practices/prompt-caching)): OpenAI, DeepSeek, Grok, Moonshot, Groq (Kimi K2) e Gemini 2.5+ (implícito) cacheiam sem marcação; Anthropic e Qwen exigem `cache_control` por bloco (até 4 pontos; Gemini usa só o último) ou, na Anthropic, `cache_control` no topo do corpo para modo automático. Multiplicadores: Anthropic escrita 1,25x (TTL 5 min) ou 2x (1 h), leitura 0,1x; Gemini leitura 0,25x; DeepSeek leitura 0,1x; Grok e Moonshot leitura 0,25x; Groq 0,5x; OpenAI leitura 0,25x ou 0,5x conforme o modelo e escrita 1,25x a partir do GPT-5.6. Mínimos: OpenAI 1.024 tokens; Anthropic 512 a 4.096 conforme o modelo.
- Resposta estruturada, ferramentas (`tools`, `tool_choice`, `parallel_tool_calls` padrão `true`) e `verbosity` (`low`..`max`; na Anthropic vira `output_config.effort`) seguem o formato OpenAI. Parâmetro não suportado pelo provedor escolhido: a doc de parâmetros diz que o campo ausente é omitido no upstream; o tratamento de parâmetros não suportados fora de `require_parameters` não está descrito (não confirmado).
- Faixas: `temperature` 0 a 2, `top_p` 0 a 1, `frequency_penalty`/`presence_penalty` -2 a 2, `top_logprobs` 0 a 20.

### Streaming e uso

- SSE com linhas de comentário como `: OPENROUTER PROCESSING` (keep-alive); parsers manuais devem ignorar linhas iniciadas por `:` ([streaming](https://openrouter.ai/docs/api/reference/streaming)).
- O `usage` vem sempre, sem parâmetro. `usage: {include: true}` e `stream_options: {include_usage: true}` estão descontinuados e não têm efeito ([usage-accounting](https://openrouter.ai/docs/guides/administration/usage-accounting)). Em streaming o último chunk antes de `[DONE]` carrega o `usage` e, diferente da especificação OpenAI, tem uma `choice` com `delta` vazio repetindo o `finish_reason`; tratar como contabilidade, não como segundo fim de stream.
- Campos de `usage`: `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost` (valor cobrado da conta, em USD), `is_byok`, `cost_details.upstream_inference_cost`, `prompt_tokens_details.cached_tokens` (leitura de cache), `prompt_tokens_details.cache_write_tokens` (só em modelos com escrita de cache cobrada), `completion_tokens_details.reasoning_tokens`. Contagem usa o tokenizador nativo do modelo. A resposta pode trazer `cache_discount`.
- Erro no meio do stream: o status continua `200`; chega um chunk com `error` no topo e `finish_reason: "error"`, e o stream termina. Um `200` pode conter só o erro (inclusive quando todos os provedores falham antes da primeira saída). Failover entre provedores só ocorre se nenhuma saída chegou ao cliente.
- Cancelar o stream interrompe processamento e cobrança apenas em provedores que suportam isso; nos demais, o modelo roda até o fim e a resposta completa é cobrada. Requisições não-stream sempre são cobradas inteiras.

### Preços

- Preço em USD por token, como string, em `pricing`: `prompt` e `completion` sempre; opcionais `input_cache_read` (312 modelos), `input_cache_write` (99), `input_cache_write_1h` (34), `internal_reasoning`, `web_search`, `image`, `audio`, `image_output`, `audio_output`, `input_audio_cache`, `request`, `discount` e `overrides` (84 modelos; preços condicionais como contexto longo ou janela de horário). `:free` tem preço zero.
- Sem acréscimo sobre o preço do fornecedor na inferência. Compra de créditos tem taxa (percentual não confirmado, a página do FAQ não renderizou o valor). BYOK: franquia de US$ 25.000/mês sem taxa, depois 5% do que custaria no OpenRouter. Log de prompts/respostas é opt-in e dá 1% de desconto.
- Lote: metade do preço padrão (anúncio de 2026-09-22).

### Limites e erros

- Corpo de erro: `{ "error": { "code": <número>, "message": "...", "metadata": {...} } }`; o status HTTP coincide com `error.code` em erros de requisição ([errors](https://openrouter.ai/docs/api/reference/errors-and-debugging)).

| Status | Significado | Ação no gateway |
|---|---|---|
| 400 | parâmetros inválidos/ausentes ou CORS | erro do cliente, não repetir |
| 401 | chave inválida/desativada ou sessão OAuth expirada | chave ruim |
| 402 | créditos insuficientes na conta ou na chave (saldo negativo derruba até `:free`) | cota/saldo, não repetir na mesma chave |
| 403 | permissão, bloqueio de guardrail ou moderação (`metadata.reasons`, `flagged_input`) | não repetir |
| 408 | timeout | repetível |
| 429 | limite (`error_type: "rate_limit_exceeded"` traz `X-RateLimit-*`; 429 de provedor traz `provider_code`) | repetir com backoff e `Retry-After` |
| 502 | modelo fora do ar ou resposta inválida | repetível/fallback |
| 503 | nenhum provedor atende às restrições de roteamento | ajustar `provider` |

- Erros 500 têm a mensagem genérica; `metadata.provider_name`, `provider_code` e `raw` aparecem em recusas por política de conteúdo.
- Modelos `:free`: 20 req/min; 50 req/dia com menos de 10 créditos comprados, 1.000/dia com 10 ou mais (limite alto concedido a partir de 9 créditos). Modelos pagos não têm teto de plataforma; o Cloudflare bloqueia abuso extremo.
- Limite de chave e uso diário gratuito: `GET /api/v1/key` (`limit_remaining`, `free_model_daily_requests`, `is_free_tier`).

## Como o Thinker implementa hoje

Estado conferido no código em 2026-11-04 (branch `docs/externos-onda3`, commit base `2f97f17`).

- **Inferência.** Base `https://openrouter.ai`, caminho fixo `/api/v1/chat/completions`, formato `openai`, `Authorization: Bearer`, `Content-Type`, `HTTP-Referer: https://github.com/patrickbrandao/thinker` e `X-Title: Thinker` (`packages/backend/src/routing/proxy/provider-endpoints.ts:573-584`). Não usa `/responses` nem `/messages`, e não envia `X-OpenRouter-Categories`, `session_id`, `provider` ou `reasoning`.
- **Passthrough.** `openrouter` está em `PASSTHROUGH_PROVIDERS` (`provider-client-converters.ts:113`): campos de dialeto OpenAI/OpenRouter não são removidos; `reasoning` e `reasoning_details` das mensagens são preservados só para OpenRouter (`provider-client-converters.ts:373-380`). Nemotron via OpenRouter tem `thinking` removido (`:437-464`). O id do modelo mantém o prefixo `fornecedor/` (`provider-client.ts:332-336`).
- **Usage.** Pede `stream_options.include_usage` (`provider-endpoints.ts:84`, aplicado em `provider-client.ts:920-925`), hoje desnecessário mas inofensivo. `parseUsageObject` lê `prompt_tokens_details.cached_tokens` e `cache_write_tokens` e o custo reportado `usage.cost` ou `cost_details.upstream_inference_cost` (`stream-writer.ts:100-190`); o custo reportado vence qualquer estimativa (`common/utils/cost-calculator.ts:145-162`). Linhas de comentário SSE `:` são ignoradas (`stream-writer.ts:228`). Erro no meio do stream (`error` no topo) vira `upstream_error` (`routing/proxy/stream-protocol.ts:68-120`).
- **Cache.** Para `anthropic/*` injeta `cache_control` no último system/developer e na última tool, mais cache automático da Anthropic; para `google/*` e `qwen/*` injeta no último system/developer/user (`provider-client.ts:323-329,951-958`, `routing/proxy/cache-injection.ts:37-67`).
- **Listagem.** `GET https://openrouter.ai/api/v1/models` sem chave (`model-discovery/provider-model-fetcher.service.ts:1026-1030`). `parseOpenRouter` (`:627-665`) descarta ids terminados em `:batch` e modelos com saída que não seja só texto, e guarda id, nome, `context_length`, modalidades e preços `prompt`/`completion`; não lê `supported_parameters`, `reasoning`, `expiration_date`, `top_provider.max_completion_tokens` nem preços de cache; `capabilityReasoning` e `capabilityCode` ficam `false` e vêm do models.dev (`model-discovery/model-capabilities.ts:148-175`).
- **Catálogo e preços (ADR 0003).** `database/pricing-sync.service.ts:36` busca o mesmo endpoint, filtra modelos que aceitam e produzem texto e guarda só `input`/`output`/`context_length`/nome (`:105-135`, `:180-195`). Serve de fallback de preço e de lista (`model-discovery/model-fallback.ts:234-270`, `model-discovery.service.ts:312-326`). Mapa de prefixos de fornecedor em `packages/shared/src/providers.ts` (`openRouterPrefixes`) e inferência de provedor por prefixo em `packages/shared/src/provider-inference.ts:8,31`. Desabilitado por `THINKER_CATALOG_SYNC=false`.
- **Reasoning.** `reasoning-format.ts:36,103-108` trata `openrouter` como host que tolera `reasoning_content`. O `thinking` da Anthropic Messages só é traduzido para `openai` (`provider-client.ts:928-935`); em OpenRouter segue sem tradução (G1).
- **Snippet de setup.** Chave obtida em `https://openrouter.ai/keys` (`packages/frontend/src/services/provider-api-key-urls.ts:24`); texto do card "Auto-route to 300+ models" (`frontend/src/i18n/locales/en/providerSetup.ts:266`). O catálogo atual tem 455 modelos, então "300+" continua correto.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/cache-injection.ts`
- `packages/backend/src/routing/proxy/stream-writer.ts`
- `packages/backend/src/routing/proxy/stream-protocol.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/backend/src/routing/proxy/anthropic-messages-adapter.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/pricing-sync.service.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-prices/model-pricing-cache.service.ts`
- `packages/backend/src/common/utils/cost-calculator.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `thinking` da Anthropic Messages não é traduzido para `reasoning` quando o destino é `openrouter` (a tradução só existe para `openai`, `provider-client.ts:928-935`); modelos Claude via OpenRouter provavelmente rodam sem raciocínio e `thinking` segue como campo desconhecido (efeito não confirmado sem chave real). Sugestão: mapear para `reasoning.max_tokens`/`effort: none` ou usar `/api/v1/messages` para `anthropic/*`. | providers | [#432](https://github.com/patrickbrandao/thinker/issues/432) | resolvida (normalização de reasoning na entrada e na saída) |
| G2 | oportunidade | `parseOpenRouter` ignora `supported_parameters`, `reasoning`, `top_provider.max_completion_tokens` e `expiration_date`; capacidades de raciocínio/ferramentas dependem do models.dev e modelos prestes a sair (ex.: MiniMax M2.x em 2026-11-05) continuam listados. Sugestão: preencher capacidades e ocultar/avisar modelos vencidos a partir do catálogo. | backend-dev | — | aberta |
| G3 | oportunidade | Preços de cache (`input_cache_read`, `input_cache_write`, `input_cache_write_1h`) e `overrides` de contexto longo não entram no cache de preços; o custo real hoje vem de `usage.cost`, então só afeta estimativa e exibição de preço. Mesma causa do Kilo (#408). | backend-dev | — | aberta |
| G4 | oportunidade | Enviar `session_id`/`x-session-id` (o Thinker já tem `providerCacheKey`) para fixar o provedor e manter caches quentes em Anthropic, Gemini e DeepSeek; hoje a afinidade depende só do heurístico de 10 minutos. | providers | — | aberta |
| G5 | oportunidade | Atribuição: trocar `X-Title` por `X-OpenRouter-Title` (o antigo segue aceito) e avaliar `X-OpenRouter-Categories` e `X-OpenRouter-App-Visibility: hidden`. O `HTTP-Referer` atual expõe o app em rankings públicos; é decisão do mantenedor. | providers | — | aberta |
| G6 | oportunidade | Endpoint nativo `/api/v1/messages` e `/api/v1/responses` disponíveis em 382 modelos; usar para `anthropic/*` preservaria thinking, `cache_control` e blocos nativos sem tradução (relacionada a G1). | providers | — | aberta |

## Histórico

- 2026-11-04: primeira revisão completa. Contrato escrito a partir da doc e do catálogo vivo (455 modelos). Registradas G1 a G6; aberta a issue #432 para G1. Pendente de conferência com chave real: efeito do campo `thinking` no Chat Completions, tratamento de parâmetros não suportados e percentual da taxa de compra de créditos.
- 2026-11-03: esqueleto criado, sem pesquisa.
