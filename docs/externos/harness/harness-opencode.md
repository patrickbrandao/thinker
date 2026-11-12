---
id: harness-opencode
categoria: harness
entidade: OpenCode
agente: harness-opencode
thinker_ids: [opencode]
revisado_em: 2026-11-06
versao_observada: opencode v2.2.5 (tag 9bbb8ce) + dev 4db5933 (2026-11-06)
---

# OpenCode (harness)

Especificação mantida pelo agente `harness-opencode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- OpenCode (repositório `anomalyco/opencode`, branch `dev`) segue na série **v2**; a última tag continua **v2.2.5** (2026-10-30). Nada foi lançado depois; o `dev` (commit `4db5933`, 2026-11-06) só traz refatorações internas que não mudam o que chega ao gateway.
- Para um gateway, o OpenCode fala **Chat Completions** (pacote openai-compatible) e usa uma lista de modelos **escrita à mão na configuração**; não chama `GET /v1/models` de provedores customizados.
- Os cabeçalhos de sessão (`x-opencode-session-id`, `x-session-affinity`, `X-Session-Id`, `x-opencode-session`, `x-opencode-parent-session-id`, `x-parent-session-id`, `x-opencode-project`, `x-opencode-client`, `User-Agent: opencode/<canal>/<versão>/<nome>`) não mudaram entre v2.2.5 e o `dev`. O Thinker já os lê (`harness-session.ts`).
- O site público `opencode.ai/docs` **passou a mostrar os docs v2** em 2026-11-06 (#62389). O fonte deles agora fica em `services/site/src/docs/content/`.
- Novidade desde a v2.2.3: o provedor embutido **Claude Agent** (`claude-agent`). Ele roda o `claude` (Claude Code) instalado na máquina pelo Claude Agent SDK, usando o login do próprio Claude Code. Com `settings.baseURL` ele pode apontar para um gateway, e aí quem chega ao Thinker é o **Claude Code**, não o OpenCode (G5). A análise de usar essa técnica como tipo de provedor no Thinker está em [`docs/referencia/opencode/claude-agent-provider-parecer.md`](../../referencia/opencode/claude-agent-provider-parecer.md) (G6).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| OpenCode repository | <https://github.com/anomalyco/opencode> | tag `v2.2.5` (2026-10-30, commit 9bbb8ce18c80); `dev` em `4db59339e3fd` (2026-11-06) |
| Docs v2 no fonte (providers, models, migrate-v1, claude-agent) | `services/site/src/docs/content/` do repositório (até a v2.2.5 ficava em `services/www/src/docs/content/`) | dev `4db5933` |
| Spec do provedor Claude Agent | `specs/v2/claude-agent-provider.md` do repositório | dev `4db5933` |
| CHANGELOG da v2 | `CHANGELOG.md` do repositório | v2.2.5 |
| Providers docs (site) | <https://opencode.ai/docs/providers/> | 2026-11-06 (agora formato v2: `providers`, `package`, `settings`) |
| Config schema | <https://opencode.ai/config.json> | 2026-11-06 (aceita `providers` v2 e `provider` v1) |

## Contrato

### Configuração do gateway

- Arquivo: `~/.config/opencode/opencode.json` (ou `opencode.jsonc`, ou `opencode.json` no projeto). `$schema`: `https://opencode.ai/config.json`. (migrate-v1.mdx, v2.2.5)
- **Formato v2**: mapa `providers.<id>` com `package`, `name`, `env` (lista de variáveis que podem fornecer a credencial), `settings` (`baseURL`, `apiKey`, `timeout`, `headerTimeout`, `chunkTimeout`, `encoding`, ...), `headers`, `body`, `compatibility` e `models`. O id do provedor é o prefixo em `provider/model`. (providers.mdx; schema `packages/schema/src/config/provider.ts`, sem mudança entre v2.2.5 e dev `4db5933`)
- `package` aceita pacote nativo (`@opencode/ai/providers/openai-compatible`, `.../openai-compatible/responses`, `.../anthropic-compatible`, ...) ou pacote AI SDK com prefixo `aisdk:` (`aisdk:@ai-sdk/openai-compatible`). Os docs v2 usam o nativo no exemplo "Custom"; a migração v1 mapeia `npm` para `aisdk:<npm>`. (providers.mdx, migrate-v1.mdx)
- **Formato v1** (`provider.<id>` com `npm`, `name`, `options.baseURL`, `options.apiKey`, `options.headers`, `models`) ainda é aceito pelo schema e migrado automaticamente (`packages/core/src/v1/config/migrate.ts`). No `dev`, a migração deixou de descartar modelos customizados com `limit` parcial (só `context` ou só `output`) (#62240, 2026-11-06). `apiKey` aceita `{env:VAR}` e `{file:path}`. O OpenCode 1 segue com releases (`v1.19.5`, 2026-10-28).
- `settings.baseURL` aplicado a um provedor substitui o endpoint de todos os modelos dele. `settings.encoding` (`zstd`/`gzip`/`none`) comprime o corpo; o padrão para chave de API é JSON puro.
- `body` do provedor/modelo mescla campos JSON no corpo da requisição; `headers` adiciona cabeçalhos fixos.
- `compatibility.streamUsage` e `compatibility.supportsPromptCacheKey` continuam válidos na config (`packages/schema/src/model-compatibility.ts:38-40`); internamente viraram `capabilities` do modelo (#61492, dev), sem efeito para quem configura.

### Seleção de modelo

- Para provedor customizado, os modelos vêm de `providers.<id>.models` (chave = id selecionável; `modelID` opcional mapeia para o id enviado ao upstream). Não há chamada a `/v1/models` do gateway; discovery dinâmico existe só para Ollama, LM Studio e vLLM. (providers.mdx)
- Modelo padrão: chave `model` no formato `provider/model` (`#variante` opcional). Sem a entrada em `models`, o modelo não existe para o OpenCode.
- Consequência: virtuais do Thinker (`auto`, nomes de modelos virtuais) precisam estar listados na configuração.
- `limit.context` / `limit.output` e `cost` por modelo são opcionais; sem `limit.output` o OpenCode usa 32.000 tokens de saída como fallback e limita a 256.000.

### Cabeçalhos e sessão

Enviados em toda requisição de modelo (sessões principais, subagentes, compactação, título) por `packages/core/src/session/model-request.ts:316-324` (dev `4db5933`; mesmo conjunto da v2.2.5, linhas 293-304):

| Cabeçalho | Valor | Quando |
|---|---|---|
| `x-opencode-session-id` | id da sessão (`ses_...`) | sempre |
| `x-opencode-parent-session-id` | id da sessão-mãe | só em subagente/filha |
| `x-session-affinity` | id raiz do grupo (affinity) | sempre |
| `X-Session-Id` | idem affinity | sempre |
| `x-parent-session-id` | id da sessão-mãe | só em subagente/filha |
| `x-opencode-session` | idem affinity | sempre |
| `x-opencode-project` | id do projeto | sempre |
| `x-opencode-client` | nome do app (`cli`, ...) | sempre |
| `User-Agent` | `opencode/<canal>/<versão>/<nome>` | sempre |

- Affinity (`packages/core/src/session/affinity.ts`, igual à v2.2.5): filhos usam o id da mãe, forks usam a sessão de origem, senão o id da própria sessão.
- `promptCacheKey` = affinity sem o prefixo `ses_`; o corpo carrega `prompt_cache_key` em Chat Completions só se `compatibility.supportsPromptCacheKey` for `true`.
- Gerações avulsas (`packages/core/src/generate.ts`) mandam só `x-opencode-session`. Chamadas ao Console mandam `x-opencode-org-id`, irrelevantes para o gateway.
- O canal real por distribuição (npm, brew, desktop) não foi confirmado (não confirmado). O OpenCode **não** envia `x-session-key`.
- O provedor Claude Agent põe `x-opencode-claude-agent-kind` e `x-opencode-claude-agent-fork-source` nos cabeçalhos da chamada (`claude-agent/language-model/request-kind.ts:3-5`), mas eles só circulam dentro do processo do OpenCode: quem faz a requisição HTTP é o Claude Code, que não os repassa.

### Provedor Claude Agent (`claude-agent`) apontado para um gateway

Fonte: `services/site/src/docs/content/claude-agent.mdx` e `packages/core/src/plugin/provider/claude-agent/claude/query-options.ts:30-51` (dev `4db5933`); lançado na v2.2.3 (#58782).

- O OpenCode inicia o `claude` do `PATH` (ou `OPENCODE_CLAUDE_PATH`), versão mínima 2.1.248, via `@anthropic-ai/claude-agent-sdk` (`0.3.301`, dependência opcional). Um processo `claude` por sessão, encerrado após 5 min ocioso.
- Config `providers.claude-agent` vira variáveis do Claude Code: `settings.baseURL` → `ANTHROPIC_BASE_URL`, `settings.apiKey` → `ANTHROPIC_API_KEY`, `settings.authToken` → `ANTHROPIC_AUTH_TOKEN`, `settings.headerTimeout` → `API_TIMEOUT_MS`, `settings.chunkTimeout` → `CLAUDE_STREAM_IDLE_TIMEOUT_MS`, `headers` → `ANTHROPIC_CUSTOM_HEADERS`, `body` → `CLAUDE_CODE_EXTRA_BODY`. O modelo sobrepõe o provedor.
- Com `settings.baseURL` apontando para o Thinker, o tráfego chega em `POST /v1/messages` com a identificação do **Claude Code** (ver [harness-claude-code](harness-claude-code.md)), incluindo `x-claude-code-session-id`. Os cabeçalhos `x-opencode-*` da tabela acima **não** aparecem.
- O que muda em relação ao Claude Code puro: ferramentas embutidas desligadas (`tools: []`), só ferramentas MCP `mcp__opencode__<nome>`; system prompt `claude_code` mais as instruções do OpenCode; `CLAUDE.md`, hooks, skills, auto-compactação, memória, tool search, advisor, fallback sem streaming e fallback de recusa desligados por variáveis (`query-options.ts:11-28`).
- Os modelos vêm do `claude` (aliases `opus`, `sonnet`, `haiku` e o `resolvedModel` de cada um). Atrás de um gateway o Claude Code envia ids `claude-*` reais, então o Thinker vê rota explícita, não `auto` nem virtual, salvo remapeamento por `ANTHROPIC_DEFAULT_*_MODEL` no ambiente do OpenCode (não confirmado neste caminho).
- Custo: o OpenCode mostra $0 quando há URL base customizada (`claude-agent/provider.ts:116-122`).

### Outros endpoints

- Contra o gateway configurado (provedor openai-compatible), só a rota de inferência (`POST {baseURL}/chat/completions`, ou `/responses` com o pacote `.../responses`). Sem token counting, health ou telemetria para o gateway.
- Streaming com `stream_options: { include_usage: true }` por padrão (`compatibility.streamUsage` pode desligar). O Thinker precisa devolver o chunk final de `usage`.
- Telemetria/atualização do próprio OpenCode vai para `opencode.ai`/models.dev, fora do gateway. No `dev`, a espera pela config do Console antes de um prompt foi removida e limitada a 5 s (#62397, #62404), e a espera por servidores MCP antes de chamar o modelo ficou em até 2 s (#62386).

### Recursos usados

- Chat Completions com streaming, tool calls (paralelos e em subagentes: requisições concorrentes com sessões-filhas), reasoning (variantes por modelo), imagens, compactação automática (`compaction.buffer`), cache de prompt via `cache.ttl` do modelo.
- Erros de janela de contexto (inclusive os do LiteLLM) disparam compactação em vez de falha: o gateway deve devolver um erro de contexto reconhecível (`context_length_exceeded` ou texto equivalente) (padrões exatos em `packages/core/src/session/to-session-error.ts`, não confirmados nesta revisão).

### Erros e retentativas

- Política de retry do modelo (`packages/core/src/model-retry.ts`): até 10 retentativas com backoff exponencial de 2 s, teto de 10 s por intervalo, com jitter; respeita `retry-after` em `RateLimit` e `ProviderInternal` (limite de 15 min). Timeouts: no máximo 3 retentativas.
- **Novo no `dev`** (ainda sem tag): falhas de rede antes da conexão (`ENOTFOUND`, `EAI_AGAIN`, `ENETUNREACH`, `EHOSTUNREACH`, `ENETDOWN`) usam orçamento próprio: backoff de 2 s até 30 s por intervalo, por até **1 hora**, sem gastar as 10 retentativas. Conexão recusada fica de fora (`model-retry.ts:38-62`). Para o Thinker: se o host do gateway não resolver, o OpenCode insiste por uma hora em vez de falhar logo.
- Falhas não retentáveis (4xx de requisição inválida) encerram o passo. Chamadas avulsas (título etc.) só retentam falhas em que o provedor não chegou a executar, 3 vezes.
- O provedor Claude Agent não retenta nada no OpenCode (o Claude Code já retenta) (`claude-agent/session.ts:52-60`).
- Recomendação para o Thinker: 429/5xx transitórios com `retry-after` correto; erro 4xx claro e rápido para modelo inexistente.

### Snippet de setup do Thinker

Correto para a v2.2.5 e para o `dev`. `aisdk:@ai-sdk/openai-compatible` com `settings.baseURL` e `settings.apiKey` é aceito. O exemplo dos docs v2 usa o pacote nativo e `env` em vez de chave literal (G3). Quem ainda usa o OpenCode 1 precisa do formato `provider`/`npm`/`options` (G2). O caminho alternativo pelo provedor Claude Agent está em `conectar-harnesses.md` (G5), ainda sem teste ao vivo.

## Como o Thinker implementa hoje

Superfície: Chat Completions (`packages/shared/src/agent-type.ts:88`). Plataforma `opencode` em `AGENT_PLATFORMS` (`agent-type.ts:36`), nome `OpenCode` (`:116`), categoria `coding` (`:136`), ícone (`:151`).

Sessão do chamador (lado entrada):
- `detectHarnessSession` (`packages/backend/src/routing/proxy/harness-session.ts:68-80`) lê, nesta ordem, `x-session-key`, ..., `x-opencode-session-id`, `x-opencode-session`, ..., `x-session-id`, `x-session-affinity` (`:22-37`), e a sessão-mãe de `x-opencode-parent-session-id` / `x-parent-session-id` (`:39-43`). Usado no proxy (`proxy.controller.ts:519`, `:1142`) e na gravação (`proxy-message-recorder.ts:291`); a migração `1805200000000-AddRequestHarnessSessions.ts:29-35` preenche o histórico com os mesmos cabeçalhos.
- Classificação do chamador por `User-Agent`/Stainless em `caller-classifier.ts:35-70`; guarda o `User-Agent` cru mas não reconhece `opencode/...` como harness.

Lado saída (Thinker como cliente dos provedores OpenCode e OpenCode Go, não o harness): `provider-hooks.ts:48-68` envia os cabeçalhos de sessão do OpenCode 2; `provider-endpoints.ts:676-680` e `subscription-clients.ts:25-27` fixam `User-Agent: opencode/latest/2.2.5/cli` e `x-opencode-client: cli` (ADR 0009). Alinhado com a última tag (v2.2.5).

Setup:
- `packages/frontend/src/components/OpenCodeSetup.tsx:18-40` gera `opencode.json` v2: `providers.thinker` com `package: 'aisdk:@ai-sdk/openai-compatible'`, `name: 'Thinker'`, `settings: { baseURL, apiKey }`, `models` com `auto` e os virtuais do harness (`Thinker <nome>`), `model: 'thinker/auto'`.
- `docs/usuario/conectar-harnesses.md:60-80` documenta o mesmo snippet (só v2); `:339` cita a leitura automática do cabeçalho de sessão; `:365` lembra de listar cada virtual em `providers.thinker.models`.
- Autenticação do proxy aceita `x-api-key` e `Authorization: Bearer` (`conectar-harnesses.md:32`), então `settings.apiKey` ou `settings.authToken` do provedor Claude Agent funcionariam com uma chave `thk_` (não testado).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/harness-session.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-message-recorder.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/database/migrations/1805200000000-AddRequestHarnessSessions.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/OpenCodeSetup.tsx`

Arquivos que citam `opencode` como provedor (OpenCode/OpenCode Go, fora do escopo deste harness; ver `api-opencode`, `sub-opencode` e `sub-opencode-go`):

- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O OpenCode envia a sessão em `x-session-affinity`, `X-Session-Id`, `x-opencode-session` e `x-opencode-session-id` (+ `x-opencode-parent-session-id` em subagentes); o Thinker só lia `x-session-key`. | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) | resolvida (`harness-session.ts:22-43`) |
| G2 | oportunidade | O snippet só cobre o formato v2. O site público agora também mostra o v2 (2026-11-06), mas o OpenCode 1 segue com releases (v1.19.5) e não entende `providers`/`package`/`settings`. Sugestão: alternar v1/v2 em `OpenCodeSetup.tsx` e nos docs, ou só uma nota com o formato v1. | frontend-dev | — | aberta |
| G3 | oportunidade | Os docs v2 recomendam o pacote nativo `@opencode/ai/providers/openai-compatible` e a credencial por `env`; o snippet usa `aisdk:@ai-sdk/openai-compatible` (válido, via compatibilidade). Avaliar migrar e conferir ao vivo se `settings.apiKey` funciona no pacote nativo. | frontend-dev | — | aberta |
| G4 | oportunidade | Parte resolvida: a sessão-mãe já é lida (`harness-session.ts:39-43`). Falta reconhecer o harness pelo `User-Agent` `opencode/<canal>/<versão>/<nome>` (e `x-opencode-client`) em `caller-classifier.ts`, e aproveitar `x-opencode-project` para agrupar por projeto. | backend-dev | — | aberta |
| G5 | oportunidade | Desde a v2.2.3 o OpenCode tem o provedor Claude Agent (`claude-agent`), que roda o Claude Code local e aceita `settings.baseURL`/`settings.authToken`. Apontado para o Thinker, o tráfego chega em `/v1/messages` como Claude Code. O Thinker não documenta esse caminho nem o efeito: modelos `claude-*` reais em vez de `auto`/virtuais e system prompt do Claude Code. Sugestão: seção em `conectar-harnesses.md` com o snippet `providers.claude-agent.settings` e a ressalva sobre modelos; testar ao vivo. | frontend-dev | [#478](https://github.com/patrickbrandao/thinker/issues/478) | documentada em `conectar-harnesses.md` (2026-11-12); teste ao vivo pendente |
| G6 | oportunidade | A técnica do Claude Agent (Agent SDK como backend de provedor, login do próprio Claude Code, ferramentas do harness via MCP) poderia virar um tipo de provedor no Thinker, alternativa ao caminho atual de OAuth capturado + imitação do Claude Code. Análise completa, riscos e propostas em [`claude-agent-provider-parecer.md`](../../referencia/opencode/claude-agent-provider-parecer.md). Aguarda decisão do mantenedor; sem issue. | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra a tag `v2.2.5` (cabeçalhos, affinity, retry, formato de config v2 e v1, docs v2) e o schema público. Aberta G1 (#318); G2-G4 registradas como oportunidade.
- 2026-11-06: revisão contra o `dev` `4db5933` (sem tag nova). Cabeçalhos inalterados; G1 resolvida; G4 resolvida em parte; site de docs migrado para v2; novo retry de rede de 1 h no `dev`; docs movidos para `services/site/`. Analisado o provedor Claude Agent (spec `specs/v2/claude-agent-provider.md` e código em `packages/core/src/plugin/provider/claude-agent/`): novas G5 (#478) e G6 (parecer em `docs/referencia/opencode/`).
