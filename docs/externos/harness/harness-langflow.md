---
id: harness-langflow
categoria: harness
entidade: Langflow
agente: harness-langflow
thinker_ids: [langflow]
revisado_em: 2026-11-03
versao_observada: langflow v1.13.0 (commit 63082cf, 2026-10-22); langflow-ai/langflow, lfx-openai 0.2.0, lfx-openai-compatible 0.2.0
---

# Langflow (harness)

Especificação mantida pelo agente `harness-langflow` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- **Identificação:** o projeto é o Langflow da `langflow-ai/langflow` (construtor visual de fluxos e agentes em Python, sobre LangChain). Identificação confiante: o repositório e o site `docs.langflow.org` batem com a seed. Ambas as fontes da seed estavam corretas, nenhuma foi trocada.
- **Superfície:** só **Chat Completions** (`POST {base}/chat/completions`, mais `GET {base}/models` para descoberta). O tráfego sai do **servidor** Langflow (processo Python), via `langchain_openai.ChatOpenAI` / SDK `openai`, nunca do navegador do usuário. Não há suporte a `/v1/messages` pelo componente OpenAI; Anthropic tem componente próprio com `ChatAnthropic`.
- **Duas formas de apontar para o Thinker:** (1) provedor global **OpenAI Compatible** (`OPENAI_COMPATIBLE_BASE_URL` + `OPENAI_COMPATIBLE_API_KEY`) usado pelos componentes Language Model e Agent; (2) componente legado **OpenAI** com o campo `OpenAI API Base` (ou o provedor global OpenAI com `OPENAI_BASE_URL`).
- **Armadilha principal:** a proteção SSRF do Langflow (ligada por padrão) **bloqueia** hosts privados (RFC1918, link-local), e o componente OpenAI legado exige `https` e bloqueia até loopback. Um Thinker em `http://localhost:2099` ou em IP de LAN falha na primeira tentativa, a menos que o operador exporte `LANGFLOW_SSRF_ALLOWED_HOSTS`. O Thinker não tem guia nem snippet para isso (G2).
- **Sessão:** o Langflow **não envia nenhum cabeçalho de sessão** nem de identificação própria; todo tráfego cai na sessão `default` do Thinker (G1, mesma causa de #380).
- Confiança: alta no código (tag v1.13.0 lida); média nos comportamentos de `langchain-openai` (dependência externa, não lida aqui; ver [harness-langchain](harness-langchain.md)).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Langflow repository | <https://github.com/langflow-ai/langflow> | v1.13.0 (publicada 2026-10-22), commit `63082cf9a9c0e5bbeda12bba0aa9e0b05ffffe6a` |
| Docs (fontes `docs/docs` no repositório, mesma tag) | <https://docs.langflow.org/> | v1.13.0 (`bundles-openai-compatible.mdx`, `api-keys-and-authentication.mdx`) |
| Dossiê relacionado: comportamento do `ChatOpenAI` | [harness-langchain.md](harness-langchain.md) | 2026-11-03 |

Releases recentes: 1.13.0 (2026-10-22), 1.12.8 (2026-10-22), 1.12.7, 1.12.6, 1.12.5 (2026-10-06). Cadência alta (semanal). Pacote de PyPI `langflow`; imagem `langflowai/langflow`.

## Contrato

### Configuração do gateway

Todos os caminhos abaixo são feitos no servidor Langflow.

| Caminho | Onde se configura | Variáveis / campos | Observação |
|---|---|---|---|
| **OpenAI Compatible** (recomendado) | Settings > Model Providers > OpenAI Compatible; ou ambiente do servidor | `OPENAI_COMPATIBLE_BASE_URL` (obrigatória), `OPENAI_COMPATIBLE_API_KEY` (opcional) | Se a base não termina em `/v1`, o Langflow acrescenta `/v1` (`base_url_suffix`). A chave vai como `Authorization: Bearer`. Sem chave, o SDK recebe o placeholder `EMPTY`. |
| **OpenAI** (provedor global) | Model Providers > OpenAI | `OPENAI_API_KEY`, `OPENAI_BASE_URL` (opcional) | `localhost` é reescrito para `host.docker.internal` (ou gateway) quando o Langflow roda em contêiner (`transform_localhost_url`). |
| Componente **OpenAI** (legado, bundle `lfx-openai`) | campo avançado `OpenAI API Base` | `api_key`, `openai_api_base` | Padrão `https://api.openai.com/v1`. Caminho **estrito**: ver SSRF abaixo. |

Fontes: `src/bundles/openai-compatible/src/lfx_openai_compatible/extension.json`; `src/lfx/src/lfx/base/models/unified_models/instantiation.py` (suffix `/v1`, `EMPTY`, `transform_localhost_url`); `src/bundles/openai/src/lfx_openai/components/openai/openai_chat_model.py` (tag v1.13.0).

**Proteção SSRF e HTTPS (relevante para o Thinker):**

- Ligada por padrão (`LANGFLOW_SSRF_PROTECTION_ENABLED=True`). Bloqueia RFC1918, link-local/metadata e loopback conforme o caminho. Libera por `LANGFLOW_SSRF_ALLOWED_HOSTS` (hosts, IPs, CIDR, `*.dominio`), separados por vírgula. Fonte: `lfx/services/settings/groups/security.py`, `lfx/utils/ssrf_protection.py`.
- **Componente OpenAI legado** usa a política estrita (`provider_ssrf.openai_compatible_client_kwargs`): loopback literal bloqueado e `http://` só passa se o host estiver em `LANGFLOW_SSRF_ALLOWED_HOSTS`; senão levanta `ValueError` pedindo https. Ou seja, `http://localhost:2099/v1` falha sem allowlist.
- **Provedores globais (OpenAI Compatible / OpenAI com `OPENAI_BASE_URL`)** usam a política de conector (`ssrf_protected_openai_clients_for_url`, `ssrf_safe_httpx_get`): loopback literal é **permitido por padrão** (`LANGFLOW_CONNECTOR_SSRF_ALLOW_LOOPBACK=True`), RFC1918 bloqueado, sem exigência de https no código. A página de docs `bundles-openai-compatible.mdx` diz o contrário (que loopback é bloqueado e exige allowlist); a divergência entre docs e código v1.13.0 não foi resolvida `(não confirmado: precisa de teste ao vivo)`. Em qualquer caso, um Thinker em IP de LAN ou rede Docker (172.x, 192.168.x) exige `LANGFLOW_SSRF_ALLOWED_HOSTS`.
- Chave vinda do ambiente do servidor só pode ir a destino aprovado em `LANGFLOW_PROVIDER_CREDENTIAL_ALLOWED_HOSTS` (aplica-se a chaves provisionadas pelo operador, não a chaves coladas na UI).

### Seleção de modelo

- **Provedor OpenAI Compatible / OpenAI com base custom:** o Langflow faz `GET {base}/models` (timeout de 5 s no OpenAI Compatible, sem redirecionamento) com `Authorization: Bearer` e lê `data[].id` (aceita também lista simples). Todos os ids viram modelos de **Language Model e Embedding Model**, com `tool_calling` assumido verdadeiro para LLM. Os dois primeiros ficam como padrão. Falha de rede ou parse vira lista vazia, silenciosamente. O usuário precisa **habilitar** os modelos descobertos no painel Model Providers. Ao salvar, valida com `GET /v1/models` (401/403 vira "Authentication failed"). Fontes: `lfx_openai_compatible/discovery.py`; `base/models/model_utils.py:fetch_live_openai_compatible_models`.
- **Componente OpenAI legado:** dropdown com ids fixos da OpenAI (`openai_constants.py`) em modo `combobox`, ou seja, aceita digitar um id livre (como `auto`). Não consulta `/models`.
- Nomes esperados: nenhum formato; qualquer id devolvido por `/models` é aceito. `auto` e modelos virtuais do Thinker funcionam como id literal.

### Cabeçalhos e sessão

- Cabeçalhos enviados: os do SDK `openai` (`Authorization: Bearer <chave>`, `User-Agent: OpenAI/Python <versão>`, `x-stainless-*`). **Nenhum** cabeçalho de sessão, de fluxo, de usuário ou de versão do Langflow é enviado.
- O `session_id` do Langflow (id da conversa do Playground) existe só dentro do grafo (`model.py` usa `graph.session_id` para armazenar mensagens) e **não** é propagado ao provedor.
- Cabeçalhos custom: o componente OpenAI legado e o provedor OpenAI Compatible **não expõem** campo de cabeçalhos (só o provedor OpenRouter tem variáveis `is_header` para `HTTP-Referer`/`X-Title`). O componente de embeddings tem `Default Headers`, mas isso é embeddings. Para mandar `x-session-key` o usuário precisaria de um componente customizado ou de `Model Kwargs` (campo `model_kwargs` do componente legado, repassado ao `create`; que o SDK aceite `extra_headers` por ali é `(não confirmado)`).
- Telemetria própria do Langflow vai para o backend da Langflow (Segment, v1.13.0), não ao gateway.

### Outros endpoints

- `GET {base}/models` (descoberta e validação, descritos acima). Se falhar, o provedor aparece sem modelos; o componente legado continua funcionando.
- Chamada de teste de credencial do provedor OpenAI (`credentials.py`): `ChatOpenAI.invoke("test")` com `max_tokens=1` ao salvar a chave quando há `OPENAI_BASE_URL`.
- **`/v1/responses` por remediação:** apenas para o provedor `OpenAI`, se a resposta 400 contiver as mensagens "function tools with reasoning_effort are not supported" ou "use function tools, use /v1/responses", o Langflow refaz a chamada com `use_responses_api=True` (`model_remediation.py`). O Thinker serve `/v1/responses` (Codex), então o caminho existe.
- Remediação adicional: erro com "temperature ... not supported/deprecated" reenvia sem `temperature`.
- Não usa `count_tokens`, embeddings só se o usuário usar o componente de embeddings (`POST {base}/embeddings`, ver gaps de #365 no dossiê do Chatwoot), nem áudio.

### Recursos usados

- Chat Completions com `messages`, `temperature` (padrão 0.1 no componente legado), `seed` (padrão 1 no componente legado; omitidos para modelos de raciocínio), `max_tokens`, `response_format: {"type":"json_object"}` (opção JSON Mode), `model_kwargs` livre.
- Agent component: tool calling (`tools`, `tool_calls`) via LangChain `bind_tools`; streaming SSE quando o fluxo é executado no Playground/API com stream.
- `stream_usage`: o componente legado e o provedor `OpenAI`/`Anthropic` passam `stream_usage=True`. O provedor **OpenAI Compatible** não passa (só `OpenAI` e `Anthropic` entram em `kwargs["stream_usage"]`), e o `ChatOpenAI` Python não liga `stream_usage` sozinho com `base_url` custom (ver harness-langchain). Resultado provável: sem `usage` no streaming do lado do Langflow. O Thinker injeta `stream_options.include_usage` no pedido ao provedor por conta própria quando o endpoint suporta, então o custo no Thinker não depende disso.
- Sem prompt caching explícito, sem imagens, sem compaction, sem subagentes. Execuções paralelas de fluxos geram requisições concorrentes ao mesmo agente Thinker.

### Erros e retentativas

- Componente legado: `max_retries=5` (padrão) e `timeout=700` s, repassados ao `ChatOpenAI` (que repassa ao SDK `openai`; o SDK repete 408, 409, 429 e 5xx com backoff). Embeddings: `max_retries=3`.
- Mensagens de erro: para `NotFoundError` com `code == model_not_found` o Langflow troca o texto por uma mensagem sobre conta OpenAI; para `BadRequestError` mostra `body.message`. Outros erros aparecem como texto no Chat Output.
- Remediações automáticas descritas em "Outros endpoints".

### Snippet de setup do Thinker

O Thinker **não tem** snippet nem seção de guia para o Langflow (a plataforma existe como tipo `automation`, sem entrada em `PLATFORM_SETUP_SNIPPETS`). Receita correta para v1.13.0:

1. No ambiente do servidor Langflow, se o Thinker não estiver em HTTPS público: `LANGFLOW_SSRF_ALLOWED_HOSTS=<host do Thinker>` (hostname, IP ou CIDR; sem esquema e sem porta).
2. Settings > Model Providers > **OpenAI Compatible**: **Base URL** `http://<host>:2099/v1` (o `/v1` é acrescentado se faltar) e **API Key** `thk_...`. Salvar valida `GET /v1/models`.
3. Habilitar os modelos descobertos (`auto` e os virtuais) e escolher um no Language Model ou Agent.
4. Dentro de contêiner, `localhost` é reescrito para `host.docker.internal`; o Thinker precisa estar acessível nessa rota.

## Como o Thinker implementa hoje

Verificado no código em 2026-11-03.

- O tipo `langflow` existe só como metadado: lista de plataformas `packages/shared/src/agent-type.ts:32`, superfície `chat_completions` em `:82`, rótulo `:108`, categoria `automation` em `:130`, ícone `:143`.
- **Sem snippet de setup:** `PLATFORM_SETUP_SNIPPETS` (`packages/shared/src/setup-snippets.ts:111`) só tem `openclaw`, `claude-code`, `nanobot`, `codex` e `n8n` (`getN8nSnippet`, `:102`). Nada para `langflow`. O frontend não menciona o Langflow além do ícone/rótulo.
- **Sem guia:** `docs/usuario/conectar-harnesses.md:133` cita Vercel AI SDK, LangChain, n8n e cURL na superfície Chat Completions (base `http://localhost:2099/v1`, chave `thk_`), mas não o Langflow nem o requisito de `LANGFLOW_SSRF_ALLOWED_HOSTS`.
- **Sessão:** o Thinker só lê o cabeçalho `x-session-key` (`packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:899`, via `buildProxySessionScope` em `proxy-session-scope.ts`). Sem o cabeçalho a sessão é `default` e não há `providerCacheKey` nem momentum. `provider-hooks.ts` só repassa cabeçalhos de sessão **ao provedor** (`x-grok-conv-id`, `x-session-id` do OpenRouter, `x-opencode-session`), não lê cabeçalhos de entrada. Não existe `harness-session.ts` neste worktree.
- **Identificação do chamador:** `caller-classifier.ts` reconhece `User-Agent: OpenAI/<lang> <versão>` como `openai-python` (`:97-100`). O Langflow chega assim, sem marca própria; o harness é identificado só pela chave `thk_` do agente.
- **Listagem de modelos:** `GET /v1/models` em formato OpenAI com `auto` e modelos virtuais (`proxy.controller.ts:176`), compatível com o que o Langflow lê (`data[].id`).
- **Streaming usage:** `provider-client.ts:919-925` injeta `stream_options.include_usage` no pedido ao provedor quando o endpoint declara `openai_stream_options`.
- **Responses:** o Thinker serve `/v1/responses`, o que cobre a remediação `use_responses_api` do Langflow (`provider` `OpenAI`).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | O Langflow não envia cabeçalho de sessão e nenhum componente padrão deixa configurar cabeçalhos custom; o guia do Thinker não ensina `x-session-key`. Toda chamada cai na sessão `default` (sem cache de provedor nem momentum). Mesma causa de #380 (LangChain/`openai` SDK), tratada lá; solução no Thinker é documentar, ou aceitar um id de sessão alternativo se algum harness passar a enviar. | frontend-dev | [#380](https://github.com/patrickbrandao/thinker/issues/380) (comentado) | aberta |
| G2 | degradação | Sem snippet nem guia do Langflow. O setup padrão `http://localhost:2099/v1` ou IP de LAN falha na proteção SSRF (e, no componente legado, na exigência de https) até o operador exportar `LANGFLOW_SSRF_ALLOWED_HOSTS`; o usuário só descobre pela mensagem de erro do Langflow. | frontend-dev | [#388](https://github.com/patrickbrandao/thinker/issues/388) | resolvida (guia e snippet com LANGFLOW_SSRF_ALLOWED_HOSTS) |
| G3 | oportunidade | O provedor OpenAI Compatible do Langflow não liga `stream_usage`; o Langflow não mostra tokens em streaming. Se o Thinker devolvesse sempre o chunk final de `usage` em streaming de Chat Completions (mesmo sem `stream_options` do cliente), clientes assim ganhariam contadores. Verificar se o Thinker já faz isso. | backend-dev | — (oportunidade) | aberta |
| G4 | oportunidade | `GET /v1/models` do Thinker só traz `id`/`object`; o Langflow assume `tool_calling` para todo modelo e oferece cada um também como embedding. Nada a fazer no Thinker hoje; registrar caso o Langflow passe a ler capacidades (`?capabilities=true` já existe no Thinker). | backend-dev | — (oportunidade) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra `langflow-ai/langflow` v1.13.0 (clone raso da tag, só leitura). Seed confirmada (nenhuma fonte trocada). Contrato escrito; lacunas G1 a G4; G1 vinculada a #380, G2 aberta como #388.
