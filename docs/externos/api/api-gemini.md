---
id: api-gemini
categoria: api
entidade: Google Gemini API
agente: api-gemini
thinker_ids: [gemini, google]
revisado_em: null
versao_observada: null
---

# Google Gemini API (acesso por API)

Especificação mantida pelo agente `api-gemini` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Gemini API docs | <https://ai.google.dev/gemini-api/docs> | — |
| Models | <https://ai.google.dev/gemini-api/docs/models> | — |
| OpenAI compatibility | <https://ai.google.dev/gemini-api/docs/openai> | — |
| Pricing | <https://ai.google.dev/gemini-api/docs/pricing> | — |
| Changelog | <https://ai.google.dev/gemini-api/docs/changelog> | — |

## Contrato

### Endpoints e protocolos

_(pendente)_

### Modelos

_(pendente)_

### Capacidades

_(pendente)_

### Streaming e uso

_(pendente)_

### Preços

_(pendente)_

### Limites e erros

_(pendente)_

## Como o Thinker implementa hoje

Estado extraído do código em 2026-11-03 (não conferido com as fontes):

- Base URL `https://generativelanguage.googleapis.com` (nativo e compatível com OpenAI).

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `gemini`, `google`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/model-discovery/model-fallback.ts`
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
- `packages/backend/src/auth/auth.instance.ts`
- `packages/backend/src/database/models-dev-sync.service.ts`
- … e mais 7 (rode o grep do passo 2)

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
