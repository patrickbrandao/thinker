---
id: api-openai
categoria: api
entidade: OpenAI
agente: api-openai
thinker_ids: [openai]
revisado_em: null
versao_observada: null
---

# OpenAI (acesso por API)

Especificação mantida pelo agente `api-openai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| API reference | <https://platform.openai.com/docs/api-reference> | — |
| Models | <https://platform.openai.com/docs/models> | — |
| Pricing | <https://platform.openai.com/docs/pricing> | — |
| Changelog | <https://platform.openai.com/docs/changelog> | — |
| OpenAPI spec | <https://github.com/openai/openai-openapi> | — |

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

- Base URL `https://api.openai.com` (Chat Completions e Responses).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `openai`:

- `packages/backend/src/database/database-seeder.service.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/database/seed-cohorts.ts`
- `packages/backend/src/entities/custom-provider.entity.ts`
- `packages/backend/src/mcp/tools/models.tools.ts`
- `packages/backend/src/mcp/tools/providers.tools.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/routing/custom-provider/custom-provider.controller.ts`
- `packages/backend/src/routing/custom-provider/custom-provider.service.ts`
- `packages/backend/src/routing/dto/custom-provider.dto.ts`
- `packages/backend/src/routing/oauth/openai/openai-oauth.controller.ts`
- `packages/backend/src/routing/oauth/openai/openai-oauth.service.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- … e mais 15 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
