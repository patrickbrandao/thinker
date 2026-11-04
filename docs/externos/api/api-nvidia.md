---
id: api-nvidia
categoria: api
entidade: NVIDIA NIM
agente: api-nvidia
thinker_ids: [nvidia]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04
---

# NVIDIA NIM (acesso por API)

Especificação mantida pelo agente `api-nvidia` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

Endpoints hospedados pela NVIDIA (API Catalog, build.nvidia.com) com API compatível com OpenAI em `https://integrate.api.nvidia.com/v1`, chave `nvapi-...` em `Authorization: Bearer` (não confirmado nas páginas lidas). O acesso gratuito é para prototipação, pesquisa e testes, via Developer Program; uso em produção exige NVIDIA AI Enterprise ou self-host. As páginas públicas de referência são pobres em detalhes (sem limites, sem tabela de parâmetros), então boa parte do contrato está marcada como não confirmada e precisa de checagem com chave real. Nenhuma lacuna de quebra ou degradação confirmada.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| NIM API docs (índice de modelos por provedor) | <https://docs.api.nvidia.com/nim/reference/llm-apis> | 2026-11-04 |
| Quickstart | <https://docs.api.nvidia.com/nim/docs/api-quickstart> | 2026-11-04 |
| Visão do produto / termos | <https://docs.api.nvidia.com/nim/docs/product> | 2026-11-04 |
| Model catalog | <https://build.nvidia.com/models> | 2026-11-04 (109 modelos; a página mostra 100) |
| Referência NIM self-hosted (LLM) | <https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html> | 2026-11-04 (só índice de tópicos acessível) |

## Contrato

### Endpoints e protocolos

- Base URL: `https://integrate.api.nvidia.com` (sem regiões); `POST /v1/chat/completions` (docs/reference/llm-apis, 2026-11-04).
- Auth: a chave é obtida na página do modelo ("Get API Key") e colocada no campo de API key do cliente OpenAI; o cabeçalho exato não está escrito nas páginas lidas, mas o padrão é `Authorization: Bearer nvapi-...` (não confirmado).
- Só Chat Completions é documentado. Anthropic Messages e Responses: (não confirmado, provavelmente ausentes).
- Alguns modelos são só container baixável (exigem NVIDIA AI Enterprise) e têm especificação própria para NIM self-hosted; não rodam no endpoint hospedado.

### Modelos

- Listagem: `GET /v1/models` (formato OpenAI, não confirmado sem chave; Thinker usa e deduplica por id). A página de referência agrupa os modelos por organização (`deepseek-ai`, `meta`, `nvidia`, `openai`, `qwen`...).
- Ids contêm `/` (ex.: `meta/llama-3.1-8b-instruct`, usado no quickstart).
- Catálogo amostrado (2026-11-04): `gemma-4-31b-it`, `gpt-oss-20b`, `deepseek-v4.1-flash`, `flux.2-klein-4b` (imagem), `nemotron-3.5-lightning-30b-a3b`, `parakeet-tdt-0.6b-v2` (ASR). O catálogo mistura LLMs com modelos de imagem, voz, retrieval, safety e visão, por isso o filtro de não-chat no Thinker.
- Avisos de descontinuação: nenhum visível na página (a lista completa não foi lida).

### Capacidades

Não há tabela pública de capacidades nas páginas acessíveis. Tool calling, visão, reasoning (campos `nvext`/`reasoning`), saída estruturada e contexto máximo variam por modelo: (não confirmado). Caching de prompt: (não confirmado).

### Streaming e uso

SSE padrão OpenAI esperado; `stream_options.include_usage` (Thinker já envia): (não confirmado). Campos de tokens cacheados/reasoning: (não confirmado).

### Preços

Os endpoints hospedados são descritos como gratuitos para membros do Developer Program, só para protótipo/pesquisa/testes. Não há tabela de preços por token pública nas páginas lidas. Licença AI Enterprise para self-host em produção: a partir de US$ 4.500 por GPU por ano (página do produto, 2026-11-04). Quando o custo é zero ou indefinido, o Thinker depende do models.dev (não confirmado se cobre `nvidia`).

### Limites e erros

Limites de taxa, créditos e códigos de erro não estão nas páginas lidas: (não confirmado). Padrão esperado: 401 chave inválida, 429 limite (retentável), 404 modelo inexistente. Verificar com chave real.

## Como o Thinker implementa hoje

- Base `https://integrate.api.nvidia.com`, formato `openai`, cabeçalhos Bearer, path `/v1/chat/completions` e relato de uso em stream via `openaiStreamUsage` (`packages/backend/src/routing/proxy/provider-endpoints.ts:199`, `:446-452`).
- Descoberta: `https://integrate.api.nvidia.com/v1/models`, Bearer, `parseOpenAIDedupedById` (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:942-946`).
- Filtro de não-chat por regex (flux, cosmos, embed, retriever, tts, safety, guard, reward, vila, neva...) (`provider-model-fetcher.service.ts:458-459`). Não cobre `parakeet`/`asr` (ASR), nem `nemoretriever`-like fora de "retriever": risco menor de modelos não-chat na lista (não confirmado se `/models` os devolve).
- Ids com `/` não são cortados (`packages/backend/src/routing/proxy/provider-client.ts:340-351`).
- Chave: `keyPrefix` vazio, `minKeyLength: 20`, placeholder `nvapi-...`, aliases `nvidia-nim`, `nim` (`packages/shared/src/providers.ts:345-356`). Link para gerar chave: `https://build.nvidia.com/settings/api-keys` (`packages/frontend/src/services/provider-api-key-urls.ts:18`).
- Preço/capacidades via models.dev (`packages/backend/src/database/models-dev-sync.service.ts:41`); streaming habilitado (`model-capabilities.ts:28`). Nenhum preço em `known-model-prices.ts`.
- Nemotron via OpenRouter tem tratamento próprio, sem relação com este endpoint (`provider-client-converters.ts:136-145`, `:437-462`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | oportunidade | Verificar com chave real: cabeçalho de auth, forma do `/models`, limites de taxa, parâmetros rejeitados e uso em stream (docs públicas não cobrem). Sem evidência de quebra | providers | — | aberta |
| G2 | oportunidade | Filtro de não-chat não cobre ASR (`parakeet`, `asr`); incluir se `/models` os listar | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão (docs públicas). As páginas de referência não trazem auth, limites, parâmetros nem preços; contrato majoritariamente "(não confirmado)". Nenhuma issue aberta.
