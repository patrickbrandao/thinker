---
id: api-qwen
categoria: api
entidade: Alibaba Cloud (Qwen / Model Studio)
agente: api-qwen
thinker_ids: [qwen]
revisado_em: 2026-11-04
versao_observada: docs Model Studio 2026-11-04 (família qwen3.8 / qwen3.7)
---

# Alibaba Cloud (Qwen / Model Studio) (acesso por API)

Especificação mantida pelo agente `api-qwen` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Model Studio (DashScope) serve Qwen e modelos de terceiros (DeepSeek, Kimi, GLM, MiniMax) com chave de API (`Authorization: Bearer`), por três protocolos: Chat Completions (`/compatible-mode/v1`), Responses (`/compatible-mode/v1/responses`) e Anthropic Messages (`/apps/anthropic/v1/messages`).
- A chave é presa à região: usar a chave de uma região em outro host devolve 401. Existem hosts legados por região (`dashscope*.aliyuncs.com`, ainda funcionam) e hosts novos por workspace (`{WorkspaceId}.<região>.maas.aliyuncs.com`, recomendados).
- Cache de contexto tem modo implícito (automático) e explícito (`cache_control`), mutuamente exclusivos.
- Thinker fala só Chat Completions com a chave de API e já cobre os três hosts legados, hosts de workspace e detecção automática; a lacuna aberta é o workspace dos EUA (G1).
- Planos Token Plan / Coding Plan (chaves `sk-sp-`) são outra entidade: ver `sub-qwen`.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Model Studio docs | <https://www.alibabacloud.com/help/en/model-studio/> | 2026-11-04 |
| Models | <https://www.alibabacloud.com/help/en/model-studio/models> | 2026-11-04 |
| OpenAI-compatible (Chat) | <https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope> | 2026-11-04 |
| Responses API | <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses> | 2026-11-04 |
| Anthropic-compatible | <https://www.alibabacloud.com/help/en/model-studio/anthropic-api-messages> | 2026-11-04 |
| Deep thinking | <https://www.alibabacloud.com/help/en/model-studio/deep-thinking> | 2026-11-04 |
| Context cache | <https://www.alibabacloud.com/help/en/model-studio/context-cache> | 2026-11-04 |
| Pricing | <https://www.alibabacloud.com/help/en/model-studio/model-pricing> | 2026-11-04 (lido só os primeiros ~100 mil caracteres) |
| Rate limit | <https://www.alibabacloud.com/help/en/model-studio/rate-limit> | 2026-11-04 |
| Error codes | <https://www.alibabacloud.com/help/en/model-studio/error-code> | 2026-11-04 (lido parcialmente) |

Nenhum SDK oficial foi lido; tudo vem da documentação. Páginas lidas por resumo automático: detalhes numéricos devem ser conferidos no console antes de virarem preço no código.

## Contrato

### Endpoints e protocolos

Hosts por região (Chat Completions, base `.../compatible-mode/v1`, rota `POST {base}/chat/completions`):

| Região | Host de workspace (recomendado) | Host legado |
|---|---|---|
| Singapura | `{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com` | `dashscope-intl.aliyuncs.com` |
| EUA (Virgínia) | `{WorkspaceId}.us-east-1.maas.aliyuncs.com` | `dashscope-us.aliyuncs.com` |
| Pequim | `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` | `dashscope.aliyuncs.com` |
| Hong Kong | `{WorkspaceId}.cn-hongkong.maas.aliyuncs.com` | (não confirmado) |
| Tóquio | `{WorkspaceId}.ap-northeast-1.maas.aliyuncs.com` | (não confirmado) |
| Frankfurt | `{WorkspaceId}.eu-central-1.maas.aliyuncs.com` (listado nas páginas Responses e Anthropic, ausente na de Chat) | (não confirmado) |

A página de Chat lista, na linha de Pequim, o host de Singapura; parece erro da documentação (não confirmado).

- Autenticação: `Authorization: Bearer <chave>`. A chave deve ser da mesma região do host, senão 401 (`invalid_api_key`).
- **Responses**: `POST {base}/responses` com o mesmo host (`/compatible-mode/v1/responses`). O caminho antigo `/api/v2/apps/protocols/compatible-mode/v1/responses` não é mais mantido. Campos aceitos: `input`, `instructions`, `previous_response_id`, `conversation`, `tools`, `tool_choice`, `parallel_tool_calls`, `reasoning.effort`, `max_output_tokens` (mínimo 16), `text.format`. `background` não é suportado; ids de resposta valem 7 dias; a entrada útil é cerca de 80% da janela e o excesso é truncado sem erro. Só os modelos listados na página têm ferramentas embutidas (`web_search`, `code_interpreter`, `mcp` etc.).
- **Anthropic Messages**: base `https://{WorkspaceId}.<região>.maas.aliyuncs.com/apps/anthropic`, rota `/v1/messages`; aceita `x-api-key` ou `Authorization: Bearer`. Campos: `model`, `max_tokens` obrigatórios; `thinking`, `tools`, `tool_choice`, `output_config`. Sem endpoint `/v1/models`. `signature` de thinking sempre vazia; uso completo (cache) só aparece em `message_delta`. Faixa de `temperature` é `[0, 2)`. `budget_tokens` é obsoleto em favor de `effort` em `output_config`.
- Nativo DashScope (`/api/v1/services/aigc/...`): existe, fora do escopo do Thinker.
- Erro 400 "current user api does not support http call": o modelo não aceita esta interface.

### Modelos

- Listagem: `GET {base}/v1/models` é o que o Thinker usa; a documentação lida não descreve esse endpoint (não confirmado como contrato oficial). O formato de resposta é o padrão OpenAI.
- Famílias vistas na página de modelos (2026-11-04): `qwen3.8-max`, `qwen3.8-flash`, `qwen3.8-27b`, `qwen3.8-2.4t-a95b`, `qwen3.8-omni-flash`; `qwen3.7-max` (equivale a `qwen3.7-max-2026-05-20`), `qwen3.7-plus`, `qwen3.7-flash`; `qwen3.6-*`; `qwen3.5-*`; legados `qwen-plus` e `qwen-flash` (alias móvel); `qwen3-coder-flash`; `qwen3-vl-plus`. Terceiros no mesmo endpoint: `deepseek-v4.1-flash`, `deepseek-v4-pro`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.5`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `MiniMax-M2.5`.
- Outras modalidades (não chat): ASR/TTS/realtime `qwen-audio-3.1-*`, imagem `qwen-image-3.0-pro`, embeddings `text-embedding-v4`, `qwen3.7-text-embedding`, rerank `qwen3-rerank`.
- Há snapshots datados (`qwen3.7-max-2026-05-17`, `-2026-05-20`, `-2026-06-08`; `qwen3.7-plus-2026-05-26`). Aposentadorias anunciadas: nenhuma encontrada nas páginas lidas.
- A disponibilidade de modelo varia por região e por modo de implantação (US vs Global); `model_not_found` (404) cobre modelo inexistente, não ativado ou fora da região.
- Janela de contexto e saída máxima por modelo: não estão na página de modelos lida (ver "Model Plaza"); a faixa de preço vai até 1M tokens de entrada para Max, Plus e Flash.

### Capacidades

| Tema | Contrato |
|---|---|
| Tools | `tools` em Chat; com `stream=true` o limite antigo ("tools não combina com stream") consta na página de compatibilidade, mas é provavelmente desatualizado para os modelos atuais (não confirmado). |
| Visão / áudio / vídeo | `qwen3.8-omni-flash`, `qwen3-vl-plus`; entrada de áudio/vídeo só em mensagens de usuário nos modelos omni. |
| Raciocínio | `enable_thinking` (bool, fora do padrão OpenAI: vai em `extra_body`/nível superior) e `thinking_budget` (máximo de tokens de raciocínio). Resposta em `reasoning_content` (`delta.reasoning_content` antes de `delta.content`). Tokens de raciocínio cobram como saída. |
| Modos | Híbridos ligados por padrão: qwen3.8-max/flash/27b, qwen3.7-*, qwen3.6-*, qwen3.5-*. Híbridos desligados por padrão: `qwen-plus`, `qwen-flash`, kimi-k2.5/k2.6. Só raciocínio (não desliga): `qwen3.8-2.4t-a95b`, `qwen3.7-max-preview`, `qwen3.7-max-2026-05-17`, `glm-5.3`, `kimi-k2.7-code`. |
| `preserve_thinking` | Devolve o `reasoning_content` histórico no turno seguinte (Qwen3.8 Max, 3.7, 3.6, Kimi); conta como entrada. |
| Restrições | Alguns modelos abertos (qwen3.5-122b-a10b, qwen3.5-27b) com raciocínio exigem `stream=true`; sem stream: `parameter.enable_thinking only support stream call`. `stream_options` só com `stream=true`. |
| Structured output | `response_format` / `text.format` json_schema; `json_object` exige a palavra JSON no prompt. |
| Cache de contexto | Ver tabela abaixo. |
| Parâmetros | `n` 1 a 4 (só qwen-plus, fixo em 1 com `tools`); `presence_penalty` só em Qwen comercial; `stream_options.include_usage` suportado. |

Cache de contexto (mutuamente exclusivos):

| | Explícito | Implícito |
|---|---|---|
| Ativação | `cache_control: {"type":"ephemeral"}` manual | automático, não desliga |
| Criação | cerca de 125% do preço de entrada | 100% |
| Acerto | cerca de 10% | cerca de 20% (varia por modelo) |
| TTL | 5 min, renovado a cada acerto | indeterminado |

Mínimo 1.024 tokens; até 4 marcadores por requisição (vale os 4 últimos); busca até 20 blocos antes de cada marcador; marcadores em `tools` são ignorados. Exceções de cobrança: `qwen3.8-max`, `qwen3.8-max-0902`, `qwen3.8-2.4t-a95b` não usam os 10% no acerto; `qwen3.8-flash` difere nos dois. Modelos com cache explícito: Max, Plus, Flash, `qwen3-coder-flash`, `qwen3-vl-plus`, `kimi-k2.5`, `glm-5.1` (varia por região).

### Streaming e uso

- Chat: `stream_options.include_usage=true` devolve `usage` no último chunk.
- Campos de uso (Chat): `usage.prompt_tokens_details.cached_tokens` (acertos) e `usage.prompt_tokens_details.cache_creation_input_tokens` (escritas), ambos já incluídos em `prompt_tokens`. Em Anthropic: `usage.cache_creation_input_tokens` e `usage.cache_read_input_tokens`, separados de `input_tokens`.
- `input_tokens` pode não bater com criação mais acerto: o backend acrescenta até cerca de 10 tokens após o marcador, cobrados como entrada normal.
- Tokens de raciocínio vêm em `completion_tokens` (cobrados como saída); campo separado de raciocínio não foi confirmado.

### Preços

USD por 1M tokens, lista padrão sem cache, páginas de 2026-11-04 (conferir no console; promoções variam):

| Modelo | Singapura | EUA (implantação US) | Pequim / Global |
|---|---|---|---|
| `qwen3.8-max` | 2 / 6 | 2 / 6 | 1,65 / 4,951 |
| `qwen3.7-max` | 2,5 / 7,5 | 2,5 / 7,5 | 1,65 / 4,951 |
| `qwen3.7-plus` (0-256K) | 0,4 / 1,6 (desc. 20% por tempo limitado) | 0,4 / 1,6 | 0,276 / 1,101 |
| `qwen3.7-plus` (256K-1M) | 1,2 / 4,8 | 1,2 / 4,8 | 0,826 / 3,301 |
| `qwen3.8-flash` | 0,15 / 0,47 | 0,15 / 0,47 | 0,113 / 0,382 |
| `qwen-plus` (0-256K) | 0,4 / 1,2 sem raciocínio, 4 com | idem Singapura | faixas 0-128K: 0,115 / 0,287 e 1,147 |
| `qwen-flash` (0-256K) | 0,05 / 0,4 | idem | faixas 0-128K: 0,022 / 0,216 |

- Preço é por faixa do tamanho de entrada da requisição (Plus/Flash: cortes 128K/256K/1M, variando por região).
- Cota gratuita só em Singapura (1M tokens, 90 dias). Lote (Batch) com 50% quando suportado; não acumula com desconto de cache.
- Cache: criação cerca de 125% (explícito) ou 100% (implícito); acerto cerca de 10% ou 20%.
- O preço depende da região e do modo de implantação (US vs Global): a mesma chave não escolhe entre eles; o host define.

### Limites e erros

- Limites por conta Alibaba primária (somando RAMs, workspaces e chaves), por modelo, em RPM e TPM, com aplicação por segundo e limites dinâmicos em alguns modelos. Exemplos em Singapura: `qwen-plus` 600 RPM / 1M TPM; `qwen3.7-plus` 15.000 RPM / 5M TPM. Recarga não aumenta o limite. A documentação não lista cabeçalhos de rate limit.
- Erros:

| HTTP | Código | Significado | Retentável |
|---|---|---|---|
| 401 | `InvalidApiKey` / `invalid_api_key` | chave errada ou de outra região/base URL; chaves `sk-sp-` exigem a base do Token Plan | não |
| 403 | `Arrearage` | conta em atraso | não |
| 403 | cota gratuita esgotada (modo "Free Quota Only") | não é rate limit | não |
| 404 | `ModelNotFound` / `model_not_found` | modelo inexistente, não ativado ou fora da região | não |
| 429 | `Throttling.RateQuota` | RPS/RPM excedido ("Requests rate limit exceeded") | sim, com espera |
| 429 | `Throttling.BurstRate` | pico rápido ("Request rate increased too quickly") | sim, com backoff |
| 429 | `Throttling.Concurrency` | muitas requisições concorrentes | sim |
| 429 | `AllocationQuota` / `insufficient_quota` | TPM esgotado ("Allocated quota exceeded") ou cota gratuita acabou | distinguir: TPM volta em cerca de 1 min, cota gratuita não |
| 400 | `DataInspectionFailed` | moderação de conteúdo | não |
| 500 / 503 | erro do servidor / motor sobrecarregado | sim |

- Parâmetros: `enable_thinking` e `thinking_budget` são específicos do Model Studio. A partir da API Responses, `enable_thinking` será descontinuado em favor de `reasoning.effort`.

## Como o Thinker implementa hoje

Lido do código em 2026-11-04.

- **Entidade**: id `qwen`, alias `alibaba`, nome "Alibaba Cloud", prefixo de chave `sk-`, tamanho mínimo 30 (`packages/shared/src/providers.ts:74-82`). Inferência por nome de modelo `^qwen[23]|^qwq-` (`packages/shared/src/provider-inference.ts:21`).
- **Regiões** (`packages/backend/src/routing/qwen-region.ts:3-8`): `singapore` = `https://dashscope-intl.aliyuncs.com/compatible-mode`, `us` = `https://dashscope-us.aliyuncs.com/compatible-mode`, `beijing` = `https://dashscope.aliyuncs.com/compatible-mode` (padrão quando a região é desconhecida, linha 45). Hosts de workspace `https://<id>.<região>.maas.aliyuncs.com/compatible-mode` são aceitos para `cn-beijing`, `ap-southeast-1`, `ap-northeast-1`, `cn-hongkong`, `eu-central-1` (linhas 10-16); `us-east-1` não. Exige https, sem porta, usuário ou query.
- **Auto detecção** (`qwen-region.ts:95-113`, usada em `routing-core/provider.service.ts:733-800`): sonda `GET <base>/v1/models` com `Bearer`, ordem singapura, EUA, Pequim, timeout de 3 s; aceita a primeira com resposta OK. Hong Kong, Frankfurt e Tóquio não são sondados.
- **Endpoint de inferência** (`routing/proxy/provider-endpoints.ts:453-459`): `baseUrl` Pequim por padrão, `openaiHeaders`, caminho `/v1/chat/completions`, formato `openai`, `stream_options` de uso. A região salva na chave sobrescreve a base (`routing/proxy/forward-endpoint-resolver.ts:155-156`; `routing/proxy/provider-endpoints.ts:715`).
- **Descoberta de modelos** (`model-discovery/provider-model-fetcher.service.ts:980-984`, override em 1154-1159): `GET <base>/v1/models` com `Bearer`, parser OpenAI. Os ids de modelo do Qwen só vêm da descoberta nativa, nunca de aliases do OpenRouter/preços (`routing/routing-core/provider-key.service.ts:379-383, 434-436`).
- **Cache**: injeta `cache_control` na última mensagem system/developer/user para `qwen` (e `qwen-subscription`) via `injectOpenAiMessageCacheControl` (`routing/proxy/provider-client.ts:949-951`, `routing/proxy/cache-injection.ts:69-71`), qualquer que seja o modelo. A leitura de uso aceita `prompt_tokens_details.cached_tokens` e `prompt_tokens_details.cache_creation_input_tokens` (`routing/proxy/stream-writer.ts:99-126`).
- **Raciocínio**: `reasoning_content` é reconhecido pelo prefixo da família (`routing/proxy/reasoning-format.ts:42`); não há envio de `enable_thinking`/`thinking_budget` para a chave de API do Qwen (a única ocorrência de `enable_thinking` é para outros runtimes, `provider-client-converters.ts:139`).
- **Preços**: não há tabela de preços do Qwen em `known-model-prices.ts`; o custo vem do catálogo público (models.dev/OpenRouter) via `database/models-dev-sync.service.ts`.
- **Capacidades**: `model-discovery/model-capabilities.ts:35` lista `qwen`.
- **UI**: seletor de região no frontend com auto, Pequim, Singapura, EUA e workspaces de Hong Kong, Frankfurt, Tóquio, mais endpoint personalizado (`packages/frontend/src/services/providers.ts:138-172`). Link de criação de chave: `packages/frontend/src/services/provider-api-key-urls.ts:25`.
- **Virtual models**: `qwen`/`alibaba` marcados como indisponíveis para a cadeia de modelos virtuais (`routing/virtual-models/virtual-model-chain.ts:259`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/qwen-region.ts`
- `packages/backend/src/routing/provider.controller.ts`
- `packages/backend/src/routing/routing-core/provider.service.ts`
- `packages/backend/src/routing/routing-core/provider-key.service.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/cache-injection.ts`
- `packages/backend/src/routing/proxy/stream-writer.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Workspace dos EUA (`<id>.us-east-1.maas.aliyuncs.com`) é recusado: `QWEN_WORKSPACE_REGION_CODES` (`qwen-region.ts:10-16`) não inclui `us-east-1` e o seletor do frontend não o oferece. A documentação lista esse host como recomendado. Sugestão: adicionar o código e o item no seletor. | providers | [#444](https://github.com/patrickbrandao/thinker/issues/444) | aberta |
| G2 | oportunidade | `enable_thinking`/`thinking_budget` e `preserve_thinking` não são enviados. Modelos híbridos como `qwen-plus`/`qwen-flash` vêm com raciocínio desligado e o cliente não consegue ligá-lo via `reasoning_effort`. Sugestão: mapear o esforço para `enable_thinking`/`thinking_budget` na rota `qwen`. | providers | — | aberta |
| G3 | oportunidade | `cache_control` é injetado em toda requisição `qwen`, o que ativa o modo explícito (criação a cerca de 125%, pagando mesmo sem reutilização) e desliga o implícito, inclusive em modelos que não suportam o explícito. Avaliar injetar só para os modelos com suporte e registrar a cobrança de criação no custo. Parte da cobrança (não confirmado). | providers | — | aberta |
| G4 | oportunidade | Sem tabela de preços do Qwen: o custo depende do catálogo público e ignora as faixas por tamanho de entrada, a região e o modo US/Global. Sugestão: tabela local por região/faixa em `known-model-prices.ts` (após conferir no console). | providers | — | aberta |
| G5 | oportunidade | Responses (`/compatible-mode/v1/responses`) e Anthropic (`/apps/anthropic/v1/messages`) funcionam com a mesma chave e dão ferramentas embutidas, `reasoning.effort` e `thinking` nativos; o Thinker usa só Chat Completions. | providers | — | aberta |
| G6 | oportunidade | A detecção automática de região não sonda Hong Kong, Frankfurt e Tóquio, e o fallback é Pequim; chaves dessas regiões exigem endpoint de workspace manual. Sondar exige o WorkspaceId, então a mitigação é só documentar na UI. | frontend-dev | — | aberta |

Não há issue para G2 a G6 por serem `oportunidade` sem ganho imediato claro. Os gaps do Token Plan (`sk-sp-`) ficam com `sub-qwen` (#357-#360).

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa a partir da documentação do Model Studio (Chat, Responses, Anthropic, raciocínio, cache, preços, limites, erros). Contrato reescrito, estado do Thinker conferido no código, gaps G1 a G6 registrados; issue #444 aberta para G1. Pendente de conferência ao vivo com chave real: `GET /v1/models` por região, formato de `usage` com raciocínio, comportamento de `cache_control` em modelos sem suporte.
