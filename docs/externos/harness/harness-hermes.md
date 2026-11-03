---
id: harness-hermes
categoria: harness
entidade: Hermes Agent
agente: harness-hermes
thinker_ids: [hermes]
revisado_em: null
versao_observada: null
---

# Hermes Agent (harness)

Especificação mantida pelo agente `harness-hermes` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Hermes Agent repository | <https://github.com/NousResearch/hermes-agent> | — |

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
- Cabeçalhos de sessão `x-hermes-session-id` / `x-hermes-session-key`.
- Na `main`, os cabeçalhos de sessão são lidos em `proxy.controller.ts` e `provider-hooks.ts`; o agrupamento por sessão (`harness-session.ts`) está em desenvolvimento.

Pontos no código:

- `packages/shared/src/agent-type.ts`
- `packages/backend/src/routing/proxy/proxy.controller.ts`
- `packages/backend/src/routing/proxy/provider-hooks.ts`
- `packages/backend/src/routing/proxy/caller-classifier.ts`
- `packages/shared/src/setup-snippets.ts`
- `docs/usuario/conectar-harnesses.md`
- `packages/frontend/src/components/HermesSetup.tsx`

Arquivos que citam `hermes`:

- `packages/frontend/src/components/SetupStepAddProvider.tsx`
- `packages/frontend/src/components/VirtualModelsHint.tsx`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
