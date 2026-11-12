# Estado do acompanhamento do upstream

Mantido pelo agente `manifest-tracker`. Cada revisão parte daqui e atualiza este arquivo via PR.

Os cortes são timestamps ISO-8601 em UTC. A seleção usa `updated_at >= corte` (inclusivo; a deduplicação absorve a sobreposição) e o novo corte é o horário de **início** da execução.

## Último ponto revisado

| Campo | Valor |
|---|---|
| Commits | `6e4b2f476964e52d2be4061063e0d1f4f0bb9e05` |
| Releases | `manifest@6.29.1` |
| Issues e PRs | `2026-11-12T17:18:55Z` |
| Discussions | `2026-11-12T17:18:55Z` |
| Backlog de itens abertos anteriores ao baseline | **triado** em 2026-10-12 (57 issues/PRs abertos revisados) |

## Histórico de revisões

| Data | Commits | Releases | Issues abertas (adotar/adaptar) | Ignorados | Fonte | Observações |
|---|---|---|---|---|---|---|
| 2026-10-10 | — | — | — | Baseline do snapshot inicial | — | Ponto de partida |
| 2026-10-10 (2ª) | 0 (`main` == baseline) | 0 (último: `manifest@6.28.6`) | 0 | Nenhum; discussions mais recentes (17/09/2026) anteriores ao baseline | WebFetch | Do PR #4: `main` == baseline, verificação via WebFetch; API do upstream bloqueada. Esta execução **não avançou o corte**. |
| 2026-10-12 | 0 (`main` == baseline `45627a2`) | 0 (último: `manifest@6.28.6`) | 16 (#120 e #122-#136: 10 adotar, 6 adaptar) | Dependabot (#3010-#3016, #3043), telemetria (#2572), cadastro duplicado (#2621, Thinker não tem cadastro aberto), docs de deploy ZopDay (#3044), skeleton loaders (#2281, #2269, #2270), Claude Code pede login (#3052, sem causa confirmada), usage.cost (#2605), refatorações menores | Commits: git local + `gh api compare`; Releases: `gh api`; Issues e PRs: `gh api` (REST); Discussions: WebFetch (GraphQL bloqueado; sem `updated_at`) | Corte de Discussions **não avançado** (a página não mostra data de atualização; a mais recente listada é de 17/09/2026). Backlog triado. Os itens abertos são PRs não mesclados; o código pode mudar. |
| 2026-11-12 | 5 desde 2026-11-09 (`e48ea50`..`6e4b2f4`); HEAD `6e4b2f4` | `manifest@6.29.1` (6.29.0 já coberta por #497) | 2 (#510 adotar, #511 adaptar) | Re-ficha #495-#497 (já abertos), retenção de gravações (#e10162d, só Cloud), Manifest Cloud Pro only (6.29.0), bump modelparams 0.0.72 (Thinker já usa), issue #3126 (Bedrock Fable 5.1 retention mode, mesma causa de #497), Dependabot, #3044, #3123 (version packages) | Commits: `gh api`; Releases: `gh api`; Issues e PRs: `gh api` (REST); Discussions: `gh api graphql` (nada novo desde 17/09/2026) | Os cortes de 2026-10-12 a 2026-11-09 não foram registrados neste arquivo; o corte real anterior foi inferido pelas issues #495-#497 (09/11) e a deduplicação cobre a sobreposição. |
