---
id: api-fireworks
categoria: api
entidade: Fireworks AI
agente: api-fireworks
thinker_ids: [fireworks]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04
---

# Fireworks AI (acesso por API)

Especificação mantida pelo agente `api-fireworks` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

Fireworks AI é um provedor de inferência serverless (e deployments dedicados) com API compatível com OpenAI Chat Completions, Responses e Anthropic Messages. Autenticação por Bearer. O Thinker usa só Chat Completions e descoberta de modelos via API de gestão de contas; funciona. Mudanças relevantes: aposentadoria de modelos serverless em 2026-11-07 (inclui GPT OSS 120B), variações de preço e limites adaptativos por modelo. Nenhuma lacuna de quebra encontrada; duas oportunidades registradas. Confiança: média-alta (docs oficiais lidos em 2026-11-04; nada testado com chave real).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://docs.fireworks.ai/> (índice `llms.txt`) | 2026-11-04 |
| Chat Completions | <https://docs.fireworks.ai/api-reference/post-chatcompletions> | 2026-11-04 |
| List models | <https://docs.fireworks.ai/api-reference/list-models> | 2026-11-04 |
| Anthropic compat | <https://docs.fireworks.ai/tools-sdks/anthropic-compatibility> | 2026-11-04 |
| Prompt caching | <https://docs.fireworks.ai/guides/prompt-caching> | 2026-11-04 |
| Rate limits | <https://docs.fireworks.ai/serverless/rate-limits> | 2026-11-04 |
| Códigos de erro | <https://docs.fireworks.ai/guides/inference-error-codes> | 2026-11-04 |
| Changelog | <https://docs.fireworks.ai/updates/changelog> | 2026-11-04 |
| Models | <https://fireworks.ai/models> | não lido (página dinâmica) |
| Pricing | <https://fireworks.ai/pricing> | 2026-11-04 |

## Contrato

### Endpoints e protocolos

- Auth: `Authorization: Bearer <chave>` + `Content-Type: application/json` (docs API reference). Chaves criadas em app.fireworks.ai/api-keys ou `firectl api-key create`.
- Chat Completions: `POST https://api.fireworks.ai/inference/v1/chat/completions`; só `model` é obrigatório.
- Responses: `POST .../inference/v1/responses` (e list/get/delete) (docs "Responses API").
- Anthropic Messages: `POST https://api.fireworks.ai/inference/v1/messages` (SDKs usam base sem `/v1`). `anthropic-version` ignorado. Sem `count_tokens` (404), sem `cache_control`, sem document blocks, sem server tools (400). Para Claude Code usar `ANTHROPIC_AUTH_TOKEN`; não remover `X-Claude-Code-Session-Id` (afeta cache).
- Região: endpoint só-EUA `us.api.fireworks.ai/inference` (docs Anthropic compat). Os endpoints US de MiniMax M3 e GLM 5.3 Flash saem em 2026-11-07 (changelog).
- Listagem: `GET https://api.fireworks.ai/v1/accounts/{account_id}/models` (sem `/inference`), query `pageSize` (máx 200, padrão 50), `pageToken`, `filter` (AIP-160), `orderBy`, `readMask`. Resposta: `models[]`, `nextPageToken`, `totalSize`.

### Modelos

- Id de uso: nome de recurso completo, ex.: `accounts/fireworks/models/kimi-k2p5`, `accounts/fireworks/models/deepseek-v3p2`. Campos do modelo: `name`, `displayName`, `contextLength`, `supportsServerless`, `supportsImageInput`, `supportsTools`, `kind` (`HF_BASE_MODEL`, `EMBEDDING_MODEL`, ...), `state` (`READY`...).
- Aposentadorias (changelog 2026-11-04): 2026-11-07 saem do serverless GPT OSS 120B, Inkling, dois Nemotron e endpoints US de MiniMax M3/GLM 5.3 Flash; deployments dedicados não são afetados. Modelos DeepSeek, GLM, Kimi, Muse, MiniMax e GPT OSS 20B antigos já saíram em ago-set/2026.
- Famílias atuais citadas: DeepSeek V4.1 Flash (+ 1017, com modo "Ultra-fast (Preview)"), GLM 5.3 / 5.3 Flash, MiniMax M3, Kimi K2.x, Muse, Nemotron 3.5 Super VL.

### Capacidades

- Tools: `tools`/`tool_choice` (`functions`/`function_call` deprecados); flag por modelo `supportsTools`.
- Visão: `supportsImageInput` por modelo.
- Raciocínio: `reasoning_effort` (`low|medium|high|xhigh|max|none`, `adaptive` só MiniMax M3, boolean ou inteiro = limite de tokens) e `thinking` estilo Anthropic (`enabled`, `budget_tokens` >= 1024, `keep: all`, `disabled`, `adaptive`). Restrições: GPT-OSS só `low|medium|high`; MiniMax M2 rejeita `none`/boolean; modelos só-thinking rejeitam `disabled`.
- `max_tokens` é reduzido para caber no contexto (`context_length_exceeded_behavior: truncate`); `max_completion_tokens` é alias e não combina com `max_tokens`.
- Saída estruturada: `response_format` (guia "Structured Outputs"); Messages: `output_config.format`.

### Streaming e uso

- `stream_options.include_usage` vem ligado por padrão em streams; uso chega em chunk final antes de `[DONE]`.
- `usage.prompt_tokens_details.cached_tokens`; `usage.completion_tokens_details.reasoning_tokens`.
- Métricas extras: headers `fireworks-prompt-tokens`, `fireworks-cached-prompt-tokens`, `perf_metrics` no corpo com `perf_metrics_in_response: true`.

### Preços

- Cobrança por token, saldo pré-pago; sem taxa de escrita de cache. Cache de entrada: 50% de desconto por padrão, mais em alguns modelos (ex.: DeepSeek V4.1 Flash $0.30 entrada / $0.006 cache / $1.20 saída por 1M, Standard; pricing 2026-11-04).
- Modos por requisição no mesmo endpoint: Standard, Priority (~+25%), Batch (-50%), Spot (-30%, só alguns modelos). Preços do DeepSeek V4.1 Flash subiram em 2026-10-01.
- Sem créditos grátis de inferência documentados na página de preços.

### Limites e erros

- Limites por conta e por modelo, em TPM (prompt total, prompt não-cacheado, gerado), adaptativos (+25% com uso >50%, -20% após 3 dias <33%); tetos por tamanho de modelo (Small <800B, Medium, Large). Priority e regular dividem limite; "fast" tem limite separado.
- Headers parciais: `X-Ratelimit-Limit-Tokens-Prompt`, `...-Uncached-Prompt`, `...-Generated` (nem toda resposta). 429: respeitar `Retry-After`, senão backoff exponencial com jitter. 503 pode ser load shedding mesmo dentro do limite.
- Códigos: 400 inválido; 401/403 chave; 402 sem plano pago/limite de uso; 404 modelo/path; 412 conta suspensa; 413 payload; retentáveis: 408, 429, 502, 503, 504, 520.
- Parâmetros: `prompt_token_ids` não combina com `messages` (400).

### Cache de prompt

- Prefixo mais longo já em cache, por réplica. Afinidade: `prompt_cache_key` (tem prioridade, documentado em Chat Completions), `user` ou header `x-session-affinity`; `x-prompt-cache-isolation-key` / campo `prompt_cache_isolation_key` isola caches.

## Como o Thinker implementa hoje

- Inferência: base `https://api.fireworks.ai/inference`, `openaiHeaders` (Bearer), path `/v1/chat/completions`, formato `openai` (`packages/backend/src/routing/proxy/provider-endpoints.ts:200,344-348`, path em `:96`).
- Id do modelo preservado com barras (`accounts/fireworks/models/...`) sem remover prefixo (`packages/backend/src/routing/proxy/provider-client.ts:340-346`).
- Envia `prompt_cache_key` com hash do `providerCacheKey` (`provider-client.ts:946-948`, helper `:267`). Compatível com a doc de Chat Completions.
- Conversão `thinking` -> `reasoning_effort` aplicada genericamente (`provider-client.ts:293-319`); não há tratamento específico Fireworks (valores `none`/boolean rejeitados por alguns modelos).
- Descoberta: `GET https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless=true&pageSize=200[&pageToken]`, até 20 páginas, com Bearer; filtra `supportsServerless !== false`, usa `contextLength` e `supportsTools` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:66-69,609-626,907-911,1269-1332`). Exclui por regex não-chat (flux, embedding, whisper, ...) (`:456`). Não usa `supportsImageInput`.
- Chave: prefixo `fw_`, mínimo 20 caracteres (`packages/shared/src/providers.ts:170-180`); URL de criação em `packages/frontend/src/services/provider-api-key-urls.ts:8`.
- Preços via models.dev slug `fireworks-ai` (`packages/backend/src/database/models-dev-sync.service.ts:35`) e normalizador removendo `accounts/fireworks/models/` (`packages/backend/src/model-prices/model-name-normalizer.ts:48`).
- Não há preços estáticos, uso do endpoint Messages/Responses, nem leitura de headers de rate limit específicos.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-prices/model-name-normalizer.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | oportunidade | Fireworks aceita `x-session-affinity` e `prompt_cache_isolation_key`; o Thinker só envia `prompt_cache_key` (suficiente segundo a doc). Avaliar header de afinidade apenas se a taxa de cache for baixa (não confirmado que ajude). | providers | — | aberta |
| G2 | oportunidade | Descoberta ignora `supportsImageInput`; modelos com visão não são marcados como tal. Mapear o campo para a capacidade de visão. | providers | — | aberta |
| G3 | degradação (baixa) | `reasoning_effort` derivado de `thinking: disabled` vira `none`, que GPT-OSS e MiniMax M2 rejeitam (400). Aposentadoria do GPT OSS 120B em 2026-11-07 reduz o impacto; MiniMax M2 permanece (não confirmado se ainda serverless). Sem issue: depende de teste com chave real. | providers | — | aberta |
| G4 | informativa | Modelos serverless aposentados em 2026-11-07 desaparecem da listagem; rotas/tiers do usuário que referenciem GPT OSS 120B, Inkling, Nemotron, MiniMax M3 US passarão a falhar com 404. Sem ação de código, só aviso. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (docs oficiais, changelog Aug-Nov 2026). Contrato e lacunas preenchidos; nenhuma issue aberta (sem lacunas de quebra; G3 depende de teste ao vivo).
