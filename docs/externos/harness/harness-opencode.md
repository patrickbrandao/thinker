---
id: harness-opencode
categoria: harness
entidade: OpenCode
agente: harness-opencode
thinker_ids: [opencode]
revisado_em: null
versao_observada: null
---

# OpenCode (harness)

Especificação mantida pelo agente `harness-opencode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| OpenCode repository | <https://github.com/anomalyco/opencode> | — |
| Providers docs | <https://opencode.ai/docs/providers/> | — |
| Config schema | <https://opencode.ai/config.json> | — |

## Contrato

### Configuração do gateway

_(pendente)_

### Seleção de modelo

_(pendente)_

### Cabeçalhos e sessão

_(pendente)_

### Outros endpoints

_(pendente)_

### Recursos usados

_(pendente)_

### Erros e retentativas

_(pendente)_

### Snippet de setup do Thinker

_(pendente)_

## Como o Thinker implementa hoje

Estado extraído do código em 2026-11-03 (não conferido com as fontes):

- Superfície: Chat Completions.
- Cabeçalhos de sessão `x-opencode-session-id` / `x-opencode-session`; sessão-mãe em `x-opencode-parent-session-id`.
- Na `main`, os cabeçalhos de sessão são lidos em `proxy.controller.ts` e `provider-hooks.ts`; o agrupamento por sessão (`harness-session.ts`) está em desenvolvimento.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/OpenCodeSetup.tsx`

Arquivos que citam `opencode`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.controller.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`
- `packages/frontend/src/pages/integrations/McpServer.tsx`
- `packages/frontend/src/services/api/oauth.ts`
- … e mais 3 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
