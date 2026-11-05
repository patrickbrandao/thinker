---
id: sub-ollama-cloud
categoria: assinatura
entidade: Ollama Cloud
agente: sub-ollama-cloud
thinker_ids: [ollama-cloud]
revisado_em: 2026-11-03
versao_observada: docs 2026-11-03; ollama v0.40.14
---

# Ollama Cloud (assinatura)

Especificação mantida pelo agente `sub-ollama-cloud` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

## Resumo

- Ollama Cloud é o serviço hospedado do Ollama em `https://ollama.com`. A credencial é uma **chave de API** (não OAuth), enviada como `Authorization: Bearer`, que não expira e é revogável.
- Três superfícies: nativa (`/api/chat`, `/api/tags`), OpenAI (`/v1/...`) e Anthropic (`/v1/messages`). O Thinker usa Chat Completions em `/v1/chat/completions` e lista modelos em `/api/tags`.
- Planos hoje: Pay as you go (US$ 0, créditos por token), Pro (US$ 20/mês, US$ 60 em créditos), Max (US$ 100/mês, US$ 300), Team e Enterprise. O limite é por **créditos de uso em tokens** e por **concorrência** (3 ou 10), não mais por janelas de sessão/semana.
- Lacuna principal: campos não suportados pelo serviço (`tool_choice` etc.) seguem no pedido (G1). Não existe endpoint público de uso restante.
- Confiança: média-alta no contrato de API (docs oficiais), baixa no comportamento de erros e termos (docs não cobrem).

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Ollama Cloud docs | <https://docs.ollama.com/cloud> | 2026-11-03 |
| Autenticação | <https://docs.ollama.com/api/authentication> | 2026-11-03 |
| Compatibilidade OpenAI | <https://docs.ollama.com/api/openai-compatibility> | 2026-11-03 |
| Compatibilidade Anthropic | <https://docs.ollama.com/api/anthropic-compatibility> | 2026-11-03 |
| Erros | <https://docs.ollama.com/api/errors> | 2026-11-03 |
| `/api/tags` | <https://docs.ollama.com/api/tags> | 2026-11-03 |
| Pricing | <https://ollama.com/pricing> | 2026-11-03 |
| Catálogo cloud | <https://ollama.com/search?c=cloud> | 2026-11-03 (20 modelos) |
| Ollama repository (releases) | <https://github.com/ollama/ollama> | v0.40.14 (2026-11-03); v0.40.15-rc0 |

## Contrato

### Planos

Fonte: <https://ollama.com/pricing> (2026-11-03).

| Plano | Preço | Concorrência | Créditos incluídos |
|---|---|---|---|
| Pay as you go | US$ 0 | 3 | nenhum; paga por token |
| Pro | US$ 20/mês (US$ 200/ano) | 3 | US$ 60/mês |
| Max | US$ 100/mês | 10 | US$ 300/mês |
| Team | US$ 500/mês (early access) | 10 | US$ 1.000/mês, compartilhado |
| Enterprise | sob consulta | n/d | n/d |

- Créditos reiniciam mensalmente no dia da assinatura, mesmo em plano anual; não acumulam. Uso é medido em tokens pelas tarifas de cada modelo.
- Acima da concorrência, os pedidos entram em fila de tamanho fixo; com a fila cheia são rejeitados até abrir vaga (código HTTP não documentado).
- Pro e Max antigos tinham limites de sessão e semana; esses limites acabam ao migrar para o plano atual. Modelos "Pro" maiores são restritos a planos pagos; Max tem acesso antecipado aos mais novos.

### Autenticação

- Criar chave em ollama.com/settings/keys; enviar `Authorization: Bearer <chave>`. Chaves não expiram. Não há OAuth, refresh nem client id.
- No `/v1/messages` a chave só em `x-api-key` **não** é aceita (<https://docs.ollama.com/api/authentication>).
- Via servidor local, `ollama signin` autentica modelos `:cloud` sem chave (caminho do agente `local-ollama`).

### Endpoints

| Superfície | URL | Observações |
|---|---|---|
| Nativa chat | `POST https://ollama.com/api/chat` | NDJSON; erro no meio do stream vem como objeto `error` final |
| Nativa lista | `GET https://ollama.com/api/tags` | `models[]` com `name`, `model`, `remote_model`, `remote_host`, `modified_at`, `size`, `digest`, `details`; **sem janela de contexto nem capacidades** |
| OpenAI | `https://ollama.com/v1` | `chat/completions`, `completions`, `models`, `embeddings`, áudio, `responses` (stateless) |
| Anthropic | `POST https://ollama.com/v1/messages` | exige `anthropic-version: 2023-06-01` e `Authorization: Bearer` |

Campos não suportados:

- Chat Completions: `logprobs`, URLs de imagem (só base64), `tool_choice`, `logit_bias`, `user`, `n`.
- Responses: sem estado (`previous_response_id`, `conversation`, `truncation` não suportados), sem busca web embutida.
- Messages: `tool_choice`, `metadata`, `count_tokens`, `cache_control`, batches, citações, blocos `document` PDF; `budget_tokens` aceito mas não aplicado; `output_config` só `effort`; erros em stream viram status HTTP.

Detalhes de comportamento (v0.40.14): endpoints OpenAI não sobrescrevem mais os valores padrão de amostragem do modelo quando o cliente não envia `temperature`/`top_p`; busca web em `/api/chat` foi corrigida.

### Identificação do cliente

Nenhum User-Agent, cabeçalho customizado nem gate de versão documentado para a API direta. O cliente oficial é a CLI `ollama` (v0.40.14), que só importa no caminho `ollama launch`, fora do escopo do Thinker.

### Clientes permitidos e termos

A documentação não menciona gateways nem política de uso aceitável. Os dados não são usados para treino. Risco de ação na conta ao rotear por gateway: `(não confirmado)`; plano de cobrança por token com chave de API é o uso previsto.

### Cotas e uso

- Uso restante só na página de configurações (ollama.com/settings/usage). Não há endpoint público nem cabeçalhos de uso documentados.
- Respostas nativas trazem `prompt_eval_count`, `prompt_eval_cached_count`, `eval_count` e durações em ns.
- Aposentadorias de modelo aparecem na página de uso; modelos locais não são afetados.

### Erros

Formato `{"error": "..."}`. Códigos documentados: 400, 404 (modelo inexistente), 429 (limite excedido), 500, 502 (modelo cloud inalcançável). 401, 402 e 503 não documentados.

### Modelos

Catálogo cloud em 2026-11-03 (20 modelos): deepseek-v4.1-flash, deepseek-v4-pro, glm-5.3, glm-5.3-flash, glm-5.2, beam, minimax-m3.1-flash, minimax-m3, minimax-m2.7, muse-spark-open, mistral-large-4, clef, kimi-k2.7-code, kimi-k3, nemotron-3-ultra, nemotron-3-super, nemotron-3-nano, mimo-v2.6-flash, mimo-v2.6-pro, gemma4. Nome de API sem sufixo `:cloud` (ex.: `gemma4:31b`); `:cloud` só na CLI/app. Janelas chegam a 1M (Nemotron 3.5 Super, release v0.40.5).

## Como o Thinker implementa hoje

- Autenticação: chave de API colada, modo `token`, sem prefixo (`packages/shared/src/subscription/configs.ts:205`); só assinatura na UI (`packages/frontend/src/services/providers.ts:482`); link de criação da chave `packages/frontend/src/services/provider-api-key-urls.ts:20`.
- Inferência: `https://ollama.com` (`packages/backend/src/common/constants/ollama.ts:5`) + `/v1/chat/completions`, `Authorization: Bearer`, formato `openai` com usage em stream (`packages/backend/src/routing/proxy/provider-endpoints.ts:592`, `:86`, `:96`).
- Listagem: `GET /api/tags` com Bearer, ids sem `:latest`, preço 0, qualidade 2 (`packages/backend/src/model-discovery/provider-model-fetcher.service.ts:1036`, `parseOllama` `:719`).
- Capacidades/contexto: vêm do models.dev (`packages/backend/src/database/models-dev-sync.service.ts:48`, remoção de tag `:preview`/ano `:569`); `maxContextWindow: 128000` é o fallback (`configs.ts:210`).
- Modelo sem prefixo de fornecedor preservado (`packages/backend/src/routing/proxy/provider-client.ts:354`).
- Pedido: apenas `thinking` é removido (`packages/backend/src/routing/proxy/provider-client-converters.ts:132`, `:483`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/common/constants/ollama.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`

Arquivos que citam `ollama-cloud`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/provider-api-key-urls.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|
| G1 | degradação | `tool_choice`, `user`, `n`, `logit_bias`, `logprobs` não são suportados em `/v1/chat/completions`, mas seguem no pedido (só `thinking` é removido). Se ignorados, tool forçada falha em silêncio; se rejeitados, 400 `(não confirmado)`. | providers | [#338](https://github.com/patrickbrandao/thinker/issues/338) | resolvida (política de parâmetros: param-policy.ts) |
| G2 | oportunidade | Cobrança agora é por créditos em tokens; `parseOllama` grava preço 0, então o custo no Thinker fica 0 mesmo consumindo créditos. Preços por modelo não estão em fonte pública vista (`(não confirmado)`); avaliar models.dev. | providers | — | aberta |
| G3 | oportunidade | `/v1/messages` nativo (thinking, tools, sem cache) permitiria passthrough Anthropic sem conversão; exige `anthropic-version` e Bearer. | providers | — | aberta |
| G4 | oportunidade | Concorrência de 3 (Pro/Pay as you go) ou 10 (Max) com fila finita; limitar paralelismo por conexão evitaria rejeições. Código da rejeição desconhecido. | backend-dev | — | aberta |

## Histórico

- 2026-11-03: primeira revisão completa (docs oficiais, pricing, releases até v0.40.14). G1 a G4 registradas; issue #338 aberta para G1.
