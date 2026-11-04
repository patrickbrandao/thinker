---
id: api-cerebras
categoria: api
entidade: Cerebras
agente: api-cerebras
thinker_ids: [cerebras]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04
---

# Cerebras (acesso por API)

Especificação mantida pelo agente `api-cerebras` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

API OpenAI-compatível (somente `POST /v1/chat/completions`) em `https://api.cerebras.ai`, auth Bearer. O catálogo mudou muito: a página de modelos lista apenas `gpt-oss-120b` e `qwen-3.8-27b` no Shared Inference (Free Trial e Pay as You Go); a página de reasoning cita ainda `kimi-k2.7-code`, `kimi-k3`, `zai-glm-5.3-flash` e `gemma-4-31b` (disponibilidade em Shared não confirmada). Vários modelos antigos já foram aposentados. O Thinker usa o adaptador OpenAI genérico e lista modelos via `/v1/models`; não tem tabela de preços própria nem trata o campo `reasoning` do Cerebras.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Inference docs | <https://inference-docs.cerebras.ai/> | 2026-11-04 |
| Models | <https://inference-docs.cerebras.ai/models/overview> | 2026-11-04 |
| Deprecations | <https://inference-docs.cerebras.ai/support/deprecation> | 2026-11-04 |
| Rate limits | <https://inference-docs.cerebras.ai/support/rate-limits> | 2026-11-04 |
| Reasoning | <https://inference-docs.cerebras.ai/capabilities/reasoning> | 2026-11-04 |
| Errors | <https://inference-docs.cerebras.ai/support/error> | 2026-11-04 |
| API reference (chat) | <https://inference-docs.cerebras.ai/api-reference/chat-completions> | 2026-11-04 |
| Pricing | <https://www.cerebras.ai/pricing> | 2026-11-04 (sem tabela por modelo na página) |

## Contrato

### Endpoints e protocolos

- Base URL `https://api.cerebras.ai`; auth `Authorization: Bearer <key>`. Chave criada em <https://cloud.cerebras.ai>.
- Único endpoint documentado: `POST /v1/chat/completions`. Sem Messages nem Responses na referência (docs 2026-11-04).
- Corpo pode ir `application/json` ou `application/vnd.msgpack`; `Content-Encoding: gzip` aceito.
- Listagem: `GET /v1/models` (formato OpenAI; shape exato não conferido nesta revisão, `(não confirmado)`).
- Private Preview: `service_tier` (`priority`, `default`, `auto`, `flex`) e header `queue_threshold` (50-20000 ms). Indisponível no Shared Inference do Developer Tier.

### Modelos

| Id | Contexto (free / pago) | Velocidade | Observação |
|---|---|---|---|
| `gpt-oss-120b` | 65k / 131k | ~3000 tok/s | Shared Inference; único com mensagens `developer` |
| `qwen-3.8-27b` | 64k / 128k | ~1850 tok/s | Shared Inference; visão (até 2 imagens no free, 10 no pago, payload 10 MiB) |
| `kimi-k2.7-code`, `kimi-k3`, `zai-glm-5.3-flash`, `gemma-4-31b` | — | — | Citados só na página de reasoning; fora da lista de modelos (não confirmado se estão em Shared) |

Max output por modelo não é publicado na página de visão geral (não confirmado).

Aposentadorias (página de deprecation, 2026-11-04):

| Data | Modelo | Substituto |
|---|---|---|
| 2026-09-03 | `gemma-4-31b` (só Shared) | `qwen-3.8-27b` |
| 2026-08-17 | `zai-glm-4.7` | não informado |
| 2026-05-27 | `llama3.1-8b`, `qwen-3-235b-a22b-instruct-2507` | `gpt-oss-120b` |
| 2026-02-16 | `qwen-3-32b`, `llama-3.3-70b` | `gpt-oss-120b` |
| anteriores | `zai-glm-4.6`, `qwen-3-coder-480b`, `llama-4-*`, `deepseek-r1-distill-llama-70b`, `llama3.1-70b` etc. | ver página |

### Capacidades

- Reasoning: parâmetro `reasoning_effort`; `reasoning_format` (`parsed` padrão, `raw`, `hidden` conforme modelo); `clear_thinking` (padrão `false`; suportado em `qwen-3.8-27b` e `zai-glm-5.3-flash`; não enviar a `kimi-*`). Resultado vem em `choices[0].message.reasoning` e, em stream, `choices[0].delta.reasoning` (não `reasoning_content`). Tokens de reasoning contam em `max_completion_tokens`.
- Padrões por modelo: `qwen-3.8-27b` high (valores none/low/medium/high; `none` desliga); `gpt-oss-120b` medium (low/medium/high, não desliga); `kimi-k3` e `zai-glm-5.3-flash` max (low/high/max); `gemma-4-31b` none.
- Não enviar `disable_reasoning`, `enable_thinking`, `thinking_budget` (nativos do Qwen). `disable_reasoning` de `zai-glm-4.7` deixou de valer após 2026-07-21.
- Tools, structured output (`json_object`, `json_schema`) existem; `json_object` não pode combinar com `stream: true`.
- `prediction` indisponível para `qwen-3.8-27b` (Shared) e `kimi-k2.7-code`.
- Prompt caching automático; `prompt_cache_key` opcional para agrupar requisições.

### Streaming e uso

- Chunk final traz `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`) e `time_info`. `stream_options` não é documentado (não confirmado se aceito ou ignorado).
- Cache lido: `usage.prompt_tokens_details.cached_tokens`; `image_tokens` é subconjunto de `prompt_tokens`. Sem campo de cache write.

### Preços

A página de pricing não expõe tabela por modelo (apenas crédito promocional único de US$ 5 para o free trial, expira em 30 dias, "não para produção"). Preços por 1M tokens e cobrança de cache: não confirmado.

### Limites e erros

| Tier | `gpt-oss-120b` | `qwen-3.8-27b` |
|---|---|---|
| Free Trial | 5 RPM, 30K TPM não-cacheado, 90K TPM total, 1M TPH, 1M TPD | idem |
| Developer (PAYG) | 1K RPM, 1M TPM não-cache, 3M total | 300 RPM, 150K não-cache, 750K total (elevado temporariamente de 450K) |

- Erros: 400, 401 (chave inválida), 402 PaymentRequired (crédito esgotado), 403, 404, 413 (payload/imagens), 422, 429 (rate limit; a mensagem diz se o limite excedido é cached ou total), 500, 503.
- O SDK oficial retenta conexão, 408, 429 e >=500 (2 vezes, backoff exponencial). Headers de rate limit não documentados.
- Parâmetros: `n` só `1`; `max_tokens` é alias de `max_completion_tokens` (não enviar os dois); `stop` até 4.

## Como o Thinker implementa hoje

- Provider `cerebras`, exige API key, sem prefixo, tamanho mínimo 20 (`packages/shared/src/providers.ts:146`).
- Proxy: base URL `https://api.cerebras.ai`, headers `Authorization: Bearer` + `Content-Type`, formato `openai`, `streamUsageReporting: 'openai_stream_options'` (`packages/backend/src/routing/proxy/provider-endpoints.ts:316`, helpers em `:84-89`). Envia `stream_options.include_usage`, não documentado pela Cerebras (risco baixo, parâmetro costuma ser aceito; não confirmado).
- Descoberta de modelos: `https://api.cerebras.ai/v1/models`, Bearer, parser OpenAI (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:892`).
- Preços: nenhuma entrada de Cerebras em `known-model-prices.ts`; o sync do models.dev mapeia `cerebras` (`packages/backend/src/database/models-dev-sync.service.ts:30`).
- URL para obter a chave: `https://cloud.cerebras.ai` (`packages/frontend/src/services/provider-api-key-urls.ts:5`).
- Nenhum tratamento do campo `reasoning` (stream/não-stream) nem de `reasoning_effort` específico por modelo para Cerebras; `reasoning_content` é o campo usado no restante do pipeline.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`
- `packages/cli/src/provider-catalog.gen.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Cerebras devolve reasoning em `message.reasoning` / `delta.reasoning`, não `reasoning_content`; o Thinker não normaliza, então o raciocínio de `gpt-oss-120b`/`qwen-3.8-27b` não chega a clientes como `reasoning_content` (e pode ser perdido em conversão para Anthropic). Sugestão: mapear `reasoning` para `reasoning_content` no parse de provider `cerebras`. Causa distinta das lacunas de outros providers (nenhuma issue existente sobre Cerebras). | backend-dev | #416 | aberta |
| G2 | oportunidade | Sem preços conhecidos para Cerebras (pricing sem tabela pública; depende do sync models.dev). Verificar com conta real e, se preciso, adicionar em `known-model-prices.ts`. | providers | — | aberta |
| G3 | oportunidade | `reasoning_effort` por modelo (`none` só em `qwen-3.8-27b`/`gemma-4-31b`; `max` em `kimi-k3`/`glm-5.3-flash`) e `clear_thinking` não são tratados; valor inválido retorna 400. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (docs 2026-11-04). Contrato preenchido; 3 lacunas registradas. Preços e shape de `/v1/models` não confirmados.
