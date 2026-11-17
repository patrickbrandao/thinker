---
id: harness-deepseek-harness
categoria: harness
entidade: DeepSeek Harness
agente: harness-deepseek-harness
thinker_ids: [deepseek-harness]
revisado_em: 2026-11-17
versao_observada: dsh v0.2.2-rc.3 (commit 38a6a5c9, 2026-11-13; npm latest 0.2.2-rc.1, next 0.2.2-rc.4 sem tag)
---

# DeepSeek Harness (harness)

Especificação mantida pelo agente `harness-deepseek-harness` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- **Identificação (confiança alta).** "DeepSeek Harness" é o projeto `deepseek-ai/deepseek-harness` (CLI `dsh`, pacote npm `@deepseek-ai/dsh`, MIT, TypeScript, criado em 2026-08-13, "developer preview" com quebras de compatibilidade esperadas; todo release é `alpha`/`rc`). Não confundir com `DeepSeek-TUI` (Hmbown), que é outro projeto, nem com a API da DeepSeek (dossiê `api-deepseek`).
- Tem **duas rotas de LLM** que valem para um gateway: (1) a rota nativa `deepseek-official`, em **Anthropic Messages**, com `baseURL` configurável; (2) a rota `llm-pi-ai`, com `api: openai-completions` (Chat Completions), `openai-responses`, `anthropic-messages` e, desde o rc.2, `google-generative-ai` (o Thinker não serve Gemini nativo na entrada), com `baseURL` e `models` escritos à mão (é o que a UI "Custom model API" gera).
- Na rota nativa, além de `x-api-key`, manda cabeçalhos próprios (`x-deepseek-harness-session-id`, `x-deepseek-harness-user-id`, `x-deepseek-harness-compact`) e **campos extras no corpo** (`dsh_session_log` até 8 MiB, `dsh_plugin_packages`). Nada disso mudou entre `alpha.3` e `rc.3`. O Thinker agora lê o cabeçalho de sessão (G3 resolvida) e descarta os campos `dsh_*` na entrada (G2 resolvida); não lê `user-id` nem `compact` (G8).
- **O que o rc.1 a rc.3 mudaram no fio** (comparado a `alpha.3`): só o `user-agent`, que ganhou o sufixo ` dsh-profile/<perfil>` (`desktop`, `web`, `sdk`) a partir do rc.2; nada de cabeçalho, campo de corpo, flag beta, tipo de bloco, `/v1/files`, listagem de modelos ou política de retry (blobs idênticos nos pacotes `llm-deepseek`, `llm-retry`, `deepseek-llm-api-extensions`; o documento de extensões difere só nessa linha). Mudanças só do lado do cliente: omissão de `thinking` assinado velho na rota pi-ai com `anthropic-messages` (rc.2), classificação de erro do pi-ai pelo status inicial da mensagem (rc.2), opção `google-generative-ai` (rc.2), gancho `llm-pi-ai/request-headers` para plugins (rc.2), sufixo do UA por `DSH_USER_AGENT_SUFFIX`.
- O dsh é **estrito com a resposta** na rota nativa: só aceita blocos `text`/`thinking`/`tool_use`, `stop_reason` `end_turn`/`stop_sequence`/`tool_use`/`max_tokens`, e `usage` sem `null`; o resto vira `MALFORMED_RESPONSE`/`UNSUPPORTED_CONTENT` sem retry (G7).
- Os snippets e o guia do Thinker existem para as duas rotas, mas declaram os modelos só como texto, então o dsh nunca manda imagem (G9). O Thinker não tem `/v1/files`; o dsh cai para base64 inline (G6).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Repositório oficial | <https://github.com/deepseek-ai/deepseek-harness> | tag `dsh-v0.2.2-rc.3` (2026-11-13, commit 38a6a5c9); `alpha.3` (commit 05b1cae8) usada só para comparação |
| Releases | <https://github.com/deepseek-ai/deepseek-harness/releases> | `v0.2.2-rc.3` (2026-11-13), `rc.2` (2026-11-11), `rc.1` (2026-11-04), `alpha.3` (2026-11-03) |
| npm `@deepseek-ai/dsh` | <https://www.npmjs.com/package/@deepseek-ai/dsh> | dist-tags em 2026-11-17: `latest` 0.2.2-rc.1, `next` 0.2.2-rc.4 (publicado 2026-11-17, ainda sem tag nem release no GitHub, fonte não lido), `alpha` 0.2.2-alpha.3 |
| Extensões de fio DeepSeek | `docs/deepseek-llm-api-wire-extensions.md` do repositório | `dsh-v0.2.2-rc.3` |
| Adaptador Messages | `packages/llm/llm-deepseek/` (`README.md`, `src/adapter.ts`, `serialize.ts`, `translate.ts`, `sse.ts`, `transport.ts`, `files-api.ts`, `request-files.ts`, `messages-api.ts`) | idem |
| Plugin de chave | `packages/llm/llm-deepseek-api-key/README.md` | idem |
| Adaptador pi-ai (gateways) | `packages/llm/llm-pi-ai/` (`README.md`, `src/catalog.ts`, `stream.ts`, `prefix-binding.ts`) | idem |
| Política de retry | `packages/llm/llm-retry/README.md` | idem (sem mudança desde `alpha.3`) |
| User-Agent | `packages/llm/llm/src/attribution.ts` | idem |
| Guia de modelos | `docs/user/guide/providers.md` | idem |
| Documentação publicada | <https://deepseek-harness.github.io/deepseek-harness/> | não lida (o fonte do repositório foi usado) |

Leitura feita no fonte do repositório (clone raso em scratchpad, nada executado) e, para a comparação com `alpha.3`, por `gh api` nos mesmos caminhos. A biblioteca `@earendil-works/pi-ai` (versão `^1.3.0`, com patch do dsh) não está no repositório; o corpo exato que ela monta na rota pi-ai não foi lido (ver `harness-pi`).

## Contrato

### Configuração do gateway

- Instalação: `npx @deepseek-ai/dsh web` (Web UI em `http://127.0.0.1:3080`). Perfil padrão da Web UI: `web`; configuração em `$DSH_HOME/profiles/<perfil>/cordis.patch.yml` (lida de novo a cada requisição, sem reiniciar). (README e `docs/user/guide/providers.md`)
- **Rota nativa** (plugin `@deepseek-ai/dsh-llm-deepseek-api-key`, provedor `deepseek-official`, só Messages, sem campo `protocol`): `baseURL` explícito, senão `$DEEPSEEK_BASE_URL` (aceita do ambiente de lançamento ou de `$DSH_HOME/.env`, nunca de `.env` do projeto), senão `https://api.deepseek.com/anthropic`. O cliente anexa `/v1/messages` e `/v1/files`, reaproveitando um `/v1` final; barras finais não importam; a URL não pode ter credenciais, query ou fragmento. A chave vem de `apiKeyEnv` (padrão `DEEPSEEK_API_KEY`) e sai como `x-api-key`. Redirecionamentos são recusados (`redirect: 'error'`). Na Web UI o cartão DeepSeek só expõe o campo da chave; `baseURL` exige editar o YAML ou a variável de ambiente. (`llm-deepseek/README.md`, `src/messages-api.ts`, `adapter.ts:143`)
- **Rota pi-ai** (plugin `@deepseek-ai/dsh-llm-pi-ai`): `providers.<id>` com `api` (`openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`), `baseURL`, `apiKeyEnv`, `models`, `headers` fixos, `compat`. Para Chat Completions o `baseURL` inclui `/v1`; a chave sai como `Authorization: Bearer`. A UI "Add model provider > Custom model API" grava exatamente isso. Um provedor fala um só protocolo. (`llm-pi-ai/README.md`, `providers.md`)
- Proxy de saída: variáveis padrão `HTTP(S)_PROXY` (`docs/user/guide/network-proxy.md`); irrelevante para o Thinker.

### Seleção de modelo

- Rota nativa: ids passam direto para o fio. Sem `models`, o catálogo padrão anuncia `deepseek-flash` (texto e imagem, declara `systemPromptUpdate: in-history` e `toolUpdate: addition-only`) e `deepseek-v4-pro` (só texto), contexto 1.048.576. Só com o endpoint oficial `https://api.deepseek.com`, a chave presente e `models` igual ao padrão o dsh consulta `GET https://api.deepseek.com/models`; **com `baseURL` ou `$DEEPSEEK_BASE_URL` customizado, ou com `models` diferente do padrão, ele não pede listagem** e usa a lista escrita à mão. Um id não listado ainda pode ser enviado (a seleção na UI exige entrada no catálogo), tratado como só texto. Logo `auto` e os modelos virtuais do Thinker precisam estar listados em `models`. (`llm-deepseek-api-key/README.md`, `llm-deepseek/README.md`)
- Campos por modelo na rota nativa (`llm-deepseek/src/config.ts:77-88`): `contextWindow`, `maxTokens`, `inputModalities` (padrão `['text']`; **sem `image` o dsh não envia imagens**, só marcadores de texto), `imagePixelBudget`, `imageMaxBytes`, `systemPromptUpdate: in-history`, `toolUpdate: in-history|addition-only`. O esforço de raciocínio vem de `reasoningEffort` global (`off|low|high|max`), sem lista por modelo. `max_tokens` do pedido = `maxTokens` do modelo, senão 256.000 (`defaults.ts`).
- Rota pi-ai: a lista `models` do perfil substitui o catálogo; campos `contextWindow`, `maxTokens`, `input` (modalidades, padrão só texto), `reasoningEfforts` (sem ele o modelo manual não mostra o menu Effort). "Fetch available models" usa `GET {baseURL}/models` com Bearer (ou `GET /v1/models?limit=1000` com `x-api-key` e `anthropic-version` em `anthropic-messages`), formato `data[]` ou mapa `models`; é só conveniência na configuração. (`llm-pi-ai/README.md`, `providers.md:63,83,227`)

### Cabeçalhos e sessão

Rota nativa, em toda requisição de modelo autorizada (`packages/llm/llm-deepseek/src/adapter.ts:143-153`, `docs/deepseek-llm-api-wire-extensions.md`):

| Cabeçalho | Valor | Quando |
|---|---|---|
| `user-agent` | `deepseek-harness/<versão> (+https://github.com/deepseek-ai/deepseek-harness)` seguido de ` dsh-profile/<perfil>` (`desktop`, `web`, `sdk`) a partir do rc.2 | toda requisição, inclusive Files. O sufixo vem de `DSH_USER_AGENT_SUFFIX` definido pelo launcher (`attribution.ts:43-50,64,74-77`); sem ele só a parte base |
| `x-api-key` | chave | sempre (conta DeepSeek usaria `x-dsh-auth-token`, irrelevante para gateway) |
| `anthropic-version` | `2023-06-01` | sempre |
| `anthropic-beta` | `files-api-2025-04-14` (pedido com imagem por id de arquivo; também nas chamadas Files), `mid-conversation-tool-changes-2026-07-01` (qualquer mensagem com `tool_addition`/`tool_removal`), separados por vírgula | condicional |
| `x-deepseek-harness-user-id` | UUID anônimo estável do home do dsh | sempre |
| `x-deepseek-harness-session-id` | id da sessão | quando a requisição tem sessão (omitido em chamada direta) |
| `x-deepseek-harness-compact` | `1` | requisição de compactação (`purpose: compaction`) |
| `content-type`, `accept` | `application/json`, `text/event-stream` | sempre |

- Título de sessão e revisão automática não têm cabeçalho de propósito; vale só a regra do id de sessão. Não há cabeçalho de sessão-mãe ou subagente na rota nativa; o log carrega `origin: subagent`, `parentSession` e `delegationDepth`, mas no **corpo** (`dsh_session_log.session`).
- Rota pi-ai: manda `user-agent` (mesmo valor) mais os `headers` do perfil; os compat de afinidade de sessão (`sendSessionAffinityHeaders`, `sessionAffinityFormat`) são "withhold", ou seja, o perfil não consegue ligá-los (`llm-pi-ai/src/catalog.ts:272-303`). Plugins podem acrescentar cabeçalhos pelo gancho `llm-pi-ai/request-headers` (rc.2), mas nenhum plugin do repositório o usa para o id de sessão. A doc diz que o adaptador pi-ai não implementa as extensões do DeepSeek. Para sessão estável nessa rota, um `headers: { x-session-key: <valor> }` fixo por perfil é o único caminho.
- **Campos extras no corpo (rota nativa)**: `dsh_plugin_packages` (`{version:1, packages:[{name, version?}]}`, ligado por padrão) e `dsh_session_log` (`{version:1, sessionFormatVersion, session:{...}, afterSeq, throughSeq, events:[...]}`, ligado por padrão, até 8 MiB por requisição). Entram como irmãos de topo dos campos base, fora de `messages`. O log inclui system prompts, conteúdo de usuário e assistente, argumentos e resultados de ferramentas, `cwd`, compactações. O dsh os manda ao `baseURL` configurado, inclusive um gateway; só HTTP 2xx marca entrega ("at-least-once"); falha de serialização manda o corpo base sem extensões. Pode ser desligado por composição (`enabled: false`), não por cabeçalho. (`docs/deepseek-llm-api-wire-extensions.md`, `llm-deepseek/README.md` "Provider-specific request fields")

### Outros endpoints

- Rota nativa: `POST {base}/v1/messages` (SSE sempre; `stream: true` fixo). `POST/GET/DELETE {base}/v1/files` para imagens: sobe os bytes e referencia por id; qualquer falha na resolução do arquivo (404, 405, JSON inválido, tempo de 60 s) **refaz a requisição inteira com base64 inline** (sem misturar ids e base64 num pedido). Cache de ids por endpoint+hash dos cabeçalhos de autenticação, expiração local de 7 dias. Em quota de arquivos apaga um lote dos mais antigos e tenta de novo. (`adapter.ts:106-123`, `request-files.ts`, `file-store.ts`)
- Listagem de modelos: só com endpoint oficial (ver acima). Sem `count_tokens`, health ou telemetria contra o gateway (nada no fonte do adaptador; telemetria própria do dsh para outros destinos não foi auditada). Busca na web usa a Search API da DeepSeek por padrão desde o rc.2 e não passa pelo gateway.
- Rota pi-ai: `POST {baseURL}/chat/completions` (ou `/responses`, `/v1/messages`); descoberta de modelos só durante a configuração.

### Recursos usados

- Tools, streaming SSE, imagens, thinking/reasoning (`output_config.effort` com `low|high|max`; `off` envia `thinking.type: disabled`), temperature, `stop_sequences`, compactação proativa, subagentes (sessões-filhas), cache de prefixo. Não usa `tool_choice`, `metadata`, `cache_control`, `top_p`.
- **Mensagens `role: system` no meio da conversa**: modelos com `systemPromptUpdate: in-history` mantêm o system inicial e mandam **snapshots completos** do novo prompt como `system` depois do turno de usuário ou resultado correspondente; o contrato do dsh é que a última mensagem `system` vale como o prompt efetivo inteiro. Mensagens de desenvolvedor viram `system` com texto e blocos de ferramenta. Modelos sem a declaração recebem o último snapshot como `system` de topo.
- **Blocos de atualização de ferramentas**: modelos com `toolUpdate: addition-only|in-history` mandam, dentro de mensagens `role: system`, blocos `tool_addition`/`tool_removal` com `tool: {type:"tool_reference", name}` referenciando nomes declarados, e declarações com `defer_loading: true`. Uma lista só de ferramentas adiadas segue sem alteração; a rejeição do provedor sobe como está. Ao remover uma ferramenta, a projeção recompõe uma base `addition-only`.
- Tolerância do histórico: argumentos de ferramenta antigos inválidos viram `{}`; blocos de texto vazios do assistente e mensagens vazias são omitidos; `reasoning`/`tool-call` dentro de mensagens de usuário são omitidos. (`serialize.ts`)

### Erros e retentativas

- Códigos estáveis (`llm-deepseek/README.md`, `transport.ts`): 401/403 ou `authentication_error`/`permission_error` -> `AUTH`; 402 ou texto de cota -> `QUOTA`; 429 ou `rate_limit_error` -> `RATE_LIMIT`; texto de janela de contexto -> `CONTEXT_WINDOW_EXCEEDED`; 400/413/`invalid_request_error` -> `INVALID_REQUEST`; 5xx, `api_error`, `overloaded_error` -> `SERVER`; outros `HTTP_<status>`; `TRANSPORT`; `TIMEOUT` (ocioso 300 s por leitura); `EMPTY_RESPONSE` (stop sem blocos); `MALFORMED_RESPONSE`, `UNSUPPORTED_CONTENT`, `STREAM_CLOSED` (violações de protocolo no stream).
- Retry padrão (`dsh-llm-retry`, sem mudança desde `alpha.3`): 5 retentativas para `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT` e `TRANSPORT`, backoff exponencial de 500 ms a 10 s com 10% de jitter; usa `Retry-After` válido (segundos ou data HTTP) dentro dos limites. O modo `always` repete sem limite. Cada retentativa é outra requisição cobrada. Não há tratamento específico de 529; 5xx cai em `SERVER`. `MALFORMED_RESPONSE` e `UNSUPPORTED_CONTENT` **não** são repetidos. Como o Thinker devolve 429/5xx transitórios com `retry-after`, o encaixe é bom. Desde o rc.2 o usuário escolhe condição, número e espera do retry nas configurações do modelo.
- O corpo de erro não precisa ser JSON (o status basta). Cabeçalhos lidos: `retry-after`, `request-id`, `x-request-id`, `x-deepseek-request-id`. Com `baseURL` customizado, 401 do gateway é `AUTH`; chave ausente falha antes da rede (`MISSING_CREDENTIAL`).
- Rota pi-ai: erros do pi-ai não expõem o status; o dsh classifica pelo texto. Desde o rc.2, se a mensagem começa com status 4xx/5xx (erros dos SDKs da OpenAI e da Anthropic), só esse status vale; senão procura o status em qualquer ponto. Um 5xx de gateway que cita `insufficient_quota` ou `invalid_request_error` vira `QUOTA`/`INVALID_REQUEST` (não repetido). (`llm-pi-ai/src/stream.ts:34-58`)

### Snippet de setup do Thinker

Os snippets atuais do Thinker (`setup-snippets.ts`) batem com o contrato quanto a `baseURL`, `apiKeyEnv` e lista `models`. O que deve mudar (G9): declarar a modalidade de imagem. Forma a validar ao vivo:

Rota nativa (Messages), em `$DSH_HOME/profiles/web/cordis.patch.yml` e variável de ambiente `THINKER_AGENT_KEY`:

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    baseURL: http://localhost:2099        # o dsh acrescenta /v1/messages
    apiKeyEnv: THINKER_AGENT_KEY          # valor: thk_...
    models:
      - id: auto
        contextWindow: 128000
        maxTokens: 16384
        inputModalities: [text, image]    # sem isto o dsh não manda imagens
```

Rota pi-ai (Chat Completions), equivalente à UI "Custom model API":

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      thinker:
        displayName: Thinker
        apiKeyEnv: THINKER_AGENT_KEY
        api: openai-completions
        baseURL: http://localhost:2099/v1
        models:
          - id: auto
            contextWindow: 128000
            maxTokens: 16384
            input: [text, image]
```

(Formato do bloco `id`/`name`/`config` tirado dos READMEs e do `providers.md`; a forma exata do `cordis.patch.yml` não foi validada ao vivo.) Não declare `systemPromptUpdate: in-history` nem use o `deepseek-flash` padrão com o Thinker (ver G4).

### Formato na rede

Variante de harness: o que o dsh manda além do protocolo base e o que exige da resposta. Tag lida: `deepseek-ai/deepseek-harness@dsh-v0.2.2-rc.3` (abreviada **sdk** abaixo; caminhos relativos ao repositório). Nenhuma linha foi vista na rede: o dsh é cliente, não há endpoint público para sondar e não há captura em `docs/externos/capturas/harness-deepseek-harness/`, então todo `Ao vivo` é `não verificado em produção`. Entre `alpha.3` e `rc.3` o fio da rota nativa só mudou no `user-agent` (comparação de blobs e do documento de extensões).

#### `POST /v1/messages` (diferenças em relação a [Anthropic Messages](../api/api-anthropic.md#formato-na-rede)) — rota nativa

| Item | Formato | Fonte | Ao vivo |
|---|---|---|---|
| Pedido | Sempre `{model, stream:true, max_tokens, messages, thinking:{type:"enabled"\|"disabled"}}`; opcionais `system` (**sempre string**, nunca lista de blocos; junta o prompt da chamada e o snapshot do histórico com linha em branco), `output_config:{effort:"low"\|"high"\|"max"}` (ausente com `off`), `temperature`, `stop_sequences`, `tools[{name, description, input_schema, defer_loading?:true}]`. **Nunca** manda `tool_choice`, `metadata`, `cache_control`, `top_p`, `top_k`, `service_tier`. `max_tokens` = `maxTokens` do modelo declarado ou 256000. Mensagens `{role, content:[blocos]}` com `content` sempre lista (nunca string), `role` ∈ `user`, `assistant`, **`system`** (no meio da lista, só em modelos com `systemPromptUpdate`/`toolUpdate`; cada `system` do meio fica depois de um turno `user`, senão o dsh falha localmente). Blocos de entrada: `text`, `image` (`source` `base64{media_type, data}` ou `file{file_id}`, sempre precedido de um bloco `text` com o identificador do anexo), `tool_result{tool_use_id, content:[text\|image], is_error?}` (lista pode ser vazia), `thinking{thinking, signature?}`, `tool_use{id, name, input}`, `tool_addition`/`tool_removal{tool:{type:"tool_reference", name}}` (só dentro de `role:"system"`). Mensagens consecutivas do mesmo papel são fundidas; resultados de ferramenta viram `user`. Não manda `document`, `redacted_thinking` nem `server_tool_use` | sdk `packages/llm/llm-deepseek/src/serialize.ts`, `wire-types.ts`; doc `README.md` do pacote ("Endpoint and wire format") | não verificado em produção |
| Cabeçalhos | `user-agent`, `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-beta` condicional (`files-api-2025-04-14`, `mid-conversation-tool-changes-2026-07-01`), `x-deepseek-harness-user-id`, `x-deepseek-harness-session-id`, `x-deepseek-harness-compact: 1`, `content-type`, `accept: text/event-stream` (tabela em "Cabeçalhos e sessão"). Não manda `Authorization` nem `x-session-key` | sdk `packages/llm/llm-deepseek/src/adapter.ts:143-153`; doc `docs/deepseek-llm-api-wire-extensions.md` (2026-11-17) | não verificado em produção |
| Campos extras | `dsh_plugin_packages{version:1, packages:[{name, version?}]}` e `dsh_session_log{version:1, sessionFormatVersion, session, afterSeq, throughSeq, events[]}` (até 8 MiB, conteúdo sensível) como campos de topo; prefixo reservado `dsh_`. Um receptor pode ignorá-los ou descartá-los, desde que responda 2xx (a entrega é marcada no 2xx); um 4xx por campo desconhecido impede o envio e o log fica retido para a próxima requisição | doc `docs/deepseek-llm-api-wire-extensions.md` (2026-11-17); sdk `packages/llm/llm-deepseek/src/request-extensions.ts`, `packages/llm/deepseek-llm-api-extensions/README.md` | não verificado em produção |
| Resposta | Só lê stream; não há caminho sem `stream`. Exige corpo presente (senão `EMPTY_RESPONSE`); não confere o `content-type` da resposta | sdk `adapter.ts:168`, `sse.ts` | não verificado em produção |
| Uso | De `message_start.message.usage` e de cada `message_delta.usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; campo ausente é ignorado, o valor presente substitui o anterior (cumulativo, último vence); **`null`, negativo ou não inteiro falha** com `MALFORMED_RESPONSE`. Total = soma dos quatro | sdk `translate.ts` (`updateUsage`) | não verificado em produção |
| Stream | SSE via `eventsource-parser`. Cada `data:` precisa ser JSON com `type` string; se houver linha `event:`, o nome tem de ser igual a `type`, senão `MALFORMED_RESPONSE`. Ordem exigida: `message_start` (uma vez) antes de qualquer outro evento; blocos com `content_block_start{index, content_block}`, `content_block_delta`, `content_block_stop`; `message_delta{delta.stop_reason}` ao menos uma vez com `stop_reason` não nulo; `message_stop` por último com todos os blocos fechados (senão `STREAM_CLOSED`). `index` não precisa ser contíguo (o dsh renumera), mas não pode repetir nem iniciar depois do `stop_reason`. Tipos de evento desconhecidos (`ping` etc.) são ignorados; comentários SSE e eventos contam como atividade (vigia de 300 s ociosos). Parada sem blocos com `end_turn` = `EMPTY_RESPONSE` (repetida) | sdk `translate.ts`, `sse.ts`, `adapter.ts` (vigia) | não verificado em produção |
| Stream: blocos e deltas aceitos | Início: `text`, `thinking{thinking, signature?}`, `tool_use{id, name, input}` (`id` e `name` não vazios). Qualquer outro tipo (`redacted_thinking`, `server_tool_use`, `*_tool_result`) -> `UNSUPPORTED_CONTENT`. Deltas: `text_delta`, `thinking_delta`, `signature_delta` (concatenados), `input_json_delta` (concatenados); outro (`citations_delta`) -> `MALFORMED_RESPONSE`. `stop_reason` aceito: `end_turn`, `stop_sequence`, `tool_use`, `max_tokens`; outros (`refusal`, `pause_turn`, `model_context_window_exceeded`) -> `MALFORMED_RESPONSE` sem retry (G7) | sdk `translate.ts` (`startBlock`, `deltaChunk`, `stopReason`) | não verificado em produção |
| Ferramentas | Definição: `{name, description, input_schema, defer_loading?}`; sem `tool_choice` nem `parallel_tool_calls`. Chamada: bloco `tool_use` com `id` gerado pelo servidor (qualquer string não vazia; o dsh não exige prefixo `toolu_`); `input` vem do `input_json_delta` concatenado e precisa ser JSON de **objeto** (fora de `max_tokens`; truncado em `max_tokens` é tolerado). Paralelas: vários blocos `tool_use` no mesmo turno, cada um com `index` próprio; o dsh aceita todos. Resultado: uma mensagem `user` com todos os `tool_result` primeiro (`tool_use_id` igual ao `id`, `content` lista de `text`/`image`, `is_error` só quando definido); o dsh valida antes de enviar: id duplicado, resultado sem chamada ou chamada sem resultado imediato falham localmente com `INVALID_REQUEST`. Mudanças de ferramenta no meio: `tool_addition`/`tool_removal` em mensagem `system` com o beta `mid-conversation-tool-changes-2026-07-01` | sdk `serialize.ts`, `translate.ts`, `wire-types.ts`; doc `README.md` do pacote | não verificado em produção |
| Raciocínio | `thinking` é sempre enviado (`enabled` ou `disabled`); `output_config.effort` só com `enabled`. A resposta traz blocos `thinking` com `signature` opcional (via `signature_delta`); o histórico devolve `thinking{thinking, signature?}` no turno do assistente, **inclusive sem `tool_use`**, e a assinatura só volta se o `replayState` do mesmo modelo for válido (senão omite as assinaturas e mantém texto e ferramentas, com aviso). Bloco `thinking` sem assinatura é aceito e devolvido sem ela | sdk `serialize.ts`, `replay.ts`, `translate.ts`; doc `README.md` do pacote ("Model Experience") | não verificado em produção |
| Erro | HTTP não 2xx: corpo lido como JSON se possível (`{error:{type, message, code?}}`), senão só o status; classificação em "Erros e retentativas". Lê `retry-after`, `request-id`, `x-request-id`, `x-deepseek-request-id`. Erro no stream: `event: error` com `data:{type:"error", error:{type, message}}` vira erro classificado pelo mesmo `error.type` (`overloaded_error`/`api_error` -> `SERVER`, repetido; `invalid_request_error` -> `INVALID_REQUEST`) | sdk `transport.ts`, `sse.ts`, `adapter.ts:155-170` | não verificado em produção |

#### `POST /v1/files`, `GET /v1/files`, `GET /v1/files/{id}`, `DELETE /v1/files/{id}` (Files API estilo Anthropic) — rota nativa

Superfície que não segue um protocolo base do índice; estrutura completa. O Thinker não a serve (G6); o dsh tolera qualquer falha caindo para base64 inline.

| Item | Formato | Fonte | Ao vivo |
|---|---|---|---|
| Cabeçalhos | Os mesmos de autenticação e `user-agent`, mais `anthropic-version: 2023-06-01` e `anthropic-beta: files-api-2025-04-14`; não manda os cabeçalhos `x-deepseek-harness-*` nem `content-type` manual (o `FormData` define o limite) | sdk `files-api.ts` (`request`) | não verificado em produção |
| Upload | `POST /v1/files`, `multipart/form-data` com `expires_after[anchor]=created_at`, `expires_after[seconds]` (3600 a 2.592.000; padrão 604.800) e `file` (bytes da imagem normalizada, `Content-Type` = tipo da imagem, nome de arquivo). Limites do cliente: 128 MiB por upload, 32 MiB por imagem. Resposta exigida: `{id, type:"file", mime_type, size_bytes, created_at (ISO), filename}` com `size_bytes` igual ao enviado; sem `expires_at` | sdk `files-api.ts`, `file-store.ts` | não verificado em produção |
| Listagem, consulta e remoção | `GET /v1/files?after_id=&limit=` -> `{data:[arquivo], first_id, last_id, has_more}`; `GET /v1/files/{id}` -> arquivo; `DELETE /v1/files/{id}` -> `{id, type:"file_deleted"}` (id igual ao pedido). Usados para limpar arquivos do próprio dsh em caso de cota | sdk `files-api.ts` | não verificado em produção |
| Erro e queda | 401/403 `AUTH`, 429 `RATE_LIMIT`, 5xx `SERVER`, resto `FILES_API`; cota detectada por texto (`quota`, `storage`, `stored files`, `file count`, `too many files`) apaga até 100 arquivos antigos do dsh e repete o upload uma vez. Qualquer falha ou resposta inválida (404, 405, JSON inválido, 60 s) na resolução de uma imagem refaz o pedido de modelo inteiro com base64 inline (limite inline 20 MiB, 600 imagens; acima disso `IMAGE_OFFLOAD_REQUIRED` e a compactação descarrega imagens antigas). Erro de modelo citando arquivo expirado ou inexistente invalida o cache e permite uma repetição | sdk `request-files.ts`, `file-store.ts`, `adapter.ts:106-123` | não verificado em produção |

#### `GET {baseURL}/models` — rota nativa e pi-ai (só na configuração)

| Item | Formato | Fonte | Ao vivo |
|---|---|---|---|
| Uso | Rota nativa: só com endpoint oficial; com gateway **não é chamado**. Rota pi-ai: "Fetch available models" durante a configuração, `GET {baseURL}/models` com `Authorization: Bearer` (Chat Completions e Responses) ou `GET /v1/models?limit=1000` com `x-api-key` e `anthropic-version` (`anthropic-messages`). Lê `data[]` (`id`, nome, janela, saída) ou um mapa `models`; lê no máximo uma página; só oferece candidatos, nada é salvo | sdk `packages/llm/llm-deepseek-api-key/README.md`; `packages/llm/llm-pi-ai/src/discovery.ts` | não verificado em produção |

#### `POST /v1/chat/completions` (diferenças em relação a [OpenAI Chat Completions](../api/api-openai.md#formato-na-rede)) — rota pi-ai

Corpo e leitura de resposta vêm da biblioteca `@earendil-works/pi-ai` (`^1.3.0` com patch do dsh), que o repositório do dsh não contém; o que está escrito abaixo é o que o dsh controla ou documenta. Para o corpo que o pi-ai monta contra uma URL desconhecida (`developer` no lugar de `system`, `store: false`, `max_completion_tokens`, `stream_options.include_usage`, `reasoning_effort`), ver o dossiê [harness-pi](harness-pi.md) (lido na versão `v1.5.0` do pi, não na `1.3.0` do dsh) (não confirmado para esta versão).

| Item | Formato | Fonte | Ao vivo |
|---|---|---|---|
| Pedido | Rota configurada com `api: openai-completions` e `baseURL` com `/v1`. Mensagens de sistema posteriores ao início: sem `supportsMidConvoSystemMessages` (rotas escritas à mão nunca têm; o perfil não o liga) cada uma vira mensagem `user` embrulhada em `<system-reminder>` na posição original; a lista completa de ferramentas atuais segue no início de cada requisição (sem `tool_addition`/`defer_loading`). O `compat` do perfil só liga chaves de formato (papel do system, campo de limite de saída, formato de thinking, `thinkingTokenBudgetField`, `vllmPriority`, `supportsStrictMode`, `cacheControlFormat`...); afinidade de sessão e `openRouterRouting` ficam retidas | doc `llm-pi-ai/README.md` ("Run with reasoning", "Known limitations"); sdk `llm-pi-ai/src/catalog.ts:255-310` | não verificado em produção |
| Cabeçalhos | `Authorization: Bearer <apiKeyEnv>`, `user-agent` do dsh (com ` dsh-profile/<perfil>`) e os `headers` fixos do perfil. Sem `x-deepseek-harness-*` e sem cabeçalho de sessão por padrão | sdk `llm-pi-ai/README.md` ("Request headers"), `catalog.ts:272-303` | não verificado em produção |
| Stream | Lê o stream pelo pi-ai; extensão patchada do Gemini: lê `tool_calls[].extra_content.google.thought_signature` e devolve como `extra_content` ao retomar com o mesmo modelo. Argumentos de ferramenta não são reparseados a cada delta | doc `llm-pi-ai/README.md` ("Known limitations") | não verificado em produção |
| Erro | Classificado pelo texto da mensagem do SDK; status inicial 4xx/5xx prevalece (rc.2) | sdk `llm-pi-ai/src/stream.ts:34-58` | não verificado em produção |
| `api: anthropic-messages` ou `openai-responses` | Mesma configuração com outro `api`. Em `anthropic-messages` o dsh remove o `thinking` assinado de respostas antigas quando o prefixo mudou (compactação, poda, troca de system ou ferramentas) ou quando o estado não tem `prefixDigest`; mensagens de sistema e ferramentas seguem a mesma regra acima | doc `llm-pi-ai/README.md` ("Replay"); sdk `llm-pi-ai/src/prefix-binding.ts` | não verificado em produção |

- Onde o Thinker lê e escreve este formato: entrada `proxy.controller.ts:532,548`; tradução Messages <-> Chat em `anthropic-messages-adapter.ts` (pedido `:375-440`, resposta e stream `:505-900`); passagem direta a destinos Anthropic em `anthropic-adapter.ts:595` e `provider-client.ts:841`.
- Capturas pedidas ao mantenedor (nenhuma ainda), todas com o dsh `0.2.2-rc.x` real apontado para o Thinker: (1) rota nativa, turno com `thinking` e duas `tool_use` paralelas, stream, modelo não Anthropic (`auto` roteado a DeepSeek ou OpenAI-compatível) e depois o turno seguinte com dois `tool_result`; (2) rota nativa, turno com imagem (veja o `POST /v1/files` receber 404 e o pedido repetido com base64); (3) rota nativa com `auto` roteado a Claude com thinking (verificar `redacted_thinking`, `usage` com `null` no `message_delta`); (4) resposta filtrada (`content_filter`) de um provedor Chat vista pelo dsh (G7); (5) rota pi-ai `openai-completions`, stream com tool call e `usage` final.

## Como o Thinker implementa hoje

Conferido no código em 2026-11-17 (`main`, `6bf042a6`).

- Plataforma `deepseek-harness`: lista em `packages/shared/src/agent-type.ts:38`, superfície **`messages`** em `:92` (comentário em `:90-91` diz que a rota pi-ai usa Chat Completions e o guia oferece as duas), nome `DeepSeek Harness` em `:118`, categoria `coding` em `:136`, ícone `deepseek.svg` em `:153`; espelhado em `packages/cli/src/provider-catalog.gen.ts:281-282`. Teste em `packages/shared/__tests__/agent-type-surfaces.spec.ts:24`.
- Entradas: `POST /v1/chat/completions` (`proxy.controller.ts:532`), `/v1/responses` (`:540`), `/v1/messages` (`:548`), todas em `handleProxyRequest`; também `POST /v1/messages/count_tokens` (`:402`, que o dsh não chama). Chave `thk_` aceita em `Authorization: Bearer` ou `x-api-key` (`otlp/guards/agent-key-auth.guard.ts:159-165`), então ambas as rotas autenticam. Corpo até 512 MB (`common/middleware/body-parser-limits.ts:4-5`), o que comporta o `dsh_session_log` de 8 MiB.
- Sessão: `x-deepseek-harness-session-id` é lido em `harness-session.ts:30` (lista `SESSION_HEADERS`, primeiro valor não vazio vence, entre `x-hermes-*` e `x-openwebui-chat-id`; teste em `harness-session.spec.ts:75`). O id alimenta `buildProxySessionScope` (`proxy.controller.ts:564-568`, `:1186-1192`; `proxy-session-scope.ts:15-43`), que gera chave de prompt cache do provedor e momentum de roteamento só quando há sessão explícita. Também usado em `proxy-message-recorder.ts:293` e `proxy-servers/egress-affinity.interceptor.ts:19`. `x-deepseek-harness-user-id` e `x-deepseek-harness-compact` não são lidos em lugar nenhum (G8). A rota pi-ai não manda cabeçalho de sessão (cai em `default`; o guia diz isso em `docs/usuario/conectar-harnesses.md:238`).
- Campos `dsh_*`: `stripHarnessPrivateFields` remove toda chave de topo com prefixo `dsh_` (`harness-session.ts:85-100`), chamada no começo de `handleProxyRequest` (`proxy.controller.ts:563`), então vale para os três formatos antes de roteamento, gravação e envio ao provedor; teste em `harness-session.spec.ts:81-85`. O Thinker responde 2xx normalmente, então o dsh marca o log como entregue (e o conteúdo se perde, como desejado). Não vale para `POST /v1/messages/count_tokens`, que o dsh não usa.
- Classificação do chamador: `caller-classifier.ts:35-72` e `detectSdk` em `:91-141` reconhecem OpenAI, `anthropic-*`, curl, python-requests, node-fetch, axios e Stainless; não há regra para `deepseek-harness/<versão> (+url) [dsh-profile/<perfil>]`, que cai em `sdk: 'unknown'` (`:140`) com o UA bruto gravado (G5).
- Messages para destino Anthropic: `applyAnthropicMessagesMutations` copia o corpo (`anthropic-adapter.ts:595-601`, chamada em `provider-client.ts:841`), então `system` de mensagens do meio, `tool_addition`/`tool_removal` e `defer_loading` seguem adiante sem tradução. `anthropic-beta` do chamador é saneado e mesclado (`anthropic-beta.ts`, `provider-client.ts:148-158`) e só enviado a `api.anthropic.com` (`provider-client.ts:884`, `anthropic-beta.ts:102`); isso inclui `mid-conversation-tool-changes-2026-07-01`, cuja aceitação pela Anthropic não está no dossiê `api-anthropic` (não confirmado).
- Messages para destino traduzido (`messagesToChatCompletionsRequest`, `anthropic-messages-adapter.ts:375-440`): mensagens `role: system` do meio têm o texto juntado ao system inicial (`:379-392`, resolvido em #374), então o conteúdo dos blocos `tool_addition`/`tool_removal` (sem texto) desaparece; `toChatTools` (`:311-323`) descarta `defer_loading` e entrega todas as ferramentas declaradas como ativas, de modo que `tool_removal` não tem efeito. Como a junção é concatenação, snapshots completos de `systemPromptUpdate: in-history` repetiriam o prompt (G4).
- Messages de saída traduzida: `STOP_REASON_MAP` (`:443-450`) mapeia `content_filter` para `refusal`, valor que o dsh rejeita (G7); `toAnthropicUsage` (`:457-491`) sempre devolve inteiros; `closeStream` (`:878-899`) fecha com `message_delta` e `message_stop`, inferindo `tool_use` quando faltou `finish_reason`; erro no stream sai como `event: error` com tipo por status (`:861-876`). `event:` e `type` coincidem (`formatMessagesEvent`, `:919-921`).
- Não existe `/v1/files` (controller com rotas `models`, `models/:id`, `embeddings`, `audio/transcriptions`, `messages/count_tokens`, `chat/completions`, `responses`, `messages`: `proxy.controller.ts:257,338,354,366,402,532,540,548`) (G6). Um `POST /v1/files` cai no 404 padrão do NestJS (corpo no formato do Nest, não no da Anthropic); o dsh trata como falha de arquivo e usa base64 inline.
- Setup, presente para as duas rotas: `getDeepSeekHarnessNativeSnippet` (`packages/shared/src/setup-snippets.ts:255-266`) e `getDeepSeekHarnessPiAiSnippet` (`:272-287`), snippet combinado `getDeepSeekHarnessSnippet` (`:289-298`, registrado em `:406`), com `yamlModels` (`:237-247`: só `id`, `contextWindow: 128000`, `maxTokens: 16384`, sem modalidades, G9); componente `packages/frontend/src/components/DeepSeekHarnessSetup.tsx` (abas nativa/pi-ai, perfil `$DSH_HOME/profiles/<profile>/cordis.patch.yml`), ligado em `SetupStepAddProvider.tsx:66,129-130`; textos em `packages/frontend/src/i18n/locales/{en,pt-BR}/harnesses.ts` (chaves `harnesses.guides.deepSeek*`); guia em `docs/usuario/conectar-harnesses.md:200-238`; texto do CLI em `packages/cli/src/provider-catalog.gen.ts:340-341`; testes em `packages/shared/__tests__/setup-snippets.spec.ts:150` e `packages/frontend/tests/components/HarnessGuides.test.tsx:55`. A variável do snippet é `THINKER_AGENT_KEY`, URL base sem `/v1` na rota nativa e com `/v1` na pi-ai (correto segundo o contrato).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/cli/src/provider-catalog.gen.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/harness-session.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/proxy-message-recorder.ts`
- `packages/backend/src/proxy-servers/egress-affinity.interceptor.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/anthropic-adapter.ts`
- `packages/backend/src/routing/proxy/anthropic-messages-adapter.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/otlp/guards/agent-key-auth.guard.ts`
- `packages/backend/src/common/middleware/body-parser-limits.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/frontend/src/components/DeepSeekHarnessSetup.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Sem snippet/guia/componente de setup; a superfície declarada era `chat_completions`, que só vale para a rota pi-ai. | frontend-dev | [#381](https://github.com/patrickbrandao/thinker/issues/381) | resolvida (superfície `messages`, guia e snippet das duas rotas, `DeepSeekHarnessSetup.tsx`; conferido em 2026-11-17). O que sobrou do snippet está em G9 |
| G2 | quebra (não confirmado ao vivo) | `dsh_session_log` (até 8 MiB, conteúdo sensível) e `dsh_plugin_packages` seguiam no corpo de `/v1/messages` para provedores Anthropic. | backend-dev | [#382](https://github.com/patrickbrandao/thinker/issues/382) | resolvida (`stripHarnessPrivateFields`, `proxy.controller.ts:563`; conferido em 2026-11-17) |
| G3 | degradação | `x-deepseek-harness-session-id` não era lido como chave de sessão (cai em `default`, sem afinidade de cache nem momentum). | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) | resolvida (`harness-session.ts:30`, commit 3ae6d5a4; conferido em 2026-11-17). A rota pi-ai continua sem sessão por limitação do cliente |
| G4 | degradação (condicional, não confirmado ao vivo) | Blocos `tool_addition`/`tool_removal`/`defer_loading` não têm tratamento no Thinker: em rota traduzida `defer_loading` é descartado (todas as ferramentas ficam ativas, `tool_removal` não tem efeito, benigno); em destino Anthropic seguem no corpo com o beta repassado só a `api.anthropic.com` (aceitação não confirmada). Além disso, `systemPromptUpdate: in-history` (padrão do `deepseek-flash` e de qualquer modelo que o declare) envia **snapshots completos** de system no meio da conversa, e o Thinker concatena todos ao system inicial (`anthropic-messages-adapter.ts:379-388`), repetindo o prompt a cada atualização. O snippet atual não declara `in-history`, então só afeta quem usar o catálogo padrão do dsh com o Thinker. Sugestão: manter o aviso no guia e, se for relevante, para chamadores `deepseek-harness` usar só o último system do meio. | backend-dev | [#374](https://github.com/patrickbrandao/thinker/issues/374), [#375](https://github.com/patrickbrandao/thinker/issues/375) (fechadas) | aberta (reavaliada em 2026-11-17: system do meio resolvido em #374, parte de blocos de ferramenta benigna; sem issue nova) |
| G5 | oportunidade | `classifyCaller` não reconhece o UA `deepseek-harness/<versão> (+url)`, que desde o rc.2 termina em ` dsh-profile/<perfil>` (ex. `deepseek-harness/0.2.2-rc.3 (+https://github.com/deepseek-ai/deepseek-harness) dsh-profile/web`); fica `sdk: unknown`. Regra sugerida: `^deepseek-harness\/([^\s]+) \(\+[^)]*\)(?: dsh-profile\/(\S+))?`, com o perfil tolerado ausente (versões antigas, SDK sem sufixo). | backend-dev | — | aberta |
| G6 | oportunidade | Sem `/v1/files`: a cada pedido com imagem o dsh sobe os bytes (multipart, até 32 MiB por imagem), recebe 404 e refaz o pedido com base64 inline (funciona, custa uma ida extra e o upload perdido; não vi cache negativo). Avaliar uma resposta curta e clara (por exemplo 501 no formato de erro da Anthropic, para a falha ser barata) ou implementar a Files API (`POST/GET/DELETE /v1/files`, formato em "Formato na rede"). Só importa depois de G9, quando o dsh passar a mandar imagens. | backend-dev | — | aberta |
| G7 | degradação (não confirmado ao vivo) | O dsh rejeita sem retry `stop_reason` fora de `end_turn`/`stop_sequence`/`tool_use`/`max_tokens`, blocos de resposta fora de `text`/`thinking`/`tool_use`, deltas fora dos quatro conhecidos e `usage` com `null`. O Thinker mapeia `content_filter` para `refusal` (`anthropic-messages-adapter.ts:443-450`) e repassa `refusal`, `pause_turn`, `redacted_thinking` e `server_tool_use` no caminho nativo Anthropic. Sugestão: para o dsh, emitir `event: error` (`invalid_request_error`, mensagem de filtro de conteúdo) no lugar de `refusal`, e conferir `usage` sem `null`. | backend-dev | [#544](https://github.com/patrickbrandao/thinker/issues/544) | aberta |
| G8 | oportunidade | `x-deepseek-harness-compact: 1` (requisição de compactação) e `x-deepseek-harness-user-id` (UUID anônimo estável) não são lidos. O primeiro serviria para rotear compactação a um modelo mais barato ou de contexto maior; o segundo, para atribuição por instalação. | backend-dev | — | aberta |
| G9 | degradação | Os snippets e o guia declaram `auto` e os virtuais só com `contextWindow` e `maxTokens`; sem `inputModalities: [text, image]` (rota nativa) ou `input: [text, image]` (rota pi-ai) o dsh trata o modelo como só texto e nunca envia imagem; na rota pi-ai também falta `reasoningEfforts` para o menu de esforço. | frontend-dev | [#545](https://github.com/patrickbrandao/thinker/issues/545) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira pesquisa completa. Projeto identificado (`deepseek-ai/deepseek-harness`, tag `dsh-v0.2.2-alpha.3`, commit 05b1cae8); lidos README, docs de extensões de fio, adaptadores Messages e pi-ai, retry e guia de modelos. G1 a G6 registradas; issues #381 e #382 abertas, comentários em #318, #374 e #375. Nada verificado ao vivo.
- 2026-11-17: revisão contra `dsh-v0.2.2-rc.3` (commit 38a6a5c9), comparada com `alpha.3` por blobs e `diff`. Fio da rota nativa inalterado salvo o `user-agent` com ` dsh-profile/<perfil>` (rc.2); novidades só do lado do cliente (omissão de `thinking` assinado velho, classificação de erro do pi-ai, `google-generative-ai`, gancho `llm-pi-ai/request-headers`). `### Formato na rede` preenchido (nativa, Files, listagem, pi-ai), todo `não verificado em produção`. Código do Thinker reauditado: G1, G2 e G3 conferidas como resolvidas; G4 reavaliada (benigna em rota traduzida, risco condicional com `in-history`); G5 atualizada para o novo UA; G6 mantida; novas G7 ([#544](https://github.com/patrickbrandao/thinker/issues/544)), G8 e G9 ([#545](https://github.com/patrickbrandao/thinker/issues/545)). npm já tem `0.2.2-rc.4` (2026-11-17) sem tag; não lido.
