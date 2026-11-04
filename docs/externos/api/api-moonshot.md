---
id: api-moonshot
categoria: api
entidade: Moonshot (Kimi API)
agente: api-moonshot
thinker_ids: [moonshot]
revisado_em: 2026-11-04
versao_observada: docs platform.kimi.ai 2026-11-04 (kimi-k3.1-pro, kimi-k3, K2.6/K2.7-code)
---

# Moonshot (Kimi API) (acesso por API)

Especificação mantida pelo agente `api-moonshot` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md). A assinatura Kimi Code é outro dossiê (`sub-moonshot`).

## Resumo

- A documentação migrou: `platform.moonshot.ai` responde 301 para `platform.kimi.ai`. A API continua em `https://api.moonshot.ai` (os exemplos oficiais usam `https://api.moonshot.ai/v1`).
- Linha atual: **K3** (`kimi-k3`, `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`), contexto de 1M tokens, thinking sempre ligado, controlado por `reasoning_effort`. A **série K2** (`kimi-k2.6`, `kimi-k2.7-code`, 256K) deixa de estar disponível para novos usuários a partir de 2026-10-31 e será aposentada até o fim de dezembro de 2026.
- Três protocolos: Chat Completions, Responses e Anthropic Messages (`/anthropic/v1/messages`).
- Parâmetros de amostragem são fixos no servidor; K3 manda omiti-los (G2).
- O Thinker já fala Chat Completions, descobre modelos via `/v1/models` e preserva `reasoning_content`. Faltam preços de K3 e tratamento dos parâmetros fixos (G1, G2).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Platform docs (overview) | <https://platform.kimi.ai/docs/overview> (antes `platform.moonshot.ai`) | 2026-11-04 |
| Pricing | <https://platform.kimi.ai/docs/pricing/chat> (e `chat-k3.md`, `chat-k2.md`) | 2026-11-04; tabelas de preço não renderizam via fetch |
| API overview (endpoints) | <https://platform.kimi.ai/docs/api/overview.md> | 2026-11-04 |
| Erros | <https://platform.kimi.ai/docs/api/errors.md> | 2026-11-04 |
| List models | <https://platform.kimi.ai/docs/api/list-models.md> | 2026-11-04 |
| Guias de modelo | `guide/kimi-k3-1-pro-quickstart.md`, `kimi-k3-quickstart.md`, `kimi-k2-6-quickstart.md` | 2026-11-04 |
| Limites | <https://platform.kimi.ai/docs/pricing/limits.md> | 2026-11-04; tabela de tiers vazia |

## Contrato

### Endpoints e protocolos

Fonte: API overview, 2026-11-04.

- Base URL: `https://api.moonshot.ai` (OpenAI: `/v1`; Anthropic: `/anthropic`). Não há menção a `.cn` nas docs lidas; o domínio chinês `api.moonshot.cn` é uma conta separada (não confirmado).
- Auth: `Authorization: Bearer <chave>` (variável sugerida `MOONSHOT_API_KEY`). Chaves do console `platform.kimi.ai` (as do Kimi Code são outro produto).
- Endpoints:

| Endpoint | Método | Protocolo |
|---|---|---|
| `/v1/chat/completions` | POST | OpenAI Chat Completions |
| `/v1/responses` | POST | OpenAI Responses |
| `/anthropic/v1/messages` | POST | Anthropic Messages |
| `/v1/models` | GET | lista de modelos |
| `/v1/tokenizers/estimate-token-count` | POST | estimativa de tokens |
| `/v1/users/me/balance` | GET | saldo |
| `/v1/files` (POST/GET, `/{id}`, `/{id}/content`) | | upload (limite 100MB), usado por vídeo e imagem `ms://` |
| `/v1/batches` (+ cancel) | | batch com 60% do preço para `kimi-k3.1-pro` e `kimi-k3` |
| `/v1/tools/search`, `/search_pro`, `/fetch` | POST | ferramentas Kimi (busca web não recomendada em produção) |

- Extensões Kimi: `thinking` passa pelo corpo (no SDK, `extra_body`); `partial: true` fica na mensagem assistant, não no topo.

### Modelos

- `GET /v1/models` retorna `{object:"list", data:[...]}`; cada item tem `id`, `object`, `created`, `owned_by`, `context_length`, `supports_image_in`, `supports_video_in`, `supports_reasoning`. 401 retorna `error.message` (+ `type`, `code`).

| Id | Contexto | Observações |
|---|---|---|
| `kimi-k3.1-pro` | 1.048.576 | carro-chefe; `max_completion_tokens` padrão 131072, máx 1048576 |
| `kimi-k3.1-pro-highspeed` | 1M (não confirmado) | mesmas capacidades, 2 a 3 vezes mais rápido |
| `kimi-k3` | 1.048.576 | geração anterior |
| `kimi-k2.7-code` | 262.144 | série K2, aposentadoria até dez/2026 |
| `kimi-k2.6` | 262.144 | série K2, `max_tokens` padrão 32768 |

- Aposentadoria: série K2 indisponível para novos cadastros desde 2026-10-31; retirada geral planejada até o fim de 2026-12. Ids `moonshot-v1-*` não aparecem nas docs atuais (aposentados, não confirmado).
- Os ids `k3`, `k3-256k`, `kimi-for-coding` são do Kimi Code (assinatura), não desta API.

### Capacidades

- Visão: K3, K3.1 Pro, K2.7-code e K2.6 aceitam texto, imagem e vídeo. `content` deve ser array. Imagem por data URL base64 ou `ms://<file-id>`; URL pública não é suportada. Vídeo: upload com `purpose="video"` e `video_url` `ms://<id>`.
- Reasoning:
  - K3 / K3.1 Pro: thinking sempre ligado, sem objeto `thinking`; `reasoning_effort` top-level `low` | `high` | `max` (padrão `max`).
  - K2.6 / K2.7-code: `thinking: {"type":"enabled"|"disabled"}` (padrão `enabled`). Com thinking e tools, `tool_choice` só pode ser `auto` ou `none`.
- Parâmetros fixos: `temperature` (K3: 1.0; K2.6: 1.0 com thinking, 0.6 sem), `top_p` 0.95, `n` 1, `presence_penalty` 0, `frequency_penalty` 0. K2 retorna erro para outros valores; K3 manda omitir.
- Multi-turno e tools: devolver a mensagem assistant completa, incluindo `reasoning_content` (em K2.6 omitir não dá erro, mas degrada a qualidade). `tool_choice:"required"` é aceito em K3 na primeira volta.
- Tools dinâmicas: mensagem `system` com `tools` e sem `content` (não retida no servidor, reenviar no histórico).
- Structured output / JSON Mode: suportado; ler só `message.content`.
- Prompt caching: automático, TTL padrão 5 min. K3 aceita `prompt_cache_options.ttl` (`5m` ou `1h`). `prompt_cache_key` não aparece nas páginas lidas (não confirmado).

### Streaming e uso

- Raciocínio chega em deltas `reasoning_content`, separado de `content`.
- Categorias cobradas: escrita de cache (5m e 1h), input hit, input miss, output. Nomes exatos dos campos de `usage` não documentados nas páginas lidas (não confirmado; o Thinker usa `openaiStreamUsage`).
- Erro 504 após 900 s sem resposta: usar `stream: true`.

### Preços

Página oficial `pricing/chat` não renderiza as tabelas via fetch. Valores abaixo vêm de agregadores e do texto da página K3 (não confirmado), por MTok:

| Modelo | Cache hit | Miss | Saída |
|---|---|---|---|
| `kimi-k3` | 0,30 | 3,00 | 15,00 |
| `kimi-k3.1-pro` | 0,20 | 2,00 | 10,00 |
| `kimi-k3.1-pro-highspeed` | 0,20 | 4,00 | 20,00 |

- Escrita de cache K3 cobrada por TTL (5m/1h); input em cache cobra só o preço de hit. Sem tiers por contexto (agregadores). Batch: 60% do preço padrão. Armazenamento e extração de arquivos temporariamente grátis. Preços sem impostos.
- Recarga mínima de US$1 para começar; US$5 acumulados dão voucher de US$5.

### Limites e erros

- Tiers por saldo acumulado (concorrência, RPM, TPM, TPD); a tabela não veio no fetch. Busca web tem QPS próprio (429 com `X-RateLimit-*`). Detecção de abuso aplica limitação irreversível.

| HTTP | `error.type` | Significado | Retentável |
|---|---|---|---|
| 400 | `invalid_request_error` / `content_filter` | requisição inválida, contexto excedido, filtro de segurança | não |
| 401 | `invalid_authentication_error` / `incorrect_api_key_error` | chave inválida ou ausente | não |
| 403 | `permission_denied_error` | API não liberada, IP fora da allowlist | não |
| 404 | `resource_not_found_error` | modelo inexistente ou sem acesso | não |
| 429 | `engine_overloaded_error` | sobrecarga | sim, backoff e `Retry-After` |
| 429 | `exceeded_current_quota_error` | saldo insuficiente ou conta desativada | não |
| 429 | `rate_limit_reached_error` | concorrência, RPM, TPM ou TPD | sim após espera |
| 499 | `client_closed_request` | cliente desconectou | condicional |
| 500 / 503 | `server_error`, `unexpected_output` / `server_unavailable` | falha do servidor | sim |
| 504 | gateway timeout | 900 s sem resposta | condicional (usar stream) |

## Como o Thinker implementa hoje

Estado conferido no código em 2026-11-04 (commit 2f97f17):

- Chat Completions em `https://api.moonshot.ai/v1/chat/completions` com `openaiHeaders` (Bearer) e `openaiStreamUsage` (`provider-endpoints.ts:432`, `:96`). Não usa `/responses` nem `/anthropic`.
- Descoberta: `https://api.moonshot.ai/v1/models` com `bearerHeaders` e `parseOpenAI` genérico (`provider-model-fetcher.service.ts:927`). Os campos `context_length`, `supports_image_in/video_in/reasoning` não são aproveitados pelo parser genérico (não confirmado).
- Cadastro: id `moonshot`, alias `kimi`, prefixo OpenRouter `moonshotai`, chave `sk-`, mínimo 30 caracteres (`packages/shared/src/providers.ts:321`). Inferência de provedor por regex `^kimi-|^moonshot-|^k3(-|$)` (`provider-inference.ts:17`). URL de criação de chave `https://platform.moonshot.ai/` (`provider-api-key-urls.ts:17`), que redireciona para `platform.kimi.ai`.
- Cache: `prompt_cache_key` com hash é enviado a `moonshot` (`provider-client.ts:943`). A doc lida só cita `prompt_cache_options.ttl` (não confirmado se o campo é aceito).
- Reasoning: `reasoning_content` é sempre preservado no endpoint nativo (`reasoning-format.ts:87`). Capacidades de modelo em `model-capabilities.ts:27`.
- Preços: `KNOWN_PRICES` só tem `moonshot-v1-` a 1,66 USD/MTok (`known-model-prices.ts:37`).
- Thinking Anthropic para OpenAI: `thinking.disabled` vira `reasoning_effort: none` (`provider-client.ts:307`); sem tratamento específico de K3 (G2).
- O modo assinatura (`moonshot-subscription`, `api.kimi.com/coding`, Anthropic Messages) pertence a `sub-moonshot` (issues #342, #344).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/backend/src/routing/routing-core/provider-param-spec.service.ts`
- `packages/backend/src/model-discovery/known-model-modalities.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Sem preço conhecido para `kimi-k3`, `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`, K2.x; `KNOWN_PRICES` só tem `moonshot-v1-`. Custo depende de catálogos públicos. Cache write K3 por TTL não modelado. | providers | [#419](https://github.com/patrickbrandao/thinker/issues/419) | aberta |
| G2 | degradação | Parâmetros fixos (`temperature`, `top_p`, `n`, penalties) e controle de raciocínio por família (`reasoning_effort` low/high/max em K3, `thinking` em K2, `tool_choice` restrito) sem tratamento para `moonshot`. | providers | [#420](https://github.com/patrickbrandao/thinker/issues/420) | aberta |
| G3 | oportunidade | Parser genérico ignora `context_length`, `supports_image_in`, `supports_video_in`, `supports_reasoning` de `/v1/models`, que dariam capacidades exatas sem tabela manual. | backend-dev | — | aberta |
| G4 | oportunidade | Suporte a `prompt_cache_options.ttl` (5m/1h) e ao endpoint `/anthropic/v1/messages` (cache e thinking nativos Anthropic); URL de chave ainda aponta para o domínio antigo `platform.moonshot.ai`. | providers | — | aberta |

Nota: a aposentadoria da série K2 (fim de 2026-12) não exige mudança, pois a lista de modelos é dinâmica; vale avisar usuários com rotas fixas em `kimi-k2.*`.

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Docs migradas para `platform.kimi.ai`; linha K3 (K3.1 Pro lançado) e aposentadoria da K2; contrato, lacunas G1-G4 e issues #419-#420. Preços confirmados só por fontes secundárias.
