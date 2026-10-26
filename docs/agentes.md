# Agentes do Thinker

O Thinker é desenvolvido por agentes do Claude Code. O **Principal** é a sessão guiada pelo [`CLAUDE.md`](../CLAUDE.md): ele conversa com você, planeja e delega. Os subagentes ficam em [`.claude/agents/`](../.claude/agents/).

| Agente | Arquivo | Modelo | Responsabilidade | Pode alterar código? |
|---|---|---|---|---|
| Principal | `CLAUDE.md` | sessão | Recebe pedidos, implementa e publica conforme o [ADR 0005](adr/0005-modo-autonomo.md) | Sim |
| Manifest | `manifest-tracker.md` | Sonnet | Acompanha o upstream e abre issues `upstream` | Não (só `upstream/`) |
| QA Docker | `qa-docker.md` | Sonnet | Build da imagem e testes no Docker local | Não |
| Revisor | `reviewer.md` | herda | Revisão sob demanda: bugs, segurança, isolamento | Não |
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

## Entrega

Modo autônomo ([ADR 0005](adr/0005-modo-autonomo.md)): o Principal tira as dúvidas só no início do pedido, implementa direto, roda testes mínimos e publica com `scripts/ship.sh "<mensagem>"`, que integra na `main`, sobe a versão e empurra a tag. O workflow Release publica `tmsoftbrasil/thinker:latest` e o GitHub release. Não há gate de revisão; o `reviewer` e o `qa-docker` rodam só quando você pede ou quando a mudança é de risco (migração, auth, proxy).

## Como nasce um novo agente

1. O Principal identifica um tipo de trabalho recorrente que nenhum agente cobre.
2. Ele cria o arquivo `.claude/agents/<nome>.md` (papel, ferramentas, modelo, limites) e o registra nesta tabela.

## Labels

- Área: `area:backend`, `area:frontend`, `area:providers`, `area:infra`, `area:docs`
- Upstream: `upstream`, `upstream:adotar`, `upstream:adaptar`
- Prioridade: `prioridade:alta`
- Decisão: `decisão` marca issues que aguardam uma decisão do mantenedor (por exemplo, decisões de produto em aberto levantadas pelo Arquiteto). Não há labels por agente: o agente responsável vai no corpo da issue.
