---
id: harness-openai-sdk
categoria: harness
entidade: OpenAI SDK
agente: harness-openai-sdk
thinker_ids: [openai-sdk]
revisado_em: 2026-11-03
versao_observada: openai-node v7.49.0 (commit 272a6de) + openai-python v3.44.0 (commit f76da63)
---

# OpenAI SDK (harness)

Especificação mantida pelo agente `harness-openai-sdk` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Identificação: "OpenAI SDK" é o conjunto das bibliotecas oficiais `openai` (npm, repositório `openai/openai-node`, v7.49.0 de 2026-11-03) e `openai` (PyPI, `openai/openai-python`, v3.44.0 de 2026-11-03). Os dois links semente estavam corretos; ambos são gerados pela Stainless. Confiança alta na identificação.
- O README das duas bibliotecas agora apresenta a **Responses API** como superfície principal e a Chat Completions como "padrão anterior, suportado indefinidamente". O snippet do dashboard já abre em Responses; o guia `conectar-harnesses.md` ainda mostra só Chat Completions (e a classificação `agent-type.ts` declara `chat_completions`).
- O SDK **não envia nenhum cabeçalho de sessão**. Só manda `User-Agent`, `x-stainless-*`, `OpenAI-Organization`/`OpenAI-Project` (quando configurados) e `Authorization: Bearer`. Sem `x-session-key` configurado pelo usuário, toda chamada cai na sessão `default` do Thinker (G1).
- Fora de `/chat/completions`, `/responses` e `/models`, o SDK chama muitas rotas que o Thinker não serve: `/embeddings` (G2), `/models/{id}`, `/responses/{id}`, `/responses/input_tokens`, `/responses/compact`, imagens, áudio, moderações, arquivos, batches, realtime. Todas dão 404.
- A tradução Responses para Chat do Thinker descarta campos que o SDK documenta (`reasoning`, `previous_response_id`, `text.verbosity`, `prompt_cache_key`) (G3).
- Precisa de checagem ao vivo: G3 (leitura de código apenas).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| openai-node | <https://github.com/openai/openai-node> | tag `v7.49.0` (2026-11-03, commit 272a6de) |
| openai-python | <https://github.com/openai/openai-python> | tag `v3.44.0` (2026-11-03, commit f76da63) |

Os dois repositórios publicam várias versões por semana (7.45.0 em 2026-10-26, 7.49.0 em 2026-11-03). Mudanças de API vêm no CHANGELOG como `feat(api)`; mudanças de transporte (cabeçalhos, retry) são raras.

## Contrato

### Configuração do gateway

- URL base: opção `baseURL` (JS) / `base_url` (Python), ou variável `OPENAI_BASE_URL`; padrão `https://api.openai.com/v1`. O SDK concatena o caminho do recurso à URL base (`/chat/completions`, `/responses`, `/models`, `/embeddings`), então a URL do Thinker **precisa terminar em `/v1`** (`http://host:2099/v1`). (`src/client.ts:554,598,990-1006` JS; `lib/_client_auth.py:228` Python)
- Chave: `apiKey` / `api_key` ou `OPENAI_API_KEY`, enviada como `Authorization: Bearer <chave>`. Sem chave o construtor falha com "Missing credentials"; para o Thinker use a chave `thk_`. (`src/client.ts:632,892`)
- Outras variáveis: `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` (viram `OpenAI-Organization` / `OpenAI-Project`), `OPENAI_LOG`, `OPENAI_ADMIN_KEY`, `OPENAI_WEBHOOK_SECRET`.
- Cabeçalhos extras: `defaultHeaders` / `default_headers`, ou `OPENAI_CUSTOM_HEADERS` (texto com uma linha `Nome: valor` por cabeçalho; `src/client.ts:658-668` JS, `lib/_client_auth.py:236` Python). Por aqui o usuário configura `x-session-key` sem mudar código.
- Timeout padrão 10 minutos (JS 600000 ms; Python 600 s com connect 5 s); `maxRetries` padrão 2. (`client.ts:2590`; `_constants.py:7-8`)
- Novidades do SDK sem efeito no gateway: `provider`/workload identity, mTLS (`baseURL` do mTLS exige origem própria), `dataResidency`. O Thinker não precisa tratar.

### Seleção de modelo

- O SDK não tem lista de modelos embutida: o `model` é uma string livre repassada ao gateway. `auto` e os virtuais funcionam como qualquer id.
- `models.list()` chama `GET /models` e espera `{ object: "list", data: [{ id, object: "model", created, owned_by, shutdown_date? }] }` (`src/resources/models.ts:61-86`). O Thinker devolve esse formato mais campos extras (`context_length`, `capabilities`, `cost`).
- `models.retrieve(id)` chama `GET /models/{id}` (`models.ts:26`) e `models.delete(id)` `DELETE /models/{id}` (`:49`); o Thinker só serve a listagem (G6).

### Cabeçalhos e sessão

Enviados em toda requisição HTTP (`src/client.ts:2478-2487` JS; `_base_client.py:540-560,809,2307-2312` Python):

| Cabeçalho | Valor | Quando |
|---|---|---|
| `User-Agent` | `OpenAI/JS 7.49.0` ou `OpenAI/Python 3.44.0`; o nome vem da classe: `AsyncOpenAI/Python 3.44.0`, `AzureOpenAI/...` | sempre (no navegador o JS não envia) |
| `Authorization` | `Bearer <chave>` | sempre |
| `X-Stainless-Lang` | `js` / `python` | sempre |
| `X-Stainless-Package-Version` | versão do pacote | sempre |
| `X-Stainless-OS`, `X-Stainless-Arch` | SO e arquitetura | sempre |
| `X-Stainless-Runtime`, `X-Stainless-Runtime-Version` | `node`/`deno`/`edge`/`browser:*`; `CPython` etc. | sempre |
| `X-Stainless-Retry-Count` | tentativas já feitas (0 na primeira) | sempre |
| `X-Stainless-Timeout` (JS, segundos) / `x-stainless-read-timeout` (Python) | timeout efetivo | quando definido |
| `X-Stainless-Helper-Method` | ex.: `stream` | nos helpers de stream (JS) |
| `X-Stainless-Async` | `false` ou `async:<lib>` | só Python |
| `OpenAI-Organization`, `OpenAI-Project` | de `organization`/`project` ou env | só se configurados |
| `Idempotency-Key` | não usado pelo cliente OpenAI hoje (`idempotencyHeader` não definido) | nunca (não confirmado para todos os recursos) |

- **Não há cabeçalho de sessão**, de sessão-mãe nem de subagente (grep por `session` nos dois repositórios só acha o filtro de redação de logs). A identidade da conversa só existe se o usuário a configurar. O que o SDK oferece como indício de conversa são campos do **corpo**: `prompt_cache_key`, `safety_identifier`, `user` (obsoleto), `previous_response_id`, `conversation` (Responses) e `prompt_cache_key`/`user` em Chat. O Thinker já repassa um `prompt_cache_key` do chamador (`provider-client.ts:271`), mas não o usa como chave de sessão (G1).
- `X-Stainless-Retry-Count > 0` identifica retentativas do cliente; o Thinker não usa isso para deduplicar.

### Outros endpoints

| Chamada do SDK | Rota | Observação |
|---|---|---|
| `chat.completions.create/stream/parse` | `POST /chat/completions` | servida |
| `responses.create/stream/parse` | `POST /responses` | servida |
| `models.list` | `GET /models` | servida |
| `models.retrieve` / `delete` | `GET`/`DELETE /models/{id}` | 404 (G6) |
| `embeddings.create` | `POST /embeddings` | 404 (G2). JS pede `encoding_format: "base64"` por padrão e decodifica (`src/lib/embeddings.ts`) |
| `responses.retrieve/delete/cancel` | `GET`/`DELETE /responses/{id}`, `POST /responses/{id}/cancel` | 404 (G5) |
| `responses.inputItems.list` | `GET /responses/{id}/input_items` | 404 (G5) |
| `responses.inputTokens.count` | `POST /responses/input_tokens` | 404 (G5); contagem de tokens |
| `responses.compact` | `POST /responses/compact` | 404 (G5) |
| `chat.completions.retrieve/list/update/delete` | `/chat/completions/{id}` | 404; exige `store: true`, que o Thinker não oferece |
| Responses WebSocket (`responses.ws`) | WebSocket em `/responses` | sem rota (G8, não confirmado o protocolo) |
| `images`, `audio`, `moderations`, `files`, `batches`, `realtime`, `fine_tuning`, `vector_stores`, `evals`, `containers`, `conversations` | rotas próprias | fora do escopo do gateway; 404 |

O SDK não chama health nem telemetria. Um 404 vira `NotFoundError` sem retentativa.

### Recursos usados

- **Chat Completions**: streaming com `stream_options.include_usage` (a conveniência `stream()` do JS e `usage` dependem do chunk final), `tools`/`tool_choice`, `parallel_tool_calls`, `response_format` (`json_schema` com `strict`), `reasoning_effort`, `max_completion_tokens`, `prompt_cache_key`, `prompt_cache_retention`, `safety_identifier`, `service_tier`, `store`, `logprobs`, `n`, `modalities`/`audio`.
- **Responses**: `instructions`, `input` (string ou lista de itens, incluindo `reasoning`, `function_call`, `function_call_output`, `custom_tool_call`, `compaction`), `reasoning.{effort,summary}`, `text.{format,verbosity}`, `include`, `previous_response_id`, `conversation`, `store`, `truncation`, `context_management`, ferramentas hospedadas (`web_search`, `file_search`, `code_interpreter`, `mcp`, `computer`, `image_generation`, `shell`, `apply_patch`), `prompt_cache_key`, `prompt_cache_retention`, `background`, `max_tool_calls`. Eventos de stream tipados (`response.output_text.delta` etc.), numerados por `sequence_number`.
- `toResponseInputItems()` (JS) normaliza `response.output` para reenvio: o README alerta que filtrar só mensagens derruba itens de raciocínio e de ferramenta e quebra o próximo turno. O gateway deve devolver os itens de `output` completos e estáveis.
- Helpers: `chat.completions.parse` e `responses.parse` (JS, Zod) enviam `response_format`/`text.format` como `json_schema` e validam localmente; `runTools` faz o laço de ferramentas no cliente.
- O README do JS v7 avisa para quem gerencia a conversa à mão: preservar a ordem dos itens `output`.

### Erros e retentativas

Idêntico nos dois SDKs (`client.ts:2144-2250` JS; `_base_client.py:859-960` Python):

- Retenta por padrão **2 vezes** (`maxRetries`/`max_retries`): conexão/timeout, `408`, `409`, `429` e qualquer `>=500`. Os demais `4xx` não são retentados.
- O cabeçalho (não padrão) `x-should-retry: true|false` tem precedência sobre o status. O Thinker pode usá-lo para controlar o cliente.
- Espera: `retry-after-ms`, depois `retry-after` (segundos ou data HTTP). Se o valor for ausente, negativo ou maior que o teto (JS: 60 s, Python: 120 s para aceitar), usa backoff exponencial 0,5 s, dobrando até 8 s, com jitter. Python não retenta quando `Retry-After` passa de 120 s.
- Timeout de 10 minutos por requisição (e retentado). Em stream longo sem bytes, o Node pode estourar `headersTimeout`/`bodyTimeout` de 5 minutos do undici antes (JS `client.ts:390-402`).
- Corpo de erro esperado no formato OpenAI `{ "error": { "message", "type", "param", "code" } }`; o SDK usa `error.message` e `status`.
- Para 429, o SDK não diferencia limite por minuto de cota; ambos são retentados 2 vezes e depois viram `RateLimitError`.

### Snippet de setup do Thinker

- Parcialmente correto. O snippet do dashboard (`framework-snippets.ts:127-260,288-340`) usa `OpenAI(base_url=..., api_key=...)`, Responses por padrão com `store=False`, e Chat como alternativa; ele aceita `default_headers` customizados. Nada nele ensina a configurar `x-session-key` (G1).
- O guia `docs/usuario/conectar-harnesses.md:106-118` mostra só Python com `chat.completions`, sem TypeScript, sem Responses e sem as variáveis `OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_CUSTOM_HEADERS` (G7).
- Alternativa sem código: `OPENAI_BASE_URL=http://localhost:2099/v1`, `OPENAI_API_KEY=thk_...` e, para sessão, `OPENAI_CUSTOM_HEADERS="x-session-key: minha-conversa"` (um valor fixo por processo; sessões distintas exigem `default_headers`/`extra_headers` por chamada).

## Como o Thinker implementa hoje

Superfície declarada: `chat_completions` (`packages/shared/src/agent-type.ts:92`), nome `OpenAI SDK` (`:118`), categoria `app` (`:131`). A rota Responses é servida da mesma forma para qualquer harness.

Rotas (`packages/backend/src/routing/proxy/proxy.controller.ts:146-268`): `GET /v1/models` (`:176`), `POST /v1/chat/completions` (`:246`), `POST /v1/responses` (`:254`), `POST /v1/messages` (`:262`). Nada além disso sob `v1`: sem `embeddings`, `models/:id`, nem rotas de `responses/:id`. Autenticação `Bearer` ou `x-api-key` (`docs/usuario/conectar-harnesses.md:14`).

Sessão: só `x-session-key` é lido (`proxy.controller.ts:277`, `:899`; `proxy-session-scope.ts:19-37`). Sem o cabeçalho a chave é `default`, sem `providerCacheKey` nem `momentumKey`. O `prompt_cache_key` do corpo não participa.

Corpo Responses: `toChatCompletionsRequest` (`responses-adapter.ts:114-158`, usado em `proxy.service.ts:693`) copia só `model`, `temperature`, `top_p`, `stream`, `metadata`, `store`, `user`, `parallel_tool_calls`, `max_output_tokens`, `text.format`, `tools`, `tool_choice` e converte `input`/`instructions` em mensagens. `reasoning`, `previous_response_id`, `conversation`, `prompt_cache_key`, `text.verbosity` e `include` são descartados. O caminho Responses nativo (`provider-client.ts:454,609-612,820-870`) parte desse corpo já convertido e o `toResponsesRequest` (`chatgpt-adapter.ts:66-135`) força `store: false` (`:106`) e só lê `body.reasoning` (`:128`) ou `reasoning_effort`; `toNativeResponsesRequest` (`responses-adapter.ts:213-250`) é usado só para o formato `chatgpt` e força `store: false` (`:230-232`). `prompt_cache_key` do chamador é preservado quando existe (`provider-client.ts:271`).

Chat Completions: `stream_options.include_usage` é forçado nos provedores que o aceitam (`provider-client.ts:921-925`).

Classificação do chamador: `classifyCaller` (`caller-classifier.ts:36-80`) lê `User-Agent` e os `x-stainless-*`. A regex `/^OpenAI\/(\w+)\s+([\d.]+)/i` (`:97`) reconhece `OpenAI/JS` e `OpenAI/Python`, mas não `AsyncOpenAI/Python` nem `AzureOpenAI/...` (cai em `stainless-python`/`stainless-js`, `:120-127`) (G4). O CORS reflete `Access-Control-Request-Headers`, então os `X-Stainless-*` passam em preflight de navegador (`cors-csp-config.ts:108-112`).

Setup: `packages/frontend/src/services/framework-snippets.ts` (`getOpenAIChatPythonSnippet` `:127`, `getOpenAIChatTypeScriptSnippet` `:149`, `getPythonSnippets`/`getTypeScriptSnippets` `:229`/`:288`, seleção `:454-462`), com alternância Python/TypeScript e Responses/Chat em `FrameworkSnippets.tsx:153-170`. Guia: `docs/usuario/conectar-harnesses.md:106-118`.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/proxy.service.ts`
- `packages/backend/src/routing/proxy/responses-adapter.ts`
- `packages/backend/src/routing/proxy/chatgpt-adapter.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/cors-csp-config.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`

Arquivos que citam `openai-sdk`:

- `packages/frontend/src/components/FrameworkSnippets.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/services/framework-snippets.ts`

Observação: o `harness-session.ts` em desenvolvimento em outra sessão (leitura de cabeçalhos de harness) não resolve G1, porque o SDK não envia cabeçalho algum.

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O SDK `openai` (JS 7.49.0, Python 3.44.0) não envia cabeçalho de sessão; o Thinker só lê `x-session-key` e o snippet/guia não ensinam a configurá-lo (`default_headers` ou `OPENAI_CUSTOM_HEADERS`). Toda chamada cai em `default`: sem afinidade de prompt cache nem momentum. Mesma causa do caso LangChain. Sugestão: documentar nos snippets e no guia; avaliar usar `prompt_cache_key`/`safety_identifier` do corpo como fallback de sessão. | frontend-dev | [#380](https://github.com/patrickbrandao/thinker/issues/380) (comentário) | resolvida (snippet e guia com x-session-key) |
| G2 | degradação | `client.embeddings.create` chama `POST /embeddings` e recebe 404; o `ProxyController` não tem a rota. O JS pede `base64` por padrão. | backend-dev | [#365](https://github.com/patrickbrandao/thinker/issues/365) (comentário) | aberta |
| G3 | degradação | Responses traduzida para Chat descarta `reasoning`, `previous_response_id`, `conversation`, `prompt_cache_key`, `text.verbosity` e `include`; até a rota OpenAI Responses perde `reasoning.effort`, e `store` é sempre `false`, então `previous_response_id` não funciona. Confirmar ao vivo. | backend-dev | [#386](https://github.com/patrickbrandao/thinker/issues/386) | aberta |
| G4 | degradação | `classifyCaller` não reconhece `AsyncOpenAI/Python` nem `AzureOpenAI/...`; atribuição sai como `stainless-python`/`stainless-js`. | backend-dev | [#387](https://github.com/patrickbrandao/thinker/issues/387) | aberta |
| G5 | oportunidade | Rotas de Responses não servidas: `GET`/`DELETE /responses/{id}`, `POST /responses/{id}/cancel`, `GET /responses/{id}/input_items`, `POST /responses/input_tokens` (contagem de tokens) e `POST /responses/compact`. A contagem de tokens e a compactação são as úteis para um gateway sem estado. | backend-dev | — | aberta |
| G6 | oportunidade | `GET /v1/models/{id}` não existe (`models.retrieve` do SDK recebe 404). Retornar o mesmo objeto da listagem. | backend-dev | — | aberta |
| G7 | oportunidade | O guia `conectar-harnesses.md` mostra só Python/Chat Completions, enquanto o dashboard abre em Responses e o README do SDK recomenda Responses. Acrescentar TypeScript, Responses e as variáveis `OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_CUSTOM_HEADERS`; avisar que a URL base termina em `/v1`. | docs-ptbr | — | aberta |
| G8 | oportunidade | O JS v7.47+ tem modo WebSocket para Responses (`responses.ws`, aquecimento tipado). O Thinker não tem rota WebSocket; o uso é opt-in, mas quem o ligar vê falha de conexão. Protocolo e URL não verificados (não confirmado). | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra o fonte de `openai-node` v7.49.0 e `openai-python` v3.44.0 (cabeçalhos, retry, variáveis de ambiente, rotas, formato de `models`/`embeddings`) e contra o código do Thinker. Fontes semente confirmadas. Abertas G3 (#386) e G4 (#387); G1 e G2 vinculadas a #380 e #365 por comentário; G5-G8 como oportunidade, sem issue.
