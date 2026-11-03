---
id: local-ollama
categoria: local
entidade: Ollama
agente: local-ollama
thinker_ids: [ollama]
revisado_em: null
versao_observada: null
---

# Ollama (runtime local)

Especificação mantida pelo agente `local-ollama` conforme [`.claude/external-research.md`](../../../.claude/external-research.md). O agente principal se baseia neste arquivo para escrever código compatível. Índice: [docs/externos](../README.md).

> **Esqueleto.** Ainda não houve pesquisa: o contrato está vazio e o estado abaixo foi extraído do código em 2026-11-03, sem conferência com as fontes.

## Resumo

_(pendente)_

## Fontes da verdade

| Fonte | Link | Última versão vista |
|---|---|---|
| Ollama repository and releases | <https://github.com/ollama/ollama> | — |
| API docs | <https://docs.ollama.com/api> | — |
| OpenAI compatibility | <https://docs.ollama.com/api/openai-compatibility> | — |
| Anthropic compatibility | <https://docs.ollama.com/api/anthropic-compatibility> | — |

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

- Porta padrão 11434; lê `OLLAMA_HOST` (módulo próprio).

Pontos no código:

- `packages/backend/src/common/constants/local-servers.ts`
- `packages/shared/src/providers.ts`
- `packages/backend/src/model-discovery/provider-model-fetcher.service.ts`

Arquivos que citam `ollama`:

- `packages/backend/src/database/ollama-sync.service.ts`
- `packages/backend/src/model-discovery/model-capabilities.ts`
- `packages/backend/src/proxy-servers/proxy-egress.service.ts`
- `packages/backend/src/routing/dto/custom-provider.dto.ts`
- `packages/backend/src/routing/provider.controller.ts`
- `packages/backend/src/routing/proxy/provider-client-converters.ts`
- `packages/backend/src/routing/proxy/provider-client.ts`
- `packages/backend/src/routing/routing-core/provider-key.service.ts`
- `packages/frontend/src/components/ProviderIcon.tsx`
- `packages/frontend/src/services/api/routing.ts`
- `packages/frontend/src/services/providers.ts`
- `packages/shared/src/provider-inference.ts`

## Lacunas

| ID | Severidade | Lacuna | Dono | Issue | Status |
|---|---|---|---|---|---|

_(nenhuma registrada)_

## Histórico

- 2026-11-03: esqueleto criado, sem pesquisa.
