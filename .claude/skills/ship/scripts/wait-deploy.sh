#!/bin/sh
# Wait for the post-merge Docker rebuild of main's current commit, then check the live app.
# Usage: wait-deploy.sh <main-checkout> [timeout-seconds]
set -eu
main=${1:?usage: wait-deploy.sh <main-checkout> [timeout-seconds]}
timeout=${2:-600}
sha=$(git -C "$main" rev-parse --short HEAD)
log="$(git -C "$main" rev-parse --path-format=absolute --git-common-dir)/docker-rebuild.log"
end=$(( $(date +%s) + timeout ))

result=""
while [ -z "$result" ]; do
  if [ -f "$log" ]; then
    # The last build of this commit wins; a "skipped" line means the hook had no Docker access.
    result=$(awk -v s="$sha" '
      $2 == "building" && $3 == s { found = 1; res = ""; next }
      $2 == "skipped" && index($3, s) == 1 { found = 0; res = "skipped" }
      found && $2 == "exit" { res = "exit " $3; found = 0 }
      END { print res }' "$log")
  fi
  if [ -z "$result" ]; then
    [ "$(date +%s)" -lt "$end" ] || { echo "timed out after ${timeout}s waiting for the rebuild of $sha (log: $log)"; exit 1; }
    sleep 3
  fi
done
echo "rebuild of $sha: $result"

inspect='docker inspect -f "{{.State.StartedAt}}" readaloud-web-1'
started=$({ sh -c "$inspect" 2>/dev/null || echo "$inspect" | newgrp docker 2>/dev/null; } | grep -m1 . || echo unknown)
echo "web container started: $started"
echo "served bundle: $(curl -s http://127.0.0.1:4179/ | grep -o 'assets/index-[^"]*\.js' | head -1)"
echo "https://omarchy.tail1b9428.ts.net:8449 -> HTTP $(curl -s -o /dev/null -w '%{http_code}' https://omarchy.tail1b9428.ts.net:8449/)"
echo "local main vs origin/main: $(git -C "$main" rev-list --left-right --count origin/main...main | awk '{print $2 " ahead, " $1 " behind"}')"
[ "$result" = "exit 0" ]
