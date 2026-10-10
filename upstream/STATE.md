# Estado do acompanhamento do upstream

Mantido pelo agente `manifest-tracker`. Cada revisão parte daqui e atualiza este arquivo via PR.

Os cortes são timestamps ISO-8601 em UTC. A seleção usa `updated_at >= corte` (inclusivo; a deduplicação absorve a sobreposição) e o novo corte é o horário de **início** da execução.

## Último ponto revisado

| Campo | Valor |
|---|---|
| Commit | `45627a2d5e58427a7a69d111e41fe85e8a6281e7` |
| Release | `manifest@6.28.6` |
| Corte de issues/PRs/discussions | `2026-10-09T14:32:18Z` (horário do commit do baseline, para não pular itens criados depois dele) |
| Backlog de itens abertos anteriores ao baseline | **não triado** |

## Histórico de revisões

| Data | Commits | Releases | Issues abertas (adotar/adaptar) | Ignorados | Fonte | Observações |
|---|---|---|---|---|---|---|
| 2026-10-10 | — | — | — | Baseline do snapshot inicial | — | Ponto de partida |
| 2026-10-10 (2ª) | 0 (`main` == baseline) | 0 (último: `manifest@6.28.6`) | 0 | Nenhum; discussions mais recentes (17/09/2026) anteriores ao baseline | WebFetch | Do PR #4: `main` == baseline, verificação via WebFetch; API do upstream bloqueada. Esta execução **não avançou o corte**. |
