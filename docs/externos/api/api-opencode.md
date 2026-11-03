---
id: api-opencode
categoria: api
entidade: OpenCode (API: paid and free models)
agente: api-opencode
thinker_ids: [opencode]
revisado_em: null
versao_observada: null
---

# OpenCode (API: paid and free models) (acesso por API)

Especificação mantida pelo agente `api-opencode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| OpenCode Zen docs | <https://opencode.ai/docs/zen/> | — |
| OpenCode repository | <https://github.com/anomalyco/opencode> | — |
| ADR 0009 (internal) | [0009-opencode-catalogo-proprio-e-modelos-gratuitos.md](../../adr/0009-opencode-catalogo-proprio-e-modelos-gratuitos.md) | — |
| models.dev catalog | <https://models.dev> | — |

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

- Base URL `https://opencode.ai/inference`; os modelos gratuitos só atendem o cliente OpenCode com a chave compartilhada `public` (`subscription-clients.ts`, ADR 0009).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `opencode`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.controller.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`
- `packages/frontend/src/pages/integrations/McpServer.tsx`
- `packages/frontend/src/services/api/oauth.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/agent-type.ts`
- … e mais 1 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
