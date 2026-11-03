---
id: api-groq
categoria: api
entidade: Groq
agente: api-groq
thinker_ids: [groq]
revisado_em: null
versao_observada: null
---

# Groq (acesso por API)

Especificação mantida pelo agente `api-groq` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Docs | <https://console.groq.com/docs/overview> | — |
| Models | <https://console.groq.com/docs/models> | — |
| Deprecations | <https://console.groq.com/docs/deprecations> | — |
| Pricing | <https://groq.com/pricing> | — |

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

- Base URL `https://api.groq.com/openai`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `groq`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/pages/Welcome.tsx`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
