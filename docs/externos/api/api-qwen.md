---
id: api-qwen
categoria: api
entidade: Alibaba Cloud (Qwen / Model Studio)
agente: api-qwen
thinker_ids: [qwen]
revisado_em: null
versao_observada: null
---

# Alibaba Cloud (Qwen / Model Studio) (acesso por API)

Especificação mantida pelo agente `api-qwen` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Model Studio docs | <https://www.alibabacloud.com/help/en/model-studio/> | — |
| Models | <https://www.alibabacloud.com/help/en/model-studio/models> | — |

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

- Base URL compatível com OpenAI por região (`qwen-region.ts`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `qwen`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/routing/provider.controller.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/routing-core/provider-key.service.ts`
- `packages/backend/src/routing/routing-core/provider.service.ts`
- `packages/backend/src/routing/virtual-models/virtual-model-chain.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
