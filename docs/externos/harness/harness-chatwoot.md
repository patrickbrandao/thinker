---
id: harness-chatwoot
categoria: harness
entidade: Chatwoot
agente: harness-chatwoot
thinker_ids: [chatwoot]
revisado_em: 2026-11-03
versao_observada: chatwoot v4.19.1 (commit bbe3454, develop 2026-11-04)
---

# Chatwoot (harness)

Especificação mantida pelo agente `harness-chatwoot` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Identificação: o harness é o **Chatwoot** (`chatwoot/chatwoot`), plataforma open source de atendimento ao cliente (alternativa ao Intercom/Zendesk). As fontes semente estavam corretas; confiança alta. Não é um agente de código: o "harness" é o **Captain**, o módulo de IA do Chatwoot (edição enterprise/cloud no código `enterprise/`), que chama um endpoint estilo OpenAI.
- Configuração é **global por instalação**, feita em Super Admin > App Configs > Captain (`CAPTAIN_OPEN_AI_API_KEY`, `CAPTAIN_OPEN_AI_ENDPOINT`, `CAPTAIN_OPEN_AI_MODEL`, `CAPTAIN_EMBEDDING_MODEL`), não por variável de ambiente. Uma única chave `thk_` serve a instalação inteira (todas as contas/inboxes caem no mesmo agente do Thinker).
- O endpoint recebe a **origem sem `/v1`**: o Chatwoot acrescenta `/v1`. Colar `http://host:2099/v1` gera `/v1/v1/...`.
- Superfície: Chat Completions (com `tools` e `response_format`), mais **embeddings** (`/v1/embeddings`) e **transcrição de áudio** (`/v1/audio/transcriptions`). O Thinker não tem as duas últimas rotas (G1, G2).
- Não envia nenhum cabeçalho de sessão nem permite configurar cabeçalhos customizados: o Thinker sempre cai na sessão `default`.
- Gaps: G1, G2, G3 (issues #365, #366, #367).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Chatwoot repository | <https://github.com/chatwoot/chatwoot> | tag `v4.19.1` (2026-10-24); `develop` commit bbe3454 (2026-11-04), clone raso |
| Developer docs | <https://developers.chatwoot.com/> | não consultada (API de canais/webhooks, sem contrato de LLM); contrato tirado do fonte |
| Captain docs (link do README) | <https://chwt.app/captain-docs> | não lida (não confirmado); o fonte é a autoridade |

Fonte primária usada: `config/installation_config.yml`, `config/initializers/ai_agents.rb`, `lib/llm/config.rb`, `lib/llm/feature_router.rb`, `lib/llm/models.rb`, `lib/captain/base_task_service.rb`, `lib/captain/responses_config.rb`, `enterprise/app/services/llm/*`, `enterprise/app/services/captain/llm/embedding_service.rb`, `config/llm.yml`, `Gemfile.lock` (ruby_llm 2.0.0, ruby-openai 7.3.1, ai-agents 0.13.0).

## Contrato

### Configuração do gateway

- Onde: Super Admin (`/super_admin/app_configs?config=captain`) > Captain. Campos: `CAPTAIN_OPEN_AI_API_KEY` (segredo), `CAPTAIN_OPEN_AI_ENDPOINT` (opcional; padrão `https://api.openai.com/`), `CAPTAIN_OPEN_AI_MODEL` (padrão `gpt-6-luna`), `CAPTAIN_EMBEDDING_MODEL` (padrão `text-embedding-3-small`). O `.env.example` diz explicitamente que chave e endpoint do Captain **não** vêm do `.env`. (`config/installation_config.yml`, `.env.example`, v4.19.1/develop)
- Formato do endpoint: origem sem `/v1`. O código faz `"#{endpoint.chomp('/')}/v1"` (`config/initializers/ai_agents.rb`, `lib/llm/config.rb`, `lib/captain/base_task_service.rb`), e o ruby-openai (`OpenAI::Client uri_base`) também prefixa `/v1`. Exemplo para o Thinker: `http://<host>:2099`. Se rodar em contêiner, o host precisa ser alcançável de lá.
- Chave: Bearer padrão (`Authorization: Bearer <thk_...>`) dos clientes RubyLLM/ruby-openai.
- Há também `CAPTAIN_OPENROUTER_API_KEY` + `CAPTAIN_OPENROUTER_DECISION_MODEL_ENDPOINT` (exemplo `https://openrouter.ai/api`) para o classificador e monitores de conversa; endpoint separado e também configurável (pode apontar ao Thinker; superfície não verificada, não confirmado).

### Seleção de modelo

- Padrão da instalação: texto livre em `CAPTAIN_OPEN_AI_MODEL`; cada feature (`Llm::FeatureRouter`) pode ter modelo próprio em `config/llm.yml` e overrides por conta. A lista do seletor do painel é a de `config/llm.yml` (gpt-5.x/6.x; Claude e Gemini marcados `coming_soon`), não vem de `GET /v1/models`. (`lib/llm/models.rb`, `config/llm.yml`)
- Nenhuma chamada a `GET /v1/models` do endpoint configurado foi encontrada no código do Captain (o registro vem do arquivo `config/llm_models.json`, gerado por `rake ruby_llm:refresh_models`). Consequência: o modelo virtual `auto` do Thinker só pode ser usado via campo livre do Super Admin; se o RubyLLM rejeita ids ausentes do registro (`ModelNotFound`) ainda não foi verificado ao vivo (não confirmado).
- Ids que o Chatwoot conhece como `openai` (via `Llm::Models.provider_for`) e, com endpoint **igual a `https://api.openai.com`**, ativam o protocolo Responses e `reasoning_effort`. Com endpoint customizado (caso Thinker) `standard_openai_endpoint?` é falso: fica em Chat Completions, sem `thinking`. (`lib/captain/responses_config.rb`, `lib/llm/feature_router.rb:28`)
- `temperature` é omitida para modelos que o registro marca como sem suporte.

### Cabeçalhos e sessão

- Nenhum cabeçalho de sessão, de subagente ou de versão foi encontrado nos serviços de LLM (grep por `header`/`X-` em `lib/captain`, `lib/llm`, `enterprise/app/services/llm`, `config/initializers/ai_agents.rb`). O `User-Agent` é o padrão do cliente Ruby/Faraday (não confirmado ao vivo).
- Não há campo para cabeçalhos customizados, portanto o usuário **não consegue** enviar `x-session-key`. O Chatwoot manda `metadata` de instrumentação (`api_protocol`, `reasoning_effort`) só para modelos openai (ver `request_metadata`); é para observabilidade (Langfuse/OTel), não para o provedor. (`lib/captain/responses_config.rb`)

### Outros endpoints

| Endpoint (relativo a `<endpoint>/v1`) | Uso | Origem |
|---|---|---|
| `POST /chat/completions` | Captain: assistente, copilot, tarefas (resumo, reescrita, rótulos, tradução), com `tools` e, quando necessário, `response_format: {type: 'json_object'}` ou `json_schema` | `lib/llm/config.rb`, `base_ai_service.rb`, `base_task_service.rb` |
| `POST /embeddings` | embeddings de artigos/FAQ para busca semântica (`RubyLLM.embed`, `CAPTAIN_EMBEDDING_MODEL`) | `captain/llm/embedding_service.rb` |
| `POST /audio/transcriptions` | transcrição de áudio de mensagens (multipart, `temperature: 0.0`, modelo da feature `audio_transcription`) | `llm/speech_to_text_service.rb` |
| `POST /chat/completions` (texto→fala via chat) | anúncio de chamadas: usa `client.chat`, não `/audio/speech` | `llm/text_to_speech_service.rb` |

Falhas de embedding levantam `EmbeddingsError` (log "Embedding API Error"); indexação e busca de artigos param de funcionar. Não há fallback para outro provedor: o endpoint é único.

### Recursos usados

- Chat Completions com streaming opcional (RubyLLM), tool calling (ai-agents SDK com `openai_protocol = :chat_completions`), JSON mode (`json_object`), imagens e anexos (o `OpenAiMessageBuilderService` monta conteúdo multimodal e transcrição), reasoning só com endpoint OpenAI padrão.
- O Chatwoot limpa cercas markdown em respostas JSON (`sanitize_json_response`), então gateways que embrulham JSON em ```` ``` ```` são toleráveis.
- Cache de prompt, compactação e subagentes paralelos: não se aplicam.

### Erros e retentativas

- Erros do RubyLLM/ruby-openai viram mensagens de erro do Captain; o código de status 401 é usado quando a chave não está configurada (`captain.api_key_missing`). Política de retry do RubyLLM 2.0 (padrão da gem) não foi inspecionada (não confirmado). Para o Thinker: devolver 4xx claros e 429/5xx com `retry-after`.

### Snippet de setup do Thinker

Não existe snippet nem guia. Valores corretos hoje, para o Super Admin do Chatwoot (Captain):

| Campo | Valor |
|---|---|
| OpenAI API Key | chave `thk_...` do harness |
| OpenAI API Endpoint | `http://<host>:2099` (sem `/v1`) |
| OpenAI Model | `auto` ou o nome de um modelo virtual |
| Embedding Model | modelo que o Thinker **não** serve (ver G1); deixe a funcionalidade desligada ou use outro endpoint |

## Como o Thinker implementa hoje

- Plataforma `chatwoot` em `AGENT_PLATFORMS` (`packages/shared/src/agent-type.ts:33`), superfície `chat_completions` (`:83`), nome `Chatwoot` (`:109`), categoria `automation` (`:130`), ícone `/icons/chatwoot.svg` (`:144`). Registrada no catálogo do CLI (`packages/cli/src/provider-catalog.gen.ts:244`).
- Sem snippet dedicado: `PLATFORM_SETUP_SNIPPETS` (`packages/shared/src/setup-snippets.ts:112-119`) só cobre openclaw, claude-code, nanobot, codex, n8n; sem componente de setup de frontend específico (só `N8nSetup`, `SetupStepAddProvider.tsx:100`). Sem menção em `docs/usuario/conectar-harnesses.md` (a regra geral da linha 133 manda usar `.../v1`, que não serve ao Chatwoot).
- Rotas expostas em `packages/backend/src/routing/proxy/proxy.controller.ts`: `@Controller('v1')` (`:146`), `GET models` (`:176`), `POST chat/completions` (`:246`), `responses` (`:254`), `messages` (`:262`). Não há `embeddings` nem `audio/transcriptions` (grep em `packages/backend/src`).
- Sessão: só `x-session-key` é lido (`proxy.controller.ts:277`, `:899`; `proxy-session-scope.ts`). Sem o cabeçalho, a chave é `default`: todo o tráfego do Chatwoot (todas as contas e conversas) compartilha uma sessão, sem `providerCacheKey` nem `momentumKey`. Não há classificação por `User-Agent` para o Chatwoot em `caller-classifier.ts`.
- O Chat Completions do Thinker cobre o caminho principal do Captain (tools, JSON mode, streaming).

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/cli/src/provider-catalog.gen.ts`
- `docs/usuario/conectar-harnesses.md`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Captain gera embeddings em `POST /v1/embeddings`; o Thinker não tem a rota (indexação/busca de artigos e FAQ falham) | providers / backend-dev | [#365](https://github.com/patrickbrandao/thinker/issues/365) | resolvida (POST /v1/embeddings em passthrough) |
| G2 | degradação | Transcrição de áudio em `POST /v1/audio/transcriptions`; o Thinker não tem a rota | providers / backend-dev | [#366](https://github.com/patrickbrandao/thinker/issues/366) | resolvida (POST /v1/audio/transcriptions em passthrough) |
| G3 | degradação | Endpoint deve ser a origem sem `/v1`; sem snippet nem guia, colar `.../v1` dá 404 (`/v1/v1`) | frontend-dev | [#367](https://github.com/patrickbrandao/thinker/issues/367) | resolvida (guia e snippet com endpoint sem /v1) |
| G4 | oportunidade | Sem cabeçalho de sessão e sem campo de cabeçalhos customizados: toda a instalação do Chatwoot cai na sessão `default`. Possível uso: roteamento por chave `thk_` por conta, ou classificar o chamador pelo `User-Agent` | backend-dev | — (sem issue) | aberta |
| G5 | oportunidade | Tratar `CAPTAIN_OPENROUTER_DECISION_MODEL_ENDPOINT` (classificador/monitores) como segunda superfície a apontar ao Thinker; formato não verificado | providers | — (sem issue) | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa (chatwoot v4.19.1, develop bbe3454). Harness identificado como Captain do Chatwoot; contrato extraído do fonte; G1-G5 registradas, issues #365-#367. Pendente verificação ao vivo: aceitação de ids de modelo fora do registro, `User-Agent` real, política de retry do RubyLLM, conteúdo dos docs do Captain.
