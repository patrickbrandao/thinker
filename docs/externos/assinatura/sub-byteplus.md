---
id: sub-byteplus
categoria: assinatura
entidade: BytePlus ModelArk Coding Plan
agente: sub-byteplus
thinker_ids: [byteplus]
revisado_em: null
versao_observada: null
---

# BytePlus ModelArk Coding Plan (assinatura)

Especificação mantida pelo agente `sub-byteplus` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Coding Plan page | <https://www.byteplus.com/en/activity/codingplan> | — |
| ModelArk docs | <https://docs.byteplus.com/en/docs/ModelArk/> | — |

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
- Base URL `https://ark.ap-southeast.bytepluses.com/api/coding` (variantes OpenAI e Anthropic).

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`

Arquivos que citam `byteplus`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
