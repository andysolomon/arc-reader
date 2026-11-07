#!/usr/bin/env bash
# Build the web image from this checkout, push it to ECR and deploy it to the AWS host.
#   deploy/aws/deploy.sh
# Create the host first: deploy/aws/terraform.sh infra apply (see README.md).
# Settings come from the root .env, as for the kind cluster.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
[ -f .env ] || { echo "Missing $root/.env (see README)" >&2; exit 1; }
command -v aws >/dev/null || { echo "aws is not on the PATH" >&2; exit 1; }
aws sts get-caller-identity >/dev/null

# Sessions started before the user joined the docker group lack it; newgrp adds it.
if ! docker info >/dev/null 2>&1; then
  exec newgrp docker <<<"exec $(printf '%q ' "$0" "$@")"
fi

step() { echo "==> $*"; }
tf() { deploy/aws/terraform.sh "$@"; }

repository=$(tf infra output -raw repository_url 2>/dev/null) || {
  echo "No AWS host yet. Create it: deploy/aws/terraform.sh infra apply -var tailscale_auth_key=tskey-auth-…" >&2
  exit 1
}
region=$(tf infra output -raw region)
url=$(tf infra output -raw url)

tag="$(git rev-parse --short HEAD)-$(date +%s%N)"
[ -z "$(git status --porcelain)" ] || tag="$tag-dirty"
image="$repository:$tag"

step "Building $image"
# compose.yaml owns the build arguments (which providers are bundled).
docker compose build web
docker tag readaloud-web:latest "$image"

step "Pushing to ECR"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "${repository%%/*}" >/dev/null
docker push "$image"

step "Deploying"
# Waits for every Deployment to roll out.
TF_VAR_web_image=$image tf app apply -input=false -auto-approve
docker rmi "$image" >/dev/null 2>&1 || true

step "Deployed $image: $url"
