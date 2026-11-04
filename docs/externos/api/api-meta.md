---
id: api-meta
categoria: api
entidade: Meta (Muse Spark)
agente: api-meta
thinker_ids: [meta]
revisado_em: 2026-11-04
versao_observada: docs dev.meta.ai 2026-11-04 (muse-spark-1.3, muse-wonder-1.0 preview)
---

# Meta (Muse Spark) (acesso por API)

Especificação mantida pelo agente `api-meta` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- A "Model API" da Meta fica em `https://api.meta.ai/v1`, com auth Bearer, e fala Responses, Chat Completions e Anthropic Messages. O portal e as docs migraram para `dev.meta.ai`; `llama.developer.meta.com` redireciona (302) para lá e `developers.meta.ai` não resolve (DNS).
- Modelos de chat: `muse-wonder-1.0` (preview), `muse-spark-1.3/1.2/1.1` e as variantes `-contributor` (1.3 e 1.2), todos com contexto de 1.048.576 tokens.
- A variante `-contributor` é muito mais barata, mas exige consentimento para treinar modelos futuros da Meta.
- O Thinker conhece só 1.2, 1.2-contributor e 1.1, e não tem preços (G1, G2).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Visão geral | <https://dev.meta.ai/docs/overview.md> | 2026-11-04 |
| Modelos | <https://dev.meta.ai/docs/models.md> | 2026-11-04 |
| Preços e limites | <https://dev.meta.ai/docs/pricing-rate-limits.md> | 2026-11-04 |
| Protocolos / Chat Completions | <https://dev.meta.ai/docs/protocols/chat-completions.md> | 2026-11-04 |
| Quickstart | <https://dev.meta.ai/docs/quickstart.md> | 2026-11-04 |
| Referência da API (não lida) | <https://dev.meta.ai/docs/api-reference> | — |
| Guia Messages (não lido) | <https://dev.meta.ai/docs/protocols/messages> | — |
| `developers.meta.ai` | substituído; DNS não resolve | removida |
| `llama.developer.meta.com/docs/overview` | redireciona para `dev.meta.ai/docs/overview.md` | 2026-11-04 |

Não há SDK oficial lido; a API é compatível com os SDKs OpenAI e Anthropic.

## Contrato

### Endpoints e protocolos

- Base URL: `https://api.meta.ai/v1` (sem regiões documentadas). Auth: `Authorization: Bearer <chave>`; a doc usa a variável `MODEL_API_KEY`.
- `POST /v1/chat/completions` (OpenAI), `POST /v1/messages` (Anthropic; o SDK Anthropic usa host `https://api.meta.ai`), `POST /v1/responses` (agentic, estado no servidor).
- Outros: `POST /v1/images/generations` e `/v1/images/edits` (`muse-image-1.0`), `POST /v1/files`, `POST /v1/asr/transcribe` e `wss://api.meta.ai/v1/asr/realtime` (`muse-voice-transcribe-1.0`), `sam-3.1` via Responses.
- Chave: criada no painel <https://dev.meta.ai/> em API keys. Formato/prefixo não documentado (o prefixo `LLM_` do Thinker não é confirmado).
- Busca com grounding e tool search só em Responses e Messages; function tools completas em Chat Completions.

### Modelos

- Listagem: `GET https://api.meta.ai/v1/models` retorna os modelos habilitados para o time, com `created`; sem contexto nem deprecação.
- Ids de chat: `muse-wonder-1.0` (preview, padrão), `muse-spark-1.3`, `muse-spark-1.2`, `muse-spark-1.1`, `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor`. Wonder não tem versão contributor no pay-as-you-go.
- Não chat: `muse-image-1.0`, `muse-voice-transcribe-1.0`, `sam-3.1`. Open-weight (Muse Spark Open, Muse Glimmer) não são servidos pela API.
- Aposentadorias anunciadas: nenhuma encontrada.

### Capacidades

- Contexto 1.048.576 tokens para Wonder e Spark; máximo de saída não documentado.
- Entrada: texto, imagem, vídeo, áudio, PDF; saída texto. Áudio no Spark 1.3 não é totalmente suportado.
- Raciocínio sempre ligado no Spark (`reasoning_effort: none` retorna 400). Valores em Chat Completions: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. Níveis até "max" no Wonder e no Spark 1.3; o contributor 1.3 não tem "max".
- Chat Completions não carrega raciocínio entre turnos para chaves externas; Messages faz replay de `thinking` (stateless); Responses mantém estado.
- Tools paralelas e em streaming, saída estruturada (`response_format` em Chat Completions), prompt caching (`prompt_cache_key`, `prompt_cache_retention` = `in_memory` ou `24h` como dica), contagem de tokens.
- Parâmetros aceitos (Chat Completions): `model`, `messages`, `temperature`, `top_p` (>0), `max_completion_tokens` (`max_tokens` obsoleto mas aceito), `stream`, `reasoning_effort`, `n` (só 1), `safety_identifier`, `prompt_cache_key`, `prompt_cache_retention`, `seed` e `user` (obsoletos).
- Retornam 400: `stop`, `n>1`, `verbosity`, `logit_bias`, `prediction`, `web_search_options`, `modalities`, `audio`, `logprobs: true`, `text.format`, `max_output_tokens`, `top_p: 0`. `frequency_penalty` e `presence_penalty` não surtem efeito e podem causar erro.

### Streaming e uso

- SSE com `delta` e `finish_reason` final; streaming escapa do limite de tempo que causa 504 em não-streaming.
- Campos de uso documentados: `prompt_tokens`, `completion_tokens`, `total_tokens`. Tokens em cache/raciocínio e uso em stream (`stream_options.include_usage`) não documentados (não confirmado).

### Preços

Por 1M tokens (<https://dev.meta.ai/docs/pricing-rate-limits>, 2026-11-04):

| Modelo | Entrada | Entrada em cache | Saída |
|---|---|---|---|
| `muse-wonder-1.0` | 4,00 | 0,20 | 20,00 |
| `muse-spark-1.3` / `1.2` / `1.1` | 1,25 | 0,15 | 4,25 |
| `muse-spark-1.3-contributor` / `1.2-contributor` | 0,10 | 0,002 | 0,20 |

Extras: grounding de busca US$ 2,50 por 1.000 consultas; imagem US$ 0,01 cada; transcrição US$ 0,18/hora; SAM 3.1 US$ 2,50/1.000 imagens e US$ 0,20/1.000 frames. Modo contributor exige permissão para treinar modelos futuros da Meta. Sem camada gratuita ou de contexto longo documentada.

### Limites e erros

- Por time (não por chave): Wonder e Spark padrão 3.000 RPM / 4.000.000 TPM; contributor 150 RPM / 3.000.000 TPM; imagem 150 RPM.
- 429 = limite excedido (retentável com backoff; respeitar `Retry-After`). Headers `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`.
- 400 para parâmetros não suportados; 504 em não-streaming longo. Códigos de chave inválida/modelo não habilitado não documentados (não confirmado).

## Como o Thinker implementa hoje

- Base URL `https://api.meta.ai` (`packages/backend/src/routing/proxy/provider-endpoints.ts:203`), formato `openai`, caminho `/v1/chat/completions` (`provider-endpoints.ts:96`, `:405-411`), header Bearer, `stream_options` de uso OpenAI.
- Listagem via `https://api.meta.ai/v1/models` (`provider-model-fetcher.service.ts:73`, `:957-961`), filtrada por `META_MODEL_API_MODEL_BY_ID` (`:374-380`); contexto fixo 1.048.576, raciocínio e código ligados, entradas texto/imagem/áudio/vídeo.
- Modelos fixos: `muse-spark-1.2`, `muse-spark-1.2-contributor` (nome avisa que treina a Meta), `muse-spark-1.1` (`packages/shared/src/providers.ts:57-66`); mesma lista no fallback (`model-fallback.ts:72`, `:255-275`).
- Registro do provedor: id `meta`, prefixo de chave `LLM_`, mínimo 20 caracteres (`providers.ts:285-296`); link da chave `https://dev.meta.ai/` (`packages/frontend/src/services/provider-api-key-urls.ts:14`).
- Sem preços Meta em `known-model-prices.ts`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/routing/proxy/proxy-friendly-response.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Faltam `muse-spark-1.3`, `muse-spark-1.3-contributor` e `muse-wonder-1.0`; o filtro fixo esconde modelos novos de `/v1/models`. | providers | [#406](https://github.com/patrickbrandao/thinker/issues/406) | aberta |
| G2 | degradação | Sem preços dos modelos Muse (tabela acima), custo fica sem valor. | providers | [#407](https://github.com/patrickbrandao/thinker/issues/407) | aberta |
| G3 | oportunidade | Parâmetros que dão 400 (`stop`, `n>1`, `logit_bias`, `reasoning_effort: none` etc.): Thinker não os remove; pode quebrar clientes. Verificar com chave real. | backend-dev | — | aberta |
| G4 | oportunidade | Usar `/v1/messages` ou `/v1/responses` para preservar raciocínio entre turnos (Chat Completions não preserva). | providers | — | aberta |
| G5 | oportunidade | Prefixo de chave `LLM_` não confirmado pela doc (não confirmado); pode rejeitar chaves válidas. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Fontes migradas para `dev.meta.ai`; levantados modelos 1.3 e Wonder, preços, limites, parâmetros; G1 a G5 registradas.
