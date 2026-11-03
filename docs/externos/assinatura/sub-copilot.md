---
id: sub-copilot
categoria: assinatura
entidade: GitHub Copilot
agente: sub-copilot
thinker_ids: [copilot]
revisado_em: null
versao_observada: null
---

# GitHub Copilot (assinatura)

Especificação mantida pelo agente `sub-copilot` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Copilot plans | <https://github.com/features/copilot/plans> | — |
| Supported models | <https://docs.github.com/en/copilot/reference/ai-models/supported-models> | — |
| VS Code Copilot Chat repository (headers, endpoints) | <https://github.com/microsoft/vscode-copilot-chat> | — |
| Copilot CLI repository | <https://github.com/github/copilot-cli> | — |

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

- Autenticação: código de dispositivo; troca pelo token do Copilot (`copilot-token.service.ts`).
- Base URL `https://api.githubcopilot.com`; cabeçalhos `Editor-Version` / `Editor-Plugin-Version` em `subscription-clients.ts`.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/oauth/copilot/`

Arquivos que citam `copilot`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/routing/oauth/copilot/copilot.controller.ts`
- `packages/backend/src/routing/proxy/forward-endpoint-resolver.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/backend/src/routing/proxy/proxy-message-recorder.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/frontend/src/components/CopilotDeviceLogin.tsx`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/pages/Welcome.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
