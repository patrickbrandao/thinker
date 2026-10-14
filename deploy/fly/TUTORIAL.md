# Deploy Thinker on Fly.io

> **Template mantido pela comunidade, não testado no CI.** O único caminho oficial e testado é o Docker Compose ([`docker/`](https://github.com/patrickbrandao/thinker/tree/main/docker)). Repositório: [patrickbrandao/thinker](https://github.com/patrickbrandao/thinker) · [issues](https://github.com/patrickbrandao/thinker/issues).

This guide deploys Thinker on Fly.io with the public Thinker Docker image, a Fly Postgres database, and a private Tigris S3-compatible bucket for request recordings.

Fly is a CLI-first deployment target, not a browser one-click button. The script in this directory creates the app, creates Postgres, attaches `DATABASE_URL`, generates Thinker secrets, and deploys the Docker image.

## Prerequisites

- A Fly.io account with billing enabled.
- `flyctl` installed and authenticated with `fly auth login`.
- `curl` and `jq` installed so the deploy script can verify the attached Tigris bucket on reruns.
- Permission to create Fly apps and Postgres apps.

This stack creates paid resources. Review Fly pricing before leaving test apps running.

## Fast Deploy

From the Thinker repository root:

```bash
FLY_APP_NAME=thinker-demo \
FLY_REGION=cdg \
FLY_ORG=personal \
./deploy/fly/deploy.sh
```

Environment variables:

- `FLY_APP_NAME`: Fly app name. Defaults to a generated `thinker-<hex>` name.
- `FLY_POSTGRES_APP_NAME`: Postgres app name. Defaults to `<app-name>-db`.
- `FLY_REGION`: Fly region. Defaults to `cdg`.
- `FLY_ORG`: Fly organization. Defaults to `personal`.
- `FLY_RECORDING_BUCKET_NAME`: private Tigris bucket name. Defaults to `<app-name>-recordings`. Keep the same value on reruns; changing an attached bucket requires a manual recording migration.

The script uses [`fly.toml`](fly.toml) as a template and deploys `docker.io/tmsoftbrasil/thinker:0.1`. It creates a private Tigris bucket and lets Fly stage the bucket's `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets on the app; Thinker uses those credentials with the bucket name, Tigris endpoint, and `auto` region from `fly.toml`. Re-running the script keeps that bucket and the existing `BETTER_AUTH_SECRET` and `THINKER_ENCRYPTION_KEY` values; rotate those secrets manually only if you intend to invalidate sessions and encrypted provider credentials.

## Manual Deploy

Create the app and database:

```bash
APP_NAME=thinker-demo
POSTGRES_APP_NAME=${APP_NAME}-db
RECORDING_BUCKET_NAME=${APP_NAME}-recordings
REGION=cdg
ORG=personal

fly apps create "$APP_NAME" --org "$ORG" -y

fly storage create \
  --name "$RECORDING_BUCKET_NAME" \
  --org "$ORG" \
  --app "$APP_NAME" \
  --yes

fly postgres create \
  --name "$POSTGRES_APP_NAME" \
  --org "$ORG" \
  --region "$REGION" \
  --initial-cluster-size 1 \
  --vm-cpu-kind shared \
  --vm-cpus 1 \
  --vm-memory 512 \
  --volume-size 1

fly postgres attach "$POSTGRES_APP_NAME" \
  --app "$APP_NAME" \
  --database-name thinker \
  --database-user thinker \
  --yes
```

Set secrets:

```bash
fly secrets set \
  --app "$APP_NAME" \
  --stage \
  "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" \
  "THINKER_ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

Copy `deploy/fly/fly.toml` to a temporary file, replace `thinker-example` with your app name, then deploy:

```bash
cp deploy/fly/fly.toml fly.toml
perl -pi -e "s/thinker-recordings-bucket/$RECORDING_BUCKET_NAME/g; s/thinker-example/$APP_NAME/g; s/primary_region = \"cdg\"/primary_region = \"$REGION\"/" fly.toml
fly deploy --app "$APP_NAME" --config fly.toml
```

## Open Thinker

Open the deployed app and create the first admin account:

```text
https://<your-fly-app>.fly.dev
```

Verify the deployment:

```bash
curl -fsS https://<your-fly-app>.fly.dev/api/v1/health
```

View logs:

```bash
fly logs --app <your-fly-app>
```

## What Gets Provisioned

- Fly app running `docker.io/tmsoftbrasil/thinker:0.1`.
- Fly Postgres app.
- Private Tigris S3-compatible bucket for compressed request recordings.
- `DATABASE_URL` secret from `fly postgres attach`.
- Generated `BETTER_AUTH_SECRET` and `THINKER_ENCRYPTION_KEY` secrets.
- HTTPS Fly domain at `https://<app>.fly.dev`.

## Production notes

- The template keeps one Machine running with `min_machines_running = 1` so Thinker is always available for agents.
- Tigris is shared across Machines, so recording storage remains consistent if you scale the Thinker app horizontally.
- For production, choose a larger Postgres configuration or Fly Managed Postgres instead of the small script default.
- Add a custom domain before configuring OAuth callback URLs.
- Destroy the app, database, and recording bucket when testing is done. Export any recordings you need before destroying the bucket:

```bash
fly apps destroy <your-fly-app>
fly apps destroy <your-fly-postgres-app>
fly storage destroy <your-recording-bucket>
```

Relevant Fly docs:

- [Fly app configuration](https://fly.io/docs/reference/configuration/)
- [Deploy an existing Docker image](https://fly.io/docs/reference/configuration/#specify-a-docker-image)
- [Create Postgres](https://fly.io/docs/python/do-more/add-postgres/)
- [Attach Postgres](https://fly.io/docs/postgres/managing/attach-detach/)
- [Tigris object storage](https://fly.io/docs/tigris/)
