# Estado do acompanhamento do upstream

Mantido pelo agente `manifest-tracker`. Cada revisão parte daqui e atualiza este arquivo via PR.

Os cortes são timestamps ISO-8601 em UTC. A seleção usa `updated_at >= corte` (inclusivo; a deduplicação absorve a sobreposição) e o novo corte é o horário de **início** da execução.

## Último ponto revisado

| Campo | Valor |
|---|---|
| Commits | `b0c81b0ab013fbc332ada51e9e2921a34987afcd` |
| Releases | `manifest@6.28.11` |
| Issues e PRs | `2026-11-02T12:11:42Z` |
| Discussions | `2026-10-09T14:32:18Z` |
| Backlog de itens abertos anteriores ao baseline | **triado** em 2026-10-12 (57 issues/PRs abertos revisados) |

## Histórico de revisões

| Data | Commits | Releases | Issues abertas (adotar/adaptar) | Ignorados | Fonte | Observações |
|---|---|---|---|---|---|---|
| 2026-10-10 | — | — | — | Baseline do snapshot inicial | — | Ponto de partida |
| 2026-10-10 (2ª) | 0 (`main` == baseline) | 0 (último: `manifest@6.28.6`) | 0 | Nenhum; discussions mais recentes (17/09/2026) anteriores ao baseline | WebFetch | Do PR #4: `main` == baseline, verificação via WebFetch; API do upstream bloqueada. Esta execução **não avançou o corte**. |
| 2026-10-12 | 0 (`main` == baseline `45627a2`) | 0 (último: `manifest@6.28.6`) | 16 (#120 e #122-#136: 10 adotar, 6 adaptar) | Dependabot (#3010-#3016, #3043), telemetria (#2572), cadastro duplicado (#2621, Thinker não tem cadastro aberto), docs de deploy ZopDay (#3044), skeleton loaders (#2281, #2269, #2270), Claude Code pede login (#3052, sem causa confirmada), usage.cost (#2605), refatorações menores | Commits: git local + `gh api compare`; Releases: `gh api`; Issues e PRs: `gh api` (REST); Discussions: WebFetch (GraphQL bloqueado; sem `updated_at`) | Corte de Discussions **não avançado** (a página não mostra data de atualização; a mais recente listada é de 17/09/2026). Backlog triado. Os itens abertos são PRs não mesclados; o código pode mudar. |
| 2026-11-02 | 52 (`45627a2`..`b0c81b0`) | 5 (6.28.7 a 6.28.11) | 1 (#302: adotar, PR aberto #3101 Gemini content_filter). Os demais itens de código já tinham issue (#171-#176, #193-#196) | Plano Free/M204 e modal de assinatura (#3091, #3105, #3106), formulário Custom development, remoção do API Bot, deploy Cloud Run, Dependabot (better-auth já em 1.7.13 e fast-uri já em 3.1.9 no Thinker), #3085 (dist vazio na imagem do Manifest), #3083 AICraft (fechado), #3098/#3103 (preço e catálogo Bedrock/Fable, relato vago; sem issue), #3102 | Commits: git local + `gh api compare`; Releases: `gh api`; Issues e PRs: `gh api` (REST); Discussions: GraphQL bloqueado nesta sessão | Corte de Discussions **não avançado** (mantido em 2026-10-09T14:32:18Z). Duplicata checada contra issues com label `upstream`. |
