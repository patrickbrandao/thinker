---
id: harness-nanobot
categoria: harness
entidade: Nanobot
agente: harness-nanobot
thinker_ids: [nanobot]
revisado_em: 2026-11-03
versao_observada: nanobot v0.4.0 (commit 8f7a7d1)
---

# Nanobot (harness)

Especificação mantida pelo agente `harness-nanobot` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Identificação confirmada: Nanobot é o agente pessoal open source [HKUDS/nanobot](https://github.com/HKUDS/nanobot) (Python, pacote `nanobot`, config em `~/.nanobot/config.json`), tag `v0.4.0` de 2026-10-28. A semente da fonte estava correta. Não confundir com `obot-platform/nanobot` (agente MCP em Go, outro projeto).
- Fala Chat Completions pelo SDK `openai` (>=2.8.0) quando o provedor é `custom`; também sabe Responses e Anthropic Messages, mas `custom` usa Chat Completions por padrão.
- O snippet atual do Thinker (`provider: "custom"`, `model: "auto"`, `apiKey`, `apiBase`) continua válido no v0.4.0.
- Envia `x-session-affinity` (uuid por processo), que o Thinker não lê; nenhum cabeçalho `x-session-key` é enviado.
- Nenhuma quebra encontrada; 1 degradação (sessão) e 2 oportunidades.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Repositório HKUDS/nanobot (confirmada; substitui a semente não confirmada) | <https://github.com/HKUDS/nanobot> | v0.4.0, commit 8f7a7d1 (2026-10-28) |
| Configuração e provedores (`docs/configuration.md`, `docs/providers.md`) | <https://github.com/HKUDS/nanobot/blob/v0.4.0/docs/configuration.md> | v0.4.0 |
| Código dos provedores (`nanobot/providers/`) | <https://github.com/HKUDS/nanobot/tree/v0.4.0/nanobot/providers> | v0.4.0 |
| Schema de config (`nanobot/config/schema.py`) | <https://github.com/HKUDS/nanobot/blob/v0.4.0/nanobot/config/schema.py> | v0.4.0 |
| Notas de release (`docs/releases/0.4.0.md`; o rascunho ainda diz "não publicado" embora a tag exista) | <https://github.com/HKUDS/nanobot/releases> | v0.4.0 |

## Contrato

Fonte de tudo abaixo: código e docs de `HKUDS/nanobot` na tag v0.4.0, lidos em clone raso.

### Configuração do gateway

- Arquivo `~/.nanobot/config.json` (chaves em camelCase; também aceita snake_case). A WebUI (Settings -> Models) edita o mesmo arquivo.
- Provedor interno `custom` = qualquer endpoint compatível com OpenAI (`registry.py`, `ProviderSpec(name="custom")`, backend `openai_compat`). Campos: `providers.custom.apiKey`, `apiBase`, `extraHeaders` (dict), `api` (`supportedApis`/`preferredApi`, padrão Chat Completions), `useProxy`.
- Qualquer outra chave sob `providers` vira um provedor personalizado nomeado (`providers.companyProxy.apiBase`).
- O modelo ativo vem de `agents.defaults.provider` + `agents.defaults.model`, a menos que `agents.defaults.modelPreset` esteja definido: o preset tem precedência (`schema.py:171`, comentário "takes precedence"). Presets ficam em `modelPresets.<nome>` com `provider`, `model`, `reasoningEffort`, `api`.
- `apiBase` é passado como `base_url` do `AsyncOpenAI`; o SDK acrescenta `/chat/completions`. Logo a URL do Thinker deve terminar em `/v1`. Sem `apiKey`, o cliente usa a chave literal `no-key` (`openai_compat_provider.py:527`).
- Padrões relevantes de `agents.defaults` (`schema.py:167-200`): `maxTokens` 8192, `contextWindowTokens` 200000, `temperature` 0.1, `provider` "auto", `providerRetryMode` "standard".
- Também pode apontar para variáveis de ambiente com `${VAR}` no JSON.

### Seleção de modelo

- Não há ids fixos: o usuário escreve o id em `agents.defaults.model` (ou no preset). Para o provedor `custom` o id é enviado sem alteração ao servidor (`request_model_name` não remove prefixo quando não há `spec` específico), então `auto` e virtuais como `deepseek/flash` passam intactos.
- `GET {apiBase}/models` só é chamado pela WebUI ao carregar a lista de modelos de um provedor (`webui/settings_models.py:751`, Bearer no `Authorization`, timeout 10 s, 401/403 = credencial recusada). Falha não impede o uso: o id digitado manualmente funciona.
- Temperature 0.1 é enviada, exceto em modelos cujo nome contém `gpt-5`, `o1`, `o3`, `o4` ou `gpt-6` sem effort `none` (`_supports_temperature`). Como o Nanobot decide pelo nome do modelo que o cliente enviou, `auto` recebe temperature.

### Cabeçalhos e sessão

| Cabeçalho | Quando | Valor |
|---|---|---|
| `x-session-affinity` | toda chamada do provedor `openai_compat` (e `azure_openai`) | uuid hex gerado no construtor do provedor, fixo durante o processo (`openai_compat_provider.py:516`); NÃO é por conversa |
| `x-opencode-session` | só se o provedor/endpoint for OpenCode | sha256 do `session_id` da conversa (`:876-888`) |
| `Authorization: Bearer` | sempre | `apiKey` |
| `User-Agent` | sempre | padrão do SDK `openai` (`AsyncOpenAI/Python <versão>`, não confirmado ao vivo) |
| cabeçalhos extras | se `extraHeaders` | mesclados nos padrões (`:519`) |

- Não envia `x-session-key`, id de subagente nem de pai. Subagentes (`maxConcurrentSubagents` 4) usam o mesmo provedor e portanto o mesmo `x-session-affinity`.
- Para fixar uma chave de sessão estática dá para usar `providers.custom.extraHeaders` com `x-session-key` (valor único para todas as conversas; não confirmado ao vivo).

### Outros endpoints

- Chamados no gateway: apenas `POST /chat/completions` (e `/models` pela WebUI). Não há contagem de tokens, telemetria nem health no provedor `custom`.
- Com `custom` e `api` padrão não usa Responses; só se o usuário declarar `supportedApis`/`preferredApi`.
- O Nanobot também expõe sua própria API compatível (`nanobot serve`, porta 8900, `/v1/chat/completions` e `/v1/models`): é o sentido inverso (Nanobot como servidor), irrelevante para o Thinker.

### Recursos usados

- Streaming com `stream_options: {"include_usage": true}` (`:1893`); tool calls; imagens (anexos); compactação de histórico ociosa (`idleCompactAfterMinutes` 15 min); subagentes; MCP.
- `max_tokens` (ou `max_completion_tokens` para gpt-5/o-series) = `maxTokens`.
- `reasoning_effort` só é enviado se configurado (`reasoningEffort`); por padrão não.
- `cache_control` só é injetado quando o provedor declara `supports_prompt_caching` e o modelo começa com `anthropic/` ou `claude`; não ocorre com `custom` (`:907`).
- `fallbackModels` e presets de fallback são resolvidos no cliente.

### Erros e retentativas

- `max_retries=0` no SDK; a política própria está em `providers/base.py`: status 408, 409 e 429 são retentáveis, com exceções para 429 de cota/saldo (tokens e textos em `_NON_RETRYABLE_429_*`, ex.: quota, billing). Respeita `Retry-After` e `x-should-retry`. Modo `persistent` repete indefinidamente.
- 401/403 não são retentados. Timeout configurável por provedor.

### Snippet de setup do Thinker

Correto no v0.4.0 (chaves `agents.defaults.provider`, `agents.defaults.model`, `providers.custom.apiKey`, `providers.custom.apiBase`). Ressalva: se o usuário já tem `agents.defaults.modelPreset` (a WebUI v0.4 cria presets), o preset vence e o snippet parece não ter efeito.

## Como o Thinker implementa hoje

- Superfície declarada `chat_completions`, rótulo "Nanobot", grupo `personal` (`packages/shared/src/agent-type.ts:27,77,103,129`).
- Snippet `getNanobotConfigSnippet` (`packages/shared/src/setup-snippets.ts:56-71`): `provider: "custom"`, `model: "auto"`, `apiKey`, `apiBase = baseUrl`; registrado em `PLATFORM_SETUP_SNIPPETS` (`:116`). Cópia no frontend: `packages/frontend/src/services/framework-snippets.ts`, UI em `packages/frontend/src/components/NanobotSetup.tsx`.
- Guia do usuário: `docs/usuario/conectar-harnesses.md:102` (só cita que fala Chat Completions) e `:146` (`agents.defaults.model` em `~/.nanobot/config.json`).
- Sessão: o Thinker só lê `x-session-key` (`packages/backend/src/routing/proxy/proxy.controller.ts:277`, `:899`); `x-session-affinity` não é lido em lugar nenhum de `packages/backend/src`. Ausente => sessão `default`.
- Identificação do chamador: `caller-classifier.ts:97` casa `^OpenAI\/(\w+)`; o UA do SDK assíncrono (`AsyncOpenAI/Python`) não casa (não confirmado ao vivo).
- `envelope-peeler.ts:4` cita NanoBot como agente que embrulha o prompt do usuário.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/scoring/envelope-peeler.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/NanobotSetup.tsx`
- `packages/frontend/src/services/framework-snippets.ts`

Arquivos que citam `nanobot`:

- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O Nanobot envia `x-session-affinity` (uuid por processo) e nenhum `x-session-key`; o Thinker não lê o primeiro, então toda conversa cai em `default`. Mesma causa de #318 (OpenCode). Ler `x-session-affinity` como chave de sessão ajuda só por processo; ou o snippet pode sugerir `extraHeaders` com `x-session-key` estático. | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) (comentado) | aberta |
| G2 | oportunidade | Padrões do Nanobot (`maxTokens` 8192, `contextWindowTokens` 200000) não refletem o modelo real roteado; o snippet poderia incluir `maxTokens`/`contextWindowTokens` e avisar do `modelPreset` que vence `agents.defaults`. | frontend-dev | — (sem issue) | aberta |
| G3 | oportunidade | `classifyCaller` não reconhece o UA `AsyncOpenAI/Python` (regex ancorada em `OpenAI/`), então chamadas do Nanobot ficam sem SDK atribuído. Não confirmado ao vivo. | backend-dev | — (sem issue) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra HKUDS/nanobot v0.4.0 (8f7a7d1). Projeto confirmado; snippet válido; G1-G3 registradas; comentário em #318.
