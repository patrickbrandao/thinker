# Thinker — Principal agent guide

Thinker is an open-source LLM gateway: it sits between AI agents ("harnesses": Claude Code, OpenClaw, Hermes, Codex, OpenCode, SDK apps) and inference providers (API keys, subscriptions, local models, custom endpoints), routing each request to the right model and tracking cost, tokens and full request logs.

It started as a history-less snapshot of [mnfst/llm-gateway](https://github.com/mnfst/llm-gateway) at `manifest@6.28.6` (see `upstream/BASELINE`) and now evolves independently. **There is no compatibility obligation with Manifest.**

The project is in **personal use** by its single maintainer. Work in **autonomous mode** ([ADR 0005](docs/adr/0005-modo-autonomo.md)): speed over ceremony.

## Autonomous mode

1. **Interview once, then execute.** Ask questions only at the start of a request, in a single batch, and only about real product decisions that the request, the code, the ADRs and sensible defaults don't settle. If nothing is open, ask nothing. After that, never stop to ask for confirmation, approval or "should I proceed?": decide, act, and report at the end.
2. **Implement fast.** Make the smallest change that delivers the feature. Read only the code you need. Don't refactor, rename or polish beyond the request. Don't write ADRs, designs or issues for ordinary features; write an ADR only when the user makes a decision that changes a prior one.
3. **Test minimally.** Run typecheck and the unit tests of the touched package (or the single relevant spec). Add a test only for non-trivial logic. Run e2e or `qa-docker` only for migrations, auth/crypto, or proxy hot-path changes, or when the user asks.
4. **Ship immediately.** When the change works, run `scripts/ship.sh "<conventional commit message>"`. It commits, bumps the patch version, writes the release notes, lands on `main`, and pushes the `vX.Y.Z` tag, then builds and publishes the multi-arch image `tmsoftbrasil/thinker:latest` from the local Docker and creates the GitHub release marked latest. Use `minor` as the second argument for big features. No draft PRs, no review gate, no waiting for CI. **Putting it in production** means all three: (a) GitHub, landed on `main` with a release marked latest; (b) Docker Hub, `tmsoftbrasil/thinker:latest`; (c) applied on `api.tmsoft.com.br`. `ship.sh` covers (a) and (b). The full procedure, including (c) (access, DB backup, update, checks, rollback), is in the local, git-ignored `docs/dev/producao.local.md`. Read it before deploying.
5. **Report once** at the end, in Portuguese: what changed, how it was tested, the version shipped.

Stop only when you are truly blocked (a missing secret, a failing build you can't fix, an action the harness denies). Then say exactly what is needed.

## Subagents

Do the work yourself by default; it is usually faster than delegating. Use a subagent from `.claude/agents/` only for a large, clearly separable piece of work or for a fresh context:

| Need | Agent |
|---|---|
| Upstream changes / should we port X? | `manifest-tracker` |
| Large cross-cutting design | `architect` |
| NestJS / TypeORM / auth / proxy code | `backend-dev` |
| React dashboard | `frontend-dev` |
| Provider adapters, catalogs, pricing, subscription OAuth | `providers` |
| Full Docker smoke/e2e run | `qa-docker` |
| Review, only when the user asks | `reviewer` |
| CI, image, releases | `devops` |
| PT-BR docs and release notes | `docs-ptbr` |

New agents may be created when useful; register them in [`docs/agentes.md`](docs/agentes.md).

## Ground rules

- **Language:** code, identifiers, comments and commits in English. Documentation under `docs/` and release notes in Portuguese (PT-BR). The dashboard UI stays in English.
- **Naming:** the product is Thinker. Env vars `THINKER_*`, key prefix `thk_`, CLI `thinker`, Docker image `tmsoftbrasil/thinker`, default port `2099`. Never add new `manifest`/`mnfst` identifiers.
- **No phone-home:** the product makes no outbound calls of its own. Outbound traffic goes only to configured providers, plus the public catalogs of [ADR 0003](docs/adr/0003-excecao-catalogos-publicos.md) (openrouter.ai, models.dev, and the OpenCode Go doc on raw.githubusercontent.com), all disabled by `THINKER_CATALOG_SYNC=false`.
- **Git:** Conventional Commits. `scripts/ship.sh` pushes straight to `main`; if branch protection rejects the push, it opens a PR and squash-merges it right away. Never force-push.
- **Docker images:** publish from the local Docker, using the Docker Hub account it is logged into (`tmsoftbrasil`), with the local builder `desktop-linux`. Don't wait for or depend on CI secrets, and never use a remote builder.
- **Secrets:** never handle real tokens or keys. Never run `docker login` or read Docker credentials; the maintainer keeps the local session logged in.
- **Local data:** never touch the maintainer's own instance (`~/thinker-local`, port 2099) or the PostgreSQL on host ports 5432/5433. Tests use disposable containers.

## Codebase reference

The technical guide is [`docs/dev/guia.md`](docs/dev/guia.md) (architecture, commands, auth, routing, env vars, migrations, tests, releases) and the domain terminology is [`docs/dev/terminologia.md`](docs/dev/terminologia.md). Both are in Portuguese. Read only the section you need, and update the guide when your change makes it stale.

Decisions: [`docs/decisoes-iniciais.md`](docs/decisoes-iniciais.md) and [`docs/adr/`](docs/adr/).
