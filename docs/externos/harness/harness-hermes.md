---
id: harness-hermes
categoria: harness
entidade: Hermes Agent
agente: harness-hermes
thinker_ids: [hermes]
revisado_em: 2026-11-03
versao_observada: hermes-agent v0.22.7 (commit 9302ba9e)
---

# Hermes Agent (harness)

Especificação mantida pelo agente `harness-hermes` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Hermes Agent (Nous Research, MIT, Python) é um agente de CLI/TUI/gateway de mensageria. Identificação confirmada: o repositório `NousResearch/hermes-agent` é o projeto certo (release `v0.22.7`, 2026-11-03).
- Fala com o Thinker como provedor "custom" OpenAI-compatible, em Chat Completions (`transport: chat_completions`). Também sabe falar `anthropic_messages` e `codex_responses` com endpoints custom, mas o snippet do Thinker usa só Chat Completions.
- Não envia identificador de sessão ao provedor por padrão. Só envia se a entrada do provedor declarar `session_affinity_header`. O snippet do Thinker não declara, então toda requisição cai na sessão `default` (lacuna G1, issue #378).
- Os cabeçalhos `X-Hermes-Session-Id` / `X-Hermes-Session-Key` que o esqueleto do dossiê citava são de ENTRADA do API server do próprio Hermes (Hermes como servidor), não são enviados ao Thinker. O esqueleto estava errado.
- O snippet atual (`model:` com `provider: custom`) está correto e é o formato documentado.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Hermes Agent repository (código, confirmado como fonte certa) | <https://github.com/NousResearch/hermes-agent> | v0.22.7, commit 9302ba9e (2026-11-03) |
| Docs no repositório: providers (Custom & Self-Hosted) | `website/docs/integrations/providers.md` | v0.22.7 |
| Docs no repositório: configuração e timeouts | `website/docs/user-guide/configuration.md` | v0.22.7 |
| Docs no repositório: `providers:`, `session_affinity_header` | `website/docs/user-guide/configuring-models.md` | v0.22.7 |
| Docs no repositório: API server (entrada, só referência) | `website/docs/user-guide/features/api-server.md` | v0.22.7 |
| Código: cabeçalhos de afinidade | `agent/opencode_affinity.py`, `hermes_cli/config_providers.py` | v0.22.7 |

Release cadence: patch a cada poucos dias a semanas (`v0.22.4` 2026-10-21, `v0.22.5` 2026-10-23, `v0.22.6` 2026-11-02, `v0.22.7` 2026-11-03). O site público de docs (hermes-agent.nousresearch.com) não foi consultado; a fonte foi a pasta `website/docs` do repositório na tag.

## Contrato

### Configuração do gateway

Fonte: `website/docs/integrations/providers.md` (seção Custom & Self-Hosted), v0.22.7.

- Superfície: qualquer endpoint com `/v1/chat/completions`. `config.yaml` (em `~/.hermes/`, aberto por `hermes config edit`) é a fonte da verdade.
- Bloco mínimo: `model.provider: custom`, `model.base_url` (inclui `/v1`; um `host:port` puro ganha `/v1` automaticamente nas variantes locais), `model.api_key` ou `model.key_env`, `model.default` (id do modelo).
- `LLM_MODEL` do `.env` foi removido; `OPENAI_BASE_URL` só vale para o provedor `openai-api`.
- Forma nomeada (várias rotas): `providers.<nome>` com `api` (alias `base_url`/`url`), `api_key`/`key_env`/`key_cmd`, `transport` (`chat_completions` | `anthropic_messages` | `codex_responses`), `default_model`, `models`, `context_length`, `discover_models`, `extra_body`, `extra_headers`, `session_affinity_header`, `ssl_ca_cert`/`ssl_verify`, `catalog_provider`, `enabled`. Seleção com `model.provider: custom:<nome>` ou `/model custom:<nome>:<modelo>`. A lista antiga `custom_providers:` ainda é lida e migrada (config v12; `model` vira `default_model`, `api_mode` vira `transport`).
- Wizard: `hermes model` -> "Custom endpoint" pede base URL, chave, nome do modelo e (nas versões atuais) o modo de API e o context length. Não existe comando `hermes onboard` confirmado nas fontes lidas `(não confirmado)`.

### Seleção de modelo

- O id vem de `model.default` (ou `providers.<nome>.default_model`), mudado em sessão com `/model custom[:<nome>]:<modelo>`.
- `/model custom` sem nome consulta `GET <base>/models` e seleciona automaticamente se houver exatamente um modelo. O seletor lista os modelos descobertos em `/models`, mais os `models` configurados. `discover_models: false` desliga a consulta.
- Janela de contexto, em ordem: `model.context_length` (pin), `providers.<nome>.models.<id>.context_length`, cache persistente, `GET /models` do endpoint, depois metadados externos (Anthropic, OpenRouter, models.dev) e por fim 128K. Chaves lidas do item de `/models`: `context_length`, `context_window`, `context_size`, `max_context_length`, `max_model_len`, `max_input_tokens` e outras (`agent/model_metadata.py:420`). Saída máxima: `max_completion_tokens`, `max_output_tokens`, `max_tokens`.
- O Hermes consulta metadados externos (OpenRouter, models.dev) por conta própria; isso é tráfego do cliente, não do Thinker.

### Cabeçalhos e sessão

- User-Agent padrão: o do SDK OpenAI para Python. Relays atrás de WAF que rejeitam esse UA exigem `extra_headers` (o Hermes sugere `User-Agent: HermesAgent/1.0`). Para alguns hosts conhecidos o Hermes injeta cabeçalhos próprios (`agent/agent_init.py:974`), mas não para um Thinker custom.
- Sessão: nenhum cabeçalho de sessão é enviado a um endpoint custom por padrão ("nunca envia um identificador de sessão a quem não pediu"). Opt-in por entrada `providers.<nome>.session_affinity_header: <NOME-DO-CABEÇALHO>`; o valor é o escopo de conversa do Hermes (raiz da conversa, estável na compactação e em árvores de delegação), normalizado, igual em chamadas auxiliares (compressão, título, visão). Fonte: `website/docs/user-guide/configuring-models.md`, `agent/opencode_affinity.py:114-143`. Se `model:` com `provider: custom` e `base_url` direto também casa com a rota para esse recurso, `(não confirmado)`; a documentação só mostra a forma `providers:`.
- Para endpoints OpenCode o Hermes sempre envia `x-opencode-session`; para xAI, `x-grok-conv-id`; OpenRouter, `session_id` sticky. Nenhum se aplica ao Thinker.
- `X-Hermes-Session-Id` e `X-Hermes-Session-Key`: cabeçalhos aceitos pelo API server do Hermes (`gateway/platforms/api_server*.py`, docs `api-server.md`). São de ENTRADA (cliente do Hermes) e não saem para o provedor.
- Cache: o Hermes adiciona `prompt_cache_key` (endereçado por conteúdo) só quando o endpoint declara suporte (`supports_prompt_cache_key`, padrão falso; host `api.openai.com` implica suporte) (`agent/transports/chat_completions.py:77-116`, `:257`). Para o Thinker custom, normalmente não é enviado `(não confirmado)`.

### Outros endpoints

- `GET /models`: usado para descoberta e metadados (acima). Falha não é fatal; recai nos `models` configurados e nos metadados externos.
- Sem chamada a `/v1/embeddings`, `/v1/messages/count_tokens` ou telemetria no caminho do provedor custom nas fontes lidas `(não confirmado para plugins opcionais)`. Existe o recurso opcional de embeddings em chamadas auxiliares (`key_cmd` cita "embedding"), `(não confirmado)` se usa o provedor principal.

### Recursos usados

- Chat Completions com `tools` (function calling), streaming, `reasoning_effort` (padrão `medium` quando nada configurado; o valor configurado chega inalterado até `max`, só o `ultra` interno vira `max`), `extra_body` por provedor (mesclado em cada requisição), imagens nativas (`image_url`) quando `model.supports_vision: true`, role `developer` no lugar de `system` para modelos GPT-5/Codex (`chat_completions.py:366`).
- Compactação de contexto própria do Hermes (chamadas auxiliares ao mesmo provedor/modelo por padrão, `auxiliary.*.provider: auto`) e tarefas auxiliares (título, visão, MoA) que geram requisições extras e paralelas sem identificação de papel.
- Compactação nativa OpenAI (`openai_native_compaction`) é opt-in e envia o histórico ao endpoint configurado; fora do escopo do snippet.

### Erros e retentativas

- `agent.api_max_retries` (padrão 3, 4 tentativas) para 429, quedas de conexão e 5xx antes de acionar fallback. Respeita `Retry-After` (cabeçalho ou campo `retry_after` no corpo) (`agent/retry_utils.py:30,185`). 429 de cota comum falha rápido; só casos específicos (Z.AI 1305) têm espera maior.
- Timeouts: chamada não-streaming 1800 s; stream "stale" 180 s (até 900 s em endpoints locais); não-streaming stale 90 s. Configuráveis por provedor (`request_timeout_seconds`, `stale_timeout_seconds`). Um Thinker que demore a emitir o primeiro evento (fallback encadeado) pode estourar 180 s em prompts grandes; manter keep-alive SSE ajuda.
- 403 com página de bloqueio é tratado como firewall/CDN, não como chave inválida; 401 como credencial inválida (`agent/error_classifier.py`).
- Fallback entre provedores configurado no próprio Hermes (`fallback_providers`).

### Snippet de setup do Thinker

O snippet atual está correto para Chat Completions e tem sintaxe válida na v0.22.7:

```yaml
model:
  provider: custom
  base_url: http://localhost:2099/v1
  api_key: thk_SUA_CHAVE
  default: auto
```

Forma recomendada (resolve G1):

```yaml
providers:
  thinker:
    api: http://localhost:2099/v1
    api_key: thk_SUA_CHAVE
    session_affinity_header: x-session-key
model:
  provider: custom:thinker
  default: auto
```

`hermes config edit` abre o `config.yaml` (confirmado em `user-guide/configuration.md`). A aba "Hermes onboard" do dashboard executa na verdade `hermes model` (rótulo impreciso, G2).

## Como o Thinker implementa hoje

- Superfície: Chat Completions (`packages/shared/src/agent-type.ts:76`, `hermes: 'chat_completions'`); nome de exibição `Hermes Agent` (`agent-type.ts:102`); categoria `personal` (`agent-type.ts:129`); ícone `/icons/hermes.svg` (`agent-type.ts:137`).
- Snippet de setup: `packages/frontend/src/components/HermesSetup.tsx:25-26` (YAML com `model.provider: custom`, `base_url`, `api_key`, `default: auto`); abas "Configuration file" (`hermes config edit`, `HermesSetup.tsx:58`) e "Hermes onboard" que mostra `hermes model` (`HermesSetup.tsx:51,102`).
- Guia do usuário: `docs/usuario/conectar-harnesses.md:82-100` (mesmo YAML) e `:145` (troca de modelo via `default`).
- Sessão: o proxy só lê `x-session-key` (`packages/backend/src/routing/proxy/proxy.controller.ts:277` e `:900`, via `buildProxySessionScope` em `proxy-session-scope.ts:17`). Não há leitura de `x-hermes-session-id` / `x-hermes-session-key` em nenhum arquivo (grep em `packages/backend/src` não encontra "hermes" no roteamento). O que o esqueleto descrevia como "cabeçalhos de sessão `x-hermes-session-*` lidos em `proxy.controller.ts` e `provider-hooks.ts`" é incorreto: `provider-hooks.ts:41-66` só repassa o `sessionKey` já extraído de `x-session-key` a provedores (OpenCode, xAI, OpenRouter). O agrupamento por sessão (`harness-session.ts`) existe apenas em outra sessão de desenvolvimento, fora da `main`.
- `GET /v1/models`: `proxy.controller.ts:176`; `auto` e modelos virtuais publicam `context_length` (smallest window) (`proxy.controller.ts:94`, `:203-207`), o que o Hermes aproveita via `/models`. Modelos reais só com `?capabilities=true`.
- Classificação do chamador: `packages/backend/src/routing/proxy/caller-classifier.ts` (sem regra específica de Hermes). Peeling de envelope de prompt: `packages/backend/src/scoring/envelope-peeler.ts:4` cita Hermes como agente que embrulha o prompt.
- Dica de modelos virtuais: `packages/frontend/src/components/VirtualModelsHint.tsx:54` (`hermes model`); textos em `packages/frontend/src/i18n/locales/{en,pt-BR}/harnesses.ts:270-275` e `models.ts:174`.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/proxy-session-scope.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/backend/src/scoring/envelope-peeler.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/HermesSetup.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Hermes só envia cabeçalho de sessão se `providers.<nome>.session_affinity_header` estiver configurado; o snippet usa só `model:` e o Thinker lê apenas `x-session-key`, então toda requisição cai em `default`. Sugestão: snippet com `providers.thinker` e `session_affinity_header: x-session-key`. Arquivos: `HermesSetup.tsx`, `conectar-harnesses.md`. Mesmo sintoma de #318, #320 e #369, causa diferente (aqui é configuração do cliente). | frontend-dev | [#378](https://github.com/patrickbrandao/thinker/issues/378) | aberta |
| G2 | oportunidade | A aba "Hermes onboard" executa `hermes model` (wizard "Custom endpoint"); não há `hermes onboard` confirmado. Renomear o rótulo e, no wizard, orientar também o campo de context length. Sem issue. | frontend-dev | — | aberta |
| G3 | oportunidade | O Hermes lê `context_length` do `/models` e do `models.<id>` por entrada; o Thinker publica `context_length` só para `auto` e virtuais. Publicar também para modelos reais (ou sugerir `models.<id>.context_length` no snippet) evitaria cair em 128K ou sondagem por erro. Depende do ADR 0004. Sem issue. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-03: primeira revisão completa contra `hermes-agent` v0.22.7 (commit 9302ba9e). Projeto confirmado. Corrigido o esqueleto: `X-Hermes-Session-*` são cabeçalhos de entrada do API server, não saem para o Thinker; sessão de saída é opt-in via `session_affinity_header`. Aberta a issue #378 (G1).
