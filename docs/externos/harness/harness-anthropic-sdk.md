---
id: harness-anthropic-sdk
categoria: harness
entidade: Anthropic SDK
agente: harness-anthropic-sdk
thinker_ids: [anthropic-sdk]
revisado_em: null
versao_observada: null
---

# Anthropic SDK (harness)

Especificação mantida pelo agente `harness-anthropic-sdk` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| anthropic-sdk-typescript | <https://github.com/anthropics/anthropic-sdk-typescript> | — |
| anthropic-sdk-python | <https://github.com/anthropics/anthropic-sdk-python> | — |

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

- Superfície: Anthropic Messages; cabeçalhos Stainless lidos por `caller-classifier.ts`.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`

Arquivos que citam `anthropic-sdk`:

- `packages/frontend/src/components/FrameworkSnippets.tsx`
- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/services/framework-snippets.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
