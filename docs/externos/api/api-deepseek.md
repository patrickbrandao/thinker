---
id: api-deepseek
categoria: api
entidade: DeepSeek
agente: api-deepseek
thinker_ids: [deepseek]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04 (changelog até 2026-10-17; DeepSeek-V4.1-Flash-1017 e DeepSeek-V4-Pro-0813)
---

# DeepSeek (acesso por API)

Especificação mantida pelo agente `api-deepseek` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Dois modelos vigentes: `deepseek-flash` (V4.1 Flash, multimodal) e `deepseek-v4-pro` (só texto). Ambos com 1M de contexto, até 384K de saída, thinking ligado por padrão.
- Três superfícies na mesma chave: Chat Completions (`/chat/completions`), Anthropic Messages (`/anthropic`) e Responses API.
- Preço com tarifa de pico e fora de pico (metade). O Thinker já modela isso, mas trata `deepseek-v4-pro` como Flash desde 2026-09-14, o que a tabela oficial não confirma (G1, issue #396).
- Nomes legados `deepseek-chat` e `deepseek-reasoner` estavam marcados para descontinuação em 2026-07-24; `deepseek-v4-flash` e `deepseek-v4-flash-vision-exp` seguem aceitos e roteados ao Flash.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| API docs | <https://api-docs.deepseek.com/> | 2026-11-04 |
| Models and pricing | <https://api-docs.deepseek.com/quick_start/pricing> | 2026-11-04 (V4.1-Flash-1017, V4-Pro-0813) |
| Anthropic-compatible API | <https://api-docs.deepseek.com/guides/anthropic_api> | 2026-11-04 |
| News / change log | <https://api-docs.deepseek.com/updates> | entrada de 2026-10-17 |
| Chat Completions (referência) | <https://api-docs.deepseek.com/api/create-chat-completion> | 2026-11-04 |
| Thinking mode | <https://api-docs.deepseek.com/guides/thinking_mode> | 2026-11-04 |
| Error codes | <https://api-docs.deepseek.com/quick_start/error_codes> | 2026-11-04 |
| Rate limit | <https://api-docs.deepseek.com/quick_start/rate_limit> | 2026-11-04 |

Todas as leituras foram feitas por resumo de página (WebFetch); não há código de SDK oficial lido nesta revisão.

## Contrato

### Endpoints e protocolos

| Superfície | Base / caminho | Observações |
|---|---|---|
| Chat Completions | `https://api.deepseek.com` + `/chat/completions` | `Authorization: Bearer <key>`. Fonte: referência da API, 2026-11-04. |
| Anthropic Messages | `https://api.deepseek.com/anthropic` (+ `/v1/messages`, não confirmado o sufixo exato) | Aceita `x-api-key` ou `Authorization: Bearer`. `anthropic-version` é ignorado; `anthropic-beta` é ignorado em `/messages`, exceto `files-api-2025-04-14` para imagens por `file`. |
| Responses API | nativa desde 2026-08-13 (adaptada ao Codex) | Caminho exato não confirmado. |
| Listagem de modelos | `GET https://api.deepseek.com/models` | Formato OpenAI (`data[].id`). Os ids devolvidos não foram conferidos ao vivo (não confirmado). |
| Search / Fetch | API própria, US$ 0,75 por 1.000 requisições com sucesso cada | Chamadas server-side de DeepSeek Harness, Claude Code ou Codex são grátis até a cobrança começar em 2026-11-01 00:00 (Pequim); a página lista isso como futuro, então já pode estar vigente. |

Mapeamento de nomes na API Anthropic: `claude-opus*` vira `deepseek-v4-pro`; `claude-sonnet*`, `claude-haiku*` e outros `claude*` viram `deepseek-flash`. Nomes que não começam com `claude` retornam 400.

### Modelos

| Id | Versão | Contexto | Saída máx. | Visão | Concorrência |
|---|---|---|---|---|---|
| `deepseek-flash` | DeepSeek-V4.1-Flash-1017 | 1M | 384K | sim | 2.500 |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 1M | 384K | não (imagens viram `[Unsupported Image]` na API Anthropic) | 500 |

Contexto e saída aparecem numa célula única na página; o valor vale para ambos (inferido).

Aliases e aposentadorias:

- `deepseek-v4-flash` e `deepseek-v4-flash-vision-exp`: aposentados, ainda aceitos, servidos pelo V4.1 Flash e cobrados como Flash. Sem data de corte publicada.
- `deepseek-chat` e `deepseek-reasoner`: o changelog de 2026-04-24 anunciou descontinuação em 2026-07-24 (mapeavam para V4-Flash sem e com thinking). Estado atual não confirmado; a página de preços não os lista mais.
- Histórico de lançamentos: V4 (2026-04-24), V4-Flash beta (2026-07-31), V4-Pro GA e Responses API (2026-08-13), V4-Flash-Vision-Exp (2026-08-21), V4.1 Flash (2026-09-10), V4.1-Flash-1017 (2026-10-17, preço inalterado).

### Capacidades

| Recurso | Flash | Pro |
|---|---|---|
| JSON Output, Tool Calls, Responses API, Anthropic API | sim | sim |
| Chat Prefix Completion (beta) | sim | sim |
| FIM Completion (beta) | só sem thinking | só sem thinking |
| Visão | sim | não |

Thinking:

- Ligado por padrão, esforço `high`. Em Chat Completions: `thinking: {"type": "enabled"|"disabled"}` (tem precedência) ou `reasoning_effort` com `none`, `low`, `high`, `max`. Mapeamento: `minimal`→`low`; `medium` e `xhigh`→`high`; `ultra`→`max`.
- Na API Anthropic: `thinking` `enabled`/`disabled` (`adaptive` vira `enabled`, `budget_tokens` ignorado) e `output_config.effort`.
- Saída em `message.reasoning_content` (`delta.reasoning_content` em stream).
- Com `tools` na requisição, o `reasoning_content` de todos os turnos anteriores deve voltar na entrada, senão 400. Sem `tools`, é ignorado.
- Em thinking: `temperature`, `presence_penalty` e `frequency_penalty` sem efeito (não dão erro); `top_p` depende do modelo (Flash trata abaixo de 0,95 como 0,95; Pro ignora). `tool_choice` `required` ou nomeado retorna 400.
- `max_tokens`: 1 a 393216; padrão 8K sem thinking, 64K com thinking, 128K com `reasoning_effort: max`.
- Cache de contexto automático (campos de uso abaixo). `cache_control` da API Anthropic é ignorado.

### Streaming e uso

- Chat Completions: `stream_options` só é válido com `stream: true` (senão 400). `include_usage: true` coloca `usage` em todos os chunks (`null` exceto o último).
- Campos de uso: `prompt_tokens` = `prompt_cache_hit_tokens` + `prompt_cache_miss_tokens`; `prompt_tokens_details.cached_tokens` repete o hit; `completion_tokens_details.reasoning_tokens` para raciocínio. Não há campo de cache write (cache write é cobrado como entrada normal).
- Keep-alive: enquanto a requisição espera, requisições não stream recebem linhas vazias e streams recebem comentários SSE `: keep-alive`. O servidor fecha a conexão se a inferência não começar em 10 minutos.
- API Anthropic: SSE sem `data: [DONE]`; conexão fechada antes de `message_stop` significa resposta incompleta. Total de entrada = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.

### Preços

USD por 1M tokens (pricing, 2026-11-04). Fora de pico é metade do pico.

| Tipo | Flash fora de pico | Flash pico | Pro fora de pico | Pro pico |
|---|---|---|---|---|
| Entrada, cache hit | 0,003 | 0,006 | 0,022 | 0,044 |
| Entrada, cache miss | 0,15 | 0,30 | 0,66 | 1,32 |
| Saída | 0,60 | 1,20 | 1,98 | 3,96 |

- Pico: 01:00-04:00 e 06:00-10:00 UTC, segunda a sexta, exceto feriados públicos chineses. Todo o resto (fins de semana, feriados chineses inteiros) é fora de pico. A vigência dos dois níveis começou em 2026-08-16 16:00 UTC.
- A página não menciona o corte do Pro para Flash; o changelog de 2026-09-10 diz só que o serviço do Pro continua após 2026-09-14.

### Limites e erros

- Concorrência por conta (não por chave): 2.500 (Flash) e 500 (Pro). Excedente retorna 429. Aumento por formulário, sem custo. Contas com cota ampliada também têm limite por `user_id`.
- `user_id` (corpo OpenAI ou `metadata.user_id` na Anthropic): ASCII, dígitos, `_` e `-`, até 512 bytes; isola usuários para cache e agendamento.

| Código | Significado | Tentar de novo? |
|---|---|---|
| 400 | formato inválido | não (inferido) |
| 401 | chave inválida | não |
| 402 | saldo insuficiente | só após recarga |
| 422 | parâmetros inválidos (ex.: `type: "custom"` em tool na API Anthropic) | não |
| 429 | limite de taxa/concorrência | sim, com espera |
| 500 | erro do servidor | sim |
| 503 | servidor sobrecarregado | sim |

Campos ignorados na API Anthropic: `container`, `mcp_servers`, `service_tier`, `top_k`, `cache_control`. Não suportados: blocos document, search results, redacted thinking, code execution, MCP.

## Como o Thinker implementa hoje

- Base URL `https://api.deepseek.com`, formato `openai`, header Bearer, `openaiStreamUsage` (`packages/backend/src/routing/proxy/provider-endpoints.ts:288`). Só Chat Completions; a superfície Anthropic e a Responses API não são usadas.
- Listagem: `https://api.deepseek.com/models`, Bearer, parser OpenAI (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:877`).
- Cadastro: id `deepseek`, chave com prefixo `sk-`, mínimo 30 caracteres (`packages/shared/src/providers.ts:158`). Inferência de provedor por `^deepseek-` (`packages/shared/src/provider-inference.ts:12`).
- `reasoning_effort` é repassado ao endpoint `deepseek` (`packages/backend/src/routing/proxy/provider-client-converters.ts:468-476`); o endpoint `deepseek` conta sempre como dialeto DeepSeek de reasoning (`packages/backend/src/routing/proxy/reasoning-format.ts:86`), e há cache de `reasoning_content` (`reasoning-content-cache.ts`).
- Preço: seed de pico/fora de pico com janelas `01:00-04:00` e `06:00-10:00` UTC, dias 1-5 (`packages/backend/src/database/models-dev-sync.service.ts:177-179`), tarifas Flash e Pro idênticas à tabela oficial (l.189-203), ids Flash `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` (l.211). Stub de catálogo para `deepseek-flash` (l.218, l.371). Cache write cobrado como entrada normal (l.782).
- Divergência: `DEEPSEEK_PRO_FLASH_CUTOVER_MS` (2026-09-14T04:00Z, l.208) faz o Pro usar a tarifa Flash (G1).
- Não há tratamento específico visível de 402 nem de `: keep-alive` (não confirmado; ver G3).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/backend/src/routing/proxy/reasoning-content-cache.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/pages/Welcome.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O seed cobra `deepseek-v4-pro` com a tarifa Flash desde 2026-09-14 (`models-dev-sync.service.ts:205-231`), mas a tabela oficial segue com tarifa Pro (cerca de 4,4x maior). Custo do Pro subestimado. Sugestão: remover o cutover. | providers | [#396](https://github.com/patrickbrandao/thinker/issues/396) | aberta |
| G2 | oportunidade | A rota anthropic nativa (`/anthropic`) e a Responses API existem; o Thinker só usa Chat Completions. Rotear Claude Code por `/anthropic` evitaria traduzir formato e preservaria thinking blocks. Sem issue (ganho incerto). | providers | — | aberta |
| G3 | oportunidade | Confirmar (teste ao vivo com chave) que o parser SSE ignora comentários `: keep-alive` e linhas vazias de keep-alive em não stream, e que 402 (saldo) é exibido como erro de cota, não de chave. Não verificável sem chave. | backend-dev | — | aberta (não confirmado) |

Relacionados fora do escopo: `harness-deepseek-harness` (issues #381 e #382).

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (docs até o changelog de 2026-10-17). Contrato preenchido; G1 aberta como #396; G2 e G3 registradas.
