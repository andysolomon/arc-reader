#!/usr/bin/env bash
# Run Terraform for one stage of the kind deployment, with the shared state and the root .env.
#   deploy/kind/terraform.sh cluster plan
#   deploy/kind/terraform.sh app plan     # web_image defaults to the image running now
# deploy.sh uses it too. State and providers live outside the repository, so every
# checkout manages the same cluster.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

# The kind provider talks to Docker; see deploy.sh.
if ! docker info >/dev/null 2>&1; then
  exec newgrp docker <<<"exec $(printf '%q ' "$0" "$@")"
fi

stage=${1:-}
case $stage in
  cluster | app) shift ;;
  *) echo "usage: $0 cluster|app <terraform arguments>" >&2; exit 2 ;;
esac
command -v terraform >/dev/null || { echo "terraform is not on the PATH (mise use -g terraform)" >&2; exit 1; }

state=${XDG_STATE_HOME:-$HOME/.local/state}/readaloud/terraform
export TF_DATA_DIR=${XDG_CACHE_HOME:-$HOME/.cache}/readaloud-kind/terraform/$stage
mkdir -p "$state" "$TF_DATA_DIR"
chmod 700 "$state" # the app state holds the .env secrets
terraform -chdir="deploy/kind/terraform/$stage" init -input=false -backend-config="path=$state/$stage.tfstate" >/dev/null

if [ "$stage" = app ]; then
  . deploy/terraform/shared/env.sh
  [ -z "${VOICESTUDIO_TAG:-}" ] || export TF_VAR_voicestudio_image=ghcr.io/debpalash/voicestudio:$VOICESTUDIO_TAG
  if [ -z "${TF_VAR_web_image:-}" ]; then
    running=$(kubectl --context kind-readaloud -n readaloud get deployment web \
      -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
    [ -z "$running" ] || export TF_VAR_web_image=$running
  fi
fi

exec terraform -chdir="deploy/kind/terraform/$stage" "$@"
