---
id: harness-cline
categoria: harness
entidade: Cline
agente: harness-cline
thinker_ids: [cline]
revisado_em: 2026-11-03
versao_observada: cline v4.1.26 (commit a459f1d, 2026-10-25)
---

# Cline (harness)

Especificação mantida pelo agente `harness-cline` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- **Identificação confirmada:** o harness é o Cline, repositório `cline/cline` (descrição: agente de código autônomo como SDK, extensão de IDE ou CLI). A fonte seed estava certa. O repositório hoje é um monorepo: extensão VS Code (`apps/vscode`, tag `v4.1.26`), CLI (`apps/cli`, tag `cli-v3.0.74`), app desktop e o novo SDK (`sdk/packages/{llms,core,agents}`, `sdk/v0.2.0`). A série v4 da extensão roda sobre o SDK (`@cline/llms`).
- Para um gateway, o Cline usa o provedor **"OpenAI Compatible"** (`providerId: openai-compatible`): **Chat Completions** via `@ai-sdk/openai-compatible`, com `baseUrl`, chave opcional e id de modelo digitado pelo usuário. Não há chamada a `GET /v1/models` do gateway nesse provedor (só LM Studio e Ollama têm `modelsSourceUrl`).
- **Não envia nenhum cabeçalho de sessão** ao provedor OpenAI-compatible genérico. Os cabeçalhos próprios (`X-Task-ID`, `X-CLIENT-TYPE`, `User-Agent: Cline/<versão>`, ...) só saem para os provedores `cline` e `cline-pass`; `x-opencode-session` só para `opencode-go`. Logo o Thinker cai sempre na sessão `default` (lacuna G1). O usuário pode fixar cabeçalhos estáticos em `headers` do provedor (por exemplo `x-session-key`), mas isso não é por sessão.
- Pede `stream_options.include_usage` (`includeUsage: true`), reescreve `max_tokens` para `max_completion_tokens` quando o id do modelo é da era de raciocínio da OpenAI (o-series, gpt-5 e posteriores), e envia imagens de ferramentas como mensagem de usuário separada.
- O Thinker já tem a plataforma `cline` (Chat Completions) em `agent-type.ts`, mas **não há snippet nem seção em `conectar-harnesses.md`** (lacuna G2, oportunidade). Este dossiê traz o snippet verificado no fonte.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Cline repository (extensão, SDK, CLI) | <https://github.com/cline/cline> | tag `v4.1.26` (2026-10-25, commit a459f1d04dea); última release do repositório em 2026-10-26; `main` ativo em 2026-11-04 |
| SDK `@cline/llms` / `@cline/core` no fonte | `sdk/packages/llms`, `sdk/packages/core` do repositório | tag `v4.1.26` (SDK `sdk/v0.2.0`, 2026-10-26) |
| CHANGELOG da extensão | `CHANGELOG.md` do repositório | 4.1.26 |
| Docs | <https://docs.cline.bot/> (fonte em `docs/` do repositório) | `docs/` da tag `v4.1.26` |

Verificações da fonte seed: `cline/cline` e `docs.cline.bot` estão corretos. O pacote `sub-cline-pass` cobre o provedor ClinePass (`api.cline.bot`), que é outra entidade.

## Contrato

### Configuração do gateway

- Provedor: `openai-compatible` (nome "OpenAI Compatible", "OpenAI-compatible chat completions endpoint"). Campos: Base URL (obrigatória na prática; padrão `https://api.openai.com/v1`), API Key (opcional: `apiKeyOptional: true`, sem pré-checagem; sem chave não envia credencial válida e o 401 do servidor aparece ao usuário), Model ID (padrão `gpt-4o`) e, na UI, janela de contexto, saída máxima, suporte a imagem e preços. (`sdk/packages/llms/src/providers/builtins.ts:798-811`; `docs/provider-config/openai-compatible.mdx`)
- Variável de ambiente da chave: `OPENAI_API_KEY` (`apiKeyEnv`).
- Arquivo: `~/.cline/data/settings/providers.json` (compartilhado por IDE, CLI e SDK; `docs/getting-started/config.mdx`). Cada provedor guarda `ProviderSettingsSchema`: `provider`, `apiKey`, `model`, `baseUrl`, `headers` (mapa de cabeçalhos fixos), `timeout`, `maxTokens`, `contextWindow`, `reasoning`, `capabilities` e outros (`sdk/packages/core/src/services/llms/provider-settings.ts:143-175`). Provedores adicionados pelo usuário ficam em `models.json` na mesma pasta (`local-provider-registry.ts`, versão 1, com `provider.baseUrl`, `protocol`, `modelsSourceUrl` e `models`).
- CLI sem prompts: `cline auth -p openai-compatible -k <chave> -m <modelo> -b <baseurl>` (`docs/cli/cli-reference.mdx:119-131`).
- A `baseUrl` é usada como `baseURL` do AI SDK: o cliente acrescenta `/chat/completions`. Deve incluir `/v1` (`http://host:2099/v1`).
- Cabeçalhos extras: `headers` do `providers.json` vão tal qual em toda requisição ao provedor (`openai-compatible.ts:246`). Não confirmei campo equivalente na UI da extensão (não confirmado).

### Seleção de modelo

- O usuário digita o id do modelo (ou escolhe do catálogo embutido, que vem do `providers.generated.ts`). Para `openai-compatible` genérico **não há descoberta via `/models`**; só `lmstudio` (`/v1/models`) e `ollama` (`/api/tags`) têm `modelsSourceUrl`, e o `resolveModelsSourceUrl` reaponta a URL para a base configurada (`model-source.ts:111-139`). Provedores customizados em `models.json` podem declarar `modelsSourceUrl` (`local-provider-registry.ts:82`), em formato de resposta que o Cline normaliza; o formato aceito não foi detalhado (não confirmado).
- Consequência: `auto` e os virtuais do Thinker funcionam como id digitado. Contexto e saída máxima vêm da configuração do usuário (`contextWindow`, `maxTokens`), não do `context_length` de `/v1/models`.
- Compactação automática: desde a 4.1.26 não roda quando o limite de contexto do modelo é desconhecido (CHANGELOG 4.1.26). Para modelo desconhecido do Cline (como `auto`), configure a janela de contexto na UI para a compactação funcionar.

### Cabeçalhos e sessão

Para o provedor `openai-compatible` genérico a requisição leva apenas o que o AI SDK coloca (`Authorization: Bearer`, `Content-Type`, `User-Agent` do AI SDK/`@ai-sdk/openai-compatible` com sufixo de runtime, valor exato não verificado (não confirmado)) mais `config.headers` do usuário. **Nenhum cabeçalho de sessão, de cliente ou de versão do Cline** é enviado.

Cabeçalhos do Cline que existem, mas só para provedores próprios (`sdk/packages/llms/src/providers/request-headers.ts:45-103`, `:150-166`):

| Cabeçalho | Valor | Quando |
|---|---|---|
| `X-Task-ID` | id da sessão (task) | só provedores `cline` e `cline-pass`, se há sessão |
| `X-CLIENT-TYPE`, `X-CLIENT-VERSION`, `X-PLATFORM`, `X-PLATFORM-VERSION`, `X-CORE-VERSION`, `X-IS-MULTIROOT` | identificação do cliente | `cline`, `cline-pass` |
| `User-Agent` | `Cline/<versão>` | `cline`, `cline-pass`, `opencode-go`, `openai-codex` |
| `HTTP-Referer: https://cline.bot`, `X-Title: Cline` | atribuição | `cline`, `cline-pass` |
| `x-opencode-session` | id da sessão | `opencode-go` |
| `session_id`, `originator: cline` | sessão e origem | `openai-codex` |
| campo `session_id` no corpo | id da sessão | `openrouter` (`OPENROUTER_STICKY_SESSION_METADATA`, `builtins.ts:88`) |

Não há cabeçalho de subagente/sessão-mãe. O Cline é um agente único por sessão (subagentes e "teams" são tratados dentro do mesmo processo; não verificado se geram `X-Task-ID` próprio para provedores genéricos, mas para o genérico nada é enviado).

### Outros endpoints

- Contra o gateway genérico, só `POST {baseUrl}/chat/completions` (streaming). Sem token counting, health ou telemetria para o gateway. Telemetria do próprio Cline vai para os serviços da Cline, fora do gateway.
- O Thinker precisa devolver o chunk final de `usage` quando `stream_options.include_usage` está presente (`includeUsage: true`, `openai-compatible.ts:249`).

### Recursos usados

- Chat Completions com streaming e tool calls (capability `tools`; `capabilities: ["tools"]` no provedor genérico). Raciocínio via configuração `reasoning` (parâmetros do AI SDK, mapeados por modelo; o genérico não declara `reasoning`).
- `max_tokens` é renomeado para `max_completion_tokens` quando o id do modelo bate com o-series ou gpt-5 em diante (`gpt-5*`, `gpt-6*`, ...) (`openai-compatible.ts:140-170`, `model-facts.ts:253-289`; correção da 4.1.26). Um modelo virtual com esses nomes faria o Thinker receber `max_completion_tokens`.
- Imagens: mensagens `role:"tool"` com imagens são divididas em texto de substituição mais mensagem `user` com as imagens (`middleware/split-tool-images`), porque o formato Chat Completions não tem tool message multimodal.
- Prompt caching por `cache_control: {type:"ephemeral"}` só nos caminhos Anthropic-compatíveis e OpenRouter; o genérico OpenAI-compatible não manda marcação de cache (`routing/utils.ts:14`; não confirmado que o genérico nunca a inclua).
- Compactação automática e sessões em nuvem (4.1.25/4.1.26) são recursos do Cline, sem impacto no contrato do gateway.

### Erros e retentativas

- Nível AI SDK: `MODEL_REQUEST_MAX_RETRIES = 3` (era 5; reduzido na 4.1.26) para falhas antes do início do stream, com backoff e respeito a `retry-after` (`ai-sdk.ts:1096`, CHANGELOG 4.1.26).
- Status retentáveis: 408, 409, 425, 429, 500, 502, 503, 504, 529 (`error-classification.ts:~320`). Credencial rejeitada (401/403) e estouro de contexto definitivo não são retentados.
- Estouro de contexto: classificado por código `context_length_exceeded` ou por padrões de mensagem (`context length|window|limit`, `maximum context`, ...) (`error-classification.ts:5-30`). O Thinker deve devolver um desses para o Cline poder reagir.
- Uma volta cuja conexão cai depois de só raciocínio é retentada (4.1.26). Respostas vazias também têm retentativa própria (`retry-empty-response`).

### Snippet de setup do Thinker

Não existe snippet no Thinker (ver G2). O correto para a v4.1.26, no CLI:

```bash
cline auth -p openai-compatible -k thk_SUA_CHAVE -m auto -b http://localhost:2099/v1
```

Ou na extensão: Settings > API Configuration > provedor "OpenAI Compatible", Base URL `http://localhost:2099/v1`, API Key `thk_SUA_CHAVE`, Model ID `auto` (ou o nome de um modelo virtual), e preencher a janela de contexto. Equivalente em `providers.json`: entrada `openai-compatible` com `baseUrl`, `apiKey` e `model` (formato exato do arquivo não conferido ao vivo (não confirmado)).

## Como o Thinker implementa hoje

- Plataforma `cline` listada em `AGENT_PLATFORMS` (`packages/shared/src/agent-type.ts:40`), superfície `chat_completions` (`:90`), nome `Cline` (`:116`), categoria `coding` (`:132`), ícone `/icons/providers/cline-pass.png` (`:151`).
- Sessão do chamador: só `x-session-key` é lido (`packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`, via `buildProxySessionScope`). Como o Cline não envia cabeçalho de sessão ao provedor genérico, toda a atividade de um agente Cline cai em `default`: sem `providerCacheKey` nem `momentumKey`, sessões misturadas nos logs. Não existe `harness-session.ts` nesta `main` (ver nota do pedido).
- Classificação do chamador (`caller-classifier.ts:35-70`): lê `user-agent`, `http-referer`/`referer`, `x-openrouter-title`/`x-title` e `x-stainless-*`. Nada identifica o Cline genérico; o `User-Agent: Cline/<versão>` e `X-Title: Cline` só apareceriam se o usuário o configurasse como provedor `cline`.
- `GET /v1/models` (`proxy.controller.ts:176`) devolve `auto`, os virtuais e os modelos reais; o Cline genérico não o consome, então o `context_length` publicado não chega ao Cline.
- `stream_options.include_usage` é honrado pelo caminho Chat Completions (`provider-client.ts:919-924`; `provider-client-converters.ts:125` trata `stream_options`). `max_completion_tokens` é aceito nos adaptadores Anthropic e ChatGPT (`anthropic-adapter.ts:601,708`, `chatgpt-adapter.ts:114`); para upstream OpenAI-compatível genérico a requisição é repassada como veio (não verificado se há renomeação para `max_tokens`).
- Documentação: `docs/usuario/conectar-harnesses.md` não tem seção do Cline (seções: Claude Code, Codex, OpenCode, OpenClaw e Hermes, SDKs). `packages/shared/src/setup-snippets.ts` e `packages/frontend/src/components/` não têm componente de setup do Cline (existem para Claude Code, Codex, OpenCode, OpenClaw, Hermes, n8n, Nanobot e Craft).
- Atenção a nomes: o alias `cline` em `packages/shared/src/providers.ts:136` aponta para o provedor `cline-pass` (ClinePass), diferente da plataforma/harness `cline`; são entidades distintas.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`

Arquivos que citam `cline` (provedor ClinePass, fora do escopo deste harness; ver `sub-cline-pass`):

- `packages/shared/src/providers.ts`
- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/proxy-response-handler.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O Cline não envia cabeçalho de sessão ao provedor OpenAI-compatible genérico (nem `X-Task-ID`, que é só para `cline`/`cline-pass`). O Thinker lê só `x-session-key` (`proxy.controller.ts:277,899`), então toda sessão Cline vira `default`: sem afinidade de prompt cache, sem momentum de roteamento, conversas misturadas. Diferente de #318/#320 (onde o cabeçalho existe e é ignorado): aqui o cliente não o envia. Sugestão: documentar `headers` com `x-session-key` fixo no setup (por cliente, não por sessão) e avaliar derivar uma chave de sessão por impressão digital do início da conversa para clientes sem cabeçalho. | backend-dev | [#369](https://github.com/patrickbrandao/thinker/issues/369) | resolvida (limitação documentada no guia) |
| G2 | oportunidade | Não há snippet, componente de setup nem seção em `conectar-harnesses.md` para o Cline, embora a plataforma `cline` exista. Adicionar a seção (CLI `cline auth -p openai-compatible ...` e UI) e avisar que a janela de contexto precisa ser preenchida para a compactação automática funcionar. | frontend-dev | — | aberta |
| G3 | oportunidade | O Cline genérico não se identifica (sem `User-Agent: Cline/...`, sem `X-Title`); o classificador do Thinker não o reconhece. Sugestão: orientar o usuário a adicionar `headers` (`User-Agent`/`X-Title`) no `providers.json`, ou reconhecer o agente pela chave `thk_` já associada à plataforma `cline`. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra o fonte da tag `v4.1.26` (SDK `@cline/llms`: provedor OpenAI-compatible, `request-headers.ts`, retentativas, classificação de erros; docs `provider-config`, `cli`, `config`). Fonte seed confirmada (`cline/cline`, `docs.cline.bot`). Aberta G1 (#369); G2 e G3 registradas como oportunidade, sem issue. Não verificado ao vivo: formato exato de `providers.json`, `User-Agent` real do AI SDK, headers customizados na UI da extensão.
