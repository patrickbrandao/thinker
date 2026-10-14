# Templates de deploy da comunidade

> **Não testados oficialmente.** A única instalação oficial e testada na CI é Docker/Compose ([Instalação com Docker](instalacao-docker.md)). Os templates abaixo são mantidos pela comunidade, não passam pela CI e podem estar desatualizados ou quebrados. Revise antes de usar e abra uma issue se algo falhar.

Todos ficam em [`deploy/`](../../deploy/) e têm um `TUTORIAL.md`:

| Plataforma | Guia | Observações |
| --- | --- | --- |
| Render | [`render.yaml`](../../render.yaml) | Blueprint com Thinker, PostgreSQL e disco persistente para as gravações. |
| DigitalOcean | [`deploy/digitalocean`](../../deploy/digitalocean/TUTORIAL.md) | App Platform e PostgreSQL; informe um Space privado para as gravações. |
| AWS | [`deploy/aws`](../../deploy/aws/TUTORIAL.md) | CloudFormation com ECS, RDS e um bucket privado. |
| GCP | [`deploy/gcp`](../../deploy/gcp/TUTORIAL.md) | Cloud Run, Cloud SQL e Cloud Storage. |
| Fly.io | [`deploy/fly`](../../deploy/fly/TUTORIAL.md) | Bucket Tigris para as gravações. |
| Coolify | [`deploy/coolify`](../../deploy/coolify/TUTORIAL.md) | Volume persistente. |
| Easypanel | [`deploy/easypanel`](../../deploy/easypanel/TUTORIAL.md) | Volume persistente. |
| Heroku | [`deploy/heroku`](../../deploy/heroku/TUTORIAL.md) | Configure armazenamento S3 externo. |
| Koyeb | [`deploy/koyeb`](../../deploy/koyeb/TUTORIAL.md) | Configure armazenamento S3 externo. |
| Apple Containers | [`deploy/apple-containers`](../../deploy/apple-containers/TUTORIAL.md) | Volume persistente. |

Em qualquer plataforma valem as mesmas regras: defina `BETTER_AUTH_SECRET` e `THINKER_ENCRYPTION_KEY` (valores diferentes), `BETTER_AUTH_URL` com a URL pública e use armazenamento S3 para as gravações se houver mais de uma réplica. O token de setup do primeiro administrador sai no log do serviço; com várias réplicas, veja a [limitação do token](instalacao-docker.md#primeiro-acesso-o-token-de-setup).
