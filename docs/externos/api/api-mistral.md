---
id: api-mistral
categoria: api
entidade: Mistral
agente: api-mistral
thinker_ids: [mistral]
revisado_em: 2026-11-04
versao_observada: docs 2026-11-04 (changelog até 2026-10-22; Mistral Large 4 em Public Preview, Medium 3.5 e Large 3 deprecados em 2026-10-31)
---

# Mistral (acesso por API)

Especificação mantida pelo agente `api-mistral` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md). A assinatura Vibe é coberta por `sub-mistral`.

## Resumo

- Uma superfície só: Chat Completions em `https://api.mistral.ai/v1/chat/completions`, `Authorization: Bearer`.
- Geração atual: Mistral Small 4 (`mistral-small-2603`), Mistral Large 4 (`mistral-large-4`, Public Preview desde 2026-10-06), Ministral 3 (3B/8B/14B). Medium 3.5 e Large 3 estão deprecados desde 2026-10-31 (retirada em 2027-04-30).
- A Mistral passou a hospedar modelos de terceiros na mesma API (Z.ai GLM 5.3 e GLM 5.3 Flash; DeepSeek V4.1 Flash aparece na lista de modelos).
- Raciocínio sai em `message.content` como lista de blocos (`thinking`/`text`), não em `reasoning_content` (G2, #435). `reasoning_effort` é descartado pelo Thinker (G1, #434).
- A descoberta do Thinker oculta modelos com `deprecation` preenchido, ainda que sigam atendendo até a retirada (G3, #436). A inferência por nome não cobre `ministral-`, `devstral-`, `magistral-`, `voxtral-` (G4, #437).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://docs.mistral.ai/> | 2026-11-04 |
| Models | <https://docs.mistral.ai/getting-started/models/> | 2026-11-04 (tabelas de modelos atuais e deprecados) |
| Changelog | <https://docs.mistral.ai/getting-started/changelog/> | entrada de 2026-10-22 |
| Pricing | <https://mistral.ai/pricing#api-pricing> | 2026-11-04 (só Mistral Large publicado) |
| Chat Completions (referência) | <https://docs.mistral.ai/api/endpoint/chat> | 2026-11-04 |
| Models endpoint | <https://docs.mistral.ai/api/endpoint/models> | 2026-11-04 |
| Reasoning | <https://docs.mistral.ai/capabilities/reasoning/> | 2026-11-04 |
| Function calling | <https://docs.mistral.ai/capabilities/function_calling/> | 2026-11-04 |
| Vision | <https://docs.mistral.ai/capabilities/vision/> | 2026-11-04 |
| Limites | <https://docs.mistral.ai/admin/user-management-finops/tier/> | 2026-11-04 |

Leituras por resumo de página (WebFetch); nenhum SDK oficial foi lido nesta revisão. A página de preços e as páginas de modelo individuais (`/models/...`) não renderizaram dados úteis.

## Contrato

### Endpoints e protocolos

| Item | Valor |
|---|---|
| Base URL | `https://api.mistral.ai` (sem escolha de região documentada nesta revisão) |
| Chat | `POST /v1/chat/completions`, formato OpenAI, SSE terminado por `data: [DONE]` |
| Auth | `Authorization: Bearer <key>` |
| Listagem | `GET /v1/models` |
| Outros (fora do escopo do gateway de chat) | OCR, transcrição de áudio, TTS, embeddings, moderação, Agents/Conversations, batch |

Não há endpoint Anthropic Messages nem Responses documentado nesta revisão (não confirmado).

### Modelos

Ids e estado vistos na página de modelos (2026-11-04). Janelas de contexto não aparecem nessa página; vêm de `max_context_length` em `GET /v1/models`.

| Modelo | Id da API | Estado |
|---|---|---|
| Mistral Large 4 (26.10) | `mistral-large-4` (a página de raciocínio usa `mistral-large-4-0`; não confirmado qual é o alias) | Public Preview desde 2026-10-06 |
| Mistral Small 4 (26.03) | `mistral-small-2603` | vigente, Apache 2.0 |
| Mistral Medium 3.5 (26.04) | `mistral-medium-3-5` | deprecado 2026-10-31, retirada 2027-04-30; substituto Large 4 |
| Mistral Large 3 (25.12) | `mistral-large-2512` | deprecado 2026-10-31, retirada 2027-04-30 |
| Ministral 3 14B / 8B / 3B (25.12) | `ministral-14b-2512`, `ministral-8b-2512`, `ministral-3b-2512` | vigentes, com visão |
| Codestral (25.08) | `codestral-2508` (id exato não confirmado) | vigente |
| Voxtral Small (25.07) | `voxtral-small-2507` (não confirmado) | vigente, entrada de áudio |
| Z.ai GLM 5.3 / 5.3 Flash | `zai-glm-5-3`, `zai-glm-5-3-flash` | hospedados; GLM 5.2 (`zai-glm-5-2`) sai em 2026-10-31 |
| Não-chat | `mistral-ocr-4-1`, `mistral-moderation-2603`, `voxtral-tts-*`, `voxtral-mini-*transcribe*`, `mistral-embed`, `codestral-embed`, `labs-*` | não servem chat |

Já retirados ou em retirada (substituto): `mistral-medium-2508` e `mistral-small-2506` (2026-07/08), `devstral-2512`, `magistral-*` (todos), `pixtral-*`, `ministral-3b-2410`/`8b-2410`, `open-mistral-nemo-2407` (2026-07-31), `mistral-large-2411`. Tabela completa na página de modelos.

Aliases `-latest` existem (`mistral-ocr-latest` citado no changelog); a lista exata por modelo vem do campo `aliases` de `/v1/models`.

Listagem: cada entrada tem `id`, `object`, `created`, `owned_by`, `max_context_length`, `aliases`, `archived`, e `capabilities` com `completion_chat`, `completion_fim`, `function_calling`, `fine_tuning`, `vision`, `classification`. O campo `deprecation` que o Thinker lê não aparece na referência (não confirmado).

### Capacidades

- Tools: `tools` com `tool_choice` `none`/`auto`/`any`/`required` ou função específica; `parallel_tool_calls` padrão `true`. Mensagem de resultado: `role: "tool"` com `tool_call_id` e `name`.
- Formato do id de tool call: a doc não declara restrição; o exemplo tem 9 caracteres alfanuméricos. O Thinker normaliza para `^[A-Za-z0-9]{9}$`, comportamento antigo que a API historicamente impõe (não reconfirmado nesta revisão).
- Visão: `image_url` como string no array `content` do usuário. Suportada em Large 4/3, Medium, Small 3.2/4 e Ministral 3 (conferir `capabilities.vision`).
- Raciocínio: `reasoning_effort`. Small 4 e Medium 3.5: `high` ou `none`. Large 4: `low`, `medium`, `high` (não aceita `none`, `minimal`, `xhigh`, `max`). GLM 5.3: `low`, `high`, `max`. A referência de chat lista a faixa genérica `none` a `xhigh`. Também há `prompt_mode: "reasoning"`.
- Saída de raciocínio: com `high`, `message.content` é lista de `{type:"thinking", thinking:[{type:"text"}]}` e `{type:"text"}`; com `none`, string. No stream `delta.content` passa por lista com thinking, lista mista e string. O histórico deve reenviar o bloco de thinking.
- Saída estruturada: `response_format` `text`, `json_object`, `json_schema`.
- Outros parâmetros: `prediction`, `guardrails` (desde 2026-03-12), `service_tier` (`auto`/`standard_only`), `top_k`, `min_tokens`, `random_seed`, `n`, penalidades, logprobs.
- Cache de prompt: `prompt_cache_key` agrupa requisições com mesmo prefixo; tokens em cache custam 10% da entrada.

### Streaming e uso

- `stream` padrão `false`; SSE só com `data:`, termina em `[DONE]`.
- `usage` (`UsageInfo`) vem em toda resposta. Os campos de cache e raciocínio não estão detalhados na referência; `stream_options` não é descrito na página (não confirmado se `include_usage` é aceito ou se o uso sempre vem no último chunk).

### Preços

- Página pública mostra só Mistral Large: US$ 0,50 entrada / US$ 1,50 saída por 1M tokens (não confirmado se vale para Large 4 ou 3). Medium, Small e Voxtral são citados sem preço na página.
- Cache: até 90% de desconto na entrada (10% do preço); batch: 50% de desconto. OCR por 1.000 páginas, voz por minuto, ferramentas por chamada.
- Preços por modelo não foram obtidos; o Thinker os herda de catálogos externos (ver abaixo).

### Limites e erros

- Limites por modelo: tokens por minuto e requisições por segundo (áudio: segundos por minuto/mês; OCR: páginas por minuto). Painel: Admin Panel > API > Limits. Plano gratuito inclui uso mensal limitado; pay-as-you-go consome crédito pré-pago. Limite de gasto mensal da organização pode suspender o acesso. Aumento de limite sob pedido ao suporte.
- Códigos e cabeçalhos de limite: não documentados nas páginas lidas. Comportamento típico (401 chave inválida, 422 parâmetro inválido, 429 limite) é presumido (não confirmado).

## Como o Thinker implementa hoje

- Cadastro: id `mistral`, nome `Mistral`, prefixo OpenRouter `mistralai`, chave sem prefixo fixo e mínimo de 32 caracteres (`packages/shared/src/providers.ts:309`). URL de criação de chave: `https://console.mistral.ai/api-keys/` (`packages/frontend/src/services/provider-api-key-urls.ts:16`).
- Endpoint: base `https://api.mistral.ai`, caminho `/v1/chat/completions`, cabeçalhos `Authorization: Bearer` e `Content-Type`, formato `openai`, `stream_options.include_usage` ativado (`packages/backend/src/routing/proxy/provider-endpoints.ts:371`, `:84-96`).
- Corpo: `prompt_cache_key` com hash do cache de provedor (`packages/backend/src/routing/proxy/provider-client.ts:937`). `reasoning_effort` é removido (só xai, deepseek e minimax mantêm; `provider-client-converters.ts:468-476`, G1). O `thinking` da Anthropic é repassado sem tradução.
- Tool call ids: reescritos para 9 caracteres alfanuméricos, preservando os que já são válidos e gerando `tc0000001`-style sem colisão (`provider-client-converters.ts:133`, `:309-396`).
- Descoberta: `GET https://api.mistral.ai/v1/models` com Bearer (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:917`). `parseMistral` descarta entradas com `deprecation` e com `capabilities.completion_chat === false` (`:514-534`, G3). Filtro de não-chat: `^mistral-ocr`, `moderation`, `voxtral-*-transcribe|realtime`, `^labs-`, `^mistral-vibe-cli` (`:442`); bloqueio fixo de `voxtral-mini-2602` (`:481`).
- Inferência por nome: `^mistral-|^codestral|^pixtral|^open-mistral` (`packages/shared/src/provider-inference.ts:14`, G4).
- Preços e capacidades: sincronizados do models.dev (`mistral: 'mistral'` em `packages/backend/src/database/models-dev-sync.service.ts:36`), com aliases de renomeação (`:250-251`) e fallback `-latest`; não há tabela própria em `known-model-prices.ts`. Lista de provedores com capacidades de modelo em `packages/backend/src/model-discovery/model-capabilities.ts:26`.
- Assinatura Vibe reaproveita o mesmo host e id de configuração `mistral-subscription` (`provider-model-fetcher.service.ts:922`, `:1097`); fica com `sub-mistral`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/frontend/src/services/provider-api-key-urls.ts`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | oportunidade | `reasoning_effort` (Small 4, Medium 3.5, Large 4) é removido para `mistral`; `thinking` Anthropic vai sem tradução (`provider-client-converters.ts:468`) | providers | [#434](https://github.com/patrickbrandao/thinker/issues/434) | aberta |
| G2 | degradação | Raciocínio volta como lista de blocos em `content`, sem conversão para `reasoning_content` nem para blocos thinking da Anthropic (não confirmado em tráfego real) | providers | [#435](https://github.com/patrickbrandao/thinker/issues/435) | aberta |
| G3 | degradação | `parseMistral` oculta modelos com `deprecation`, mas Medium 3.5 e Large 3 seguem ativos até 2027-04-30; Large 4 precisa entrar na descoberta | providers | [#436](https://github.com/patrickbrandao/thinker/issues/436) | aberta |
| G4 | degradação | Regex de inferência não cobre `ministral-`, `magistral-`, `devstral-`, `voxtral-` | providers | [#437](https://github.com/patrickbrandao/thinker/issues/437) | aberta |

Relacionadas à assinatura (não duplicadas aqui): #336 e #337 (`sub-mistral`).

## Verificações para o mantenedor com chave real

- Conferir o campo `deprecation` e `aliases` em `GET /v1/models`, e se o id de Large 4 é `mistral-large-4` ou `mistral-large-4-0`.
- Conferir se `stream_options.include_usage` é aceito e quais campos de cache aparecem em `usage`.
- Conferir se `thinking` (Anthropic) provoca 422.
- Conferir preços por modelo no console, pois a página pública só mostra o Large.

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa. Contrato preenchido a partir da documentação (modelos, changelog até 2026-10-22, referência de chat, raciocínio, tools, visão). Quatro lacunas abertas (#434 a #437).
