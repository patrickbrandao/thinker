# Deploy Thinker on AWS

> **Template mantido pela comunidade, não testado no CI.** O único caminho oficial e testado é o Docker Compose ([`docker/`](https://github.com/patrickbrandao/thinker/tree/main/docker)). Repositório: [patrickbrandao/thinker](https://github.com/patrickbrandao/thinker) · [issues](https://github.com/patrickbrandao/thinker/issues).

This walkthrough deploys Thinker on AWS with ECS Fargate, RDS PostgreSQL, a private S3 bucket for request recordings, Secrets Manager, and an Application Load Balancer. The stack uses public ECS tasks behind the load balancer and private RDS subnets, so it does not create a NAT gateway.

## Prerequisites

- An AWS account with billing enabled.
- Permission to create CloudFormation stacks, IAM roles, VPC resources, ECS, RDS, S3, Elastic Load Balancing, CloudWatch Logs, and Secrets Manager secrets.
- AWS CloudShell or a local shell with `aws` and `git` installed.

This stack creates paid resources, including an Application Load Balancer, ECS Fargate tasks, and RDS PostgreSQL.

TLS is required: you need a domain and an [ACM certificate](https://console.aws.amazon.com/acm/home) for it, issued in the deploy region. With `CERTIFICATE_ARN` and `PUBLIC_HOSTNAME` set, the load balancer serves HTTPS on 443 and redirects HTTP to it; after the deploy, point the hostname (CNAME or Route 53 alias) at the `LoadBalancerDnsName` output. Without a certificate the script refuses to run unless you pass `ALLOW_HTTP=true`, which serves plain HTTP for evaluation only: sign-in cookies and API keys would cross the internet unencrypted.

## Open AWS CloudShell

Open [AWS CloudShell](https://console.aws.amazon.com/cloudshell/home), choose the region you want to deploy into, then run:

```bash
git clone https://github.com/patrickbrandao/thinker.git
cd thinker
AWS_REGION=us-east-1 \
CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/... \
PUBLIC_HOSTNAME=thinker.example.com \
./deploy/aws/deploy.sh
```

Change `AWS_REGION` if you deploy outside `us-east-1`.

The first deploy usually takes 10-15 minutes because RDS needs time to provision.

## Configuration

The deploy script exposes the common settings as environment variables:

```bash
STACK_NAME=thinker \
SERVICE_NAME=thinker \
AWS_REGION=us-east-1 \
IMAGE_URL=docker.io/tmsoftbrasil/thinker:0.1 \
DATABASE_INSTANCE_CLASS=db.t4g.micro \
DESIRED_COUNT=1 \
./deploy/aws/deploy.sh
```

The CloudFormation template generates these runtime values in Secrets Manager:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `THINKER_ENCRYPTION_KEY`

Thinker runs with:

- `PORT=2099`
- `BIND_ADDRESS=0.0.0.0`
- `BETTER_AUTH_URL=https://<PUBLIC_HOSTNAME>` (`http://<load-balancer-dns-name>` with `ALLOW_HTTP=true`)
- `THINKER_RECORDING_STORAGE=s3`
- `THINKER_RECORDING_S3_BUCKET=<generated-private-bucket>`
- `THINKER_RECORDING_S3_REGION=<stack-region>`

The ECS task uses its IAM task role to access only the request-recording object prefix, so no static S3 access keys are stored in the container. The recording bucket is retained when the CloudFormation stack is deleted to avoid accidental recording loss; remove it manually after exporting or deleting its contents.

## Open Thinker

After deployment, the script prints `ServiceUrl`, `LoadBalancerDnsName` and `HealthCheckUrl`.

To fetch them again:

```bash
aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name thinker \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl' || OutputKey=='HealthCheckUrl' || OutputKey=='RecordingBucketName'].[OutputKey,OutputValue]" \
  --output table
```

Open `ServiceUrl` and create the first account. The first account becomes the admin.

To verify the deployment:

```bash
HEALTH_URL="$(aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name thinker \
  --query "Stacks[0].Outputs[?OutputKey=='HealthCheckUrl'].OutputValue" \
  --output text)"

curl -sSf "$HEALTH_URL"
```

## Tearing it down

```bash
aws cloudformation delete-stack --region us-east-1 --stack-name thinker
aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name thinker
```

If you deployed with `DATABASE_DELETION_PROTECTION=true`, redeploy with `DATABASE_DELETION_PROTECTION=false` before deleting the stack.

## Without the CLI

Thinker publishes no hosted copy of the template. To deploy from the browser,
open AWS CloudFormation → **Create stack** → **Upload a template file**, choose
`deploy/aws/thinker.yaml` from a checkout of the repository, and fill in the
same parameters `deploy.sh` passes.
