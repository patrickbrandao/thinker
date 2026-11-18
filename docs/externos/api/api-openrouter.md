---
id: api-openrouter
categoria: api
entidade: OpenRouter
agente: api-openrouter
thinker_ids: [openrouter]
revisado_em: 2026-11-18
versao_observada: docs 2026-11-18 (revisão parcial: modelo de chaves de API; catálogo revisado em 2026-11-04)
---

# OpenRouter (acesso por API)

Especificação mantida pelo agente `api-openrouter` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

O OpenRouter é um agregador: uma chave `Authorization: Bearer` dá acesso a ~455 modelos de dezenas de fornecedores, com roteamento entre provedores, fallback e cobrança unificada sem acréscimo sobre o preço do fornecedor. O Thinker o usa só por Chat Completions (`/api/v1/chat/completions`) e também consome o catálogo público (ADR 0003). O que mudou de relevante: o endpoint serve também Responses e Anthropic Messages nativos para 382 modelos, `usage` agora vem sempre (parâmetros `usage.include` e `stream_options.include_usage` foram descontinuados), `X-OpenRouter-Title` substitui `X-Title` (o antigo segue aceito), há `expiration_date` por modelo e variantes `:batch`. A única lacuna relevante é o `thinking` da Anthropic Messages não virar `reasoning` (G1, issue #432). Revisão de 2026-11-18: o modelo de chaves (validade imutável, tetos com reset, guardrails por chave, allowlist de IP só por conta no Enterprise) está em "Chaves de API".

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://openrouter.ai/docs/quickstart> | 2026-11-04 |
| Models API | <https://openrouter.ai/api/v1/models> | 2026-11-04 (455 modelos, resposta lida direto) |
| API reference | <https://openrouter.ai/docs/api/reference/overview> | 2026-11-04 |
| Erros | <https://openrouter.ai/docs/api/reference/errors-and-debugging> | 2026-11-04 |
| Limites | <https://openrouter.ai/docs/api/reference/limits> | 2026-11-04 |
| Streaming | <https://openrouter.ai/docs/api/reference/streaming> | 2026-11-04 |
| Roteamento de provedores | <https://openrouter.ai/docs/guides/routing/provider-selection> | 2026-11-04 |
| Variantes de modelo | <https://openrouter.ai/docs/guides/routing/model-variants> | 2026-11-04 |
| Reasoning | <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens> | 2026-11-04 |
| Prompt caching | <https://openrouter.ai/docs/guides/best-practices/prompt-caching> | 2026-11-04 |
| Usage accounting | <https://openrouter.ai/docs/guides/administration/usage-accounting> | 2026-11-04 |
| Atribuição de app | <https://openrouter.ai/docs/app-attribution> | 2026-11-04 |
| Announcements | <https://openrouter.ai/announcements> | 2026-11-04 (última: 2026-10-30) |
| OpenAPI | <https://openrouter.ai/openapi.json> | lido via páginas da referência (`openapi.yaml` embutido), 2026-11-18 |
| Índice para LLMs | <https://openrouter.ai/docs/llms.txt> (e `/docs/_llms/docs.txt`, `/docs/_llms/api-reference.txt`); páginas em markdown com sufixo `.md` | 2026-11-18 |
| Autenticação | <https://openrouter.ai/docs/api_reference/authentication.md> | 2026-11-18 |
| API Keys (referência) | <https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key.md> (e list/get/update/delete/get-current) | 2026-11-18 |
| Chaves de gestão | <https://openrouter.ai/docs/guides/overview/auth/management-api-keys.md> | 2026-11-18 |
| Security settings (allowlist de IP) | <https://openrouter.ai/docs/guides/overview/auth/security-settings.md> | 2026-11-18 |
| Guardrails e políticas | <https://openrouter.ai/docs/guides/features/guardrails.md>, <https://openrouter.ai/docs/guides/features/guardrails/policies.md> | 2026-11-18 |
| Workspaces | <https://openrouter.ai/docs/guides/features/workspaces.md> | 2026-11-18 |
| Teto de chaves de agente | <https://openrouter.ai/docs/guides/best-practices/capping-shared-agent-keys.md> | 2026-11-18 |
| Rotação e auditoria | <https://openrouter.ai/docs/cookbook/administration/api-key-rotation.md>, <https://openrouter.ai/docs/cookbook/administration/api-key-audit.md> | 2026-11-18 |
| Log de entrada/saída | <https://openrouter.ai/docs/guides/features/input-output-logging.md> | 2026-11-18 |

## Contrato

### Endpoints e protocolos

- Base: `https://openrouter.ai/api/v1`. Autenticação: `Authorization: Bearer <chave>` ([overview](https://openrouter.ai/docs/api/reference/overview)). Sem seleção de região no host; roteamento regional (EUA ou UE) é por requisição/conta ("In-Region Routing", anúncio de 2026-09-09; forma exata não confirmada) e o filtro `region` existe no catálogo.
- Protocolos servidos: `POST /api/v1/chat/completions` (OpenAI-like), `POST /api/v1/responses` (descrito como forma primária), `POST /api/v1/messages` (Anthropic Messages) e `POST /api/v1/completions`. O campo `endpoints` de cada modelo do catálogo diz quais se aplicam: 382 de 455 modelos listam os quatro; `/api/v1/batches` aparece em 73, `/api/v1/images` em 10 e `/api/alpha/extractions` em 1 (lido em 2026-11-04).
- Outros: `GET /api/v1/generation?id=` (estatísticas e custo de uma requisição), `GET /api/v1/key` (saldo/limite da chave e uso diário dos modelos gratuitos).
- Cabeçalhos de atribuição (opcionais, [app-attribution](https://openrouter.ai/docs/app-attribution)): `HTTP-Referer` (URL do app, identificador único; sem ele não há página do app nem ranking), `X-OpenRouter-Title` (nome; `X-Title` segue aceito), `X-OpenRouter-Categories` (até 2 categorias minúsculas separadas por vírgula, ≤30 caracteres; inválidas são descartadas) e `X-OpenRouter-App-Visibility: hidden` (fora dos rankings públicos). Em localhost o título é obrigatório para rastrear.
- Roteamento de provedores: objeto `provider` no corpo: `order`, `only`, `ignore`, `allow_fallbacks` (padrão `true`), `require_parameters` (padrão `false`), `data_collection` (`allow`|`deny`), `zdr`, `enforce_distillable_text`, `quantizations`, `sort` (`price`|`throughput`|`latency`, ou objeto `by`/`partition`), `preferred_min_throughput`, `preferred_max_latency`, `max_price` ([provider-selection](https://openrouter.ai/docs/guides/routing/provider-selection)). `models: []` (lista de fallback entre modelos) existe, mas não está na página de parâmetros (não confirmado em detalhe).
- Afinidade de sessão: o OpenRouter mantém o mesmo provedor para pedidos seguintes por 10 minutos de inatividade, a fim de manter o cache quente; `session_id` (corpo) ou `x-session-id` (cabeçalho) fixa a sessão desde o primeiro pedido. Não vale com `provider.order` manual ([prompt-caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)).

### Modelos

- `GET /api/v1/models`: parâmetros opcionais de filtro/ordem (`output_modalities` padrão `text`, `supported_parameters`, `region`, `q`, `sort`, `limit` padrão 500 e máximo 1000, `offset`). A resposta traz `data`, `total_count` e `links.next`. A doc lista bearer global; se o endpoint funciona anônimo não está dito, mas o Thinker o consulta sem chave e a resposta foi obtida assim em 2026-11-04.
- Campos do modelo: `id`, `canonical_slug` (pode diferir do `id`; ex.: `tencent/hy4` -> `tencent/hy4-20261104`), `name` ("Fornecedor: Modelo"), `created`, `context_length`, `architecture` (`input_modalities`, `output_modalities`), `pricing`, `top_provider` (`context_length`, `max_completion_tokens`), `supported_parameters`, `default_parameters`, `endpoints`, `reasoning` (`mandatory`, `default_enabled`, `default_effort`, `supported_efforts`; ausente em modelos sem raciocínio), `expiration_date` (ISO, modelo pode sair depois dela), `knowledge_cutoff`, `alias_target`, `benchmarks`.
- Ids têm formato `fornecedor/modelo`. Sufixos de catálogo aparecem como entradas próprias: `:free` (14 hoje) e `:batch` (modelo cobrado com 50% de desconto pela Batch API, anúncio de 2026-09-22; não serve o endpoint síncrono). `:thinking` e `:extended` estão descontinuados. Sufixos de roteamento valem em qualquer id e não aparecem no catálogo: `:nitro` (ordena por vazão), `:floor` (ordena por preço), `:exacto` (qualidade em tool calling); `:online` está descontinuado em favor da ferramenta de servidor `openrouter:web_search` ([model-variants](https://openrouter.ai/docs/guides/routing/model-variants)).
- Aposentadorias anunciadas pelo próprio catálogo (`expiration_date`, lido em 2026-11-04): `minimax/minimax-m2`, `m2.1`, `m2.7`, `m2-her` em 2026-11-05; `inception/mercury-2`, `2.5`, `3` em 2026-11-08; `bytedance-seed/seed-1.6`, `seed-1.6-flash`, `seed-2.0-code` em 2026-11-11; `z-ai/glm-4.7`, `glm-4.5v` em 2026-12-31.

### Capacidades

- `supported_parameters` por modelo (contagens em 455): `max_tokens` 438, `response_format` 393, `tools` 390, `tool_choice` 382, `structured_outputs` 380, `temperature` 343, `reasoning` e `include_reasoning` 338, `reasoning_effort` 217, `verbosity` 103, `parallel_tool_calls` 21, `web_search_options` 18.
- Entrada: `text+image->text` e variantes com `file`, `audio`, `video`; saída só texto na grande maioria, alguns com `image` ou `audio`.
- Reasoning ([doc](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)): objeto `reasoning` com `effort` (`max`, `xhigh`, `high`, `medium`, `low`, `minimal`, `none`), `max_tokens` (orçamento; Anthropic mínimo 1024), `enabled`, `exclude` (só Chat Completions; tokens continuam cobrados). Resposta em Chat Completions: `message.reasoning` (texto) e `reasoning_details` (array de `reasoning.summary`, `reasoning.encrypted`, `reasoning.text`, com `id`, `format`, `index`); em streaming vêm em `choices[].delta`. Num laço de ferramentas é preciso devolver `reasoning`/`reasoning_details` inalterados e na mesma ordem. Tokens de raciocínio contam contra o limite de saída.
- Prompt caching ([doc](https://openrouter.ai/docs/guides/best-practices/prompt-caching)): OpenAI, DeepSeek, Grok, Moonshot, Groq (Kimi K2) e Gemini 2.5+ (implícito) cacheiam sem marcação; Anthropic e Qwen exigem `cache_control` por bloco (até 4 pontos; Gemini usa só o último) ou, na Anthropic, `cache_control` no topo do corpo para modo automático. Multiplicadores: Anthropic escrita 1,25x (TTL 5 min) ou 2x (1 h), leitura 0,1x; Gemini leitura 0,25x; DeepSeek leitura 0,1x; Grok e Moonshot leitura 0,25x; Groq 0,5x; OpenAI leitura 0,25x ou 0,5x conforme o modelo e escrita 1,25x a partir do GPT-5.6. Mínimos: OpenAI 1.024 tokens; Anthropic 512 a 4.096 conforme o modelo.
- Resposta estruturada, ferramentas (`tools`, `tool_choice`, `parallel_tool_calls` padrão `true`) e `verbosity` (`low`..`max`; na Anthropic vira `output_config.effort`) seguem o formato OpenAI. Parâmetro não suportado pelo provedor escolhido: a doc de parâmetros diz que o campo ausente é omitido no upstream; o tratamento de parâmetros não suportados fora de `require_parameters` não está descrito (não confirmado).
- Faixas: `temperature` 0 a 2, `top_p` 0 a 1, `frequency_penalty`/`presence_penalty` -2 a 2, `top_logprobs` 0 a 20.

### Streaming e uso

- SSE com linhas de comentário como `: OPENROUTER PROCESSING` (keep-alive); parsers manuais devem ignorar linhas iniciadas por `:` ([streaming](https://openrouter.ai/docs/api/reference/streaming)).
- O `usage` vem sempre, sem parâmetro. `usage: {include: true}` e `stream_options: {include_usage: true}` estão descontinuados e não têm efeito ([usage-accounting](https://openrouter.ai/docs/guides/administration/usage-accounting)). Em streaming o último chunk antes de `[DONE]` carrega o `usage` e, diferente da especificação OpenAI, tem uma `choice` com `delta` vazio repetindo o `finish_reason`; tratar como contabilidade, não como segundo fim de stream.
- Campos de `usage`: `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost` (valor cobrado da conta, em USD), `is_byok`, `cost_details.upstream_inference_cost`, `prompt_tokens_details.cached_tokens` (leitura de cache), `prompt_tokens_details.cache_write_tokens` (só em modelos com escrita de cache cobrada), `completion_tokens_details.reasoning_tokens`. Contagem usa o tokenizador nativo do modelo. A resposta pode trazer `cache_discount`.
- Erro no meio do stream: o status continua `200`; chega um chunk com `error` no topo e `finish_reason: "error"`, e o stream termina. Um `200` pode conter só o erro (inclusive quando todos os provedores falham antes da primeira saída). Failover entre provedores só ocorre se nenhuma saída chegou ao cliente.
- Cancelar o stream interrompe processamento e cobrança apenas em provedores que suportam isso; nos demais, o modelo roda até o fim e a resposta completa é cobrada. Requisições não-stream sempre são cobradas inteiras.

### Preços

- Preço em USD por token, como string, em `pricing`: `prompt` e `completion` sempre; opcionais `input_cache_read` (312 modelos), `input_cache_write` (99), `input_cache_write_1h` (34), `internal_reasoning`, `web_search`, `image`, `audio`, `image_output`, `audio_output`, `input_audio_cache`, `request`, `discount` e `overrides` (84 modelos; preços condicionais como contexto longo ou janela de horário). `:free` tem preço zero.
- Sem acréscimo sobre o preço do fornecedor na inferência. Compra de créditos tem taxa (percentual não confirmado, a página do FAQ não renderizou o valor). BYOK: franquia de US$ 25.000/mês sem taxa, depois 5% do que custaria no OpenRouter. Log de prompts/respostas é opt-in e dá 1% de desconto.
- Lote: metade do preço padrão (anúncio de 2026-09-22).

### Limites e erros

- Corpo de erro: `{ "error": { "code": <número>, "message": "...", "metadata": {...} } }`; o status HTTP coincide com `error.code` em erros de requisição ([errors](https://openrouter.ai/docs/api/reference/errors-and-debugging)).

| Status | Significado | Ação no gateway |
|---|---|---|
| 400 | parâmetros inválidos/ausentes ou CORS | erro do cliente, não repetir |
| 401 | chave inválida/desativada ou sessão OAuth expirada | chave ruim |
| 402 | créditos insuficientes na conta ou na chave (saldo negativo derruba até `:free`) | cota/saldo, não repetir na mesma chave |
| 403 | permissão, bloqueio de guardrail ou moderação (`metadata.reasons`, `flagged_input`) | não repetir |
| 408 | timeout | repetível |
| 429 | limite (`error_type: "rate_limit_exceeded"` traz `X-RateLimit-*`; 429 de provedor traz `provider_code`) | repetir com backoff e `Retry-After` |
| 502 | modelo fora do ar ou resposta inválida | repetível/fallback |
| 503 | nenhum provedor atende às restrições de roteamento | ajustar `provider` |

- Erros 500 têm a mensagem genérica; `metadata.provider_name`, `provider_code` e `raw` aparecem em recusas por política de conteúdo.
- Modelos `:free`: 20 req/min; 50 req/dia com menos de 10 créditos comprados, 1.000/dia com 10 ou mais (limite alto concedido a partir de 9 créditos). Modelos pagos não têm teto de plataforma; o Cloudflare bloqueia abuso extremo.
- Limite de chave e uso diário gratuito: `GET /api/v1/key` (`limit_remaining`, `free_model_daily_requests`, `is_free_tier`).

### Chaves de API (modelo de chave)

Pesquisado para comparar com as chaves de harness do Thinker (várias chaves por agente com validade própria; allowlist de IP/CIDR). Nada aqui exige mudança no adaptador; o uso pelo Thinker como provedor só depende de `GET /api/v1/key` e dos erros. Coluna `Evidência`: `doc` = só documentado (lido em 2026-11-18); `sonda` = visto na rede sem credencial.

**Tipos de credencial** ([authentication](https://openrouter.ai/docs/api_reference/authentication.md), [management-api-keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys.md)):

| Tipo | O que é | Evidência |
|---|---|---|
| Chave de inferência | `sk-or-v1-` + 64 hex minúsculos (73 caracteres). Aceita em `Authorization: Bearer` e, para clientes do SDK Anthropic, em `x-api-key`. Vive num workspace. Criada no painel, via API de gestão ou via OAuth PKCE. | doc |
| Chave de gestão (antes "provisioning key") | Mesmo formato. Não chama endpoints de inferência; só administração (`/api/v1/keys`, workspaces, guardrails, BYOK, analytics...). Escopo (organização inteira ou um workspace) e nível de acesso (`read/write` ou `read only`) são fixados na criação e não mudam. `GET /api/v1/key` expõe `is_management_key` e o alias legado `is_provisioning_key`. | doc |
| Access token (federação de identidade) | JWT `at+jwt` emitido por `https://openrouter.ai`, ES256, escopo `inference` ou `management`, validade máxima de 15 min; obtido trocando um JWT do IdP próprio. Tokens OIDC de `https://clerk.openrouter.ai` com escopo `inference` também valem. | doc |
| Chaves OAuth | Chave comum emitida no fluxo PKCE; a URL de consentimento pode pré-preencher `limit` (USD), `expiration` (`1-hour`, `1-day`, `7-days`, `30-days`, `90-days`, `180-days`, `1-year`, `never`) e `workspace_id`/`required_workspace_id` ([oauth](https://openrouter.ai/docs/guides/overview/auth/oauth.md)). Chaves do OpenRouter MCP (emitidas por consentimento OAuth) têm teto próprio de 7 dias. | doc |

Chaves criadas no onboarding saem com limite de US$ 100 e validade de 180 dias ([authentication](https://openrouter.ai/docs/api_reference/authentication.md)). O texto puro da chave só aparece na resposta de criação; depois a chave é identificada pelo `hash` (SHA-256 em hex) e mostrada como `label` mascarado (`sk-or-v1-0e6...1c96`).

**Endpoints** (todos exigem chave de gestão, exceto `GET /api/v1/key`):

| Método e caminho | Uso | Evidência |
|---|---|---|
| `GET /api/v1/keys` | Lista até 100 por página (`offset`); filtros `include_disabled`, `include_expired` (ambos `false` por padrão, valores string `"true"`/`"false"`) e `workspace_id` (padrão: workspace default; chave de escopo workspace só vê o próprio). Não lista chaves de gestão nem chaves OAuth. | doc |
| `POST /api/v1/keys` | Cria; responde `201 {data:<objeto>, key:"sk-or-v1-..."}`. | doc |
| `GET /api/v1/keys/{hash}` | Lê uma. | doc |
| `PATCH /api/v1/keys/{hash}` | Atualiza; campos desconhecidos são ignorados; corpo sem nenhum campo aceito dá `400 No update fields provided`; `409` se o criador não é membro do workspace de destino. | doc |
| `DELETE /api/v1/keys/{hash}` | Apaga; responde `{deleted:true}`. | doc |
| `GET /api/v1/key` | A própria chave (qualquer chave): objeto abaixo mais orçamentos efetivos. | doc; sonda 2026-11-18 (sem credencial: `401 {"error":{"message":"No cookie auth credentials found","code":401}}`, cabeçalho `x-openrouter-error-origin: client`, `cache-control: private, no-store`) |

Fontes: [list](https://openrouter.ai/docs/api/api-reference/api-keys/list-api-keys.md), [create](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key.md), [get](https://openrouter.ai/docs/api/api-reference/api-keys/get-a-single-api-key.md), [update](https://openrouter.ai/docs/api/api-reference/api-keys/update-an-api-key.md), [delete](https://openrouter.ai/docs/api/api-reference/api-keys/delete-an-api-key.md), [current](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key.md) (OpenAPI `openapi.yaml` embutido nas páginas, lido em 2026-11-18).

**Objeto da chave** (todos os campos são obrigatórios na resposta; `C` = aceito na criação, `U` = aceito no `PATCH`):

| Campo | Tipo e semântica | C | U |
|---|---|---|---|
| `hash` | id estável (hex de 64), usado nos caminhos e em guardrails/BYOK/observability | — | — |
| `name` | 1 a 256 caracteres; obrigatório na criação | sim | sim |
| `label` | rótulo legível; na prática o prefixo mascarado da chave | — | — |
| `disabled` | bool; desativação é reversível | — | sim |
| `expires_at` | ISO 8601 UTC ou `null` (nunca expira) | sim | **não** |
| `limit` | teto de gasto em USD, `0` ≤ x < 1.000.000, ou `null` (sem teto) | sim | sim |
| `limit_remaining` | USD restante no período atual, ou `null` | — | — |
| `limit_reset` | `daily`, `weekly`, `monthly` ou `null` (teto vitalício) | sim | sim |
| `include_byok_in_limit` | bool; se o gasto BYOK (o que o OpenRouter teria cobrado) conta no teto; padrão `false` | sim | sim |
| `usage`, `usage_daily`, `usage_weekly`, `usage_monthly` | gasto em créditos OpenRouter (USD): total, dia UTC, semana UTC (segunda a domingo), mês UTC | — | — |
| `byok_usage`, `byok_usage_daily`, `byok_usage_weekly`, `byok_usage_monthly` | idem para gasto BYOK | — | — |
| `created_at`, `updated_at` | ISO 8601; `updated_at` pode ser `null` | — | — |
| `last_used_at` | ISO 8601 UTC do último uso registrado, ou `null` (só registrado desde o fim de 2025) | — | — |
| `creator_user_id` | membro criador; em chave de organização, omitir na criação gera chave "do workspace" (sem dono) | sim | — |
| `workspace_id` | UUID do workspace | sim | sim (move a chave; ela mantém o valor) |
| `external_user` | id de usuário externo do parceiro, ou `null` | sim, via `external.user` (1 a 512 caracteres); `external.api_key` opcional (≥32 caracteres, guardado só como SHA-256) | — |

`GET /api/v1/key` acrescenta: `is_free_tier`, `is_management_key`, `is_provisioning_key`, `organization_id`, `free_model_daily_requests {limit, remaining, used}`, `allowed_data_regions` (`global`|`europe`|`us`), `budgets[]` e `effective_budget` (abaixo) e `rate_limit` (descontinuado, sempre `-1`, ignorar). Não traz `hash`, `name` nem `disabled`.

**Validade** ([management-api-keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys.md), [security-settings](https://openrouter.ai/docs/guides/overview/auth/security-settings.md)):

- `expires_at` na criação exige segundos (`YYYY-MM-DDTHH:MM:SSZ`, frações aceitas); precisão de minuto é rejeitada. Sem campo de validade no `PATCH`: a validade é imutável; para estender, cria-se outra chave e apaga-se a antiga. (doc)
- Depois de vencida, toda requisição com a chave recebe `401` com a mensagem `API key expired`. A chave continua listada no painel até ser apagada; na API, só com `include_expired=true`. (doc)
- "Vida máxima de chave" (configuração de privacidade da conta, no painel; não está na API de organização): rejeita requisições de chaves sem validade ou com validade além do máximo, inclusive chaves já existentes. (doc)

**Limites de gasto e orçamentos** ([limits](https://openrouter.ai/docs/api_reference/limits.md), [guardrails](https://openrouter.ai/docs/guides/features/guardrails.md), [capping-shared-agent-keys](https://openrouter.ai/docs/guides/best-practices/capping-shared-agent-keys.md)):

- Camadas verificadas em ordem a cada pedido pago: orçamentos de guardrail (padrão do workspace contra o agregado do membro e contra a chave, guardrail do membro, guardrail da chave), orçamento do workspace (diário, semanal, mensal e vitalício, cumulativos) e por fim o `limit` da própria chave. Vence o mais restrito. Janelas em UTC: dia às 00:00, semana na segunda, mês no dia 1. (doc)
- `budgets[]`/`effective_budget` em `GET /api/v1/key`: `{scope, limit_usd, spend_usd, remaining_usd, reset_interval, resets_at, include_byok, guardrail_id, budget_id}`, com `scope` em `workspace_default_member`, `workspace_default_key`, `member`, `api_key`, `workspace`, `key_limit`. `effective_budget` é o que bloqueia primeiro. (doc)
- Gasto da chave também conta no orçamento do membro que a criou; chave sem criador ("do workspace") escapa dos guardrails de membro. (doc)

**Limites de taxa por chave**: não existem. Criar chaves ou contas a mais não muda limites; a capacidade é global. Valem só: `:free` (20 req/min; 50 ou 1.000/dia), 10.000 operações de gestão de chaves por dia por conta (reset 00:00 UTC), rajada por IP em `/api/v1/keys`, `/api/v1/keys/{hash}`, `/api/v1/key` e `/api/v1/credits` (sem `X-RateLimit-*`) e o Cloudflare ([limits](https://openrouter.ai/docs/api_reference/limits.md)). (doc)

**Restrições por chave**:

| Restrição | Como funciona | Evidência |
|---|---|---|
| Allowlist de IP | Só no plano Enterprise e **por conta/organização, não por chave**: entradas de IPv4/IPv6 único ou CIDR (`10.0.0.0/8`), com rótulo opcional e escopo "todos os workspaces" ou até 100 workspaces. Lista vazia aceita qualquer IP; com entradas, IP fora recebe `403`. Vale para inferência e demais leituras/escritas com chave comum (créditos, activity, generations, arquivos, batches); não é verificada em endpoints só de gestão (`/api/v1/keys`, workspaces, guardrails), Vault, skills e provisioning. Chave de gestão de escopo organização precisa casar com entrada "todos os workspaces"; se nenhuma existir, fica sem restrição. Workspace sem entrada aplicável fica sem restrição. Mudança vale na hora; só pelo painel (sem endpoint documentado). Corpo exato do `403` não documentado. ([security-settings](https://openrouter.ai/docs/guides/overview/auth/security-settings.md)) | doc |
| Modelos e provedores permitidos | Não é campo da chave: vem de um guardrail ou política "model availability" atribuída à chave (`allowed_models`, `allowed_providers`, `ignored_models`, `ignored_providers`; vazio = tudo). Combinação entre camadas por interseção. Uma chave tem no máximo um guardrail direto e uma política de cada tipo. `GET /api/v1/models` chamado com chave devolve só o que aquela chave pode usar. ([guardrails](https://openrouter.ai/docs/guides/features/guardrails.md), [policies](https://openrouter.ai/docs/guides/features/guardrails/policies.md), [org settings](https://openrouter.ai/docs/api/api-reference/organization/update-organization-settings.md)) | doc |
| ZDR e política de dados | Por guardrail, por grupo de modelos: `enforce_zdr_anthropic`, `_openai`, `_google`, `_xai`, `_other` (OR entre camadas), `allow_safety_retention_google`/`_other`; `allowed_data_regions` restringe o host de entrada (`openrouter.ai`, `eu.`, `us.`; Business/Enterprise). Treino por provedor é configuração da conta, não da chave. ([guardrails](https://openrouter.ai/docs/guides/features/guardrails.md), [zdr](https://openrouter.ai/docs/guides/features/zdr.md)) | doc |
| Filtros de conteúdo | Por guardrail/política de moderação: injeção de prompt, PII (redigir ou bloquear) e regex próprias; bloqueio dá `403`. | doc |
| Harness | `enforce_first_party_harness_models` no guardrail: Codex lista só OpenAI e Claude Code/Desktop só Anthropic em `GET /models` (não bloqueia id pedido diretamente). | doc |
| Log de entrada/saída | Opt-in da conta (Observability), com filtro de chaves incluídas e excluídas (exclusão vence). Destinos de broadcast aceitam `api_key_hashes`. | doc ([input-output-logging](https://openrouter.ai/docs/guides/features/input-output-logging.md)) |
| BYOK por chave | Cada credencial BYOK aceita `allowed_api_key_hashes` (allowlist de chaves que podem usá-la; `null` = todas; `[]` dá `400`). | doc ([byok](https://openrouter.ai/docs/guides/overview/auth/byok.md)) |

**Rotação**: não há endpoint de rotação nem período de carência. O procedimento documentado é criar a nova chave, migrar e apagar a antiga; as duas valem ao mesmo tempo durante a troca ([api-key-rotation](https://openrouter.ai/docs/cookbook/administration/api-key-rotation.md)). O OpenRouter é parceiro do secret scanning do GitHub e avisa por e-mail quando detecta chave exposta. A página Security sinaliza chaves sem limite, sem validade, com limite ≥ US$ 1.000, validade > 365 dias ou ociosas há 90+ dias; "arquivar" é permanente, "desativar" é reversível ([security-settings](https://openrouter.ai/docs/guides/overview/auth/security-settings.md)). (doc)

**Erros de chave** (corpo `{error:{code, message, metadata?}}`, opcionalmente `openrouter_metadata` e `user_id` no topo):

| Situação | Status e mensagem | Evidência |
|---|---|---|
| Sem credencial | `401 No cookie auth credentials found` (endpoints que aceitam sessão) ou `401 Missing Authentication header` | sonda 2026-11-18 (`GET /api/v1/key`) |
| `Bearer` vazio / `undefined` | `401 No API key in the Authorization header` | doc |
| Chave de outro fornecedor (`sk-` sem `sk-or-`) | `401 Invalid API key: this is not an OpenRouter API key` | doc |
| Caracteres inválidos no cabeçalho | `401 Malformed authentication credential` | doc |
| Chave desativada, apagada ou inexistente | `401 Invalid API key` ou `401 User not found.` (a doc não distingue desativada de apagada) | doc |
| Chave vencida | `401 API key expired` | doc |
| Teto da chave esgotado | `403 Key limit exceeded`, `metadata.limit_source: "openrouter_key_limit"`, `scope: "key_limit"`, `limit_usd`, `spend_usd`, `resets_at`, `remedy_hint`; sem `Retry-After`. A página de limites também cita `openrouter_key_limit` sob "Handling 402"; as páginas divergem e o status real não foi confirmado (não confirmado). | doc |
| Orçamento de guardrail/workspace esgotado | `403` com mensagem terminando em `$X of $Y used; resets <ISO>.` e `limit_source` `openrouter_guardrail_budget` ou `openrouter_workspace_budget` | doc |
| Saldo da conta insuficiente / orçamento em voo | `402`, `limit_source` `openrouter_credits` ou `openrouter_in_flight_budget` (este com `Retry-After`) | doc |
| IP fora da allowlist | `403` (corpo não documentado) | doc |
| Bloqueio por guardrail (modelo, provedor, região, conteúdo) | `403`; em `/api/v1/messages` vira envelope Anthropic `permission_error`; em `/api/v1/responses` o código nativo colapsa e `error_type` no topo guarda a causa (`authentication` → `server_error`) | doc |
| Chave comum em rota de gestão | `403 Only management keys can perform this operation` | doc |
| Chave de gestão sem permissão / escopo errado | `403 Management key does not have permission for this request`, `... scoped to a workspace; this request requires an organization-scoped management key`, `... scoped to a different workspace` | doc |

### Formato na rede

Pendente: estrutura de pedido e resposta ainda não pesquisada (regras em [`.claude/external-research.md`](../../../.claude/external-research.md#wire-format)). Até a revisão, use a seção canônica do protocolo base listada no [índice](../README.md#formato-na-rede) e trate qualquer diferença desta entidade como não verificada.

## Como o Thinker implementa hoje

- **Roteamento de provedores por rota** (desde 2026-11-06): os campos `provider.*` são parâmetros por rota (`routing-core/openrouter-provider-routing.ts`, `clientOwnsRoot`: o objeto `provider` do cliente vence por inteiro). Erro embutido em 200 e erro SSE antes do primeiro conteúdo viram status real (`upstream-error-classifier.ts`, `stream-warmup.ts` `peekStreamStart`). O `provider` da resposta, o `id` (`gen-...`) e o `model` vão para `agent_messages.served_provider`, `upstream_generation_id` e `served_model` (`served-provider.ts`). `openrouter/free` publica em `/v1/models` a menor janela dos `:free`.

Estado conferido no código em 2026-11-04 (branch `docs/externos-onda3`, commit base `2f97f17`).

- **Inferência.** Base `https://openrouter.ai`, caminho fixo `/api/v1/chat/completions`, formato `openai`, `Authorization: Bearer`, `Content-Type`, `HTTP-Referer: https://github.com/patrickbrandao/thinker` e `X-Title: Thinker` (`packages/backend/src/routing/proxy/provider-endpoints.ts:573-584`). Não usa `/responses` nem `/messages`, e não envia `X-OpenRouter-Categories`, `session_id`, `provider` ou `reasoning`.
- **Passthrough.** `openrouter` está em `PASSTHROUGH_PROVIDERS` (`provider-client-converters.ts:113`): campos de dialeto OpenAI/OpenRouter não são removidos; `reasoning` e `reasoning_details` das mensagens são preservados só para OpenRouter (`provider-client-converters.ts:373-380`). Nemotron via OpenRouter tem `thinking` removido (`:437-464`). O id do modelo mantém o prefixo `fornecedor/` (`provider-client.ts:332-336`).
- **Usage.** Pede `stream_options.include_usage` (`provider-endpoints.ts:84`, aplicado em `provider-client.ts:920-925`), hoje desnecessário mas inofensivo. `parseUsageObject` lê `prompt_tokens_details.cached_tokens` e `cache_write_tokens` e o custo reportado `usage.cost` ou `cost_details.upstream_inference_cost` (`stream-writer.ts:100-190`); o custo reportado vence qualquer estimativa (`common/utils/cost-calculator.ts:145-162`). Linhas de comentário SSE `:` são ignoradas (`stream-writer.ts:228`). Erro no meio do stream (`error` no topo) vira `upstream_error` (`routing/proxy/stream-protocol.ts:68-120`).
- **Cache.** Para `anthropic/*` injeta `cache_control` no último system/developer e na última tool, mais cache automático da Anthropic; para `google/*` e `qwen/*` injeta no último system/developer/user (`provider-client.ts:323-329,951-958`, `routing/proxy/cache-injection.ts:37-67`).
- **Listagem.** `GET https://openrouter.ai/api/v1/models` sem chave (`model-discovery/provider-model-fetcher.service.ts:1026-1030`). `parseOpenRouter` (`:627-665`) descarta ids terminados em `:batch` e modelos com saída que não seja só texto, e guarda id, nome, `context_length`, modalidades e preços `prompt`/`completion`; não lê `supported_parameters`, `reasoning`, `expiration_date`, `top_provider.max_completion_tokens` nem preços de cache; `capabilityReasoning` e `capabilityCode` ficam `false` e vêm do models.dev (`model-discovery/model-capabilities.ts:148-175`).
- **Catálogo e preços (ADR 0003).** `database/pricing-sync.service.ts:36` busca o mesmo endpoint, filtra modelos que aceitam e produzem texto e guarda só `input`/`output`/`context_length`/nome (`:105-135`, `:180-195`). Serve de fallback de preço e de lista (`model-discovery/model-fallback.ts:234-270`, `model-discovery.service.ts:312-326`). Mapa de prefixos de fornecedor em `packages/shared/src/providers.ts` (`openRouterPrefixes`) e inferência de provedor por prefixo em `packages/shared/src/provider-inference.ts:8,31`. Desabilitado por `THINKER_CATALOG_SYNC=false`.
- **Reasoning.** `reasoning-format.ts:36,103-108` trata `openrouter` como host que tolera `reasoning_content`. O `thinking` da Anthropic Messages só é traduzido para `openai` (`provider-client.ts:928-935`); em OpenRouter segue sem tradução (G1).
- **Snippet de setup.** Chave obtida em `https://openrouter.ai/keys` (`packages/frontend/src/services/provider-api-key-urls.ts:24`); texto do card "Auto-route to 300+ models" (`frontend/src/i18n/locales/en/providerSetup.ts:266`). O catálogo atual tem 455 modelos, então "300+" continua correto.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/cache-injection.ts`
- `packages/backend/src/routing/proxy/stream-writer.ts`
- `packages/backend/src/routing/proxy/stream-protocol.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/backend/src/routing/proxy/anthropic-messages-adapter.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/pricing-sync.service.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-prices/model-pricing-cache.service.ts`
- `packages/backend/src/common/utils/cost-calculator.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `thinking` da Anthropic Messages não é traduzido para `reasoning` quando o destino é `openrouter` (a tradução só existe para `openai`, `provider-client.ts:928-935`); modelos Claude via OpenRouter provavelmente rodam sem raciocínio e `thinking` segue como campo desconhecido (efeito não confirmado sem chave real). Sugestão: mapear para `reasoning.max_tokens`/`effort: none` ou usar `/api/v1/messages` para `anthropic/*`. | providers | [#432](https://github.com/patrickbrandao/thinker/issues/432) | resolvida (normalização de reasoning na entrada e na saída) |
| G2 | oportunidade | `parseOpenRouter` ignora `supported_parameters`, `reasoning`, `top_provider.max_completion_tokens` e `expiration_date`; capacidades de raciocínio/ferramentas dependem do models.dev e modelos prestes a sair (ex.: MiniMax M2.x em 2026-11-05) continuam listados. Sugestão: preencher capacidades e ocultar/avisar modelos vencidos a partir do catálogo. | backend-dev | — | aberta |
| G3 | oportunidade | Preços de cache (`input_cache_read`, `input_cache_write`, `input_cache_write_1h`) e `overrides` de contexto longo não entram no cache de preços; o custo real hoje vem de `usage.cost`, então só afeta estimativa e exibição de preço. Mesma causa do Kilo (#408). | backend-dev | — | aberta |
| G4 | oportunidade | Enviar `session_id`/`x-session-id` (o Thinker já tem `providerCacheKey`) para fixar o provedor e manter caches quentes em Anthropic, Gemini e DeepSeek; hoje a afinidade depende só do heurístico de 10 minutos. | providers | — | aberta |
| G5 | oportunidade | Atribuição: trocar `X-Title` por `X-OpenRouter-Title` (o antigo segue aceito) e avaliar `X-OpenRouter-Categories` e `X-OpenRouter-App-Visibility: hidden`. O `HTTP-Referer` atual expõe o app em rankings públicos; é decisão do mantenedor. | providers | — | aberta |
| G6 | oportunidade | Endpoint nativo `/api/v1/messages` e `/api/v1/responses` disponíveis em 382 modelos; usar para `anthropic/*` preservaria thinking, `cache_control` e blocos nativos sem tradução (relacionada a G1). | providers | — | aberta |
| G7 | oportunidade | O OpenRouter expõe validade e teto da própria chave em `GET /api/v1/key` (`expires_at`, `limit_remaining`, `effective_budget`) e distingue `401 API key expired` e `403 Key limit exceeded` (`metadata.limit_source`, `resets_at`). O Thinker não lê esse endpoint ao validar a chave do provedor nem usa `resets_at` para descansar a rota; uma chave vencida ou com teto esgotado só aparece como falha 401/403 genérica. Sugestão: ao cadastrar/testar a chave, ler `GET /api/v1/key` e avisar sobre validade próxima e teto; tratar `limit_source` como cota com reset em `resets_at`. | providers | — | aberta |

## Histórico

- 2026-11-18: revisão parcial pedida para o planejamento de chaves de harness. Nova subseção "Chaves de API (modelo de chave)" em Contrato: objeto da chave e campos graváveis, validade imutável e `401 API key expired`, tetos e orçamentos em camadas, ausência de limite de taxa por chave, allowlist de IP/CIDR (Enterprise, por conta/workspace, não por chave), restrições via guardrails, chaves de gestão, rotação e erros. Sonda sem credencial em `GET /api/v1/key`. Divergência na doc sobre o status do teto de chave esgotado (403 vs 402). Registrada G7. Catálogo e Formato na rede não revisados.
- 2026-11-04: primeira revisão completa. Contrato escrito a partir da doc e do catálogo vivo (455 modelos). Registradas G1 a G6; aberta a issue #432 para G1. Pendente de conferência com chave real: efeito do campo `thinking` no Chat Completions, tratamento de parâmetros não suportados e percentual da taxa de compra de créditos.
- 2026-11-03: esqueleto criado, sem pesquisa.
