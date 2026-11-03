---
id: sub-openai
categoria: assinatura
entidade: ChatGPT Plus / Pro / Team (Codex)
agente: sub-openai
thinker_ids: [openai]
revisado_em: null
versao_observada: null
---

# ChatGPT Plus / Pro / Team (Codex) (assinatura)

Especificação mantida pelo agente `sub-openai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Codex repository (login, client, models) | <https://github.com/openai/codex> | — |
| Codex releases | <https://github.com/openai/codex/releases> | — |
| Using Codex with your ChatGPT plan | <https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan> | — |

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

- Autenticação: OAuth no navegador (popup).
- Base URL `https://chatgpt.com/backend-api`; `CODEX_CLI_VERSION` define a lista de modelos liberada (`subscription-clients.ts`).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/oauth/openai/`

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
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/routing/custom-provider/custom-provider.controller.ts`
- `packages/backend/src/routing/custom-provider/custom-provider.service.ts`
- `packages/backend/src/routing/dto/custom-provider.dto.ts`
- `packages/backend/src/routing/oauth/openai/openai-oauth.controller.ts`
- `packages/backend/src/routing/oauth/openai/openai-oauth.service.ts`
- … e mais 17 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
