---
id: api-anthropic
categoria: api
entidade: Anthropic
agente: api-anthropic
thinker_ids: [anthropic]
revisado_em: null
versao_observada: null
---

# Anthropic (acesso por API)

Especificação mantida pelo agente `api-anthropic` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| API reference | <https://docs.claude.com/en/api/overview> | — |
| Models overview | <https://docs.claude.com/en/docs/about-claude/models/overview> | — |
| Model deprecations | <https://docs.claude.com/en/docs/about-claude/model-deprecations> | — |
| Pricing | <https://claude.com/pricing#api> | — |
| API release notes | <https://docs.claude.com/en/release-notes/api> | — |
| TypeScript SDK (betas, types) | <https://github.com/anthropics/anthropic-sdk-typescript> | — |

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

- Base URL `https://api.anthropic.com` (Messages).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `anthropic`:

- `packages/backend/src/common/utils/anthropic-model-id.ts`
- `packages/backend/src/common/utils/provider-aliases.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/database/seed-cohorts.ts`
- `packages/backend/src/entities/custom-provider.entity.ts`
- `packages/backend/src/mcp/tools/providers.tools.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/routing/custom-provider/custom-provider.service.ts`
- `packages/backend/src/routing/dto/custom-provider.dto.ts`
- `packages/backend/src/routing/oauth/anthropic/anthropic-oauth.controller.ts`
- `packages/backend/src/routing/oauth/anthropic/anthropic-oauth.service.ts`
- `packages/backend/src/routing/proxy/cache-injection.ts`
- … e mais 13 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
