---
id: sub-opencode-go
categoria: assinatura
entidade: OpenCode Go
agente: sub-opencode-go
thinker_ids: [opencode-go]
revisado_em: null
versao_observada: null
---

# OpenCode Go (assinatura)

Especificação mantida pelo agente `sub-opencode-go` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| OpenCode Go docs (semente não confirmada) | <https://opencode.ai/docs/go/> | — |
| OpenCode repository | <https://github.com/anomalyco/opencode> | — |
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

- Autenticação: login no OpenCode Console (código de dispositivo) ou chave de API.
- Base URL `https://opencode.ai/inference/go`; medidor de uso do Go.
- Identificação do cliente `OPENCODE_USER_AGENT` / `OPENCODE_CLIENT_VERSION` em `subscription-clients.ts`.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/oauth/opencode/`

Arquivos que citam `opencode-go`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/model-discovery/opencode-catalog.service.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/published-gateway-models.ts`
- `packages/backend/src/routing/model.controller.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.controller.ts`
- `packages/backend/src/routing/oauth/opencode/opencode-oauth.service.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/reasoning-format.ts`
- `packages/frontend/src/components/ProviderDetailView.tsx`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/api/oauth.ts`
- … e mais 3 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
