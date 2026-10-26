# Contributing to Thinker

Thanks for your interest in contributing to Thinker! This guide will help you get up and running.

## Tech Stack

| Layer    | Technology                                       |
| -------- | ------------------------------------------------ |
| Frontend | SolidJS, uPlot, custom CSS theme                 |
| Backend  | NestJS 11, TypeORM, PostgreSQL 18                |
| Auth     | Better Auth (auto-login on localhost)            |
| Routing  | OpenAI-compatible proxy (`/v1/chat/completions`) |
| Build    | Turborepo + npm workspaces                       |

The full NestJS + SolidJS stack runs locally against PostgreSQL. For local development, the simplest option is to run PostgreSQL in Docker and point `DATABASE_URL` at it.

## Prerequisites

- Node.js 24.x (LTS)
- npm 10.x

## Repository Structure

Thinker is a monorepo managed with [Turborepo](https://turbo.build/) and npm workspaces.

```
packages/
├── shared/               # Shared TypeScript types and constants
├── backend/              # NestJS API server (TypeORM, PostgreSQL, Better Auth)
└── frontend/             # SolidJS single-page app (Vite, uPlot)
```

Self-hosting is supported via the [Docker image](https://hub.docker.com/r/tmsoftbrasil/thinker) and Docker Compose (`docker/`), the only official and CI-tested deploy path. The templates under `deploy/` are community-maintained.

## Getting Started

1. Fork and clone the repository:

```bash
git clone https://github.com/<your-username>/llm-gateway.git
cd llm-gateway
npm install
```

2. Set up environment variables:

```bash
cp packages/backend/.env.example packages/backend/.env
```

Edit `packages/backend/.env` with at least:

```env
PORT=3001
BIND_ADDRESS=127.0.0.1
NODE_ENV=development
BETTER_AUTH_SECRET=<run: openssl rand -hex 32>
DATABASE_URL=postgresql://myuser:mypassword@localhost:5432/mydatabase
API_KEY=dev-api-key-12345
SEED_DATA=true
```

3. Start PostgreSQL locally.

If you already have PostgreSQL running, you can skip this step and reuse it. Otherwise, the quickest option is Docker:

```bash
docker run --name thinker-postgres \
  -e POSTGRES_USER=myuser \
  -e POSTGRES_PASSWORD=mypassword \
  -e POSTGRES_DB=mydatabase \
  -p 5432:5432 \
  -d postgres:18
```

That container matches the sample `DATABASE_URL` above:

```env
DATABASE_URL=postgresql://myuser:mypassword@localhost:5432/mydatabase
```

Useful commands:

```bash
docker start thinker-postgres   # start again later
docker stop thinker-postgres    # stop without deleting data
docker rm -f thinker-postgres   # remove the container
```

4. Start the development servers (in separate terminals):

```bash
# Backend (must preload dotenv — needs to start separately because nest's
# CLI watcher doesn't compose with turbo's parallel runner)
cd packages/backend && NODE_OPTIONS='-r dotenv/config' npx nest start --watch

# Frontend
npm run dev
```

The frontend runs on `http://localhost:3000` and proxies API requests to the backend on `http://localhost:3001`.

`npm run dev` is filtered to exactly `thinker-frontend` — adding a new workspace with a `dev` script will not silently join the dev set.

5. With `SEED_DATA=true`, you can log in with `admin@thinker.example.com` / `thinker`.

## Testing Routing with AI agents

Thinker is a smart router for any AI agent that speaks OpenAI-compatible HTTP. The list of supported agents lives in `packages/shared/src/agent-type.ts` — OpenClaw, Hermes, OpenAI SDK, Vercel AI SDK, LangChain, and cURL are all first-class. The dashboard's "Connect Agent" flow generates the right setup snippet for whichever platform you pick.

This section walks through **OpenClaw** because it's the deepest integration and the easiest to wire up end-to-end. The same backend also handles all other agents — just follow the dashboard instructions after creating the agent, or grab the snippet shown by the setup modal.

To test routing against your local backend, add Thinker as a model provider in your OpenClaw config:

1. Build and start the backend:

```bash
npm run build
PORT=38238 BIND_ADDRESS=127.0.0.1 \
  node -r dotenv/config packages/backend/dist/main.js
```

2. Create an agent in the dashboard at `http://localhost:38238` and get the API key.

3. Add Thinker as a provider in OpenClaw:

```bash
openclaw config set models.providers.thinker '{"baseUrl":"http://localhost:38238/v1","api":"openai-completions","apiKey":"thk_YOUR_KEY","models":[{"id":"auto","name":"Thinker Auto"}]}'
openclaw config set agents.defaults.model.primary thinker/auto
openclaw gateway restart
```

The backend runs standalone and OpenClaw talks to it as a regular OpenAI-compatible provider — no plugin needed. For other agents (OpenAI SDK, Vercel AI SDK, LangChain, cURL, …) follow the corresponding tab in the dashboard's "Connect Agent" modal — the underlying endpoint and auth are identical.

**When to use this:**

- Testing routing, tier assignment, or model resolution
- Debugging the proxy or message ingestion
- Working on the dashboard UI with live data

## Available Scripts

| Command                                         | Description                                                |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                                   | Start frontend in watch mode (start backend separately)    |
| `npm run build`                                 | Production build (shared, backend, frontend via Turborepo) |
| `npm start`                                     | Start the production server                                |
| `npm test --workspace=packages/backend`         | Run backend unit tests (Jest)                              |
| `npm run test:e2e:docker --workspace=packages/backend` | Run backend e2e tests (Jest + Supertest) against a throwaway Postgres container |
| `npm test --workspace=packages/frontend`        | Run frontend tests (Vitest)                                |
| `npm test --workspace=packages/shared`          | Run shared tests (Jest)                                    |

## Working with Individual Packages

### Backend (`packages/backend`)

- **Framework**: NestJS 12 with TypeORM 1.1 and PostgreSQL 18
- **Auth**: Better Auth (email/password + Google, GitHub, Discord OAuth)
- **Tests**: Jest for unit tests (`*.spec.ts`), Supertest for e2e tests (`test/`)
- **Key directories**: `entities/` (data models), `analytics/` (dashboard queries), `routing/` (proxy, scoring, tier assignment), `auth/` (session management)

### Frontend (`packages/frontend`)

- **Framework**: SolidJS with Vite
- **Charts**: uPlot for time-series visualization
- **Tests**: Vitest
- **Key directories**: `pages/` (route components), `components/` (shared UI), `services/` (API client, auth client)

### Shared (`packages/shared`)

- TypeScript types, constants, and helpers used by both the backend and the frontend.
- Built with `tsc` — both CJS and ESM outputs are produced so it can be consumed from either package.

## Making Changes

### Workflow

1. Create a branch from `main` for your change
2. Make your changes in the relevant package(s)
3. Write or update tests as needed
4. Run the test suite to make sure everything passes:

```bash
npm test --workspace=packages/shared
npm test --workspace=packages/backend
npm run test:e2e:docker --workspace=packages/backend  # needs Docker
npm test --workspace=packages/frontend
```

The backend e2e suite drops the schema of the database it connects to, so it refuses to run unless `DATABASE_URL` names a database with `test` as a separate word (e.g. `thinker_e2e_test` or `test_db`; `latest` or `contest` do not count) and `THINKER_E2E_ALLOW_DROP=1` is set. `test:e2e:docker` handles both with a disposable container; never point the suite at your development database.

5. Verify the production build works:

```bash
npm run build
```

6. Open a pull request against `main`

### Cutting a Docker release

Thinker ships as the multi-arch (`linux/amd64`, `linux/arm64`) Docker image [`tmsoftbrasil/thinker`](https://hub.docker.com/r/tmsoftbrasil/thinker). Every release goes out through `scripts/ship.sh "<conventional commit message>" [patch|minor|major]` ([ADR 0005](docs/adr/0005-modo-autonomo.md)): it bumps `packages/thinker/package.json`, writes `docs/releases/X.Y.Z.md` from the commit subjects, lands the change on `main`, and pushes the `vX.Y.Z` tag. The tag runs `.github/workflows/release.yml`, which builds both architectures, pushes `X.Y.Z`, `X.Y`, `latest` and `sha-<short>`, and creates the GitHub release. When the repository has no Docker Hub secrets, `ship.sh` builds and publishes the same image and release from the local Docker instead.

The full flow is in the [developer guide](docs/dev/guia.md).

### Commit Messages

Write clear, concise commit messages that explain **why** the change was made. Use present tense (e.g., "Add token cost breakdown to overview page").

### Pull Requests

- Keep PRs focused on a single concern
- Include a short summary of what changed and why
- Reference any related issues

## Architecture Notes

- **Single-service deployment**: In production, NestJS serves both the API and the frontend static files from the same port via `@nestjs/serve-static`.
- **Dev mode**: Vite on `:3000` proxies `/api` and `/v1` to the backend on `:3001`. CORS is enabled only in development.
- **Database**: PostgreSQL 18 for both local development and production. Schema changes are managed via TypeORM migrations (`migrationsRun: true` on boot). After modifying an entity, generate a migration with `npm run migration:generate -- src/database/migrations/Name`.
- **Validation**: Global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`.
- **TypeScript**: Strict mode across all packages.

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/patrickbrandao/thinker/issues) with as much detail as possible.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
