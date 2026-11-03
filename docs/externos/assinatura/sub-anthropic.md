---
id: sub-anthropic
categoria: assinatura
entidade: Claude Max / Pro
agente: sub-anthropic
thinker_ids: [anthropic]
revisado_em: null
versao_observada: null
---

# Claude Max / Pro (assinatura)

Especificação mantida pelo agente `sub-anthropic` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Claude Code repository and CHANGELOG | <https://github.com/anthropics/claude-code> | — |
| npm @anthropic-ai/claude-code (version for user agent) | <https://www.npmjs.com/package/@anthropic-ai/claude-code> | — |
| Using Claude Code with Pro or Max | <https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan> | — |
| Consumer terms | <https://www.anthropic.com/legal/consumer-terms> | — |

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

- Autenticação: setup token colado de `claude setup-token`.
- Imita a identificação do Claude Code: `CLAUDE_CODE_USER_AGENT`, cabeçalhos Stainless e `CLAUDE_CODE_BETA_FLAGS` em `subscription-clients.ts`.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/oauth/anthropic/`

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
- … e mais 14 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
