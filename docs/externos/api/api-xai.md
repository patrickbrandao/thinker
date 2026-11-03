---
id: api-xai
categoria: api
entidade: xAI
agente: api-xai
thinker_ids: [xai]
revisado_em: null
versao_observada: null
---

# xAI (acesso por API)

Especificação mantida pelo agente `api-xai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://docs.x.ai/docs/overview> | — |
| Models and pricing | <https://docs.x.ai/docs/models> | — |

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

- Base URL `https://api.x.ai` (Chat Completions e Responses).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `xai`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/routing/oauth/xai/xai-oauth.controller.ts`
- `packages/backend/src/routing/oauth/xai/xai-oauth.service.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/OAuthDetailView.tsx`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/pages/Welcome.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
