---
id: api-zai
categoria: api
entidade: Z.ai
agente: api-zai
thinker_ids: [zai]
revisado_em: 2026-11-04
versao_observada: docs.z.ai 2026-11-04 (GLM-5.3 como modelo atual)
---

# Z.ai (acesso por API)

Especificação mantida pelo agente `api-zai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Z.ai (Zhipu) serve os modelos GLM por chave "Standard", cobrada por token, em `https://api.z.ai/api/paas/v4/` (Chat Completions compatível com OpenAI). O Coding Plan (assinatura) usa outra base e outro dossiê: `sub-zai`.
- O modelo atual é `glm-5.3` (contexto 1M, saída até 128K, raciocínio sempre ligado) e `glm-5.3-flash`. Os anteriores (5.2, 5.1, 5, 4.7, 4.6, 4.5) seguem listados nos preços; sem datas de aposentadoria publicadas.
- O Thinker usa a base e o caminho corretos para inferência. As lacunas são: a descoberta de modelos aponta para o host da China (G1, #438) e a conversão de `thinking: disabled` em `reasoning_effort: none` colide com a regra do `glm-5.3` (G2, #439).
- Erros de cota/saldo/limite vêm como HTTP 429 com códigos de negócio (1113, 1302, 1305, 1308...), ver tabela; o tratamento da cota do plano está em #346 (`sub-zai`).
- Não houve chamada real: só leitura de docs e sondagens sem chave (401).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs (quick start) | <https://docs.z.ai/guides/overview/quick-start> | lida em 2026-11-04 |
| Preços | <https://docs.z.ai/guides/overview/pricing> | lida em 2026-11-04 |
| API Chat Completion | <https://docs.z.ai/api-reference/llm/chat-completion> | lida em 2026-11-04 |
| Códigos de erro | <https://docs.z.ai/api-reference/api-code> | lida em 2026-11-04 |
| GLM-5.3 | <https://docs.z.ai/guides/llm/glm-5.3> | lida em 2026-11-04 |
| Thinking | <https://docs.z.ai/guides/capabilities/thinking-mode> | lida em 2026-11-04 |
| Migração para GLM-5.3 | <https://docs.z.ai/guides/overview/migrate-to-glm-new> | lida em 2026-11-04 |
| Parâmetros (max_tokens, concorrência) | <https://docs.z.ai/guides/overview/concept-param> | lida em 2026-11-04 |

Docs sem versão numerada; a data é a da leitura.

## Contrato

### Endpoints e protocolos

| Uso | URL | Fonte |
|---|---|---|
| Chat Completions (Standard) | `POST https://api.z.ai/api/paas/v4/chat/completions` | quick-start |
| Listagem de modelos | `GET https://api.z.ai/api/paas/v4/models` (existe: 401 código `1001` sem chave; formato da resposta não confirmado) | sondagem sem chave, 2026-11-04 |
| Anthropic Messages | `https://api.z.ai/api/anthropic` (citado na página do GLM-5.3) | glm-5.3 |
| Responses | `https://api.z.ai/api/v1` (citado na página do GLM-5.3; (não confirmado) para chave Standard) | glm-5.3 |
| Chat do Coding Plan | `https://api.z.ai/api/coding/paas/v4` (outro dossiê: `sub-zai`) | glm-5.3 |

- Autenticação: `Authorization: Bearer <key>`; o exemplo oficial envia também `Content-Type: application/json` e `Accept-Language: en-US,en`.
- Sem endpoint regional documentado para a Standard no quick-start; o host chinês `open.bigmodel.cn` é a plataforma BigModel, com contas separadas (a existência de `/api/paas/v4/models` ali retorna 401).
- A página do GLM-5.3 diz que assinantes (inclusive expirados) do Coding Plan só acessam o modelo pelo protocolo Chat Completions.
- A chave Standard não consome o Coding Plan e vice-versa (ver #347, `sub-zai`).
- SDKs oficiais: `zai-sdk` (Python) e `ai.z.openapi:zai-sdk` (Java); SDKs OpenAI funcionam trocando a base.

### Modelos

- Ids em minúsculas: `glm-5.3`, `glm-5.3-flash`, `glm-5.3-flashx`, `glm-5.2`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.6`, `glm-4.7-flashx`, `glm-4.7-flash`, `glm-4.5`, `glm-4.5-x`, `glm-4.5-air`, `glm-4.5-airx`, `glm-4.5-flash`, `glm-4-32b-0414-128k` (grafia dos ids a partir dos nomes da tabela de preços; (não confirmado) para `flashx`, `x` e `airx`). Há ainda `GLM-5.3-FlashX-Legal` na tabela.
- Gratuitos: `glm-4.7-flash` e `glm-4.5-flash`.
- Aposentadorias: nenhuma data publicada nas páginas lidas. Guia de migração só manda trocar o id para `glm-5.3`.
- Modelos de visão, imagem, vídeo, áudio e agentes existem em outras linhas de preço; fora do escopo do Thinker.

### Capacidades

| Item | Valor |
|---|---|
| Contexto / saída `glm-5.3`, `glm-5.3-flash` | 1M / 128K (glm-5.3 doc). `max_tokens` padrão 65536, máximo 131072 para 5.3, 5.2, 5.1, 5, 4.7, 4.6 (concept-param) |
| Contexto dos demais | não publicado nas páginas lidas (não confirmado) |
| Tools | até 128 funções; `tool_choice` só `auto` |
| `tool_stream` | `true` transmite argumentos de tool call; GLM-5.3, 5.2, 5.1, 5, 4.7, 4.6 |
| Saída estruturada | `response_format: {type: json_object}` só em modelos de texto |
| Visão | `glm-5.3` é só texto; `glm-5.3-flash` é multimodal (visão), com `reasoning_effort` `max|high|low` e só tools de função |
| Amostragem | `temperature` [0,1] padrão 1.0; `top_p` [0.01,1] padrão 0.95; `do_sample: false` ignora ambos; a doc desaconselha ajustar os dois |

**Raciocínio**

- `thinking: {type: enabled|disabled, clear_thinking: bool}`; padrão `enabled`.
- `glm-5.3` e `glm-5.3-flash`: raciocínio forçado. `type: disabled` gera erro; migração: enviar `enabled` com `reasoning_effort: low`.
- `glm-5.2`, `5.1`, `5`, `4.7`: ligado por padrão, pode desligar. `glm-4.6`: híbrido padrão.
- `reasoning_effort` (só com raciocínio ligado): API geral cita `max, xhigh, high, medium, low, minimal, none` (visão: `max, high, low`); a página do GLM-5.3 restringe a `low|high|max`, padrão `max`.
- O raciocínio vem em `delta.reasoning_content` (não consta no schema da resposta). Interleaved thinking ligado por padrão; para raciocínio preservado (`clear_thinking: false`) o `reasoning_content` deve voltar intacto e na ordem. Preservado já vem ligado no endpoint do Coding Plan e desligado no padrão.

### Streaming e uso

- `stream: true` entrega eventos SSE e termina com `data: [DONE]`.
- `finish_reason`: `stop`, `tool_calls`, `length`, `sensitive`, `model_context_window_exceeded`, `network_error`. Em streaming, falha anormal aparece em `finish_reason`, não como código de erro.
- `usage`: `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`. Tokens de raciocínio separados: não documentados (não confirmado se vêm dentro de `completion_tokens`).
- Cache de contexto é implícito (preço "Cached Input"); o armazenamento do cache está grátis por tempo limitado.

### Preços

USD por 1M tokens (pricing, 2026-11-04). Sem faixas por contexto nem tiers.

| Modelo | Entrada | Entrada em cache | Saída |
|---|---|---|---|
| glm-5.3 | 1,40 | 0,26 | 4,40 |
| glm-5.3-flash | 0,15 | 0,03 | 0,50 |
| glm-5.3-flashx | 0,37 | 0,075 | 1,25 |
| glm-5.2 / glm-5.1 | 1,40 | 0,26 | 4,40 |
| glm-5 | 1,00 | 0,20 | 3,20 |
| glm-4.7 / glm-4.6 / glm-4.5 | 0,60 | 0,11 | 2,20 |
| glm-4.7-flashx | 0,07 | 0,01 | 0,40 |
| glm-4.5-x | 2,20 | 0,45 | 8,90 |
| glm-4.5-air | 0,20 | 0,03 | 1,10 |
| glm-4.5-airx | 1,10 | 0,22 | 4,50 |
| glm-4-32b-0414-128k | 0,10 | n/d | 0,10 |
| glm-4.7-flash, glm-4.5-flash | grátis | grátis | grátis |

### Limites e erros

HTTP: 400 parâmetro/modelo, 401 autenticação, 403 sem permissão, 429 limite/saldo/plano, 500 interno. Corpo: `{"error":{"code":"...","message":"..."}}` (confirmado com chave inválida: `401` "token expired or incorrect"; sem header: `1001`).

| Código | HTTP | Significado | Tratamento |
|---|---|---|---|
| 1000, 1001, 1003, 1005 | 401 | autenticação, header ausente, token expirado, 2FA | chave inválida |
| 1113 | 429 | saldo insuficiente ou sem pacote | cota/saldo (não retentar) |
| 1302 | 429 | taxa de requisições | retentável |
| 1305 | 429 | serviço sobrecarregado | retentável |
| 1308, 1310 | 429 | limite de uso/semanal/mensal, com horário de reset | cota até o reset |
| 1309, 1311, 1313-1315 | 429 | plano expirado, modelo fora do plano, uso abusivo, pacote enterprise | específicos de plano |
| 1316-1321 | 429 | limites de 5 h e 7 dias sem saldo extra | cota até o reset |
| 1210-1215 | 400 | parâmetro inválido, modelo desconhecido (1211), método não suportado (1212), campos incompatíveis (1215) | erro do cliente |
| 1220-1222 | 403/400 | sem permissão, API offline ou inexistente | |
| 1261 | 400 | prompt longo demais | |
| 1301 | 400 | conteúdo sensível | |
| 1200, 1230, 1234 | 500 | erro interno/rede | retentável |

Limites numéricos de taxa e cabeçalhos de rate limit: não documentados; a concorrência depende da conta (concept-param).

Parâmetros: `tool_choice` diferente de `auto` não suportado; `response_format` só em texto; `thinking: disabled` proibido no GLM-5.3.

## Como o Thinker implementa hoje

- Provedor `zai`, nome "Z.ai", alias `z.ai`, prefixos OpenRouter `z-ai` e `zhipuai`, exige chave, tamanho mínimo 30 (`packages/shared/src/providers.ts:480-491`). Ids `glm-*` inferem o provedor `zai` (`packages/shared/src/provider-inference.ts:20`).
- Inferência: base `https://api.z.ai`, caminho `/api/paas/v4/chat/completions`, formato `openai`, `Authorization: Bearer`, uso em stream via `openaiStreamUsage` (`packages/backend/src/routing/proxy/provider-endpoints.ts:473-479`). Correto frente ao contrato. Não usa o endpoint Anthropic/Responses da Z.ai.
- Coding Plan (`zai-subscription`): bases `https://api.z.ai/api/coding/paas/v4` e `https://open.bigmodel.cn/api/coding/paas/v4` (região `cn`) (`packages/backend/src/routing/zai-region.ts:1-4`, `provider-endpoints.ts:480-486`, `forward-endpoint-resolver.ts:113-118`, `:176-177`).
- Descoberta de modelos: `zai` consulta `https://open.bigmodel.cn/api/paas/v4/models` com Bearer e parse OpenAI (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:990-994`); `zai` com autenticação por assinatura vira `zai-subscription` (`:1107-1108`). Divergência: ver G1.
- Preços: nenhum `glm` em `known-model-prices.ts`; os preços vêm da sincronização de catálogos (`models-dev-sync.service.ts:43`, `zai: 'zai'`) e de `model-capabilities.ts:38`.
- Raciocínio: `glm-*` é família de raciocínio (`reasoning-format.ts:42`); `thinking: disabled` de entrada Anthropic vira `reasoning_effort: none` (`provider-client.ts:296-320`). Não há tratamento específico de `glm-5.3`, `clear_thinking`, `tool_stream` ou `reasoning_content` preservado.
- Erros 429 de negócio: não há tratamento específico dos códigos 1113/1302/1305; seguem o fluxo genérico de 429 (não conferido linha a linha).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`

Arquivos que citam `zai`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/zai-region.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | A descoberta de modelos de `zai` consulta `open.bigmodel.cn` (plataforma chinesa) enquanto a inferência usa `api.z.ai`; chave global tende a falhar na listagem (`provider-model-fetcher.service.ts:990-992`). Trocar para `https://api.z.ai/api/paas/v4/models`. | providers | [#438](https://github.com/patrickbrandao/thinker/issues/438) | aberta |
| G2 | degradação | `glm-5.3*` não aceita raciocínio desligado nem `reasoning_effort: none`; o Thinker converte `thinking: disabled` em `none` (`provider-client.ts:296-320`). Mapear para `low` e limitar a `low|high|max`. (não confirmado com chamada real) | providers | [#439](https://github.com/patrickbrandao/thinker/issues/439) | aberta |
| G3 | degradação | 429 de saldo/limite (1113, 1302, 1305, 1308, 1310, 1316-1321) sem tratamento por código: cooldown curto em vez do reset ou espera de saldo. Mesma causa de #346. | backend-dev | [#346](https://github.com/patrickbrandao/thinker/issues/346) (sub-zai) | aberta |
| G4 | oportunidade | Parâmetros específicos não expostos: `clear_thinking`/raciocínio preservado, `tool_stream`, `reasoning_effort` fino e `reasoning_content` de volta no histórico. Pode melhorar cache e qualidade em agentes. | providers | — | aberta |
| G5 | oportunidade | Z.ai serve Anthropic Messages (`/api/anthropic`) e Responses (`/api/v1`); o Thinker só usa Chat Completions. Para chave Standard é (não confirmado). | providers | — | aberta |

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
- 2026-11-04: primeira revisão completa (docs.z.ai, sondagens sem chave). Contrato escrito; G1 e G2 abertas como issues #438 e #439; G3 ligada a #346.
