---
id: api-groq
categoria: api
entidade: Groq
agente: api-groq
thinker_ids: [groq]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04
---

# Groq (acesso por API)

Especificação mantida pelo agente `api-groq` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

API compatível com OpenAI (Chat Completions e Responses) em `https://api.groq.com/openai/v1`, chave `gsk_...` em `Authorization: Bearer`. O catálogo está em plena rotação: os dois Llama de produção (`llama-3.1-8b-instant`, `llama-3.3-70b-versatile`) tinham desligamento em 2026-08-16 e `groq/compound*` em 2026-09-21 (já passados nesta revisão). Três lacunas de degradação abertas (parâmetros rejeitados, contexto do `/models`, preços).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://console.groq.com/docs/overview> | 2026-11-04 |
| Compatibilidade OpenAI | <https://console.groq.com/docs/openai> | 2026-11-04 |
| Models | <https://console.groq.com/docs/models> | 2026-11-04 |
| Deprecations | <https://console.groq.com/docs/deprecations> | 2026-11-04 |
| Rate limits | <https://console.groq.com/docs/rate-limits> | 2026-11-04 |
| Pricing | <https://groq.com/pricing> | 2026-11-04 (página sem valores; preços vêm da página de modelos) |

## Contrato

### Endpoints e protocolos

- Base URL: `https://api.groq.com/openai/v1` (única; sem regiões). Auth: `Authorization: Bearer gsk_...`.
- Chat Completions (`/chat/completions`) e Responses API (texto e imagem, conversa com estado, function calling) (docs/openai).
- Áudio: transcrição/tradução (formatos `vtt` e `srt` não suportados), TTS (Orpheus). Whisper aceita arquivos até 100 MB.
- Parâmetros que dão 400: `logprobs`, `logit_bias`, `top_logprobs`, `messages[].name`, `n` diferente de 1. `temperature: 0` vira `1e-8`.

### Modelos

`GET /openai/v1/models` (formato OpenAI; pode trazer `input_modalities`/`output_modalities`; campos de contexto não confirmados, sem chave).

Produção (página de modelos, 2026-11-04):

| Id | Contexto | Saída máx. | Preço por 1M |
|---|---|---|---|
| `llama-3.1-8b-instant` | 131072 | 131072 | "contact sales" |
| `llama-3.3-70b-versatile` | 131072 | 32768 | "contact sales" |
| `openai/gpt-oss-120b` | 131072 | 65536 | US$0,15 in / US$0,60 out |
| `openai/gpt-oss-20b` | 131072 | 65536 | US$0,075 in / US$0,30 out |
| `whisper-large-v3` / `-turbo` | n/a | n/a | US$0,111 / US$0,04 por hora |

Preview: `qwen/qwen3.8-27b` (131072/16384; US$0,80/US$4,00), `openai/gpt-oss-safeguard-20b` (131072/65536; US$0,075/US$0,30), `minimaxai/minimax-m2.7` (196608/131072), `meta-models/muse-spark-open` (131072/131072), `meta-llama/llama-prompt-guard-2-22m|86m` (512), `canopylabs/orpheus-v1-english` e `-arabic-saudi` (TTS, por caractere).

Desligamentos (página de deprecations): `groq/compound` e `groq/compound-mini` 2026-09-21; `qwen/qwen3.6-27b` 2026-09-14 (-> `qwen/qwen3.8-27b`); `llama-3.1-8b-instant` e `llama-3.3-70b-versatile` 2026-08-16 (-> `openai/gpt-oss-20b` / `-120b`); `qwen/qwen3-32b` e `meta-llama/llama-4-scout-17b-16e-instruct` 2026-07-17; `moonshotai/kimi-k2-instruct-0905` 2026-04-15; Llama 4 Maverick 2026-03-09; `meta-llama/llama-guard-4-12b` 2026-03-05. A página ainda lista os dois Llama em produção após a data; tratar como (não confirmado) se continuam servindo.

### Capacidades

A página de modelos não lista capacidades por modelo. GPT-OSS: raciocínio, busca no navegador e execução de código (ferramentas do Groq). Visão: o Qwen 3.8 tem limite de 20 MB por arquivo (sugere entrada de imagem, não confirmado). Prompt caching automático: tokens em cache não contam nos limites de taxa; desconto de preço sem valores públicos (não confirmado).

### Streaming e uso

Streaming SSE padrão OpenAI. Uso em stream via `stream_options.include_usage` (Thinker já envia). Campos de cached/reasoning tokens: (não confirmado).

### Preços

Tabela acima. Developer plan libera Batch e Flex com desconto (valores não publicados na página). Modelos "contact sales" não têm preço público.

### Limites e erros

- Limites por organização: RPM/RPD, TPM/TPD, ASH/ASD, ITPM/OTPM; vale o primeiro atingido.
- Cabeçalhos: `x-ratelimit-limit-requests|remaining-requests` (por dia), `x-ratelimit-limit-tokens|remaining-tokens` (por minuto), `x-ratelimit-reset-requests|tokens`, `retry-after` (só em 429).
- 429 = limite excedido, retentável após `retry-after`; 400 para parâmetro não suportado; 401 chave inválida (não confirmado, padrão).

## Como o Thinker implementa hoje

- Base `https://api.groq.com/openai`, formato `openai`, cabeçalhos Bearer, `streamUsageReporting: 'openai_stream_options'` (`packages/backend/src/routing/proxy/provider-endpoints.ts:350-356`).
- Descoberta: `https://api.groq.com/openai/v1/models`, `parseOpenAI` (lê só `id` e modalidades) (`provider-model-fetcher.service.ts:897-901`, `:150-157`).
- Filtro de não-chat: `compound`, `prompt-guard`, `orpheus` (`provider-model-fetcher.service.ts:445-455`). Whisper não é filtrado (não confirmado se `/models` o lista).
- Ids com `/` não são cortados (`provider-client.ts:340-347`).
- Chave: prefixo `gsk_`, mínimo 50 caracteres, `openRouterPrefixes: []` (`packages/shared/src/providers.ts:182-198`). Preço via models.dev (`models-dev-sync.service.ts:45`); nenhum preço fixo em `known-model-prices.ts`.
- Endpoint de streaming habilitado em `model-capabilities.ts:21`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/pages/Welcome.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `logprobs`, `top_logprobs`, `logit_bias`, `n>1`, `messages[].name` seguem no pedido e dão 400 | providers | [#413](https://github.com/patrickbrandao/thinker/issues/413) | resolvida (política de parâmetros: param-policy.ts) |
| G2 | degradação | contexto e saída máxima do `/models` não são lidos | providers | [#414](https://github.com/patrickbrandao/thinker/issues/414) | resolvida (contexto lido da descoberta) |
| G3 | degradação | sem preços Groq em `known-model-prices.ts`; custo depende do models.dev | providers | [#415](https://github.com/patrickbrandao/thinker/issues/415) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (docs Groq); contrato preenchido; lacunas G1-G3 abertas (#413-#415). Sem chave real: forma do `/models` e códigos de erro além do 429 não confirmados.
