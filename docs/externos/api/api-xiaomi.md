---
id: api-xiaomi
categoria: api
entidade: Xiaomi MiMo
agente: api-xiaomi
thinker_ids: [xiaomi]
revisado_em: null
versao_observada: null
---

# Xiaomi MiMo (acesso por API)

Especificação mantida pelo agente `api-xiaomi` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| MiMo platform | <https://platform.xiaomimimo.com> | — |
| MiMo models (Hugging Face) | <https://huggingface.co/XiaomiMiMo> | — |

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

- Base URL `https://api.xiaomimimo.com`.

Pontos no código:

- `packages/shared/src/providers.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`
- `packages/backend/src/model-discovery/known-model-prices.ts`

Arquivos que citam `xiaomi`:

- `packages/backend/src/database/models-dev-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/routing/xiaomi-region.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
