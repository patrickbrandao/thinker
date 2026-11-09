---
id: api-minimax
categoria: api
entidade: MiniMax
agente: api-minimax
thinker_ids: [minimax]
revisado_em: 2026-11-04
versao_observada: docs platform.minimax.io 2026-11-04 (MiniMax-M3.1-Flash, MiniMax-M3)
---

# MiniMax (acesso por API)

Especificação mantida pelo agente `api-minimax` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md). A assinatura (M Plan / Coding Plan, OAuth, `sk-cp-`) é escopo de `sub-minimax`.

## Resumo

- Dois modelos de texto ativos no catálogo: `MiniMax-M3.1-Flash` e `MiniMax-M3`, ambos com contexto de 1M tokens e entrada multimodal (imagem e vídeo). A família M2.x só aparece como legado na API Anthropic-compatível.
- Dois protocolos por chave de API: Chat Completions em `https://api.minimax.io/v1` e Anthropic Messages em `https://api.minimax.io/anthropic`. O Thinker usa só o primeiro com chave de API.
- Raciocínio (thinking) é central: M3.1-Flash sempre raciocina e aceita `reasoning_effort` (`low` a `max`, padrão `max`); M3 raciocina só com `thinking: adaptive`.
- `temperature` e `top_p` são ignorados (valores fixos). Preços: M3.1-Flash 0,15/0,60 USD por 1M tokens; M3 0,30/1,20 (desconto permanente de 50%).
- Nenhuma quebra encontrada; quatro lacunas menores (oportunidade/não confirmadas), sem issue.

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Platform docs (modelos) | <https://platform.minimax.io/docs/guides/models-intro> | 2026-11-04 |
| API Anthropic-compatível | <https://platform.minimax.io/docs/api-reference/text-anthropic-api> | 2026-11-04 |
| API OpenAI-compatível | <https://platform.minimax.io/docs/api-reference/text-openai-api> | 2026-11-04 |
| Códigos de erro | <https://platform.minimax.io/docs/api-reference/errorcode> | 2026-11-04 |
| Pricing | <https://platform.minimax.io/docs/guides/pricing> | 2026-11-04 |

Páginas sem data de versão; "última versão vista" é a data da leitura.

## Contrato

### Endpoints e protocolos

| Protocolo | Base URL | Auth | Fonte |
|---|---|---|---|
| Chat Completions | `https://api.minimax.io/v1` (`POST /v1/chat/completions`) | `Authorization: Bearer <key>` | text-openai-api |
| Anthropic Messages | `https://api.minimax.io/anthropic` (`/anthropic/v1/messages`) | Bearer (exemplo curl); SDK usa `ANTHROPIC_API_KEY` | text-anthropic-api |
| Contagem de tokens | `POST /anthropic/v1/messages/count_tokens` | idem | text-anthropic-api |

- Região China: host `https://api.minimaxi.com` (usado pelo Thinker; a documentação consultada cita só o host global, portanto o host CN é (não confirmado) nesta revisão).
- Os dois modelos aceitam os dois protocolos. Corpo máximo 64 MB.
- Listagem de modelos `GET /v1/models` (formato OpenAI) não está descrita nas páginas lidas (não confirmado); o Thinker a usa.

### Modelos

| Id | Contexto | Saída máx. | Observações |
|---|---|---|---|
| `MiniMax-M3.1-Flash` | 1M | não informada | multimodal, pensa sempre, profundidade ajustável |
| `MiniMax-M3` | 1M | não informada | multimodal, pensamento opcional |

- Sem aposentadorias anunciadas para texto. M2.x (M2, M2.1, M2.5, M2.7 e `-highspeed`) só aceita blocos de texto e tool call na API Anthropic-compatível e não consta mais da página de modelos (status exato (não confirmado)).
- Ids são sensíveis a caixa (`MiniMax-M3`).

### Capacidades

| Recurso | M3.1-Flash | M3 |
|---|---|---|
| Tools / `tool_choice` | sim | sim |
| Imagem (JPEG, PNG, GIF, WEBP, até 10 MB; URL ou base64) | sim | sim |
| Vídeo (MP4, AVI, MOV, MKV; 50 MB inline, até 512 MB via Files API `mm_file://{id}`) | sim | sim |
| Áudio de entrada | não | não |
| `thinking` | sempre ligado; `disabled` dá 400 | desligado por padrão; `adaptive` liga |
| `reasoning_effort` / `output_config.effort` | `low`, `medium`, `high`, `xhigh`, `max` (padrão `max`); `none` dá 400 | não documentado |
| `reasoning_split` (OpenAI) | só `true`; `false` dá 400 | `true` move o raciocínio para `reasoning_content`; `false` deixa em `<think>` no `content` |
| `service_tier: priority` | não suportado | sim (1,5x o preço) |

- Tokens de raciocínio contam para `max_tokens`: limite baixo pode encerrar sem texto. Em multi-turno com tools, reenviar a mensagem completa do assistente (`tool_calls`, `reasoning_content` ou blocos `thinking`).
- Parâmetros ignorados: `temperature` (fixo 1), `top_p` (fixo 0,95; se enviado deve estar em (0,1]), `presence_penalty`, `frequency_penalty`, `logit_bias`; `n` só 1; `function_call` não suportado (usar `tools`). Na API Anthropic: `top_k`, `stop_sequences`, `mcp_servers`, `context_management`, `container` ignorados.
- `max_completion_tokens` é o recomendado; `max_tokens` legado também aceito.
- Saída estruturada: não documentada nas páginas lidas (não confirmado).

### Streaming e uso

- `stream_options.include_usage` suportado na API OpenAI; a lista de campos de uso (cache, raciocínio) não é descrita (não confirmado).
- Prompt caching: as páginas de API não descrevem o mecanismo, mas o preço lista leitura de cache (cache read), sem preço de escrita. Se é automático ou por marcador é (não confirmado).

### Preços

USD por 1M tokens, pay-as-you-go (pricing, 2026-11-04):

| Modelo | Tier | Entrada | Saída | Cache read |
|---|---|---|---|---|
| M3.1-Flash | Standard | 0,15 | 0,60 | 0,015 |
| M3 (entrada ≤512k) | Standard | 0,30 | 1,20 | 0,06 |
| M3 (entrada >512k) | Standard | 0,60 | 2,40 | 0,12 |
| M3 (≤512k) | Priority | 0,45 | 1,80 | 0,09 |
| M3 (>512k) | Priority | 0,90 | 3,60 | 0,18 |

- Preço do M3 é "permanent 50% off" (antes 0,60/2,40/0,12). Cache write não listado. Priority = 1,5x e só no M3.

### Limites e erros

A página de erros não traz valores de RPM/TPM. Códigos relevantes para texto:

| Código | Significado | Tratamento |
|---|---|---|
| 1002 | rate limit | retentável |
| 1000, 1001, 1024, 1033, 1039 | erro desconhecido, timeout, interno, sistema, limite de tokens | retentável |
| 1004, 2049 | chave inválida / não autorizada | chave ruim |
| 1008, 2053 | saldo/crédito insuficiente | cota |
| 2013 | parâmetros inválidos | erro do cliente |
| 2022 | modelo inexistente ou sem acesso | modelo não suportado |
| 1026, 1027 | entrada/saída marcada como sensível | não retentar |
| 2045, 2046, 2047 | limite de crescimento de taxa, tokens, conexões | retentável com carga estável |
| 2064, 2066 | cluster sob carga, timeout | retentável |
| 2056, 2057, 2061, 2062, 2067, 2068, 2069 | códigos do M Plan (assinatura) | escopo `sub-minimax` (issue #341) |

O mapeamento exato código-para-HTTP não está nas páginas lidas (não confirmado).

## Como o Thinker implementa hoje

Conferido no código em 2026-11-04:

- Registro: `id: 'minimax'`, prefixo de chave `sk-`, tamanho mínimo 30, URL de criação de chave `platform.minimax.io/user-center/basic-information/interface-key` (`packages/shared/src/providers.ts:273`, `packages/frontend/src/services/provider-api-key-urls.ts:15`).
- Encaminhamento com chave de API: formato `openai`, base `https://api.minimax.io`, `Authorization: Bearer`, caminho `/v1/chat/completions`, com `stream_options.include_usage` (`packages/backend/src/routing/proxy/provider-endpoints.ts:398`). A assinatura usa outro template (`minimax-subscription`, Anthropic, `/anthropic/v1/messages`), fora de escopo aqui.
- Região `cn` com chave de API troca a base para `https://api.minimaxi.com` (`packages/backend/src/routing/proxy/forward-endpoint-resolver.ts:157`; `MINIMAX_BASE_URLS` em `packages/backend/src/routing/oauth/minimax/minimax-oauth-helpers.ts:7`). Prefixo `minimax/` do id é removido (`forward-endpoint-resolver.ts:107`).
- Descoberta de modelos: `GET {base}/v1/models` com Bearer, parser OpenAI (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:952`); região CN usa `https://api.minimaxi.com/v1` (`packages/backend/src/model-discovery/model-discovery.service.ts:201`).
- Normalização de ids vindos do OpenRouter (minúsculos e `:free`) para `MiniMax-M3.1-Flash` e `MiniMax-M3` (`packages/backend/src/model-discovery/model-fallback.ts:31`). Aliases legados M1/M2.x em `packages/backend/src/model-prices/model-name-normalizer.ts:33`.
- Modalidades: só `minimax/minimax-m3.1-flash` declarado como texto+imagem+tools (`packages/backend/src/model-discovery/known-model-modalities.ts:37`).
- Parâmetros: `reasoning_effort` é repassado para `minimax` (`packages/backend/src/routing/proxy/provider-client-converters.ts:468`); `service_tier`, `store`, `metadata`, `stream_options` são removidos como "OpenAI-only" (`provider-client-converters.ts:121`); `thinking` passa sem alteração. Não há tratamento de `reasoning_split` nem de `<think>` no código.
- Preços: não há entrada MiniMax em `known-model-prices.ts`; os preços vêm do sync com OpenRouter/models.dev (`packages/backend/src/database/models-dev-sync.service.ts:39`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/known-model-modalities.ts`
- `packages/backend/src/model-prices/model-name-normalizer.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/routing/provider-base-url.ts`
- `packages/backend/src/routing/subscription-region.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | oportunidade | `service_tier: priority` (M3, 1,5x do preço) é removido como campo só-OpenAI; cliente não consegue pedir tier priority nem o custo reflete o multiplicador. Arquivo: `provider-client-converters.ts:121`. | providers | — | aberta |
| G2 | oportunidade | Preço do M3 muda com entrada >512k (dobra) e priority; o Thinker usa um preço único por modelo vindo do catálogo público, então o custo de requisições longas fica subestimado. | backend-dev | — | aberta |
| G3 | degradação (não confirmado) | `reasoning_split` não é enviado. No M3 com `false`/omitido o raciocínio pode vir em `<think>` dentro do `content` em vez de `reasoning_content`; comportamento do padrão não confirmado. Verificar com chave real. | providers | — | aberta |
| G4 | oportunidade (não confirmado) | `reasoning_effort` é repassado ao M3, mas a documentação só o descreve para M3.1-Flash; pode ser rejeitado ou ignorado. Verificar com chave real. | providers | — | aberta |

Sem issues abertas: nenhuma lacuna é `quebra` confirmada, e as oportunidades dependem de verificação com chave real. Lacunas de catálogo e erros do M Plan estão nas issues de `sub-minimax` (#339, #340, #341).

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Contrato preenchido a partir das páginas de docs (modelos M3.1-Flash e M3, preços, erros, parâmetros); estado do código conferido; 4 lacunas registradas, nenhuma issue aberta.
