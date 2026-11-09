---
id: api-anthropic
categoria: api
entidade: Anthropic
agente: api-anthropic
thinker_ids: [anthropic]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04 (API version 2026-10-21; anthropic-sdk-typescript sdk-v1.4.0)
---

# Anthropic (acesso por API)

Especificação mantida pelo agente `api-anthropic` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- A API Messages segue em `https://api.anthropic.com/v1/messages`. Existe uma nova versão de API `2026-10-21`; `2023-06-01` continua aceita e é a que o Thinker envia.
- A linha atual é 5.x: Fable 5.1, Opus 5.5, Sonnet 5.5 e Haiku 5.5, todos com 1M de contexto e 128K de saída. Sonnet 4.5 será aposentado em 2026-11-30.
- Os modelos novos mudaram o contrato: thinking adaptativo, `output_config.effort`, `tool_choice` forçado recusado, sampling (`temperature`, `top_p`, `top_k`) recusado em 4.7+.
- O Thinker repassa `anthropic-beta` do cliente (só no host `api.anthropic.com`), mas fixa contexto em 200K na descoberta, ignora o TTL de 1h no custo e repassa parâmetros que dão 400 nos modelos novos. Lacunas G1 a G5.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| API reference | <https://docs.claude.com/en/api/overview> (redireciona para platform.claude.com/docs) | 2026-11-04 |
| Models overview | <https://docs.claude.com/en/docs/about-claude/models/overview> | 2026-11-04 |
| Model deprecations | <https://docs.claude.com/en/docs/about-claude/model-deprecations> | 2026-11-04 |
| Pricing | <https://claude.com/pricing#api> (tabela completa em platform.claude.com/docs/en/about-claude/pricing) | 2026-11-04 |
| API release notes | <https://docs.claude.com/en/release-notes/api> | 2026-11-04 (entradas até 2026-11-02; as últimas ~37K caracteres da página não foram lidas) |
| TypeScript SDK (betas, types) | <https://github.com/anthropics/anthropic-sdk-typescript> | sdk-v1.4.0 (2026-11-02), só a lista de releases; código não lido |
| Guia de migração 2026-10-21 | <https://platform.claude.com/docs/en/api/migration-2026-10-21> | 2026-11-04 |
| Erros, rate limits, caching, effort, thinking, beta headers, List Models | páginas em platform.claude.com/docs/en/ (`api/errors`, `api/rate-limits`, `build-with-claude/prompt-caching`, `build-with-claude/effort`, `build-with-claude/thinking`, `api/beta-headers`, `api/models/list`) | 2026-11-04 |

## Contrato

### Endpoints e protocolos

- Base URL: `https://api.anthropic.com` (global; residência de dados dos EUA via `inference_geo: "us"`, preço x1,1 em modelos 4.6+). Não há escolha de região por URL na API de primeira parte.
- Protocolo único: Anthropic Messages, `POST /v1/messages`; contagem em `POST /v1/messages/count_tokens`; lote em `/v1/messages/batches`; modelos em `GET /v1/models`. Não há endpoint Chat Completions ou Responses nativo.
- Autenticação: `x-api-key: <chave>` ou `Authorization: Bearer <chave>`; a API aceita as duas (guia 2026-10-21). Os SDKs novos (Python/TS v1) passaram a enviar `Authorization: Bearer`; gateways que só leem `x-api-key` quebram com eles.
- `anthropic-version`: `2023-06-01` (atual do Thinker) ou `2026-10-21`. Na `2026-10-21`: `temperature`/`top_p`/`top_k` retornam 400 mesmo com valor padrão; bloco `document` em mensagem `assistant` e `citations` em texto de `user` retornam 400.
- Cabeçalhos de resposta úteis: `request-id` (também `request_id` no corpo de erro), `anthropic-ratelimit-*`, `retry-after`, `anthropic-organization-id`, `anthropic-workspace-id`.
- Tamanho máximo de requisição: Messages e count_tokens 128 MB (era 32 MB até 2026-10-28), batch 256 MB, Files 500 MB.
- Beta headers: `anthropic-beta` com flags separadas por vírgula ou o cabeçalho repetido. Flag inválida ou sem acesso dá 400 (`Unexpected value(s) ... for the anthropic-beta header`). Flags datadas, por exemplo `thinking-binding-controls-2026-08-01`, `compact-2026-09-04`, `inline-tools-2026-09-15`, `mcp-client-2026-09-15`, `server-side-fallback-2026-07-01`, `output-300k-2026-03-24`. GA sem header (2026-08-19 em diante): Files API, Skills API, `computer_toolset_20260801`; cache diagnostics (2026-09-23); fast mode do Opus 5.5 (2026-10-15).

### Modelos

`GET /v1/models` (cursor `after_id`/`before_id`, `limit` 1 a 1000, padrão 20; `lifecycle=active|deprecated|retired`, por padrão active e deprecated). Cada item: `id`, `display_name`, `created_at`, `type: "model"`, `max_input_tokens`, `max_tokens`, `capabilities` (batch, citations, effort com `low`..`xhigh`/`max`, image_input, pdf_input, server_tools, structured_outputs, thinking.types adaptive/enabled/disabled/between_tools, context_management), `lifecycle`, `deprecated_at`, `retires_at`, `line` (haiku, sonnet, opus, fable, mythos). Resposta: `data`, `first_id`, `last_id`, `has_more`.

| Modelo (id) | Contexto / saída | Entrada / saída por MTok | Aposentadoria |
|---|---|---|---|
| `claude-fable-5-1` | 1M / 128K | $10 / $50 | não antes de 2027-09-01 |
| `claude-fable-5` | 1M / 128K (não confirmado para fable-5; a tabela lista só os 5.5 e fable-5-1) | $10 / $50 | não antes de 2027-06-09 |
| `claude-opus-5-5` | 1M / 128K | $4 / $20 | não antes de 2027-09-22 |
| `claude-opus-5` | 1M (não confirmado) | $5 / $25 | não antes de 2027-07-24 |
| `claude-opus-4-8`, `-4-7`, `-4-6` | 1M (4.6+) | $5 / $25 | 4.8: 2027-05-28; 4.7: 2027-04-16; 4.6: 2027-02-05 |
| `claude-opus-4-5-20251101` | 200K (não confirmado) | $5 / $25 | não antes de 2026-11-24 |
| `claude-sonnet-5-5` | 1M / 128K | $2 / $10 | não antes de 2027-09-28 |
| `claude-sonnet-5` | 1M (não confirmado) | $2 / $10 (preço introdutório virou padrão) | não antes de 2027-06-30 |
| `claude-sonnet-4-6` | 1M | $3 / $15 | não antes de 2027-02-17 |
| `claude-sonnet-4-5-20250929` | 200K (não confirmado) | $3 / $15 | **2026-11-30** (deprecated em 2026-09-30; substituto `claude-sonnet-5-5`) |
| `claude-haiku-5-5` | 1M / 128K | $0,10 / $0,50 até 100K tokens de prompt; $0,50 / $2,50 acima | não antes de 2027-10-07 |
| `claude-haiku-4-5-20251001` | 200K (não confirmado) | $1 / $5 | não antes de 2026-10-15 (sem aviso de depreciação visto) |
| `claude-mythos-5-1`, `claude-mythos-5` | como Fable | $10 / $50 | acesso limitado (programa de verificação) |

- Desde a linha 4.6 os ids não têm data (cada id é um snapshot fixado e o alias repete o id). Antes disso o alias aponta para o id datado.
- Aposentados: Opus 4.1 (2026-08-05), Opus 4 e Sonnet 4 (2026-06-15), Sonnet 3.7, Haiku 3.5 (2026-02-19), Haiku 3 (2026-04-20). Aviso mínimo de 60 dias antes de aposentar modelo público.
- Lançamentos recentes (release notes): Opus 4.8 (05-28), Fable 5 e Mythos 5 (06-09), Sonnet 5 (06-30), Opus 5 (07-24), Fable 5.1 e Mythos 5.1 (09-01), Opus 5.5 (09-22), Sonnet 5.5 (09-28), Haiku 5.5 (10-07).
- Tokenizador: Claude 4.7 e posteriores geram cerca de 30% mais tokens para o mesmo texto que o 4.6 e anteriores.

### Capacidades

- Entrada de texto e imagem, saída de texto, tool use em todos os modelos atuais; PDF, structured outputs (`output_config.format` com `json_schema`), citações e server tools (web search, code execution) conforme `capabilities` do modelo.
- Thinking:
  - Fable 5.1, Mythos, Opus 5.5: adaptativo, sempre ligado. `thinking: {"type":"disabled"}` dá 400.
  - Sonnet 5.5: adaptativo; desligar usa `{"type":"between_tools"}` (só funciona com effort `low`, `medium`, `high`); `disabled` e `enabled` dão 400.
  - Haiku 5.5: adaptativo; aceita `disabled` somente com effort `high` ou menor; `enabled` dá 400.
  - Claude 4.7 e posteriores: `thinking.type: "enabled"` com `budget_tokens` retorna 400 (`"thinking.type.enabled" is not supported for this model`). Opus 4.6 e Sonnet 4.6 aceitam mas está deprecated. Claude 4.5 e anteriores só aceitam `enabled` e rejeitam `adaptive`.
  - Modelos 5.1 e posteriores validam a assinatura dos blocos `thinking` reenviados (prefixo precisa ser idêntico). Erro: `Invalid signature in thinking block. The block is bound to a different conversation`; mitigação com o beta `thinking-binding-controls-2026-08-01` e `thinking.block_binding.prefix_mismatch_behavior: "drop_block"`.
  - Blocos `thinking`/`redacted_thinking` do último turno do assistente não podem ser editados, reordenados ou removidos (400).
  - `thinking.display: "omitted"` esconde o conteúdo; `"updates"` exige o beta `thinking-display-updates-2026-08-18`. `usage.output_tokens_details.thinking_tokens` informa o consumo.
- Effort: `output_config.effort`, sem beta header. Níveis `low`, `medium`, `high`, `xhigh`, `max` (nem todo modelo aceita `xhigh`/`max`; Sonnet 5.5 e Haiku 5.5 aceitam os cinco). Padrão da API: `high`, exceto `medium` em Opus 5.5 e Haiku 5.5. Effort por mensagem via mensagem `role: "system"` (beta).
- Proibido ou ignorado:
  - `tool_choice` `{type:"any"}` e `{type:"tool"}` dão 400 em Fable 5.1, Mythos 5.1, Opus 5.5 e Sonnet 5.5 (também em count_tokens); só `auto` e `none`.
  - Prefill da última mensagem do assistente dá 400 em Claude 4.6 e posteriores.
  - `temperature`, `top_p`, `top_k` com valor não padrão dão 400 em 4.7 e posteriores; qualquer valor dá 400 na versão `2026-10-21`.
  - Opus 5.5, Sonnet 5.5 e Haiku 5.5 recusam as versões antigas do computer use (`computer_20251124`, `computer_20250124`); usar `computer_toolset_20260801`.
  - Fast mode (`speed: "fast"`): Opus 5.5 (GA), Opus 5 e 4.8 (pesquisa; o 4.8 sai em 2026-11-30), Opus 4.7 removido em 2026-07-24.
- Prompt caching:
  - Padrão 5 minutos (`{"type":"ephemeral"}`); 1 hora com `"ttl":"1h"`. Escrita 5m = 1,25x da entrada, escrita 1h = 2x; leitura = 0,1x (0,05x em Opus 5.5 e Sonnet 5.5; 0,025x em Fable 5.1 e Mythos 5.1).
  - Máximo de 4 breakpoints explícitos. `cache_control` no topo da requisição ativa cache automático (consome um dos 4 slots; 400 se já houver 4, ou se o último bloco tiver TTL diferente).
  - Ordem: breakpoints de TTL maior vêm antes dos de TTL menor (1h antes de 5m), senão 400.
  - Mínimo cacheável: 512 tokens (Fable/Mythos/Opus 5.x, Sonnet 5.5, Haiku 5.5), 1024 (Opus 4.8, Sonnet 5, Sonnet 4.6/4.5), 2048 (Opus 4.7), 4096 (Opus 4.6/4.5, Haiku 4.5). Abaixo disso não há erro, só não cacheia.
  - `max_tokens: 0` pré-aquece o cache. Mensagem `role: "system"` no meio da conversa preserva o cache; trocar o `system` de topo invalida.
  - Não pode haver `cache_control` em blocos `thinking`; a janela de lookback é de 20 blocos.
- Contexto: 1M tokens nos modelos 4.6+ sem tarifa extra (exceto Haiku 5.5, que tem faixa acima de 100K tokens de prompt). Saída síncrona máxima 128K; até 300K na Batch API com o beta `output-300k-2026-03-24`.
- Mensagem de thread (beta `message-threads-2026-08-12`, 2026-11-02): o servidor guarda a conversa por 5 minutos. Recurso novo; não confirmado se algum harness já usa.

### Streaming e uso

- SSE padrão da Messages (`message_start`, `content_block_*`, `message_delta`, `message_stop`); erro pode chegar no meio do stream com HTTP 200 (evento `error`). Para `max_tokens` grande ou requisições longas, usar streaming.
- `usage`: `input_tokens` (somente após o último breakpoint), `cache_read_input_tokens`, `cache_creation_input_tokens` e o detalhe `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` (a soma é igual a `cache_creation_input_tokens`), `output_tokens`, `output_tokens_details.thinking_tokens`. Entrada total = lidos + escritos + `input_tokens`.
- `stop_reason` inclui `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `refusal`, `model_context_window_exceeded`.

### Preços

Valores por MTok (fonte: pricing, 2026-11-04). Colunas: entrada, escrita 5m, escrita 1h, leitura de cache, saída.

| Modelo | Entrada | Escrita 5m | Escrita 1h | Leitura | Saída |
|---|---|---|---|---|---|
| Fable 5.1 / Mythos 5.1 | 10 | 12,50 | 20 | 0,25 | 50 |
| Fable 5 / Mythos 5 | 10 | 12,50 | 20 | 1 | 50 |
| Opus 5.5 | 4 | 5 | 8 | 0,20 | 20 |
| Opus 5, 4.8, 4.7, 4.6, 4.5 | 5 | 6,25 | 10 | 0,50 | 25 |
| Sonnet 5.5 | 2 | 2,50 | 4 | 0,10 | 10 |
| Sonnet 5 | 2 | 2,50 | 4 | 0,20 | 10 |
| Sonnet 4.6 / 4.5 | 3 | 3,75 | 6 | 0,30 | 15 |
| Haiku 5.5 (até 100K) | 0,10 | 0,125 | 0,20 | 0,01 | 0,50 |
| Haiku 5.5 (acima de 100K) | 0,50 | 0,625 | 1 | 0,05 | 2,50 |
| Haiku 4.5 | 1 | 1,25 | 2 | 0,10 | 5 |

- Batch API: 50% de desconto em entrada e saída; os multiplicadores de cache e de residência empilham. Fast mode tem preço próprio (tabela não lida) e não existe em batch.
- `inference_geo: "us"`: x1,1 em todas as categorias (modelos 4.6+).
- Haiku 5.5 cobra pela faixa do prompt inteiro (conta leituras e escritas de cache), por requisição.

### Limites e erros

| HTTP | `error.type` | Significado | Retentável |
|---|---|---|---|
| 400 | `invalid_request_error` | Corpo inválido, parâmetro recusado pelo modelo, beta inválido, limite de gasto próprio atingido | não |
| 401 | `authentication_error` | Chave malformada, revogada ou expirada (também CORS bloqueado por organização com retenção especial) | não |
| 402 | `billing_error` | Problema de pagamento | não |
| 403 | `permission_error` | Chave sem acesso ao recurso ou modelo | não |
| 404 | `not_found_error` | Recurso ou modelo inexistente (inclui modelo aposentado) | não |
| 409 | `conflict_error` | Conflito de estado | depois de resolver |
| 413 | `request_too_large` | Acima do tamanho máximo (Cloudflare responde antes da API) | não |
| 429 | `rate_limit_error` | Limite de RPM/ITPM/OTPM ou aceleração; pode trazer `retry-after`. Teto mensal do tier também é 429, **sem** `retry-after`, com `error.details.error_code = "enforced_spend_limit_reached"` | sim, se houver `retry-after`; o teto mensal não |
| 500 | `api_error` | Erro interno | sim, com backoff |
| 504 | `timeout_error` | Tempo esgotado | sim |
| 529 | `overloaded_error` | API sobrecarregada | sim |

- Limites por modelo e tier (Start, Build, Scale, Custom): por exemplo Start, Opus 5.5: 4.000 RPM, 2M ITPM, 400K OTPM; Fable 5.x: 4.000 RPM, 500K ITPM, 100K OTPM (Fable 5.1 e 5 dividem o mesmo balde). Só tokens de entrada não cacheados e escritas de cache contam no ITPM (exceto Haiku 3.5).
- Tetos de gasto mensal: Start $500, Build $1.000, Scale $200.000. Limite de gasto definido pelo usuário devolve 400 com mensagem `You have reached your specified API usage limits`.
- Cabeçalhos: `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}` (reset em RFC 3339), `retry-after`.
- Os SDKs oficiais repetem 2 vezes por padrão em erros transitórios, respeitando `retry-after`.

## Como o Thinker implementa hoje

Conferido no código em 2026-11-04.

- Endpoint: `anthropic` com base `https://api.anthropic.com`, caminho `/v1/messages`, formato `anthropic` (`packages/backend/src/routing/proxy/provider-endpoints.ts:233-238`).
- Cabeçalhos da chave de API: `Content-Type`, `anthropic-version: 2023-06-01` e `x-api-key` (`provider-endpoints.ts:151-162`). O caminho de assinatura usa outro construtor (cobertura em `sub-anthropic`).
- Autenticação de entrada: aceita `Authorization: Bearer thk_...` e `x-api-key`; recusa os dois com credenciais diferentes (`packages/backend/src/common/errors/error-codes.ts:11,34`, `packages/backend/src/otlp/guards/agent-key-auth.guard.ts:161-165`). Compatível com os SDKs novos, que mandam só `Authorization`.
- Beta headers: o `anthropic-beta` do cliente é saneado (tokens minúsculos, até 20 flags e 1024 bytes) e mesclado, e só é enviado quando o host de destino é exatamente `api.anthropic.com` (`packages/backend/src/routing/proxy/anthropic-beta.ts`, `provider-client.ts:129-141`, `proxy.service.ts:485-642`). O Thinker não injeta flags próprias no caminho de chave de API; na assinatura injeta o par OAuth (`packages/backend/src/common/constants/subscription-clients.ts:70-71`). Pedidos traduzidos de Chat Completions não carregam flags.
- Descoberta de modelos: `GET https://api.anthropic.com/v1/models?limit=100` com `anthropic-version` e `x-api-key` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:998-1013`). O parser lê só `id`, `display_name` e `type === 'model'`, com contexto fixo `ANTHROPIC_DEFAULT_CONTEXT = 200000` (`provider-model-fetcher.service.ts:55,541-553`). Sem paginação além de 100 e sem uso de `max_input_tokens`, `max_tokens`, `capabilities` nem `lifecycle`.
- Ids: o Thinker aceita ids curtos com ponto (`claude-sonnet-4.5`) e normaliza para o formato com hífen (`packages/backend/src/common/utils/anthropic-model-id.ts:25-49`); `provider-inference.ts` associa `^claude-` ao provedor `anthropic` (`packages/shared/src/provider-inference.ts:9`).
- Cache: nas rotas traduzidas coloca `cache_control` efêmero (5m) no último bloco de `system` e na última ferramenta (`anthropic-adapter.ts:490-520`). No caminho nativo `/v1/messages` adiciona breakpoints de 5m apenas se o cliente não usar TTL de 1h e se houver espaço nos 4 slots (`anthropic-adapter.ts:62-135,609-650`).
- Uso: lê `cache_read_input_tokens` e `cache_creation_input_tokens`, sem o detalhe por TTL (`anthropic-adapter.ts:778-806,889-901`). Custo: um único preço de escrita de cache (`packages/backend/src/common/utils/cost-calculator.ts:191-212`), com preços vindos de catálogos (OpenRouter/models.dev) e da tabela `known-model-prices.ts`, que não tem entradas Claude.
- Conversão: `tool_choice` `required` vira `any` e função nomeada vira `tool` (`anthropic-adapter.ts:347-367`); `temperature`, `top_p`, `top_k` e `thinking` são copiados (`anthropic-adapter.ts:530-538`); `reasoning_effort` não é mapeado; `response_format` vira `output_config.format` com `additionalProperties:false` forçado (`anthropic-adapter.ts:440-470`); `max_tokens` padrão 4096.
- Thinking: blocos `thinking`/`redacted_thinking` sem assinatura reaproveitável são removidos e os assinados são reinjetados do cache antes do `tool_use` (`anthropic-adapter.ts:159-175,296-310`, `thinking-block-cache.ts`).
- Erros: `stop_reason` `refusal` vira `content_filter` e `model_context_window_exceeded` vira `length` (`anthropic-adapter.ts:733-748`).
- Setup do harness: o Claude Code usa a superfície `messages` (`packages/shared/src/agent-type.ts:79-85`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/anthropic-adapter.ts`
- `packages/backend/src/routing/proxy/anthropic-messages-adapter.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/backend/src/routing/proxy/cache-injection.ts`
- `packages/backend/src/routing/proxy/thinking-block-cache.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/common/utils/anthropic-model-id.ts`
- `packages/backend/src/common/utils/cost-calculator.ts`
- `packages/backend/src/model-prices/model-pricing-cache.service.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Descoberta fixa o contexto em 200000 e ignora `max_input_tokens`, `max_tokens`, `capabilities` e `lifecycle` do `GET /v1/models` (modelos 5.x têm 1M de contexto e 128K de saída). Mudança: ler esses campos e avisar modelos deprecated. Não confirmado se o enriquecimento por catálogo corrige depois | providers | [#401](https://github.com/patrickbrandao/thinker/issues/401) | resolvida (contexto lido da descoberta) |
| G2 | degradação | Custo de escrita de cache usa um preço só; escrita de 1h custa 2x (não 1,25x) e o detalhe `cache_creation.ephemeral_1h_input_tokens` não é lido. Leitura 0,05x e 0,025x dos modelos 5.x depende do catálogo (não confirmado) | backend-dev | [#402](https://github.com/patrickbrandao/thinker/issues/402) | resolvida (escrita de cache de 1h a 2x da entrada) |
| G3 | quebra | `temperature`/`top_p`/`top_k` seguem no pedido e dão 400 em Claude 4.7+ com valor não padrão. Mudança: remover por família de modelo | providers | [#403](https://github.com/patrickbrandao/thinker/issues/403) | resolvida (política de parâmetros: sampling removido em Claude 4.7+) |
| G4 | quebra | `tool_choice` `any`/`tool` (de `required`/função nomeada ou do corpo nativo) dá 400 em Fable 5.1, Mythos 5.1, Opus 5.5 e Sonnet 5.5. Mudança: rebaixar para `auto` ou erro claro | providers | [#404](https://github.com/patrickbrandao/thinker/issues/404) | resolvida (tool_choice any/tool rebaixado para auto) |
| G5 | oportunidade | `reasoning_effort` do Chat Completions não vira `output_config.effort` e `thinking` não é traduzido por modelo (`enabled` com `budget_tokens` dá 400 em 4.7+; `disabled` dá 400 em Fable/Opus 5.5/Sonnet 5.5) | providers | [#405](https://github.com/patrickbrandao/thinker/issues/405) | resolvida (normalização de reasoning na entrada e na saída) |

Observações sem lacuna aberta:

- `claude-sonnet-4-5-20250929` sai em 2026-11-30 e `claude-opus-4-5-20251101` não antes de 2026-11-24. O Thinker lê a lista de modelos da API, sem ids fixos, então os modelos somem sozinhos; rotas salvas para eles passarão a falhar com 404 (acompanhar).
- Sem confirmação, não há lacuna aberta para a versão de API `2026-10-21`: o Thinker envia sempre `2023-06-01`. Se um dia passar a repassar o `anthropic-version` do cliente, G3 vira obrigatório e `document` em `assistant` e `citations` em `user` passam a dar 400.
- Beta flags dos clientes são repassadas só no host `api.anthropic.com`; provedor customizado apontando para outro domínio que fale com a Anthropic (por exemplo, um proxy) não recebe as flags. Consistente com a decisão registrada em `anthropic-beta.ts`.

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa contra a documentação (platform.claude.com/docs, API version 2026-10-21, release notes até 2026-11-02). Contrato escrito, código conferido, lacunas G1 a G5 abertas (#401 a #405). Não lidos: tabela de fast mode, páginas individuais de cada modelo e o código do SDK TypeScript.
