---
id: api-xai
categoria: api
entidade: xAI
agente: api-xai
thinker_ids: [xai]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04
---

# xAI (acesso por API)

Especificação mantida pelo agente `api-xai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

API em `https://api.x.ai/v1`, chave `xai-...` em `Authorization: Bearer`. A Responses API é o protocolo principal da documentação; Chat Completions é oficialmente "legacy" (sem data de desligamento) e recebe novidades depois. Catálogo atual: `grok-4.7` (recomendado), `grok-4.6`, `grok-4.5`, `grok-4.3`, `grok-4.20-*` e `grok-build-0.1`, com preço em duas faixas (prompt abaixo ou a partir de 200k tokens). Modelos de raciocínio rejeitam `presence_penalty`, `frequency_penalty` e `stop`. Escopo da assinatura (Grok OAuth) fica em `sub-xai`.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://docs.x.ai/docs/overview> | 2026-11-04 |
| Models and pricing | <https://docs.x.ai/docs/models> | 2026-11-04 |
| Chat Completions (legacy) | <https://docs.x.ai/docs/guides/chat-completions> | 2026-11-04 |
| Reasoning | <https://docs.x.ai/docs/guides/reasoning> | 2026-11-04 |
| Rate limits | <https://docs.x.ai/docs/key-information/consumption-and-rate-limits> | 2026-11-04 |
| Release notes | <https://docs.x.ai/docs/release-notes> | 2026-11-04 (notas de 2026) |

## Contrato

### Endpoints e protocolos

- Base URL: `https://api.x.ai/v1`. Regiões e endpoints regionais: não documentados nas páginas lidas (não confirmado; há menção a disponibilidade do Grok 4.5 para usuários da UE no console).
- Auth: `Authorization: Bearer <XAI_API_KEY>`.
- Responses API (`/v1/responses`): protocolo documentado como principal. Há modo WebSocket (maio/2026) e Context Compaction API.
- Chat Completions (`/v1/chat/completions`): "legacy", novidades chegam primeiro à Responses. `grok-4.20-multi-agent-0309` só aceita Responses (Thinker já trata, ver abaixo).
- Anthropic Messages: não mencionado nas páginas lidas (não confirmado).
- Campos novos: `service_tier: "priority"` (junho/2026), `safety_identifier` (setembro/2026; `user` continua valendo), `guidelines` (moderação, outubro/2026), Batch API, Files API.

### Modelos

Listagem: `GET /v1/models` (formato OpenAI; shape detalhado não conferido, não confirmado). Fonte: página de modelos, 2026-11-04.

| Id | Contexto | Observações |
|---|---|---|
| `grok-4.7` | 500k | recomendado; corte de conhecimento maio/2026; devolve `reasoning.encrypted_content` sempre na Responses |
| `grok-4.6` | 500k | |
| `grok-4.5` | 500k | `xhigh` tratado como `high` |
| `grok-4.3` | 1M | |
| `grok-4.20-0309-reasoning` / `-non-reasoning` | 1M | |
| `grok-4.20-multi-agent-0309` | 1M | só Responses |
| `grok-build-0.1` | 256k | acesso antecipado |

Imagem/vídeo/voz (fora do escopo do chat): `grok-imagine-image`, `grok-imagine-image-2.0`, `grok-imagine-video`, `-1.5`, `-1.5-lite`, `grok-voice-3.0` (`grok-voice-2.0` deprecado, `grok-voice-latest` aponta para 3.0). `grok-imagine-image-quality` encerra em 2026-11-02 (já passado). `grok-voice-transcribe-1.0` encerrou em 2026-10-02.

Aliases: `<modelo>` = última versão estável, `<modelo>-latest` = última, `<modelo>-<data>` = fixa. Saída máxima por modelo: não publicada (não confirmado). Nenhuma data de retirada de modelos de chat anunciada nas páginas lidas.

### Capacidades

- Ferramentas server-side: Web Search, X Search (e busca de imagens). Quais modelos: não informado.
- Visão: jpg/jpeg e png, até 20 MiB por imagem, sem limite de quantidade; só alguns modelos (não nomeados).
- Raciocínio: não pode ser desligado. `reasoning_effort`: `low|medium|high` (padrão `high`) e `xhigh` em grok-4.7/4.6; no grok-4.5 `xhigh` vira `high`; no `multi-agent` controla número de agentes (4 ou 16). `presencePenalty`, `frequencyPenalty` e `stop` dão erro em modelos de raciocínio. `logprobs`/`top_logprobs` ignorados em grok-4.20+.
- Saída de raciocínio: resumos no grok-4.7 (`reasoning_content` em stream no SDK xAI; eventos `response.reasoning_text.delta`/`response.reasoning_summary_text.delta` na Responses). Chat Completions não tem campo para conteúdo cifrado; na Responses, reenviar os itens de raciocínio com `encrypted_content` inalterados preserva o raciocínio entre turnos.
- Structured output e prompt caching (semântica, chave): não detalhados nas páginas lidas (não confirmado). Há `prompt_cache_key` aceito na Responses segundo o código do Thinker (origem não reconferida).
- Papéis system/user/assistant em qualquer ordem.

### Streaming e uso

`usage` traz `prompt_tokens`, `completion_tokens`, `total_tokens` e `reasoning_tokens` (cobrado). `cost_in_usd_ticks` no objeto `usage` desde abril/2026. Campos de cached tokens e comportamento de `stream_options.include_usage`: não confirmados nesta revisão.

### Preços

Por 1M tokens (entrada / entrada em cache / saída); a partir de 200k tokens no prompt a requisição inteira usa a faixa longa:

| Modelo | Curta | Longa (>=200k) |
|---|---|---|
| `grok-4.7`, `grok-4.6` | 2,00 / 0,50 / 6,00 | 4,00 / 1,00 / 12,00 |
| `grok-4.5` | 2,00 / 0,30 / 6,00 | 4,00 / 0,60 / 12,00 |
| `grok-4.3`, `grok-4.20-*` | 1,25 / 0,20 / 2,50 | 2,50 / 0,40 / 5,00 |
| `grok-build-0.1` | 1,00 / 0,20 / 2,00 | 2,00 / 0,40 / 4,00 |

Tokens em cache contam no TPM mas têm tarifa reduzida. Imagem: US$0,02 a 0,04 por imagem; vídeo: US$0,02 a 0,08 por segundo.

### Limites e erros

- Limites por modelo e por tier: RPS (derivado de RPM/48, mínimo 2) e TPM; tiers 0 (US$0) a 4 (US$5.000) por gasto acumulado, sem rebaixamento; Enterprise sob consulta.
- Todos os tokens (prompt, imagem, áudio, completion, raciocínio, cache) contam no TPM.
- 429 = limite excedido; retentável com backoff exponencial. Códigos 401/403 e cabeçalhos de limite: não documentados nas páginas lidas (não confirmado).

## Como o Thinker implementa hoje

- Provider `xai`, prefixo de chave `xai-`, tamanho mínimo 50, aliases OpenRouter `xai` e `x-ai` (`packages/shared/src/providers.ts:468-478`).
- Endpoint `xai`: `https://api.x.ai`, formato `openai`, Bearer, `/v1/chat/completions`, `stream_options` de uso OpenAI (`packages/backend/src/routing/proxy/provider-endpoints.ts:385-391`).
- Endpoint `xai-responses`: mesma base, `/v1/responses`, formato `chatgpt` (`provider-endpoints.ts:392-397`). Usado quando `apiMode === 'responses'` ou quando o modelo casa `^grok-.*multi-agent(-|$)` (`provider-client.ts:612-622`, `packages/backend/src/common/constants/xai-models.ts:7`). Envia `stream` conforme o cliente, mapeia `max_output_tokens`, repassa `prompt_cache_key` (hash) e não mapeia `reasoning` (`provider-client.ts:840-870`; `mapReasoningEffort` só vale para OpenAI).
- `reasoning_effort` é mantido no Chat Completions do xAI (`provider-client-converters.ts:468-476`). `service_tier` e `metadata` são removidos (`OPENAI_ONLY_FIELDS`, `provider-client-converters.ts:121`); `presence_penalty`, `frequency_penalty` e `stop` passam intactos.
- Cabeçalho `x-grok-conv-id` com a chave de sessão (`packages/backend/src/routing/proxy/provider-hooks.ts:64`).
- Descoberta: `https://api.x.ai/v1/models`, `parseOpenAI`, filtro de não-chat `/imagine/i` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:947-951`, `:463`). Modelos de voz (`grok-voice`) não são filtrados (não confirmado se `/v1/models` os lista). Contexto e preço não vêm do `/models`; vêm dos catálogos sincronizados (`models-dev-sync.service.ts`); não há tabela fixa de preços xAI em `known-model-prices.ts`. Inferência de provider por `^grok-` (`packages/shared/src/provider-inference.ts:13`).
- Prefixo de chave e URLs de criação de chave: `packages/frontend/src/services/provider-api-key-urls.ts`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/common/constants/xai-models.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`

Código da assinatura (OAuth), tratado em `sub-xai`: `packages/backend/src/routing/oauth/xai/`, `packages/backend/src/routing/proxy/oauth-credentials.ts`.

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `presence_penalty`, `frequency_penalty` e `stop` são repassados e a doc diz que modelos de raciocínio retornam erro; remover para `grok-*` de raciocínio em `xai` e `xai-responses` (`provider-client-converters.ts`) | providers | [#433](https://github.com/patrickbrandao/thinker/issues/433) | resolvida (política de parâmetros: param-policy.ts) |
| G2 | degradação | `xai-responses` não mapeia `reasoning.effort` (`mapReasoningEffort` só OpenAI, `provider-client.ts:864`); o esforço do cliente se perde em modelos usados via Responses/multi-agent (formato do campo na Responses do xAI não confirmado) | providers | — (não aberta: depende de confirmar o formato) | aberta |
| G3 | oportunidade | Preço em faixa longa (prompt >= 200k) e `cost_in_usd_ticks` em `usage` não são aproveitados; custo calculado com tarifa curta subestima pedidos longos | backend-dev | — | aberta |
| G4 | oportunidade | `service_tier: "priority"`, `safety_identifier` e itens `reasoning.encrypted_content` (grok-4.7 devolve sempre) não são encaminhados/preservados | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Fontes: docs.x.ai (models, chat-completions, reasoning, rate limits, release notes). Catálogo grok-4.3 a 4.7, build-0.1; Chat Completions "legacy"; modelos de raciocínio rejeitam `stop`/penalidades (G1, issue #433). Lacunas G2 a G4 registradas. Páginas de referência da API (`/v1/models`, cabeçalhos de limite, 401/403) não foram lidas.
