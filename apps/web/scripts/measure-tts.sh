#!/usr/bin/env bash
# Time-to-first-byte and total time for one sentence from a VoiceStudio server.
#   scripts/measure-tts.sh [base=http://127.0.0.1:3900] [engine=kittentts] [voice=expr-voice-2-f]
# Reads the key from VOICESTUDIO_API_KEY or apps/web/.env.local.
set -euo pipefail
BASE="${1:-http://127.0.0.1:3900}"; ENGINE="${2:-kittentts}"; VOICE="${3:-expr-voice-2-f}"
KEY="${VOICESTUDIO_API_KEY:-$(grep -E '^VOICESTUDIO_API_KEY=' "$(dirname "$0")/../.env.local" 2>/dev/null | cut -d= -f2-)}"
TEXT="The quick brown fox jumps over the lazy dog near the quiet river bank at dusk, while the owls begin to call."
printf 'sentence: %s words\n' "$(wc -w <<<"$TEXT")"
for i in 1 2 3; do
  curl -s -o /tmp/measure-tts.mp3 -w "run $i  first byte %{time_starttransfer}s  total %{time_total}s  bytes %{size_download}\n" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"model\":\"$ENGINE\",\"input\":\"$TEXT\",\"voice\":\"$VOICE\",\"response_format\":\"mp3\",\"speed\":1}" \
    "$BASE/v1/audio/speech"
done
file /tmp/measure-tts.mp3 2>/dev/null || true
