---
id: harness-opencode
categoria: harness
entidade: OpenCode
agente: harness-opencode
thinker_ids: [opencode]
revisado_em: 2026-11-03
versao_observada: opencode v2.2.5 (commit 9bbb8ce)
---

# OpenCode (harness)

Especificação mantida pelo agente `harness-opencode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- OpenCode (repositório `anomalyco/opencode`, branch `dev`) está na série **v2** (última: v2.2.5, 2026-10-30). A v2 reescreveu o formato de configuração: `providers` / `package` / `settings` no lugar de `provider` / `npm` / `options`. O site público de docs (`opencode.ai/docs`) ainda descreve o formato v1 e anuncia a v2 num banner; os docs v2 estão no fonte em `services/www/src/docs/content/`.
- Para um gateway, o OpenCode fala **Chat Completions** (pacote openai-compatible) e usa uma lista de modelos **escrita à mão na configuração**; não chama `GET /v1/models` de provedores customizados (só faz discovery para Ollama, LM Studio e vLLM).
- Em cada requisição de modelo envia um conjunto de cabeçalhos de sessão: `x-opencode-session-id`, `x-opencode-parent-session-id` (subagentes), `x-session-affinity`, `X-Session-Id`, `x-parent-session-id`, `x-opencode-project`, `x-opencode-session`, `x-opencode-client`, mais `User-Agent: opencode/<canal>/<versão>/<nome>`. **Não envia `x-session-key`**, o único cabeçalho de sessão que o Thinker lê (lacuna G1).
- O snippet de setup do Thinker segue válido para a v2 (`aisdk:@ai-sdk/openai-compatible` ainda é aceito); não cobre usuários do formato v1.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| OpenCode repository | <https://github.com/anomalyco/opencode> | tag `v2.2.5` (2026-10-30, commit 9bbb8ce18c80); `dev` ativo em 2026-11-04 |
| Docs v2 no fonte (providers, models, migrate-v1) | `services/www/src/docs/content/` do repositório, tag `v2.2.5` | v2.2.5 |
| CHANGELOG da v2 | `CHANGELOG.md` do repositório | v2.2.5 |
| Providers docs (site) | <https://opencode.ai/docs/providers/> | 2026-11-03 (ainda formato v1: `provider`, `npm`, `options`) |
| Config schema | <https://opencode.ai/config.json> | 2026-11-03 (aceita `providers` v2 e `provider` v1) |

## Contrato

### Configuração do gateway

- Arquivo: `~/.config/opencode/opencode.json` (ou `opencode.jsonc`, ou `opencode.json` no projeto). `$schema`: `https://opencode.ai/config.json`. (migrate-v1.mdx, v2.2.5)
- **Formato v2**: mapa `providers.<id>` com `package`, `name`, `env` (lista de variáveis que podem fornecer a credencial), `settings` (`baseURL`, `apiKey`, `timeout`, `headerTimeout`, `chunkTimeout`, `encoding`, ...), `headers`, `body`, `compatibility` e `models`. O id do provedor é o prefixo em `provider/model`. (providers.mdx, schema `packages/schema/src/config/provider.ts`)
- `package` aceita pacote nativo (`@opencode/ai/providers/openai-compatible`, `.../openai-compatible/responses`, `.../anthropic-compatible`, ...) ou pacote AI SDK com prefixo `aisdk:` (`aisdk:@ai-sdk/openai-compatible`). Os docs v2 usam o nativo no exemplo "Custom"; a migração v1 mapeia `npm` para `aisdk:<npm>`. (providers.mdx, migrate-v1.mdx)
- **Formato v1** (ainda documentado em opencode.ai/docs e aceito pelo schema): `provider.<id>` com `npm`, `name`, `options.baseURL`, `options.apiKey`, `options.headers`, `models`. A v2 migra esse formato automaticamente (`packages/core/src/v1/config/migrate.ts`). `apiKey` aceita `{env:VAR}` e `{file:path}`.
- `settings.baseURL` aplicado a um provedor substitui o endpoint de todos os modelos dele. `settings.encoding` (`zstd`/`gzip`/`none`) comprime o corpo; **só habilitar se o endpoint decodificar**, o padrão para chave de API é JSON puro (Thinker não precisa tratar).
- `body` do provedor/modelo mescla campos JSON no corpo da requisição; `headers` adiciona cabeçalhos fixos. Isso permite ao usuário enviar `x-session-key` por conta própria (não é automático).

### Seleção de modelo

- Para provedor customizado, os modelos vêm de `providers.<id>.models` (chave = id selecionável; `modelID` opcional mapeia para o id enviado ao upstream). Não há chamada a `/v1/models` do gateway; discovery dinâmico existe só para Ollama (`/api/tags`), LM Studio (`/api/v1/models`) e vLLM (`/v1/models`). (providers.mdx; `packages/core/src/plugin/provider/{lmstudio,vllm}.ts`)
- Modelo padrão: chave `model` no formato `provider/model` (`#variante` opcional). Sem a entrada em `models`, o modelo não existe para o OpenCode ("Model unavailable").
- Consequência: virtuais do Thinker (`auto`, nomes de modelos virtuais) precisam estar listados na configuração.
- `limit.context` / `limit.output` e `cost` por modelo são opcionais na config; sem `limit.output` o OpenCode usa 32.000 tokens de saída como fallback e limita a 256.000. (`model-request.ts`)

### Cabeçalhos e sessão

Enviados em toda requisição de modelo (sessões principais, subagentes, compactação, título) por `packages/core/src/session/model-request.ts:293-304` (v2.2.5):

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

- Affinity (`packages/core/src/session/affinity.ts`): filhos usam o id da mãe, forks usam a sessão de origem, senão o id da própria sessão. Serve para roteamento de cache no provedor.
- `promptCacheKey` da requisição = affinity sem o prefixo `ses_` (quando no formato `ses_<64 hex>`). O corpo carrega `prompt_cache_key` se o modelo declara `compatibility.supportsPromptCacheKey` (`packages/ai/src/providers/meta.ts` mostra o uso; para provedor customizado o padrão é configurável) (não confirmado para openai-compatible genérico).
- Gerações avulsas (`packages/core/src/generate.ts:120`) mandam só `x-opencode-session`. Chamadas ao Console (voz, limites de uso) mandam `x-opencode-org-id`, irrelevantes para o gateway.
- `app.name` e `channel`: o CLI usa `OPENCODE_CHANNEL` (build); o `User-Agent` do Thinker upstream usa `opencode/latest/2.2.5/cli`. O valor real do canal por distribuição (npm, brew, desktop) não foi confirmado (não confirmado).
- O OpenCode **não** envia `x-session-key` (grep no fonte da v2.2.5). Se envia `x-stainless-*` não foi verificado (não confirmado).

### Outros endpoints

- Contra o gateway configurado, só a rota de inferência (`POST {baseURL}/chat/completions`, ou `/responses` com o pacote `.../responses`). Sem token counting, health ou telemetria para o gateway.
- Streaming com `stream_options: { include_usage: true }` por padrão (`compatibility.streamUsage` pode desligar). O Thinker precisa devolver o chunk final de `usage`. (`packages/ai/src/protocols/openai-chat.ts:910`)
- Telemetria/atualização do próprio OpenCode vai para `opencode.ai`/models.dev, fora do gateway.

### Recursos usados

- Chat Completions com streaming, tool calls (paralelos e em subagentes: requisições concorrentes com sessões-filhas), reasoning (variantes por modelo, controladas por `capabilities.reasoning` na config), imagens (reduz imagens acima de 25 MiB, alvo 15 MiB), compactação automática (`compaction.buffer`, aceita porcentagem desde v2.2.5), cache de prompt via `cache.ttl` do modelo.
- Erros de janela de contexto (inclusive os do LiteLLM, v2.2.5) disparam compactação em vez de falha: o gateway deve devolver um erro de contexto reconhecível (`context_length_exceeded` ou texto equivalente) (não confirmado o conjunto exato de padrões; ver `packages/core/src/session/to-session-error.ts`).

### Erros e retentativas

- Política de retry do modelo (`packages/core/src/model-retry.ts`): até 10 retentativas com backoff exponencial de 2 s, teto de 10 s por intervalo, com jitter (~84 s no total); respeita `retry-after` em `RateLimit` e `ProviderInternal` (limite de 15 min). Timeouts: no máximo 3 retentativas.
- Falhas não retentáveis (por exemplo 4xx de requisição inválida) encerram o passo. Chamadas avulsas (título, etc.) só retentam falhas em que o provedor não chegou a executar (DNS, conexão recusada), 3 vezes.
- Recomendação para o Thinker: 429/5xx transitórios com `retry-after` correto; erro 4xx claro e rápido para modelo inexistente.

### Snippet de setup do Thinker

Correto para a v2.2.5. `aisdk:@ai-sdk/openai-compatible` com `settings.baseURL` e `settings.apiKey` é aceito (o schema deixa campos extras em `settings` passarem ao pacote). O exemplo dos docs v2 usa o pacote nativo e `env` em vez de chave literal. Usuários do OpenCode v1 precisam do formato `provider`/`npm`/`options`; ver G2 e G3.

## Como o Thinker implementa hoje

Superfície: Chat Completions (`packages/shared/src/agent-type.ts:86`). Plataforma `opencode` listada em `AGENT_PLATFORMS` (`agent-type.ts:36`), nome de exibição `OpenCode` (`:112`), categoria `coding` (`:132`).

Sessão do chamador (lado entrada):
- Só `x-session-key` é lido: `packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`; `proxy-session-scope.ts:22-37` (sem o cabeçalho, a chave é `default`, sem `providerCacheKey` nem `momentumKey`). Nenhum código lê `x-opencode-session-id`, `x-session-affinity`, `X-Session-Id` ou `x-opencode-parent-session-id` (grep em `packages/backend/src` e `packages/shared/src`). Nesta `main` não existe `harness-session.ts`.
- Classificação do chamador por `User-Agent`/Stainless em `caller-classifier.ts:35-66`; não reconhece `opencode/...`.

Lado saída (Thinker como cliente do OpenCode/OpenCode Go, não é o harness): `provider-hooks.ts:47-68` envia `x-opencode-session` (usa `x-session-key` ou a chave do agente) aos provedores `opencode` e `opencode-go`; `provider-endpoints.ts:618` e `subscription-clients.ts:25-27` fixam `User-Agent: opencode/latest/2.2.5/cli` e `x-opencode-client: cli` (ADR 0009). Está alinhado com a v2.2.5 observada.

Setup:
- `packages/frontend/src/components/OpenCodeSetup.tsx:18-40` gera `opencode.json` v2: `providers.thinker` com `package: 'aisdk:@ai-sdk/openai-compatible'`, `name: 'Thinker'`, `settings: { baseURL, apiKey }`, `models` com `auto` e os modelos virtuais do harness (`Thinker <nome>`), `model: 'thinker/auto'`.
- `docs/usuario/conectar-harnesses.md:57-80` documenta o mesmo snippet (apenas formato v2); `:143` lembra de listar cada virtual em `providers.thinker.models`.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/OpenCodeSetup.tsx`

Arquivos que citam `opencode` (provedores OpenCode/OpenCode Go, fora do escopo deste harness; ver agentes `sub-opencode` e `sub-opencode-go`):

- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O OpenCode envia a sessão em `x-session-affinity`, `X-Session-Id`, `x-opencode-session` e `x-opencode-session-id` (+ `x-opencode-parent-session-id` em subagentes), mas o Thinker só lê `x-session-key` (`proxy.controller.ts:277,899`). Resultado: sessão `default`, sem afinidade de prompt cache nem momentum de roteamento, e subagentes/conversas misturados. Sugestão: usar affinity como fallback de `x-session-key`; guardar session/parent para atribuição. O `harness-session.ts` em desenvolvimento pode cobrir isto. | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) | resolvida (sessão de prompt cache e momentum lida dos cabeçalhos do harness) |
| G2 | oportunidade | O snippet só cobre o formato v2. O site público de docs ainda descreve o v1 (`provider`/`npm`/`options.baseURL`/`options.apiKey`); quem usa v1 recebe uma config que o v1 não entende. Sugestão: alternar v1/v2 em `OpenCodeSetup.tsx` e nos docs. | frontend-dev | — | aberta |
| G3 | oportunidade | Os docs v2 recomendam o pacote nativo `@opencode/ai/providers/openai-compatible` e a credencial por `env`; o snippet usa `aisdk:@ai-sdk/openai-compatible` (válido, via caminho de compatibilidade). Avaliar migrar o snippet e conferir ao vivo se `settings.apiKey` funciona no pacote nativo. | frontend-dev | — | aberta |
| G4 | oportunidade | Cabeçalhos úteis para observabilidade não aproveitados: `x-opencode-parent-session-id` (árvore de subagentes), `x-opencode-project`, `User-Agent` `opencode/<canal>/<versão>/<nome>` para reconhecer o harness automaticamente em `caller-classifier.ts`. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra o fonte da tag `v2.2.5` (cabeçalhos em `model-request.ts`, affinity, retry, formato de config v2 e v1, docs v2 do repositório) e o schema público. Aberta G1 (#318); G2-G4 registradas como oportunidade, sem issue.
