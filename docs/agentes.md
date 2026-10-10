# Agentes do Thinker

O Thinker é desenvolvido por agentes do Claude Code. O **Principal** é a sessão guiada pelo [`CLAUDE.md`](../CLAUDE.md): ele conversa com você, planeja e delega. Os subagentes ficam em [`.claude/agents/`](../.claude/agents/).

| Agente | Arquivo | Modelo | Responsabilidade | Pode alterar código? |
|---|---|---|---|---|
| Principal | `CLAUDE.md` | sessão | Recebe pedidos, planeja, delega, abre PRs | Sim |
| Manifest | `manifest-tracker.md` | Sonnet | Acompanha o upstream e abre issues `upstream` | Não (só `upstream/`) |
| QA Docker | `qa-docker.md` | Sonnet | Build da imagem e testes no Docker local | Não |
| Revisor | `reviewer.md` | herda | Revisão de PR: bugs, segurança, isolamento | Não |
| Backend | `backend-dev.md` | herda | NestJS, TypeORM, proxy, CLI, MCP | Sim |
| Frontend | `frontend-dev.md` | herda | Dashboard SolidJS | Sim |
| Provedores | `providers.md` | herda | Adaptadores, catálogos, preços, assinaturas | Sim |
| Arquiteto | `architect.md` | herda | Desenho de features e ADRs | Só `docs/` |
| DevOps | `devops.md` | herda | CI, imagem multi-arch, Docker Hub, releases | Sim (infra) |
| Docs PT-BR | `docs-ptbr.md` | Sonnet | Documentação e notas de release | Só docs |

## Execuções agendadas

| Agente | Gatilho | Saída |
|---|---|---|
| Manifest | Rotina semanal na nuvem (Claude Code) + sob demanda | Issues `upstream` + PR atualizando `upstream/STATE.md` |

## Como nasce um novo agente

1. O Principal identifica um tipo de trabalho recorrente que nenhum agente cobre.
2. Ele propõe o arquivo `.claude/agents/<nome>.md` (papel, ferramentas, modelo, limites).
3. Só depois da sua aprovação o arquivo entra num PR e é registrado nesta tabela.

## Labels

- Área: `area:backend`, `area:frontend`, `area:providers`, `area:infra`, `area:docs`
- Upstream: `upstream`, `upstream:adotar`, `upstream:adaptar`
- Prioridade: `prioridade:alta`
