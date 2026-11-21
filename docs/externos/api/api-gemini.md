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
- O Thinker funciona no caminho básico (chave por `x-goog-api-key`, stream por `streamGenerateContent?alt=sse`, assinaturas de `functionCall` e de texto em cache). G1 e G3 a G9 estão resolvidas e G2 é parcial. A revisão do formato na rede (2026-11-15) abriu G10 a G15: assinatura em parte de texto vazio descartada, assinatura fictícia nas chamadas paralelas, chave inválida (400) sem rotação, teto por requisição e `CONTINUATION` dos Gemini 4, `xhigh` e `parametersJsonSchema`.
- Confiança: alta para endpoints, preços, depreciações e parâmetros removidos (docs oficiais lidos em 2026-11-04); média para validação de `thought_signature` no `generateContent` (os docs novos não detalham; precisa de chave real) e para erros em `generateContent` (a página de erros descreve códigos em `snake_case` da Interactions API).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Gemini API docs (raiz; índice `llms.txt`, texto completo `llms-full.txt`) | <https://aistudio.google.com/docs> (antes `ai.google.dev/gemini-api/docs`, 301) | 2026-11-04 |
| Modelos | <https://aistudio.google.com/docs/models> | 2026-11-04 |
| OpenAI compatibility | <https://aistudio.google.com/docs/openai> | 2026-11-15 |
| Preços | <https://aistudio.google.com/docs/pricing> (`.md` para texto) | 2026-11-04 |
| Changelog | <https://aistudio.google.com/docs/changelog> | entrada mais nova 2026-11-12 (Gemini 4 Hydrogen; lida só para o formato na rede) |
| Depreciações | <https://aistudio.google.com/docs/deprecations> | 2026-11-04 |
| Referência generateContent | <https://aistudio.google.com/api-reference/generate-content/generate-content.md>, `.../stream-generate-content.md` | 2026-11-15 |
| Documento de descoberta (esquema público, sem chave) | <https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta> | `revision` 20261113 (2026-11-15) |
| SDK oficial JS | `googleapis/js-genai` (`src/_api_client.ts`, `src/chats.ts`) | v3.3.0 (`91efe93`, 2026-11-12) |
| Guias na versão generateContent (sufixo `?generate-content=true`; sem ele a página descreve a Interactions API) | `docs/function-calling`, `docs/thought-signatures`, `docs/thinking`, `docs/text-generation`, `docs/safety-settings`, `docs/api-errors` | 2026-11-15 |
| Referência models.list | <https://aistudio.google.com/api-reference/models/list-models.md> | 2026-11-04 |
| Limites de taxa | <https://aistudio.google.com/docs/rate-limits> | 2026-11-04 |
| Erros e troubleshooting | <https://aistudio.google.com/docs/api-errors?generate-content=true>, <https://aistudio.google.com/docs/troubleshooting> | 2026-11-15 |
| Guias de migração por modelo | `docs/whats-new-gemini-3.5`, `-3.6`, `-3.8`, `-4-argon`, `-4-carbon`, `-4-hydrogen`, `docs/latest-model` | 2026-11-15 (Carbon e Hydrogen lidos só para o formato na rede) |

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
- **Assinaturas de pensamento (`thoughtSignature`).** No `generateContent` não há blocos de raciocínio dedicados: a assinatura é metadado em qualquer Part (`functionCall` ou a última parte da resposta; campo `thoughtSignature` no nível da Part, irmão de `functionCall`). Do Gemini 3.5 Flash em diante o modelo reaproveita o raciocínio dos turnos anteriores quando o histórico completo e inalterado, com assinaturas, volta em `contents`. O aviso de 2026-11-02 lista "validação de `thought_signature` e de function calling" entre as mudanças que os ids 2.5 roteados herdam em 2026-12-01. A regra completa e os dois valores fictícios aceitos (`context_engineering_is_the_way_to_go`, `skip_thought_signature_validator`) estão na versão generateContent da página de assinaturas (ver "Formato na rede"). `finishReason` `MISSING_THOUGHT_SIGNATURE` existe ("a requisição tem ao menos uma assinatura faltando").
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
- Erros HTTP de `generateContent` (página <https://aistudio.google.com/docs/api-errors?generate-content=true>, 2026-11-15; a versão sem o parâmetro descreve os códigos `snake_case` da Interactions API, que **não** valem aqui). Corpo e sonda em "Formato na rede":

| HTTP | Significado | Repetir? |
|---|---|---|
| 400 | `INVALID_ARGUMENT` (corpo malformado, prefill, parâmetro removido, `thinkingLevel` com `thinkingBudget`, **chave inválida** com `ErrorInfo.reason: "API_KEY_INVALID"`) / `FAILED_PRECONDITION` (free tier indisponível no país) | não |
| 402 | `RESOURCE_EXHAUSTED`: saldo Prepay esgotado | não |
| 403 | `PERMISSION_DENIED`: chave sem permissão, bloqueada ou vazada, projeto restrito; **sem chave** a sonda recebeu 403 `ACCESS_DENIED` | não |
| 404 | `NOT_FOUND`: modelo ou arquivo referenciado inexistente | não |
| 499 | `CANCELLED`: o cliente fechou a conexão | n/a |
| 429 | `RESOURCE_EXHAUSTED`: limite por minuto (`rate_limit_exceeded`) ou cota diária (`quota_exceeded`) | sim, com backoff; a cota diária só após o reset |
| 500 / 503 / 504 | erro interno, sobrecarga, prazo | sim, com backoff |

- O guia de troubleshooting recomenda repetir só em 408, 429 e 5xx, com backoff exponencial e jitter.

### Formato na rede

Seção canônica do protocolo **Gemini `generateContent` / `streamGenerateContent`**. Vertex (`api-vertex`) e o envelope do Gemini Code Assist (`sub-gemini`) registram só as diferenças e apontam para cá. Legenda de `Fonte` e `Ao vivo`: [índice](../README.md#formato-na-rede).

Abreviações de fonte desta seção:

- `discovery v1beta@20261113`: documento de descoberta público <https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta> (campo `revision: 20261113`, baixado em 2026-11-15). É a fonte escrita mais forte para nomes, tipos e enums.
- `sdk googleapis/js-genai@v3.3.0`: SDK oficial JS, commit `91efe93`.
- Guias: sempre a versão `?generate-content=true` da página. Sem esse parâmetro a mesma URL descreve a Interactions API (`steps`, `call_id`, erros `snake_case`), que é outro protocolo.
- Nomes JSON: a resposta usa lowerCamelCase. Nos pedidos, os exemplos REST da doc misturam `system_instruction`/`function_declarations` e `systemInstruction`; o Thinker envia camelCase.

#### `POST /v1beta/models/{model}:generateContent` e `POST /v1beta/models/{model}:streamGenerateContent?alt=sse` (Gemini generateContent)

| Item | Formato | Fonte | Ao vivo |
|---|---|---|---|
| Pedido: topo | Obrigatório `contents[]`. Opcionais: `systemInstruction`, `tools[]`, `toolConfig`, `safetySettings[]`, `generationConfig`, `cachedContent` (`cachedContents/{id}`), `serviceTier` (`standard\|flex\|priority`), `store` (bool, sobrepõe o padrão do projeto), `labels`, `continuationToken`. O modelo vai no caminho; o campo `model` do corpo existe no esquema, mas os exemplos REST não o enviam. Autenticação por `x-goog-api-key` (o SDK usa esse cabeçalho) ou `?key=` | discovery v1beta@20261113 (`GenerateContentRequest`); doc [generate-content](https://aistudio.google.com/api-reference/generate-content/generate-content) (2026-11-15); sdk googleapis/js-genai@v3.3.0 `src/node/_node_auth.ts` | não verificado em produção |
| Pedido: `contents[]` | `Content{role, parts[]}`, `role` ∈ `user`, `model` (opcional em turno único; o SDK recusa outro valor no histórico). Resultados de ferramenta vão num `Content` `role:"user"`. Turnos seguidos do mesmo papel são aceitos: o chat do SDK grava cada chunk de stream como um `Content` `model` separado. Do 3.6 em diante (e nos ids 2.5 a partir de 2026-12-01), um último turno não vazio `model` (prefill) dá 400. O guia do 3.8 pede ainda "último turno `user` com texto não vazio"; não está claro como isso convive com um turno só de `functionResponse` (não confirmado) | discovery v1beta@20261113 (`Content`); sdk googleapis/js-genai@v3.3.0 `src/chats.ts` (`validateHistory`, `processStreamResponse`); doc [whats-new-gemini-3.6](https://aistudio.google.com/docs/whats-new-gemini-3.6?generate-content=true) (2026-11-15); doc [whats-new-gemini-3.8](https://aistudio.google.com/docs/whats-new-gemini-3.8?generate-content=true) (2026-11-15) | não verificado em produção |
| Pedido: `parts[]` | `Part` é um oneof com um destes: `text`, `inlineData{mimeType, data}` (base64), `fileData{mimeType, fileUri}`, `functionCall`, `functionResponse`, `executableCode{language, code, id}`, `codeExecutionResult{outcome, output, id}`, `toolCall`/`toolResponse` (ferramentas de servidor; o cliente deve devolvê-las). Metadados ao lado do dado: `thought` (bool), `thoughtSignature` (bytes em base64), `videoMetadata`, `mediaResolution`, `mediaProcessing`, `partMetadata` | discovery v1beta@20261113 (`Part`, `Blob`, `FileData`) | não verificado em produção |
| Pedido: `systemInstruction` | Um `Content` sem `role` obrigatório, **só texto** (`{parts:[{text}]}`) | discovery v1beta@20261113 (`GenerateContentRequest.systemInstruction`); doc [text-generation](https://aistudio.google.com/docs/text-generation?generate-content=true) (2026-11-15) | não verificado em produção |
| Pedido: `generationConfig` | `maxOutputTokens` (inclui raciocínio), `stopSequences` (até 5), `responseMimeType` (`text/plain`, `application/json`, `text/x.enum`), `responseJsonSchema` (JSON Schema; exige o mime e exclui `responseSchema`, que é OpenAPI), `responseModalities`, `seed`, `presencePenalty`, `frequencyPenalty`, `responseLogprobs` + `logprobs` (0 a 20), `mediaResolution`, `speechConfig`, `imageConfig`, `thinkingConfig`. `temperature` (0 a 2), `topP` e `topK` são ignorados em silêncio do 3.6 em diante; no Hydrogen, valor fora da faixa dá 400. `candidateCount` não existe no 3 e no 4. O esquema traz `_responseJsonSchema` e `responseJsonSchema` ("detalhe interno"); a doc usa `responseJsonSchema` | discovery v1beta@20261113 (`GenerationConfig`); doc [whats-new-gemini-4-hydrogen](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen) (2026-11-15) | não verificado em produção |
| Pedido: `thinkingConfig` | `{thinkingLevel?, thinkingBudget?, includeThoughts?}`. `thinkingLevel` ∈ `MINIMAL\|LOW\|MEDIUM\|HIGH\|XHIGH` (os exemplos REST usam minúsculas); dá erro em modelos anteriores ao 3. `minimal` dá erro no 3.8 Flash e nos Gemini 4; `xhigh` só no `gemini-4-hydrogen`. Padrão `medium` no 3.6/3.8 Flash, Carbon e Argon; `high` no 3 Flash, 3.1 Pro e Hydrogen; `minimal` nos Flash-Lite 3.5/3.1. `thinkingBudget` (2.5): `-1` dinâmico, `0` desliga (não no 2.5 Pro); faixas 128 a 32768 (2.5 Pro), 0 a 24576 (2.5 Flash), 512 a 24576 (2.5 Flash-Lite). Nos Gemini 4 o budget sozinho é convertido para o nível mais próximo, com aviso. Nível e budget juntos: 400. `thinkingConfig` em modelo sem thinking: erro | discovery v1beta@20261113 (`ThinkingConfig`); doc [thinking](https://aistudio.google.com/docs/thinking?generate-content=true) (2026-11-15); doc [whats-new-gemini-4-hydrogen](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen) (2026-11-15) | não verificado em produção |
| Pedido: `safetySettings` | `[{category, threshold}]`, no máximo um por categoria. Categorias de uso: `HARM_CATEGORY_HARASSMENT`, `_HATE_SPEECH`, `_SEXUALLY_EXPLICIT`, `_DANGEROUS_CONTENT`, `_CIVIC_INTEGRITY` (o enum também traz `_JAILBREAK` e categorias legadas). `threshold` ∈ `BLOCK_LOW_AND_ABOVE`, `BLOCK_MEDIUM_AND_ABOVE`, `BLOCK_ONLY_HIGH`, `BLOCK_NONE`, `OFF`. Sem configuração, o padrão é `OFF` do 2.5 em diante | discovery v1beta@20261113 (`SafetySetting`); doc [safety-settings](https://aistudio.google.com/docs/safety-settings?generate-content=true) (2026-11-15) | não verificado em produção |
| Resposta | `{candidates[], promptFeedback?, usageMetadata, modelVersion, responseId, modelStatus?}`. `Candidate{content{role:"model", parts[]}, finishReason, finishMessage?, safetyRatings[], citationMetadata?, groundingMetadata?, urlContextMetadata?, logprobsResult?, avgLogprobs?, tokenCount?, index, continuationToken?}`. Texto: partes `text` sem `thought`; resumo de raciocínio: partes `text` com `thought: true`; chamadas: partes `functionCall`. Um candidato só (sem `candidateCount` no 3 e no 4) | discovery v1beta@20261113 (`GenerateContentResponse`, `Candidate`) | não verificado em produção |
| Resposta: `finishReason` | `STOP` (fim natural ou stop sequence; **também quando há chamada de função**, não existe motivo próprio para tool call), `MAX_TOKENS`, `SAFETY`, `RECITATION`, `LANGUAGE`, `OTHER`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`, `IMAGE_SAFETY`, `IMAGE_PROHIBITED_CONTENT`, `IMAGE_OTHER`, `NO_IMAGE`, `IMAGE_RECITATION`, `UNEXPECTED_TOOL_CALL` (chamada sem ferramentas habilitadas), `TOO_MANY_TOOL_CALLS`, `MISSING_THOUGHT_SIGNATURE`, `MALFORMED_RESPONSE`, `ESCALATION`, `PUP_LIMITED_DISABLED`, `CONTINUATION`. Ausente = ainda gerando. `CONTINUATION` (e, nos Gemini 4, também `MAX_TOKENS`) traz `continuationToken`: para continuar, reenviar os mesmos `contents` + o token + `maxOutputTokens` maior (se não aumentar: 400). Teto por requisição: Carbon e Argon 32.768 sem stream e 65.536 com stream; Hydrogen 65.536 nos dois | discovery v1beta@20261113 (`Candidate.finishReason`, `continuationToken`); doc [whats-new-gemini-4-carbon](https://aistudio.google.com/docs/whats-new-gemini-4-carbon?generate-content=true) (2026-11-15); doc [thinking](https://aistudio.google.com/docs/thinking?generate-content=true) (2026-11-15); doc [whats-new-gemini-4-hydrogen](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen) (2026-11-15) | não verificado em produção |
| Resposta: prompt bloqueado | `promptFeedback{blockReason, safetyRatings[]}` e nenhum `candidates`. `blockReason` ∈ `SAFETY`, `OTHER`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `IMAGE_SAFETY`. A doc não diz o status HTTP (espera-se 200, não confirmado) | discovery v1beta@20261113 (`PromptFeedback`) | não verificado em produção |
| Uso | `usageMetadata{promptTokenCount, cachedContentTokenCount, candidatesTokenCount, thoughtsTokenCount, toolUsePromptTokenCount, totalTokenCount, promptTokensDetails[], cacheTokensDetails[], candidatesTokensDetails[], toolUsePromptTokensDetails[], serviceTier}`; os `*Details` são `[{modality, tokenCount}]` (`TEXT\|IMAGE\|VIDEO\|AUDIO\|DOCUMENT`). `promptTokenCount` já inclui o cache; `thoughtsTokenCount` fica fora de `candidatesTokenCount`; `totalTokenCount` = prompt + tool-use + thoughts + candidates. Não há contador de escrita de cache. No stream o objeto aparece em vários chunks; que seja cumulativo e completo no último chunk é **(não confirmado)** (o Thinker assume isso) | discovery v1beta@20261113 (`UsageMetadata`) | não verificado em produção |
| Stream: transporte | `?alt=sse` responde `text/event-stream`; cada evento é só `data: <GenerateContentResponse>` seguido de linha em branco, sem `event:` nem `id:`. O SDK separa eventos por `\n\n`, `\r\r` ou `\r\n\r\n` e ignora blocos que não começam com `data:`. **Sem terminador**: não há `[DONE]`; o stream acaba com o fechamento da conexão depois do chunk com `finishReason`. Nenhum keep-alive documentado. O enum `alt` do discovery lista só `json\|media\|proto`, mas a doc e o SDK (que força `alt=sse`) usam `sse`. Sem `alt=sse` o corpo é um array JSON de respostas (não confirmado) | doc [stream-generate-content](https://aistudio.google.com/api-reference/generate-content/stream-generate-content) (2026-11-15); sdk googleapis/js-genai@v3.3.0 `src/_api_client.ts` (`processStreamResponse`, l. 677 e 787-866); discovery v1beta@20261113 (`parameters.alt`) | sonda 2026-11-15 (só o `content-type` do erro, ver "Stream: erro") |
| Stream: chunks | Cada chunk é um `GenerateContentResponse` inteiro com **só as partes novas**: o chat do SDK guarda o `content` de cada chunk como um turno separado, sem concatenar. Texto vem fatiado em vários chunks. `functionCall` chega inteiro numa parte, porque o esquema não tem argumentos parciais (`FunctionCall` = `id`, `name`, `args`); que cada chamada venha num chunk próprio é **(não confirmado)**. `finishReason` só no último chunk do candidato. Sem chamada de função, a assinatura pode chegar numa parte `{text:"", thoughtSignature}` no fim: ler até o `finishReason`. `modelVersion` e `responseId` em todos os chunks (não confirmado) | sdk googleapis/js-genai@v3.3.0 `src/chats.ts` (l. 311-333); discovery v1beta@20261113 (`FunctionCall`); doc [thought-signatures](https://aistudio.google.com/docs/thought-signatures?generate-content=true) (2026-11-15, FAQ) | não verificado em produção |
| Stream: erro | Antes de abrir o stream: status 4xx/5xx com `content-type: text/event-stream` e o corpo JSON de erro **cru, sem `data:`**. Depois do HTTP 200: a doc não descreve; o SDK procura, em cada payload `data:` e em cada pedaço lido, um objeto `{error:{code, status, message}}` com `code` entre 400 e 599 e o lança como erro (`throwIfStreamErrorChunk`) | sdk googleapis/js-genai@v3.3.0 `src/_api_client.ts` (l. 1146-1175) | sonda 2026-11-15: `POST :streamGenerateContent?alt=sse` sem credencial, corpo trivial → HTTP 403, `content-type: text/event-stream`, `content-length: 552`, corpo igual ao de "Erro" (sem enquadramento SSE) |
| Ferramentas: definição | `tools[]`, cada `Tool` com um tipo: `functionDeclarations[]`, `googleSearch`, `urlContext`, `codeExecution`, `fileSearch`, `googleMaps`, `computerUse`, `mcpServers`. `FunctionDeclaration{name, description, parameters? \| parametersJsonSchema?, response? \| responseJsonSchema?, behavior?}`. `parameters` é o `Schema` (subconjunto de OpenAPI 3.0.3); `parametersJsonSchema` é JSON Schema que descreve um objeto (aceita `additionalProperties`, `propertyOrdering`); os dois se excluem. `name`: até 128, `a-z A-Z 0-9 _ . : -` na declaração (a descrição de `FunctionCall`/`FunctionResponse` cita só `_` e `-`). `behavior` (`BLOCKING`/`NON_BLOCKING`) só na Live API | discovery v1beta@20261113 (`Tool`, `FunctionDeclaration`); doc [function-calling](https://aistudio.google.com/docs/function-calling?generate-content=true) (2026-11-15) | não verificado em produção |
| Ferramentas: escolha | `toolConfig.functionCallingConfig{mode, allowedFunctionNames?}`. `AUTO`: padrão quando só há funções; texto ou chamada. `ANY`: sempre chama, com esquema garantido. `NONE`: o mesmo que não declarar funções. `VALIDATED`: texto ou chamada, com chamada validada por decodificação restrita; padrão quando há ferramentas nativas ou saída estruturada. `allowedFunctionNames` só com `ANY` ou `VALIDATED`. `toolConfig.includeServerSideToolInvocations: true` expõe as partes `toolCall`/`toolResponse` das ferramentas de servidor | discovery v1beta@20261113 (`FunctionCallingConfig`, `ToolConfig`); doc [function-calling](https://aistudio.google.com/docs/function-calling?generate-content=true) (2026-11-15) | não verificado em produção |
| Ferramentas: chamada | Parte `{functionCall:{id?, name, args?}, thoughtSignature?}` no `content` `model`; `args` é objeto JSON e pode faltar. O `id` é gerado pela API e vem sempre nos Gemini 3+; formato opaco, sem prefixo documentado (exemplo da doc: `8f2b1a3c`). O turno termina com `finishReason: STOP` | discovery v1beta@20261113 (`FunctionCall`); doc [function-calling](https://aistudio.google.com/docs/function-calling?generate-content=true) (2026-11-15) | não verificado em produção |
| Ferramentas: paralelas | Várias partes `functionCall` no mesmo `content` `model`, cada uma com `id` próprio; nos Gemini 3 e 4 só a **primeira** traz `thoughtSignature`. Não há opção para desligar chamadas paralelas | doc [thought-signatures](https://aistudio.google.com/docs/thought-signatures?generate-content=true) (2026-11-15); doc [function-calling](https://aistudio.google.com/docs/function-calling?generate-content=true) (2026-11-15) | não verificado em produção |
| Ferramentas: resultado | `Content` seguinte com `role:"user"` e uma parte `{functionResponse:{id, name, response, parts?}}` por chamada. `response` é objeto obrigatório de chaves livres (falha: chave `error`; não há flag de erro). Multimídia vai em `parts[]` (`{inlineData}` ou `{fileData}` com `displayName`), referenciada dentro de `response` por `{"$ref": "<displayName>"}`. Ligação pelo `id` da chamada, com `name` igual. Uma resposta por chamada. Ordem: o turno `model` tem todas as chamadas e o turno `user` seguinte todas as respostas (`FC1+sig, FC2` → `FR1, FR2`); intercalar (`FC1, FR1, FC2, FR2`) dá 400. A doc se contradiz sobre a ordem das respostas (diz que o `id` dispensa a ordem e, adiante, pede a ordem das chamadas); mandar na ordem das chamadas é seguro. Com `id`/`name`/contagem errados o `generateContent` ainda não dá erro, mas o modelo tende a responder vazio com `STOP`. `scheduling` e `willContinue` só valem para `NON_BLOCKING` (Live) | discovery v1beta@20261113 (`FunctionResponse`, `FunctionResponsePart`); doc [function-calling](https://aistudio.google.com/docs/function-calling?generate-content=true) (2026-11-15); doc [thought-signatures](https://aistudio.google.com/docs/thought-signatures?generate-content=true) (2026-11-15, FAQ); doc [whats-new-gemini-3.5](https://aistudio.google.com/docs/whats-new-gemini-3.5?generate-content=true) (2026-11-15) | não verificado em produção |
| Raciocínio: partes | O raciocínio bruto nunca é devolvido. Com `includeThoughts: true` vêm resumos como partes `{text, thought: true}`: um resumo final sem stream, resumos incrementais no stream. Tokens em `thoughtsTokenCount`, cobrados como saída | doc [thinking](https://aistudio.google.com/docs/thinking?generate-content=true) (2026-11-15); discovery v1beta@20261113 (`Part.thought`) | não verificado em produção |
| Raciocínio: assinaturas | `thoughtSignature` é bytes opacos em base64, ao lado do dado em **qualquer** tipo de `Part`. Gemini 3 e 4: com chamadas, vem na primeira `functionCall` de cada passo; sem chamadas, na última parte da resposta (no stream, possivelmente uma parte de texto vazio). Gemini 2.5: na primeira parte e só quando há function declarations. Regras: devolver exatamente na parte em que veio; não fundir partes com assinatura, nem uma com e outra sem. Validação estrita só na primeira `functionCall` de cada passo do **turno atual** (do último `user` com texto em diante): sem ela, 400 `Function call <FC> in the <n>. content block is missing a thought_signature`. Assinaturas de texto não são validadas (omitir só degrada a qualidade). Histórico de outro modelo ou chamadas injetadas: valores fictícios `context_engineering_is_the_way_to_go` ou `skip_thought_signature_validator` | doc [thought-signatures](https://aistudio.google.com/docs/thought-signatures?generate-content=true) (2026-11-15); doc [thinking](https://aistudio.google.com/docs/thinking?generate-content=true#signatures) (2026-11-15); discovery v1beta@20261113 (`Part.thoughtSignature`, `format: byte`) | não verificado em produção |
| Erro | Corpo `google.rpc.Status`: `{"error":{"code", "message", "status", "details":[...]}}`, `status` em SCREAMING_CASE, `details` com objetos `@type` (`type.googleapis.com/google.rpc.ErrorInfo{reason, domain, metadata}`, `...LocalizedMessage{locale, message}`; em 429, `QuotaFailure` e `RetryInfo{retryDelay}`, não confirmado). Chave inválida: 400 `INVALID_ARGUMENT` com `reason: "API_KEY_INVALID"`, não 401. Tabela de status em "Limites e erros". A sonda não viu cabeçalho de request-id nem `retry-after` | doc [api-errors](https://aistudio.google.com/docs/api-errors?generate-content=true) (2026-11-15); discovery v1beta@20261113 (`Status`) | sonda 2026-11-15: `POST /v1beta/models/gemini-3.8-flash:generateContent` sem credencial, corpo `{"contents":[{"role":"user","parts":[{"text":"x"}]}],"generationConfig":{"maxOutputTokens":1}}` → HTTP 403, `content-type: application/json; charset=UTF-8`, corpo `{"error":{"code":403,"message":"Permission denied on the service.","status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"ACCESS_DENIED","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}},{"@type":"type.googleapis.com/google.rpc.LocalizedMessage","locale":"en-US","message":"…"}]}}`; cabeçalhos só `vary`, `server: scaffolding on HTTPServer2`, `server-timing`, `alt-svc` (sem request-id). `GET /v1beta/models` sem chave → o mesmo 403 |

#### `POST /v1beta/openai/chat/completions` (diferenças em relação a OpenAI Chat Completions)

Protocolo base: [api-openai, Formato na rede](api-openai.md#formato-na-rede). O Thinker não usa esta superfície para o Gemini (usa a nativa acima).

| Item | Formato | Fonte | Ao vivo |
|---|---|---|---|
| Pedido | Base `https://generativelanguage.googleapis.com/v1beta/openai/`, `Authorization: Bearer <chave>`. `reasoning_effort`: `minimal` vira `low` nos Gemini 4 e `minimal` nos 3 Flash e 3.1 Flash-Lite; `low`/`medium`/`high` iguais; `xhigh` só no Hydrogen; `none` só desliga o 2.5 Flash/Flash-Lite. No 2.5 vira budget (`minimal`/`low` 1.024, `medium` 8.192, `high` 24.576). Extras em `extra_body.google`: `thinking_config{thinking_level \| thinking_budget, include_thoughts}`, `cached_content`. `reasoning_effort` junto com `thinking_config` dá erro | doc [openai](https://aistudio.google.com/docs/openai) (2026-11-15) | não verificado em produção |
| Raciocínio | A doc diz que as assinaturas funcionam em Chat Completions, mas o exemplo para onde aponta mostra JSON nativo: o campo em `tool_calls[]` não está documentado (relato antigo: `extra_content.google.thought_signature`, não confirmado). Onde aparecem os resumos com `include_thoughts` também não está documentado (não confirmado) | doc [openai](https://aistudio.google.com/docs/openai#thinking) (2026-11-15); doc [thought-signatures](https://aistudio.google.com/docs/thought-signatures?generate-content=true#openai) (2026-11-15) | não verificado em produção |
| Erro | O corpo é um **array JSON** com um objeto de erro no formato Google, `[{"error":{"code","message","status"}}]`, e não o `{error:{message, type, param, code}}` da OpenAI | doc [openai](https://aistudio.google.com/docs/openai) (2026-11-15, não descreve o erro) | sonda 2026-11-15: `POST /v1beta/openai/chat/completions` sem `Authorization`, corpo `{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"x"}],"max_tokens":1}` → HTTP 400, `application/json`, corpo `[{"error":{"code":400,"message":"Missing or invalid Authorization header.","status":"INVALID_ARGUMENT"}}]` |
| Stream, Uso, Ferramentas | Sem diferenças documentadas (a doc só mostra exemplos com `stream: true`, `tools` e `tool_choice: "auto"`) | doc [openai](https://aistudio.google.com/docs/openai) (2026-11-15) | não verificado em produção |

Contradições registradas (doc × doc × sonda):

- Chave ausente: a sonda viu **403 `PERMISSION_DENIED`/`ACCESS_DENIED`**. A doc de erros do `generateContent` mostra **400 `API_KEY_INVALID`** para chave inválida, e a versão Interactions da mesma página fala em **401**. Nenhum dos três é 401 no `generateContent`.
- Ordem dos `functionResponse` paralelos: o guia de function calling diz que não precisa seguir a ordem e, parágrafos depois, pede a ordem das chamadas.
- O guia do 3.8 manda incluir `call_id` no `FunctionResponse`; no `generateContent` o campo é `id` (`call_id` é da Interactions API).
- A tabela de níveis do guia de thinking ainda não tem o Hydrogen (`xhigh`, padrão `high`), que está no changelog de 2026-11-12 e no guia do modelo. A OpenAI-compat converte `minimal` em `low` nos Gemini 4, mas no nativo `minimal` dá erro.
- O enum `alt` do discovery não tem `sse`, embora a doc e o SDK usem `alt=sse`.

Onde o Thinker lê e escreve este formato (conferido em 2026-11-15, árvore de `main` em `6bf042a6`):

- `packages/backend/src/routing/proxy/google-adapter.ts`: pedido (`toGoogleRequest`; ferramentas com `parameters` saneado, l. 308-325; `tool_choice` → `functionCallingConfig`, l. 329-345; assinatura fictícia em toda `functionCall` sem assinatura, l. 236-251; assinatura de texto reposta pelo hash do texto, l. 255-270), resposta sem stream (l. 530-560; `mapFinishReason`, l. 609-627, `CONTINUATION` → `length`), stream (`transformGoogleStreamChunk`, l. 678-800; assinatura de texto só lida em parte com `text` não vazio, l. 705-712) e falhas (`googleResponseFailure`, l. 834-865).
- `packages/backend/src/routing/proxy/param-policy.ts:181-222`: `thinkingConfig` (`xhigh`/`max` → `HIGH`).
- `packages/backend/src/routing/proxy/stream-protocol.ts:120` (chunk `data.error` vira falha) e `:151-153` (stream Google sem verificação de terminador).
- `packages/backend/src/routing/proxy/quota-reset.ts:57-88` (`RetryInfo.retryDelay`); `packages/backend/src/routing/proxy/proxy-fallback.service.ts:169` (rotação de chave só em 401/403/429).

Capturas pedidas ao mantenedor (nenhuma ainda; pasta `docs/externos/capturas/api-gemini/`):

1. `gemini-3.8-flash`, stream, sem ferramentas, com `includeThoughts: true`: confirma delta por chunk, partes `thought`, a parte final `{text:"", thoughtSignature}`, onde vem `usageMetadata` (cumulativo?) e se `modelVersion`/`responseId` se repetem.
2. `gemini-3.8-flash`, stream, prompt que gere **duas chamadas de função paralelas**: uma ou duas por chunk, assinatura só na primeira, formato do `id`.
3. Turno seguinte ao cenário 2 com os dois `functionResponse` (um com `response.error`), mandado pelo Thinker: confirma que a assinatura fictícia na segunda `functionCall` é aceita (G11).
4. `gemini-4-carbon` **sem stream** com `maxOutputTokens` acima de 32.768 numa tarefa longa: `finishReason: CONTINUATION` e `continuationToken` (G13).
5. 400 com chave inválida (`API_KEY_INVALID`) e 429 `RESOURCE_EXHAUSTED` real, com o corpo e os `details` (`QuotaFailure`, `RetryInfo`) e os cabeçalhos (G12).
6. Erro **depois do HTTP 200** num stream (por exemplo 503 de sobrecarga no meio): forma do evento `data: {"error":...}`.
7. Prompt bloqueado (`promptFeedback.blockReason`): status HTTP e corpo, com e sem stream.

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
| G1 | degradação | `reasoning_effort`/`thinking` do cliente não viram `thinkingConfig` (`thinkingLevel` no 3.x/4, `thinkingBudget` no 2.5); resumos (`includeThoughts`) descartados. Código: `google-adapter.ts:367-449`. Mapeamento: Argon/3.8 sem `minimal`, sem desligar no 3.x e 2.5 Pro, nunca enviar nível e budget juntos | providers | [#421](https://github.com/patrickbrandao/thinker/issues/421) | resolvida (normalização de reasoning na entrada e na saída) |
| G2 | degradação | `thoughtSignature` só é guardada/devolvida em `functionCall`; assinaturas de texto são descartadas (perde a continuidade de raciocínio do 3.5+); valor fictício `context_engineering_is_the_way_to_go` está documentado (doc thought-signatures `?generate-content=true`, 2026-11-15), ao lado de `skip_thought_signature_validator`; cache de 30 min em memória, compartilhado na sessão `default`. Código: `google-adapter.ts:233-243`, `:493-497`, `thought-signature-cache.ts` | providers | [#422](https://github.com/patrickbrandao/thinker/issues/422) | parcial (assinaturas de partes de texto guardadas por hash do texto e reenviadas; resta a parte de texto vazio, ver G10) |
| G3 | degradação | `functionResponse` com `name: 'unknown'` ou sem `id` quando o histórico perdeu a chamada; os modelos 3.x/4 exigem `id`, `name` e contagem casando. Código: `google-adapter.ts:259-271` | providers | [#423](https://github.com/patrickbrandao/thinker/issues/423) | resolvida (adaptador de tradução corrigido, com teste) |
| G4 | degradação | `finishReason` novos (`MALFORMED_FUNCTION_CALL`, `MISSING_THOUGHT_SIGNATURE`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `CONTINUATION`...) viram `stop`; prompt bloqueado vira 200 com `choices: []`. Código: `google-adapter.ts:460-468`, `:540-551` | providers | [#424](https://github.com/patrickbrandao/thinker/issues/424) | resolvida (adaptador de tradução corrigido, com teste) |
| G5 | quebra | Conversa terminando em turno do assistente (prefill) dá 400 no Gemini 3.6+/4 e nos ids 2.5 a partir de 2026-12-01; o adaptador não verifica o último papel. Código: `google-adapter.ts:384-409` | providers | [#425](https://github.com/patrickbrandao/thinker/issues/425) | resolvida (prefill final movido para systemInstruction) |
| G6 | degradação | `temperature`/`top_p` (e `generationConfig` cru com `topK`/`candidateCount`) seguem sendo enviados; ignorados no 3.6+/4, com 400 anunciado sem data. Código: `google-adapter.ts:426-434` | providers | [#426](https://github.com/patrickbrandao/thinker/issues/426) | resolvida (política de parâmetros: param-policy.ts) |
| G7 | degradação | Descoberta sem paginação (50 modelos por página por padrão), sem filtrar `-image`/`gemini-omni`/`transcribe`, `capabilityReasoning` sempre falso (ignora `thinking`), `outputTokenLimit` ignorado e chave em `?key=` na URL. Código: `provider-model-fetcher.service.ts:1020-1025`, `:436-437`, `:555-598` | providers | [#427](https://github.com/patrickbrandao/thinker/issues/427) | resolvida (chave em x-goog-api-key, pageSize=1000, filtro omni/transcribe, thinking) |
| G8 | degradação | Preços: `gemini-pro-latest` fixo em 1,25/10; sem faixa >200k (mesma causa do [#317](https://github.com/patrickbrandao/thinker/issues/317)); sem as viradas de 2026-12-01 (Argon 2->4/10->20, relacionado ao [#319](https://github.com/patrickbrandao/thinker/issues/319)) e 2027-01-01 (3.8/3.6 Flash); ids 2.5 passam a ser cobrados como 3.8 Flash/3.5 Flash-Lite em 2026-12-01. Código: `known-model-prices.ts:39-40` | providers | [#428](https://github.com/patrickbrandao/thinker/issues/428) | resolvida (preços semeados por provedor em provider-price-seeds.ts) |
| G9 | oportunidade | Enviar `store: false` (projetos pagos novos guardam prompts por padrão desde 2026-10-26) e expor `serviceTier` (`flex`/`priority`). Código: `google-adapter.ts:411-448` | providers | [#429](https://github.com/patrickbrandao/thinker/issues/429) | resolvida (store: false por padrão; THINKER_GEMINI_STORE=true reativa) |
| G10 | degradação | Sem chamada de função, a assinatura pode vir numa parte `{text:"", thoughtSignature}` no fim do stream (FAQ da doc de assinaturas). O adaptador só lê assinatura de parte com `text` não vazio, então a perde e não a reenvia (sem erro, mas com perda de qualidade do raciocínio). Código: `google-adapter.ts:705-712` (stream), `:537-540` (sem stream). Sugestão: guardar a assinatura de qualquer parte não `thought`, inclusive com texto vazio | providers | [#518](https://github.com/patrickbrandao/thinker/issues/518) | aberta |
| G11 | degradação | Em chamadas paralelas só a primeira `functionCall` traz assinatura e a doc pede devolver "exatamente como recebido". O adaptador põe o valor fictício em **toda** `functionCall` sem assinatura no cache, inclusive nas paralelas seguintes, que nunca tiveram assinatura. Se isso é aceito não está confirmado. Código: `google-adapter.ts:236-251`. Sugestão: usar o fictício só na primeira `functionCall` de cada turno `model` sem assinatura e deixar as demais sem; confirmar com a captura 3 | providers | [#519](https://github.com/patrickbrandao/thinker/issues/519) | aberta |
| G12 | degradação | Chave inválida no `generateContent` volta como **400 `INVALID_ARGUMENT`** com `ErrorInfo.reason: "API_KEY_INVALID"` (doc), não 401. A rotação e a memória de chave recusada só olham 401/403/429, então uma chave inválida vira um 400 comum, sem rotação no pool. Código: `proxy-fallback.service.ts:169`, `:660-662`. Sugestão: para os provedores Google, tratar 400 com `API_KEY_INVALID` como credencial recusada; confirmar com a captura 5 | backend-dev | [#520](https://github.com/patrickbrandao/thinker/issues/520) | aberta |
| G13 | degradação | Os Gemini 4 limitam cada requisição a 32.768 tokens sem stream (Carbon e Argon) e 65.536 com stream, e param com `CONTINUATION` (ou `MAX_TOKENS`) mais `continuationToken`. O adaptador converte `CONTINUATION` em `length` e descarta o token, então um cliente que pediu mais saída recebe um corte. Código: `google-adapter.ts:609-627`. Sugestão: continuar no servidor (reenviar `contents` + `continuationToken` até `maxOutputTokens`) ou pelo menos fazer o stream dos Gemini 4 por baixo quando `max_tokens` passar de 32K | providers | [#521](https://github.com/patrickbrandao/thinker/issues/521) | aberta |
| G14 | oportunidade | `thinkingLevel: XHIGH` existe (enum do discovery e `gemini-4-hydrogen`), mas `param-policy.ts:211-219` converte `xhigh`/`max` em `HIGH` para todos os modelos. Sugestão: mandar `XHIGH` ao Hydrogen (e a modelos futuros que o aceitem) | providers | [#522](https://github.com/patrickbrandao/thinker/issues/522) | aberta |
| G15 | oportunidade | As ferramentas vão em `parameters` (subconjunto OpenAPI) depois de um saneamento com perdas; `parametersJsonSchema` aceita JSON Schema (`additionalProperties`, `anyOf`, `$ref`...) sem conversão. Código: `google-adapter.ts:308-325`. Sugestão: mandar `parametersJsonSchema` e manter o saneamento só para Vertex/CodeAssist se eles não aceitarem o campo (ver `api-vertex` e `sub-gemini`) | providers | [#523](https://github.com/patrickbrandao/thinker/issues/523) | aberta |

Fora do escopo deste agente: lista de modelos e mapeamento do CodeAssist (ver `sub-gemini` G2, [#325](https://github.com/patrickbrandao/thinker/issues/325)); Vertex (`api-vertex`).

Pendente de conferência com chave real: as capturas listadas no fim de "Formato na rede"; comportamento de `thinkingBudget: 0` e `-1` no 2.5 durante o roteamento de 2026-12-01; formato exato do corpo de erro 429 (`RESOURCE_EXHAUSTED` com `QuotaFailure`, `RetryInfo`) em `generateContent`; se `GET /v1beta/models` hoje devolve mais de 50 modelos por conta.

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Documentação migrou para `aistudio.google.com` e foca na Interactions API. Registrado o estado dos modelos (Argon, 3.8/3.6 Flash, 3.5 Flash-Lite, 3.1 Pro preview; 2.5 depreciado e roteado em 2026-12-01), parâmetros removidos, prefill, assinaturas, preços com viradas de data, limites e erros. Abertas as lacunas G1 a G9 (issues #421 a #429).
- 2026-11-15: revisão parcial, só de `### Formato na rede` (o resto do contrato segue com o corte de 2026-11-04). Fontes: discovery `v1beta` rev. 20261113, `googleapis/js-genai@v3.3.0` e os guias na versão `?generate-content=true`, que a revisão anterior não tinha achado. Sondas sem credencial: `generateContent` e `GET /v1beta/models` → 403 `PERMISSION_DENIED`/`ACCESS_DENIED`; `streamGenerateContent?alt=sse` → 403 com `text/event-stream` e JSON cru; OpenAI-compat → 400 com o erro dentro de um array. A tabela de erros perdeu o 401 (só vale para a Interactions API). Confirmados os dois valores fictícios de assinatura. Abertas G10 a G15 (issues #518 a #523). Fica para a próxima revisão completa: modelos novos (`gemini-4-carbon` 2026-11-10, `gemini-4-hydrogen` 2026-11-12, `gemini-decision-1` 2026-11-11, Omni 1.2 Flash 2026-11-05) e seus preços.
