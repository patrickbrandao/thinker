# ADR 0014: cadeias com até 10 modelos

- Status: aceita
- Data: 2026-11-15
- Altera: [ADR 0004](0004-modelos-virtuais-por-harness.md) (limite de fallbacks)

## Contexto

O ADR 0004 limitou cada cadeia (modelo virtual, tier e tarefa) a um principal e até 5 fallbacks. Com várias assinaturas e modelos gratuitos conectados, 6 modelos ficaram pouco para montar cadeias longas de reserva.

## Decisão

Cada cadeia aceita um principal e até **9 fallbacks** (10 modelos). O limite é a constante `MAX_VIRTUAL_MODEL_FALLBACKS` de `thinker-shared`, usada pelos DTOs de modelos virtuais, tiers e tarefas, pelas ferramentas MCP e pela janela "Gerenciar" do dashboard.

## Consequências

- Uma cadeia de modelo virtual com Continue on Default pode chegar a 20 tentativas (10 do virtual e 10 do tier `default`).
- Não há migração: `fallback_routes` é JSONB sem limite no banco.
