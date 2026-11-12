---
id: api-requesty
categoria: api
entidade: Requesty
agente: api-requesty
thinker_ids: [requesty]
revisado_em: 2026-11-12
versao_observada: docs.requesty.ai 2026-11-12 + catálogo ao vivo router.requesty.ai/v1/models 2026-11-12
---

# Requesty (acesso por API)

Especificação mantida pelo agente `api-requesty` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

Roteador compatível com OpenAI em `https://router.requesty.ai/v1` (Chat Completions, Responses e Anthropic Messages), com host UE `https://router.eu.requesty.ai/v1`. Ids `fornecedor/modelo`, nomes sem fornecedor (o Requesty escolhe e faz failover) e `policy/<nome>`. O catálogo `GET /v1/models` é público sem chave (745 modelos de chat em 2026-11-12) e, com chave, mostra só os modelos liberados para ela; traz preços numéricos por token, cache de leitura (`cached_price`) e escrita (`caching_price`), faixas por `prompt_tokens_threshold` e flags `supports_*`. Usage em streaming só com `stream_options.include_usage`; o usage traz `cost` em USD.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://docs.requesty.ai> (`/llms.txt`) | 2026-11-12 |
| Quickstart | <https://docs.requesty.ai/quickstart.md> | 2026-11-12 |
| OpenAPI | <https://docs.requesty.ai/api-reference/openapi.json> | 2026-11-12 |
| Listagem de modelos | <https://docs.requesty.ai/api-reference/endpoint/models-list.md> | 2026-11-12 |
| Streaming, reasoning, auto-caching, EU routing | `/features/streaming.md`, `/features/reasoning.md`, `/features/auto-caching.md`, `/features/eu-routing.md` | 2026-11-12 |
| Catálogo público | <https://router.requesty.ai/v1/models> | 2026-11-12 (745 modelos) |

## Contrato

### Endpoints e protocolos

- Global: `https://router.requesty.ai/v1`. UE (Frankfurt): `https://router.eu.requesty.ai/v1`; o host UE mantém na UE só o processamento do Requesty, e a inferência na UE exige sufixo de região no modelo (ex.: `@eu`). Regiões US e AP citadas sem URL (não confirmado). Fonte: `llms.txt`, `eu-routing.md`.
- Base Anthropic sem `/v1` (`https://router.requesty.ai`); o quickstart mostra `https://router.requesty.ai/anthropic/v1/messages`, em conflito com as outras páginas (não confirmado qual é a canônica).
- Autenticação: `Authorization: Bearer <chave>`; `/v1/messages` e `/v1/responses` aceitam também `x-api-key`. Formato da chave não documentado (exemplo `sk-...`; não confirmado).
- Rotas: `POST /v1/chat/completions`, `POST /v1/messages` (`anthropic-version` opcional, padrão `2023-06-01`), `POST /v1/responses`, além de embeddings, imagens, áudio e `/v1/manage/*`. API de gestão em `https://api-v2.requesty.ai`.
- Cabeçalhos opcionais de origem: `HTTP-Referer`, `X-Title`; qualquer `X-Requesty-*` vira metadado de análise.
- Corpo opcional `"requesty": {"auto_cache": true|false}` liga marcadores de cache para Anthropic; sem ele, o padrão depende do cliente identificado.

### Modelos

- `GET /v1/models`: chave opcional. Sem chave, todos os modelos públicos; com chave, só os aprovados para a organização e a chave; chave inválida dá 403. Só modelos de chat (`api: "chat"`); outros tipos em `/v1/models/embedding`, `/image`, `/transcription`, `/speech`, `/all`.
- Envelope `{"object":"list","data":[...]}`. Campos: `id`, `api`, `owned_by`, `context_window`, `max_output_tokens`, `input_price`, `output_price`, `cached_price` (leitura; 704 modelos), `caching_price` (escrita; 344), `pricing[]` (faixas com `prompt_tokens_threshold` e `caching_5m_price`/`caching_1h_price`), `supports_caching`, `supports_vision`, `supports_reasoning`, `reasoning.supported_efforts`, `supports_tool_calling`, `supports_image_generation`, `supports_output_json_schema`, `retires` (unix em segundos; 70 modelos), `model_lab`, `data_retention`, `geolocation`.
- Divergências OpenAPI × ao vivo: a OpenAPI fala em `supports_json_schema` e `retires_at` (ISO); o ao vivo tem `supports_output_json_schema` e `retires` (unix).
- Ids: nome sem fornecedor (`gpt-6-luna`), `fornecedor/modelo` (39 prefixos, incluindo `vertex`, `bedrock`, `azure`, `coding`), sufixo de região `@eu`, `@eu-central-1` e variante `:flex`. O id vai inteiro.
- 23 modelos com `supports_image_generation: true` (Gemini de imagem) aparecem como chat.

### Capacidades

- Ferramentas, visão e raciocínio pelas flags acima.
- Raciocínio: `reasoning_effort` (`none`, `min`, `low`, `medium`, `high`, `xhigh`, `max` ou orçamento numérico em string; `xhigh` e `max` não valem em `/v1/messages`). Em Anthropic e Vertex vira orçamento (low 1024, medium 8192, high 16384). Saída em `reasoning_content` (Anthropic, DeepSeek), mais `reasoning_signature` no nível superior (delta no stream), que precisa voltar nos turnos seguintes. Tokens de raciocínio cobrados como saída.
- Cache: OpenAI, DeepSeek e Gemini implícitos; Anthropic com `auto_cache`. Repasse do `cache_control` do cliente (não confirmado).

### Streaming e uso

- Sem usage no stream a menos que se mande `stream_options: {"include_usage": true}`; o usage chega num chunk extra com `choices` vazio antes do `[DONE]`.
- Usage Chat (OpenAPI `Usage`): `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`, `prompt_tokens_details.caching_tokens` (escrita de cache), `completion_tokens_details.reasoning_tokens`, `cost` (USD). Responses: `input_tokens_details.cached_tokens`, `output_tokens_details.reasoning_tokens`, `cost`. Messages: só `input_tokens`, `output_tokens` e `cost` documentados.

### Preços

- USD por token (números), não por milhão. `cached_price` = leitura de cache, `caching_price` = escrita (5 min); faixas em `pricing[]` por `prompt_tokens_threshold` (ex.: 272000 em modelos GPT).
- Pré-pago em USD; taxa de 5% na recarga; saldo zero dá 402. Limite mensal de gasto por chave. Taxa no BYOK (não confirmado).

### Limites e erros

| HTTP | Significado | Classe |
|---|---|---|
| 400 | payload ou parâmetro inválido | não retentar |
| 401 | cabeçalho Authorization ausente ou vazio | chave ruim |
| 402 | saldo da organização esgotado | cota |
| 403 | token inválido ou modelo fora da lista de acesso | chave ruim / modelo |
| 404 | fornecedor ou modelo não suportado | modelo |
| 413 | corpo acima de 50 MB | reduzir |
| 429 | limite (vem do upstream; respeitar `Retry-After`) | retentar com espera |
| 500, 502 | erro interno ou resposta inválida do upstream | retentar |

- Corpo de erro: `{"error":{"origin":"router"|"provider","message":"..."}}`.
- O Requesty diz não impor limite de taxa próprio, mas limita requisições simultâneas (página não lida; não confirmado).
- Chaves em <https://app.requesty.ai/api-keys>.

## Como o Thinker implementa hoje

- Cadastro: `packages/shared/src/providers.ts:503` (id `requesty`, sem aliases, sem prefixo, mínimo 10 caracteres).
- Proxy: base `REQUESTY_BASE = https://router.requesty.ai/v1` em `packages/backend/src/routing/proxy/provider-endpoints.ts:227`; endpoint em `:456` com formato `openai`, caminho `/chat/completions`, Bearer e `stream_options.include_usage`. Não envia `HTTP-Referer`, `X-Title` nem `requesty.auto_cache`. O host UE se usa pela URL base editável da conexão.
- Id com barra preservado (`model-prefix.ts:25`); `reasoning_effort` repassado (`provider-client-converters.ts:143`); capacidade `stream` (`model-capabilities.ts:38`).
- Usage: `usage.cost` vira o custo reportado (lido por `readReportedCostUsd` em `stream-writer.ts`); `prompt_tokens_details.caching_tokens` é lido como escrita de cache (`stream-writer.ts:170`).
- Descoberta: `GET {base}/models` com Bearer (`provider-model-fetcher.service.ts:1355`), `parseRequesty` em `:1237`: descarta `api` diferente de `chat`, `supports_image_generation` e modelos com `retires` no passado; lê `context_window`, preços base, cache de leitura e escrita, a menor faixa com `prompt_tokens_threshold > 0` como `longContextPricing`, `supports_tool_calling`, `supports_reasoning` e `supports_vision`.
- Dashboard: tile em `packages/frontend/src/services/providers.ts:616` (inicial `R`, sem logo), link da chave em `services/provider-api-key-urls.ts:27`.
- Testes: `packages/backend/src/model-discovery/provider-model-fetcher.aggregators.spec.ts`, `packages/backend/src/routing/proxy/__tests__/aggregator-endpoints.spec.ts`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/model-prefix.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/stream-writer.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `reasoning_signature` (nível superior da resposta e delta no stream) não é guardado nem devolvido nos turnos seguintes; raciocínio de Claude via Requesty pode perder continuidade. Confirmar com chave real. | `providers` | sem issue (precisa de teste ao vivo) | aberta |
| G2 | oportunidade | `requesty.auto_cache` não é enviado; o cache de Anthropic depende do padrão do Requesty para o cliente. | `providers` | sem issue | aberta |
| G3 | oportunidade | Host UE `https://router.eu.requesty.ai/v1` só pela URL base editável; não há seletor de região. | `frontend-dev` | sem issue | aberta |
| G4 | oportunidade | Rota nativa `POST /v1/messages` não usada para harnesses Anthropic. | `providers` | sem issue | aberta |

## Histórico

- 2026-11-12: primeira revisão completa (docs, OpenAPI e catálogo ao vivo) junto com o cadastro do provedor (issue #132). Registradas G1 a G4.
