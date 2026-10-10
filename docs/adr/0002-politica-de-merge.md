# ADR 0002 — Política de merge autônomo

- **Status:** aceito
- **Data:** 2026-10-10

## Contexto

As [decisões iniciais](../decisoes-iniciais.md) (§6) previam que **você** (o mantenedor) aprovasse cada squash merge. O milestone v0.1 tem cerca de 30 PRs, quase todos em série (ver a issue #36): remoções, rebranding, segurança, release. Se cada merge esperar o mantenedor, a fila trava nos intervalos em que ele não está disponível, mesmo quando o PR já passou por CI, revisão e QA.

A maior parte desses PRs só executa decisões já tomadas e registradas em issues. O que pede o julgamento do mantenedor é outra coisa: decisões de produto novas, releases públicas e mudanças de risco alto.

A `main` já é protegida no GitHub: exige PR, não aceita force push nem exclusão, e a proteção vale também para administradores (`enforce_admins`).

## Decisão

O **Principal** faz o squash merge de um PR sozinho quando **todas** as condições abaixo valem:

1. **CI verde.** Exceção provisória: enquanto a CI mínima (#38) não estiver na `main`, vale a execução local dos testes unitários e e2e dos pacotes afetados, rodados pelo agente que implementou e registrados no PR (comandos e resultado).
2. **`reviewer` sem bloqueios**, com a linha final `Veredito: aprovado`.
3. **`qa-docker` aprovado**, quando o PR muda comportamento em tempo de execução.

**Esperam o mantenedor** (o Principal deixa o PR pronto e pede a aprovação):

- decisões de produto novas, ou ADRs que mudam uma decisão anterior. Implementar uma decisão já tomada não conta;
- releases: tags, GitHub Releases e pushes para o Docker Hub;
- tudo o que o `reviewer` marcar como `Veredito: risco alto (aguardar mantenedor)`. Os critérios de risco alto estão em [`.claude/agents/reviewer.md`](../../.claude/agents/reviewer.md).

**Nunca**, em nenhum caso: push direto para a `main`, force push, ou `gh pr merge --admin` (ou qualquer outro meio de contornar a proteção da branch). O [`.claude/settings.json`](../../.claude/settings.json) bloqueia as formas usuais desses comandos com regras `permissions.deny`. A proteção da branch no GitHub continua sendo a barreira real.

**Transparência:** a cada marco (fim de uma fase do plano do milestone, ou um lote de merges), o Principal manda ao mantenedor um resumo com os PRs integrados, os vereditos do `reviewer`, o resultado do `qa-docker` e o que ficou aguardando.

## Alternativas consideradas

- **O mantenedor aprova todo merge** (regra anterior): controle máximo, mas lento demais para cerca de 30 PRs em série. A fila para sempre que o mantenedor está ausente, sem ganho de qualidade nos PRs que só executam decisões já tomadas.
- **Os agentes fazem merge de tudo, exceto código de produto** (docs, CI, configuração): reduz a espera só um pouco, porque quase todo o v0.1 é código de produto. Além disso, recorta pelo tipo de arquivo, não pelo risco. Uma mudança de CI que publica imagem pode ser mais arriscada que uma remoção de código morto.

## Consequências

- O v0.1 anda sem esperar o mantenedor a cada PR. O controle dele passa para as decisões, as releases e os casos de risco alto.
- O veredito do `reviewer` vira um gate formal: a saída dele termina com uma linha `Veredito: …` em formato fixo.
- Até #38 entrar, a qualidade do gate de CI depende de o agente rodar e registrar os testes locais. O `reviewer` confere esse registro.
- As regras de `permissions.deny` cobrem as formas comuns dos comandos proibidos, não todas (a documentação do Claude Code avisa que regras de Bash não são uma fronteira de segurança). A proteção da `main` no GitHub, com `enforce_admins`, continua sendo a garantia.
- Substitui o trecho "você aprova o merge" de [`docs/decisoes-iniciais.md`](../decisoes-iniciais.md) §6 e a regra "Git flow" do [`CLAUDE.md`](../../CLAUDE.md).
