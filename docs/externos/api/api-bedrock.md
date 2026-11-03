---
id: api-bedrock
categoria: api
entidade: AWS Bedrock
agente: api-bedrock
thinker_ids: [bedrock]
revisado_em: null
versao_observada: null
---

# AWS Bedrock (acesso por API)

Especificação mantida pelo agente `api-bedrock` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| User guide | <https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html> | — |
| Supported models and regions | <https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html> | — |
| API reference | <https://docs.aws.amazon.com/bedrock/latest/APIReference/welcome.html> | — |
| OpenAI-compatible endpoints | <https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html> | — |
| Pricing | <https://aws.amazon.com/bedrock/pricing/> | — |

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

- Endpoints Runtime (`bedrock-runtime`) e Mantle, com variantes Anthropic e Responses (`provider-endpoints.ts`).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `bedrock`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/routing/bedrock-region.ts`
- `packages/backend/src/routing/model.controller.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/provider-utils.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
