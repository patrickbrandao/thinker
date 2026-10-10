# Thinker — Decisões iniciais

Registro do entendimento comum firmado em 2026-10-10, antes do primeiro commit próprio.
Mudanças de rumo posteriores entram como ADRs em [`docs/adr/`](adr/).

## 1. Identidade e origem

| Tema | Decisão |
|---|---|
| Nome | **Thinker** (pensador) — roteador entre agentes de IA (harnesses) e provedores de inferência |
| Origem | Snapshot **sem histórico** de [mnfst/llm-gateway](https://github.com/mnfst/llm-gateway) no commit `45627a2` (`manifest@6.28.6`, 2026-10-09). Âncora em [`upstream/BASELINE`](../upstream/BASELINE) |
| Repositório | `github.com/patrickbrandao/thinker`, **público desde o início**, repo novo (não é fork) |
| Licença | MIT; o aviso de copyright da MNFST, Inc. permanece ao lado do do Thinker |
| Compatibilidade | Nenhuma obrigação com o Manifest (API, env vars, banco, CLI) |
| Rebranding | **Total**: UI, docs, pacotes, env vars `MANIFEST_*` → `THINKER_*`, chaves `mnfst_` → `thk_`, CLI `mnfst` → `thinker`, imagem Docker |
| Idioma | Código, identificadores, commits e PRs em inglês; documentação em português (PT-BR) |
| Logo | Ícone Flaticon **5337422** (cérebro azul), com atribuição no README |
| Versão | SemVer a partir de **0.1.0**, gerenciado por Changesets; 1.0.0 quando a primeira versão própria estiver estável |

## 2. Público e modelo de acesso

- Projeto público para **uso pessoal e pequenas empresas**.
- Hoje o upstream liga 1 tenant a 1 usuário. O Thinker passa a ter **Organizações com membros e papéis** (owner/admin/member/viewer).
- **Sem cadastro aberto e sem convites**: o primeiro usuário vira admin da instância, que cria organizações e contas. Owner/admin de uma organização também pode criar contas dentro dela.
- Login social (Google/GitHub/Discord) continua opcional, ativado por variáveis de ambiente, como no upstream.

## 3. Escopo: o que sai do upstream

| Sai | Detalhe |
|---|---|
| Camada SaaS/Manifest Cloud | Modo cloud, Stripe/billing/planos, waitlist, crm-metrics, banner API Bot, "Gemini Free" gerenciado, GitHub stars |
| Phone-home | Telemetria, update-check (não volta nem apontando para o Thinker), discovery (Peacock), Sentry, drawer Wingman |
| Autofix (Phoenix) | Depende de serviço externo da Manifest; volta como *self-heal local* no roadmap |

| Fica | Detalhe |
|---|---|
| Superfícies | Dashboard, proxy OpenAI/Anthropic-compatível, CLI `thinker`, servidor MCP remoto, Playground, Notificações/alertas |
| Deploys | Docker/Compose é o **único caminho oficial e testado**; os templates Railway/Render/AWS/GCP/DO/Heroku/Koyeb/Fly/Coolify/Easypanel/Apple ficam rebrandeados e marcados como *community/não testados* |
| Integrações | Nó n8n permanece (rebrandeado) |
| Provedores | Todos: BYOK, assinaturas (mantidas como no upstream, sem aviso adicional), modelos locais, endpoints customizados |
| Harnesses (matriz de QA) | Claude Code, OpenClaw/Hermes, Codex/OpenCode, SDKs (OpenAI/Anthropic/Vercel/LangChain) |

## 4. Stack e infraestrutura

- Stack mantida (NestJS, TypeORM, Better Auth, SolidJS/Vite, npm workspaces + Turborepo, Node 24), **atualizada**:
  PostgreSQL 16 → **18**; NestJS 11 → 12; TypeORM 0.3 → 1.x; Vite 6 → 8; TypeScript 5 → 7; Changesets 2 → 3; demais dependências nas versões atuais.
- Ordem: limpeza/rebrand → CI e Docker verdes → **um PR por major**, PG 18 primeiro, cada um validado pelo QA Docker. Major sem suporte do ecossistema (ex.: TS 7 + decorators do Nest) é registrado e adiado.
- Testes locais no **Docker Desktop** (contexto `desktop-linux`), um projeto Compose isolado por execução.
- Imagem **multi-arch amd64 + arm64**, construída no GitHub Actions e publicada em **Docker Hub `tmsoftbrasil/thinker`**. O CI precisa dos secrets `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN`, cadastrados por você.
- Porta padrão **2099**.
- Segurança: `THINKER_ENCRYPTION_KEY` é **obrigatória e separada** de `BETTER_AUTH_SECRET`; sem ela o boot falha, e o compose/instalador gera as duas.
- Gravação de corpos de requisição: **ligada** por padrão para harnesses novos, **retenção de 30 dias**, cifrada em repouso.

## 5. Agentes

O **Principal** é a sessão do Claude Code guiada pelo [`CLAUDE.md`](../CLAUDE.md): recebe os pedidos, planeja e delega. Os subagentes ficam em [`.claude/agents/`](../.claude/agents/), catalogados em [`docs/agentes.md`](agentes.md).

| Agente | Papel | Modelo |
|---|---|---|
| `manifest-tracker` | Acompanha o upstream (commits, releases, discussions, issues/PRs); só analisa e propõe | Sonnet |
| `qa-docker` | Sobe o stack no Docker local e roda smoke/e2e/contratos | Sonnet |
| `reviewer` | Revisa PRs: bugs, segurança, isolamento entre organizações, vazamento de credenciais | herda (Opus) |
| `backend-dev` | Implementação NestJS/TypeORM | herda |
| `frontend-dev` | Implementação SolidJS/Vite | herda |
| `providers` | Adaptadores de provedores, catálogos, preços, fluxos de assinatura | herda |
| `architect` | Desenho de features grandes e ADRs | herda |
| `devops` | CI, Dockerfile, multi-arch, Docker Hub, Changesets/release, templates de deploy | herda |
| `docs-ptbr` | Documentação em PT-BR e notas de release em português | Sonnet |

- **Novos agentes**: o Principal propõe o arquivo, que só entra com sua aprovação e é registrado em `docs/agentes.md`.
- **Agente Manifest** roda numa **rotina semanal na nuvem** (Claude Code) e também sob demanda. Para cada item relevante, abre uma issue com label `upstream`, classificada como `adotar` ou `adaptar` (labels `upstream`, `upstream:adotar`, `upstream:adaptar`). Itens a **ignorar** não geram issue: aparecem apenas no resumo da execução. Atualiza [`upstream/STATE.md`](../upstream/STATE.md) via PR. **Nunca altera código.**

## 6. Fluxo de trabalho

- `main` protegida: branch → PR → CI (lint, testes, build da imagem) + revisão do `reviewer` → **você aprova o merge** (squash). Conventional Commits.
- GitHub Issues + **milestones**; labels **por área** (`area:*`). Não há labels de agente: o agente responsável é nomeado no corpo da issue.
- A label `decisão` marca issues que aguardam uma decisão sua (o mantenedor); o Arquiteto e o Principal a usam para decisões de produto em aberto.
- Documentação em Markdown no próprio repo (`docs/`), com ADRs em `docs/adr/`.

## 7. Roadmap

| Milestone | Conteúdo |
|---|---|
| **v0.1** | Limpeza (seção 3), rebranding total, `THINKER_ENCRYPTION_KEY`, retenção 30d, Docker/CI verdes, primeira imagem no Docker Hub |
| **v0.2** | Upgrades (PG 18 e majors, um PR cada) |
| **v0.3** | Organizações + papéis + gestão de contas pelo admin |
| **v0.4** | Orçamentos/quotas por organização, membro e harness |
| **v0.5** | Observabilidade aberta (Prometheus + OpenTelemetry) |
| **v0.6** | Self-heal local (substituto do Autofix) |
| **v0.7** | Cache de respostas (exato e semântico) |
