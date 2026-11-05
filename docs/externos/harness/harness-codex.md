---
id: harness-codex
categoria: harness
entidade: Codex CLI
agente: harness-codex
thinker_ids: [codex]
revisado_em: 2026-11-03
versao_observada: codex rust-v0.166.0 (commit 6ff1e1c)
---

# Codex CLI (harness)

Especificação mantida pelo agente `harness-codex` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- **Identificação confirmada:** o Codex CLI é o projeto `openai/codex` (Rust, workspace `codex-rs/`), última estável `rust-v0.166.0` (2026-10-29); a série `0.167.0-alpha.*` está em pré-lançamento. O seed (repositório, `docs/config.md`, releases) estava certo, mas `docs/config.md` virou um ponteiro: a referência de configuração vive em <https://developers.openai.com/codex/config-advanced> e `config-reference`.
- Para um gateway, o Codex fala **somente a API Responses** (`POST {base_url}/responses`, SSE). `wire_api = "chat"` foi **removido** e dá erro de configuração; o único valor aceito é `"responses"`. O snippet do Thinker continua correto.
- **Modelos:** num provedor customizado com `env_key`, o Codex **não chama `GET /models`** (só consulta catálogo com `model_catalog_url` ou no provedor OpenAI embutido). Modelo fora do catálogo embutido usa metadados de fallback (janela de 272.000 tokens, sem a ferramenta `apply_patch` freeform) e mostra o aviso "Model metadata ... not found". O `context_length` que o Thinker publica em `/v1/models` não chega ao Codex.
- **Sessão:** toda requisição leva os cabeçalhos `session-id` e `thread-id` (com hífen desde ~0.150; antes `session_id`/`thread_id` com sublinhado), `x-client-request-id` (= thread id) e `prompt_cache_key` no corpo (= session id). Subagentes acrescentam `x-openai-subagent` e `x-codex-parent-thread-id`. **O Thinker não lê nenhum deles**; todas as sessões do Codex caem em `default` (lacuna G1, mesma causa de #318 e #320).
- Retentativas do Codex: 4 tentativas para 5xx e erros de rede, **429 não é retentado** no nível HTTP; fluxo SSE cortado tem até 5 reconexões.
- Ferramentas: com modelo do catálogo embutido o Codex anuncia `apply_patch` como ferramenta `custom` (freeform) e `web_search`; o adaptador Responses para Chat do Thinker descarta tudo que não seja `function`/`namespace` (lacuna G2).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Codex repository (código em `codex-rs/`) | <https://github.com/openai/codex> | tag `rust-v0.166.0`, commit 6ff1e1c; `main` ativo em 2026-11-04 |
| Releases | <https://github.com/openai/codex/releases> | `rust-v0.166.0` (2026-10-29); `0.167.0-alpha.4` (2026-11-03) |
| `docs/config.md` do repositório | <https://github.com/openai/codex/blob/main/docs/config.md> | só ponteiro para os docs do site (confirmado em 0.166.0) |
| Config avançada (model_providers) | <https://developers.openai.com/codex/config-advanced> | 2026-11-03 (lido só o trecho sobre `openai_base_url` e config de projeto) |
| Fonte de provedores | `codex-rs/model-provider-info/src/lib.rs` | 0.166.0 |
| Fonte de cabeçalhos/sessão | `codex-rs/codex-api/src/requests/headers.rs`, `endpoint/responses.rs`, `codex-rs/core/src/client.rs`, `core/src/responses_metadata.rs` | 0.166.0 |

Nenhuma fonte do seed estava errada; só `docs/config.md` deixou de ser a referência (ver acima).

## Contrato

Tudo abaixo vem do fonte da tag `rust-v0.166.0` salvo indicação.

### Configuração do gateway

- Arquivo `~/.codex/config.toml` (CLI, app desktop e extensão leem o mesmo). Provedor customizado em `[model_providers.<id>]`, selecionado por `model_provider = "<id>"` no topo; `model = "<slug>"` escolhe o modelo. A config de projeto (`.codex/config.toml`) **ignora** `model_provider`, `model_providers` e `openai_base_url` (docs config-advanced, 2026-11-03), então o provedor tem de ficar no arquivo do usuário.
- Campos do provedor (`ModelProviderInfo`, `deny_unknown_fields`): `name`, `base_url`, `env_key` (variável com a chave; vira `Authorization: Bearer`), `experimental_bearer_token`, `auth` (comando que devolve token), `wire_api`, `query_params`, `http_headers`, `env_http_headers`, `request_max_retries` (padrão 4, teto 100), `stream_max_retries` (padrão 5), `stream_idle_timeout_ms` (padrão 300000), `websocket_connect_timeout_ms`, `requires_openai_auth` (padrão false), `supports_websockets` (padrão false), `supports_standalone_web_search`, `capabilities` (`external_web_access`, `remote_compaction`), `model_catalog_url`. Campo desconhecido é erro.
- `wire_api`: só `"responses"`; `"chat"` falha com a mensagem "`wire_api = "chat"` is no longer supported" e o provedor embutido `ollama-chat` foi removido (discussão openai/codex#7782).
- `base_url` recebe `responses` anexado (`{base_url}/responses`). O snippet do Thinker usa `http://<host>:2099/v1`. O fluxo documentado para a chave é `env_key` + `export`.
- Alternativa para só redirecionar o provedor OpenAI embutido: `openai_base_url` (docs config-advanced). Não serve ao Thinker porque exigiria login OpenAI.
- Overrides úteis no mesmo arquivo: `model_context_window`, `model_auto_compact_token_limit`, `model_reasoning_effort`, `model_reasoning_summary`, `model_verbosity`, `model_catalog_json` (catálogo local no formato nativo do Codex).

### Seleção de modelo

- O slug vem de `model` (config, `-m`/`--model`, `/model` na TUI). Não existe lista fixa para provedor customizado.
- **O Codex só consulta catálogo remoto quando** o provedor usa o backend ChatGPT, tem auth por comando, ou (com chave de API) tem `model_catalog_url` ou é o provedor `openai` sem `base_url` (`model-provider/src/models_endpoint.rs:320`, `models-manager/src/manager.rs:742-768`). Num provedor customizado simples **não há chamada a `/models`**.
- Quando consulta, a URL é `{base_url}/models?client_version=<versão>` (ou `model_catalog_url` com os mesmos parâmetros) e o corpo esperado é `{"models":[ModelInfo...]}` no formato **nativo do Codex**, não o `{"data":[...]}` da OpenAI (`codex-api/src/endpoint/models.rs`). Resposta no formato OpenAI não decodifica.
- Slug ausente do catálogo: `model_info_from_slug` gera metadados de fallback: `context_window` e `max_context_window` 272.000, `effective_context_window_percent` 95, `apply_patch_tool_type` nenhum, sem níveis de raciocínio, `shell_type` UnifiedExec, truncamento de 10.000 bytes, e registra um aviso na TUI (`models-manager/src/model_info.rs:98-148`, `core/src/session/turn_context.rs:1417`). A busca no catálogo embutido faz prefixo mais longo e sufixo após `/` (`custom/gpt-5.3-codex`).
- Consequência para o Thinker: `auto` e modelos virtuais sempre usam fallback. Funciona, mas a janela e a compactação ficam calibradas em 272K, independente do modelo real roteado (G3).

### Cabeçalhos e sessão

Enviados em toda requisição Responses HTTP (e no handshake WebSocket, desligado em provedor customizado):

| Cabeçalho / campo | Valor | Quando | Fonte |
|---|---|---|---|
| `session-id` | id da sessão (UUID); em thread raiz é o mesmo valor do `prompt_cache_key` | sempre | `codex-api/src/requests/headers.rs`, `core/src/client.rs:732` |
| `thread-id` | id da thread/conversa | sempre | idem |
| `x-client-request-id` | igual ao `thread-id` | sempre | `codex-api/src/endpoint/responses.rs:88` |
| `x-openai-subagent` | `review`, `compact`, `memory_consolidation`, `collab_spawn` ou rótulo livre | subagente, compactação ou revisão | `headers.rs` (`subagent_header`) |
| `x-codex-parent-thread-id` | thread-mãe | subagente com mãe | `core/src/responses_metadata.rs:407` |
| `x-codex-window-id` | id da janela (TUI/app) | sempre | `responses_metadata.rs:392` |
| `x-codex-turn-metadata` | JSON ASCII com metadados do turno | quando há metadados de turno | `responses_metadata.rs:395` |
| `x-codex-turn-state` | token de roteamento "pegajoso" devolvido pelo servidor e reenviado | só se o servidor o devolve (backend ChatGPT) | `core/src/client.rs:2630` |
| `x-codex-beta-features` | lista de features beta ativas | quando há | `client.rs:2615` |
| `originator` | só se difere do padrão `codex_cli_rs` | condicional | `login/src/auth/default_client.rs:125` |
| `User-Agent` | `codex_cli_rs/<versão> (<SO> <versão>; <arq>) <terminal>` | sempre | `default_client.rs:152` |
| `prompt_cache_key` (corpo) | session id (`SessionDerived`), chave custom, ou omitido | corpo | `client.rs:707` |
| `client_metadata` (corpo) | mapa com `session_id`, metadados do turno | quando habilitado | `codex-api/src/common.rs:281-306` |

- Histórico: até ~0.130 os cabeçalhos eram `session_id` e `thread_id` (sublinhado); a partir de ~0.150 são `session-id` e `thread-id` (hífen), conferido em `headers.rs` nas tags 0.100, 0.130, 0.150 e 0.159.2. Versões antigas ainda em uso mandam o formato antigo; proxies que descartam cabeçalhos com sublinhado (nginx padrão) perdem o id.
- Em subagente (`is_non_root_agent`) o `session-id` é o id real da sessão; em thread raiz é o valor derivado do cache. O `thread-id` distingue conversas dentro da mesma sessão.
- Residência de dados gerenciada acrescenta `x-openai-internal-codex-residency: us` (config empresarial); irrelevante ao gateway.
- Cabeçalhos próprios do usuário: `http_headers` e `env_http_headers` no provedor. Permitem enviar `x-session-key` fixo, mas isso perde a separação por conversa.

### Outros endpoints

- Provedor customizado com `wire_api = "responses"` só chama `POST {base_url}/responses`. Compactação remota (item `compaction_trigger`) fica **desligada** por padrão (`RemoteCompactionSupport::Unsupported`, `model-provider/src/capabilities.rs:28`), então a compactação é local e usa o mesmo `/responses`. Busca web standalone (`alpha/search`) e memórias (`memories/trace_summarize`) são de provedor OpenAI/ChatGPT.
- `GET {base_url}/models`: ver "Seleção de modelo"; normalmente não é chamado.
- Telemetria/analytics do Codex vai para a OpenAI, não para o gateway.

### Recursos usados

- Corpo Responses (`codex-api/src/common.rs:281`): `model`, `stream: true`, `input`, `tools`, `tool_choice` (string), `parallel_tool_calls`, `reasoning`, `store: false`, `include: ["reasoning.encrypted_content"]`, `prompt_cache_key`, `text` (verbosity/formato), `service_tier`, `client_metadata`, `stream_options` (só OpenAI). Não usa `previous_response_id` por HTTP.
- Tipos de ferramenta enviados: `function`, `namespace` (ferramentas MCP agrupadas), `tool_search`, `web_search`, `custom` (freeform, usado pelo `apply_patch` quando o modelo declara `apply_patch_tool_type`; `tools/src/tool_spec.rs`, `core/src/tools/spec_plan.rs:1426`). Itens de entrada incluem `custom_tool_call`/`custom_tool_call_output`, `function_call`/`function_call_output`, `reasoning` (com `encrypted_content`) e imagens `input_image`.
- Com metadados de fallback (qualquer slug fora do catálogo, incluindo `auto`): sem `apply_patch` freeform (edição via shell), `reasoning` sem níveis, sem verbosity.
- Streaming SSE de eventos Responses (`response.output_text.delta`, `response.output_item.done`, `response.completed`, `response.incomplete`, `response.failed`). Conexão que fecha sem `response.completed` é erro ("stream closed before response.completed") e dispara reconexão (até `stream_max_retries`).
- Subagentes e revisões geram requisições concorrentes com `x-openai-subagent`.

### Erros e retentativas

- HTTP: `request_max_retries` (padrão 4), atraso base 200 ms com backoff exponencial e jitter de 10%; retenta **5xx** e erros de transporte; **não retenta 429** (`retry_429: false`, `model-provider-info/src/lib.rs:494-500`).
- Erros dentro do SSE (`response.failed`/`error`): `context_length_exceeded` vira erro de janela de contexto; `rate_limit_exceeded` e `slow_down` viram erro de limite (tempo sugerido lido da mensagem); `server_is_overloaded` (também em HTTP 503) vira "servidor sobrecarregado"; `invalid_prompt` vira erro de prompt inválido; `usage_limit_reached` é tratado como limite de plano (`codex-api/src/api_bridge.rs:125,200`, `sse/responses.rs`).
- Para o Thinker: erros do roteamento devem sair no formato OpenAI (`{"error":{"code":..,"message":..}}`) com status HTTP, ou como `response.failed` no stream, para o Codex classificar; 429 chega ao usuário sem retentativa do cliente (G6).

### Snippet de setup do Thinker

Correto para 0.166.0: `model_provider = "thinker"`, `[model_providers.thinker]` com `name`, `base_url`, `env_key = "THINKER_API_KEY"`, `wire_api = "responses"`, mais `export THINKER_API_KEY=...`. Falta, como melhoria, `model_context_window` e `model_auto_compact_token_limit` (G3), e um aviso de que o Codex mostrará "Model metadata not found" para `auto` (esperado). Confirmar ao vivo que um `codex exec` real contra o Thinker funciona com `model = "auto"`.

## Como o Thinker implementa hoje

- Superfície: Responses (`packages/shared/src/agent-type.ts:87`); plataforma `codex` em `AGENT_PLATFORMS` (`agent-type.ts:37`), nome `Codex` (`:113`), categoria `coding` (`:132`).
- Rotas de entrada: `GET /v1/models` (`proxy.controller.ts:176`) devolve `{object:'list', data:[...]}` no formato OpenAI com `auto`, virtuais e catálogo; `POST /v1/responses` (`proxy.controller.ts:254`) via `handleProxyRequest(..., 'responses')`.
- **Sessão do chamador:** só `x-session-key` é lido (`proxy.controller.ts:277` e `:899`; `proxy-session-scope.ts:19-40`). Sem ele a sessão é `default`, sem `providerCacheKey` nem `momentumKey`. Nenhum código lê `session-id`, `thread-id`, `x-client-request-id`, `x-openai-subagent`, `x-codex-parent-thread-id` ou o `prompt_cache_key` do corpo para identificar a sessão de entrada (grep em `packages/backend/src`). Na `main` não existe `harness-session.ts`.
- `prompt_cache_key` do corpo só é aproveitado na saída para o backend ChatGPT: `codex-session-affinity.ts:97-109` deriva `session-id` e `thread-id` com formato UUID a partir dele (Thinker como cliente do Codex, não o harness).
- **Adaptador Responses para Chat:** `responses-tools.ts:62-84` (`chatTools`) mantém só `function` e `namespace` (linha 70 descarta o resto); `responses-adapter.ts:102` descarta itens sem equivalente (`reasoning`, `custom_tool_call`, `custom_tool_call_output`, `web_search_call`). Provedores Responses nativos recebem o corpo quase intacto (`responses-adapter.ts`, força `store = false`).
- Classificação do chamador por `User-Agent`/Stainless em `caller-classifier.ts:35-66`; não reconhece `codex_cli_rs/...` nem `originator`.
- Erros: `proxy-error-sanitizer.ts:57,205-213` reconhece `context_length_exceeded`; o formato final de erro para o chamador Responses não foi conferido contra o parser do Codex (não confirmado).
- Cliente Codex emulado na saída (Thinker como cliente do ChatGPT Codex, escopo `sub-openai`): `subscription-clients.ts:21-22` fixa `CODEX_CLI_VERSION = '0.159.2'` e `codex_cli_rs`; a última estável é 0.166.0 (issue #348 do agente `sub-openai`).
- Setup: `packages/shared/src/setup-snippets.ts:73-96` gera o bloco `config.toml` e o `export`; `packages/frontend/src/components/CodexSetup.tsx` mostra os dois; `docs/usuario/conectar-harnesses.md:36-55` documenta o mesmo e `:142` diz que o modelo vem de `model` em `~/.codex/config.toml`. `packages/cli/src/agent-runtime.ts:28-30` detecta o Codex por `CODEX_SANDBOX`/`CODEX_HOME`.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/responses-adapter.ts`
- `packages/backend/src/routing/proxy/responses-tools.ts`
- `packages/backend/src/routing/proxy/codex-session-affinity.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/CodexSetup.tsx`

Arquivos que citam `codex`:

- `packages/cli/src/agent-runtime.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`
- `packages/frontend/src/pages/integrations/McpServer.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O Codex envia `session-id`, `thread-id`, `x-client-request-id` (e `prompt_cache_key` no corpo = session id; subagentes: `x-openai-subagent`, `x-codex-parent-thread-id`), mas o Thinker só lê `x-session-key` (`proxy.controller.ts:277,899`). Toda sessão do Codex vira `default`: sem afinidade de cache por provedor, sem momentum de roteamento, logs misturados. Mesma causa de #318 e #320; sugestão: um leitor único de sessão do chamador que aceite `session-id` / `prompt_cache_key` (e o formato antigo `session_id`). Comentado nas duas issues, sem issue nova. | backend-dev | [#320](https://github.com/patrickbrandao/thinker/issues/320), [#318](https://github.com/patrickbrandao/thinker/issues/318) (comentários) | resolvida (sessão de prompt cache e momentum lida dos cabeçalhos do harness) |
| G2 | degradação | Com slug do catálogo embutido o Codex anuncia `apply_patch` como ferramenta `custom` (freeform) e `web_search`; o adaptador Responses para Chat descarta essas ferramentas e os itens `custom_tool_call`/`custom_tool_call_output` (`responses-tools.ts:70`, `responses-adapter.ts:102`). Para provedores só-Chat o modelo perde `apply_patch` freeform sem aviso. Sugestão: converter `custom` em função com um parâmetro de texto e traduzir de volta a chamada. | backend-dev | [#376](https://github.com/patrickbrandao/thinker/issues/376) | resolvida (adaptador de tradução corrigido, com teste) |
| G3 | degradação | O Codex não lê `/v1/models`; `auto` e virtuais usam metadados de fallback (janela 272K, aviso "Model metadata not found"). O snippet não define `model_context_window` nem `model_auto_compact_token_limit`, então com rota para modelo de contexto menor a compactação dispara tarde e o provedor devolve `context_length_exceeded`. Sugestão: incluir os dois campos no snippet (valor = menor janela de `auto`, que o Thinker já calcula) ou servir um catálogo nativo via `model_catalog_url`. | frontend-dev | [#377](https://github.com/patrickbrandao/thinker/issues/377) | aberta |
| G4 | oportunidade | Servir um catálogo no formato nativo do Codex (`{"models":[ModelInfo]}`) em um caminho do Thinker e apontar `model_catalog_url` para ele: elimina o aviso de fallback, dá janela e níveis de raciocínio corretos por modelo virtual e habilita `apply_patch` freeform. Exige confirmar ao vivo que `model_catalog_url` funciona com provedor customizado e chave de API. | backend-dev | — | aberta |
| G5 | oportunidade | `caller-classifier.ts` não reconhece `User-Agent: codex_cli_rs/<versão> (...)` nem `originator`; o chamador Codex aparece sem versão. Também há `x-codex-window-id` e `x-openai-subagent` aproveitáveis para atribuição de subagentes. | backend-dev | — | aberta |
| G6 | oportunidade | O Codex não retenta 429 (`retry_429: false`) e retenta 5xx 4 vezes; ao esgotar as rotas o Thinker deve responder 429 com `retry-after` correto e preferir 503 `server_is_overloaded` para falhas transitórias que valham retentativa automática do cliente. Documentar no guia. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra o fonte da tag `rust-v0.166.0` (provedores, cabeçalhos e sessão, modelos, retentativas, ferramentas) e a página de config-avançada do site. Identificação do harness confirmada (`openai/codex`). Cabeçalhos de sessão passaram de `session_id` para `session-id` entre 0.130 e 0.150. G1 comentada em #320/#318; G2 (#376) e G3 (#377) abertas; G4-G6 como oportunidade, sem issue.
