---
id: harness-claude-code
categoria: harness
entidade: Claude Code
agente: harness-claude-code
thinker_ids: [claude-code]
revisado_em: null
versao_observada: null
---

# Claude Code (harness)

Especificação mantida pelo agente `harness-claude-code` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Claude Code repository and CHANGELOG | <https://github.com/anthropics/claude-code> | — |
| LLM gateway configuration | <https://docs.claude.com/en/docs/claude-code/llm-gateway> | — |
| Settings and environment variables | <https://docs.claude.com/en/docs/claude-code/settings> | — |
| npm @anthropic-ai/claude-code | <https://www.npmjs.com/package/@anthropic-ai/claude-code> | — |

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

- Superfície: Anthropic Messages.
- Cabeçalho de sessão `x-claude-code-session-id` (2.1.86+).
- Na `main`, os cabeçalhos de sessão são lidos em `proxy.controller.ts` e `provider-hooks.ts`; o agrupamento por sessão (`harness-session.ts`) está em desenvolvimento.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/ClaudeCodeSetup.tsx`

Arquivos que citam `claude-code`:

- `packages/cli/src/agent-runtime.ts`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`
- `packages/frontend/src/pages/integrations/McpServer.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
