---
id: api-vertex
categoria: api
entidade: Google Vertex AI
agente: api-vertex
thinker_ids: [vertex]
revisado_em: null
versao_observada: null
---

# Google Vertex AI (acesso por API)

Especificação mantida pelo agente `api-vertex` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Generative AI docs | <https://cloud.google.com/vertex-ai/generative-ai/docs/overview> | — |
| Claude on Vertex | <https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude> | — |
| OpenAI-compatible API | <https://cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview> | — |
| Pricing | <https://cloud.google.com/vertex-ai/generative-ai/pricing> | — |

## Contrato

### Endpoints e protocolos

_(pendente)_

### Modelos

_(pendente)_

### Capacidades

_(pendente)_

### Streaming e uso

_(pendente)_

### Preços

_(pendente)_

### Limites e erros

_(pendente)_

## Como o Thinker implementa hoje

Estado extraído do código em 2026-11-03 (não conferido com as fontes):

- Base URL `https://aiplatform.googleapis.com/v1beta1`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `vertex`:

- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
