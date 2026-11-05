---
id: harness-vercel-ai-sdk
categoria: harness
entidade: Vercel AI SDK
agente: harness-vercel-ai-sdk
thinker_ids: [vercel-ai-sdk]
revisado_em: 2026-11-03
versao_observada: ai@7.0.162 (@ai-sdk/openai, @ai-sdk/openai-compatible do mesmo monorepo, commit 2feaeecb)
---

# Vercel AI SDK (harness)

Especificação mantida pelo agente `harness-vercel-ai-sdk` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Vercel AI SDK é uma biblioteca **TypeScript/JavaScript** (npm `ai` + `@ai-sdk/*`), não um agente. Não existe SDK Python oficial da Vercel; o `ai-sdk` do PyPI é de terceiros e o `ai-sdk` do npm não é da Vercel.
- Para apontar para o Thinker há dois caminhos: `@ai-sdk/openai-compatible` (`createOpenAICompatible`, fala **Chat Completions**) ou `@ai-sdk/openai` (`createOpenAI`, que desde o AI SDK 5 fala **Responses** por padrão; Chat Completions só com `.chat(id)`).
- O snippet atual do Thinker usa `createOpenAI(...)("auto")`, ou seja, na prática chama `POST /v1/responses`, apesar de o Thinker declarar a superfície como Chat Completions (G1). Com `store` verdadeiro (padrão), o SDK reenvia mensagens de assistente como `item_reference`, que o adaptador do Thinker descarta (G2).
- O SDK não envia cabeçalho de sessão: a sessão do Thinker cai sempre em `default` (G4).
- Confiança: alta para o contrato (lido no código em tag); média para o impacto de G2 (precisa de teste ao vivo). Identificação do harness: certa (repositório vercel/ai).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| AI SDK repository (código lido em clone raso) | <https://github.com/vercel/ai> | tag `ai@7.0.162`, commit `2feaeecbed6a921a27123aafa75db6af34e1f246b` (2026-11-02); npm `ai` 7.0.162, 6.0.322 (linha v6), 5.0.285 (linha v5) |
| Docs (fonte em `content/` do repositório; o site ai-sdk.dev é o render dela) | <https://ai-sdk.dev/docs/introduction> | `content/providers/01-ai-sdk-providers/03-openai.mdx` em `ai@7.0.162` |
| Provedor OpenAI-compatible | <https://ai-sdk.dev/providers/openai-compatible-providers> | `@ai-sdk/openai-compatible` 3.0.84 (npm), código em `packages/openai-compatible` |
| Provedor OpenAI | <https://ai-sdk.dev/providers/ai-sdk-providers/openai> | `packages/openai` em `ai@7.0.162` (acrescentada nesta revisão) |
| Pacote PyPI `ai-sdk` (terceiros, não é da Vercel) | <https://pypi.org/project/ai-sdk/> | não lido (PyPI bloqueou a leitura direta); só resumo de busca (não confirmado) |

Fontes sem problema de identidade: as três sementes eram corretas. O repositório também tem `packages/harness-*` (Claude Code, Codex, OpenCode, Cline etc.): são adaptadores que rodam outros harnesses dentro do AI SDK, fora do escopo desta entidade.

## Contrato

### Configuração do gateway

Fonte: `packages/openai/src/openai-provider.ts` e `packages/openai-compatible/src/openai-compatible-provider.ts` (`ai@7.0.162`).

| Pacote | Fábrica | Rota chamada | Observação |
|---|---|---|---|
| `@ai-sdk/openai` | `createOpenAI({ baseURL, apiKey, headers, organization, project, name, fetch })`; `provider(id)` e `provider.responses(id)` | `{baseURL}/responses` | padrão desde o AI SDK 5 (a doc da opção `baseURL` avisa isso explicitamente) |
| `@ai-sdk/openai` | `provider.chat(id)` | `{baseURL}/chat/completions` | caminho Chat Completions |
| `@ai-sdk/openai` | `provider.completion(id)` | `{baseURL}/completions` | legado |
| `@ai-sdk/openai-compatible` | `createOpenAICompatible({ name, baseURL, apiKey, headers, queryParams, includeUsage, supportsStructuredOutputs, fetch })`; `provider(id)` / `.chatModel(id)` | `{baseURL}/chat/completions` | `name` é obrigatório |

- `baseURL` leva o sufixo `/v1` (o código só tira a barra final); o padrão do `createOpenAI` é `https://api.openai.com/v1` e também lê `OPENAI_BASE_URL`. Para o Thinker: `http://localhost:2099/v1`.
- Chave: `apiKey` vira `Authorization: Bearer <chave>`; `createOpenAI` lê `OPENAI_API_KEY` se `apiKey` faltar (o `createOpenAICompatible` não lê variável). Chave do Thinker: `thk_...`.
- `headers` (objeto fixo no provedor) vai em toda requisição e vem **depois** de `Authorization` (pode sobrescrever). Cabeçalhos por chamada: parâmetro `headers` de `generateText`/`streamText` (`packages/ai/src/generate-text/generate-text.ts`, documentado como "somente HTTP").
- `includeUsage` (só `openai-compatible`): quando verdadeiro, o corpo de Chat Completions em streaming leva `stream_options: { include_usage: true }`; sem isso o SDK não pede o evento final de usage (`openai-compatible-chat-language-model.ts:494-496`).
- Variantes por linha de versão: `ai@7` usa spec `LanguageModelV4`; as linhas v5 e v6 continuam publicadas (5.0.285 e 6.0.322 em 2026-11-03) e mantêm o padrão Responses do `openai()`. Usuários podem estar em qualquer uma delas.

### Seleção de modelo

- O id do modelo é uma string livre passada pelo desenvolvedor (`provider("auto")`); o SDK **não chama `GET /v1/models`** (não há listagem no `createOpenAI` nem no `createOpenAICompatible`). Para `@ai-sdk/openai`, ids desconhecidos aceitam qualquer string (`(string & {})`).
- Capacidades do modelo são inferidas **pelo id** em `openai-model-catalog.ts` (ex.: se é modelo de raciocínio). Um id como `auto` ou `deepseek/flash` cai no padrão de família, ou seja, tratado como não-reasoning (leitura do código; não confirmado em execução). O desenvolvedor pode forçar com `providerOptions.openai.forceReasoning`.
- Ids com barra (`provider/modelo`) passam intactos no corpo (`model`).

### Cabeçalhos e sessão

Fonte: `packages/provider-utils/src/with-user-agent-suffix.ts`, `packages/ai/src/generate-text/generate-text.ts:724`, `packages/openai/src/openai-provider.ts:237-248`.

| Cabeçalho | Quando | Valor |
|---|---|---|
| `Authorization` | sempre | `Bearer <apiKey>` |
| `user-agent` | sempre | sufixo acrescentado ao UA da runtime: `ai/<versão do ai> ai-sdk-openai/<versão>` (para `openai-compatible`, `ai-sdk/openai-compatible/<versão>` pelo mesmo mecanismo, não conferido linha a linha); em Node o `fetch` (undici) traz o prefixo `node`, em browser o UA do navegador |
| `OpenAI-Organization`, `OpenAI-Project` | só se configurados em `createOpenAI` | strings do usuário |
| qualquer outro | só se passado em `headers` | definido pelo usuário |

- **Não há cabeçalho de sessão, de conversa, de agente pai ou `x-stainless-*`.** O SDK não gera id de sessão. Quem quiser sessão no Thinker precisa passar `x-session-key` em `headers` (fixo no provedor ou por chamada).
- Na API Responses o corpo pode levar `prompt_cache_key` e `previous_response_id`, mas só via `providerOptions.openai.promptCacheKey` / `previousResponseId` (`openai-responses-language-model.ts:626,632`), nunca por padrão.

### Outros endpoints

| Chamada do SDK | Rota | Pacote |
|---|---|---|
| `generateText` / `streamText` / `generateObject` / `streamObject` | `/chat/completions` ou `/responses` | conforme a tabela de configuração |
| `embed` / `embedMany` | `/embeddings` | `openai`, `openai-compatible` |
| `generateImage` | `/images/generations` (e `/images/edits`) | idem |
| `transcribe` / `generateSpeech` | `/audio/transcriptions`, `/audio/speech` | `openai` |
| Files, batches, realtime (WebSocket), skills | `/files`, `/batches`, `/realtime`… | `openai` (funcionalidade OpenAI-específica) |

Nenhuma chamada de telemetria, contagem de tokens ou health check. Se `/embeddings` não existir no gateway, `embed` recebe 404 (ver G6).

### Recursos usados

- Tools (function calling) em ambas as rotas; saída estruturada (`response_format`/`text.format` com JSON Schema; no `openai-compatible` só com `supportsStructuredOutputs: true`, senão cai em `json_object`).
- Raciocínio: `reasoning_effort` (Chat) e `reasoning: { effort, summary }` (Responses), via `providerOptions.openai`; leitura de `reasoning_content` em respostas Chat do `openai-compatible`.
- Imagens e arquivos em mensagens do usuário.
- Cache de prompt: só por `promptCacheKey` explícito (Responses); sem `cache_control` na rota Chat.
- Responses: `store` fica **verdadeiro por padrão** (`store: openaiOptions?.store ?? true` ao montar as opções; o campo vai omitido no corpo se não configurado). Com `store` verdadeiro o SDK reenvia saídas anteriores como `{ "type": "item_reference", "id": "msg_..." }` para mensagens de assistente de modelos não-reasoning (comentário "item references reduce the payload size") e para chamadas de ferramenta provider-defined; chamadas de função comuns **não** viram referência (o código explica que quebraria o pareamento `call_id`). Com `store: false` em modelos reasoning o SDK pede `include: ["reasoning.encrypted_content"]`. Fonte: `convert-to-openai-responses-input.ts` (linhas ~750-770, ~960-975) e `openai-responses-language-model.ts:587-592`.
- Multi-step (`stopWhen`/agentes): o SDK reenvia todo o histórico a cada passo; não usa subagentes nem requisições paralelas próprias além das chamadas de ferramenta do modelo.

### Erros e retentativas

Fonte: `packages/ai/src/util/retry-with-exponential-backoff.ts`, `packages/provider/src/errors/api-call-error.ts`.

- `maxRetries` padrão **2** (configurável por chamada), backoff exponencial que respeita `retry-after`/`retry-after-ms` quando presentes.
- Erro de API é retentável se status 408, 409, 429 ou >= 500; 4xx restante falha de imediato.
- Erros em formato OpenAI (`{ "error": { "message", "type", "code" } }`) são lidos pelo `openai-error.ts` / `openai-compatible-error.ts`; corpo fora desse formato vira mensagem genérica.
- Streaming: o SDK trata evento `error` no meio do stream (`openai-stream-error.ts`) e fim por `[DONE]`.

### Snippet de setup do Thinker

Conferido contra o contrato acima:

- TypeScript (`framework-snippets.ts:178-190`): `createOpenAI({ baseURL, apiKey, headers })` + `generateText({ model: thinker("auto") })`. **Incorreto para a superfície declarada** (usa Responses; G1). Forma correta para Chat Completions:

  ```ts
  import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
  const thinker = createOpenAICompatible({
    name: "thinker",
    baseURL: "http://localhost:2099/v1",
    apiKey: "thk_...",
    includeUsage: true,
    headers: { "x-session-key": "<id da conversa>" },
  });
  // generateText({ model: thinker("auto"), prompt: "..." })
  ```

  (equivalente com `createOpenAI(...).chat("auto")`).
- Python (`framework-snippets.ts:146-167`): `pip install ai-sdk` / `AIClient` / `generate_text`. **Não corresponde a nenhum SDK da Vercel** (G3).
- Guia de usuário: `docs/usuario/conectar-harnesses.md:133` diz "Chat Completions, URL base `http://localhost:2099/v1`": a URL e a chave estão certas; falta dizer qual fábrica usar (G1) e o cabeçalho de sessão (G4).

## Como o Thinker implementa hoje

Superfície declarada: `chat_completions` (`packages/shared/src/agent-type.ts:94`). Nome de exibição `Vercel AI SDK` (`:120`), categoria `app` (`:131`), ícone `/icons/vercel-ai-sdk.svg` (`:155`). A aba do assistente de setup usa `/icons/vercel.svg` (`packages/frontend/src/services/framework-snippets.ts:37`).

- **Rotas do proxy** (`packages/backend/src/routing/proxy/proxy.controller.ts`): `GET /v1/models` (`:176`), `POST /v1/chat/completions` (`:246`), `POST /v1/responses` (`:254`), `POST /v1/messages` (`:262`). **Não há `/v1/embeddings`, `/v1/images/*` nem `/v1/audio/*`.**
- **Sessão:** só o cabeçalho `x-session-key` é lido (`proxy.controller.ts:277`, `:899`; `proxy-session-scope.ts` constrói o escopo, e sem cabeçalho cai em `default` com cache e momentum desligados). O `provider-hooks.ts` usa `sessionKey` para `x-opencode-session`, `x-grok-conv-id` e OpenRouter (`:51-65`). O AI SDK não envia esse cabeçalho.
- **Classificação do chamador** (`packages/backend/src/routing/proxy/caller-classifier.ts:91-131`): reconhece UA `OpenAI/…`, `anthropic-…`, `curl`, `python-requests`, `node-fetch`, `axios` e `x-stainless-*`. O UA do AI SDK (`… ai/7.x ai-sdk-openai/x`) cai em `sdk: 'unknown'` (G5).
- **Adaptador Responses para Chat** (`responses-adapter.ts`): descarta itens tipados sem equivalente, inclusive `reasoning` e `item_reference` (`:97-103`); gera ids `msg_<uuid>` próprios (`:362`, `:608`, `:706`). Para `previous_response_id` deixa os ids intocados (`:244-251`).
- **Streaming de usage em Chat:** o proxy injeta `stream_options.include_usage` ao falar com provedores OpenAI-compatible (`provider-client.ts:919`, `provider-endpoints.ts:84`), então a falta de `includeUsage` no cliente não quebra o custo no Thinker.
- **Snippets:** `framework-snippets.ts:146-167` (Python) e `:178-190` (TypeScript); renderização em `FrameworkSnippets.tsx:92`. Os cabeçalhos customizados do snippet entram como `headers` no TypeScript.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/responses-adapter.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`

Arquivos que citam `vercel-ai-sdk`:

- `packages/frontend/src/components/FrameworkSnippets.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/services/framework-snippets.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Snippet TypeScript usa `createOpenAI(...)(id)`, que no AI SDK >= 5 chama `/v1/responses`, mas Thinker declara e documenta Chat Completions. Trocar por `createOpenAICompatible` (com `includeUsage: true`) ou `.chat(id)`. | frontend-dev | [#392](https://github.com/patrickbrandao/thinker/issues/392) | aberta |
| G2 | degradação | `item_reference` enviado pelo AI SDK (`store` padrão verdadeiro) é descartado em rotas traduzidas; mensagens de assistente somem do histórico. Impacto a confirmar ao vivo. | backend-dev | [#393](https://github.com/patrickbrandao/thinker/issues/393) | aberta |
| G3 | degradação | Snippet Python (`pip install ai-sdk`, `AIClient`) não corresponde a nenhum SDK da Vercel; remover ou trocar por pacote verificado. | frontend-dev | [#394](https://github.com/patrickbrandao/thinker/issues/394) | aberta |
| G4 | degradação | O AI SDK não envia cabeçalho de sessão e o snippet/guia não ensina `x-session-key` em `headers` (sessão sempre `default`). Mesma causa de #380. | frontend-dev | comentário em [#380](https://github.com/patrickbrandao/thinker/issues/380) | resolvida (snippet e guia com x-session-key) |
| G5 | oportunidade | `classifyCaller` não reconhece o UA `ai/<v> ai-sdk-<pacote>/<v>`; registra `sdk: 'unknown'`. Acrescentar regra `^.*\bai/([\d.]+)` -> `vercel-ai-sdk`. Mesma família de #373 e #387. | backend-dev | — (oportunidade, sem issue) | aberta |
| G6 | oportunidade | `embed`/`embedMany`, `generateImage`, `transcribe` e `generateSpeech` do AI SDK chamam `/v1/embeddings`, `/v1/images/*`, `/v1/audio/*`, que o Thinker não serve (404). Embeddings já registrado em #365 (Chatwoot). | backend-dev | — (ver [#365](https://github.com/patrickbrandao/thinker/issues/365)) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Fontes: clone raso de `vercel/ai` na tag `ai@7.0.162` (commit 2feaeecb), docs em `content/providers/` da mesma tag, npm (`ai` 7.0.162, `@ai-sdk/openai-compatible` 3.0.84). Identificação do harness confirmada (as três fontes semente estavam corretas; acrescentada a doc do provedor OpenAI). Abertas as issues #392-#394 (G1-G3) e comentado #380 (G4). Pendente de teste ao vivo: G2 e o UA real enviado em Node.
