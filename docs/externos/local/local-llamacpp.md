---
id: local-llamacpp
categoria: local
entidade: llama.cpp (llama-server)
agente: local-llamacpp
thinker_ids: [llamacpp]
revisado_em: 2026-11-04
versao_observada: llama.cpp b12098 (commit 149f564, 2026-11-03; release 2026-11-04)
---

# llama.cpp (llama-server) (runtime local)

Especificação mantida pelo agente `local-llamacpp` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- `llama-server` serve API compatível com OpenAI (`/v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/embeddings`), API compatível com Anthropic (`/v1/messages`, `/v1/messages/count_tokens`) e REST nativa (`/completion`, `/props`, `/slots`, `/health`, `/metrics`).
- Mudança relevante: a porta padrão passou de 8080 para **9931** (PR #30159, mergeado em 2026-10-09). As imagens Docker oficiais continuam em 8080 dentro do container. Bind padrão segue `127.0.0.1`.
- O modo router (sem `-m`) carrega e descarrega modelos sob demanda e lista todos os modelos conhecidos em `/v1/models` com `status.value`, `context_length` e `architecture`; o modo de modelo único lista um só item, com `meta.n_ctx_train`.
- `--jinja` e o parsing de raciocínio (`reasoning_content`) vêm ligados por padrão; `--api-key` aceita `Authorization: Bearer` ou `X-Api-Key`, e `/health` é público.
- Cadência altíssima: cerca de 20 builds por dia (b11500 em 2026-10-08, b12098 em 2026-11-04). Não há versionamento semântico; o identificador é o número do build (`bNNNN`).
- Lacunas abertas: G1 (#451, router perde contexto) e G2 (#452, porta legada 8080). Pesquisa feita lendo o código e o README da tag `b12098`; nada foi executado.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| llama.cpp repository and releases | <https://github.com/ggml-org/llama.cpp> | tag `b12098` (publicada 2026-11-04T03:49Z), commit `149f564` (2026-11-03) |
| llama-server README | <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md> | lido na tag `b12098` (2620 linhas) |
| Código do servidor (`tools/server/server-http.cpp`, `server-models.cpp`, `server-models.h`, `server.cpp`) | mesmo repositório, tag `b12098` | `b12098` |
| Docker (`docs/docker.md`, `.devops/*.Dockerfile`) | mesmo repositório | `b12098` |
| PR da porta padrão | <https://github.com/ggml-org/llama.cpp/pull/30159> | mergeado 2026-10-09 |

## Contrato

### Versões

- Versão = número do build (`bNNNN`), uma release no GitHub por build. Observado: `b11000` em 2026-09-16, `b11500` em 2026-10-08, `b11600` em 2026-10-13, `b11700` em 2026-10-16, `b12098` em 2026-11-04. Cadência de cerca de 20 a 25 builds por dia.
- `GET /props` devolve `build_info` no formato `b<build>-<hash>` (README, `b12098`).
- Mudança com efeito no Thinker: porta padrão 9931 (PR #30159, 2026-10-09; entra em torno de b11510 a b11600, número exato `(não confirmado)`). O corpo do PR diz que o Docker mantém 8080 para não quebrar ferramentas que usam a imagem base; confirmado nos Dockerfiles (`ENV LLAMA_ARG_PORT=8080` em `cpu`, `cuda`, `intel`, `musa`, `cann`).
- Quebras desde o corte: não havia corte anterior (primeira revisão).

### APIs

Base: `http://<host>:9931` (nativo) ou `:8080` (Docker). Prefixo opcional `--api-prefix`.

| Superfície | Caminhos | Observações |
|---|---|---|
| Saúde | `GET /health` (também `/v1/health`) | Público (sem checagem de chave). 503 `Loading model` enquanto carrega; 200 `{"status":"ok"}` quando pronto. |
| OpenAI-compat | `GET /v1/models`, `POST /v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/responses`, `/v1/responses/input_tokens`, `/v1/chat/completions/input_tokens`, `WS /v1/realtime` | README `b12098`. O README diz que não há garantia de compatibilidade total com a especificação da OpenAI. |
| Anthropic-compat | `POST /v1/messages`, `POST /v1/messages/count_tokens` | Tool use exige `--jinja` (padrão ligado). `count_tokens` devolve `{"input_tokens": N}`. |
| Nativa | `/completion`, `/tokenize`, `/detokenize`, `/apply-template`, `/embedding`, `/reranking`, `/infill`, `/tts`, `/props`, `/slots`, `/metrics`, `/lora-adapters` | `/props` é só leitura sem `--props`. `/slots` e `/metrics` exigem flags (`--slots`, `--metrics`) `(não confirmado: padrão atual)`. |
| Router | `GET /models`, `POST /models`, `POST /models/load`, `POST /models/unload`, `GET /models/sse`, `DELETE /models` | Só no modo router. `GET /models` e `GET /v1/models` são o mesmo handler (`server.cpp:176-177`, `:527`). |
| Extras | `POST /v1/chat/completions/control` (`action: reasoning_end`, exige `reasoning_control: true` na requisição original), `POST /v1/systemone` (modelos de decisão) | Novidades recentes, ver "Novidades aproveitáveis". |
| `/tools` | API interna da Web UI, "não use em aplicações downstream" (README). | Só com `--tools`/`--agent`. |

Parâmetros de `/v1/chat/completions` relevantes: `response_format` (`json_object` e `json_schema`, com `schema`), `chat_template_kwargs` (ex.: `{"enable_thinking": false}`), `reasoning_effort` (`none` desliga o raciocínio; demais valores vão ao template Jinja), `reasoning_format` (`none` deixa o texto bruto), `reasoning_control`, `parallel_tool_calls` (depende do template), conteúdo multimodal (`image_url`, `input_audio`, `input_video`). Imagens remotas ou caminhos locais são aceitos; arquivo local exige `--media-path` e prefixo `file://`.

Erros: formato OpenAI `{"error":{"code":401,"message":"Invalid API Key","type":"authentication_error"}}`.

### Modelos e carregamento

- Modo de modelo único (`-m`/`-hf`): `GET /v1/models` devolve sempre 1 item. `id` é o caminho do arquivo passado em `-m`, ou o valor de `--alias` (lista separada por vírgula). Campos: `owned_by: "llamacpp"`, `architecture.input_modalities`/`output_modalities` (`text` sempre; `image`, `audio` conforme o modelo; saída `decisions` ou `audio` para modelos especiais), `meta` (`vocab_type`, `n_vocab`, `n_ctx_train`, `n_embd`, `n_params`, `size`), que pode ser `null` durante o carregamento. Durante sleep, a resposta vem de cache (`server-context.cpp:6367`).
- Contexto efetivo: `GET /props` traz `default_generation_settings.n_ctx` (contexto de execução, definido por `-c/--ctx-size`, 0 = do modelo), `total_slots`, `model_path`, `chat_template`, `chat_template_caps` (inclui `reasoning_effort_levels`), `modalities`, `build_info`, `is_sleeping`. Em modo router, `/props?model=<id>` (URL-encoded).
- Modo router (iniciar `llama-server` sem modelo): `GET /v1/models` lista todos os modelos conhecidos (cache em `LLAMA_CACHE`, `--models-dir`, `--models-preset`). Por entrada (`server-models.cpp:2133+`): `id`, `aliases`, `tags`, `object`, `owned_by`, `created`, `status{value,args,preset,exit_code,failed}`, `architecture`, `source`, `can_remove`, `context_length` (contexto treinado, quando conhecido), `memory` (com `--models-memory-margin`). Valores de `status.value`: `downloading`, `incomplete`, `downloaded`, `unloaded`, `loading`, `loaded`, `sleeping` (`server-models.h:52-63`).
- Roteamento: POST pelo campo `model` do corpo; GET por query `?model=`. Autoload ligado por padrão (`--no-models-autoload` desliga; `?autoload=true|false` por requisição). `--models-max` (padrão 4, 0 = ilimitado) limita modelos simultâneos com descarte LRU; `--models-memory-margin N` descarta modelos ociosos até caber.
- Sleep ocioso: `--sleep-idle-seconds` (padrão -1, desligado) descarrega modelo e KV; a próxima tarefa recarrega. `GET /health`, `/props`, `/models` e `/metrics` não contam como tarefa e não acordam o servidor.
- Parâmetros de carga (flags ou variáveis `LLAMA_ARG_*`): `-c/--ctx-size` (`LLAMA_ARG_CTX_SIZE`), `-np/--parallel` (padrão auto), `-kvu/--kv-unified`, `--cache-ram` (padrão 8192 MiB), `--ctx-checkpoints`, `--context-shift` (padrão desligado), `-a/--alias`, `--mmproj`. O cliente da API não consegue mudar contexto por requisição; só por preset do router ou flags. `POST /models/load` aceita carregar um modelo no router `(corpo exato não confirmado)`.

### Capacidades por família de modelo

- Template de chat: `--jinja` padrão ligado (`LLAMA_ARG_JINJA`); o template vem dos metadados do modelo, ou `--chat-template`/`--chat-template-file`. Sem template compatível, cai em ChatML. Lista de templates embutidos extensa (llama3, llama4, mistral-v*, gemma, gpt-oss, deepseek*, kimi-k2, glm, granite etc.).
- Tool calling: função OpenAI estilo com `--jinja`; pode exigir `--chat-template-file` com template compatível com tools (pior caso `--chat-template chatml`). `parallel_tool_calls` depende do template. `--skip-chat-parsing` força saída crua em `content` (inclusive tool calls).
- Raciocínio: `--reasoning-format` (padrão `auto`): `none` deixa o pensamento em `message.content`; `deepseek` coloca em `message.reasoning_content`; `deepseek-legacy` mantém tags `<think>` e também preenche `reasoning_content`. `-rea/--reasoning on|off|auto` (padrão auto, detecta pelo template), `--reasoning-effort`, `--reasoning-budget N`, `--reasoning-preserve` (mantém o pensamento no histórico, só em templates com a capacidade). Por requisição: `reasoning_effort`, `reasoning_format`, `chat_template_kwargs`.
- Visão e áudio: precisam de `--mmproj` (ou `-hf`, que o baixa sozinho). `/props` expõe `modalities.vision`; `/v1/models` expõe `architecture.input_modalities`.
- Embeddings e reranking: `--pooling`, `--embd-normalize`; `/v1/embeddings` e `/reranking`. Modelos de embedding não são de chat.
- Saída estruturada: `response_format` com `json_schema` (gramática GBNF por baixo).

### Rede e Docker

- Bind padrão `127.0.0.1` (`--host`, `LLAMA_ARG_HOST`; aceita lista e sockets `.sock`). Porta `--port` (`LLAMA_ARG_PORT`), padrão 9931. Um container Docker não alcança `127.0.0.1` do host: é preciso `--host 0.0.0.0`.
- Imagens oficiais: `ghcr.io/ggml-org/llama.cpp:server` (e variantes `server-cuda`, `server-cuda13`, `server-rocm`, `server-vulkan`, `server-intel`, `server-musa`, `server-openvino`); `ENV LLAMA_ARG_PORT=8080` e `HEALTHCHECK` em `/health` na porta 8080 nos Dockerfiles. Exemplo oficial usa `--host 0.0.0.0 --port 8080`.
- Autenticação: `--api-key KEY` (lista separada por vírgula, `LLAMA_API_KEY`) ou `--api-key-file`. O middleware aceita `Authorization: Bearer <chave>` e, se ausente, `X-Api-Key` (`server-http.cpp:273-286`). `/health` é público; as demais rotas exigem a chave quando configurada.
- CORS: padrão reflete qualquer `Origin` com credenciais permitidas (`--cors-origins` padrão `*`). Com `--tools` ou `--agent`, o padrão passa a `localhost`. Chamadas servidor a servidor do Thinker não dependem de CORS.
- Proxy reverso e `--api-prefix`: o servidor pode ser montado sob um prefixo (`LLAMA_ARG_API_PREFIX`). `HTTP_PROXY`/`HTTPS_PROXY` valem só para downloads de modelos.
- Segurança: `--tools`, `--agent` e `--ui-mcp-proxy` expõem leitura/escrita de arquivos e execução de shell pela API; o README avisa para não ligar em ambiente não confiável.

### Novidades aproveitáveis

- `POST /v1/messages` e `/v1/messages/count_tokens` nativos: clientes Anthropic (Claude Code) poderiam falar direto com o llama-server sem tradução (ver G3).
- `POST /v1/responses` nativo para clientes Codex (G3).
- `GET /props` com `chat_template_caps` e `modalities`: base para detectar tools, raciocínio e visão em vez de valores fixos (G4).
- `reasoning_effort` por requisição e `chat_template_kwargs` (ex.: `enable_thinking`) para controlar o raciocínio (G4).
- Router: `status.value` e `POST /models/load`/`unload` para mostrar e controlar o que está carregado; `--sleep-idle-seconds` para liberar memória (G5).
- `/v1/chat/completions/input_tokens` e `/v1/messages/count_tokens` para contagem de tokens local.

## Como o Thinker implementa hoje

- Tipos de servidor local configuráveis: `LOCAL_SERVER_TYPES = ['ollama','lmstudio','llamacpp']`, cada um vira uma linha de custom provider com `local_type` (`packages/backend/src/common/constants/local-servers.ts:130`). Defaults do `llamacpp` nesse caminho: porta 9931, saúde `/health`, listagem `/v1/models` (`local-servers.ts:198-205`), comentário citando o PR #30159 (`:173-177`). Timeouts padrão 10 min de requisição e 10 s de sonda (`:210-211`).
- Provedor canônico legado (`llamacpp`, tile): base URL `http://<alias do host>:8080`, sobrescrita por `THINKER_LLAMACPP_BASE_URL`; override inválido é ignorado com aviso; `/v1` final é removido (`local-servers.ts:10-12`, `:19`, `getLocalServerBaseUrl`). Porta 8080 diverge do caminho configurável (ver G2).
- Chat: `llamacpp: localServerEndpoint('llamacpp')`, formato `openai`, caminho `/v1/chat/completions`, `Authorization: Bearer` só quando há chave (`packages/backend/src/routing/proxy/provider-endpoints.ts:99-111`, `:600`; `buildLocalServerHeaders` em `local-servers.ts:117`). Não envia `X-Api-Key`.
- Id do modelo enviado como está, sem remover prefixo de fornecedor (`packages/backend/src/routing/proxy/provider-client.ts:355-358`), o que preserva caminhos de arquivo e ids de router como `org/repo:Q4_K_M`.
- Descoberta de modelos (tile): `GET <base>/v1/models` com `parseOpenAI`, sem filtro por status (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:1047-1051`); `parseOpenAI` lê `input_modalities` no topo da entrada (`:200-207`), enquanto o llama.cpp usa `architecture.input_modalities` (G1). `llamacpp` consta nos provedores com streaming/capacidades em `model-capabilities.ts:23`.
- Sonda de conexão (`packages/backend/src/routing/custom-provider/local-server-probe.ts:284-325`): `GET /health` opcional, `GET /v1/models` obrigatório (valida a chave), `GET /props` só quando há exatamente 1 modelo; contexto = `default_generation_settings.n_ctx` ou `meta.n_ctx_train`; visão por `modalities.vision` ou `architecture.input_modalities`; `tools` e `reasoning` fixos em `false` (`:318`); `loaded` por `status.value === 'loaded'` ou presumido true para modelo único; versão = `build_info`. Filtra embeddings por regex de nome. Dica de início: `llama-server -m <model.gguf> --port <porta>` (`:45`).
- Dica de setup no frontend: `LOCAL_SERVER_HINTS.llamacpp`: porta 8080, `llama-server -m <your-model>.gguf --port 8080`, nota de Docker com `--host 0.0.0.0` e a dica "builds recentes expõem /v1/models; se der 404, atualize" (`packages/shared/src/providers.ts:603-617`; a ressalva de pré-b3800 é antiga e provavelmente obsoleta, `(não confirmado)`).
- Registro do provedor: `id: 'llamacpp'`, aliases `llama.cpp`, `llama-cpp`, `localOnly`, `tileOnly`, sem chave obrigatória (`packages/shared/src/providers.ts:357-368`).
- Egress/proxy: `LOCAL_PROVIDERS` inclui `llamacpp` (`packages/backend/src/proxy-servers/proxy-egress.service.ts:32`); validação do override no boot em `packages/backend/src/main.ts:281`.

Pontos no código:

- `packages/backend/src/common/constants/local-servers.ts`
- `packages/shared/src/providers.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/custom-provider/local-server-probe.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`

Arquivos que citam `llamacpp`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/proxy-servers/proxy-egress.service.ts`
- `packages/backend/src/routing/custom-provider/custom-provider.service.ts`
- `packages/backend/src/routing/dto/custom-provider.dto.ts`
- `packages/backend/src/main.ts`
- `packages/frontend/src/components/LocalServerForm.tsx`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/api/routing.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Modo router: `/v1/models` traz o contexto em `context_length` (não em `meta.n_ctx_train`), `status.value` (inclui `downloading`/`incomplete`) e `aliases`; modalidades ficam em `architecture.input_modalities`. A sonda (`local-server-probe.ts:284-325`) perde o contexto e não filtra status; a descoberta (`provider-model-fetcher.service.ts:200-207`) não lê `architecture`. Sugestão: fallback para `context_length`, descartar status não utilizáveis, aceitar `architecture`. | `providers` | [#451](https://github.com/patrickbrandao/thinker/issues/451) | aberta |
| G2 | degradação | Porta padrão do llama-server é 9931 desde o PR #30159 (Docker segue em 8080). O formulário já usa 9931, mas `LOCAL_SERVER_DEFAULT_PORTS.llamacpp = 8080` (`local-servers.ts:11`) e `LOCAL_SERVER_HINTS.llamacpp.defaultPort = 8080` (`providers.ts:604`) ficaram para trás. Sugestão: alinhar. | `backend-dev` | [#452](https://github.com/patrickbrandao/thinker/issues/452) | aberta |
| G3 | oportunidade | `llama-server` fala `POST /v1/messages` (Anthropic) e `/v1/responses` nativamente; o Thinker só usa Chat Completions para o `llamacpp` (`provider-endpoints.ts:99-111`) e traduz. Poderia passar direto para clientes Claude Code/Codex. Sem issue (ganho incerto: tradução atual funciona). | `providers` | — | aberta |
| G4 | oportunidade | Capacidades fixas: a sonda marca `tools: false` e `reasoning: false` (`local-server-probe.ts:318-323`). `GET /props` traz `chat_template_caps` (inclui `reasoning_effort_levels`) e o servidor aceita `reasoning_effort`/`chat_template_kwargs` por requisição. Sugestão: derivar tools/reasoning de `chat_template_caps` e expor controle de esforço. Sem issue (formato exato de `chat_template_caps` não confirmado). | `providers` | — | aberta |
| G5 | oportunidade | No modo router, `status.value`, `POST /models/load`/`unload` e `--sleep-idle-seconds` permitiriam mostrar e controlar o que está carregado na UI e a latência da primeira chamada (autoload). Hoje `loaded` é só lido. Sem issue. | `frontend-dev` | — | aberta |
| G6 | oportunidade | Autenticação: o servidor aceita `Authorization: Bearer` e `X-Api-Key`; o Thinker manda só Bearer (suficiente). Registrar para a hipótese de proxy que remova `Authorization`. Sem issue, sem ação necessária. | `backend-dev` | — | descartada (Bearer cobre o caso) |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (tag `b12098`, README e código de `tools/server`, Dockerfiles, PR #30159). Contrato preenchido. Abertas G1 (#451) e G2 (#452) como degradação; G3 a G5 como oportunidades sem issue; G6 descartada. Pendente de checagem ao vivo pelo mantenedor: formato real de `/v1/models` em modo router e de `chat_template_caps` num build recente, e o corpo de `POST /models/load` (não executados).
