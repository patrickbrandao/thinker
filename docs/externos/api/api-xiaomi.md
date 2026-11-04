---
id: api-xiaomi
categoria: api
entidade: Xiaomi MiMo
agente: api-xiaomi
thinker_ids: [xiaomi]
revisado_em: 2026-11-04
versao_observada: docs mimo.mi.com 2026-11-04 (família V2.6; V2.5 aposentada em 2026-10-21)
---

# Xiaomi MiMo (acesso por API)

Especificação mantida pelo agente `api-xiaomi` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md). O acesso por assinatura (Token Plan, chaves `tp-`/`ttp-`) está em [sub-xiaomi](../assinatura/sub-xiaomi.md).

## Resumo

- Pay-as-you-go com chave `sk-...` (conta Open Platform, saldo em conta) em `https://api.xiaomimimo.com`. A documentação oficial agora vive em `mimo.mi.com/docs` (a `platform.xiaomimimo.com/docs` redireciona para lá; é uma SPA, o texto só aparece com leitura da página renderizada).
- Modelos de texto atuais: `mimo-v2.6-pro`, `mimo-v2.6-flash` e `mimo-v2.6-pro-ultraspeed` (contexto 1M, saída máx. 128K, multimodal na entrada, thinking, tools, saída estruturada, busca na web). Speech: `mimo-v2.5-asr` e três `mimo-v2.5-tts*`.
- `mimo-v2.5-pro` e `mimo-v2.5` foram aposentados em 2026-10-21 e os ids não funcionam mais. Os V2 (`mimo-v2-pro`, `-omni`, `-flash`) saíram em 2026-06-30.
- Protocolos: Chat Completions (`/v1`), Anthropic Messages (`/anthropic`) e Responses API (anunciada; não verificada aqui). Thinking vem **ligado por padrão**.
- O Thinker já fala Chat Completions com Bearer e usa `GET /v1/models`. As lacunas são de catálogo (ids/contexto/preço dos V2.6) e de oportunidade (Anthropic Messages, Responses, busca na web).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Plataforma MiMo (SPA; docs redirecionam para `mimo.mi.com`) | <https://platform.xiaomimimo.com> | 2026-11-04 |
| Tabela de modelos e limites | <https://mimo.mi.com/docs/en-US/quick-start/summary/model> | doc 2026-11-04 |
| Preços pay-as-you-go | <https://mimo.mi.com/docs/en-US/price/pay-as-you-go> | doc 2026-11-04 |
| Limites de taxa | <https://mimo.mi.com/docs/en-US/api/guidance/rate-limit> | doc 2026-11-04 |
| Referência Chat Completions | <https://mimo.mi.com/docs/en-US/api/chat/openai-api-post> | doc 2026-11-04 |
| Referência Anthropic Messages | <https://mimo.mi.com/docs/en-US/api/chat/anthropic-api-post> | lida por `sub-xiaomi` em 2026-11-03 |
| Códigos de erro | <https://mimo.mi.com/docs/en-US/api/guidance/error-codes> | 2026-07-15 (via `sub-xiaomi`) |
| Depreciação de modelos | <https://mimo.mi.com/docs/en-US/updates/deprecate> | 2026-10-09 (via `sub-xiaomi`) |
| MiMo models (Hugging Face) | <https://huggingface.co/XiaomiMiMo> | 2026-10-28 (pesos abertos, ver abaixo) |

Não há repositório de cliente oficial com tag; a data de cada página é a referência.

## Contrato

### Endpoints e protocolos

| Item | Valor | Fonte |
|---|---|---|
| Base pay-as-you-go | `https://api.xiaomimimo.com` | referência Chat Completions |
| Chat Completions | `POST /v1/chat/completions` | idem |
| Anthropic Messages | `POST /anthropic/v1/messages` | `sub-xiaomi` (2026-11-03) |
| Listagem de modelos | `GET /v1/models` (formato OpenAI) | `sub-xiaomi`; resposta real não verificada (precisa de chave) |
| Responses API | anunciada como disponível no endpoint pay-as-you-go | (não confirmado, página não lida) |

- Regiões: a base `api.xiaomimimo.com` é única na doc de referência; os clusters regionais (`cn`, `sgp`, `ams`) são do Token Plan. Preços têm tabela doméstica (CNY) e internacional (USD), o que sugere contas separadas por região (não confirmado para pay-as-you-go).
- Autenticação: a doc mostra `api-key: <chave>` e cita Bearer como alternativa (`Authorization: Bearer <chave>`); a chave é do tipo `sk-...` e não vale na base do Token Plan.

### Modelos

| Modelo | Contexto | Saída máx. | RPM / TPM | Observação |
|---|---|---|---|---|
| `mimo-v2.6-pro` | 1M | 128K | 100 / 10M | Entrada multimodal, thinking, function call, saída estruturada, web search |
| `mimo-v2.6-flash` | 1M | 128K | 100 / 10M | Mesmas capacidades, mais barato |
| `mimo-v2.6-pro-ultraspeed` | 1M | 128K | cota reservada, sob contato | Sem Batch API |
| `mimo-v2.5-asr` | 8K | 2K | 100 / 10K | Fala para texto |
| `mimo-v2.5-tts`, `-voiceclone`, `-voicedesign` | 8K (tts) | 8K (tts) | 100 / 10M | Síntese de fala; grátis por tempo limitado |

- Aposentados: `mimo-v2.5-pro` e `mimo-v2.5` (2026-10-21, ids removidos); `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2-flash`, `mimo-v2-tts` (2026-06-30). O erro devolvido a ids aposentados não está documentado (não confirmado; espere 400/404).
- Pesos abertos no Hugging Face (`XiaomiMiMo/MiMo-V2.6-*`, `MiMo-V2.5*`, `MiMo-V2-Flash`, `MiMo-Audio`): úteis só para runtimes locais, sem efeito na API.

### Capacidades

- `thinking`: `{"type": "enabled" | "disabled"}`, padrão `enabled`. Em thinking, `temperature` e `top_p` são forçados a 1.0 e 0.95.
- Faixas: `temperature` 0 a 1.5 (padrão 1.0), `top_p` 0.01 a 1 (0.95), `frequency_penalty`/`presence_penalty` -2 a 2, `stop` até 4 sequências.
- `max_completion_tokens`: padrão e teto 131072; conta texto visível e raciocínio.
- `tools`: só `type: "function"` (nome até 64 caracteres) e um tipo de ferramenta de busca na web cuja configuração não está documentada. `tool_choice` aceita só `auto`; outros valores são descartados.
- `response_format`: o campo documenta só `text` (a página também menciona objeto JSON; ambíguo, não confirmado).
- Papéis de mensagem: `developer`, `system`, `user`, `assistant`, `tool`.
- Multi-turno com tools em thinking: o `reasoning_content` anterior deve voltar no histórico, senão 400.
- `stream_options`: não documentado na referência (não confirmado que `include_usage` seja aceito ou ignorado).
- Entrada de imagem, vídeo e áudio nos V2.6; sem imagem em modelos sem suporte retorna 404 (códigos de erro).

### Streaming e uso

- SSE com `object: "chat.completion.chunk"`; `delta` traz `content`, `reasoning_content` e `tool_calls` (fragmentos por `index`, argumentos precisam ser remontados).
- `finish_reason`: `stop`, `length`, `tool_calls`, `content_filter` e `repetition_truncation` (valor fora do padrão OpenAI).
- `usage`: `prompt_tokens`, `completion_tokens`, `total_tokens`, `completion_tokens_details.reasoning_tokens`, `prompt_tokens_details.cached_tokens` (mais `audio_tokens`, `image_tokens`, `video_tokens`) e `web_search_usage.tool_usage` / `page_usage`. Não há campo de cache-write: escrita de cache é gratuita por tempo limitado.
- No Anthropic Messages o `usage` traz `cache_read_input_tokens` e o `stop_reason` pode ser `content_filter` ou `repetition_truncation` (via `sub-xiaomi`).

### Preços

Fonte: página pay-as-you-go, 2026-11-04. Valores por 1M de tokens.

| Modelo | Doméstico CNY (hit / miss / saída) | Internacional USD (hit / miss / saída) |
|---|---|---|
| `mimo-v2.6-pro` | 0,025 / 3,00 / 6,00 | 0,0036 / 0,435 / 0,87 |
| `mimo-v2.6-flash` | 0,02 / 1,00 / 2,00 | 0,0028 / 0,14 / 0,28 |
| `mimo-v2.6-pro-ultraspeed` | 0,25 / 30,00 / 60,00 | 0,036 / 4,35 / 8,70 |

- Batch API (metade do preço): `mimo-v2.6-pro` USD 0,0018 / 0,2175 / 0,435 e `mimo-v2.6-flash` USD 0,0014 / 0,07 / 0,14; ultraspeed não suporta batch.
- ASR: USD 0,074 por hora de áudio (CNY 0,5), cobrado por segundo. Plugin de busca na web: USD 5 por 1000 chamadas (CNY 16), cobrado à parte dos tokens.
- Sem faixas por tamanho de contexto. Cache hit vale quando o prefixo bate com o cache de prompt. Cache write e TTS gratuitos por tempo limitado.

### Limites e erros

- RPM e TPM por conta e por modelo, somando todas as chaves. Há limite de concorrência por conta sem número publicado. Nenhum cabeçalho de limite documentado.
- Sob carga alta a API pode atrasar ou devolver 429; sem `Retry-After` documentado; a doc recomenda retry com backoff.
- Códigos (via `sub-xiaomi`, 2026-07-15): 400 formato/modelo inexistente/`reasoning_content` ausente; 401 chave inválida ou mistura de tipo de chave; 402 saldo insuficiente (pay-as-you-go); 403 região sem serviço ou chave restringida por risco; 404 sem suporte a imagem; 421 moderação. Retentáveis: 429 e 5xx; não retentáveis: 401, 402, 403, 421.

## Como o Thinker implementa hoje

- Provedor `xiaomi` com aliases `mimo`, `xiaomi-mimo`, `xiaomi mimo`, chave `sk-` com mínimo de 50 caracteres (`packages/shared/src/providers.ts:297`); o tamanho real das chaves `sk-` do MiMo não foi confirmado.
- Proxy: base `https://api.xiaomimimo.com`, formato `openai`, `Authorization: Bearer`, caminho Chat Completions padrão, `stream_options` de uso (`packages/backend/src/routing/proxy/provider-endpoints.ts:189,418`). Não usa a rota Anthropic nem Responses.
- Descoberta: `GET https://api.xiaomimimo.com/v1/models`, filtra ids `mimo-v*`, exclui `asr`/`tts` (`provider-model-fetcher.service.ts:60,365,460,970`).
- Janelas de contexto fixas: `mimo-v2.5-pro`, `mimo-v2-pro`, `mimo-v2.5` 1048576; `mimo-v2-omni`, `mimo-v2-flash` 262144; qualquer outro id cai em `DEFAULT_CONTEXT_WINDOW` = 1M (`provider-model-fetcher.service.ts:357`, `model-fetcher.ts:15`). Os V2.6 recebem 1M pelo padrão, que coincide com a doc.
- Sem preços estáticos de MiMo em `known-model-prices.ts`; o provedor é "capability-only" em `model-capabilities.ts:37,148` e entra no sync do models.dev (`models-dev-sync.service.ts:66`). Se o catálogo traz os preços V2.6 não foi verificado.
- Inferência de provedor pelo id `mimo-v*` (`packages/shared/src/provider-inference.ts:19`). Há cache de `reasoning_content` no proxy (`routing/proxy/reasoning-content-cache.ts`), compatível com a exigência de devolver o raciocínio em multi-turno.
- Região do Token Plan fica em `routing/xiaomi-region.ts` (escopo de `sub-xiaomi`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/model-discovery/model-fetcher.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/routing/xiaomi-region.ts`
- `packages/backend/src/routing/proxy/reasoning-content-cache.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | oportunidade | Mapa de contexto lista só ids V2/V2.5 (já aposentados) e não os V2.6; o padrão 1M acerta por coincidência, mas a saída máx. (128K) e o `mimo-v2.6-pro-ultraspeed` não estão mapeados. Mesma causa de [#361](https://github.com/patrickbrandao/thinker/issues/361)/[#362](https://github.com/patrickbrandao/thinker/issues/362) (lado Token Plan); resolver os dois juntos em `provider-model-fetcher.service.ts:357`. | providers | #362 | aberta |
| G2 | oportunidade | Sem preços estáticos dos V2.6 (tabela acima, USD e CNY); se o catálogo models.dev/OpenRouter os traz não foi conferido (não confirmado). Se faltarem, o custo dos V2.6 aparece zerado ou ausente. Adicionar a `known-model-prices.ts` incluindo desconto de cache hit. | providers | — | aberta |
| G3 | oportunidade | `finish_reason`/`stop_reason` `repetition_truncation` e `content_filter` não são normalizados para os valores padrão no cliente; confirmar o comportamento do conversor. | backend-dev | — | aberta |
| G4 | oportunidade | A API serve Anthropic Messages (`/anthropic`) e Responses; o Thinker só usa Chat Completions para `xiaomi`. Usar `/anthropic` evitaria conversões para clientes Anthropic. | providers | — | aberta |
| G5 | oportunidade | Thinking vem ligado por padrão e os V2.6 aceitam `thinking.type`; verificar se o parâmetro de raciocínio do Thinker é traduzido para `thinking` (e se `tool_choice` diferente de `auto` é tratado, pois é descartado). | providers | — | aberta |
| G6 | oportunidade | Validar com chave real: aceitação de `stream_options.include_usage`, resposta de `GET /v1/models` (inclui ASR/TTS?) e erro devolvido a ids aposentados. | providers | — | aberta |

Nenhuma lacuna de severidade `quebra` ou `degradação` nesta revisão para a chave pay-as-you-go, portanto nenhuma issue nova foi aberta; os problemas de quebra da família V2.5 estão no lado do Token Plan (#361 a #364, agente `sub-xiaomi`).

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Docs agora em `mimo.mi.com`; família V2.6 (pro, flash, pro-ultraspeed) vigente; V2.5 aposentada em 2026-10-21; preços pay-as-you-go, limites (100 RPM / 10M TPM) e campos de uso registrados. Seis lacunas de oportunidade, nenhuma issue nova.
