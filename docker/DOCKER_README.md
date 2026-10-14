# Thinker

<p>
  <a href="https://hub.docker.com/r/tmsoftbrasil/thinker"><img src="https://img.shields.io/docker/pulls/tmsoftbrasil/thinker?color=2496ED&label=docker%20pulls" alt="Docker pulls" /></a>
  &nbsp;
  <a href="https://github.com/patrickbrandao/thinker/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license" /></a>
</p>

## What is Thinker?

Thinker is an open-source LLM gateway for agents and apps. It sits between your agents (Claude Code, Codex, OpenCode, SDK apps and others) and your inference providers (API keys, subscriptions, local models, custom endpoints), routes each request to the right model, and tracks cost, tokens and full request logs from one dashboard.

Thinker is derived from an MIT-licensed upstream project and evolves independently. The image ships `/app/LICENSE` and `/app/THIRD_PARTY_NOTICES`.

---

## Table of contents

- [Supported providers](#supported-providers)
- [Installation](#installation)
  - [Option 1: Quickstart install script (recommended)](#option-1-quickstart-install-script-recommended)
  - [Option 2: Docker Compose (manual)](#option-2-docker-compose-manual)
  - [Option 3: Docker Run (bring your own PostgreSQL)](#option-3-docker-run-bring-your-own-postgresql)
  - [First request](#first-request)
  - [Custom port](#custom-port)
  - [Exposing on the LAN](#exposing-on-the-lan)
- [Image tags](#image-tags)
- [Upgrading](#upgrading)
- [Backup & persistence](#backup--persistence)
- [Connecting local LLM servers](#connecting-local-llm-servers)
- [Environment variables](#environment-variables)
- [Links](#links)

## Supported providers

Works with 300+ models across OpenAI, Anthropic, Google Gemini, DeepSeek, xAI, Mistral, Qwen, MiniMax, Kimi, Amazon Nova, Z.ai, OpenRouter, Ollama, and any provider with an OpenAI-compatible API. Connect with an API key, or reuse an existing paid subscription (ChatGPT Plus/Pro, Claude Max/Pro, Kimi Coding Plan, GLM Coding Plan, etc.) where supported.

## Installation

Three paths, ordered from fastest to most hands-on. All three end in the same place: a running stack at [http://localhost:2099](http://localhost:2099) where you sign up. The first account you create becomes the admin. No demo credentials are pre-seeded.

> **Heads up on network binding.** The bundled compose file binds port 2099 to `127.0.0.1` only, so the dashboard is reachable on the host machine but not over the LAN. See [Exposing on the LAN](#exposing-on-the-lan) to expose it beyond localhost.

### Option 1: Quickstart install script (recommended)

One command. The installer downloads the compose file, generates the secrets, and brings up the stack. First boot pulls the app image and Postgres, so give it up to a couple of minutes.

```bash
bash <(curl -sSL https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/install.sh)
```

<details>
<summary><strong>Prefer to review the script before running it?</strong></summary>

Download the script:

```bash
curl -sSLO https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/install.sh
```

Review it (optional):

```bash
less install.sh
```

Run it:

```bash
bash install.sh
```

</details>

Useful flags: `--dir <path>` to install elsewhere, `--port <n>` to serve on a port other than 2099, `--dry-run` to preview, `--yes` to skip the confirmation prompt.

Re-running the installer against an existing install directory resumes it — the compose file and your generated secrets are left untouched and the stack is brought back up.

### Option 2: Docker Compose (manual)

Same underlying flow as the install script, but you drive it yourself so you can edit the config before booting the stack.

1. Download the compose file and the env template into the same directory:

```bash
curl -O https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/docker-compose.yml
curl -O https://raw.githubusercontent.com/patrickbrandao/thinker/main/docker/.env.example
cp .env.example .env
```

2. Open `.env` in your editor and set `BETTER_AUTH_SECRET` and
   `THINKER_ENCRYPTION_KEY` to two **different** random strings. Generate each with:

```bash
openssl rand -hex 32
```

`THINKER_ENCRYPTION_KEY` encrypts the provider API keys, OAuth tokens and
request recordings Thinker stores; the rest of the database is not encrypted
by it. Keep it separate from `BETTER_AUTH_SECRET`, so one leaked
session-signing secret does not also decrypt every stored credential and
recording. Set it before first boot.
Recordings written under a previous secret are not migrated: after the secret
changes they can no longer be decrypted and the dashboard shows them as
unavailable, while retention removes them on schedule.

(Optional: to use a stronger database password, set BOTH `POSTGRES_PASSWORD` and `DATABASE_URL` in `.env`, they must agree, and any special characters in the password need to be percent-encoded in the URL.)

3. Start the stack:

```bash
docker compose up -d
```

Give it up to a couple of minutes on a cold pull — you can watch startup with `docker compose logs -f thinker`.

4. Open [http://localhost:2099](http://localhost:2099) and sign up. The first account you create becomes the admin.

5. Connect a provider and send your first request — see [First request](#first-request).

To stop:

```bash
docker compose down       # keeps data
docker compose down -v    # deletes everything
```

### Option 3: Docker Run (bring your own PostgreSQL)

If you already have PostgreSQL running, replace `user`, `pass`, and `host` with your actual database credentials, then run this in your terminal:

<details open>
<summary><strong>macOS / Linux (bash, zsh)</strong></summary>

```bash
docker run -d \
  -p 2099:2099 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/thinker \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -e THINKER_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  -e BETTER_AUTH_URL=http://localhost:2099 \
  tmsoftbrasil/thinker
```

</details>

<details>
<summary><strong>Windows (PowerShell)</strong></summary>

```powershell
$secret = -join ((48..57 + 97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
$key = -join ((48..57 + 97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })

docker run -d `
  -p 2099:2099 `
  -e DATABASE_URL=postgresql://user:pass@host:5432/thinker `
  -e BETTER_AUTH_SECRET=$secret `
  -e THINKER_ENCRYPTION_KEY=$key `
  -e BETTER_AUTH_URL=http://localhost:2099 `
  tmsoftbrasil/thinker
```

</details>

<details>
<summary><strong>Windows (CMD)</strong></summary>

Generate two different 64-character hex secrets with any tool you trust, then:

```cmd
docker run -d ^
  -p 2099:2099 ^
  -e DATABASE_URL=postgresql://user:pass@host:5432/thinker ^
  -e BETTER_AUTH_SECRET=<your-64-char-secret> ^
  -e THINKER_ENCRYPTION_KEY=<another-64-char-secret> ^
  -e BETTER_AUTH_URL=http://localhost:2099 ^
  tmsoftbrasil/thinker
```

</details>

TypeORM migrations run automatically on every boot — fresh installs come up with the schema in place. Then visit [http://localhost:2099](http://localhost:2099) and complete the setup wizard to create your admin account.

### First request

Signing up leaves you with an empty instance. Three steps to a routed request:

1. **Connect a provider.** In the sidebar, **Providers → Usage-based** to paste
   an API key (OpenAI, Anthropic, Gemini, …), **Subscriptions** to reuse a plan
   you already pay for, or **Local** for Ollama / LM Studio / llama.cpp.
   Thinker discovers the available models as soon as the connection is saved.

2. **Copy your agent's key.** Each agent has its own key, shown when you create
   it and under the agent's **Settings**. It starts with `thk_`.

3. **Point something at it.** The endpoint is OpenAI-compatible, so any SDK or
   agent that takes a base URL works — use `http://localhost:2099/v1` and the
   `thk_` key. To check it end to end:

```bash
curl -X POST http://localhost:2099/v1/chat/completions \
  -H "Authorization: Bearer thk_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello"}]}'
```

`"model": "auto"` asks Thinker to route. Any other model name is treated as an
explicit choice and falls back to your routing config if it matches nothing.

Errors from Thinker itself carry an `M###` code and a plain-English cause —
including `M100` (no provider connected yet) and `M003`/`M005` (bad or unknown key), the
three you are most likely to hit on a fresh install.

### Custom port

**Compose installs — set `PORT` in `.env`, and nothing else:**

```env
PORT=8080
```

The compose file reads `${PORT:-2099}` for both the published host port and
the backend's internal listener, and `BETTER_AUTH_URL` defaults to
`http://localhost:${PORT:-2099}`, so one line covers all three. No YAML edit.
The install script does this for you with `--port 8080`.

**`docker run` installs** have no `.env`, so pass the mapping and the URL
explicitly. Here the container keeps listening on 2099 and Docker remaps it:

```bash
docker run -d \
  -p 8080:2099 \
  -e BETTER_AUTH_URL=http://localhost:8080 \
  ...
```

`BETTER_AUTH_URL` must match the URL you type in the browser — host and port
both. A mismatch fails the login with "Invalid origin".

### Exposing on the LAN

By default the compose file binds port `2099` to `127.0.0.1` only. The dashboard is reachable from the host but not from other machines on the network. To expose it on the LAN:

1. In `.env`, set `HOST_BIND_ADDRESS=0.0.0.0`. Editing `docker-compose.yml` by hand does not survive an upgrade; `.env` does.
2. In `.env`, set `BETTER_AUTH_URL` to the host you'll reach the dashboard on, e.g. `http://192.168.1.20:2099` or `https://thinker.mydomain.com`. This MUST match the URL in the browser or Better Auth will reject the login with "Invalid origin".
3. `docker compose up -d` to apply.

If you see "Invalid origin" on the login page, `BETTER_AUTH_URL` doesn't match the URL you're accessing the dashboard on. The host matters as much as the port.

If the dashboard loads as a **blank page on a LAN IP on an older image**, pull the latest image (`docker compose pull && docker compose up -d`). Older builds emitted an `upgrade-insecure-requests` CSP directive that made browsers rewrite `/assets/*.js` to HTTPS on private-IP hosts (10.x / 172.16-31.x / 192.168.x), which the server doesn't serve — the JS bundle failed to load and the page never mounted. This directive has been removed.

## Image tags

Every release is published with the following tags:

- `{major}.{minor}.{patch}` - fully pinned (e.g. `0.1.0`)
- `{major}.{minor}` - latest patch within a minor (e.g. `0.1`), stable releases only
- `latest` - latest stable release
- `sha-<short>` - exact commit for rollback
- `{major}.{minor}.{patch}-rc.{n}` - release candidates; they never move `{major}.{minor}` or `latest`

Images are built for both `linux/amd64` and `linux/arm64`.

## Upgrading

Thinker ships a new image on every release. To upgrade an existing compose install:

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically on boot, no manual steps. Your data in the `pgdata` volume is preserved across upgrades. To control when upgrades happen, pin a minor version with `THINKER_VERSION=0.1` in `.env`. The install script can also replace the managed compose file safely: `bash install.sh --upgrade`.

## Backup & persistence

PostgreSQL state lives in the `thinker_pgdata` named volume mounted at `/var/lib/postgresql/data` in the `postgres` service. The Compose install also stores local request recordings in the `thinker_request_recordings` volume mounted at `/data/request-recordings`; those recordings are not included in a PostgreSQL dump. For ephemeral hosts or multiple instances, configure durable S3-compatible storage instead.

**Back up** (from the host, with the stack running):

```bash
docker compose exec -T postgres pg_dump -U thinker thinker > thinker-backup-$(date +%F).sql
```

**Restore** into a fresh stack:

```bash
docker compose up -d postgres
cat thinker-backup-2026-04-12.sql | docker compose exec -T postgres psql -U thinker thinker
docker compose up -d
```

To list / remove the volume manually:

```bash
docker volume ls | grep -E 'thinker_(pgdata|request_recordings)'
docker compose down -v    # ⚠  destroys all data
```

## Connecting local LLM servers

The self-hosted Thinker container can reach any OpenAI-compatible server running on your host via `host.docker.internal:<port>`. This works on Docker Desktop (macOS/Windows) out of the box, and on Linux with Docker Engine 20.10 or later.

Because the container detects self-hosted mode automatically (via `/.dockerenv`), it lets you add custom providers with `http://` and private/loopback URLs — cloud-metadata endpoints (169.254.169.254, etc.) stay blocked.

### Ollama (built-in tile)

1. Install Ollama from [ollama.com](https://ollama.com) and pull a model:

```bash
ollama pull llama3.1:8b
```

2. In the dashboard, go to Providers → API Keys → click the **Ollama** tile.
3. Thinker reaches Ollama at `http://host.docker.internal:11434` and syncs the available models.

### LM Studio

1. Install LM Studio from https://lmstudio.ai, load at least one chat model, and start the local server. **Bind to `0.0.0.0`** so the Thinker container can reach it:
   - GUI: Developer tab → enable "Serve on Local Network" (LM Studio persists this across restarts).
   - CLI: `lms server start --bind 0.0.0.0 --port 1234 --cors`
2. Providers → API Keys → click the **LM Studio** tile.
3. Thinker probes `http://host.docker.internal:1234/v1`, discovers your loaded models, and connects them in one click.

### llama.cpp

1. Build `llama-server` from the [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) repo (or grab a release binary), then start it with a GGUF model bound to `0.0.0.0` so the Thinker container can reach it:

   ```bash
   ./llama-server -m models/llama-3.1-8b-instruct.Q4_K_M.gguf --host 0.0.0.0 --port 8080
   ```

   `llama-server` only listens on `0.0.0.0` if you pass `--host 0.0.0.0`; the default bind isn't reachable from Docker.

2. Providers → API Keys → click the **llama.cpp** tile.
3. Thinker probes `http://host.docker.internal:8080/v1`, lists the model your server loaded, and connects it in one click. Pre-b3800 builds that don't expose `/v1/models` get a hint to upgrade or fall back to **Add custom provider**.

### Any other OpenAI-compatible server

For vLLM, text-generation-webui, TogetherAI proxies, Azure OpenAI gateways, or anything else that speaks OpenAI's HTTP API:

1. Start your server on the host bound to `0.0.0.0`.
2. Providers → API Keys → **Add custom provider** → type the URL (e.g. `http://host.docker.internal:8000/v1`).
3. Click **Fetch models** to auto-populate the model list from the server's `/v1/models` endpoint.

### Running Ollama on another machine

If Ollama runs on a different host on your LAN, set `OLLAMA_HOST` in `.env` to the full URL (e.g. `http://192.168.1.20:11434`) and restart the stack. Private IPs are allowed in the self-hosted version.

### Podman / rootless containers

Podman doesn't ship `/.dockerenv` or `host.docker.internal`. The canonical
hostname for reaching the host from inside a Podman container is
`host.containers.internal` (Podman 4+ exposes this by default; older versions
need `--add-host=host.containers.internal:host-gateway`), and Thinker suggests
it when it finds `/run/.containerenv`.
If you run Thinker as one Podman service and your LLM server (llama.cpp,
Ollama, etc.) as another, point Thinker at the service name on the shared
network — e.g. `http://llamacpp:8080/v1`. **Add custom provider** accepts
LAN, loopback and `http://` URLs on any runtime, as long as the hostname
resolves from inside the Thinker container. Cloud metadata and container
credential endpoints (such as `169.254.169.254` or `169.254.170.2`) are always
refused, including when a hostname starts resolving to them after it was saved.

## Environment variables

| Variable                           | Required    | Default                                      | Description                                                                                                                                                                                                |
| ---------------------------------- | ----------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | Yes         | --                                           | PostgreSQL connection string                                                                                                                                                                               |
| `BETTER_AUTH_SECRET`               | Yes         | --                                           | Session signing secret (min 32 chars)                                                                                                                                                                      |
| `THINKER_ENCRYPTION_KEY`           | Yes         | --                                           | Separate 32+ char key (different from `BETTER_AUTH_SECRET`) encrypting stored provider keys, OAuth tokens and recordings. The install script generates one.                                                |
| `BETTER_AUTH_URL`                  | No          | `http://localhost:${PORT}`                   | Public URL. Must match the URL in the browser                                                                                                                                                              |
| `PORT`                             | No          | `2099`                                       | Dashboard port — sets both the published host port and the internal listener                                                                                                                               |
| `OLLAMA_HOST`                      | No          | `http://host.docker.internal:11434`          | Ollama endpoint for the built-in tile. Override to point at a LAN-hosted Ollama.                                                                                                                           |
| `THINKER_CIMD_ALLOW_PRIVATE`       | No          | `false`                                      | Set `true` to let MCP clients whose Client ID Metadata Document URL resolves to a private or loopback address sign in. Off by default to block SSRF from unauthenticated clients.                          |
| `TRUST_PROXY`                      | No          | `loopback` (compose)                         | Reverse proxy allowed to set `X-Forwarded-For`/`-Proto`: an address, CIDR or hop count                                                                                                                     |
| `THINKER_DISABLE_HSTS`             | No          | unset                                        | Set `1` to silence the boot warning about serving over plain HTTP on a LAN                                                                                                                                 |
| `THROTTLE_LIMIT` / `THROTTLE_TTL`  | No          | `100` / `60000`                              | Rate limit: requests per window, window in ms                                                                                                                                                              |
| `THINKER_CATALOG_SYNC`             | No          | `true`                                       | Set `false` to stop fetching the public model catalogs (see [No telemetry](#no-telemetry)). Costs then come from the bundled data only, so most models show $0                                                |
| `DB_POOL_MAX` / `AUTH_DB_POOL_MAX` | No          | `10` / `5`                                   | PostgreSQL pool sizes (app pool, Better Auth pool)                                                                                                                                                         |

`NODE_ENV` and `SEED_DATA` are deliberately fixed by the compose file and are
not knobs here: the image is a production artifact, and the demo-data seeder
refuses to run under `NODE_ENV=production` regardless of `SEED_DATA`. Use the
first-run setup wizard to create your admin account.

Every variable the compose file passes through is listed, with comments, in
[`.env.example`](https://github.com/patrickbrandao/thinker/blob/main/docker/.env.example).

## No telemetry

The container makes no outbound call of its own: no usage telemetry, no update
check, no error reporting. It only reaches the inference providers you
configure and these public model catalogs:

| Destination                                    | When                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `openrouter.ai` (`/api/v1/models`)             | at boot and once a day                                       |
| `models.dev` (`/api.json`)                     | at boot and once a day                                       |
| `raw.githubusercontent.com` (OpenCode Go docs) | only when an OpenCode Go provider is registered, cached 1 h  |

Set `THINKER_CATALOG_SYNC=false` to turn all three off, for example on an
air-gapped host. Prices and capabilities then come only from the data bundled
in the image, which covers few models: requests to most models are recorded
without a known price and show as $0, OpenCode Go requests show $0, and the
pricing refresh endpoint reports `sync_enabled: false`.

## Links

- [GitHub](https://github.com/patrickbrandao/thinker)
- [Docs (PT-BR)](https://github.com/patrickbrandao/thinker/tree/main/docs)
- [Issues](https://github.com/patrickbrandao/thinker/issues)

## License

[MIT](https://github.com/patrickbrandao/thinker/blob/main/LICENSE)
