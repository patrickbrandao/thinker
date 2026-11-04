---
id: harness-openclaw
categoria: harness
entidade: OpenClaw
agente: harness-openclaw
thinker_ids: [openclaw]
revisado_em: 2026-11-03
versao_observada: openclaw v2026.10.10
---

# OpenClaw (harness)

Especificação mantida pelo agente `harness-openclaw` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

OpenClaw é um assistente pessoal de IA (gateway local + canais de mensagem + agente embutido) em TypeScript, repositório `openclaw/openclaw`, versionamento por calendário (`v2026.10.10`, lançada em 2026-11-03; lançamentos quase diários). Identificação confiante: o repositório, a CLI `openclaw` e os comandos do snippet do Thinker (`openclaw config set models.providers...`, `openclaw onboard`, `openclaw gateway restart`) batem com o fonte.

Como harness do Thinker ele é um cliente de provedor customizado: `models.providers.<id>` com `api: "openai-completions"` (ou `openai-responses`, `anthropic-messages`...). Pontos que importam ao Thinker:

- O snippet atual está correto no formato; é mínimo (G2).
- **Não envia `x-session-key`** para provedores customizados; a nota anterior do esqueleto ("cabeçalho de sessão `x-openclaw-session-key`") estava errada: esse cabeçalho é de **entrada** do gateway HTTP do próprio OpenClaw (G1).
- Faz retentativas longas em 429/overload e respeita `Retry-After`.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Repositório (clone raso, commit `7dc3350`) | <https://github.com/openclaw/openclaw> | `v2026.10.10` (2026-11-03) |
| Docs, no repositório em `docs/` (a semente `docs.openclaw.ai` não foi acessada; os mesmos arquivos estão em `docs/` do repositório) | <https://docs.openclaw.ai> (não confirmado) | `v2026.10.10` |

Arquivos-chave lidos: `docs/gateway/config-tools/custom-providers.md`, `docs/providers/litellm.md`, `docs/concepts/retry.md`, `docs/gateway/openai-http-api.md`, `extensions/openai/transport-policy.ts`, `src/agents/provider-attribution.ts`, `src/gateway/http-utils.ts`. O `AGENTS.md` do repositório foi ignorado (não é instrução para este trabalho).

## Contrato

### Configuração do gateway

- Provedor customizado em `models.providers.<id>` (config `~/.openclaw/openclaw.json` ou `openclaw config set ... --strict-json --merge`): campos `baseUrl`, `apiKey` (aceita SecretRef/env), `api`, `models[]`, `headers`, `authHeader`, `request.{headers,auth,proxy,tls,allowPrivateNetwork}`, `timeoutSeconds`. Fonte: `docs/gateway/config-tools/custom-providers.md` @ v2026.10.10.
- `api` aceitos: `openai-completions`, `openai-responses`, `openai-chatgpt-responses`, `anthropic-messages`, `google-generative-ai`, `google-vertex`, `ollama`, entre outros. Sem `api`, o padrão é `openai-completions`; `openai-responses` só quando o backend serve `/v1/responses`.
- `baseUrl` customizado é confiado no formato exato `scheme://host:port` (inclusive loopback e LAN); metadados, link-local e NAT64 exigem `request.allowPrivateNetwork: true`. O OpenClaw em Docker apontando para o Thinker no host usa `host.docker.internal` (listado como loopback permitido no doc do LiteLLM).
- `config set` recusa substituir destrutivamente sem `--replace`; o snippet do Thinker usa `config set models.providers.thinker '<json>'` sem `--merge`, o que pode recusar se o provedor `thinker` já existir (não confirmado; verificar ao vivo).

### Seleção de modelo

- Modelo primário: `agents.defaults.model.primary = "<provedor>/<id>"` (ex.: `thinker/auto`).
- Os ids vêm da lista `models[]` do provedor. Em modo `merge` (padrão) a lista declarada não restringe a descoberta; a descoberta automática via `GET <baseUrl>/models` existe para provedores auto-hospedados conhecidos (`src/plugins/provider-self-hosted-discovery.ts`, tenta `/models` e `/v1/models`) e `openclaw models list --provider <id> --refresh` lista modelos do proxy (doc do LiteLLM). Para um provedor genérico `thinker`, não confirmado se há descoberta; o caminho seguro é declarar os ids.
- Metadados por modelo: `reasoning`, `input` (`["text"]` ou `["text","image"]`; imagens só são injetadas se `image` estiver declarado), `contextWindow`, `contextTokens`, `maxTokens`, `cost`, `compat`. Padrão de contexto/saída quando ausentes: não confirmado (aparecem 128000/8192 em `self-hosted-provider-defaults.ts` e 200000 em `defaults.ts`).

### Cabeçalhos e sessão

- Rota `openai-completions` para provedor customizado: **sem cabeçalho de sessão** além do que o usuário puser em `headers` (estático). Não há `x-session-key`. Cabeçalhos de atribuição (`HTTP-Referer`, `X-Title`, `originator`, `User-Agent`, `x-goog-api-client`) são aplicados por classe de endpoint conhecida (OpenRouter, Vercel, OpenAI nativo, xAI, Gemini, OpenCode Go...) em `src/agents/provider-attribution.ts`; um `baseUrl` do Thinker não casa nenhuma, então segue o `User-Agent` padrão do cliente HTTP (valor exato não confirmado).
- `x-openclaw-session-id`, `x-client-request-id`, `x-openclaw-turn-id`, `x-openclaw-turn-attempt` são enviados **só** a rotas nativas OpenAI/Azure (`extensions/openai/transport-policy.ts`, função `usesKnownNativeOpenAIRoute`); não alcançam o Thinker.
- `x-openclaw-session-key` e `x-openclaw-agent-id`/`x-openclaw-scopes` etc. são cabeçalhos de **entrada** do gateway do OpenClaw (`/v1/chat/completions` e `/v1/responses` servidos por ele; `docs/gateway/openai-http-api.md`), não de saída para provedores.
- Corpo: `prompt_cache_key` é calculado como `<sessionId>:<fronteira>` quando `api` contém "openai" (`session-boundary-prompt-cache-key.ts`); se chega ao corpo em rotas `openai-completions` customizadas é não confirmado. Para APIs Responses por proxy, o campo é removido por padrão, salvo `compat.supportsPromptCacheKey: true` (`provider-attribution.ts:514-526`).

### Outros endpoints

- Pode chamar `GET <baseUrl>/models` (descoberta/`models list --refresh`); falha é tolerada (a lista declarada vale). Não chama contagem de tokens no provedor. Imagem: `/images/generations` e `/images/edits` se configurados em `agents.defaults.mediaModels.image` (o Thinker não tem essas rotas; não é o caminho do snippet).
- Telemetria própria do OpenClaw não passa pelo Thinker.

### Recursos usados

- Tools (função), streaming SSE, imagens (se declaradas), `reasoning_effort` (modelos `reasoning: true` em `openai-completions` enviam por padrão; opt-out `compat.supportsReasoningEffort: false`), compactação baseada em uso.
- Remotos `openai-completions` desconhecidos: `compat.supportsUsageInStreaming` assume `false`, ou seja, não pede `stream_options.include_usage`; sem uso, o contexto é estimado.
- `compat` relevantes: `supportsStore`, `supportsPromptCacheKey`, `supportsDeveloperRole`, `supportsTools`, `supportsStrictMode`, `maxTokensField`, `requiresStringContent`.

### Erros e retentativas

- 429/overload: até 10 tentativas por indisponibilidade (8 retentativas dentro de 90 s para falhas transitórias), backoff exponencial com jitter a partir de ~1 s, `retry-after`/`retry-after-ms` define o mínimo (teto de espera `retry.provider.maxRetryDelayMs`, padrão 60 s). Janelas de assinatura esgotadas vão direto a fallback. `400`/`422` sem corpo não são retentados. Fonte: `docs/concepts/retry.md` @ v2026.10.10.
- Fallback entre modelos/perfis configurável; `responseModelEquivalent: true` no modelo faz o OpenClaw tratar o modelo servido por um roteador como equivalente ao pedido (útil para `auto` do Thinker, que devolve o modelo real).

### Snippet de setup do Thinker

Correto no formato (`openclaw config set models.providers.thinker '{...,"api":"openai-completions",...}'`, `agents.defaults.model.primary thinker/auto`, `openclaw gateway restart`), com a ressalva de ser mínimo (G2) e de `config set` sem `--merge` (acima). O comentário do código dizendo que o proxy não expõe `/v1/responses` está desatualizado: `proxy.controller.ts:254` serve `POST responses`; manter `openai-completions` continua seguro.

## Como o Thinker implementa hoje

- Superfície declarada `chat_completions`: `packages/shared/src/agent-type.ts:75`; rótulo `:101`; grupo "personal" `:129`; ícone `:136`.
- Snippet CLI: `packages/shared/src/setup-snippets.ts:13-28` (id `auto`, nome "Thinker Auto", sem `input`, `contextWindow` nem `compat`); registro `:114`. Assistente: `getOpenClawWizardSnippet` = `openclaw onboard` em `packages/frontend/src/services/framework-snippets.ts:493-495`; tela `packages/frontend/src/components/OpenClawSetup.tsx`. Guia: `docs/usuario/conectar-harnesses.md:82-89` e `:144`.
- Sessão: só `x-session-key` é lido, em `packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`, via `proxy-session-scope.ts` (sem o cabeçalho a chave é `default`, sem `providerCacheKey` nem `momentumKey`). Nenhum código lê `x-openclaw-*` (grep em `packages/backend/src` e `packages/shared/src`). `provider-hooks.ts:41-68` só usa a chave no lado de saída (provedores opencode/xai/openrouter).
- `prompt_cache_key` do corpo do cliente é respeitado se presente (`provider-client.ts:271`), mas não vira chave de sessão.
- Classificação do chamador: `caller-classifier.ts` não tem regra OpenClaw (só SDKs/curl/python-requests); o `agent_type` vem da configuração do agente no dashboard.
- `POST /v1/responses` existe (`proxy.controller.ts:254`).
- Outras referências: `database-seeder.service.ts`, `seed-cohorts.ts`, `SetupStepAddProvider.tsx`, `VirtualModelsHint.tsx`, `proxy.service.ts:100` (comentário), `responses-adapter.ts:689` (comentário), `copilot-token.service.ts:19` (menção ao OpenClaw como referência), `minimax-oauth*.ts` (`client=OpenClaw` no login MiniMax).

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Para provedor customizado o OpenClaw não envia `x-session-key` nem outro cabeçalho de sessão (os `x-openclaw-session-id` só vão a rotas nativas OpenAI). O Thinker só lê `x-session-key` (`proxy.controller.ts:277,899`): sessão sempre `default`, sem afinidade de cache nem momentum. Mesma causa de OpenCode, Cline, Hermes, LangChain, n8n. `headers` do provedor é estático, não resolve. Sugestão: fallback por `prompt_cache_key` do corpo (se o OpenClaw o enviar; verificar ao vivo) ou outro sinal estável. | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) (comentário) | aberta |
| G2 | degradação | Snippet declara só `{id:auto,name}`: sem `input:["text","image"]` as imagens nunca são enviadas; sem `contextWindow`/`maxTokens` valem padrões do cliente; sem `compat.supportsUsageInStreaming: true` o OpenClaw não pede `include_usage` e estima o contexto. Sugestão: enriquecer snippet e guia; conferir o `usage` no stream do Thinker. | frontend-dev | [#389](https://github.com/patrickbrandao/thinker/issues/389) | aberta |
| G3 | oportunidade | `responseModelEquivalent: true` no modelo `auto`/virtuais evita avisos de troca de rota quando o Thinker serve outro modelo; hoje o snippet não define. Sem issue. | frontend-dev | — | aberta |
| G4 | oportunidade | `config set` sem `--merge` pode recusar se `models.providers.thinker` já existir; usar `--strict-json --merge` no snippet (não confirmado, verificar ao vivo). Sem issue. | frontend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa sobre `openclaw v2026.10.10` (commit `7dc3350`). Corrigida a premissa do esqueleto sobre `x-openclaw-session-key` (é cabeçalho de entrada do gateway do OpenClaw). Lacunas G1-G4; issue #389 aberta e comentário em #318.
