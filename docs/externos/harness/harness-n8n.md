---
id: harness-n8n
categoria: harness
entidade: n8n
agente: harness-n8n
thinker_ids: [n8n]
revisado_em: 2026-11-03
versao_observada: n8n 2.47.0 (master, commit 44bc5b0fec5507b401041de0f4271d5644f3f4a8); stable = 2.46.4
---

# n8n (harness)

Especificação mantida pelo agente `harness-n8n` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Identificação: o harness é o **n8n** (`n8n-io/n8n`, plataforma de automação de workflows). Identidade confirmada com confiança: o nome da fonte semente e o repositório batem. Não é um agente de código: ele chama o Thinker a partir de nodes de IA (AI Agent, Basic LLM Chain, Embeddings) que usam a **credencial OpenAI com Base URL personalizada**.
- Versões em 2026-11-03: `stable` aponta para `n8n@2.46.4`; `master` está em 2.47.0; existe uma pré-versão `n8n@3.1.0` (beta).
- O node **OpenAI Chat Model** (`lmChatOpenAi`, versões 1 a 1.3) usa o cliente `openai` JS via `@langchain/openai` 1.4.4. **Na versão 1.3 (nodes novos) a opção "Use Responses API" vem ligada**, então o n8n chama `POST {Base URL}/responses` por padrão, e não Chat Completions. Em nodes 1.2 ou anteriores, ou com a opção desligada, chama `/chat/completions`. O Thinker declara n8n como Chat Completions (lacuna G2).
- O n8n **não envia nenhum id de sessão**. Só dá para injetar um cabeçalho fixo por credencial ("Add Custom Header"), que serve para `x-session-key` por workflow (lacuna G1).
- Seleção de modelo: lista via `GET {Base URL}/models` (Bearer), que em host não-OpenAI mostra todos os ids, incluindo `auto`; também aceita digitar o id. O Thinker já serve esse endpoint com `auto` e os virtuais; o snippet atual (Base URL / API Key / Model `auto`) segue correto.
- Fora o chat, o n8n usa `/embeddings`, `/audio/*`, `/images/*`, `/files` e `/conversations` pela mesma credencial; o Thinker só tem chat, responses e models (G3, oportunidade, ligada a #365/#366).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| n8n repository (código dos nodes e credenciais) | <https://github.com/n8n-io/n8n> | `master` commit 44bc5b0fec5, versão 2.47.0 (2026-11-03); release `stable` = `n8n@2.46.4` |
| Credencial OpenAI (fonte) | `packages/nodes-base/credentials/OpenAiApi.credentials.ts` | commit 44bc5b0fec5 |
| Node OpenAI Chat Model (fonte) | `packages/@n8n/nodes-langchain/nodes/llms/LMChatOpenAi/` | commit 44bc5b0fec5 |
| OpenAI credentials docs (semente) | <https://docs.n8n.io/integrations/builtin/credentials/openai/> | 2026-11-03: **desatualizada**, lista só API Key e Organization ID e não menciona Base URL; usar o fonte como verdade |

Nota sobre as fontes semente: o repositório está correto. A página de docs vale como referência de produto, mas não documenta o campo Base URL que o Thinker depende; por isso a verdade aqui é o código da credencial.

## Contrato

### Configuração do gateway

- Credencial `openAiApi` ("OpenAI"): campos `apiKey` (obrigatório), `organizationId`, `url` (padrão `https://api.openai.com/v1`, rótulo "Base URL"), `header` (booleano), `headerName`, `headerValue`. (OpenAiApi.credentials.ts)
- Autenticação: `Authorization: Bearer <apiKey>` e `OpenAI-Organization: <organizationId>` (vazio se não preenchido). Se `header` estiver ligado, envia mais um cabeçalho fixo `<headerName>: <headerValue>`.
- A Base URL deve incluir o prefixo: o Thinker usa `http://<host>:2099/v1`. O n8n concatena `/models`, `/chat/completions`, `/responses`, `/embeddings` etc. diretamente nela. O botão de teste da credencial faz `GET {url}/models`.
- O node OpenAI Chat Model também aceita a opção "Base URL" por node (`options.baseURL`); ela só vale se a credencial permitir o domínio (`assertOpenAiCredentialAllowsUrl`).
- **n8n em Docker:** `localhost` dentro do contêiner do n8n não alcança o Thinker no host; é preciso `host.docker.internal` ou a rede do Compose. Independente disso, a proteção SSRF do n8n (`N8N_SSRF_PROTECTION_ENABLED`, desligada por padrão) bloqueia faixas privadas se ligada; nesse caso é preciso liberar o host em `N8N_SSRF_ALLOWED_HOSTNAMES` ou `N8N_SSRF_ALLOWED_IP_RANGES`. (ssrf-protection.config.ts)

### Seleção de modelo

- Node OpenAI Chat Model v1.2+: campo `model` do tipo resource locator, modo "From List" (`searchModels`) ou "ID". Padrão `gpt-5-mini`, que o usuário precisa trocar por `auto` ou por um modelo virtual. Em v1/1.1 é uma lista simples com o mesmo `GET /models`. (LmChatOpenAi.node.ts, methods/loadModels.ts)
- A listagem chama `GET {Base URL}/models` com Bearer e lê `data[].id`. Em host diferente de `api.openai.com` e `ai-assistant.n8n.io` **inclui todos os ids**; no host oficial filtra famílias não-chat. Ordena por nome. (`@n8n/ai-utilities/src/model-discovery/providers/openai.ts`)
- O n8n não conhece janela de contexto nem capacidades do modelo; envia o id escolhido em `model` e o resto é por conta do Thinker.

### Cabeçalhos e sessão

| Cabeçalho | Valor | Quando |
|---|---|---|
| `Authorization` | `Bearer <apiKey>` | sempre |
| `OpenAI-Organization` | `organizationId` da credencial | sempre (pode ir vazio) |
| `openai-platform` | `org-qkmJQuJ2WnvoIKMr2UJwIJkZ` (fixo, `AiConfig.openAiDefaultHeaders`) | nos nodes de chat e embeddings, também com Base URL customizada |
| cabeçalho da credencial | `headerName: headerValue` | só se "Add Custom Header" estiver ligado |
| `User-Agent`, `x-stainless-*` | `OpenAI/JS <versão>` e metadados do SDK `openai` 6.46.0 | sempre |

- **Não há id de sessão, de workflow nem de execução.** O único jeito de identificar uma conversa é o cabeçalho fixo da credencial. Para o Thinker, `x-session-key` por credencial dá uma sessão por workflow, não por execução.
- Opção "Prompt Cache Key" (Responses, v1.3) envia `prompt_cache_key` no corpo e "Conversation ID" envia `conversation`; ambos opcionais e vazios por padrão.
- O `User-Agent` `OpenAI/JS x.y.z` é reconhecido por `classifyCaller` como `openai-js`; o n8n não aparece pelo nome nos logs.

### Outros endpoints

- `GET /models`: teste da credencial e dropdown de modelos; falha de rede ou 4xx impede a listagem, mas o usuário ainda pode digitar o id.
- `POST /embeddings`: node Embeddings OpenAI, com a mesma credencial (`EmbeddingsOpenAi.node.ts`).
- Node OpenAI (vendor, `nodes/vendors/OpenAi`): `/audio/transcriptions`, `/audio/translations`, `/audio/speech`, `/images/*`, `/files`, `/conversations`, vídeo e `/responses`, todos em `{credencial.url}{endpoint}` (`transport/index.ts`). Fora do escopo atual do Thinker.
- Sem token counting, telemetria própria ou health check dirigidos ao provedor.

### Recursos usados

- Chat com ferramentas (AI Agent): usa tool calling nativo; `supportsStrictToolCalling: false` para compatibilidade com backends OpenAI-compatíveis (não envia `strict`).
- Streaming: depende do node/agente; sem exigência especial.
- Opções de chat: `temperature`, `maxTokens`, `frequencyPenalty`, `presencePenalty`, `topP`, `timeout` (padrão 60000 ms), `maxRetries` (padrão 2), `responseFormat` (`json_object`), `reasoning_effort` (`low|medium|high`, só em `o1`, `o3+`, `gpt-5*`) e **Extra Body** (JSON livre mesclado ao corpo).
- Responses API (v1.3, ligada por padrão): ferramentas nativas opcionais (`web_search`, `file_search`, `code_interpreter`), prompt salvo, `service_tier`, `safety_identifier`, `metadata`, `top_logprobs`. Só são enviadas se o usuário configurar.
- Imagens e PDFs entram pelo node/agente quando o modelo suporta; compactação e subagentes não existem como no Claude Code. Um AI Agent pode disparar várias chamadas por execução (loop de ferramentas).

### Erros e retentativas

- `maxRetries: 2` por padrão, com `timeout` de 60 s por tentativa (configuráveis, `-1` desliga o timeout nos embeddings). Cadeia de fallback longa no Thinker pode estourar 60 s e gerar nova tentativa (custo duplicado).
- O tratamento customizado (`openAiFailedAttemptHandler`): 404 `invalid_request_error` com `param: model` e "not a chat model" gera a dica "Enable Use Responses API"; `RateLimitError` (429) vira mensagem amigável (`insufficient_quota`, `rate_limit_exceeded`). Os demais erros seguem o retry padrão do SDK `openai` (conexão, 408, 409, 429, >=500).
- Para o gateway, 429 deve trazer `error.code` coerente e `Retry-After` quando houver.

### Snippet de setup do Thinker

O snippet atual (`setup-snippets.ts:102`, `N8nSetup.tsx`) manda criar uma credencial OpenAI com Base URL `<base>/v1`, API Key `thk_...` e usar o modelo `auto` no node OpenAI Chat Model. Continua correto para conexão e chamada. Faltam: o toggle "Use Responses API" (G2), o cabeçalho `x-session-key` (G1) e o aviso de Docker/SSRF.

## Como o Thinker implementa hoje

- Superfície declarada: `chat_completions` (`packages/shared/src/agent-type.ts:80`); categoria `automation` (`agent-type.ts:130`); ícone `/icons/n8n.svg` (`agent-type.ts:141`); id `n8n` (`agent-type.ts:30`); rótulo `n8n` (`agent-type.ts:106`).
- Snippet: `getN8nSnippet` (`packages/shared/src/setup-snippets.ts:102-108`) registrado em `PLATFORM_SETUP_SNIPPETS` (`setup-snippets.ts:118`): Base URL `${baseUrl}`, API Key e modelo `auto`.
- Dashboard: `packages/frontend/src/components/N8nSetup.tsx` (campos Base URL / API Key / Model `auto`; link para a doc da credencial OpenAI do n8n); textos em `packages/frontend/src/i18n/locales/en/harnesses.ts:276-280`; dica de modelos em `en/models.ts:178` (diz que o dropdown de modelos lê `/models`, o que confere com `loadModels.ts`).
- Guia do usuário: `docs/usuario/conectar-harnesses.md:133` ("usam a superfície Chat Completions") e `:147`.
- Rotas servidas: `GET /v1/models` (`proxy.controller.ts:176`, inclui `auto` e virtuais, com `context_length` quando conhecido), `POST /v1/chat/completions` (`proxy.controller.ts:246`) e `POST /v1/responses` (`proxy.controller.ts:254`, com adaptador Responses para Chat em `responses-adapter.ts`, que descarta ferramentas hospedadas e itens desconhecidos). Não há `/v1/embeddings`, `/v1/audio/*`, `/v1/images/*`, `/v1/files`, `/v1/conversations`.
- Sessão: apenas `x-session-key` (`proxy.controller.ts:277`, `:899`; `provider-hooks.ts:41,50`); sem o cabeçalho, sessão `default` do agente.
- Atribuição de cliente: `classifyCaller` (`packages/backend/src/routing/proxy/caller-classifier.ts:35`) reconhece o UA `OpenAI/JS` como `openai-js` e lê `x-stainless-*`; o n8n não é identificado pelo nome.
- Uso de `PLATFORM_API_SURFACES`: apenas `packages/backend/src/mcp/tools/routing.tools.ts:361` (endpoint de teste do MCP) e o CLI (`packages/cli/src/commands/routing.ts:423`).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/responses-adapter.ts`
- `packages/backend/src/mcp/tools/routing.tools.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/N8nSetup.tsx`

Arquivos que citam `n8n`:

- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | n8n não envia cabeçalho de sessão; o snippet/guia não ensina o cabeçalho personalizado da credencial com `x-session-key`, então toda requisição cai na sessão `default`. Mesma causa de #380, #378, #369. Arquivos: `setup-snippets.ts`, `N8nSetup.tsx`, `conectar-harnesses.md`. | frontend-dev | [#383](https://github.com/patrickbrandao/thinker/issues/383) | aberta |
| G2 | degradação | Node OpenAI Chat Model 1.3 usa `/v1/responses` por padrão; Thinker declara n8n como `chat_completions` e o guia diz Chat Completions, sem mencionar o toggle "Use Responses API" nem que ferramentas nativas só funcionam em rotas Responses nativas. Arquivos: `agent-type.ts:80`, `conectar-harnesses.md:133`, `N8nSetup.tsx`. | frontend-dev | [#384](https://github.com/patrickbrandao/thinker/issues/384) | aberta |
| G3 | oportunidade | Embeddings (`/v1/embeddings`), áudio, imagens e arquivos da credencial OpenAI do n8n não existem no Thinker. Acompanhado por #365 (embeddings) e #366 (áudio). | backend-dev | #365, #366 (já abertas) | aberta |
| G4 | oportunidade | Guia/snippet sem aviso de n8n em Docker (`host.docker.internal`), da proteção SSRF do n8n e de `timeout` 60 s / `maxRetries` 2 padrão do node frente a cadeias de fallback longas. | frontend-dev | sem issue | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra n8n 2.47.0 (`master`, commit 44bc5b0fec5) e `stable` 2.46.4. Identidade confirmada; fonte semente de docs marcada como desatualizada (sem Base URL). Lacunas G1 e G2 abertas (#383, #384); G3 ligada a #365/#366 (comentário em #365); G4 sem issue.
