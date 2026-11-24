#!/bin/sh
# Run by `pnpm install`. Links the main checkout's versioned hooks into the shared hooks folder,
# which every worktree uses, and leaves the machine's own hooks there (post-commit, post-merge)
# alone. Linking the main checkout's copy keeps the hooks working after a worktree is removed.
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
src="$(dirname "$common")/scripts/git-hooks"
[ -d "$src" ] || exit 0
for hook in "$src"/*; do ln -sf "$hook" "$common/hooks/$(basename "$hook")"; done
