# ADR 0005 — Modo autônomo

- **Status:** aceito
- **Data:** 2026-10-26
- **Substitui:** [ADR 0002](0002-politica-de-merge.md)

## Contexto

O Thinker está em uso pessoal, com um único mantenedor. A política do ADR 0002 (PR por mudança, veredito do `reviewer` preso ao SHA, `qa-docker` antes de sair de draft, mantenedor aprovando governança e releases) fazia cada recurso pequeno demorar muito, gerava perguntas e pedidos de confirmação o tempo todo e travava em prompts de permissão.

## Decisão

Os agentes trabalham em modo autônomo:

1. **Entrevista só no início.** As dúvidas de produto são feitas uma única vez, no começo da solicitação. Depois disso, nada de pedir confirmação ou aprovação: o agente decide, executa e relata no fim.
2. **Implementação rápida.** A menor mudança que entrega o recurso, sem refatoração, ADR ou issue para recursos comuns.
3. **Testes mínimos.** Typecheck e testes unitários do pacote tocado. E2e e `qa-docker` só para migrações, auth/criptografia, caminho quente do proxy ou quando o mantenedor pedir.
4. **Envio imediato.** `scripts/ship.sh "<mensagem>"` faz commit, sobe a versão patch, gera as notas em `docs/releases/`, integra na `main` (push direto ou, se a proteção recusar, PR com squash merge imediato) e empurra a tag `vX.Y.Z`. O workflow Release publica `tmsoftbrasil/thinker:latest` no Docker Hub e o GitHub release marcado como latest.
5. **Sem gates.** Revisão do `reviewer` só quando o mantenedor pedir. Arquivos de governança, releases e mudanças de workflow não esperam mais o mantenedor.

Continuam valendo: sem phone-home (ADR 0003), sem segredos reais nas mãos dos agentes, sem force push, e a instância pessoal do mantenedor e os bancos locais ficam intocados.

## Alternativas consideradas

- **Manter o ADR 0002:** seguro, mas lento demais para um projeto pessoal.
- **Autonomia só no código, release manual:** ainda deixa o mantenedor como gargalo de toda entrega.

## Consequências

- Cada pedido vira uma versão publicada em minutos. Uma versão ruim se corrige com outra versão em seguida.
- A `main` pode receber código sem revisão. A CI continua rodando em cada push e mostra regressões depois do fato.
- Para o push direto funcionar sem PR, a proteção da `main` no GitHub precisa permitir pushes do mantenedor. Enquanto ela exigir PR, o `ship.sh` abre e integra o PR sozinho.
- As permissões do Claude Code no projeto (`.claude/settings.json`) liberam Bash, edição e web sem perguntar, mantendo bloqueado só o force push.
