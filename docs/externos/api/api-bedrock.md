---
id: api-bedrock
categoria: api
entidade: AWS Bedrock
agente: api-bedrock
thinker_ids: [bedrock]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04
---

# AWS Bedrock (acesso por API)

Especificação mantida pelo agente `api-bedrock` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- O Bedrock tem **dois endpoints de inferência**: `bedrock-runtime` (recomendado pela AWS) e `bedrock-mantle`. Os dois aceitam Chat Completions, Responses e Anthropic Messages; só o Runtime tem Converse/InvokeModel, perfis de inferência entre regiões (CRIS), Guardrails; só o Mantle tem `GET /v1/models`, `background=true`, ferramentas server-side, Projects.
- **Chave de API do Bedrock** (bearer) funciona nos dois endpoints, inclusive o plano de controle (`bedrock.<região>`). Vale só na região em que foi gerada (chave de longo prazo). SigV4 também é aceito, mas o Thinker usa só bearer.
- Os modelos GPT fechados da OpenAI (GPT-5.6+, GPT-6.x) **só aceitam perfil CRIS** (`us.`/`global.`) no Runtime; no Mantle usam o ID base e caminho `/openai/v1`, em us-east-1.
- Preço por token é igual nos dois endpoints; CRIS geográfico dos EUA e Mantle in-Region custam ~10% a mais que o CRIS global (cartão do GPT-6 Sol).
- Lacunas abertas: G1 a G5 (3 com issue). Confiança média-alta nos documentos; comportamento ao vivo não foi testado (sem chave real).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| User guide | <https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html> | docs 2026-11-04 |
| Endpoints suportados | <https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints.html> | docs 2026-11-04 |
| Disponibilidade por endpoint (modelos) | <https://docs.aws.amazon.com/bedrock/latest/userguide/models-endpoint-availability.html> | docs 2026-11-04 |
| Regiões por endpoint | <https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints-region-availability.html> | docs 2026-11-04 |
| Chaves de API | <https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html> | docs 2026-11-04 |
| Chat Completions | <https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html> | docs 2026-11-04 |
| Responses API (e Mantle) | <https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html> | docs 2026-11-04 |
| Messages API (Anthropic) | <https://docs.aws.amazon.com/bedrock/latest/userguide/inference-messages-api.html> | docs 2026-11-04 |
| Cross-Region inference | <https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html> | docs 2026-11-04 |
| Quotas Runtime / Mantle | <https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-runtime.html> e `quotas-mantle.html` | docs 2026-11-04 |
| Cartão de modelo (ex.: GPT-6 Sol) | <https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-sol.html> | docs 2026-11-04 |
| Supported models and regions | <https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html> | não relida (substituída pelas tabelas acima) |
| API reference | <https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html> | não relida (só nomes de operações) |
| Pricing | <https://aws.amazon.com/bedrock/pricing/> | 2026-11-04 (lido 100 mil de 118 mil caracteres) |

## Contrato

### Endpoints e protocolos

| Endpoint | Base URL | APIs | Observação |
|---|---|---|---|
| Runtime | `https://bedrock-runtime.{região}.amazonaws.com` | Converse, InvokeModel, Chat Completions, Responses, Messages | Todas as regiões do Bedrock (inclui GovCloud). Fonte: `endpoints.html`. |
| Mantle | `https://bedrock-mantle.{região}.api.aws` | Chat Completions, Responses, Messages | Subconjunto de regiões: us-east-1, us-east-2, us-west-2, eu-central-1, eu-north-1, eu-south-1, eu-west-1, eu-west-2, ap-northeast-1, ap-south-1, ap-southeast-2, ap-southeast-3, sa-east-1, us-gov-east-1, us-gov-west-1. |
| Plano de controle | `https://bedrock.{região}.amazonaws.com` | `ListFoundationModels`, `ListInferenceProfiles`, `GetInferenceProfile` | O Thinker usa `GET /inference-profiles` com a mesma chave (comportamento do código; a doc confirma só a operação). |

Caminhos:

| API | Runtime | Mantle |
|---|---|---|
| Chat Completions | `/openai/v1/chat/completions` | `/v1/chat/completions` na maioria dos modelos; **`/openai/v1/chat/completions`** em alguns (ex.: GPT-6 Sol) |
| Responses | `/openai/v1/responses` (+ `GET/DELETE /{id}`, `POST /{id}/cancel`) | `/v1/responses` ou `/openai/v1/responses`, conforme o modelo |
| Messages (Anthropic) | `/anthropic/v1/messages` com `x-api-key` e `anthropic-version: 2023-06-01` | `/anthropic/v1/messages` com os mesmos cabeçalhos |
| Contagem de tokens | não para modelos só-CRIS | `/anthropic/v1/messages/count_tokens` (único caminho para Claude lançado só via CRIS); GPT não suporta |

- O prefixo errado no Mantle é rejeitado com `model <id> isn't supported on this route`; cada cartão de modelo traz o prefixo correto na tabela "Programmatic access".
- Autenticação: `Authorization: Bearer <chave>` (OpenAI-compatível) ou `x-api-key` (Messages). Variável oficial: `AWS_BEARER_TOKEN_BEDROCK`. A chave sozinha não dá acesso: o principal IAM precisa de `bedrock:InvokeModel` (Runtime, no alvo e no projeto `default` para Responses) ou `bedrock-mantle:CreateInference` (Mantle); políticas podem negar `bedrock:CallWithBearerToken`.
- Tipos de chave: curta (até 12 h, herda permissões da sessão, gerada por `aws-bedrock-token-generator`) e longa (usuário IAM, validade configurada, só na região de criação; erro `Credential should be scoped to a valid region` em região errada). O prefixo da chave (`ABSK`, `bedrock-api-key-`) que o Thinker usa para detectar região não aparece na doc (não confirmado).
- Cabeçalhos extras suportados no Runtime: `X-Amzn-Bedrock-GuardrailIdentifier`, `X-Amzn-Bedrock-GuardrailVersion`, `X-Amzn-Bedrock-Trace`; `OpenAI-Project` só `default`.

### Modelos

- **Listagem**: só o Mantle implementa `GET /v1/models` (formato OpenAI, `Authorization: Bearer`). O Runtime não tem `GET /openai/v1/models` (devolve 404 `UnknownOperationException`); a descoberta de perfis CRIS usa `ListInferenceProfiles` (e `ListFoundationModels`) no plano de controle.
- **IDs**: ID base `fornecedor.modelo[-versão:n]` (ex.: `openai.gpt-6-sol`, `anthropic.claude-sonnet-5`, `openai.gpt-oss-120b-1:0` no Runtime). Perfis CRIS: prefixo geográfico + ID base (`us.openai.gpt-6-sol`, `global.openai.gpt-6-sol`). Prefixos citados no guia: `us`, `eu`, `apac`, `in`, `global`; GovCloud usa `us-gov.`. Perfis de aplicação (application inference profiles) são rejeitados com 400 na Responses do Runtime e não são suportados em Responses/Chat Completions.
- **Modelos GPT fechados da OpenAI** (GPT-5.6, GPT-6.x) no Runtime: só perfil CRIS, "você não pode usar o ID base para chamada in-Region". No Mantle: ID base, base path `/openai/v1`, apenas us-east-1 (GPT-6 Sol).
- **Disponibilidade por endpoint (2026-11-04)**, resumo do que importa ao roteamento:
  - Só Runtime: Claude Mythos 5.1, Opus 4.1/4.5/4.6, Sonnet 4/4.5/4.6, Claude 3 Haiku, DeepSeek-R1, Llama, Mistral Large/Small/Pixtral, Grok 4.7, Kimi K3, GLM 5.3, Palmyra X4/X5.
  - Só Mantle: Claude Mythos 5, GPT-5.4, GPT-5.5, Daybreak Red/Blue (GPT-5.6 Cyber/Sol), Grok 4.3, Gemma 4.
  - Ambos: Claude Haiku 5.5, Sonnet 5/5.5, Opus 4.7/4.8/5/5.5, Fable 5/5.1, Haiku 4.5, GPT-6.1 Sol, GPT-6 Astra/Sol/Luna, GPT-5.6 Sol/Terra/Luna, gpt-oss-*, DeepSeek V3.x, MiniMax M2.x, Kimi K2 Thinking/K2.5, Qwen3, GLM 4.7/5, Nemotron, Mistral (vários), Grok 4.6.
  - Disponibilidade por endpoint não implica disponibilidade em toda região; ver "Regional availability by models".
- **Aposentadoria**: cada cartão traz "EOL no sooner than" (ex.: GPT-6 Sol, lançamento 2026-09-22, EOL não antes de 2027-09-22) e período legado mínimo de 6 meses. Modelos em Legacy/Deprecated não recebem aumento de quota.

### Capacidades

Exemplo detalhado (cartão GPT-6 Sol, docs 2026-11-04):

| Item | Valor |
|---|---|
| Contexto / saída máxima | 1.050.000 / 128.000 tokens |
| Entrada / saída | texto e imagem / texto |
| APIs no Runtime | Responses, Chat Completions, Converse, Invoke (Messages: não) |
| APIs no Mantle | Responses, Chat Completions |
| Raciocínio (`reasoning effort`) | `none`, `low`, `medium`, `high`, `xhigh`, `max`; padrão `medium`. Resumos de raciocínio na Responses. |
| Structured output | `response_format.type=json_schema` (Chat) ou `text.format` (Responses), objeto com `required` completo e `additionalProperties:false`, apenas sem streaming |
| Prompt caching | implícito e explícito (`prompt_cache_options.mode=explicit`, `ttl=30m`, `prompt_cache_breakpoint`), prefixo mínimo 1.024 tokens, até 4 escritas por requisição; resposta traz `cached_tokens` e `cache_write_tokens` |
| Tier de serviço | só Standard (`service_tier` ausente ou `default`) |
| Outros | não suporta `document` no Converse nem imagem dentro de `toolResult`; Guardrails só no Runtime; ferramentas server-side só no Mantle |

Regras do Thinker verificadas por AWS/chamadas: modelos GPT no Runtime rejeitam `max_tokens` (exigem `max_completion_tokens`); isso não está na doc pública (código do Thinker, `verifiedAt 2026-09-28`).

Claude via Messages: extended/adaptive thinking, structured outputs (`output_config.format`), compaction, ferramentas, visão, cache de prompt e mensagens de sistema no meio da conversa são suportados nos dois endpoints.

### Streaming e uso

- Chat Completions: o Thinker pede `stream_options.include_usage` (comportamento do código; a doc não detalha). Responses: eventos padrão da OpenAI; `store` padrão `true` com retenção de 30 dias (respostas ficam na região que serviu); para não reter, enviar `store:false`.
- Uso: `cached_tokens`, `cache_write_tokens` nos detalhes de prompt (modelos OpenAI); Claude usa os campos de cache da Messages API. Quota do Runtime queima tokens de saída com taxa específica por modelo (GPT-6 Sol: 10 para 1).
- Respostas do Mantle em `stream:false` podem vir vazias para GPT-5.x segundo o código do Thinker (`proxy-response-handler.ts:783-787`); não confirmado na doc.

### Preços

- Valores em USD por milhão de tokens (tier Standard), cartão GPT-6 Sol:

| Opção | Entrada | Cache write | Cache read | Saída |
|---|---|---|---|---|
| Mantle in-Region / CRIS geo EUA (até 272 K) | 2,20 | 2,75 | 0,22 | 11,00 |
| CRIS global (até 272 K) | 2,00 | 2,50 | 0,20 | 10,00 |
| Mantle in-Region / CRIS geo EUA (> 272 K) | 4,40 | 5,50 | 0,44 | 16,50 |
| CRIS global (> 272 K) | 4,00 | 5,00 | 0,40 | 15,00 |

- A faixa longa vale para a requisição inteira quando a entrada passa de 272 K tokens.
- Regra geral (guia de CRIS e página de preços): CRIS global ~10% mais barato que o geográfico; sem taxa de roteamento; o preço segue a região de chamada. Tiers: Priority +75%, Flex e Batch −50% (nem todo modelo; GPT-6 Sol só Standard). Cache read do Claude Sonnet 5.5 cai 50% a partir de 2026-10-07 (página de preços).
- Preço por token igual no Runtime e no Mantle para o mesmo modelo.

### Limites e erros

- Runtime: quota por modelo e região em tokens por minuto (entrada + saída somadas, com taxa de queima de saída), mais RPM em alguns modelos (Opus 4.7/4.8 não têm RPM) e um teto diário entre modelos; a quota é compartilhada entre Converse, InvokeModel, Responses e Chat Completions. `max_tokens` reserva quota.
- Mantle: quotas separadas de TPM de entrada e de saída, sem RPM; reserva `entrada + max_tokens`; estourou, 429; tokens lidos do cache não contam. Pode enfileirar requisições brevemente. Recomendado retry com backoff.
- Erros conhecidos: `model <id> isn't supported on this route` (prefixo errado no Mantle), 400 em `background=true` no Runtime, 400 em perfil de aplicação, 404 igual para resposta inexistente/de outra conta, `ValidationException` ao enviar `document` ao GPT-6 Sol via Converse, 403 de entitlement quando a conta não ativou o modelo (observado pelo código, `bedrock-runtime-capabilities.ts`, para `claude-haiku-5-5`). Códigos de erro retentáveis exatos (429/ThrottlingException, 5xx) seguem o padrão AWS; a doc consultada não enumera (não confirmado).
- Parâmetros: `service_tier` só `default` em GPT; Guardrails e prompt caching explícito têm cabeçalhos/campos próprios acima.
- Chat Completions do Runtime nos perfis GPT (`gpt-6-luna`, `-sol`, `-astra`, `gpt-5.6-luna`) rejeita function tools junto de qualquer `reasoning_effort` diferente de `none` (400 "use /v1/responses or set reasoning_effort to 'none'"), e o GPT-6 Astra rejeita `none` (inclusive na Responses). A Responses do Runtime aceita tools + esforço, com `reasoning.summary: auto`, e envia os frames SSE sem linha `event:` (o nome só em `data.type`). Fonte: testes ao vivo do upstream (mnfst/llm-gateway#3110, us-east-1, 2026-11-03); não está na doc pública.
- Claude Fable 5 e 5.1 exigem que o modo de retenção de dados da conta na região seja `aws_review` (ou o legado `provider_data_share`); com `default`, o Runtime responde `400 ValidationException`. O Runtime e o Mantle têm configurações separadas. Fonte: `data-retention.html` citada em mnfst/llm-gateway#3111 (não relida aqui).

## Como o Thinker implementa hoje

Estado conferido contra o código de `onda3` (2026-11-04):

- **Provedor**: `id: 'bedrock'`, nome "AWS Bedrock", placeholder de chave `ABSK...`, tamanho mínimo 100 (`packages/shared/src/providers.ts:98-109`).
- **Seis chaves de endpoint** (`packages/backend/src/routing/proxy/provider-endpoints.ts:239-287`):

| Chave | Host | Caminho | Formato |
|---|---|---|---|
| `bedrock` | Mantle | `/v1/chat/completions` | OpenAI, `Authorization: Bearer`, `stream_options.include_usage` |
| `bedrock-responses` | Mantle | `/openai/v1/responses` se `openai.gpt-[5-9]…`, senão `/v1/responses` | Responses |
| `bedrock-anthropic` | Mantle | `/anthropic/v1/messages` | Anthropic, `x-api-key`, `anthropic-version: 2023-06-01` |
| `bedrock-runtime` | Runtime | `/openai/v1/chat/completions` | OpenAI + `prompt_cache_key` |
| `bedrock-runtime-responses` | Runtime | `/openai/v1/responses` | Responses |
| `bedrock-runtime-anthropic` | Runtime | `/anthropic/v1/messages` | Anthropic |

- **Escolha do endpoint** (`resolveBedrockEndpointKey`, `provider-endpoints.ts:125-149`): perfil CRIS de Claude vai ao Runtime Messages em qualquer modo; perfil CRIS catalogado vai ao Runtime na API chamada; demais IDs seguem o Mantle (OpenAI → Responses, Anthropic → Messages, resto → Chat Completions).
- **Região** (`bedrock-region.ts`): padrão `us-east-1`; lista fechada de 13 regiões do Mantle (`:7-21`); host Mantle `bedrock-mantle.<r>.api.aws`, Runtime `bedrock-runtime.<r>.amazonaws.com`, controle `bedrock.<r>.amazonaws.com`. Detecta região só em chave legada `bedrock-api-key-` (base64 com `X-Amz-Credential`); chave `ABSK` não detecta. Override de endpoint do Mantle é validado (`normalizeBedrockMantleBaseUrl`). A região vem de `providerRegion` (`forward-endpoint-resolver.ts:143-150`, `model-discovery.service.ts:210`).
- **Prefixo CRIS** reconhecido: `global|us|eu|apac` (`bedrock-region.ts:50`).
- **Catálogo Runtime** verificado ao vivo (`bedrock-runtime-capabilities.ts`, 2026-09-28): `moonshotai.kimi-k3`, `openai.gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-luna` (todos Chat + Responses; GPT exigem `max_completion_tokens`). Claude em Runtime Messages (2026-10-01): `claude-sonnet-5`, `sonnet-5-5`, `opus-4-7`, `opus-4-8`, `opus-5`, `opus-5-5`, `haiku-4-5-20251001-v1:0`, `haiku-5-5` (ainda sem 200, só 403 de entitlement), e `fable-5`/`fable-5-1` (200 no upstream em 2026-11-03; exigem o modo de retenção acima).
- **Parâmetros**: GPT no Runtime recebe `max_completion_tokens` e `reasoning_effort`; com function tools e sem esforço, o Thinker injeta `none`.
- **Chat via Responses** (`bedrockRuntimeChatNeedsResponses`, `ProviderClient.resolveEndpoint`): pedido Chat Completions para perfil GPT catalogado com function tools e esforço diferente de `none` (ou qualquer pedido com tools para o Astra, `rejectsReasoningNone`) vai para `bedrock-runtime-responses`, com `reasoning: {effort, summary: 'auto'}` (`acceptsReasoningSummary`); conexão com região guardada ou URL base troca o override pelo modelo Responses no mesmo host. `THINKER_BEDROCK_RUNTIME_CHAT_VIA_RESPONSES=false` desliga. O conversor de stream lê o evento de `data.type` e numera tool calls a partir de 0.
- **Descoberta** (`provider-model-fetcher.service.ts:1015-1019, 1147-1193, 1237-1270`): `GET <mantle>/v1/models` com bearer, junto com `GET <controle>/inference-profiles?type=SYSTEM_DEFINED&maxResults=1000` (perfis ACTIVE com endpoint suportado); se o Mantle voltar vazio, nada é devolvido; falha do controle preserva perfis anteriores. Bloqueio: `voxtral-` (`:465`).
- **Preço/metadados**: sem entradas em `known-model-prices.ts`; preço e nome vêm do models.dev (`amazon-bedrock`, `models-dev-sync.service.ts:38`) usando o ID da AWS (`model-discovery.service.ts:735-741`). Se perfis CRIS (`us.`/`global.`) recebem preço (e com qual taxa) não foi verificado (não confirmado).
- **Cache**: `cache_write_tokens` é lido em `stream-writer.ts` e `anthropic-messages-adapter.ts`; `prompt_cache_options`/`prompt_cache_breakpoint` não aparecem no código (cache explícito da AWS não é encaminhado de forma dedicada).
- **UI**: assunto "Claude, GPT, Kimi, MiniMax, Nova via Amazon Bedrock" (`packages/frontend/src/services/providers.ts:194-196`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/proxy-response-handler.ts`
- `packages/backend/src/routing/bedrock-region.ts`
- `packages/backend/src/routing/bedrock-runtime-capabilities.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/routing/model.controller.ts`
- `packages/frontend/src/services/provider-utils.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`

Outros arquivos que citam `bedrock`: `routing/proxy/anthropic-adapter.ts`, `routing/proxy/anthropic-beta.ts`, `routing/provider.controller.ts`, `routing/routing-core/provider.service.ts`, `model-discovery/model-capabilities.ts`, `routing/vertex-deployment.ts`.

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | Chat Completions no Mantle usa sempre `/v1`, mas alguns modelos (GPT-6 Sol e outros GPT só-Mantle, como 5.4/5.5/6.1) só respondem em `/openai/v1`; a Responses já trata isso, a Chat não. `provider-endpoints.ts:96, 239-245`. Sugestão: reaproveitar `BEDROCK_NAMESPACED_GPT_MODEL_RE` no caminho Chat. Não testado ao vivo. | providers | [#398](https://github.com/patrickbrandao/thinker/issues/398) | resolvida (/openai/v1/chat/completions para GPT só-Mantle; validar com chave) |
| G2 | degradação | Lista de regiões restrita às 13 do Mantle; regiões só-Runtime (us-west-1, ca-central-1, ap-southeast-1, ap-northeast-2, af-south-1, me-*, il-central-1…) e GovCloud caem em us-east-1, embora o Runtime seja o endpoint recomendado e chave longa valha só na região de origem. `bedrock-region.ts:7-21`. | backend-dev | [#399](https://github.com/patrickbrandao/thinker/issues/399) | resolvida (regiões só-Runtime e GovCloud aceitas; Mantle cai em us-east-1 fora das suas 13) |
| G3 | oportunidade | Catálogo Runtime (5 modelos) e de Claude Messages (8) defasados: faltam GPT-6.1 Sol, GPT-5.6 Sol/Terra, Grok 4.6/4.7, GLM 5.3, Fable 5/5.1 etc., e o prefixo CRIS `in.` (e `jp.`/`au.`/`us-gov.` citados no código). Exige verificação ao vivo. `bedrock-runtime-capabilities.ts`, `bedrock-region.ts:50`. | providers | [#400](https://github.com/patrickbrandao/thinker/issues/400) | aberta (prefixo CRIS `in.` aceito; Fable 5/5.1 entraram na lista de Claude Messages com a verificação do upstream; o restante do catálogo Runtime depende de verificação ao vivo com chave) |
| G4 | oportunidade | Cache de prompt explícito da AWS (`prompt_cache_options`, `prompt_cache_breakpoint`, TTL `30m`) não é exposto; só `prompt_cache_key` no Runtime. Custo de `cache_write_tokens` já é lido. Sem issue (retorno incerto). | providers | — | aberta |
| G5 | oportunidade | Preço dos perfis CRIS não é diferenciado: CRIS geo EUA e Mantle in-Region têm +10% sobre o global, e a faixa acima de 272 K tokens custa mais; o Thinker não tem tabela própria para Bedrock e depende do models.dev (não confirmado como trata `us.`/`global.`). Sem issue. | providers | — | aberta |

Pendente para conferência humana com chave real: G1 (caminho Chat no Mantle para `openai.gpt-5.5`/`gpt-6-1-sol`), G3 (modelos novos e `in.`), `ABSK` como prefixo da chave, e se `GET /inference-profiles` aceita a chave bearer em todas as regiões.

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (docs AWS lidos em 2026-11-04). Contrato escrito; "Como o Thinker implementa hoje" conferido; lacunas G1 a G5, issues #398 a #400. Prioridade para o dono de `api-anthropic`: perfis `anthropic.*` em Runtime/Mantle e `count_tokens` ficaram fora deste escopo (ver issue #371 do harness `anthropic-sdk`).
- 2026-11-12: agente `providers` (issue #497): rota Chat→Responses para GPT com tools + raciocínio no Runtime e perfis Fable 5/5.1, a partir de mnfst/llm-gateway#3110 e #3111. Fatos novos marcados com a fonte (testes ao vivo do upstream); `revisado_em` não muda porque a doc da AWS não foi relida.
