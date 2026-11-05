---
id: harness-deepseek-harness
categoria: harness
entidade: DeepSeek Harness
agente: harness-deepseek-harness
thinker_ids: [deepseek-harness]
revisado_em: 2026-11-03
versao_observada: dsh v0.2.2-alpha.3 (commit 05b1cae8; npm latest 0.2.1-rc.5)
---

# DeepSeek Harness (harness)

Especificação mantida pelo agente `harness-deepseek-harness` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- **Identificação (confiança alta).** "DeepSeek Harness" é o projeto `deepseek-ai/deepseek-harness` (CLI `dsh`, pacote npm `@deepseek-ai/dsh`, MIT, TypeScript, criado em 2026-08-13, "developer preview" com quebras de compatibilidade esperadas). A semente `github.com/deepseek-ai` apontava só para a organização; o repositório correto foi confirmado pelo README, pela página `deepseek.com/harness` e pelas listas de provedores de terceiros (BytePlus, OpenCode Go) que citam "DeepSeek Harness". Não confundir com `DeepSeek-TUI` (Hmbown), que é outro projeto.
- Tem **duas rotas de LLM** que valem para um gateway: (1) a rota nativa `deepseek-official`, em **Anthropic Messages**, com `baseURL` configurável; (2) a rota `llm-pi-ai`, com `api: openai-completions` (Chat Completions), `openai-responses` ou `anthropic-messages`, `baseURL` e `models` escritos à mão (é o que a UI "Custom model API" gera). A superfície `chat_completions` que o Thinker declara só vale para a rota 2.
- Na rota nativa, além de `x-api-key`, manda cabeçalhos próprios (`x-deepseek-harness-session-id`, `x-deepseek-harness-user-id`, `x-deepseek-harness-compact`) e **campos extras no corpo** (`dsh_session_log` com até 8 MiB do log da sessão, `dsh_plugin_packages`). O Thinker não lê os cabeçalhos (G3) e repassa os campos extras a provedores Anthropic (G2).
- Usa recursos de Messages recentes: mensagens `role: system` no meio de `messages`, blocos `tool_addition`/`tool_removal`, `defer_loading`, `output_config.effort`, `thinking.type: disabled`, Files API (`/v1/files`) para imagens. O Thinker não tem `/v1/files`; o cliente cai para base64 inline.
- Não há setup, snippet nem guia no Thinker para esse harness (G1).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Repositório oficial | <https://github.com/deepseek-ai/deepseek-harness> | tag `dsh-v0.2.2-alpha.3` (2026-11-03, commit 05b1cae8); `master` 8bd07339 (2026-11-03) |
| Releases | <https://github.com/deepseek-ai/deepseek-harness/releases> | `v0.2.2-alpha.3` (2026-11-03), `v0.2.1-rc.5` (2026-10-30) |
| npm `@deepseek-ai/dsh` | <https://www.npmjs.com/package/@deepseek-ai/dsh> | dist-tags: `latest`/`next` 0.2.1-rc.5, `alpha` 0.2.2-alpha.3 |
| Extensões de fio DeepSeek | `docs/deepseek-llm-api-wire-extensions.md` do repositório | tag `dsh-v0.2.2-alpha.3` |
| Adaptador Messages | `packages/llm/llm-deepseek/README.md` e `src/adapter.ts` | idem |
| Adaptador pi-ai (gateways) | `packages/llm/llm-pi-ai/README.md` | idem |
| Guia de modelos | `docs/user/guide/providers.md` | idem |
| Política de retry | `packages/llm/llm-retry/README.md` | idem |
| Documentação publicada | <https://deepseek-harness.github.io/deepseek-harness/> | não lida (o fonte do repositório foi usado) |

Leitura feita no fonte do repositório (clone raso em scratchpad, nada executado). O release marca "alpha/rc"; esperar mudanças.

## Contrato

### Configuração do gateway

- Instalação: `npx @deepseek-ai/dsh web` (Web UI em `http://127.0.0.1:3080`). Perfil padrão da Web UI: `web`; configuração em `$DSH_HOME/profiles/<perfil>/cordis.patch.yml` (lida de novo a cada requisição, sem reiniciar). (README e `docs/user/guide/providers.md`)
- **Rota nativa** (plugin `@deepseek-ai/dsh-llm-deepseek-api-key`, provedor `deepseek-official`, só Messages, sem campo `protocol`): `baseURL` explícito, senão `$DEEPSEEK_BASE_URL`, senão `https://api.deepseek.com/anthropic`. O cliente anexa `/v1/messages` (e `/v1/files`), reaproveitando um `/v1` final; barras finais não importam; a URL não pode ter credenciais, query ou fragmento. A chave vem de `apiKeyEnv` (padrão `DEEPSEEK_API_KEY`) e sai como `x-api-key`. Redirecionamentos são recusados. Na Web UI o cartão DeepSeek só expõe o campo da chave; `baseURL` exige editar o YAML ou a variável de ambiente. (`llm-deepseek/README.md`, `llm-deepseek-api-key/README.md`)
- **Rota pi-ai** (plugin `@deepseek-ai/dsh-llm-pi-ai`): `providers.<id>` com `api` (`openai-completions`, `openai-responses`, `anthropic-messages`), `baseURL`, `apiKeyEnv`, `models`, `headers` fixos, `compat`. Para Chat Completions o `baseURL` inclui `/v1` (exemplo `https://gateway.acme.example/v1`); a chave sai como `Authorization: Bearer`. A UI "Add model provider > Custom model API" grava exatamente isso. (`llm-pi-ai/README.md`, `providers.md`)
- Proxy de saída: variáveis padrão `HTTP(S)_PROXY` (`docs/user/guide/network-proxy.md`); irrelevante para o Thinker.

### Seleção de modelo

- Rota nativa: ids passam direto para o fio; o catálogo padrão anuncia `deepseek-flash` (texto e imagem) e `deepseek-v4-pro` (só texto), contexto 1.048.576. Só com a chave salva e o endpoint oficial o dsh consulta `GET https://api.deepseek.com/models`; **com `baseURL` ou `$DEEPSEEK_BASE_URL` customizado ele não pede listagem** e usa a lista `models` escrita à mão. Um id não listado ainda pode ser enviado (a seleção na UI exige entrada no catálogo). Logo os modelos do Thinker (`auto`, virtuais) precisam estar listados em `models`. (`llm-deepseek-api-key/README.md`)
- Rota pi-ai: a lista `models` do perfil substitui o catálogo; "Fetch available models" usa `GET {baseURL}/models` com Bearer (ou `GET /v1/models?limit=1000` com `x-api-key` e `anthropic-version` em `anthropic-messages`), formato `data[]` ou mapa `models`; é só conveniência na configuração. (`llm-pi-ai/README.md`)
- Campos úteis por modelo: `contextWindow`, `maxTokens`, `inputModalities` (nativa) ou `input` (pi-ai), `reasoningEfforts`. Sem `reasoningEfforts` o modelo manual não mostra o menu Effort.

### Cabeçalhos e sessão

Rota nativa, em toda requisição de modelo autorizada (`packages/llm/llm-deepseek/src/adapter.ts:148-152`, `docs/deepseek-llm-api-wire-extensions.md`):

| Cabeçalho | Valor | Quando |
|---|---|---|
| `user-agent` | `deepseek-harness/<versão> (+https://github.com/deepseek-ai/deepseek-harness)` | toda requisição, inclusive Files |
| `x-api-key` | chave | sempre (conta DeepSeek usaria `x-dsh-auth-token`, irrelevante para gateway) |
| `anthropic-version` | `2023-06-01` | sempre |
| `anthropic-beta` | `files-api-2025-04-14` (imagens por id de arquivo), `mid-conversation-tool-changes-2026-07-01` (blocos `tool_addition`/`tool_removal`) | condicional |
| `x-deepseek-harness-user-id` | UUID anônimo estável do home do dsh | sempre |
| `x-deepseek-harness-session-id` | id da sessão | quando a requisição tem sessão (omitido em chamada direta) |
| `x-deepseek-harness-compact` | `1` | requisição de compactação |

- Título de sessão e revisão automática não têm cabeçalho de propósito; vale só a regra do id de sessão. Não há cabeçalho de sessão-mãe ou subagente na rota nativa; o log carrega `origin: subagent`, `parentSession` e `delegationDepth`, mas no **corpo** (`dsh_session_log.session`).
- Rota pi-ai: manda só `user-agent` (mesmo valor) mais os `headers` do perfil; os compat de afinidade de sessão (`sendSessionAffinityHeaders`, `sessionAffinityFormat`) ficam retidos no catálogo (`llm-pi-ai/src/catalog.ts:272,302`). A doc diz que o adaptador pi-ai não implementa as extensões do DeepSeek. O `sessionId` é passado ao pi-ai (`adapter.ts:464`); se o pi-ai o usa como `prompt_cache_key` no Chat Completions não foi verificado (não confirmado).
- **Campos extras no corpo (rota nativa)**: `dsh_plugin_packages` (`{version:1, packages:[{name, version?}]}`, ligado por padrão) e `dsh_session_log` (`{version:1, sessionFormatVersion, session:{...}, afterSeq, throughSeq, events:[...]}`, ligado por padrão, até 8 MiB por requisição). O log inclui system prompts, conteúdo de usuário e assistente, argumentos e resultados de ferramentas, `cwd`, compactações. Fica fora de `messages`, então não conta tokens do modelo. Segundo a doc, o gateway recebe os mesmos valores que o endpoint oficial; só HTTP 2xx marca entrega ("at-least-once"). Chaves de API não entram. Pode ser desligado por composição (`enabled: false`), não por cabeçalho.

### Outros endpoints

- Rota nativa: `POST {base}/v1/messages` (SSE). `POST/GET/DELETE {base}/v1/files` para imagens: sobe os bytes e referencia por id; se o upload falhar ou estourar o tempo, **refaz a requisição inteira com base64 inline** (sem misturar). Cache de ids por endpoint+credencial, expiração local de 7 dias. Em 413/quota de arquivos apaga um lote dos mais antigos e tenta de novo.
- Listagem de modelos: só com endpoint oficial (ver acima). Sem `count_tokens`, health ou telemetria contra o gateway (nada encontrado no fonte do adaptador; telemetria própria do dsh para outros destinos não foi auditada).
- Rota pi-ai: `POST {baseURL}/chat/completions` (ou `/responses`, `/v1/messages`); descoberta de modelos só durante a configuração.

### Recursos usados

- Tools, streaming SSE, imagens, thinking/reasoning (`output_config.effort` com `low|high|max`; `off` envia `thinking.type: disabled`), temperature, compactação proativa, subagentes (sessões-filhas), cache de prefixo.
- **Mensagens `role: system` no meio da conversa**: modelos com `systemPromptUpdate: in-history` (o padrão `deepseek-flash` declara) mantêm o system inicial e mandam snapshots novos como `system` depois do turno correspondente.
- **Blocos de atualização de ferramentas**: modelos com `toolUpdate: addition-only|in-history` (padrão `deepseek-flash`: `addition-only`) mandam blocos de papel system `tool_addition`/`tool_removal` referenciando nomes declarados, e declarações com `defer_loading`.
- `dsh_session_log`/`dsh_plugin_packages` (acima).

### Erros e retentativas

- Códigos estáveis (`llm-deepseek/README.md`): 401/403 `AUTH`; `QUOTA`; `RATE_LIMIT`; `CONTEXT_WINDOW_EXCEEDED`; `INVALID_REQUEST`; `SERVER`; `HTTP_<status>`; `TRANSPORT`; `TIMEOUT` (ocioso 300 s por leitura); `EMPTY_RESPONSE` (stop sem blocos).
- Retry padrão (`dsh-llm-retry`): 5 retentativas para `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT` e `TRANSPORT`, backoff exponencial de 500 ms a 10 s com 10% de jitter; usa `Retry-After` válido dentro dos limites. O modo `always` repete sem limite. Cada retentativa é outra requisição cobrada. Não há tratamento específico de 529; 5xx cai em `SERVER`. Como o Thinker devolve 429/5xx transitórios com `retry-after`, o encaixe é bom.
- Erro de contexto estourado vira `CONTEXT_WINDOW_EXCEEDED` (classificação por status/mensagem do provedor; o conjunto exato de padrões não foi lido) (não confirmado).
- Com `baseURL` customizado, 401 do gateway é tratado como `AUTH`; chave ausente falha antes da rede (`MISSING_CREDENTIAL`).

### Snippet de setup do Thinker

Não existe snippet nem guia no Thinker (G1). O que deve valer, a confirmar ao vivo:

Rota nativa (Messages), em `$DSH_HOME/profiles/web/cordis.patch.yml` e variável de ambiente `THINKER_KEY` (nome livre):

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    baseURL: http://localhost:2099        # o dsh acrescenta /v1/messages
    apiKeyEnv: THINKER_KEY                # valor: thk_...
    models:
      - id: auto
```

Rota pi-ai (Chat Completions), equivalente à UI "Custom model API":

```yaml
- id: llm-pi-ai
  config:
    providers:
      thinker:
        displayName: Thinker
        apiKeyEnv: THINKER_KEY
        api: openai-completions
        baseURL: http://localhost:2099/v1
        models:
          - id: auto
```

(Formato do bloco de plugin `id`/`name`/`config` tirado dos READMEs; a forma exata do `cordis.patch.yml` não foi validada ao vivo.) Para sessão estável na rota pi-ai, um `headers: { x-session-key: <valor> }` fixo por perfil é o único caminho.

## Como o Thinker implementa hoje

- Plataforma `deepseek-harness`: lista em `packages/shared/src/agent-type.ts:38`, superfície `chat_completions` em `:88`, nome `DeepSeek Harness` em `:114`, categoria `coding` em `:132`, ícone `deepseek.svg` em `:149`; espelhado em `packages/cli/src/provider-catalog.gen.ts:264`.
- Entrada: `POST /v1/messages` (`proxy.controller.ts:262`), `/v1/chat/completions` (`:246`). Chave `thk_` aceita em `Authorization: Bearer` ou `x-api-key` (`otlp/guards/agent-key-auth.guard.ts:159-165`), então ambas as rotas autenticam. Corpo até 512 MB (`common/middleware/body-parser-limits.ts:4`), o que comporta o `dsh_session_log` de 8 MiB.
- Sessão: só `x-session-key` (`proxy.controller.ts:277` e `:899`; `proxy-session-scope.ts`). Nenhum código lê `x-deepseek-harness-session-id`, `x-deepseek-harness-user-id` ou `x-deepseek-harness-compact` (grep em `packages/backend/src` e `packages/shared/src`). A sessão do dsh cai em `default` (G3).
- Classificação do chamador: `caller-classifier.ts:35-66`; o `detectSdk` só reconhece OpenAI, `anthropic-sdk`, curl, python-requests, node-fetch e axios; o UA `deepseek-harness/<versão> (+url)` cai em `sdk: 'unknown'` com o UA bruto gravado (G5).
- Messages para destino Anthropic: `applyAnthropicMessagesMutations` copia o corpo inteiro (`anthropic-adapter.ts:599`, `provider-client.ts:778`), então `dsh_*` segue adiante (G2). `anthropic-beta` do chamador é repassado com saneamento (`anthropic-beta.ts`), incluindo `mid-conversation-tool-changes-2026-07-01`.
- Messages para destino traduzido: `anthropic-messages-adapter.ts` trata todo papel diferente de `assistant` como `user` (issue #374) e descarta blocos desconhecidos (#375), o que afeta `role: system` no meio e `tool_addition`/`tool_removal` (G4).
- Não existe `/v1/files` (grep em `routing/proxy/proxy.controller.ts`: rotas só `models`, `chat/completions`, `responses`, `messages`) (G6).
- Setup: sem componente em `packages/frontend/src/components/` (existem OpenCodeSetup, CodexSetup, etc.), sem snippet em `packages/shared/src/setup-snippets.ts`, sem seção em `docs/usuario/conectar-harnesses.md`. A única menção a `deepseek/flash` na doc é exemplo de modelo virtual.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/anthropic-adapter.ts`
- `packages/backend/src/routing/proxy/anthropic-messages-adapter.ts`
- `packages/backend/src/routing/proxy/anthropic-beta.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/otlp/guards/agent-key-auth.guard.ts`
- `packages/backend/src/common/middleware/body-parser-limits.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Sem snippet/guia/componente de setup; a superfície `chat_completions` declarada só vale para a rota pi-ai, a rota nativa fala Messages. Documentar as duas rotas e listar `auto`/virtuais em `models` (com `baseURL` customizado o dsh não lista modelos). | frontend-dev | [#381](https://github.com/patrickbrandao/thinker/issues/381) | aberta |
| G2 | quebra (não confirmado ao vivo) | `dsh_session_log` (até 8 MiB, conteúdo sensível) e `dsh_plugin_packages` seguem no corpo de `/v1/messages` para provedores Anthropic (cópia do corpo em `applyAnthropicMessagesMutations`), provável 400 por campo extra, vazamento a terceiro e ruído nos logs. Descartar campos `dsh_*` na entrada. | backend-dev | [#382](https://github.com/patrickbrandao/thinker/issues/382) | aberta |
| G3 | degradação | `x-deepseek-harness-session-id` não é lido como chave de sessão (cai em `default`, sem afinidade de cache nem momentum). Mesma causa de #318 e #320; comentário adicionado em #318. `x-deepseek-harness-user-id` serviria para atribuição e `x-deepseek-harness-compact: 1` para roteamento de compactação (oportunidade). | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) | resolvida (sessão de prompt cache e momentum lida dos cabeçalhos do harness) |
| G4 | degradação | Mensagens `role: system` no meio de `messages` (padrão do `deepseek-flash`) e blocos `tool_addition`/`tool_removal`/`defer_loading` viram usuário ou são descartados em rotas traduzidas. Mesma causa de #374 e #375; comentários adicionados. | backend-dev | [#374](https://github.com/patrickbrandao/thinker/issues/374), [#375](https://github.com/patrickbrandao/thinker/issues/375) | aberta |
| G5 | oportunidade | `classifyCaller` não reconhece o UA `deepseek-harness/<versão> (+url)` (fica `sdk: unknown`). | backend-dev | — | aberta |
| G6 | oportunidade | Sem `/v1/files`: o dsh tenta subir cada imagem, falha e refaz a requisição com base64 inline (funciona, mas custa uma ida extra e o cache de ids). Avaliar responder ao menos de forma rápida e clara, ou implementar a Files API. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira pesquisa completa. Projeto identificado (`deepseek-ai/deepseek-harness`, tag `dsh-v0.2.2-alpha.3`, commit 05b1cae8); lidos README, docs de extensões de fio, adaptadores Messages e pi-ai, retry e guia de modelos. G1 a G6 registradas; issues #381 e #382 abertas, comentários em #318, #374 e #375. Nada verificado ao vivo.
