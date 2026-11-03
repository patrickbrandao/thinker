---
id: api-meta
categoria: api
entidade: Meta (Muse Spark)
agente: api-meta
thinker_ids: [meta]
revisado_em: null
versao_observada: null
---

# Meta (Muse Spark) (acesso por API)

Especificação mantida pelo agente `api-meta` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Meta developer docs (semente não confirmada) | <https://developers.meta.ai/> | — |
| Llama API docs (semente não confirmada) | <https://llama.developer.meta.com/docs/overview> | — |

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

- Base URL `https://api.meta.ai`; lista fixa de modelos `META_MODEL_API_MODELS` em `packages/shared/src/providers.ts`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `meta`:

- `packages/backend/src/model-discovery/model-fallback.ts`
- `packages/backend/src/routing/proxy/proxy-friendly-response.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
