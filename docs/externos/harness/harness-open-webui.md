---
id: harness-open-webui
categoria: harness
entidade: Open WebUI
agente: harness-open-webui
thinker_ids: [open-webui]
revisado_em: 2026-11-03
versao_observada: open-webui v0.13.0 (commit c38885a)
---

# Open WebUI (harness)

Especificação mantida pelo agente `harness-open-webui` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Identificação: o harness é o **Open WebUI** (`open-webui/open-webui`, Python/FastAPI + Svelte; última release `v0.13.0`, 2026-11-03). A identificação é segura: o repositório e os docs semente são os corretos, nenhuma fonte precisou ser trocada. Além do repositório, passou a ser fonte o repositório de docs `open-webui/docs` (fonte de <https://docs.openwebui.com/>).
- É uma interface web de chat (não um agente de código). Fala **Chat Completions** com o gateway (`POST {url}/chat/completions`); a API Responses é opt-in por conexão (`api_type: responses`, experimental). O servidor Open WebUI é quem chama o Thinker, não o navegador.
- Configuração é uma **conexão OpenAI** (URL base com `/v1` + chave Bearer), em Admin > Connections ou por `OPENAI_API_BASE_URL(S)` / `OPENAI_API_KEY(S)`. Os modelos vêm de `GET {url}/models` (ou de uma lista manual `model_ids`).
- **Não envia cabeçalho de sessão por padrão.** Com `ENABLE_FORWARD_USER_INFO_HEADERS=true` envia `X-OpenWebUI-Chat-Id` (+ identidade do usuário); com **cabeçalhos customizados da conexão** pode enviar qualquer cabeçalho com placeholders (`{{CHAT_ID}}`, `{{MESSAGE_ID}}`, `{{TASK}}`, ...). O Thinker lê só `x-session-key`, então a conexão deve definir `x-session-key: {{CHAT_ID}}` (sem mudança de código). Não há snippet nem guia para o Open WebUI no Thinker (lacuna G1).
- Também dispara requisições "utilitárias" (título, tags, sugestões de follow-up, busca) ao mesmo modelo, a menos que `TASK_MODEL` esteja definido; elas chegam ao Thinker como chats comuns.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Open WebUI repository | <https://github.com/open-webui/open-webui> | tag `v0.13.0` (2026-11-03, commit c38885a1a737) |
| Docs (fonte) | <https://github.com/open-webui/docs> (publica <https://docs.openwebui.com/>) | `main` @ 5b95953 (2026-11-03) |
| Docs: conectar provedor OpenAI-compatível | `docs/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/index.mdx` | 5b95953 |
| Docs: variáveis de ambiente | `docs/reference/env-configuration.mdx` (`ENABLE_FORWARD_USER_INFO_HEADERS`, `FORWARD_*`) | 5b95953 |
| Docs: exemplo de gateway com cabeçalhos customizados | `docs/ecosystem/computer/automate/open-webui.md` | 5b95953 |

## Contrato

### Configuração do gateway

- Conexão OpenAI em **Settings > Admin > Connections > Manage OpenAI API Connections**: URL (com `/v1`), chave, `prefix_id`, `tags`, `model_ids` (lista manual), `headers` (cabeçalhos customizados), `auth_type` (`bearer` padrão, `none`, `session`, `system_oauth`), `api_type` (`responses` opcional), `enable`. (`backend/open_webui/utils/headers.py:171-226`, `routers/openai.py:599-640`, v0.13.0)
- Por ambiente: `OPENAI_API_BASE_URL` / `OPENAI_API_KEY` (uma conexão) ou `OPENAI_API_BASE_URLS` / `OPENAI_API_KEYS` separados por `;`. Padrão é `https://api.openai.com/v1`; barra final removida. (`config.py:312-337`)
- A URL é concatenada literalmente: `{url}/chat/completions`, `{url}/models`, `{url}/responses`. A URL **precisa incluir `/v1`** (`routers/openai.py:1553-1555`, `:127`).
- O Open WebUI roda em Docker (porta 3000 no host, 8080 no contêiner). Se o Thinker roda no host, a URL usa `host.docker.internal` no lugar de `localhost` (docs, quick-start).
- Autenticação: `Authorization: Bearer <chave>` com a chave da conexão (`utils/headers.py:204-220`). A chave `thk_` vai aqui.

### Seleção de modelo

- Lista de modelos: `GET {url}/models` com Bearer, timeout 10 s (`AIOHTTP_CLIENT_TIMEOUT_MODEL_LIST`), resposta JSON `{ "data": [ { "id": ... } ] }`. Ignora modelos de `api.openai.com` com `babbage|dall-e|davinci|embedding|tts|whisper` no id (só para esse host). (`routers/openai.py:70,93-127,777-860`; `env.py:653`)
- Se `model_ids` estiver preenchido na conexão, **não chama `/models`**: usa só a lista manual. Os docs recomendam isso para provedores sem `/models`. O botão "Verify Connection" chama `/models` e só reporta o estado.
- Falha em `/models` (erro de rede, não-JSON) vira lista vazia dessa conexão (`send_get_request` devolve `None`), sem erro visível ao usuário final.
- O id do modelo escolhido vai no campo `model`; com `prefix_id`, o Open WebUI mostra `prefix.id` e remove o prefixo antes de enviar (`routers/openai.py:1471-1473`). Para o Thinker, `auto` e os modelos virtuais aparecem como qualquer outro id.
- Metadados de capacidade (visão, tools, `usage`) são configurados **no Open WebUI** por modelo, não lidos do `/models`.

### Cabeçalhos e sessão

- Cabeçalhos fixos em toda requisição de modelo: `Content-Type: application/json` e `Authorization`. Só para URL que contém `openrouter.ai` envia `HTTP-Referer` e `X-Title: Open WebUI`. **Não define `User-Agent` próprio**: usa o do aiohttp (`Python/3.x aiohttp/x.y`) (não confirmado o valor exato; nenhuma atribuição no código). (`utils/headers.py:181-194`)
- Com `ENABLE_FORWARD_USER_INFO_HEADERS=true` (padrão `False`) e usuário presente, envia `X-OpenWebUI-User-Name`, `-User-Id`, `-User-Email`, `-User-Role`, `X-OpenWebUI-Auth-Type` (`jwt` ou `api_key`) e, quando há `chat_id` nos metadados, **`X-OpenWebUI-Chat-Id`**. Com `FORWARD_USER_INFO_HEADER_JWT_SECRET` troca os quatro de usuário por um JWT HS256 em `X-OpenWebUI-User-Jwt`. Os nomes são configuráveis por `FORWARD_*`. (`utils/headers.py:49-77,196-199`; `env.py:999-1018`)
- `X-OpenWebUI-Message-Id` só é enviado a servidores de tools, não ao modelo (`utils/tools.py:196`; docs env-configuration).
- **Cabeçalhos customizados da conexão** (`headers` no JSON da conexão) são mesclados por último e aceitam placeholders: `{{CHAT_ID}}`, `{{MESSAGE_ID}}`, `{{USER_MESSAGE_ID}}`, `{{USER_MESSAGE_PARENT_ID}}`, `{{TASK}}`, `{{MODEL_ID}}`, `{{USER_ID}}`, `{{USER_NAME}}`, `{{USER_EMAIL}}`, `{{USER_ROLE}}`, `{{USER_GROUPS}}`, `{{USER_GROUP_IDS}}`, `{{USER_AGENT}}`, `{{AUTH_TYPE}}`, `{{FILE_*}}`. O valor é percent-encoded após a substituição. (`utils/headers.py:120-168`; exemplo oficial em `docs/ecosystem/computer/automate/open-webui.md`: `X-OpenWebUI-Chat-Id`, `-Message-Id`, `-User-Message-Id`, `-User-Message-Parent-Id`, `-Task`; os três últimos exigem 0.10.0+)
- Conclusão para o Thinker: `x-session-key: {{CHAT_ID}}` nos cabeçalhos da conexão dá uma sessão por conversa, sem depender de `ENABLE_FORWARD_USER_INFO_HEADERS` e sem expor dados do usuário. `{{TASK}}` permite distinguir requisições utilitárias (valor não verificado; ver "Recursos usados").
- Sem cabeçalho de subagente: os sub-agentes multi-modelo (v0.13.0) são chamados internamente com o mesmo chat; não há cabeçalho de sessão-mãe (não confirmado).

### Outros endpoints

- Contra o gateway: `GET {url}/models` e `POST {url}/chat/completions` (ou `/responses` com `api_type: responses`). Nada de token counting, health ou telemetria para o gateway. (`routers/openai.py:1405-1555,1808`)
- Quando o `TASK_MODEL` está vazio, os usos de fundo (título, tags, sugestões de follow-up, query de busca, autocompletar) usam o **mesmo modelo do chat** pelo mesmo caminho `/chat/completions` (`config.py:2232`). Há também endpoints de áudio, imagens e embeddings (`/audio/speech`, `/images/generations`, `/embeddings`) configuráveis separadamente com `*_OPENAI_API_BASE_URL` (herdam `OPENAI_API_BASE_URL`); só são usados se o recurso for ligado e apontado ao Thinker (`config.py:1098,1503,1576,1617`). O Thinker não oferece `/v1/embeddings` nem áudio (ver issues do Chatwoot #365/#366).
- Não há chamada de telemetria do Open WebUI para o gateway.

### Recursos usados

- Chat Completions com **streaming** (SSE) e não-streaming; o corpo é o `form_data` do cliente web após pré-processamento (system prompt, RAG/web como contexto, memórias). O campo `metadata` é removido antes do envio (`routers/openai.py:1425`).
- `stream_options: { include_usage: true }` é adicionado só se o modelo tem a capacidade `usage` ligada **e** `stream=true` (`main.py:1179-1180`); em requisições sem streaming é removido (`routers/openai.py:1566-1568`). Por padrão a capacidade é configurável por modelo no Open WebUI (padrão não confirmado). O Thinker precisa tolerar a ausência de `include_usage` e devolver o chunk final de `usage` quando pedido.
- Tool calling: modo "native" (function calling com `tools`/`tool_choice` no corpo) e modo padrão (prompt). Até 1024 rodadas de tool call por resposta (v0.13.0). Mensagens `tool` com conteúdo multimodal têm as imagens removidas no caminho Chat Completions (`routers/openai.py:1558-1564`).
- Parâmetros: `temperature`, `top_p`, `max_tokens` (convertido para `max_completion_tokens` apenas em modelos "novos" da OpenAI e revertido para `api.openai.com` ausente), `reasoning_effort`, `seed`, `stop`, `logit_bias`, `frequency_penalty`, `presence_penalty` e passthrough de campos extras definidos pelo usuário por modelo (`routers/openai.py:1480-1500`). `logit_bias` é reescrito para JSON.
- `user` no corpo só aparece como objeto `{name,id,email,role}` quando o modelo é um *pipeline* (`routers/openai.py:1478-1486`); chamadas normais não enviam `user`.
- Imagens (visão) como `image_url` base64 no conteúdo; arquivos viram texto via RAG no próprio Open WebUI.
- Reasoning: interpreta blocos `reasoning_content` / tags de raciocínio da resposta (`reasoning_tags`).
- Compactação de contexto (v0.13.0): "reusa a estrutura do prompt da conversa" no pedido de resumo para aproveitar cache do provedor (release notes v0.13.0).

### Erros e retentativas

- **Sem retry próprio** no caminho do modelo (`grep retry` só trata cabeçalhos): erro HTTP do upstream é repassado ao chat como erro. Repassa os cabeçalhos `retry-after` e `retry-after-ms` do upstream (`routers/openai.py:1595,1646,1760`).
- Timeout total 300 s (`AIOHTTP_CLIENT_TIMEOUT`); em streaming há um limite de ociosidade `AIOHTTP_CLIENT_STREAM_IDLE_TIMEOUT` (`utils/session_pool.py:38-52`; `env.py:598`). Uma resposta de erro com `content-type: text/event-stream` e status >= 400 é lida como corpo de erro e devolvida com o status (`routers/openai.py:1590-1600`).
- Não faz fallback entre conexões. Erro de conexão em `/models` vira lista vazia, e `HTTPException 500 "Open WebUI: Server Connection Error"` quando se consulta uma conexão específica.
- Recomendação para o Thinker: erros no formato `{"error": {"message": ...}}` (o Open WebUI exibe `error.message`), status 4xx claro para modelo inexistente.

### Snippet de setup do Thinker

Não existe. O Thinker não tem snippet nem seção de guia para o Open WebUI (ver G1). Conexão recomendada, como o contrato aceita:

1. Admin > Connections > OpenAI API > Add: URL `http://<thinker>:2099/v1` (`host.docker.internal` se o Open WebUI roda em Docker e o Thinker no host), chave `thk_...`.
2. Cabeçalhos customizados da conexão (JSON): `{"x-session-key": "{{CHAT_ID}}"}`.
3. Model IDs: vazio (usa `/models` do Thinker) ou `auto` e os virtuais.
4. Opcional: definir `TASK_MODEL`/`TASK_MODEL_EXTERNAL` para um modelo barato, para que título/tags/follow-ups não usem o modelo principal.

Equivalente por ambiente: `OPENAI_API_BASE_URL=http://host.docker.internal:2099/v1` e `OPENAI_API_KEY=thk_...`.

## Como o Thinker implementa hoje

- Superfície: Chat Completions (`packages/shared/src/agent-type.ts:84`). Plataforma `open-webui` em `AGENT_PLATFORMS` (`agent-type.ts:34`), exibida como "Open WebUI" (`:110`), categoria `automation` (`:130`, junto com n8n, Zapier, Langflow e Chatwoot), ícones em `:145` e `:166`. No catálogo da CLI: `packages/cli/src/provider-catalog.gen.ts:248-249` (`chat_completions`).
- **Sem snippet e sem guia**: `PLATFORM_SETUP_SNIPPETS` só tem openclaw, claude-code, nanobot, codex e n8n (`packages/shared/src/setup-snippets.ts:112-119`); não há componente `*Setup.tsx` do Open WebUI em `packages/frontend/src/components/` e `docs/usuario/conectar-harnesses.md` não cita o Open WebUI (o n8n é tratado em `:133`).
- Sessão: só `x-session-key` é lido (`packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`; `proxy-session-scope.ts:22-37`). Sem o cabeçalho a sessão é `default`, sem `providerCacheKey` nem `momentumKey`. Nenhum código lê `X-OpenWebUI-Chat-Id` (grep em `packages/backend/src` e `packages/shared/src`). Não existe `harness-session.ts` nesta árvore.
- Classificação do chamador: `caller-classifier.ts:35-66` usa `User-Agent`, `Referer`, `X-Title` e `x-stainless-*`; o Open WebUI não envia nada disso para um host que não seja OpenRouter, então a atribuição fica vazia ou com o UA do aiohttp.
- `GET /v1/models` existe (`proxy.controller.ts:176`) e devolve o formato OpenAI com `auto` e virtuais; é o que o Open WebUI consome.
- Streaming com `stream_options.include_usage` é tratado nos clientes de provedor (`provider-endpoints.ts:45-84`); a entrada aceita o campo (`provider-client-converters.ts:125`).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/cli/src/provider-catalog.gen.ts`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O Open WebUI não tem snippet (`PLATFORM_SETUP_SNIPPETS`), componente de setup nem seção em `conectar-harnesses.md`. Quem conecta segue o fluxo genérico: sem `x-session-key: {{CHAT_ID}}` nos cabeçalhos da conexão, toda conversa cai na sessão `default` (sem afinidade de cache nem momentum). Sugestão: snippet/guia com URL com `/v1`, `host.docker.internal`, chave `thk_`, cabeçalho de sessão e dica de `TASK_MODEL`. | frontend-dev | [#385](https://github.com/patrickbrandao/thinker/issues/385) | aberta |
| G2 | degradação | O Open WebUI envia `X-OpenWebUI-Chat-Id` (com `ENABLE_FORWARD_USER_INFO_HEADERS=true`) e pode enviar `{{CHAT_ID}}`/`{{TASK}}` por cabeçalho customizado, mas o Thinker só lê `x-session-key`. Mesma causa do #318: o `proxy.controller.ts:277,899` precisa aceitar cabeçalhos de sessão de harnesses como fallback. Sugestão: incluir `X-OpenWebUI-Chat-Id` na lista de fallback. | backend-dev | [#318](https://github.com/patrickbrandao/thinker/issues/318) (mesma causa) | resolvida (sessão de prompt cache e momentum lida dos cabeçalhos do harness) |
| G3 | oportunidade | Requisições utilitárias do Open WebUI (título, tags, follow-ups) usam o modelo do chat e chegam ao Thinker como chats normais; `X-OpenWebUI-Task` (via `{{TASK}}`) permitiria classificá-las, rotear para modelo barato ou marcá-las nos logs. Também `X-OpenWebUI-User-*` (se ligado) permitiria atribuir uso por usuário final. | backend-dev | — | aberta |
| G4 | oportunidade | Sem `User-Agent` próprio nem `X-Title`, o `caller-classifier.ts` não identifica o Open WebUI. Alternativa: reconhecer pelo cabeçalho `X-OpenWebUI-Chat-Id`/`-User-Id` quando presente. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra o fonte da tag `v0.13.0` (`routers/openai.py`, `utils/headers.py`, `env.py`, `config.py`, `main.py`, `utils/session_pool.py`) e os docs `open-webui/docs` @ 5b95953. Identificação confirmada, fontes semente corretas (acrescentado o repositório de docs). Aberta G1 (#385); G2 vinculada ao #318; G3 e G4 como oportunidade, sem issue. Pendente de checagem ao vivo: User-Agent real, valores de `{{TASK}}` e padrão da capacidade `usage`.
