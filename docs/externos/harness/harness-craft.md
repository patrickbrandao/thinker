---
id: harness-craft
categoria: harness
entidade: Craft Agent
agente: harness-craft
thinker_ids: [craft]
revisado_em: 2026-11-03
versao_observada: craft-agents-oss v0.15.8 (commit 1627c43), pi-ai 1.1.0
---

# Craft Agent (harness)

Especificação mantida pelo agente `harness-craft` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- **Identificação:** "Craft Agent" é o app open source Craft Agents (repositório `lukilabs/craft-agents-oss`, Apache-2.0, da Craft Docs). A semente do dossiê estava certa; confirmada pelo `package.json` (`craft-agent` 0.15.8) e pela última release `v0.15.8` (2026-11-03). Confiança alta.
- Para um gateway, o Craft usa uma **conexão "Custom"** (chave de API + URL base). No código v0.15.8 essa conexão roda no backend **Pi** (`@earendil-works/pi-ai` 1.1.0) com protocolo `openai-completions` (padrão) ou `anthropic-messages` (alternável). O README do repositório ainda diz que endpoints de terceiros usam o Claude Agent SDK; o código atual contradiz isso (README desatualizado) para o preset "Custom".
- **Seleção de modelo:** o usuário digita o id do modelo (obrigatório, lista separada por vírgula). O Craft **não** chama `GET /v1/models` do gateway. Por isso `auto` precisa ser digitado, como o snippet do Thinker já manda.
- **Sessão:** o Craft **não envia nenhum cabeçalho de sessão** a endpoints personalizados com `openai-completions` (o pi-ai só manda `x-session-affinity`/`session_id`/`x-session-id` para OpenRouter, e `prompt_cache_key` só para `api.openai.com`), e a conexão não permite cabeçalhos próprios. No Thinker toda sessão do Craft cai em `default` (G1).
- Valores padrão do modelo registrado: contexto 131072, saída 8192, sem imagens, sem reasoning. O guia do Thinker não avisa (G2, issue #379).
- O Craft traz um preset de marca **"Manifest"** (`https://app.manifest.build/v1`, placeholder `mnfst_...`) que é o antecessor do Thinker; não existe preset Thinker (G3).
- O snippet atual do Thinker (URL base com `/v1`, modelo `auto`, chave `thk_`) está **correto** para o fluxo "Custom + OpenAI Completions".

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Craft Agents (código, README) | <https://github.com/lukilabs/craft-agents-oss> | tag `v0.15.8` (2026-11-03, commit 1627c43e93bb); confirmada como o projeto certo (semente verificada) |
| Pi SDK usado pelo Craft (`@earendil-works/pi-ai`, driver `openai-completions` e `anthropic-messages`) | npm `@earendil-works/pi-ai@1.1.0` (pacote lido em disco, sem executar) | 1.1.0 |
| Releases do Craft Agents | `gh api repos/lukilabs/craft-agents-oss/releases` | v0.15.8 (anteriores: 0.15.6, 0.15.5, 0.15.4, 0.15.3; cadência de ~1-3 por semana) |
| Docs do produto | <https://github.com/lukilabs/craft-agents-oss/blob/main/README.md> (seção "Supported LLM Providers") | v0.15.8; desatualizada quanto ao backend de endpoints personalizados |

## Contrato

### Configuração do gateway

- Fluxo na UI: nova conexão por chave de API, preset **Custom**, campos: chave, URL base, protocolo (alternância `openai-completions` / `anthropic-messages`, padrão `openai-completions`), modelo padrão e lista de modelos. (`apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx:126,211,526-546,403-432`; `submit-helpers.ts`, `resolveCustomEndpointPayload`)
- A URL base é passada ao cliente OpenAI do pi-ai como `baseURL` e a rota chamada é `{baseURL}/chat/completions`; por isso os presets OpenAI-compatíveis terminam em `/v1` (OpenAI, Groq, Mistral, Manifest). Para o Thinker a URL deve ser `http(s)://host:2099/v1`. (`ApiKeyInput.tsx:101-125`; `pi-ai/dist/api/openai-completions.js:532-565`)
- Auth: `Authorization: Bearer <chave>` (`authHeader: true`, `packages/pi-agent-server/src/index.ts:515`). Em `localhost`/`127.0.0.1`/`::1` sem chave o Craft usa o placeholder `not-needed`; para host remoto sem chave avisa e a requisição falha (`index.ts:458-470`). Com protocolo `anthropic-messages` o pi-ai usa `x-api-key` e rota `/v1/messages` (não confirmado o formato exato da URL base nesse modo).
- Configuração persistida em `~/.craft-agent/config.json` (`llmConnections[]`: `providerType` `pi_compat`, `baseUrl`, `models`, `defaultModel`, `customEndpoint: { api, supportsImages?, maxTokens? }`). Schema Zod em `packages/shared/src/config/validators.ts:82-100`. Pode ser editado à mão.
- Existe também o fluxo Anthropic (Claude Agent SDK, `providerType: anthropic`, `ANTHROPIC_BASE_URL`), que falaria Anthropic Messages com os cabeçalhos do Claude Code (ver [harness-claude-code](harness-claude-code.md)). Se uma URL base personalizada chega a esse fluxo na v0.15.8 não foi confirmado (não confirmado); o preset "Custom" cai no Pi.

### Seleção de modelo

- Para endpoint personalizado, o modelo padrão é **obrigatório** e a lista é digitada (`ApiKeyInput.tsx:403-409`, "Default model is required for custom endpoints"). Sem chamada a `/v1/models`: o `fetchModels` do driver Pi usa o catálogo estático do SDK, não o endpoint (`packages/shared/src/agent/backend/internal/drivers/pi.ts:210-231`).
- Ids com prefixo `pi/` têm o prefixo removido antes do envio (`custom-endpoint-models.ts`, `stripPiPrefix`). `auto` e os modelos virtuais do Thinker passam como estão.
- Padrões por modelo registrado (`buildCustomEndpointModelDef`): `contextWindow` 131072, `maxTokens` 8192 (`DEFAULT_CUSTOM_ENDPOINT_MAX_TOKENS`), `input` só texto, `reasoning: false`, `cost` zerado, `compat.supportsStore = false` para `openai-completions`. Cada modelo aceita `contextWindow` e `supportsImages` próprios na lista `models`; a conexão aceita `customEndpoint.maxTokens` e `customEndpoint.supportsImages`.

### Cabeçalhos e sessão

Requisição Chat Completions (pi-ai 1.1.0, `openai-completions.js`):

| Cabeçalho | Valor | Quando |
|---|---|---|
| `Authorization` | `Bearer <chave>` | sempre |
| `User-Agent` | `pi (<plataforma> <release>; <arch>)`, por exemplo `pi (darwin 25.0.0; arm64)` | sempre; substitui o UA do SDK OpenAI (`pi-user-agent.js`) |
| `x-stainless-*` | cabeçalhos do SDK `openai` para Node | sempre (SDK OpenAI; não confirmado que o UA próprio os preserva) |

- **Sem cabeçalho de sessão.** `sendSessionAffinityHeaders` só é verdadeiro para OpenRouter (`detectCompat`, linha 1297); então `x-session-affinity`, `x-client-request-id`, `session_id` e `x-session-id` **não** saem para o Thinker. `prompt_cache_key` só é preenchido quando a URL contém `api.openai.com` (ou com `cacheRetention=long` e suporte). Nada disso se aplica a um gateway. Não existe campo de cabeçalhos próprios na conexão (`LlmConnection` não tem `headers`).
- O Craft tem ids de sessão internos (`sessionId`, `sdkSessionId`) que não saem na rede para endpoints personalizados.
- Corpo: `stream: true`, `stream_options: { include_usage: true }` (o Thinker precisa devolver o chunk final de `usage`), `max_completion_tokens` (ou `max_tokens` só para hosts conhecidos como DeepSeek/Moonshot/Z.ai/Together), sem `store`, mensagens com papel `system` (modelo com `reasoning: false` não usa `developer`), `temperature` só se definida. Não envia `reasoning_effort` com `reasoning: false`. (`openai-completions.js:570-600`, `1215-1300`)

### Outros endpoints

- Contra o gateway, só `POST {baseURL}/chat/completions`. O teste de conexão do Craft para endpoints Anthropic-compatíveis chama `POST {baseUrl}/v1/messages` com `max_tokens: 16` (`drivers/pi.ts:171-206`); para `openai-completions` o teste é uma sessão Pi real (uma requisição curta de chat). Sem token counting, health ou telemetria para o gateway. Tráfego do próprio Craft vai para `thecraftagents.com` e serviços da Craft, fora do gateway.

### Recursos usados

- Streaming, tool calls (o Craft é um agente com ferramentas, fontes MCP/API e skills), imagens somente com `supportsImages`, compactação automática (limitada pela saída máxima da conexão, issue upstream #1100), steering/fila de mensagens durante o stream (`midStreamBehavior`).
- Sub-requisições concorrentes: o app roda várias sessões ao mesmo tempo, sem identificador de sessão na rede (ver acima).
- Parâmetros opcionais que o pi-ai pode mandar: `temperature`, `reasoning_effort` (apenas se `reasoning` for verdadeiro, o que não ocorre em endpoint personalizado) e `tools` com `strict` desligado (`supportsStrictMode: false`).

### Erros e retentativas

- Mensagens de erro traduzidas pela UI: 401 (chave), 403, 429 (limite), 402 (crédito), 404 (endpoint não achado, "Ensure the server supports the Anthropic Messages API" para o fluxo Anthropic), 5xx (indisponível) (`packages/shared/src/config/llm-validation.ts` `parseValidationError`). O corpo de erro é exibido truncado (200 caracteres).
- Política de retry do cliente OpenAI no pi-ai: `maxRetries` controlado pelo chamador (`openai-completions.js:194-198`); valor efetivo no Craft não confirmado (não confirmado). Recomendação: 429/5xx com `retry-after` correto e 4xx claro e rápido para modelo inexistente.

### Snippet de setup do Thinker

Correto para v0.15.8: preset **Custom**, protocolo OpenAI Completions, URL base `<origem>/v1`, modelo `auto`, chave `thk_...`. Faltam avisos sobre os padrões de contexto, saída e imagens (G2) e o texto não nomeia o preset "Custom" nem a alternância de protocolo (se o usuário escolher `anthropic-messages`, a URL base e a rota mudam).

## Como o Thinker implementa hoje

- Superfície: Chat Completions (`packages/shared/src/agent-type.ts:78`); plataforma `craft` (`agent-type.ts:28`), nome `Craft Agent` (`:104`), categoria `personal` (`:129`), ícone `/icons/craft.png` (`:139`).
- Setup: `packages/frontend/src/components/CraftAgentSetup.tsx:14-47` mostra um parágrafo e a chave mascarada (`thk_...`, revelável); a URL base mostrada é `${installOrigin()}/v1` (`packages/frontend/src/pages/AgentConnection.tsx:36`, `SetupModal.tsx:55`). Texto do guia: `packages/frontend/src/i18n/locales/pt-BR/harnesses.ts:274` ("endpoint personalizado compatível com OpenAI", URL base, modelo `auto`, colar chave). Registro no seletor: `SetupStepAddProvider.tsx:19,47,62,97-98`. Documentação de usuário: `docs/usuario/conectar-harnesses.md:102` (uma linha, sem snippet).
- Sessão: só `x-session-key` é lido (`packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`, via `buildProxySessionScope` em `proxy-session-scope.ts`). O Craft não envia esse cabeçalho; resultado: sessão `default`, sem `providerCacheKey`/`momentumKey` (`provider-hooks.ts:41-68` documenta que os cabeçalhos de afinidade por provedor só saem com sessão). Não há handler de sessão específico do Craft; `harness-session.ts` só existe em trabalho não commitado de outra sessão.
- Classificação do chamador: `caller-classifier.ts:35-66` usa `User-Agent` e `x-stainless-*`; um UA `pi (...)` seria gravado como UA bruto, sem reconhecer Craft nem Pi.
- Rotas: `POST /v1/chat/completions` (`proxy.controller.ts:246`) e `GET /v1/models` (`:176`); o Craft só usa a primeira.
- Valores de `stream_options.include_usage`, `max_completion_tokens` e ausência de `store` seguem o formato padrão OpenAI que o proxy já aceita (não houve teste ao vivo).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/CraftAgentSetup.tsx`
- `packages/frontend/src/i18n/locales/pt-BR/harnesses.ts`
- `packages/frontend/src/i18n/locales/en/harnesses.ts`

Arquivos que citam `craft`:

- `packages/frontend/src/components/SetupStepAddProvider.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | oportunidade | O Craft não manda nenhum identificador de sessão a um endpoint personalizado (nem cabeçalho nem `prompt_cache_key`), e a conexão não aceita cabeçalhos próprios; portanto não há o que o Thinker leia (diferente de OpenCode #318 e Claude Code #320). Toda sessão cai em `default`, sem afinidade de cache nem momentum. Opções: (a) fallback do Thinker que derive uma chave de conversa do conteúdo (hash do system prompt + primeira mensagem do usuário) para chamadores sem sessão; (b) PR upstream no Craft/pi-ai para enviar `session_id`/`x-session-affinity` com `compat.sendSessionAffinityHeaders`. | backend-dev | — | aberta |
| G2 | degradação | O guia do Craft não avisa dos padrões de endpoint personalizado: contexto 131072, saída 8192 (também limita o resumo de compactação) e sem imagens, mesmo quando `auto` roteia para modelo de 1M ou com visão. Sugestão: aviso no guia e trecho `config.json` com `models: [{ id, contextWindow, supportsImages }]`. | frontend-dev | [#379](https://github.com/patrickbrandao/thinker/issues/379) | aberta |
| G3 | oportunidade | O Craft traz o preset de marca "Manifest" (`app.manifest.build/v1`, chave `mnfst_`) e `opencode-go`, mas não "Thinker". Hoje o usuário escolhe "Custom" e digita a URL. Avaliar PR upstream em `ApiKeyInput.tsx` e `OPENAI_COMPAT_CUSTOM_URL_PRESETS` (preset sem URL fixa, pois o Thinker é auto-hospedado). | frontend-dev | — | aberta |
| G4 | oportunidade | `caller-classifier.ts` não reconhece o UA `pi (<os> <release>; <arch>)` que o pi-ai manda (Craft e o harness Pi); nada identifica o chamador como Craft/Pi nos logs. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa. Projeto confirmado (`lukilabs/craft-agents-oss`, tag `v0.15.8`, commit 1627c43). Leitura do código do Craft (fluxo Custom, `custom-endpoint-models.ts`, `index.ts` do pi-agent-server, `ApiKeyInput.tsx`) e do pacote `@earendil-works/pi-ai@1.1.0` (cabeçalhos, afinidade de sessão, corpo). Aberta G2 (#379); G1, G3 e G4 como oportunidade, sem issue.
