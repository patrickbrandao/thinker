---
id: local-lmstudio
categoria: local
entidade: LM Studio
agente: local-lmstudio
thinker_ids: [lmstudio]
revisado_em: null
versao_observada: null
---

# LM Studio (runtime local)

Especificação mantida pelo agente `local-lmstudio` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Developer docs (REST, OpenAI and Anthropic compatibility) | <https://lmstudio.ai/docs/developer> | — |
| Changelog | <https://lmstudio.ai/changelog> | — |
| Blog (release posts) | <https://lmstudio.ai/blog> | — |
| lms CLI repository | <https://github.com/lmstudio-ai/lms> | — |
| lmstudio-js SDK repository | <https://github.com/lmstudio-ai/lmstudio-js> | — |

## Contrato

### Versões

_(pendente)_

### APIs

_(pendente)_

### Modelos e carregamento

_(pendente)_

### Capacidades por família de modelo

_(pendente)_

### Rede e Docker

_(pendente)_

### Novidades aproveitáveis

_(pendente)_

## Como o Thinker implementa hoje

Estado extraído do código em 2026-11-03 (não conferido com as fontes):

- Porta padrão 1234, sobrescrita por `THINKER_LMSTUDIO_BASE_URL` (`local-servers.ts`).
- Dica de setup `lms server start --bind 0.0.0.0 --port 1234 --cors` (`LOCAL_SERVER_HINTS`).

Pontos no código:

- `packages/backend/src/common/constants/local-servers.ts`
- `packages/shared/src/providers.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`

Arquivos que citam `lmstudio`:

- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/proxy-servers/proxy-egress.service.ts`
- `packages/backend/src/routing/custom-provider/custom-provider.service.ts`
- `packages/backend/src/routing/dto/custom-provider.dto.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/proxy/provider-endpoints.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/api/routing.ts`
- `packages/frontend/src/services/providers.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
