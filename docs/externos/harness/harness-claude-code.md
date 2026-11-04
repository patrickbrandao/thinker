---
id: harness-claude-code
categoria: harness
entidade: Claude Code
agente: harness-claude-code
thinker_ids: [claude-code]
revisado_em: 2026-11-03
versao_observada: claude-code v2.1.318 (docs 2026-11-03)
---

# Claude Code (harness)

Especificação mantida pelo agente `harness-claude-code` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Claude Code (CLI, extensão VS Code, SDK) fala **Anthropic Messages** (`POST /v1/messages?beta=true`) e é apontado para um gateway por `ANTHROPIC_BASE_URL` mais uma credencial (`ANTHROPIC_AUTH_TOKEN` ou `ANTHROPIC_API_KEY`). A Anthropic documenta um "guia de compatibilidade de gateway" que pede para repassar `anthropic-beta`/`anthropic-version` sem alterar e tratar listas de cabeçalhos e campos como abertas.
- **Identificação de sessão:** toda requisição leva `x-claude-code-session-id` (desde 2.1.86). Subagentes acrescentam `x-claude-code-agent-id` e, se aninhados, `x-claude-code-parent-agent-id` (desde 2.1.139). **O Thinker não lê nenhum dos três** (lacuna G1).
- Há ainda "cabeçalhos de dica" (`x-claude-code-request-class`, `-agent-type`, `-compaction`, `-context-compacted`, `-prev-tool-durations`, `-prompt-id`) que, atrás de URL base customizada, só saem com `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`.
- O cliente se recupera sozinho de 400 por beta/campo rejeitado (context_management, effort, tool search, advisor, system mid-conversa, thinking), desde que o gateway devolva o corpo de erro do upstream sem reembrulhar.
- Última versão vista: **v2.1.318** (2026-11-04, npm e GitHub). Cadência: várias versões por semana.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Claude Code repository and CHANGELOG | <https://github.com/anthropics/claude-code> | v2.1.318 (CHANGELOG.md lido inteiro em 2026-11-03) |
| LLM gateway configuration (hoje em code.claude.com) | <https://code.claude.com/docs/en/llm-gateway> | 2026-11-03 |
| Gateway compatibility guide (fonte principal de cabeçalhos) | <https://code.claude.com/docs/en/llm-gateway-protocol.md> | 2026-11-03 |
| Connect Claude Code to an LLM gateway | <https://code.claude.com/docs/en/llm-gateway-connect.md> | 2026-11-03 |
| Model configuration | <https://code.claude.com/docs/en/model-config.md> | 2026-11-03 (primeiros 100 mil caracteres) |
| Settings and environment variables | <https://docs.claude.com/en/docs/claude-code/settings> (redireciona para code.claude.com) | não relido em profundidade; variáveis conferidas pelo CHANGELOG |
| npm @anthropic-ai/claude-code | <https://www.npmjs.com/package/@anthropic-ai/claude-code> | 2.1.318 (`npm view`, 2026-11-04T00:01Z) |

O host `docs.claude.com` foi substituído por `code.claude.com`; atualizar os links nos snippets e na documentação do Thinker se houver. Não foi lido o código-fonte do cliente: o repositório público é só changelog, issues e plugins; a evidência é documentação oficial e CHANGELOG.

## Contrato

### Configuração do gateway

- Superfície: Anthropic Messages. Endpoints: `POST /v1/messages?beta=true` (casar pelo caminho, não pela URL completa) e `POST /v1/messages/count_tokens` (opcional; sem ele o cliente usa estimativa por caracteres e `/context` fica aproximado). Fonte: llm-gateway-protocol, "Optional endpoints".
- Tráfego de partida que o gateway pode rejeitar sem quebrar nada: `HEAD /api/hello` (aquecimento de conexão; não enviado com proxy HTTP ou certificado de cliente).
- Variáveis: `ANTHROPIC_BASE_URL` (sem `/v1`; o cliente acrescenta `/v1/messages`), `ANTHROPIC_AUTH_TOKEN` (vira `Authorization: Bearer`), `ANTHROPIC_API_KEY` (vira `x-api-key`), `apiKeyHelper` (script; envia nos dois cabeçalhos; cache de 5 min, `CLAUDE_CODE_API_KEY_HELPER_TTL_MS`). A variável de credencial tem precedência sobre login claude.ai. Só `ANTHROPIC_BASE_URL`, sem credencial, mantém o login salvo ativo e envia o flag OAuth no `anthropic-beta`.
- Podem ficar em `~/.claude/settings.json` no bloco `env` (o valor do arquivo vence o do shell). `env` em `.claude/settings.json` de projeto só vale após o assistente de primeira execução e o prompt de confiança, então a credencial deve ficar em `~/.claude/settings.json`.
- `ANTHROPIC_CUSTOM_HEADERS`: pares `Nome: Valor` por linha (`\n` no JSON).
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` corta telemetria, atualização e outras chamadas fora do gateway. Algumas chamadas vão sempre direto a `api.anthropic.com` (verificação de modo rápido, verificação de domínio do WebFetch); não passam pelo gateway.
- Desde 2.1.285 (changelog), sessões atrás de URL base customizada usam janela de 1M para modelos que a têm (Opus 4.7+, Sonnet 5+, Fable); `CLAUDE_CODE_AUTO_COMPACT_WINDOW` e `/autocompact` ajustam o ponto de compactação. Para um id que o cliente não reconhece (por exemplo `auto`), a janela assumida é 200K, ou 1M com sufixo `[1m]` (guia de compatibilidade) `(não confirmado em prática)`.
- Desktop e Remote Control não usam esse caminho (o Desktop lê configuração própria; Remote Control fica indisponível com credencial de gateway).

### Seleção de modelo

- Ordem de precedência: `/model`, `--model`, `ANTHROPIC_MODEL`, chave `model` do settings, `ANTHROPIC_DEFAULT_MODEL` (model-config).
- A chave `model` não é validada na inicialização; id inválido só falha na primeira requisição ("There's an issue with the selected model").
- Aliases `opus`/`sonnet`/`haiku`/`fable` resolvem para ids da Anthropic (`claude-opus-4-8`, `claude-sonnet-5-5`, `claude-fable-5-1`...), remapeáveis por `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`. Há também `_MODEL_NAME`, `_DESCRIPTION` (rótulo no seletor). Os `_SUPPORTED_CAPABILITIES` **não** valem atrás de `ANTHROPIC_BASE_URL`.
- Tarefas de fundo (título de sessão, classificadores etc.): modelo principal; só usam Haiku padrão se a credencial for uma chave de Console via `ANTHROPIC_API_KEY`/`apiKeyHelper` e `ANTHROPIC_AUTH_TOKEN` não estiver definido; `ANTHROPIC_DEFAULT_HAIKU_MODEL` fixa o modelo. `ANTHROPIC_SMALL_FAST_MODEL` aparece só em entradas antigas do changelog (2.1.x iniciais e correção de fallback) `(não confirmado se segue ativo)`.
- Subagentes: herdam o modelo da sessão, salvo `model:` na definição do agente ou no spawn; `CLAUDE_CODE_SUBAGENT_MODEL` define o padrão, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (2.1.2xx) força todos. O subagente Explore herda o modelo quando o id é desconhecido (2.1.284).
- Um agente customizado com `model: haiku` envia `claude-haiku-...` ao gateway (`(não confirmado)` se isso ocorre com `model: auto` na sessão).
- Descoberta de modelos: opt-in com `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`. Faz `GET /v1/models?limit=1000` (timeout 3 s, ajustável por `CLAUDE_CODE_GATEWAY_MODEL_DISCOVERY_TIMEOUT_MS`; redirecionamento conta como falha), com `Authorization` e `x-api-key`. Lê `data[].id`, `display_name`, `description` e **só mantém ids que contêm `claude` ou `anthropic`** (sem diferenciar maiúsculas). Cache em `~/.claude/cache/gateway-models.json`. Não roda se `CLAUDE_CODE_USE_*` estiver definido nem sem `ANTHROPIC_BASE_URL`.

### Cabeçalhos e sessão

Enviados em toda requisição (llm-gateway-protocol, "Request headers"; o gateway pode consumir, não precisa repassar, exceto os `anthropic-*`):

| Cabeçalho | Quando / significado | Desde |
|---|---|---|
| `Authorization` / `x-api-key` | credencial do gateway, um ou os dois | sempre |
| `anthropic-version` | `2023-06-01` | sempre |
| `anthropic-beta` | lista separada por vírgulas; repassar verbatim, sem allowlist; inclui o valor OAuth quando a autenticação é login claude.ai | sempre |
| `x-claude-code-session-id` | id único da sessão | 2.1.86 |
| `x-claude-code-agent-id` | id do subagente emissor; só em requisições de agentes lançados na sessão; gerado novo a cada spawn; teammates de agent team reutilizam id estável por nome | 2.1.139 |
| `x-claude-code-parent-agent-id` | agente que lançou o emissor; só em agentes aninhados | 2.1.139 |

`claude -p` executado dentro de uma sessão usa, por padrão, um id de sessão próprio (aninhado); `CLAUDE_CODE_DISABLE_NESTED_SESSION_ID=1` (2.1.317) volta ao id e transcrição da sessão pai. Fonte: CHANGELOG 2.1.317.

Cabeçalhos de dica de gateway (2.1.273+; atrás de URL base customizada exigem `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`; `=0` desliga em todo lugar). Valores são ASCII imprimível, nunca conteúdo de prompt:

| Cabeçalho | Valores / formato |
|---|---|
| `x-claude-code-request-class` | `main`, `subagent`, `workflow`, `compaction`, `auxiliary`; em toda requisição |
| `x-claude-code-agent-type` | nome de agente embutido (`Explore`, `Plan`, `general-purpose`), `custom`, `teammate`, `fork`; só nos turnos do próprio subagente |
| `x-claude-code-compaction` | `auto`, `manual`, `reactive`; só na requisição que resume a conversa |
| `x-claude-code-context-compacted` | mesmos valores; uma vez, na primeira requisição principal após compactar (o prefixo anterior deixou de valer, útil para descartar cache) |
| `x-claude-code-prev-tool-durations` | `Nome=ms;Nome=ms`, nomes em percent-encoding, até 32 entradas e 4 KB |
| `x-claude-code-prompt-id` | UUID por prompt do usuário, compartilhado com os subagentes do prompt (2.1.283) |

Outros: o bloco de atribuição no `system` (versão do cliente e fingerprint) deve ser repassado como primeiro item do array `system`; a Anthropic o remove por posição. Atrás de URL base customizada ele é estável por conversa desde 2.1.181; `CLAUDE_CODE_ATTRIBUTION_HEADER=0` o omite. O `user-agent` do cliente segue o formato `claude-cli/<versão> (external, cli)`; `x-app` e cabeçalhos `x-stainless-*` também saem `(formato exato não confirmado nesta revisão)`.

### Outros endpoints

| Endpoint | Observação |
|---|---|
| `POST /v1/messages/count_tokens` | opcional; ausência vira estimativa por caracteres |
| `GET /v1/models?limit=1000` | só com descoberta habilitada |
| `HEAD /api/hello` | aquecimento, pode falhar |
| `api.anthropic.com` direto | verificação de modo rápido (`CLAUDE_CODE_SKIP_FAST_MODE_NETWORK_ERRORS=1` etc.), WebFetch (`skipWebFetchPreflight`); fora do gateway |

### Recursos usados

Streaming SSE completo, na ordem, até `message_delta` e `message_stop` (corpo que termina limpo antes disso é tratado como conexão caída); `ping` de SSE mantém o cliente vivo durante raciocínio longo (watchdog de ociosidade, 300 s atrás de URL base customizada); `cache_control` em `system` e em `messages`, inclusive entradas `role: "system"` no meio da conversa (Opus 4.8+ e ids desconhecidos); TTL de 1 h com `extended-cache-ttl` no `anthropic-beta`; thinking `adaptive` (sem beta); `context_management` (beta + campo); `output_config` (effort, format, task_budget); campos de ferramenta beta (`strict`, `defer_loading`, blocos `tool_reference` da busca de ferramentas MCP, ligada por padrão atrás de URL base customizada); ferramenta advisor; imagens; subagentes e agent teams em paralelo; compactação.

### Erros e retentativas

- 400/422 por capacidade rejeitada é recuperado pelo cliente reenviando sem o item: `thinking.type`, `role: "system"` em `messages`, marcador `cache_control` nesses, assinatura de thinking ("bound to a different conversation"), advisor (2.1.280), `output_config.effort` (`effort-2025-11-24`, 2.1.310), `context_management` (2.1.304), beta nomeado (2.1.314), tool search (2.1.305). O reconhecimento é pelo **texto do erro do upstream**; reembrulhar o erro quebra a recuperação, a menos que a mensagem carregue `capability_rejected: <token>`.
- `retry-after`: usar inteiro em segundos; valor acima de 60 interrompe as retentativas e mostra o erro. `x-should-retry` é lido. `anthropic-ratelimit-unified-*` é lido para exibir limites do plano.
- 403 com corpo HTML de WAF costuma ser regra de XSS no corpo; erros de TLS pedem `NODE_EXTRA_CA_CERTS`.
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` desliga betas pré-lançamento (context management, campos beta de ferramenta, output format, task budget, tool search) mas não effort, thinking adaptive nem system mid-conversa.

### Snippet de setup do Thinker

Esperado hoje para um gateway Anthropic-format: `ANTHROPIC_BASE_URL` sem `/v1`, `ANTHROPIC_AUTH_TOKEN`, e `model` explícito. O snippet atual do Thinker (veja abaixo) está correto nesses pontos. Opcionais úteis: `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`, `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`.

## Como o Thinker implementa hoje

Branch/commit lido: worktree `piloto` em `61b155e` (main), 2026-11-03.

- Superfície: `claude-code` usa `messages` (`packages/shared/src/agent-type.ts:85`), rótulo "Claude Code" (`:111`).
- Snippet de setup: `getClaudeCodeSettingsSnippet` gera `model: "auto"`, `ANTHROPIC_BASE_URL` (sem `/v1`, via `stripV1Suffix`) e `ANTHROPIC_AUTH_TOKEN` (`packages/shared/src/setup-snippets.ts:40-48`, mapeado em `:115`). Documentação do usuário: `docs/usuario/conectar-harnesses.md:18-34` (mesmo conteúdo, avisa que `/v1` não entra, que só uma credencial deve ser definida e que a janela assumida é 200k).
- Rota: `GET /v1/models` (`proxy.controller.ts:176`), `POST /v1/messages` (`:262`), `chat/completions`, `responses`. **Não existe** `POST /v1/messages/count_tokens` (grep sem resultado em `packages/backend/src/routing`), então o Claude Code usa a estimativa por caracteres.
- Sessão: lê somente `x-session-key` (`proxy.controller.ts:277` e `:899`), via `buildProxySessionScope` (`proxy-session-scope.ts:15-41`). Sem o cabeçalho a sessão é `'default'` e `providerCacheKey`/`momentumKey` ficam indefinidos (`:36`). O Claude Code não envia `x-session-key`; `x-claude-code-session-id`, `x-claude-code-agent-id`, `x-claude-code-parent-agent-id` e os cabeçalhos de dica não aparecem em nenhum lugar do código (grep em `packages/backend/src` e `packages/shared/src`). A nota anterior deste dossiê, que atribuía o cabeçalho de sessão do Claude Code ao Thinker, não se confirma na `main`.
- Afinidade por sessão usada por provedores: `provider-hooks.ts:64-68` (`x-grok-conv-id`, `x-session-id` do OpenRouter, `x-opencode-session`), alimentada por `sessionKey`.
- Atribuição do chamador: `classifyCaller` lê `user-agent` e `x-stainless-*` (`caller-classifier.ts:36-48`); não lê `x-app` nem `x-claude-code-*`.
- Betas: o `anthropic-beta` do chamador é lido (`proxy.service.ts:485,524,563,642`) e mesclado com o do Thinker apenas quando o destino é `api.anthropic.com` (`anthropic-beta.ts:73-90`, `isAnthropicHost`; `provider-client.ts:138-140`; `extra-headers.ts`). Entrada saneada: tokens em minúsculas, máximo de 20 flags e 1024 bytes (`anthropic-beta.ts:30-45`).
- Modelo: `model: "auto"` ou ausente é rota sintética; qualquer outro id é rota explícita, resolvida por `resolveExplicitModel`; se não resolver, a requisição segue como `explicit_model_unavailable` (`proxy.service.ts:800-830`). Um id da Anthropic enviado por um alias interno do Claude Code só funciona se o provedor correspondente estiver configurado.
- `GET /v1/models` devolve formato OpenAI (`proxy.controller.ts:176-245`, `object: 'model'`) com `auto` e modelos virtuais; para a descoberta do Claude Code só entram ids com `claude` ou `anthropic` (então `auto` e a maioria dos ids Thinker são filtrados). Descoberta é opt-in do usuário e o snippet não a habilita.
- Cliente espelhado pelo caminho de assinatura (outro agente): `CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.280 (external, sdk-cli)'` e flags `claude-code-20250219,oauth-2025-04-20,context-management-2025-06-27,effort-2025-11-24` em `packages/backend/src/common/constants/subscription-clients.ts:32-39` (atual: 2.1.318).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/backend/src/routing/proxy/proxy.service.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/ClaudeCodeSetup.tsx`

Arquivos que citam `claude-code`:

- `packages/cli/src/agent-runtime.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`
- `packages/frontend/src/pages/integrations/McpServer.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O Claude Code envia `x-claude-code-session-id` (2.1.86+), mas o Thinker só lê `x-session-key`; toda sessão vira `'default'`, sem momentum de roteamento, sem afinidade/cache por provedor e com log agrupado. Mudar `proxy.controller.ts:277,899` para cair em `x-claude-code-session-id`. | backend-dev | [#320](https://github.com/patrickbrandao/thinker/issues/320) | aberta |
| G2 | oportunidade | Registrar `x-claude-code-agent-id`, `x-claude-code-parent-agent-id` e, com `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` no snippet, `x-claude-code-request-class`, `-agent-type`, `-prompt-id`, `-compaction`: atribuição de custo por subagente e por prompt, distinção de compactação e requisições auxiliares (hoje tratadas como chamadas comuns). | backend-dev | — | aberta |
| G3 | oportunidade | Servir `POST /v1/messages/count_tokens` (hoje 404): `/context` do Claude Code mostraria contagens exatas em vez de estimativa. Pode devolver contagem aproximada local. | backend-dev | — | aberta |
| G4 | oportunidade | Ajustar o snippet e `docs/usuario/conectar-harnesses.md`: mapear `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` para `auto` (ou ids Thinker) para que agentes com `model: haiku`/`sonnet` e subagentes não enviem ids da Anthropic inexistentes (`explicit_model_unavailable`), e revisar a frase sobre janela de 200k (desde 2.1.285 o cliente usa 1M para modelos reconhecidos atrás de URL base customizada; `auto` não é reconhecido). `(não confirmado: depende de teste real)` | frontend-dev / backend-dev | — | aberta |
| G5 | oportunidade | Responder `GET /v1/models` também em formato Anthropic (`display_name`, `description`) e/ou expor ids com `claude`/`anthropic` para a descoberta do `/model` picker (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`); hoje o filtro do cliente descarta `auto`. | backend-dev | — | aberta |

Observação transversal (agente `sub-anthropic`, não é lacuna deste dossiê): `CLAUDE_CODE_USER_AGENT` fixa `2.1.280` e a lista de betas do caminho de assinatura é estática, enquanto a versão atual é 2.1.318.

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa (claude-code v2.1.318). Cabeçalhos de sessão/subagente/dicas documentados a partir do guia oficial de compatibilidade e do CHANGELOG; aberta G1 (#320); G2-G5 registradas como oportunidade. Correção do esqueleto: o Thinker não lê `x-claude-code-session-id`.
