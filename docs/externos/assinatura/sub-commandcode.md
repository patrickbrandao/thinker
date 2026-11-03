---
id: sub-commandcode
categoria: assinatura
entidade: Command Code
agente: sub-commandcode
thinker_ids: [commandcode]
revisado_em: null
versao_observada: null
---

# Command Code (assinatura)

Especificação mantida pelo agente `sub-commandcode` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Command Code studio | <https://commandcode.ai/studio> | — |
| Docs (semente não confirmada) | <https://commandcode.ai/docs> | — |

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

- Autenticação: token de assinatura.
- Base URL `https://api.commandcode.ai/provider` (variantes OpenAI e Anthropic).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`

Arquivos que citam `commandcode`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
