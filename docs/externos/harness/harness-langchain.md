---
id: harness-langchain
categoria: harness
entidade: LangChain
agente: harness-langchain
thinker_ids: [langchain]
revisado_em: 2026-11-03
versao_observada: langchain-openai 1.7.3 (Python) e @langchain/openai 1.8.0 (JS)
---

# LangChain (harness)

Especificação mantida pelo agente `harness-langchain` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- LangChain não é um agente: é um **framework/SDK** (Python e JS) em que o app do usuário monta o cliente de modelo. Para o Thinker o que importa é o pacote de integração: `langchain-openai` (`ChatOpenAI`, Chat Completions ou Responses) e `langchain-anthropic` (`ChatAnthropic`, Messages). Identificação com **alta confiança** (os dois repositórios semente existem e estão ativos; versões lidas em 2026-11-03).
- Para apontar para um gateway basta `base_url` + `api_key` (Python) ou `configuration.baseURL` + `apiKey` (JS), ou as variáveis `OPENAI_API_BASE` / `OPENAI_BASE_URL`. O modelo é sempre o string passado pelo código (`model="auto"`); LangChain não chama `GET /v1/models`.
- **Não envia nenhum cabeçalho de sessão ou de app.** O tráfego carrega só os cabeçalhos do SDK `openai` / `anthropic` (User-Agent `OpenAI/Python`, `x-stainless-*`). Toda chamada cai na sessão `default` do Thinker, a menos que o usuário passe `x-session-key` em `default_headers` (lacuna G1, [#380](https://github.com/patrickbrandao/thinker/issues/380)).
- Armadilhas de compatibilidade: (1) com `base_url` definido o Python **não** liga `stream_usage` (sem usage no streaming; JS liga por padrão); (2) `ChatOpenAI` muda sozinho para **`/v1/responses`** em certos casos (modelo `codex`/`*-pro`/`gpt-5.6-sol`, `gpt-6*` com tools, argumentos `reasoning`/`include`/`text`/`truncation`); (3) `ChatOpenAI` ignora `reasoning_content` de provedores não OpenAI.
- O snippet do Thinker (Python `ChatOpenAI`) continua correto; só falta a variante JS, `stream_usage` e a dica de `x-session-key` (G1 a G3).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| LangChain (Python) repository | <https://github.com/langchain-ai/langchain> | `main` commit f1ca47a (2026-11-03): `langchain-openai` 1.7.3, `langchain-anthropic` 1.7.9, `langchain` 1.4.8, `langchain-core` 1.7.4 |
| LangChain.js repository | <https://github.com/langchain-ai/langchainjs> | `main` commit e95d84f (2026-11-03): `@langchain/openai` 1.8.0, `@langchain/anthropic` 1.6.0, `langchain` 1.6.1, `@langchain/core` 1.3.4 |

Os dois links semente eram os projetos certos; nada foi trocado. Leitura feita em clone raso de `main` (não em tag), por isso as versões acima vêm de `pyproject.toml` / `package.json`. Docs em `docs.langchain.com` não foram necessárias (o contrato sai do código).

## Contrato

### Configuração do gateway

- **Python `ChatOpenAI`** (`libs/partners/openai/langchain_openai/chat_models/base.py:866-876`): ordem de resolução do endpoint: kwarg `base_url`/`openai_api_base`, depois env `OPENAI_API_BASE`, depois `OPENAI_BASE_URL` (esta lida pelo SDK `openai`). Chave: `api_key` ou `OPENAI_API_KEY`. `default_headers` e `default_query` repassados ao cliente (`:1469`). Requer `openai>=2.45.0`.
- **JS `ChatOpenAI`** (`libs/providers/langchain-openai/src/chat_models/base.ts:563-575`): `configuration.baseURL`, depois `OPENAI_API_BASE`, depois `OPENAI_BASE_URL`. `apiKey` ou `OPENAI_API_KEY`. Requer `openai ^7.47.0`.
- **`ChatAnthropic`**: Python `base_url` (alias de `anthropic_api_url`), env `ANTHROPIC_API_URL`, depois `ANTHROPIC_BASE_URL` (`libs/partners/anthropic/langchain_anthropic/chat_models.py:1423-1427,1733`); JS `anthropicApiUrl` com as mesmas envs (`libs/providers/langchain-anthropic/src/chat_models.ts:1112-1115`). Fala `POST /v1/messages`. O Thinker serve essa rota, mas o guia só cita Chat Completions para LangChain.
- Também existe um modo "gateway LangSmith" (`_resolve_gateway_config`) que só preenche `base_url`/chave quando variáveis do LangSmith estão presentes; irrelevante para o Thinker.
- A URL base deve incluir `/v1` (o SDK anexa `/chat/completions`).

### Seleção de modelo

- Id vem do código do app (`model=`/`model:`). Não há descoberta via `GET /v1/models`. Nomes de modelos virtuais do Thinker passam sem alteração; o único tratamento por nome é a escolha de API (abaixo).
- **Escolha automática de API no `ChatOpenAI` Python** (`base.py:2016-2033,776-779,4629-4641`): usa `/v1/responses` se `use_responses_api=True`, ou se o modelo começa com `gpt-5-pro`, `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro`, `gpt-5.6-sol`, ou contém `codex`, ou começa com `gpt-6` e há `tools`, ou se `reasoning`, `include`, `truncation`, `context_management`, `text`, `previous_response_id` ou `output_version="responses/v1"` estão em uso, ou há ferramenta nativa (web search etc.). Caso contrário, Chat Completions.
- JS (`src/chat_models/index.ts:701-722`): `useResponsesApi` padrão `false`; liga se há ferramentas nativas/custom, `previous_response_id`, `text`, `truncation`, `include`, `reasoning.summary`, ou modelo que prefere Responses.
- Modelo de raciocínio no JS troca `max_tokens` por `max_completion_tokens` (`completions.ts:198`).
- Consequência: um virtual do Thinker chamado, por exemplo, `gpt-6-...` com tools, ou contendo `codex`, vai a `/v1/responses` mesmo que o usuário queira Chat Completions. O Thinker serve `/v1/responses`, então funciona; só vale saber.

### Cabeçalhos e sessão

- LangChain **não adiciona** cabeçalho de sessão, sessão-mãe, projeto ou nome de app (grep por `session`, `x-title`, `referer` nos dois pacotes OpenAI; único cabeçalho extra é o que o usuário passa em `default_headers` / `configuration.defaultHeaders`). Não há `x-session-key`.
- Cabeçalhos de fato enviados: os do SDK `openai` (`User-Agent: OpenAI/Python <v>` ou `OpenAI/JS <v>`, `x-stainless-*`, `Authorization: Bearer <api_key>`); para `ChatAnthropic`, os do SDK `anthropic` (`x-api-key`, `anthropic-version`). Valores exatos de User-Agent vêm do SDK, não do LangChain (não confirmado em tag do SDK).
- `organization` vira `OpenAI-Organization` (de `OPENAI_ORG_ID`); o gateway pode ignorar.
- Subagentes: LangChain/LangGraph não têm conceito de sessão-mãe no protocolo HTTP. Chamadas paralelas (RunnableParallel, `batch`, subgrafos) saem como requisições independentes e simultâneas.

### Outros endpoints

- Só inferência: `POST {base}/chat/completions` ou `POST {base}/responses` (OpenAI), `POST {base}/v1/messages` (Anthropic). Embeddings (`OpenAIEmbeddings`) usam `POST {base}/embeddings` quando o app os usa; o Thinker não tem rota de embeddings (lacuna já registrada em [#365](https://github.com/patrickbrandao/thinker/issues/365), mesma causa).
- Sem token counting, health ou telemetria contra o gateway. (Telemetria do LangSmith, se o usuário ligar `LANGSMITH_TRACING`, vai para o LangSmith, não para o gateway.)

### Recursos usados

- Chat Completions com streaming, tool calls (`tools`, `tool_choice`, `parallel_tool_calls`), saída estruturada (`response_format` / `json_schema`, ou tool call), imagens (partes `image_url`), `user`, `n`, `logprobs`, `max_completion_tokens`.
- Cache de prompt: `prompt_cache_key` / `prompt_cache_retention` só se o usuário passar.
- **Usage em streaming**: Python liga `stream_options={"include_usage": true}` **apenas** quando não há `base_url`, proxy ou cliente próprio e `OPENAI_BASE_URL` não está definido (`base.py:896-905,1435-1454`). Com gateway fica desligado, e `usage_metadata` não vem no stream, salvo `stream_usage=True`. JS: `streamUsage = true` por padrão (`base.ts:306`; `completions.ts:131-132`).
- Raciocínio: `ChatOpenAI` extrai só campos do padrão OpenAI. `reasoning_content` e `reasoning_details` de provedores não OpenAI **não são lidos nem preservados** (aviso no módulo, `base.py:1-12`); o raciocínio chega só via Responses (`reasoning`) ou pacotes específicos (`ChatDeepSeek`, `ChatOpenRouter`). Para o Thinker isso significa que o pensamento de modelos roteados por Chat Completions é descartado no cliente, sem relação com o gateway.
- Compactação/sumarização: feita pelo app (middleware do `langchain` v1), como chamadas comuns ao modelo.

### Erros e retentativas

- Python: `max_retries` repassado ao SDK `openai` (padrão do SDK, em torno de 2 retentativas, não confirmado em tag); timeouts `request_timeout` e `stream_chunk_timeout` opcionais (`base.py:888,1105`).
- JS: o cliente `openai` é criado com `maxRetries: 0` (`base.ts:732`) e quem retenta é o `AsyncCaller` do `@langchain/core` (padrão **6** retentativas, backoff exponencial). Não retenta 400, 401, 402, 403, 404, 405, 406, 407, 409, 413 (`async_caller.ts:7-18`); retenta os demais status (429, 5xx; lista não conferida item a item). Respeita `retry-after` até 60 s antes de retentar sozinho (`:20`); `insufficient_quota` é tratado como erro não retentável (`:293-295`).
- Recomendação ao Thinker: 429/5xx transitórios com `retry-after`; 4xx claros e rápidos para modelo inexistente (400/404, não retentados).

### Snippet de setup do Thinker

- Python: `ChatOpenAI(base_url=..., api_key=..., model="auto")` está **correto** para `langchain-openai` 1.7.3. Falta (a) `stream_usage=True` se o app quiser tokens no streaming e (b) `default_headers={"x-session-key": ...}` para sessão (G1, G2).
- JS: não existe variante; a aba LangChain força Python (`framework-snippets.ts:486-487`). Equivalente correto: `new ChatOpenAI({ model: "auto", apiKey, configuration: { baseURL } })` (G3).

## Como o Thinker implementa hoje

Superfície: Chat Completions (`packages/shared/src/agent-type.ts:95`). Plataforma `langchain` em `AGENT_PLATFORMS` (`agent-type.ts:45`), nome `LangChain` (`:121`), categoria `app` (`:131`), ícone (`:156`).

Sessão do chamador (entrada): só `x-session-key` é lido (`packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`, via `buildProxySessionScope` em `proxy-session-scope.ts`). Sem o cabeçalho, sessão `default`. Como LangChain não envia cabeçalho de sessão, vale para todo tráfego dele. Classificação do chamador: `caller-classifier.ts:50-66,97-100` reconhece `OpenAI/<lang> <versão>` e `x-stainless-*`, então um `ChatOpenAI` aparece como SDK `openai-python` / `openai-js`, não como LangChain.

Uso de usage em streaming: o Thinker pede `stream_options.include_usage` ao provedor quando o endpoint exige (`provider-client.ts:919-924`), independentemente do cliente; tokens e custo são registrados no servidor. O cliente LangChain Python não receberá o chunk de usage se não pedir (G2).

Rotas servidas relevantes: `GET /v1/models` (`proxy.controller.ts:176`), `POST /v1/responses` (`:254`), `POST /v1/messages` (`:262`) e Chat Completions.

Setup:
- `packages/frontend/src/services/framework-snippets.ts:231-246` gera o snippet Python `ChatOpenAI` (com `default_headers` só se houver cabeçalhos personalizados configurados, via `headerLine` `:114-125`); `:471-472` e `:486-487` ligam a aba LangChain ao snippet Python.
- `packages/frontend/src/components/SetupStepAddProvider.tsx:38` mapeia a plataforma para o snippet.
- `docs/usuario/conectar-harnesses.md:133` descreve LangChain junto de Vercel AI SDK, n8n e cURL (URL base `http://localhost:2099/v1`, chave `thk_`); `:147` diz que o modelo vem do parâmetro `model`. Não cita `x-session-key` (nem `docs/usuario` nem o frontend o mencionam).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/frontend/src/services/framework-snippets.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | LangChain não envia cabeçalho de sessão e o snippet/guia não ensina `x-session-key` em `default_headers`; todo tráfego cai na sessão `default` (sem cache de provedor nem momentum). Causa distinta de #318/#320/#369 (lá o harness envia cabeçalho próprio e o Thinker não lê). | frontend-dev | [#380](https://github.com/patrickbrandao/thinker/issues/380) | aberta |
| G2 | oportunidade | Python com `base_url` não liga `stream_usage`; o snippet poderia incluir `stream_usage=True` (comentado) para o app receber tokens no streaming. | frontend-dev | — (oportunidade) | aberta |
| G3 | oportunidade | Sem variante JS do snippet (`@langchain/openai`, `configuration.baseURL`); a aba LangChain só mostra Python. | frontend-dev | — (oportunidade) | aberta |
| G4 | oportunidade | Guia só cobre `ChatOpenAI`; `ChatAnthropic` (`base_url` / `ANTHROPIC_BASE_URL`) poderia apontar para `/v1/messages` do Thinker, aproveitando prompt cache e thinking nativos. Documentar em `conectar-harnesses.md`. | frontend-dev | — (oportunidade) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Fontes lidas em clone raso de `main` dos dois repositórios (commits f1ca47a e e95d84f). Identificação confirmada (frameworks, não agente). Contrato escrito, código do Thinker mapeado com `path:line`, 4 lacunas (1 issue aberta: #380).
