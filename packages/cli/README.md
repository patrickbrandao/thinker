# Thinker CLI

`thinker` manages a Thinker gateway from your terminal. Use it to create agents, connect AI providers, configure model routing, and inspect requests. The dashboard calls agents **Harnesses**; CLI commands use `agent`.

The package is `thinker-cli` and the command it installs is `thinker`. Node.js 20 or later is required. The CLI is not published to any package registry; install it from a checkout of this repository.

## Install

From the repository root:

```bash
npm ci
npm run build --workspace=packages/shared
npm run build --workspace=packages/cli
npm install -g ./packages/cli
thinker --help
```

To install it on another machine, pack it and copy the tarball:

```bash
npm pack --workspace=packages/cli
npm install -g ./thinker-cli-<version>.tgz
```

## Quick start

Sign in to your gateway, then create an agent and connect a provider. With no `--url`, `THINKER_URL` or stored login, the CLI targets a gateway on this machine at `http://localhost:2099`; it never falls back to a hosted service.

```bash
thinker login
thinker agent create --name my-app --platform openai-sdk
thinker provider connect openai --agent my-app --credential-env OPENAI_API_KEY
thinker models my-app --provider openai
thinker agent configure my-app --models gpt-4o-mini --provider openai
thinker routing status my-app
thinker agent setup my-app
```

Set `OPENAI_API_KEY` in your environment before connecting the provider. Choose a model shown by `thinker models` if `gpt-4o-mini` is unavailable to your account. `thinker agent setup` returns wiring instructions with the agent key masked.

For a gateway on another host, pass its URL when you sign in:

```bash
thinker login --url https://gateway.example.com
```

The CLI uses that gateway for later commands. You can select another gateway with `--url` or `THINKER_URL`.

## Useful commands

| Task                           | Command                                          |
| ------------------------------ | ------------------------------------------------ |
| Check your connection          | `thinker doctor`                                 |
| List available agent platforms | `thinker agent platforms`                        |
| List connectable providers     | `thinker provider catalog`                       |
| Review an agent's routing      | `thinker routing status my-app`                  |
| Read or set model params       | `thinker routing params get my-app`              |
| Read recent requests           | `thinker requests get --agent my-app --range 7d` |
| See all commands and options   | `thinker --help`                                 |

Most commands write JSON to stdout for scripts and coding agents. `thinker agent env` and `thinker skill show` write text. `thinker routing test` sends a real provider request, which may incur provider charges. Destructive commands require `--yes`.

## Credentials

Browser login is the default. For a script, provide a management credential through standard input or an environment variable:

```bash
printf '%s' "$MY_KEY" | thinker login --token-stdin
# or
thinker login --token-env MY_KEY
```

The CLI stores login credentials for each gateway host in `~/.config/thinker/config.json` with file mode `0600`. A stored credential is only sent to the host where it was saved. `THINKER_API_KEY` overrides the stored credential for the selected host.

Agent keys are separate from management credentials. The CLI stores a newly created agent key in its local keystore and does not print it in `thinker agent setup` unless you pass `--reveal`. Use `thinker agent env my-app` to get the key and URL for your application; its output contains the key, so handle it as a secret.

### Upgrading from the upstream CLI

This CLI reads and writes only `~/.config/thinker/` (or `$XDG_CONFIG_HOME/thinker/`). The directory used by the upstream CLI it was forked from, including its stored logins, cached agent keys and the files left by its removed telemetry, is never read or migrated. Run `thinker login` again, then delete the old directory under `~/.config/`. Environment variables use the `THINKER_` prefix (`THINKER_URL`, `THINKER_API_KEY`, `THINKER_AGENT_KEY`, `THINKER_AGENT_URL`); the old names are not read.

## No telemetry

The CLI collects no usage data and makes no network call of its own: it only talks to the gateway you point it at.

## Documentation

Run `thinker --help` for every command and option, and `thinker skill show` for the operating guide written for coding agents. Source and issues live in the [GitHub repository](https://github.com/patrickbrandao/thinker).
