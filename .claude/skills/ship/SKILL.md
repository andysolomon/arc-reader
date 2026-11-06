---
name: ship
description: Commit the current worktree branch, merge it into main in the main checkout, and deploy the ReadAloud Docker app (ts.net:8449). Use when the user asks to "commit, merge and deploy", "ship it", "merge to main", or "update local main" for ReadAloud work.
---

# Ship: commit, merge and deploy

The user runs only the Docker Compose app at https://omarchy.tail1b9428.ts.net:8449, which is built from `main` in the main checkout. Work happens on a `t3/*` branch in a worktree. Shipping means getting that branch onto local `main` and confirming the container rebuilt.

Find the main checkout once and reuse it:

```sh
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
BRANCH=$(git branch --show-current)
```

## 1. Commit

- Run `git status --short`. Stage the task's changes and commit with a message that says what changed and why.
- Never add `Co-Authored-By` or "Generated with" trailers. Commits are authored solely by Andrew Solomon.
- If there is nothing to commit and `git log --oneline main..HEAD` is empty, the work is already shipped. Say so, then skip to step 5 to confirm the deploy.

## 2. Bring main into the branch

The repo sets `merge.ff=only`, so a plain `git merge` of diverged branches fails. Always pass `--no-ff` explicitly.

```sh
git -C "$MAIN" fetch origin
git -C "$MAIN" merge --ff-only origin/main   # only if origin/main has commits local main lacks; stop and ask if it refuses
git merge-base --is-ancestor main HEAD || git merge --no-ff --no-edit main
```

Resolve conflicts if any, keeping both sides' intent.

## 3. Verify before merging

From `apps/web`:

```sh
pnpm typecheck
pnpm vitest run
```

Then run the Playwright specs that cover the changed area, for example `pnpm playwright test tests/e2e/library.spec.ts`.

- E2E ports 4173, 3998 and 3999 are shared across worktrees. Check `ss -ltnp | grep -E ':(4173|3998|3999) '` is empty first; if another session holds them, wait or ask.
- The keyboard spec's "position persists" test can flake in a full parallel run. Rerun it alone before calling it a regression.
- Do not merge with failing checks. Report the failure output instead.

## 4. Merge into main

```sh
test -z "$(git -C "$MAIN" status --short)" && [ "$(git -C "$MAIN" branch --show-current)" = main ]
git -C "$MAIN" merge --no-ff -m "Merge <one-line summary of the change>" "$BRANCH"
```

If the main checkout is dirty or not on `main`, stop and tell the user rather than stashing or switching. The stash stack is shared with other sessions.

The `post-merge` hook in the shared `.git/hooks` starts `docker compose up -d --build` in the background and logs to `.git/docker-rebuild.log`.

## 5. Confirm the deploy

```sh
.claude/skills/ship/scripts/wait-deploy.sh "$MAIN"
```

It waits for the rebuild of main's current commit, then prints the result, when the web container started, the served bundle, and the Tailscale URL status. A non-zero exit means the deploy did not complete.

If the log says `skipped` or the build failed, rebuild by hand from the main checkout. The session may lack the docker group, so go through `newgrp`:

```sh
cd "$MAIN" && echo "docker compose up -d --build" | newgrp docker
```

## 6. Report

- Give the merge commit and the test results.
- Confirm the deploy is live at https://omarchy.tail1b9428.ts.net:8449.
- Tell the user to reload open app tabs. The service worker keeps serving the old bundle until a full page load.
- Do not push to `origin` unless asked. Mention how many commits local `main` is ahead of `origin/main`.
