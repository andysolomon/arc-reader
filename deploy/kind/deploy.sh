#!/usr/bin/env bash
# Build the web image from this checkout and deploy ReadAloud to the local kind cluster.
#   deploy/kind/deploy.sh
# The first run creates the cluster; Docker Compose is stopped first because the cluster
# takes over its ports (4179, 3900). Compose volumes are kept and mounted into the cluster.
# Settings come from the root .env, mapped the same way compose.yaml maps them.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

# Sessions started before the user joined the docker group lack it; newgrp adds it.
if ! docker info >/dev/null 2>&1; then
  exec newgrp docker <<<"exec $(printf '%q ' "$0" "$@")"
fi

cluster=readaloud
node=$cluster-control-plane
k() { kubectl --context "kind-$cluster" -n readaloud "$@"; }
step() { echo "==> $*"; }

[ -f .env ] || { echo "Missing $root/.env (see README: Run VoiceStudio and ReadAloud)" >&2; exit 1; }
set -a; . ./.env; set +a
: "${VOICESTUDIO_API_KEY:?set VOICESTUDIO_API_KEY in .env}"

tag=$(git rev-parse --short HEAD)
[ -z "$(git status --porcelain)" ] || tag="$tag-dirty-$(date +%s)"
web_image="readaloud-web:$tag"
voicestudio_image="ghcr.io/debpalash/voicestudio:${VOICESTUDIO_TAG:-stable}"
# kind load cannot import multi-platform images; the node pulls this one itself.
traefik_image="traefik:v3.7.17"

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
  kind create cluster --config deploy/kind/cluster.yaml --wait 180s
  # Come back with Docker after a reboot, as the Compose services did.
  docker update --restart unless-stopped "$node" >/dev/null
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

step "Applying configuration"
remote=${VOICESTUDIO_REMOTE_URL:-}
kubectl --context "kind-$cluster" create namespace readaloud --dry-run=client -o yaml | kubectl --context "kind-$cluster" apply -f - >/dev/null
config=$(k create configmap readaloud-config --dry-run=client -o yaml \
  --from-literal=VOICESTUDIO_URL="${remote:-http://voicestudio:3900}" \
  --from-literal=VOICESTUDIO_NAME="${VOICESTUDIO_NAME:-VoiceStudio}" \
  --from-literal=VOICESTUDIO_SECONDARY_URL="${VOICESTUDIO_SECONDARY_REMOTE_URL:-${remote:+http://voicestudio:3900}}" \
  --from-literal=VOICESTUDIO_SECONDARY_NAME="${VOICESTUDIO_SECONDARY_NAME:-Omarchy}" \
  --from-literal=LLM_URL="${LLM_URL:-https://opencode.ai/zen/go}" \
  --from-literal=PREPARATION_YIELD_MS="${PREPARATION_YIELD_MS:-}" \
  --from-literal=VOICESTUDIO_ASR_MODEL="${VOICESTUDIO_ASR_MODEL:-deepdml/faster-whisper-large-v3-turbo-ct2}")
secrets=$(k create secret generic readaloud-secrets --dry-run=client -o yaml \
  --from-literal=VOICESTUDIO_API_KEY="$VOICESTUDIO_API_KEY" \
  --from-literal=VOICESTUDIO_SECONDARY_API_KEY="${VOICESTUDIO_SECONDARY_API_KEY:-}" \
  --from-literal=OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  --from-literal=FISH_API_KEY="${FISH_API_KEY:-}" \
  --from-literal=LLM_API_KEY="${LLM_API_KEY:-}")
printf '%s\n' "$config" | k apply -f - >/dev/null
printf '%s\n' "$secrets" | k apply -f - >/dev/null
# Pods only read configuration at start: restart them when theirs changes.
web_config=$(printf '%s%s' "$config" "$secrets" | sha256sum | cut -c1-16)
voicestudio_config=$(printf '%s|%s' "$VOICESTUDIO_API_KEY" "${VOICESTUDIO_ASR_MODEL:-}" | sha256sum | cut -c1-16)

step "Deploying"
sed -e "s|__WEB_IMAGE__|$web_image|" -e "s|__VOICESTUDIO_IMAGE__|$voicestudio_image|" \
  -e "s|__WEB_CONFIG__|$web_config|" -e "s|__VOICESTUDIO_CONFIG__|$voicestudio_config|" deploy/kind/readaloud.yaml | k apply -f -
# After readaloud.yaml: on clusters from before Traefik, the app Services held its NodePorts.
sed -e "s|__TRAEFIK_IMAGE__|$traefik_image|" deploy/kind/traefik.yaml | kubectl --context "kind-$cluster" apply -f -
kubectl --context "kind-$cluster" -n traefik rollout status deployment/traefik --timeout=120s
k rollout status deployment/web --timeout=300s
k rollout status deployment/voicestudio --timeout=900s

# Keep only the web image that is running; VoiceStudio's 17 GB image stays.
for image in $(docker exec "$node" crictl images -o json | python3 -c '
import json, sys
for image in json.load(sys.stdin)["images"]:
    for name in image.get("repoTags", []):
        if name.startswith("docker.io/library/readaloud-web:"): print(name)'); do
  [ "$image" = "docker.io/library/$web_image" ] || docker exec "$node" crictl rmi "$image" >/dev/null 2>&1 || true
done
docker image ls --format '{{.Repository}}:{{.Tag}}' readaloud-web | grep -vxE "readaloud-web:(latest|$tag)" | xargs -r docker rmi >/dev/null 2>&1 || true

step "Deployed $web_image: http://127.0.0.1:4179 (https://omarchy.tail1b9428.ts.net:8449)"
