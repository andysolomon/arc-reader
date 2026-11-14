# Source from a deploy script: loads the root .env and exports it as TF_VAR_* for
# shared/env.tf. Unset entries keep the readaloud module's defaults.
[ -f .env ] || { echo "Missing $PWD/.env (see README: Run VoiceStudio and ReadAloud)" >&2; exit 1; }
set -a; . ./.env; set +a
for name in VOICESTUDIO_API_KEY VOICESTUDIO_SECONDARY_API_KEY OPENAI_API_KEY FISH_API_KEY LLM_API_KEY TYPESAFE_API_KEY GEMINI_API_KEY READALOUD_ACCESS_TOKEN \
  VOICESTUDIO_NAME VOICESTUDIO_SECONDARY_NAME LLM_URL PREPARATION_YIELD_MS VOICESTUDIO_ASR_MODEL; do
  [ -z "${!name:-}" ] || export "TF_VAR_${name,,}=${!name}"
done
# .env names these differently.
[ -z "${VOICESTUDIO_REMOTE_URL:-}" ] || export TF_VAR_voicestudio_remote_url=$VOICESTUDIO_REMOTE_URL
[ -z "${VOICESTUDIO_SECONDARY_REMOTE_URL:-}" ] || export TF_VAR_voicestudio_secondary_remote_url=$VOICESTUDIO_SECONDARY_REMOTE_URL
# The kind deployment serves the app at this address (deploy/kind/terraform/app/public-url.tf).
[ -z "${READALOUD_PUBLIC_URL:-}" ] || export TF_VAR_public_url=$READALOUD_PUBLIC_URL
# ...and opens it to the internet through Tailscale Funnel on this port, behind READALOUD_ACCESS_TOKEN.
[ -z "${READALOUD_FUNNEL_PORT:-}" ] || export TF_VAR_funnel_port=$READALOUD_FUNNEL_PORT
