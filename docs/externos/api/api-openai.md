---
id: api-openai
categoria: api
entidade: OpenAI
agente: api-openai
thinker_ids: [openai]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04; openai-openapi f69b0e1 (2026-11-03); openai-node v7.50.0
---

# OpenAI (acesso por API)

Especificação mantida pelo agente `api-openai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Base `https://api.openai.com`, `Authorization: Bearer`. Duas superfícies de inferência: `/v1/chat/completions` e `/v1/responses`. Os docs migraram de platform.openai.com para `developers.openai.com/api/docs` (redirect 301).
- Linha atual: `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna` (contexto 1.050.000, saída máx. 128K), mais `gpt-5.6-*`, `gpt-5.5`, `gpt-5.4*`.
- **Mudança grande:** nos modelos GPT-6, tool calling em Chat Completions é limitado (Astra, 6.1 Sol, 6.1 Terra exigem Responses; 6 Sol e 6 Luna só com `reasoning_effort: "none"`). O Thinker os manda a Chat Completions (G1, quebra).
- Reasoning: `reasoning_effort` (Chat) / `reasoning.effort` (Responses) com `none|minimal|low|medium|high|xhigh|max`, cada modelo aceita um subconjunto; Astra e 6.1 Sol rejeitam `none`. Com effort diferente de `none`, `temperature`, `top_p`, `top_logprobs` (e `logprobs` em Chat) devem sair do pedido (G2).
- Preço tem faixa longa (>272K), cache write (1,25x/2,5x) e multiplicadores Batch/Flex/Fast/Ultrafast; o Thinker não os modela (G3).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| API reference | <https://platform.openai.com/docs/api-reference> (redireciona para developers.openai.com/api/docs) | não lida diretamente; contrato extraído da OpenAPI |
| Models | <https://developers.openai.com/api/docs/models> | 2026-11-04 |
| Pricing | <https://developers.openai.com/api/docs/pricing> | 2026-11-04 |
| Changelog | <https://developers.openai.com/api/docs/changelog> | 2026-11-04 (entradas até 2026-10-30) |
| Guia de reasoning | <https://developers.openai.com/api/docs/guides/reasoning> | 2026-11-04 |
| Guia do modelo mais recente | <https://developers.openai.com/api/docs/guides/latest-model> | 2026-11-04 |
| Códigos de erro | <https://developers.openai.com/api/docs/guides/error-codes> | 2026-11-04 |
| OpenAPI spec | <https://github.com/openai/openai-openapi> | commit `f69b0e1` (2026-11-03, rev. 1364101); sem tags recentes (última release 2.0.0 de 2023) |
| SDK Node (referência) | <https://github.com/openai/openai-node> | `v7.50.0` (2026-11-04) |

## Contrato

### Endpoints e protocolos

- Base `https://api.openai.com`; sem regiões na chave padrão. Endpoints de residência de dados têm acréscimo de 10% (modelos de 2026-03-05 em diante) (pricing, 2026-11-04). Cabeçalho: `Authorization: Bearer <key>`.
- Chat Completions: `POST /v1/chat/completions`. Responses: `POST /v1/responses` (também WebSocket mode, desde 2026-02-23, e Batch). Embeddings, imagem, áudio, realtime e moderação são endpoints separados, fora do escopo do Thinker.
- Todos os modelos da página de modelos aparecem na Responses; a página não marca modelos "só Responses" (não confirmado se a lista completa omite algum). Exigem Responses na prática: variantes `-codex`, `-pro` (gpt-5.x-pro, o1-pro, o3-pro) e deep-research (comportamento já tratado pelo Thinker; fonte: código, não reconferida nos docs de 2026-11-04) (não confirmado).
- Matriz GPT-6 em Chat Completions (guia latest-model, 2026-11-04):

| Modelo | Chat Completions | Tool calling |
|---|---|---|
| gpt-6-astra, gpt-6.1-sol, gpt-6.1-terra | sim | só Responses |
| gpt-6-sol, gpt-6-luna | sim | só com `reasoning_effort: "none"` |

- Changelog 2026-09-03: Responses ganhou tool calling assíncrono, steering por WebSocket e troca de reasoning effort no meio da conversa. 2026-06-04: Responses e Chat aceitam objeto `moderation`.

### Modelos

- Listagem: `GET /v1/models` (`{object:"list", data:[{id, object, created, owned_by}]}`); sem contexto, capacidades ou preço (por isso o Thinker depende de catálogos externos).
- Ids vigentes (changelog/pricing, 2026-11-04): `gpt-6-astra` (2026-09-03), `gpt-6.1-sol` (2026-10-08), `gpt-6.1-terra` (2026-10-26), `gpt-6-sol`, `gpt-6-luna` (2026-09-22), `gpt-6-rosalind` (acesso aprovado), `gpt-5.6-sol|terra|luna` (alias `gpt-5.6` aponta para Sol; 2026-07-09), `gpt-5.6-cyber` (aprovação separada), `gpt-5.5` e `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-pro`, `-mini`, `-nano`, `gpt-5.3-codex`, `gpt-5.3-chat-latest`, `gpt-5.2`, `gpt-5.2-pro`, `gpt-5.1`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-pro`, `gpt-4.1(-mini)`, `gpt-4o(-mini)`, `o3`, `o3-pro`.
- Não são chat (devem ficar fora): `gpt-live-1`, `gpt-live-transcribe`, `gpt-transcribe`, `gpt-realtime-*`, `gpt-image-2.5-*`, `gpt-audio-*`, `whisper-1`.
- Retiradas: `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` e `gpt-4o-transcribe-diarize` com desligamento em 2027-02-26, junto com a Assistants API (anunciado em 2026-08-26); DALL-E 2/3 e Realtime Beta removidos em 2026-05-12; `POST /v1/videos/{id}/remix` será trocado por `/v1/videos/edits`. A lista completa fica em "Deprecated models" (não lida).

### Capacidades

| Família | Contexto | Saída máx. | Reasoning efforts | Observações |
|---|---|---|---|---|
| gpt-6-astra | 1.050.000 (entrada máx. 922.000) | 128K | low, medium, high, xhigh, max | sem `none` (400); sem `temperature`/`top_p` custom nem `logprobs`; corte 2026-04-30 |
| gpt-6.1-sol | 1.050.000 | 128K | low, medium, high, xhigh, max | sem `none` nem `minimal`; default `medium` |
| gpt-6.1-terra | 1.050.000 | 128K | none, low, medium, high, xhigh, max | |
| gpt-6-luna, gpt-6-sol | 1.050.000 (luna confirmado; sol não listado) | 128K (luna) | aceitam `none` (conjunto completo não listado) | |

- Recursos de gpt-6-astra: streaming, structured outputs, function calling, file search, entrada de imagem, web search, prompt caching. Sem Embeddings, Realtime, Assistants, Fine-tuning, Completions legado.
- Reasoning: default `medium` em gpt-5.5, gpt-5.6 e GPT-6; `max` existe desde o gpt-5.6; `minimal` deve virar `low` nos modelos novos. Resumo: `reasoning.summary` = `auto` (detalhado nos modelos atuais), `concise` (computer use), `detailed` (o4-mini); pode exigir verificação da organização. Em modo stateless (`store:false`/ZDR) itens de reasoning trazem `encrypted_content` por padrão e podem ser reenviados (o `include: ["reasoning.encrypted_content"]` legado ainda é aceito).
- Tokens de reasoning: `usage.output_tokens_details.reasoning_tokens` (Responses); cobrados como saída e contam no contexto.
- Parâmetro de limite de saída: `max_completion_tokens` (Chat) e `max_output_tokens` (Responses); `max_tokens` é legado e rejeitado por o-series e gpt-5+. Extensão para gpt-6 é provável (não confirmado).
- Quebra de compatibilidade prevista: com effort diferente de `none`, remover `temperature`, `top_p`, `top_logprobs`; em Chat remover também `logprobs`.

### Streaming e uso

- Chat: `stream_options.include_usage: true` entrega o `usage` final (o Thinker já força). Responses: eventos `response.*` e `response.completed` com `usage` (`input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`, `output_tokens_details.reasoning_tokens`).
- Cache: `prompt_cache_key` para afinidade; `prompt_cache_retention` assume `24h` para organizações sem ZDR desde 2026-05-29. Prompt caching estendido (OpenAPI `f69b0e1`, 2026-11-03, gpt-5.6+): `prompt_cache_options{mode, ttl}` com `ttl` `30m` (padrão) ou `12h`, até 4 breakpoints explícitos por pedido (`prompt_cache_breakpoint` nos blocos). Uso de escrita: `cache_write_tokens` e `cache_write_tokens_details{ttl_30m_tokens, ttl_12h_tokens}`. Prompt Cache Diagnostics GA para gpt-5.6+ (2026-09-08).
- Campo exato do usage de Chat para cache write não verificado (não confirmado).

### Preços

USD por 1M tokens, Standard, entrada / cache de entrada / saída; faixa longa = acima de 272K de entrada, aplicada ao pedido inteiro (pricing, 2026-11-04):

| Modelo | Curta | Longa |
|---|---|---|
| gpt-6-astra | 10 / 1 / 50 | 20 / 2 / 75 |
| gpt-6.1-sol | 2 / 0,10 / 10 | 4 / 0,20 / 15 |
| gpt-6.1-terra | 1 / 0,05 / 5 | 2 / 0,10 / 7,5 |
| gpt-6-sol | 2 / 0,20 / 10 | 4 / 0,40 / 15 |
| gpt-6-luna | 0,10 / 0,01 / 0,50 | 0,20 / 0,02 / 0,75 |
| gpt-5.6-sol / terra / luna | 4/0,40/20; 2/0,20/12; 0,20/0,02/1,20 | 8/0,80/30; 4/0,40/18; 0,40/0,04/1,80 |
| gpt-5.5 | 5 / 0,50 / 30 | 10 / 1 / 45 |
| gpt-5.4 | 2,50 / 0,25 / 15 | 5 / 0,50 / 22,5 |
| gpt-5.4-mini / nano | 0,75/0,075/4,50; 0,20/0,02/1,25 | n/d |
| gpt-4.1 / gpt-4o / o3 | 2/0,50/8; 2,50/1,25/10; 2/0,50/8 | n/d |

- Cache write (só gpt-6 e gpt-5.6): 1,25x o preço de entrada com retenção de 30 min e 2,5x com 12 h (ex. Astra: 12,50 e 25,00).
- Batch e Flex: 0,5x. Fast (antes Priority): cerca de 2x (gpt-5.5: 2,5x); Ultrafast: 6x (só gpt-6-astra e gpt-6.1-sol). Requisições com `priority` vão para Fast automaticamente desde 2026-07-30.
- Limites Standard do gpt-6-astra: Build 5.000 RPM / 1M TPM, Launch 10.000 / 4M, Grow 15.000 / 40M.

### Limites e erros

Fonte: guia de códigos de erro (2026-11-04).

| Status | Tipo / código | Ação |
|---|---|---|
| 401 | chave incorreta, não membro da organização, IP fora da allowlist | chave inválida; não repetir |
| 403 | região não suportada | sem retry |
| 429 | `rate_limit_error` | retry com backoff (`Retry-After` se vier) |
| 429 | `rate_limit_error` com `slow_down` (desde 2026-09-02) | retry reduzindo a taxa |
| 429 | `insufficient_quota`; códigos `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded` | cota/saldo; sem retry útil |
| 500 | erro do servidor | retry |
| 503 | `service_unavailable_error` / `server_is_overloaded` | retry respeitando `Retry-After` |
| 400 | `invalid_request_error` (ex. `param: service_tier` não permitido; effort ou parâmetro não suportado) | erro de pedido |

Nomes dos cabeçalhos de rate limit não constam na página de erros (não confirmado; o guia de rate limits não foi lido).

### Parâmetros obrigatórios, proibidos ou ignorados

- Obrigatório em o-series/gpt-5+/provavelmente gpt-6: `max_completion_tokens` em vez de `max_tokens`.
- Proibidos com reasoning ativo (effort ≠ `none`): `temperature`, `top_p`, `top_logprobs`; em Chat também `logprobs`.
- `reasoning_effort: none` proibido em gpt-6-astra e gpt-6.1-sol; `minimal` proibido em 6.1 Sol.
- Tools em Chat: ver matriz GPT-6.
- `service_tier` precisa estar liberado para o projeto; Agents API aceita `ultrafast` (2026-10-16).

## Como o Thinker implementa hoje

- Base e cabeçalhos: `openai` em `https://api.openai.com`, path `/v1/chat/completions`, `Authorization: Bearer` e `Content-Type` (`packages/backend/src/routing/proxy/provider-endpoints.ts:86-96,212-218`). Pedido Chat força `stream_options.include_usage` (`provider-client.ts:919-925`).
- Responses: endpoint `openai-responses` (`/v1/responses`, formato `chatgpt`) usado quando o cliente fala Responses ou o modelo casa `OPENAI_RESPONSES_ONLY_RE` (`-codex` exceto `codex-mini-latest`, `gpt-5*-pro`, `o1-pro`, `o\d(-mini)-deep-research`) (`common/constants/openai-models.ts:10-11`, `provider-client.ts:609-618`). Esta lista não cobre os novos GPT-6 com tools (G1).
- `toResponsesRequest` (`chatgpt-adapter.ts:84-140`): mapeia `max_completion_tokens`/`max_tokens` para `max_output_tokens`, repassa `prompt_cache_key`, converte `reasoning_effort` em `reasoning:{effort, summary:"auto"}` e `response_format` em `text.format` (opt-in por endpoint, `provider-client.ts:838-867`). `thinking: disabled` (Anthropic Messages) vira `reasoning_effort/effort: none` apenas em modelo de raciocínio (`provider-client.ts:296-322,872-890`); isso quebra em Astra e 6.1 Sol (G2). `metadata.user_id` do Messages vira `safety_identifier` (`provider-client.ts:285-291`).
- `max_tokens` é reescrito para `max_completion_tokens` apenas quando o id casa `/^(o\d|gpt-5)/i` e o endpoint é `openai`, `copilot` ou `custom` (`provider-client-converters.ts:152-169`); `gpt-6*` não casa (G2).
- `prompt_cache_key` estável é injetado (`applyHashedPromptCacheKey`, `provider-client.ts:271-274`); `prompt_cache_retention` e `prompt_cache_options` não são enviados.
- Listagem: `GET https://api.openai.com/v1/models` com Bearer; parser `parseOpenAIDeduped` descarta snapshots com data quando o alias existe (`provider-model-fetcher.service.ts:391-401,861-866`); filtro de não-chat `PROVIDER_NON_CHAT.openai` (`:428`) cobre moderation, davinci, babbage, `^text-`, realtime, `-transcribe`, sora, audio, `gpt-image-`, `search-api` mas não `^gpt-live-` (G4).
- Preços e contexto: não há entradas OpenAI em `known-model-prices.ts`; vêm de models.dev/OpenRouter (G3). Modalidades de `gpt-5.x` em `known-model-modalities.ts:41-48`; sem entradas `gpt-6*` (não conferido se o catálogo externo cobre).
- Usage de Responses lê `cached_tokens` e `cache_write_tokens`/`cache_creation_input_tokens` (`chatgpt-adapter.ts:351,526`); `cache_write_tokens_details` não é lido.
- Falhas 429: cooldown curto por padrão; só `insufficient_quota` conta como cota esgotada (`proxy-fallback.service.ts`, ver sub-openai #352); `credit_balance_exhausted` e os limites de gasto não são tratados à parte (G5).
- Snippet de setup: base URL oficial e chave `sk-` (`packages/shared/src/providers.ts:407-418`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/chatgpt-adapter.ts`
- `packages/backend/src/routing/proxy/openai-model-capabilities.ts` (apenas projeção do `/v1/models` do Thinker, não relacionada a modelos Responses-only)
- `packages/backend/src/common/constants/openai-models.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/model-discovery/known-model-modalities.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | quebra | GPT-6 Astra/6.1 Sol/6.1 Terra exigem Responses para tools (6 Sol/6 Luna só com effort `none`); Thinker usa Chat Completions; `OPENAI_RESPONSES_ONLY_RE` não cobre | `providers` | [#440](https://github.com/patrickbrandao/thinker/issues/440) | resolvida (tools em GPT-6 vão para /v1/responses) |
| G2 | degradação | `gpt-6*` sem reescrita para `max_completion_tokens`; `reasoning_effort: none` emitido em Astra/6.1 Sol (400); `temperature`/`top_p`/`logprobs` mantidos com effort ativo | `providers` | [#441](https://github.com/patrickbrandao/thinker/issues/441) | resolvida (política de parâmetros: param-policy.ts) |
| G3 | degradação | sem tabela de preços OpenAI: faixa longa >272K, cache write 1,25x/2,5x e `cache_write_tokens_details` ausentes | `providers` | [#442](https://github.com/patrickbrandao/thinker/issues/442) | aberta |
| G4 | degradação | `gpt-live-1` não é filtrado como não-chat (não confirmado ao vivo) | `providers` | [#443](https://github.com/patrickbrandao/thinker/issues/443) | resolvida (filtro de não-chat/aposentados na descoberta) |
| G5 | degradação | 429 com `credit_balance_exhausted`/limites de gasto e `slow_down` recebem o cooldown curto genérico; sem uso de `Retry-After` por código. Mesma causa de [#352](https://github.com/patrickbrandao/thinker/issues/352) (sub-openai G4) | `backend-dev` | [#352](https://github.com/patrickbrandao/thinker/issues/352) | resolvida (cooldown até o reset lido do corpo do erro) |
| G6 | oportunidade | aceitar/repassar `reasoning_effort: max`, `prompt_cache_options{ttl:12h}`, `prompt_cache_retention`, `service_tier`/Fast, WebSocket mode e `moderation` | `providers` | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa contra docs de modelos, pricing, changelog, guias de reasoning, latest-model e erros, e OpenAPI `f69b0e1`. Abertas G1-G4 (#440-#443); G5 ligada a #352; G6 registrada. Pendente de chave real: confirmar 400 de `max_tokens` e `reasoning_effort: none` em gpt-6, o campo de cache write no usage do Chat, lista real de `GET /v1/models`, nomes dos cabeçalhos de rate limit.
