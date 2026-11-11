#!/usr/bin/env bash
# Build the web image from this checkout and deploy ReadAloud to the local kind cluster.
#   deploy/kind/deploy.sh
# Terraform owns the cluster (terraform/cluster) and everything in it (terraform/app).
# The first run creates the cluster; Docker Compose is stopped first because the cluster
# takes over its ports (4179, 3900). Compose volumes are kept and mounted into the cluster.
# Settings come from the root .env, mapped the same way compose.yaml maps them.
# With READALOUD_PUBLIC_URL set, Terraform has Tailscale serve the app there, and the
# deploy fails unless that address ends up serving the new build.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

# Sessions started before the user joined the docker group lack it; newgrp adds it.
if ! docker info >/dev/null 2>&1; then
  exec newgrp docker <<<"exec $(printf '%q ' "$0" "$@")"
fi

cluster=readaloud
node=$cluster-control-plane
step() { echo "==> $*"; }
tf() { deploy/kind/terraform.sh "$@"; }

[ -f .env ] || { echo "Missing $root/.env (see README: Run VoiceStudio and ReadAloud)" >&2; exit 1; }
set -a; . ./.env; set +a
: "${VOICESTUDIO_API_KEY:?set VOICESTUDIO_API_KEY in .env}"

tag=$(git rev-parse --short HEAD)
[ -z "$(git status --porcelain)" ] || tag="$tag-dirty-$(date +%s)"
web_image="readaloud-web:$tag"
voicestudio_image="ghcr.io/debpalash/voicestudio:${VOICESTUDIO_TAG:-stable}"

step "Building $web_image"
# compose.yaml owns the build arguments (which providers are bundled).
docker compose build web
docker tag readaloud-web:latest "$web_image"

if ! kind get clusters 2>/dev/null | grep -qx "$cluster"; then
  if [ -n "$(docker compose ps -q 2>/dev/null)" ]; then
    step "Stopping Docker Compose (the cluster takes over ports 4179 and 3900; volumes are kept)"
    docker compose down
  fi
  for volume in readaloud_library-data readaloud_preparation-data voicestudio-data; do
    docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null
  done
  step "Creating kind cluster $cluster"
  # A cluster deleted outside Terraform leaves its entry behind, which fails the refresh.
  tf cluster state rm kind_cluster.readaloud >/dev/null 2>&1 || true
  # kind makes the new cluster the current context; keep whichever one was current (other clusters live here too).
  previous=$(kubectl config current-context 2>/dev/null || true)
  tf cluster apply -input=false -auto-approve
  [ -z "$previous" ] || kubectl config use-context "$previous" >/dev/null
  # Come back with Docker after a reboot, as the Compose services did.
  docker update --restart unless-stopped "$node" >/dev/null
else
  if ! tf cluster state show kind_cluster.readaloud >/dev/null 2>&1; then
    echo "The existing $cluster cluster is not recorded in Terraform state (or its state cannot be read)." >&2
    echo "See README: local kind cluster cutover. Do not apply over the existing Kubernetes objects." >&2
    exit 1
  fi
  # kind cannot change a running cluster, so applying a change replaces it. Leave that to a person.
  status=0
  tf cluster plan -input=false -detailed-exitcode >/dev/null || status=$?
  case $status in
    0) ;;
    2) echo "warning: deploy/kind/terraform/cluster differs from the running cluster; applying it recreates the cluster." >&2
       echo "         Review and apply by hand: deploy/kind/terraform.sh cluster apply" >&2 ;;
    *) exit "$status" ;;
  esac
fi

step "Loading images into the cluster"
# kind stages images as tar files; /tmp is too small for VoiceStudio's 17 GB image.
export TMPDIR="${XDG_CACHE_HOME:-$HOME/.cache}/readaloud-kind"
mkdir -p "$TMPDIR"
if ! docker exec "$node" crictl inspecti "$voicestudio_image" >/dev/null 2>&1; then
  docker image inspect "$voicestudio_image" >/dev/null 2>&1 || docker pull "$voicestudio_image"
  kind load docker-image --name "$cluster" "$voicestudio_image"
fi
kind load docker-image --name "$cluster" "$web_image"


step "Deploying"
export TF_VAR_web_image=$web_image
# Waits for every Deployment to roll out.
tf app apply -input=false -auto-approve

# Keep only the web image that is running; VoiceStudio's 17 GB image stays.
for image in $(docker exec "$node" crictl images -o json | python3 -c '
import json, sys
for image in json.load(sys.stdin)["images"]:
    for name in image.get("repoTags", []):
        if name.startswith("docker.io/library/readaloud-web:"): print(name)'); do
  [ "$image" = "docker.io/library/$web_image" ] || docker exec "$node" crictl rmi "$image" >/dev/null 2>&1 || true
done
docker image ls --format '{{.Repository}}:{{.Tag}}' readaloud-web | grep -vxE "readaloud-web:(latest|$tag)" | xargs -r docker rmi >/dev/null 2>&1 || true

# The iOS app loads the web app from READALOUD_PUBLIC_URL, so that address must now
# serve the build that was just deployed. Traefik can take a moment to see the new pod.
entry_script() { curl -fsS --max-time 10 "$1" 2>/dev/null | grep -o 'assets/index-[^"]*\.js' | head -1 || true; }
public=${READALOUD_PUBLIC_URL:+${READALOUD_PUBLIC_URL%/}}
if [ -n "$public" ]; then
  step "Checking $public"
  deployed="" served=""
  for _ in $(seq 30); do
    deployed=$(entry_script http://127.0.0.1:4179/)
    served=$(entry_script "$public/")
    [ -n "$deployed" ] && [ "$deployed" = "$served" ] && break
    sleep 2
  done
  if [ -z "$deployed" ] || [ "$deployed" != "$served" ]; then
    echo "$public does not serve the deployed build (local: ${deployed:-nothing}, public: ${served:-nothing})." >&2
    echo "Check: tailscale serve status; deploy/kind/terraform.sh app plan" >&2
    exit 1
  fi
fi

step "Deployed $web_image: http://127.0.0.1:4179${public:+ ($public)}"
