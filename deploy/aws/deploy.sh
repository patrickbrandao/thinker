#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

STACK_NAME="${STACK_NAME:-thinker}"
SERVICE_NAME="${SERVICE_NAME:-thinker}"
IMAGE_URL="${IMAGE_URL:-docker.io/tmsoftbrasil/thinker:0.1}"
DESIRED_COUNT="${DESIRED_COUNT:-1}"
DATABASE_INSTANCE_CLASS="${DATABASE_INSTANCE_CLASS:-db.t4g.micro}"
DATABASE_DELETION_PROTECTION="${DATABASE_DELETION_PROTECTION:-false}"
TEMPLATE_FILE="${TEMPLATE_FILE:-$SCRIPT_DIR/thinker.yaml}"
CERTIFICATE_ARN="${CERTIFICATE_ARN:-}"
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-}"
ALLOW_HTTP="${ALLOW_HTTP:-false}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

if [[ -z "$REGION" ]]; then
  REGION="$(aws configure get region 2>/dev/null || true)"
fi

if [[ -z "$REGION" ]]; then
  echo "Set AWS_REGION or configure a default AWS CLI region." >&2
  exit 1
fi

if [[ ! "$DESIRED_COUNT" =~ ^[0-9]+$ ]]; then
  echo "DESIRED_COUNT must be an integer from 1 to 10." >&2
  exit 1
fi

desired_count_number=$((10#$DESIRED_COUNT))
if ((desired_count_number < 1 || desired_count_number > 10)); then
  echo "DESIRED_COUNT must be an integer from 1 to 10." >&2
  exit 1
fi

# Sign-in cookies and API keys must not cross the internet in plain text:
# HTTPS needs a certificate and its hostname; plain HTTP is an explicit opt-in.
if [[ -n "$CERTIFICATE_ARN" && -z "$PUBLIC_HOSTNAME" ]] || [[ -z "$CERTIFICATE_ARN" && -n "$PUBLIC_HOSTNAME" ]]; then
  echo "Set both CERTIFICATE_ARN and PUBLIC_HOSTNAME." >&2
  exit 1
fi
if [[ -z "$CERTIFICATE_ARN" && "$ALLOW_HTTP" != "true" ]]; then
  echo "Set CERTIFICATE_ARN and PUBLIC_HOSTNAME to serve HTTPS, or ALLOW_HTTP=true for a plain-HTTP evaluation stack." >&2
  exit 1
fi

aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE_FILE" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    ServiceName="$SERVICE_NAME" \
    ImageUrl="$IMAGE_URL" \
    DesiredCount="$desired_count_number" \
    DatabaseInstanceClass="$DATABASE_INSTANCE_CLASS" \
    DatabaseDeletionProtection="$DATABASE_DELETION_PROTECTION" \
    AcmCertificateArn="$CERTIFICATE_ARN" \
    PublicHostname="$PUBLIC_HOSTNAME"

aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl' || OutputKey=='LoadBalancerDnsName' || OutputKey=='HealthCheckUrl' || OutputKey=='RecordingBucketName'].[OutputKey,OutputValue]" \
  --output table
