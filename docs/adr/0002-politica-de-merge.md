# ADR 0002 — Política de merge autônomo

- **Status:** aceito
- **Data:** 2026-10-10

## Contexto

As [decisões iniciais](../decisoes-iniciais.md) (§6) previam que **você** (o mantenedor) aprovasse cada squash merge. O milestone v0.1 tem cerca de 30 PRs, quase todos em série (ver a issue #36): remoções, rebranding, segurança, release. Se cada merge esperar o mantenedor, a fila trava nos intervalos em que ele não está disponível, mesmo quando o PR já passou por CI, revisão e QA.

A maior parte desses PRs só executa decisões já tomadas e registradas em issues. O que pede o julgamento do mantenedor é outra coisa: decisões de produto novas, mudanças nas próprias regras de governança, releases e mudanças de risco alto.

A `main` já é protegida no GitHub: exige PR, não aceita force push nem exclusão, e a proteção vale também para administradores (`enforce_admins`). Ainda não há status checks obrigatórios, porque o GitHub Actions está desligado até #38.
## Decisão

### Gates de merge

O **Principal** faz o squash merge de um PR sozinho quando **todas** as condições abaixo valem:

1. **CI verde.** Exceção provisória: enquanto a CI mínima (#38) não estiver na `main`, o agente que implementou roda localmente, nos pacotes afetados, **lint, typecheck, build e os testes unitários e e2e**, e registra no PR os comandos e o resultado.
2. **`reviewer` com `Veredito: aprovado` no head atual.**
   - O relatório do `reviewer` é publicado como comentário no PR e informa o SHA do head revisado logo acima da linha de veredito.
   - Qualquer commit novo depois do veredito exige uma nova revisão.
   - Cada *should-fix* de um veredito `aprovado` é corrigido no PR ou vira uma issue, com o link registrado no PR, antes do merge.
3. **`qa-docker` aprovado**, quando o PR muda comportamento em tempo de execução.

O veredito é um dos gates, não o único: um `aprovado` não dispensa os outros dois. O merge amarra o SHA revisado:

```text
gh pr merge <n> --squash --delete-branch --match-head-commit <sha-revisado>
```

### O que espera o mantenedor

O Principal deixa o PR pronto e pede a aprovação nestes casos:

- decisões de produto novas, ou ADRs que mudam uma decisão anterior. Implementar uma decisão já tomada não conta;
- PRs que mexem em arquivos de governança: `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/**`, `docs/adr/**` e `docs/decisoes-iniciais.md`;
- releases, incluindo:
  - tags, GitHub Releases e pushes para o Docker Hub;
  - o PR de versão do Changesets;
  - qualquer PR cujo merge dispare uma publicação, por exemplo um workflow que publica a partir de um push na `main`;
- tudo o que o `reviewer` marcar como `Veredito: risco alto (aguardar mantenedor)`. Os critérios estão em [`.claude/agents/reviewer.md`](../../.claude/agents/reviewer.md). Entre eles estão:
  - as categorias acima;
  - mudanças em `.github/workflows/**`, `.github/dependabot.yml`, nas permissões do Actions ou no uso de secrets.

  Há uma exceção a este último critério: as mudanças listadas no Escopo da issue #38 (CI mínima). Elas estão planejadas explicitamente e apagam os workflows herdados que publicam. Qualquer mudança de workflow fora desse Escopo, mesmo no PR do #38, continua sendo risco alto.

### Proibições

**Nunca**, em nenhum caso:

- push direto para a `main`;
- force push;
- `gh pr merge --admin`;
- qualquer outro meio de contornar a proteção da branch: merge ou mudança de ref pela API REST ou GraphQL, ou edição da proteção ou dos rulesets.

O [`.claude/settings.json`](../../.claude/settings.json) bloqueia as formas usuais desses comandos com regras `permissions.deny` e pede confirmação para comandos de release com `permissions.ask`. A proteção da branch no GitHub continua sendo a barreira real. Texto livre que possa citar push, `main`, merge ou `--admin` vai por arquivo (`git commit -F`, `--body-file`), para não disparar as regras por engano.

Depois da primeira execução verde da CI na `main` (#38), o **mantenedor** adiciona os status checks obrigatórios à proteção da `main`. O Principal não consegue fazer isso, porque as regras de deny bloqueiam a edição da proteção.

### Transparência

O Principal manda ao mantenedor um resumo **ao fim de cada fase da issue de acompanhamento e a cada milestone do GitHub fechado**. O resumo traz os PRs integrados (com o SHA revisado), os vereditos do `reviewer`, o resultado do `qa-docker`, as issues abertas para *should-fix* e o que ficou aguardando.

## Alternativas consideradas

- **O mantenedor aprova todo merge** (regra anterior): controle máximo, mas lento demais para cerca de 30 PRs em série. A fila para sempre que o mantenedor está ausente, sem ganho de qualidade nos PRs que só executam decisões já tomadas.
- **Os agentes fazem merge de tudo, exceto código de produto** (docs, CI, configuração): reduz a espera só um pouco, porque quase todo o v0.1 é código de produto. Além disso, recorta pelo tipo de arquivo, não pelo risco. Uma mudança de CI que publica imagem pode ser mais arriscada que uma remoção de código morto.

## Consequências

- O v0.1 anda sem esperar o mantenedor a cada PR. O controle dele passa para as decisões, a governança, as releases e os casos de risco alto.
- Os agentes não conseguem afrouxar os próprios gates: qualquer mudança em `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/**`, `docs/adr/**` ou `docs/decisoes-iniciais.md` passa pelo mantenedor.
- O veredito do `reviewer` vira um gate formal, preso a um SHA. Um commit depois da revisão invalida o veredito, e `--match-head-commit` impede o merge de um head diferente do revisado.
- Até #38 entrar, a qualidade do gate de CI depende de o agente rodar e registrar lint, typecheck, build e testes. O `reviewer` confere esse registro.
- As regras de `permissions.deny` e `permissions.ask` cobrem as formas comuns dos comandos, não todas (a documentação do Claude Code avisa que regras de Bash não são uma fronteira de segurança). A proteção da `main` no GitHub, com `enforce_admins`, continua sendo a garantia.
- Substitui o trecho "você aprova o merge" de [`docs/decisoes-iniciais.md`](../decisoes-iniciais.md) §6 e a regra "Git flow" do [`CLAUDE.md`](../../CLAUDE.md).
