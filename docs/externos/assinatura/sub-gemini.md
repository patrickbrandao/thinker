---
id: sub-gemini
categoria: assinatura
entidade: Sign in with Google (Gemini Code Assist)
agente: sub-gemini
thinker_ids: [gemini]
revisado_em: null
versao_observada: null
---

# Sign in with Google (Gemini Code Assist) (assinatura)

Especificação mantida pelo agente `sub-gemini` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Gemini CLI repository (code_assist) | <https://github.com/google-gemini/gemini-cli> | — |
| Quotas and pricing | <https://github.com/google-gemini/gemini-cli/blob/main/docs/quota-and-pricing.md> | — |
| Gemini Code Assist docs | <https://developers.google.com/gemini-code-assist/docs/overview> | — |

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
- Base URL `https://cloudcode-pa.googleapis.com`.

Pontos no código:

- `packages/shared/src/subscription/configs.ts`
- `packages/backend/src/common/constants/subscription-clients.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/routing/oauth/gemini/`

Arquivos que citam `gemini`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-prices/model-pricing-cache.service.ts`
- `packages/backend/src/playground/playground.service.ts`
- `packages/backend/src/routing/oauth/gemini/gemini-oauth.controller.ts`
- `packages/backend/src/routing/oauth/gemini/gemini-oauth.service.ts`
- `packages/backend/src/routing/proxy/oauth-credentials.ts`
- `packages/backend/src/routing/proxy/proxy-fallback.service.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/lib/response-parts.ts`
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
