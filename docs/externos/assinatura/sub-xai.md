---
id: sub-xai
categoria: assinatura
entidade: Grok subscription
agente: sub-xai
thinker_ids: [xai]
revisado_em: null
versao_observada: null
---

# Grok subscription (assinatura)

Especificação mantida pelo agente `sub-xai` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| xAI docs | <https://docs.x.ai/docs/overview> | — |
| Grok plans (semente não confirmada) | <https://x.ai/grok> | — |

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

- Autenticação: OAuth no navegador (popup); catálogo dinâmico.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/oauth/xai/`

Arquivos que citam `xai`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-discovery.service.ts`
- `packages/backend/src/routing/oauth/xai/xai-oauth.controller.ts`
- `packages/backend/src/routing/oauth/xai/xai-oauth.service.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/frontend/src/components/OAuthDetailView.tsx`
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
