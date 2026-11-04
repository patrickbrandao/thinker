---
id: local-lmstudio
categoria: local
entidade: LM Studio
agente: local-lmstudio
thinker_ids: [lmstudio]
revisado_em: 2026-11-03
versao_observada: docs 2026-11-03; lms CLI 0.4.1 (commit 43d4b26, 2026-10-14)
---

# LM Studio (runtime local)

Especificação mantida pelo agente `local-lmstudio` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O LM Studio serve três superfícies na mesma porta (1234): API REST nativa (`/api/v1/*`, mais a antiga `/api/v0/*`), API compatível com OpenAI (`/v1/*`, incluindo `/v1/responses` e `/v1/embeddings`) e API compatível com Anthropic (`POST /v1/messages`).
- Autenticação é opcional e desligada por padrão (exige LM Studio 0.4.0+ para ligar): com "Require Authentication", token via `Authorization: Bearer` (ou `x-api-key` no endpoint Anthropic).
- O servidor escuta só em `127.0.0.1` por padrão; `lms server start --bind 0.0.0.0` (ou `LMS_SERVER_HOST`) e o toggle "Serve on Local Network" expõem na rede. CORS fica desligado, salvo `--cors`.
- Carregamento JIT vem ligado: o primeiro request a um modelo baixado o carrega (TTL ocioso padrão de 60 min, `ttl` em segundos no payload); auto-evict mantém no máximo um modelo JIT.
- Mudança relevante desde o corte (primeira revisão): o changelog público de lmstudio.ai agora lista releases de um produto chamado "Bionic" (1.1.1 a 1.1.10, 2026-08-31 a 2026-10-29) que coexiste com o LM Studio (exige LM Studio 0.4.26+) e compartilha o `lms`. Não é claro se é produto separado; ver Lacunas e "o que precisa de checagem ao vivo".
- Pesquisa em fontes documentais; as páginas foram lidas via resumo automático, então detalhes finos de parâmetros ficam `(não confirmado)` onde indicado.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Developer docs (REST, OpenAI and Anthropic compatibility) | <https://lmstudio.ai/docs/developer> | lido em 2026-11-03 |
| Changelog | <https://lmstudio.ai/changelog> | "Bionic 1.1.10", 2026-10-29 (sem entradas de API server do LM Studio no trecho lido) |
| Blog (release posts) | <https://lmstudio.ai/blog> | não lido (sem necessidade nesta revisão) |
| lms CLI repository | <https://github.com/lmstudio-ai/lms> | `package.json` 0.4.1; HEAD `43d4b26` (2026-10-14, tag `release-57-86de38a` aparece nas tags, sem GitHub Releases) |
| lmstudio-js SDK repository | <https://github.com/lmstudio-ai/lmstudio-js> | `package.json` raiz 1.0.0 (tags `release-*`); não aprofundado |
| Páginas de docs usadas | `/docs/developer/rest/list`, `/openai-compat`, `/openai-compat/chat-completions`, `/openai-compat/tools`, `/openai-compat/responses`, `/anthropic-compat`, `/anthropic-compat/messages`, `/core/authentication`, `/core/ttl-and-auto-evict` | 2026-11-03 |

## Contrato

### Versões

- App LM Studio: a série 0.4.x é a atual (autenticação por token exige 0.4.0+; o changelog cita "LM Studio 0.4.26 e posterior" como requisito para coexistir com o Bionic). Número exato da última versão do app `(não confirmado)`: o changelog público lido só lista "Bionic".
- Cadência: o changelog mostra releases a cada 1 a 2 semanas (Bionic 1.1.1 em 2026-08-31 até 1.1.10 em 2026-10-29).
- Itens do changelog com efeito na API (Bionic 1.1.x, fonte: <https://lmstudio.ai/changelog>):
  - 1.1.2: `lms load --auto`; Chat API mantém imagem e texto numa única mensagem de usuário.
  - 1.1.4: streaming de argumentos de tool call (Chat Completions e Responses) para modelos locais e LM Link.
  - 1.1.8: novos `/v1/decisions` (compatível OpenAI) e `/v1/systemone`; gestão de "decision models" pela REST API.
- Quebras desde o corte: nenhuma identificada (não havia corte anterior).

### APIs

Base: `http://<host>:1234`. Tabela de superfícies:

| Superfície | Caminhos | Observações |
|---|---|---|
| OpenAI-compat | `GET /v1/models`, `POST /v1/chat/completions`, `/v1/completions` (legado), `/v1/embeddings`, `/v1/responses`, `/v1/decisions` | Docs: <https://lmstudio.ai/docs/developer/openai-compat>. Base URL do cliente: `http://localhost:1234/v1`. |
| Anthropic-compat | `POST /v1/messages` | Base URL do cliente sem `/v1` (`http://localhost:1234`); suporta streaming SSE (`message_start`, `content_block_delta`, `message_stop`) e tools (`input_schema`, `tool_choice`). `count_tokens`, `thinking` e campos não suportados: página não pôde ser lida por completo `(não confirmado)`. |
| REST nativa v1 | `POST /api/v1/chat`, `GET /api/v1/models`, `POST /api/v1/models/load`, `/unload`, `/download`, status de download | Chat com estado (`stateful-chats`) e eventos de streaming próprios. Caminhos exatos de load/unload/download `(não confirmado)`; apenas `/api/v1/chat` e `/api/v1/models` foram vistos literalmente. |
| REST nativa v0 | `/api/v0/*` (ex.: `/api/v0/models`, `/api/v0/chat/completions`) | Antiga, ainda documentada (<https://lmstudio.ai/docs/developer/rest/endpoints>). |

Parâmetros de `/v1/chat/completions` documentados: `model`, `messages`, `stream`, `stop`, `temperature`, `top_p`, `top_k`, `max_tokens`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `repeat_penalty`, `seed`. A página não documenta campos de `usage` nem saída de raciocínio. `/v1/responses` aceita `input`, `reasoning` (ex.: `{ "effort": "low" }`), `previous_response_id`, `stream` e, opt-in no app, tools remotas `type: "mcp"`. Codex funciona contra o LM Studio por causa de `/v1/responses`.

### Modelos e carregamento

- Listagem rica: `GET /api/v1/models` retorna `{ models: [...] }` com `type` (`llm` | `embedding` | `decision`), `key` (id, formato hub como `google/gemma-4-26b-a4b`), `display_name`, `architecture`, `quantization`, `size_bytes`, `params_string`, `loaded_instances[]` (com `id` e `config.context_length`, `parallel`, `flash_attention`, ...), `max_context_length`, `format` (`gguf` | `mlx`), `capabilities` (`vision`, `trained_for_tool_use`, `reasoning.allowed_options` em `off|on|low|medium|high` e `reasoning.default`), `variants`, `selected_variant`. Fonte: <https://lmstudio.ai/docs/developer/rest/list>.
- `GET /v1/models` (OpenAI) lista modelos no formato OpenAI; se lista só os carregados ou todos os baixados não está dito na página lida `(não confirmado)`.
- JIT: ligado por padrão; o request a um modelo baixado e não carregado dispara o carregamento. TTL ocioso padrão 60 min para modelos JIT, renovado a cada request; campo `ttl` (segundos) no payload vale só quando o request causa o JIT, tanto na API OpenAI quanto na REST (exemplo da doc usa `/api/v0/chat/completions`). Modelos carregados com `lms load` não têm TTL por padrão; `lms load <modelo> --ttl <s>`.
- Auto-evict: ligado por padrão, no máximo um modelo JIT em memória; configurável em Developer > Server Settings.
- Parâmetros de carga na CLI (`lms load`, fonte: lms `src/subcommands/load.ts`, commit `43d4b26`): `--ttl`, `--gpu`, `--context-length`, `--identifier`, `--auto`. Pela API, a configuração por instância aparece em `loaded_instances[].config`; como o cliente define o contexto ao carregar via API `(não confirmado)`.

### Capacidades por família de modelo

- Tool calling: via `/v1/chat/completions` ou `/v1/responses` no formato OpenAI. O LM Studio parseia o texto do modelo em `tool_calls`; se não conseguir, a saída vai em `content`. Suporte "nativo" (template com tools) citado para Qwen2.5, Llama 3.1/3.2 e Mistral/Ministral; os demais usam o modo "default" (prompt de sistema genérico, mensagens `tool` convertidas em `user`). Fonte: <https://lmstudio.ai/docs/developer/openai-compat/tools>. Streaming de argumentos desde Bionic 1.1.4.
- Raciocínio: `capabilities.reasoning` (modelos que o expõem) com opções `off/on/low/medium/high`. O campo de saída (`reasoning_content`) não aparece nas páginas lidas `(não confirmado)`.
- Visão: `capabilities.vision`; Chat Completions aceita texto e imagem.
- Embeddings: `type: "embedding"` na listagem, servidos em `/v1/embeddings`; não são modelos de chat.

### Rede e Docker

- Porta padrão 1234. Bind padrão `127.0.0.1`; `lms server start --bind <endereço>` (ou `LMS_SERVER_HOST`) muda; `0.0.0.0` aceita conexões da rede. `--cors` habilita CORS e a CLI avisa que qualquer site visitado passa a poder usar o servidor. Fonte: lms `src/subcommands/server.ts`, commit `43d4b26`.
- Docker: um container não alcança `127.0.0.1` do host; é preciso `--bind 0.0.0.0` ou o toggle "Serve on Local Network" (Developer). CORS não é necessário para chamadas servidor a servidor do Thinker.
- Autenticação: desligada por padrão. Em "Developer > Server Settings > Require Authentication" todas as chamadas REST e SDK exigem token, criado em "Manage Tokens" (exibido uma vez, com permissões editáveis). Cabeçalho `Authorization: Bearer <token>`; o endpoint Anthropic também aceita `x-api-key`. Fonte: <https://lmstudio.ai/docs/developer/core/authentication>.

### Novidades aproveitáveis

- `POST /v1/messages` nativo: Claude Code e clientes Anthropic podem falar direto com o LM Studio sem tradução.
- `/v1/responses` nativo com `previous_response_id` e `reasoning.effort`.
- `ttl` por request para controlar o descarregamento de modelos carregados via JIT.
- `/api/v1/models` com contexto real da instância carregada, capacidades e estado carregado (ver G1).
- `GET /api/v1/models` pode servir de checagem de saúde com contexto (já usado no teste de conexão).

## Como o Thinker implementa hoje

- Tipo de servidor local configurável: `LOCAL_SERVER_TYPES = ['ollama','lmstudio','llamacpp']`, cada servidor vira uma linha de custom provider com `local_type` (`packages/backend/src/common/constants/local-servers.ts:116`). Defaults do LM Studio: porta 1234, `healthPath` e `modelsPath` `/api/v1/models`, env `THINKER_LMSTUDIO_BASE_URL` (`local-servers.ts:151-158`). O comentário sobre defaults cita "checado 2026-10-31" (`local-servers.ts:~133-150`).
- Modo canônico (provedor `lmstudio`, sem custom provider): base URL `http://<alias do host>:1234`, sobrescrita por `THINKER_LMSTUDIO_BASE_URL`; override inválido é ignorado com aviso; `/v1` final é removido (`local-servers.ts:7-12`, `getLocalServerBaseUrl`). Timeouts padrão: request 600 000 ms (carga fria de modelo), sonda 10 000 ms (`local-servers.ts:~180-184`).
- Chat: endpoint `lmstudio` usa `localServerEndpoint('lmstudio')` com formato `openai` e `Authorization: Bearer` apenas se houver chave (`packages/backend/src/routing/proxy/provider-endpoints.ts:103-111`, `:599`; `buildLocalServerHeaders` em `local-servers.ts`). Thinker não usa `/v1/messages`, `/v1/responses`, `/api/v1/chat` nem o campo `ttl`.
- Id do modelo: enviado como está (`qwen/qwen3-8b`), sem remover prefixo de fornecedor (`packages/backend/src/routing/proxy/provider-client.ts:355-358`).
- Descoberta de modelos: `GET <base>/v1/models`, parser OpenAI (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:1041-1046`); `lmstudio` consta na lista de provedores com capacidades em `model-capabilities.ts:24`.
- Sonda de conexão: tenta `GET /api/v1/models` e cai para `/api/v0/models`; extrai `max_context_length`, `loaded_instances[0].config.context_length`, `trained_for_tool_use`, `vision`, `reasoning` e o estado carregado; descarta embeddings/arquiteturas não-chat (`packages/backend/src/routing/custom-provider/local-server-probe.ts:197-270`, regex `EMBEDDING_NAME` e `NON_CHAT_ARCH` perto de `:32-38`). Dica de início: `lms server start --port <porta>` (`local-server-probe.ts:~44`).
- Dica de setup no frontend: `lms server start`, e para Docker `lms server start --bind 0.0.0.0 --port 1234 --cors`, GUI "Serve on Local Network", `persistsBindAcrossLaunches: true` (`packages/shared/src/providers.ts:592-602`, `LOCAL_SERVER_HINTS`). A flag `--cors` é desnecessária para o Thinker e amplia a exposição (ver G2).
- Registro do provedor: `id: 'lmstudio'`, aliases `lm-studio`, `lm studio`, `localOnly`, `tileOnly`, sem chave obrigatória (`packages/shared/src/providers.ts:370-381`).
- Egress/proxy: `LOCAL_PROVIDERS` inclui `lmstudio` (`packages/backend/src/proxy-servers/proxy-egress.service.ts:32`); `stream-warmup.ts` e `cost-calculator.ts` também referenciam locais (custo zero).

Pontos no código:

- `packages/backend/src/common/constants/local-servers.ts`
- `packages/shared/src/providers.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/custom-provider/local-server-probe.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`

Arquivos que citam `lmstudio`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/proxy-servers/proxy-egress.service.ts`
- `packages/backend/src/routing/custom-provider/custom-provider.service.ts`
- `packages/backend/src/routing/dto/custom-provider.dto.ts`
- `packages/backend/src/routing/proxy/stream-warmup.ts`
- `packages/backend/src/common/utils/cost-calculator.ts`
- `packages/backend/src/common/utils/provider-availability.ts`
- `packages/backend/src/common/utils/private-url-policy.ts`
- `packages/frontend/src/components/LocalServerForm.tsx`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/api/routing.ts`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | A descoberta de modelos lê `GET /v1/models` (só ids) enquanto `GET /api/v1/models` traz `type`, `max_context_length`, contexto da instância carregada, `vision`, `trained_for_tool_use` e `reasoning`. O teste de conexão já usa o endpoint rico; o catálogo de roteamento não. Mudar: usar `/api/v1/models` com fallback para `/v1/models`, filtrar `type !== 'llm'`, preencher contexto e capacidades (`provider-model-fetcher.service.ts:1042`). | `providers` | [#316](https://github.com/patrickbrandao/thinker/issues/316) | aberta |
| G2 | oportunidade | Dica de Docker manda `--cors`, que o Thinker (servidor a servidor) não precisa e que, segundo a própria CLI, deixa qualquer site visitado usar o servidor. Sugestão: remover `--cors` de `dockerBindCommand` (`providers.ts:~598`), manter `--bind 0.0.0.0` e avisar sobre ligar autenticação ao expor na rede. | `frontend-dev` | — (oportunidade, sem issue no piloto) | aberta |
| G3 | oportunidade | Endpoints nativos não usados: `POST /v1/messages` (Anthropic), `POST /v1/responses` (com `previous_response_id`) e `ttl` por request. Poderiam evitar tradução para clientes Claude Code/Codex e controlar descarregamento. | `providers` | — | aberta |
| G4 | oportunidade | Exposição de `reasoning.allowed_options` (`off/on/low/medium/high`) na UI e mapeamento de `reasoning_effort` para o LM Studio; a sonda já detecta `reasoning` mas só como flag booleana (`local-server-probe.ts:~245`). | `providers` | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa (docs lidas em 2026-11-03; lms commit `43d4b26`). Contrato preenchido, G1 (issue #316) e oportunidades G2 a G4 registradas. Observação: o changelog de lmstudio.ai agora lista "Bionic 1.1.x"; pendente checagem ao vivo do que isso significa para o LM Studio.
