# Run Thinker with Apple Containers

> **Template mantido pela comunidade, não testado no CI.** O único caminho oficial e testado é o Docker Compose ([`docker/`](https://github.com/patrickbrandao/thinker/tree/main/docker)). Repositório: [patrickbrandao/thinker](https://github.com/patrickbrandao/thinker) · [issues](https://github.com/patrickbrandao/thinker/issues).

This guide runs Thinker and PostgreSQL on Apple silicon using Apple's [`container`](https://github.com/apple/container) CLI. The deployment mirrors the bundled Docker Compose stack while accounting for differences in Apple Containers networking and storage.

## Prerequisites

- An Apple silicon Mac running a supported macOS version.
- The Apple Containers `container` CLI installed from the [Apple Containers releases](https://github.com/apple/container/releases).
- This Thinker repository checked out locally.
- `curl` and OpenSSL, which are included with macOS.

Confirm the CLI is available:

```bash
container --version
```

### After upgrading Apple Containers

The CLI and its persistent background services must run the same version. Homebrew or package upgrades can replace the CLI while leaving an older `container-apiserver` running. That mismatch may surface as `builtin network is not present`, decoding errors, or missing default-network state.

After every Apple Containers upgrade, restart its services once:

```bash
container system stop
container system start --enable-kernel-install
container system version
```

The `container` and `container-apiserver` rows should report the same version. Startup also checks this and prints these recovery commands instead of continuing with mismatched components.

## Configure Thinker

The script reads `docker/.env`, the same configuration file used by Docker Compose.

Create it from the example if it does not exist:

```bash
cp docker/.env.example docker/.env
```

Generate a Better Auth secret and add it to `docker/.env`:

```bash
openssl rand -hex 32
```

```env
BETTER_AUTH_SECRET=<paste-the-generated-value>
```

For stronger separation between session signing and encrypted provider credentials, generate another value and set:

```env
THINKER_ENCRYPTION_KEY=<a-different-generated-value>
```

The default dashboard URL is `http://localhost:2099`. To use another port, set `PORT` and keep `BETTER_AUTH_URL` aligned:

```env
PORT=3001
BETTER_AUTH_URL=http://localhost:3001
```

You can use a different configuration file by exporting `THINKER_ENV_FILE`:

```bash
THINKER_ENV_FILE=/path/to/thinker.env ./deploy/apple-containers/start.sh up
```

Explicitly exported environment variables take precedence over values in the file.

### Custom PostgreSQL password

The default bundled database password is `thinker`. To change it, set both variables as described in `docker/.env.example`:

```env
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgresql://thinker:change-me@postgres:5432/thinker
```

The script replaces the Compose hostname `postgres` with the PostgreSQL container's current IP. Percent-encode URL-special characters in the `DATABASE_URL` password.

`POSTGRES_PASSWORD` initializes a new database volume; changing it later does not rotate the password stored by PostgreSQL. If the persistent volume already exists, either keep its original password or rotate the `thinker` PostgreSQL role explicitly.

## Start Thinker

From the repository root, run:

```bash
./deploy/apple-containers/start.sh up
```

`up` is also the default command:

```bash
./deploy/apple-containers/start.sh
```

The script:

1. Starts the Apple Containers service.
2. Creates or reuses the `thinker-postgres-data` database volume and `thinker-request-recordings` recording volume.
3. Starts PostgreSQL and verifies an authenticated connection.
4. Discovers the PostgreSQL container address.
5. Recreates the Thinker container so it always receives the current database address.
6. Publishes the dashboard on host loopback and waits for `/api/v1/health`.

When startup succeeds, open:

```text
http://localhost:2099
```

On first boot, complete the setup wizard at `/setup` to create the admin account.

## Manage the Stack

Show container state and the dashboard URL:

```bash
./deploy/apple-containers/start.sh status
```

Stop and remove both containers:

```bash
./deploy/apple-containers/start.sh down
```

Both named volumes are retained, so a later `up` restores the same database and request recordings.

Running `up` repeatedly is safe. A running PostgreSQL container is reused, while Thinker is recreated to pick up the current PostgreSQL IP and configuration.

## Upgrade Thinker

First, back up the database:

```bash
container exec thinker-postgres pg_dump -U thinker thinker > thinker-backup-$(date +%F).sql
```

The script always launches `tmsoftbrasil/thinker:latest`, but `container run` uses the locally cached copy of that tag. To upgrade to a new release, pull the image explicitly and re-run `up`:

```bash
container image pull tmsoftbrasil/thinker:latest
./deploy/apple-containers/start.sh up
```

`up` recreates the Thinker container, so it starts from the freshly pulled image. Database migrations run automatically on boot — no manual steps. The PostgreSQL container, database volume, and request-recording volume are not touched, so all data is preserved across upgrades.

## Local LLM Servers

Apple Containers does not provide Docker's `host.docker.internal` hostname. By default, the script uses the container network gateway for Ollama:

```text
http://<gateway-ip>:11434
```

A host LLM server must listen on an interface reachable through that gateway. A service bound only to `127.0.0.1` cannot be reached from the container.

For Ollama, configure `OLLAMA_HOST` on the macOS host according to Ollama's documentation. Avoid exposing the service broadly unless your firewall and network are trusted. You can also point Thinker at another reachable endpoint through `docker/.env`:

```env
OLLAMA_HOST=http://192.168.1.50:11434
```

## Networking and VPNs

The dashboard is published to `127.0.0.1`, providing a stable URL that does not depend on Apple Containers' private subnet and is less likely to conflict with VPN routes.

PostgreSQL-to-Thinker traffic still uses the private address assigned by Apple Containers. The script discovers that address on every `up` and recreates Thinker accordingly. If Apple Containers cannot create or inspect its network while a VPN is active:

1. Run `./deploy/apple-containers/start.sh down`.
2. Temporarily disconnect the VPN.
3. Run `./deploy/apple-containers/start.sh up`.
4. Reconnect the VPN and verify `http://localhost:2099/api/v1/health`.

The script prints the complete `container inspect` output if it cannot identify the required network addresses.

## Persistence and Backups

PostgreSQL data is stored in `thinker-postgres-data`, and compressed request recordings are stored in `thinker-request-recordings`. Override either volume name before startup with:

```bash
THINKER_PG_VOLUME=my-thinker-data ./deploy/apple-containers/start.sh up
THINKER_RECORDINGS_VOLUME=my-thinker-recordings ./deploy/apple-containers/start.sh up
```

The script mounts the named volume at `/var/lib/postgresql`. PostgreSQL 18 images keep their data in the version-specific `PGDATA` `/var/lib/postgresql/18/docker`, a nested directory, so a root-level `lost+found` directory on a newly formatted Apple Containers volume does not get in the way. A volume created by an earlier version of this script (PostgreSQL 16, data under `pgdata/`) is not migrated: start with a new volume.

`down` never deletes either named volume. Use Apple Containers volume commands to inspect or deliberately remove them:

```bash
container volume inspect thinker-postgres-data
container volume inspect thinker-request-recordings
container volume delete thinker-postgres-data
container volume delete thinker-request-recordings
```

Deleting either volume permanently deletes its database or recording data. PostgreSQL dumps do not include recordings, so back up the recording volume separately before removing it.

## Troubleshooting

### `builtin network is not present`

This usually means Apple Containers was upgraded while its older background services kept running. Compare component versions and restart the services:

```bash
container system version
container system stop
container system start --enable-kernel-install
container network inspect default
```

If `container system stop` prints protocol or decoding errors, continue with `container system start --enable-kernel-install`; the stop command still unloads the old services after attempting to stop containers. The final inspect command should show the recreated builtin `default` network.

### View logs

```bash
container logs thinker-postgres
container logs thinker-app
```

### PostgreSQL stops during initialization

If logs mention `lost+found`, confirm the volume is mounted at `/var/lib/postgresql` (not at the data directory itself) and that `PGDATA` is not overridden, so PostgreSQL uses its default `/var/lib/postgresql/18/docker`.

If logs mention `chmod` or `chown` being denied, do not replace the named volume with a macOS bind mount. The official PostgreSQL image needs filesystem ownership changes that Apple Containers bind mounts do not provide.

### PostgreSQL rejects the password

The named volume was probably initialized with a different password. Restore the original `POSTGRES_PASSWORD`, or rotate the database role password inside PostgreSQL and update `DATABASE_URL` to match.

### Thinker stops before becoming healthy

The script prints the container logs automatically. You can inspect them again with:

```bash
container logs thinker-app
```

Common causes include a mismatched database URL, a port already in use, or invalid environment values.

### Port already in use

Choose another port in `docker/.env`:

```env
PORT=2100
BETTER_AUTH_URL=http://localhost:2100
```

Then rerun `up`.

### Reset the deployment

Stop the containers first:

```bash
./deploy/apple-containers/start.sh down
```

To also discard all database and request-recording state, deliberately delete both named volumes:

```bash
container volume delete thinker-postgres-data
container volume delete thinker-request-recordings
```

Then run `up` again. This is destructive and returns Thinker to a fresh-install state.
