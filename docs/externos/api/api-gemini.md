---
id: api-gemini
categoria: api
entidade: Google Gemini API
agente: api-gemini
thinker_ids: [gemini, google]
revisado_em: 2026-11-04
versao_observada: docs aistudio.google.com 2026-11-04 (changelog até 2026-11-02; llms-full.txt)
---

# Google Gemini API (acesso por API)

Especificação mantida pelo agente `api-gemini` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- A documentação saiu de `ai.google.dev/gemini-api/docs` (301) para `aistudio.google.com/docs`. O guia novo gira em torno da **Interactions API** (`/v1beta/interactions`); `generateContent` continua válido e é o que o Thinker usa, mas os guias de thinking e assinaturas agora só descrevem a Interactions API. O contrato de `generateContent` abaixo vem da referência da API (`api-reference/generate-content`) e dos guias de migração.
- Linha de modelos em 2026-11-04: `gemini-4-argon` (GA 2026-10-13), `gemini-3.8-flash` (GA 2026-09-02), `gemini-3.6-flash` e `gemini-3.5-flash-lite` (GA 2026-07-21), `gemini-3.1-flash-lite`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`. `gemini-2.5-pro` e `gemini-2.5-flash` estão depreciados e **a partir de 2026-12-01 passam a ser roteados** para `gemini-3.8-flash` e `gemini-3.5-flash-lite`, cobrados pelo preço do destino.
- Mudanças que importam a um gateway: `temperature`/`top_p`/`top_k` ignorados do 3.6 em diante (400 anunciado), prefill de turno `model` dá 400, `thinking_level` substitui `thinking_budget`, `FunctionResponse` exige `id` e `name` casando com a chamada, `store` ligado por padrão em projetos pagos novos.
- O Thinker funciona no caminho básico (chave por `x-goog-api-key`, stream por `streamGenerateContent?alt=sse`, assinaturas de `functionCall` em cache), mas tem 9 lacunas abertas (G1 a G9), a maioria de degradação; G5 é `quebra` para conversas com prefill.
- Confiança: alta para endpoints, preços, depreciações e parâmetros removidos (docs oficiais lidos em 2026-11-04); média para validação de `thought_signature` no `generateContent` (os docs novos não detalham; precisa de chave real) e para erros em `generateContent` (a página de erros descreve códigos em `snake_case` da Interactions API).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Gemini API docs (raiz; índice `llms.txt`, texto completo `llms-full.txt`) | <https://aistudio.google.com/docs> (antes `ai.google.dev/gemini-api/docs`, 301) | 2026-11-04 |
| Modelos | <https://aistudio.google.com/docs/models> | 2026-11-04 |
| OpenAI compatibility | <https://aistudio.google.com/docs/openai> | 2026-11-04 |
| Preços | <https://aistudio.google.com/docs/pricing> (`.md` para texto) | 2026-11-04 |
| Changelog | <https://aistudio.google.com/docs/changelog> | entrada mais nova 2026-11-02 |
| Depreciações | <https://aistudio.google.com/docs/deprecations> | 2026-11-04 |
| Referência generateContent | <https://aistudio.google.com/api-reference/generate-content/generate-content.md> | 2026-11-04 |
| Referência models.list | <https://aistudio.google.com/api-reference/models/list-models.md> | 2026-11-04 |
| Limites de taxa | <https://aistudio.google.com/docs/rate-limits> | 2026-11-04 |
| Erros e troubleshooting | <https://aistudio.google.com/docs/api-errors>, <https://aistudio.google.com/docs/troubleshooting> | 2026-11-04 |
| Guias de migração por modelo | `docs/whats-new-gemini-3.5`, `-3.6`, `-3.8`, `docs/latest-model` (Argon) | 2026-11-04 |

## Contrato

### Endpoints e protocolos

- Base: `https://generativelanguage.googleapis.com`. Sem regiões; a escolha de região é do Vertex (agente `api-vertex`).
- Autenticação: cabeçalho `x-goog-api-key: <chave>` (os exemplos de REST dos guias novos usam esse cabeçalho). A listagem de modelos documenta `?key=` na URL. Chaves de AI Studio começam com `AIza` (não confirmado nos docs novos).
- Protocolos:

| Protocolo | Caminho | Observação |
|---|---|---|
| Nativo `generateContent` | `POST /v1beta/models/{model}:generateContent` | legado, mantido; usado pelo Thinker |
| Nativo stream | `POST /v1beta/models/{model}:streamGenerateContent?alt=sse` | só este stream de forma incremental (`:generateContent?alt=sse` devolve um evento só, ver `provider-endpoints.ts:497-498`) |
| Interactions API | `POST /v1beta/interactions` | API principal dos guias novos (`input`, `steps`, `previous_interaction_id`, `store`); fora do Thinker |
| OpenAI-compat | `https://generativelanguage.googleapis.com/v1beta/openai/` + `Authorization: Bearer <chave>` | chat, embeddings, imagens, batch, `service_tier`, listagem/retrieve de modelos; extras em `extra_body.google` (`thinking_config`, `cached_content`) |
| Lista de modelos | `GET /v1beta/models` | ver abaixo |

- Em 2026-10-26, projetos pagos novos passam a guardar requisições de `generateContent`/`streamGenerateContent`/`batchGenerateContent` (`store=true`); opt-out por requisição com `store: false` ou nas configurações de Logs e Datasets. Projetos existentes mantêm a configuração.
- Agentes (`deep-research-*`, `antigravity-preview-09-2026`) só existem na Interactions API.

### Modelos

Lista: `GET /v1beta/models` devolve `models[]` e `nextPageToken`. `pageSize` padrão 50, máximo 1000. Campos do recurso: `name` (`models/{id}`), `baseModelId`, `version`, `displayName`, `description`, `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods` (`generateContent` etc.), `thinking` (booleano), `temperature`, `maxTemperature`, `topP`, `topK`. Para recuperar um modelo: `GET /v1beta/models/{id}`.

Convenção de ids: estável (`gemini-3.6-flash`), preview (`gemini-3.1-pro-preview`, aviso de 2 semanas para sair), `-latest` (alias que muda sem tocar no id, aviso de 2 semanas; existem `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`; o alvo atual não está publicado, não confirmado).

Modelos de texto/chat (docs de 2026-11-04):

| Modelo | Estado | Contexto / saída | Thinking | Notas |
|---|---|---|---|---|
| `gemini-4-argon` | GA 2026-10-13 | 1M de contexto único; saída 65K (até 1M em execução de fundo/long decode) | low, medium (padrão), high | sem nível de preço grátis; sem cache explícito (só implícito, mín. 4.096 tokens); `max_output_tokens` conta raciocínio |
| `gemini-3.8-flash` | GA 2026-09-02 | 1M / 64K | low, medium (padrão), high; `minimal` dá erro | |
| `gemini-3.7-flash` | indisponível; endpoint roteia para `gemini-3.8-flash` (desde 2026-10-08) | | | |
| `gemini-3.6-flash` | GA 2026-07-21 | 1M | minimal, low, medium (padrão), high | |
| `gemini-3.5-flash` | indisponível; roteia para `gemini-3.6-flash` | | | |
| `gemini-3.5-flash-lite` | GA 2026-07-21 | | minimal (padrão), low, medium, high | |
| `gemini-3.1-flash-lite` | GA 2026-05-07 | | | desligamento 2027-05-07, substituto `gemini-3.5-flash-lite` |
| `gemini-3.1-pro-preview` | preview | >200k tem preço maior | low, medium, high (padrão) | substituiu `gemini-3-pro-preview` (desligado 2026-03-09) |
| `gemini-3-flash-preview` | preview | | minimal a high (padrão high) | substituto indicado: `gemini-3.6-flash` |
| `gemini-2.5-pro` | depreciado | | | roteado para `gemini-3.8-flash` em 2026-12-01 |
| `gemini-2.5-flash` | depreciado | | | roteado para `gemini-3.5-flash-lite` em 2026-12-01 |
| `gemini-2.5-flash-lite` | não depreciado, sem data | | | acesso aos 2.5 limitado a quem já os usava (desde 2026-09-18) |
| `gemma-4-31b-it`, `gemma-4-26b-a4b-it` | disponíveis (2026-04-02) | | | Gemma 3 `gemma-3-1b-it` é grátis no AI Studio |

Desligados: `gemini-2.0-flash(-001)`, `gemini-2.0-flash-lite(-001)` (2026-06-01), `gemini-3.1-flash-lite-preview` (2026-05-25), `gemini-3-pro-preview` (2026-03-09), `gemini-2.5-flash-lite-preview-09-2025` (2026-03-31), `gemini-2.5-computer-use-preview-10-2025` (2026-07-28). Não-chat (lidos por `generateContent` mas fora do uso de chat): `*-image` (`gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-3.1-flash-lite-image`, `gemini-nano-banana-2.1`), `gemini-omni-1.1-flash` (vídeo), `*-tts`, `gemini-3.5-transcribe(-live)`, `*-live*` (só Live API), embeddings (`gemini-embedding-2`, `gemini-embedding-001`), `lyria-*`, `gemini-robotics-er-*`. Fonte: <https://aistudio.google.com/docs/deprecations.md>.

### Capacidades

- **Thinking.** Config no `generationConfig.thinkingConfig`: `thinkingLevel` (`MINIMAL|LOW|MEDIUM|HIGH|THINKING_LEVEL_UNSPECIFIED`, recomendado do Gemini 3 em diante, erro em modelos anteriores), `thinkingBudget` (inteiro, recomendado só para o 2.5, "não recomendado" no 3.x), `includeThoughts` (devolve resumos como partes com `thought: true`). Usar `thinkingLevel` e `thinkingBudget` juntos dá 400. O raciocínio não pode ser desligado no Gemini 3 e no 2.5 Pro; `reasoning_effort: "none"` só desliga o 2.5 Flash/Flash-Lite. Tokens de raciocínio contam em `maxOutputTokens` e são cobrados como saída. Budgets da camada OpenAI-compat no 2.5: minimal e low = 1.024, medium = 8.192, high = 24.576. Nenhum guia atual lista a faixa de `thinkingBudget` por modelo 2.5 (não confirmado; o valor `-1` dinâmico e `0` desligado vêm de conhecimento anterior, não relidos).
- **Assinaturas de pensamento (`thoughtSignature`).** No `generateContent` não há blocos de raciocínio dedicados: a assinatura é metadado em qualquer Part (`functionCall` ou a última parte da resposta; campo `thoughtSignature` no nível da Part, irmão de `functionCall`). Do Gemini 3.5 Flash em diante o modelo reaproveita o raciocínio dos turnos anteriores quando o histórico completo e inalterado, com assinaturas, volta em `contents`. O aviso de 2026-11-02 lista "validação de `thought_signature` e de function calling" entre as mudanças que os ids 2.5 roteados herdam em 2026-12-01; os docs lidos não detalham a regra (nem o valor fictício que o Thinker usa, `context_engineering_is_the_way_to_go`), então a aceitação do fictício no 3.8/Argon é **(não confirmado)**. `finishReason` `MISSING_THOUGHT_SIGNATURE` existe ("a requisição tem ao menos uma assinatura faltando").
- **Function calling.** `functionDeclarations` em `tools`, `toolConfig.functionCallingConfig` (`AUTO|ANY|NONE`, `allowedFunctionNames`). Nos modelos 3.x/4: `id`, `name` e a quantidade de `functionResponse` devem casar com as chamadas anteriores; conteúdo multimodal vai dentro da resposta da função; instruções inline vão no texto da resposta, não em partes separadas. `MALFORMED_FUNCTION_CALL` pode ocorrer com texto antes da chamada ("pre-tool text"). Ferramentas nativas combinam com function calling na mesma chamada (desde 2026-03-18). Computer Use GA em 2026-10-30.
- **Esquema.** `responseMimeType` (`text/plain`, `application/json`, `text/x.enum`), `responseJsonSchema` (preferido) / `responseSchema`. Campos JSON Schema não suportados precisam ser removidos (o Thinker já remove).
- **Parâmetros removidos.** `temperature`, `topP`, `topK`: ignorados em silêncio do 3.6 Flash em diante (com cabeçalhos de aviso; 400 anunciado para versão futura, sem data). Nos Gemini 3 anteriores devem ficar no padrão. `candidateCount` não existe no 3 e no 4. **Prefill:** `contents` terminando em turno `model` não vazio dá 400 nos modelos 3.6+.
- **Cache.** Implícito, ligado por padrão para 2.5 e posteriores, mínimo de 4.096 tokens (Argon, 3.8, 3.6, 3.1 Pro) ou 2.048 (2.5); desconto repassado automaticamente. Explícito (`cachedContents`) fica fora do Argon e da Interactions API; na OpenAI-compat vai por `extra_body.google.cached_content`.
- **Visão/áudio/vídeo.** Imagens inline (`inlineData`) ou `fileData`; entrada de áudio e vídeo nos modelos multimodais. `serviceTier` (`standard|flex|priority`) no corpo; `store` (booleano) no corpo.

### Streaming e uso

- `streamGenerateContent?alt=sse` emite um objeto `GenerateContentResponse` por evento; `usageMetadata` é cumulativo e se repete (o Thinker usa o último). Cada `functionCall` costuma vir em evento próprio.
- Campos de uso: `promptTokenCount` (inclui o cache), `cachedContentTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount` (raciocínio, fora de `candidatesTokenCount`), `toolUsePromptTokenCount`, `totalTokenCount`; `serviceTier` também é devolvido. Cobrança: saída = `candidatesTokenCount` + `thoughtsTokenCount`. No Argon, tokens de instruções internas e declarações de função usados em grounding também são cobrados.
- `finishReason`: `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `LANGUAGE`, `OTHER`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`, `IMAGE_*`, `NO_IMAGE`, `UNEXPECTED_TOOL_CALL`, `TOO_MANY_TOOL_CALLS`, `MISSING_THOUGHT_SIGNATURE`, `MALFORMED_RESPONSE`, `ESCALATION`, `PUP_LIMITED_DISABLED`, `CONTINUATION` (limite por requisição; continua com `continuation_token`). Prompt bloqueado chega sem candidatos e com `promptFeedback.blockReason`.

### Preços

USD por 1M de tokens, nível pago padrão (<https://aistudio.google.com/docs/pricing.md>, 2026-11-04). Saída inclui raciocínio.

| Modelo | Grátis | Entrada | Saída | Cache (leitura) |
|---|---|---|---|---|
| `gemini-4-argon` | não | 2,00 até 2026-11-30, depois 4,00 | 10,00 -> 20,00 | 0,10 -> 0,20 (só implícito) |
| `gemini-3.8-flash` / `gemini-3.6-flash` | sim | 0,75 até 2026-12-31, depois 1,50 (2027-01-01) | 3,75 -> 7,50 | 0,075 -> 0,15 |
| `gemini-3.5-flash-lite` | sim | 0,30 | 2,50 | 0,03 |
| `gemini-3.1-flash-lite` | sim | 0,25 (áudio 0,50) | 1,50 | 0,025 |
| `gemini-3.1-pro-preview` | não | 2,00 (<=200k) / 4,00 (>200k) | 12,00 / 18,00 | 0,20 / 0,40 |
| `gemini-3-flash-preview` | sim | 0,50 (áudio 1,00) | 3,00 | 0,05 |
| `gemini-2.5-pro` | sim | 1,25 (<=200k) / 2,50 (>200k) | 10,00 / 15,00 | 0,125 / 0,25 |
| `gemini-2.5-flash` | sim | 0,30 (áudio 1,00) | 2,50 | 0,03 |
| `gemini-2.5-flash-lite` | sim | 0,10 (áudio 0,30) | 0,40 | 0,01 |

- Batch e Flex custam cerca de metade; Priority cerca de 1,8x (Argon 3,6/18; 3.8 Flash 1,35/6,75). Armazenamento de cache cobrado por hora onde aplicável.
- Grounding: Gemini 3+ dá 5.000 buscas/mês grátis e depois US$ 14 por 1.000; Gemini 2.5 dá 1.500/dia e depois US$ 35 por 1.000.
- Cobrança por conta: planos Prepay/Postpay (2026-03-23) e tetos de gasto por projeto (2026-03-12); tiers de uso em Limites.

### Limites e erros

- Limites por **projeto** (não por chave): RPM, TPM (entrada) e RPD; RPD zera à meia-noite do Pacífico. Preview e experimental têm limites mais baixos. Tiers: Free; Tier 1 (conta de cobrança ativa); Tier 2 (US$ 100 gastos + 3 dias); Tier 3 (US$ 1.000 + 30 dias). Priority tem 0,3x do limite padrão. Os docs não citam cabeçalhos de limite de taxa; limites por modelo ficam na tela do AI Studio.
- Erros HTTP (a página de erros descreve a forma `snake_case` da Interactions API; para `generateContent` o troubleshooting ainda cita `429 RESOURCE_EXHAUSTED` e `503 UNAVAILABLE`):

| HTTP | Significado | Repetir? |
|---|---|---|
| 400 | `INVALID_ARGUMENT` / `FAILED_PRECONDITION` (inclui prefill, parâmetro removido, `thinkingLevel` com `thinkingBudget`) | não |
| 401 | chave ausente, inválida ou expirada (`authentication`) | não |
| 402 | saldo Prepay esgotado (`payment_required`) | não |
| 403 | sem permissão / projeto restrito (`PERMISSION_DENIED`) | não |
| 404 | modelo ou recurso inexistente (`model_not_found`) | não |
| 429 | `RESOURCE_EXHAUSTED`: limite por minuto (`rate_limit_exceeded`) ou cota diária (`quota_exceeded`) | sim, com backoff; a cota diária só após o reset |
| 500 / 503 / 504 | erro interno, sobrecarga, prazo | sim, com backoff |

- O guia de troubleshooting recomenda repetir só em 408, 429 e 5xx, com backoff exponencial e jitter.

## Como o Thinker implementa hoje

Conferido contra o código de `docs/externos` em `2f97f17` (2026-11-04):

- **Provedor.** Id `gemini`, alias `google`, nome "Google", chave sem prefixo e mínimo de 30 caracteres (`packages/shared/src/providers.ts:249-259`). Ids `gemini-*`/`gemma-*` inferem o provedor (`packages/shared/src/provider-inference.ts:11`). URL para criar chave: `https://aistudio.google.com/apikey` (`packages/frontend/src/services/provider-api-key-urls.ts:9`).
- **Endpoint.** `google`: base `https://generativelanguage.googleapis.com`, cabeçalhos `Content-Type` + `x-goog-api-key`, caminho `/v1beta/models/{model}:generateContent`, stream `:streamGenerateContent` com `?alt=sse` anexado em `provider-client.ts:744`, formato `google` (`packages/backend/src/routing/proxy/provider-endpoints.ts:487-501`). `vertex` e `gemini-subscription` (CodeAssist) usam o mesmo adaptador (`:506-545`); o primeiro é do agente `api-vertex`, o segundo do `sub-gemini`.
- **Requisição.** `toGoogleRequest` (`packages/backend/src/routing/proxy/google-adapter.ts:367-449`): `system`/`developer` viram `systemInstruction` (`:376-417`); demais papéis viram `user`/`model` (`:150-154`); `tools` -> `functionDeclarations` com esquema saneado (`:51-130`, `:277-295`); `tool_choice` -> `toolConfig` (`:301-315`); `max_tokens`/`max_completion_tokens`, `temperature`, `top_p`, `stop` e `response_format` -> `generationConfig` (`:426-446`); imagens `data:` -> `inlineData`, URL -> `fileData` (`:162-174`); respostas de ferramenta consecutivas são fundidas num turno (`:394-409`). Não envia `thinkingConfig`, `store`, `serviceTier`, `cachedContent`. `reasoning_effort` e `thinking` do cliente são descartados.
- **Assinaturas.** Lê `thoughtSignature` só de partes `functionCall` e devolve como `thought_signature` na tool call (`:493-497`, `:634-638`); cache em memória de 30 min, teto de 10.000 entradas, chave `sessionKey:toolCallId` (`thought-signature-cache.ts:6-14`, `:26`). Na volta, usa a assinatura que o cliente devolveu ou a do cache, senão injeta `context_engineering_is_the_way_to_go` em todo `functionCall` (`google-adapter.ts:233-243`). `functionCall.id` e `functionResponse.id` são repassados; `name` cai em `unknown` se o `tool_call_id` não está no histórico (`:259-271`).
- **Resposta.** Ignora partes `thought: true` (`:481`, `:617`); `finish_reason` só trata `MAX_TOKENS`, `SAFETY`, `RECITATION` (`:540-551`); sem candidato devolve `choices: []` (`:460-468`). Uso: `completion_tokens = candidatesTokenCount + thoughtsTokenCount`, `reasoning_tokens = thoughtsTokenCount`, `cached_tokens = cachedContentTokenCount`, `cache_creation_tokens = 0` (`:526-538`); `toolUsePromptTokenCount` é ignorado. Stream: um estado por fluxo, usage cumulativo emitido uma vez no evento terminal (`:572-712`).
- **Descoberta de modelos.** `GET https://generativelanguage.googleapis.com/v1beta/models?key=<chave>`, sem paginação (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:1020-1025`). `parseGemini` mantém modelos com `generateContent`, remove o prefixo `models/`, usa `inputTokenLimit` (padrão 1.000.000), deduplica sufixos `-NNN` quando o alias existe e fixa `capabilityReasoning: false` (`:555-598`). Filtro não-chat do `gemini`: `aqs-`, `nano-banana`, `deep-research`, `computer-use`, `lyria`, `gemini-2.0-flash-lite`, `flash-lite-preview-MM-AAAA`, `robotics` (`:436-437`), além do filtro genérico (`embed|tts|imagen|...`, `:421`).
- **Preços.** Vêm de OpenRouter/models.dev; `known-model-prices.ts:39-40` fixa só `gemini-pro-latest` em 1,25/10 e `gemma-3-1b-it` grátis. Não há faixa por contexto nem virada por data; o cache evita sobrescrever preço real por zero de outro provedor (`model-pricing-cache.service.ts:378-388`).
- **Playground** e roteamento passam pelo mesmo `provider-client` (`packages/backend/src/playground/playground.service.ts`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/google-adapter.ts`
- `packages/backend/src/routing/proxy/thought-signature-cache.ts`
- `packages/backend/src/routing/proxy/empty-response.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-prices/model-pricing-cache.service.ts`
- `packages/backend/src/playground/playground.service.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

Arquivos que citam `gemini`, `google` (além dos acima; ver também `sub-gemini` e `api-vertex`):

- `packages/backend/src/routing/oauth/gemini/gemini-oauth.service.ts` (CodeAssist, do `sub-gemini`)
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/pages/Welcome.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `reasoning_effort`/`thinking` do cliente não viram `thinkingConfig` (`thinkingLevel` no 3.x/4, `thinkingBudget` no 2.5); resumos (`includeThoughts`) descartados. Código: `google-adapter.ts:367-449`. Mapeamento: Argon/3.8 sem `minimal`, sem desligar no 3.x e 2.5 Pro, nunca enviar nível e budget juntos | providers | [#421](https://github.com/patrickbrandao/thinker/issues/421) | aberta |
| G2 | degradação | `thoughtSignature` só é guardada/devolvida em `functionCall`; assinaturas de texto são descartadas (perde a continuidade de raciocínio do 3.5+); valor fictício `context_engineering_is_the_way_to_go` não consta nos docs atuais (aceitação não confirmada); cache de 30 min em memória, compartilhado na sessão `default`. Código: `google-adapter.ts:233-243`, `:493-497`, `thought-signature-cache.ts` | providers | [#422](https://github.com/patrickbrandao/thinker/issues/422) | aberta |
| G3 | degradação | `functionResponse` com `name: 'unknown'` ou sem `id` quando o histórico perdeu a chamada; os modelos 3.x/4 exigem `id`, `name` e contagem casando. Código: `google-adapter.ts:259-271` | providers | [#423](https://github.com/patrickbrandao/thinker/issues/423) | aberta |
| G4 | degradação | `finishReason` novos (`MALFORMED_FUNCTION_CALL`, `MISSING_THOUGHT_SIGNATURE`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `CONTINUATION`...) viram `stop`; prompt bloqueado vira 200 com `choices: []`. Código: `google-adapter.ts:460-468`, `:540-551` | providers | [#424](https://github.com/patrickbrandao/thinker/issues/424) | aberta |
| G5 | quebra | Conversa terminando em turno do assistente (prefill) dá 400 no Gemini 3.6+/4 e nos ids 2.5 a partir de 2026-12-01; o adaptador não verifica o último papel. Código: `google-adapter.ts:384-409` | providers | [#425](https://github.com/patrickbrandao/thinker/issues/425) | resolvida (prefill final movido para systemInstruction) |
| G6 | degradação | `temperature`/`top_p` (e `generationConfig` cru com `topK`/`candidateCount`) seguem sendo enviados; ignorados no 3.6+/4, com 400 anunciado sem data. Código: `google-adapter.ts:426-434` | providers | [#426](https://github.com/patrickbrandao/thinker/issues/426) | aberta |
| G7 | degradação | Descoberta sem paginação (50 modelos por página por padrão), sem filtrar `-image`/`gemini-omni`/`transcribe`, `capabilityReasoning` sempre falso (ignora `thinking`), `outputTokenLimit` ignorado e chave em `?key=` na URL. Código: `provider-model-fetcher.service.ts:1020-1025`, `:436-437`, `:555-598` | providers | [#427](https://github.com/patrickbrandao/thinker/issues/427) | aberta |
| G8 | degradação | Preços: `gemini-pro-latest` fixo em 1,25/10; sem faixa >200k (mesma causa do [#317](https://github.com/patrickbrandao/thinker/issues/317)); sem as viradas de 2026-12-01 (Argon 2->4/10->20, relacionado ao [#319](https://github.com/patrickbrandao/thinker/issues/319)) e 2027-01-01 (3.8/3.6 Flash); ids 2.5 passam a ser cobrados como 3.8 Flash/3.5 Flash-Lite em 2026-12-01. Código: `known-model-prices.ts:39-40` | providers | [#428](https://github.com/patrickbrandao/thinker/issues/428) | aberta |
| G9 | oportunidade | Enviar `store: false` (projetos pagos novos guardam prompts por padrão desde 2026-10-26) e expor `serviceTier` (`flex`/`priority`). Código: `google-adapter.ts:411-448` | providers | [#429](https://github.com/patrickbrandao/thinker/issues/429) | aberta |

Fora do escopo deste agente: lista de modelos e mapeamento do CodeAssist (ver `sub-gemini` G2, [#325](https://github.com/patrickbrandao/thinker/issues/325)); Vertex (`api-vertex`).

Pendente de conferência com chave real: aceitação do valor fictício de assinatura no 3.8 Flash e no Argon; comportamento de `thinkingBudget: 0` e `-1` no 2.5 durante o roteamento de 2026-12-01; formato exato do corpo de erro 429 (`RESOURCE_EXHAUSTED` com `QuotaFailure`, `RetryInfo`) em `generateContent`; se `GET /v1beta/models` hoje devolve mais de 50 modelos por conta.

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Documentação migrou para `aistudio.google.com` e foca na Interactions API. Registrado o estado dos modelos (Argon, 3.8/3.6 Flash, 3.5 Flash-Lite, 3.1 Pro preview; 2.5 depreciado e roteado em 2026-12-01), parâmetros removidos, prefill, assinaturas, preços com viradas de data, limites e erros. Abertas as lacunas G1 a G9 (issues #421 a #429).
