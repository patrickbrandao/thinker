# Agentes do Thinker

O Thinker é desenvolvido por agentes do Claude Code. O **Principal** é a sessão guiada pelo [`CLAUDE.md`](../CLAUDE.md): ele conversa com você, planeja e delega. Os subagentes ficam em [`.claude/agents/`](../.claude/agents/).

| Agente | Arquivo | Modelo | Responsabilidade | Pode alterar código? |
|---|---|---|---|---|
| Principal | `CLAUDE.md` | sessão | Recebe pedidos, planeja, delega, abre PRs e faz o merge conforme o [ADR 0002](adr/0002-politica-de-merge.md) | Sim |
| Manifest | `manifest-tracker.md` | Sonnet | Acompanha o upstream e abre issues `upstream` | Não (só `upstream/`) |
| QA Docker | `qa-docker.md` | Sonnet | Build da imagem e testes no Docker local | Não |
| Revisor | `reviewer.md` | herda | Revisão de PR: bugs, segurança, isolamento; termina com o veredito que decide o merge | Não |
| Backend | `backend-dev.md` | herda | NestJS, TypeORM, proxy, CLI, MCP | Sim |
| Frontend | `frontend-dev.md` | herda | Dashboard SolidJS | Sim |
| Provedores | `providers.md` | herda | Adaptadores, catálogos, preços, assinaturas | Sim |
| Arquiteto | `architect.md` | herda | Desenho de features e ADRs | Só `docs/` e issues (também planeja milestones e abre as issues) |
| DevOps | `devops.md` | herda | CI, imagem multi-arch, Docker Hub, releases | Sim (infra) |
| Docs PT-BR | `docs-ptbr.md` | Sonnet | Documentação e notas de release | Só docs |

## Execuções agendadas

| Agente | Gatilho | Saída |
|---|---|---|
| Manifest | Rotina semanal na nuvem (Claude Code) + sob demanda | Issues `upstream` + PR atualizando `upstream/STATE.md` |

A rotina na nuvem é apenas um invólucro fino: o procedimento completo (fontes, cortes, deduplicação, branch e PR) vive em [`.claude/agents/manifest-tracker.md`](../.claude/agents/manifest-tracker.md). Para mudar o comportamento da rotina, edite o arquivo do agente, não a configuração da rotina.

## Merge

O Principal faz o squash merge sozinho quando o PR cumpre os critérios do [ADR 0002](adr/0002-politica-de-merge.md):

- CI verde;
- `reviewer` com `Veredito: aprovado` no head SHA atual;
- `qa-docker` aprovado, quando o comportamento em tempo de execução muda.

Estes esperam por você:

- decisões de produto novas e ADRs que mudam uma decisão anterior;
- PRs que mexem em arquivos de governança (`CLAUDE.md`, `.claude/settings.json`, `.claude/agents/**`, `docs/adr/**`, `docs/decisoes-iniciais.md`);
- releases e PRs cujo merge publica algo;
- PRs com `Veredito: risco alto (aguardar mantenedor)`.

Os detalhes e as exceções estão no ADR.

## Como nasce um novo agente

1. O Principal identifica um tipo de trabalho recorrente que nenhum agente cobre.
2. Ele propõe o arquivo `.claude/agents/<nome>.md` (papel, ferramentas, modelo, limites).
3. Só depois da sua aprovação o arquivo entra num PR e é registrado nesta tabela.

## Labels

- Área: `area:backend`, `area:frontend`, `area:providers`, `area:infra`, `area:docs`
- Upstream: `upstream`, `upstream:adotar`, `upstream:adaptar`
- Prioridade: `prioridade:alta`
- Decisão: `decisão` marca issues que aguardam uma decisão do mantenedor (por exemplo, decisões de produto em aberto levantadas pelo Arquiteto). Não há labels por agente: o agente responsável vai no corpo da issue.
