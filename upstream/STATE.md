# Estado do acompanhamento do upstream

Mantido pelo agente `manifest-tracker`. Cada revisão parte daqui e atualiza este arquivo via PR.

Os cortes são timestamps ISO-8601 em UTC. A seleção usa `updated_at >= corte` (inclusivo; a deduplicação absorve a sobreposição) e o novo corte é o horário de **início** da execução.

## Último ponto revisado

| Campo | Valor |
|---|---|
| Commits | `45627a2d5e58427a7a69d111e41fe85e8a6281e7` |
| Releases | `manifest@6.28.6` |
| Issues e PRs | `2026-10-12T12:16:31Z` |
| Discussions | `2026-10-09T14:32:18Z` |
| Backlog de itens abertos anteriores ao baseline | **triado** em 2026-10-12 (57 issues/PRs abertos revisados) |

## Histórico de revisões

| Data | Commits | Releases | Issues abertas (adotar/adaptar) | Ignorados | Fonte | Observações |
|---|---|---|---|---|---|---|
| 2026-10-10 | — | — | — | Baseline do snapshot inicial | — | Ponto de partida |
| 2026-10-10 (2ª) | 0 (`main` == baseline) | 0 (último: `manifest@6.28.6`) | 0 | Nenhum; discussions mais recentes (17/09/2026) anteriores ao baseline | WebFetch | Do PR #4: `main` == baseline, verificação via WebFetch; API do upstream bloqueada. Esta execução **não avançou o corte**. |
| 2026-10-12 | 0 (`main` == baseline `45627a2`) | 0 (último: `manifest@6.28.6`) | 16 (#120 e #122-#136: 10 adotar, 6 adaptar) | Dependabot (#3010-#3016, #3043), telemetria (#2572), cadastro duplicado (#2621, Thinker não tem cadastro aberto), docs de deploy ZopDay (#3044), skeleton loaders (#2281, #2269, #2270), Claude Code pede login (#3052, sem causa confirmada), usage.cost (#2605), refatorações menores | Commits: git local + `gh api compare`; Releases: `gh api`; Issues e PRs: `gh api` (REST); Discussions: WebFetch (GraphQL bloqueado; sem `updated_at`) | Corte de Discussions **não avançado** (a página não mostra data de atualização; a mais recente listada é de 17/09/2026). Backlog triado. Os itens abertos são PRs não mesclados; o código pode mudar. |
