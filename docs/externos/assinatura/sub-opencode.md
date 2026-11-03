---
id: sub-opencode
categoria: assinatura
entidade: OpenCode Console
agente: sub-opencode
thinker_ids: [opencode]
revisado_em: null
versao_observada: null
---

# OpenCode Console (assinatura)

Especificação mantida pelo agente `sub-opencode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| OpenCode repository (auth) | <https://github.com/anomalyco/opencode> | — |
| Skill opencode2-console-access (MCP thinker-routing) | <https://skills.langwizard.net/skills/opencode2-console-access> | — |
| ADR 0009 (internal) | [0009-opencode-catalogo-proprio-e-modelos-gratuitos.md](../../adr/0009-opencode-catalogo-proprio-e-modelos-gratuitos.md) | — |

## Contrato

### Planos

_(pendente)_

### Autenticação

_(pendente)_

### Endpoints

_(pendente)_

### Identificação do cliente

_(pendente)_

### Clientes permitidos e termos

_(pendente)_

### Cotas e uso

_(pendente)_

### Erros

_(pendente)_

## Como o Thinker implementa hoje

Estado extraído do código em 2026-11-03 (não conferido com as fontes):

- Autenticação: login no OpenCode Console (código de dispositivo, `opencode auth login opencode`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/oauth/opencode/`

Arquivos que citam `opencode`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
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
- … e mais 3 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
