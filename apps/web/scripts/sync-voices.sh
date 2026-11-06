#!/usr/bin/env bash
# Copy every VoiceStudio voice from the Mac mini (the source of truth) into the
# local Compose VoiceStudio, keeping profile ids and reference audio byte-identical
# so the preparation scheduler accepts Omarchy for the same voices.
#   scripts/sync-voices.sh [ssh-host=mini] [container=readaloud-voicestudio-1]
# Persona import can't be used: it always assigns a new id. Run it after creating
# or editing a voice on the Mac. Voices that exist only here are listed, never deleted.
set -euo pipefail
HOST="${1:-mini}"; CONTAINER="${2:-readaloud-voicestudio-1}"
SOURCE='Library/Application Support/OmniVoice'
TARGET=/app/omnivoice_data

# Audio first, so no row ever points at a missing file. Same-named files are replaced.
ssh -n "$HOST" "cd \"\$HOME/$SOURCE/voices\" && COPYFILE_DISABLE=1 tar --no-xattrs -cf - ." | docker exec -i "$CONTAINER" tar xf - --no-same-owner --no-overwrite-dir -C "$TARGET/voices"

ssh -n "$HOST" "sqlite3 -json \"\$HOME/$SOURCE/omnivoice.db\" 'select * from voice_profiles'" \
  | docker exec -i "$CONTAINER" python -c '
import json, sqlite3, sys
rows = json.load(sys.stdin)
db = sqlite3.connect(sys.argv[1])
columns = [c[1] for c in db.execute("pragma table_info(voice_profiles)")]
missing = sorted(set(rows[0]) - set(columns)) if rows else []
if missing: sys.exit("Schemas differ (Omarchy lacks %s); run the same VoiceStudio version on both." % missing)
before = {r[0]: r for r in db.execute("select * from voice_profiles")}
db.backup(sqlite3.connect(sys.argv[1] + ".before-voice-sync"))
insert = "insert or replace into voice_profiles (%s) values (%s)" % (",".join(columns), ",".join("?" * len(columns)))
with db:
  for row in rows:
    values = [row.get(c) for c in columns]
    db.execute(insert, values)
    state = "unchanged" if before.get(row["id"]) == tuple(values) else "updated" if row["id"] in before else "added"
    print("%-9s %s  %s" % (state, row["id"], row["name"]))
for id in sorted(set(before) - {r["id"] for r in rows}):
  print("only here %s  %s  (kept)" % (id, before[id][1]))
' "$TARGET/omnivoice.db"
