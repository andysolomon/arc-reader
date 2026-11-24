---
name: verify-preparation-queue
description: Model-check the client audio preparation queue (apps/web/src/state/preparation.ts, apps/web/src/engine/preparation.ts, apps/web/src/lib/sharedPreparations.ts) with TLA+. Use before merging any change to how readings are queued, sent to the server, saved on the device, restored after a reload, or shown and cleared as server rows, or when the "model" CI job fails.
---

# Verify the preparation queue

The queue has lost or leaked state on reload, sleep and sync again and again. A TLA+ model in `apps/web/verification/preparation/` replays those past bugs. It checks every order of steps for a few readings, with saves that can hang, clips that time out, page reloads, and syncs.

## Run it

```sh
pnpm verify:preparation
```

It needs Java 11 or later (`JAVA`, or `java` on `PATH`). On a machine without Java, run `mise exec java@temurin-21 -- pnpm verify:preparation`. The first run downloads the pinned `tla2tools.jar` 1.7.4 into `~/.cache/readaloud` and checks its SHA-256. A full run takes about a minute. Pass config names to run only some, for example `pnpm verify:preparation PreparationQueue.cfg`.

Each line ends in `ok` or `FAIL`. The run passes when each config gives its expected result:

| Config | Expected | Why |
| --- | --- | --- |
| `PreparationQueue.cfg` | every property holds | the current code |
| `PreparationQueue.179a031.cfg` | `PlacesComeBack` fails | replays the bug 179a031 fixed |
| `PreparationQueue.86d7c09-resend.cfg` | `NoResendAfterReload` fails | replays the merge bug 86d7c09 fixed |
| `PreparationQueue.86d7c09-rewalk.cfg` | `NoRewalk` fails | replays the save-loop bug 86d7c09 fixed |
| `PreparationQueue.starvation.cfg` | `QueuedReachServer` fails | a finding on the current code |
| `PreparationQueue.reload-mid-clip.cfg` | `NoResendAfterReload` fails | a finding on the current code |
| `SharedPreparations.cfg` | every property holds | the current code |
| `SharedPreparations.847a4bc.cfg` | `ClearedStayCleared` fails | replays the bug 847a4bc fixed |
| `SharedPreparations.text-changes.cfg` | `ClearedStayCleared` fails | a finding on the current code |

## What it checks

| Property | The promise | The harm when it breaks |
| --- | --- | --- |
| `PlacesComeBack` | A reading that takes one of the `PREPARATION_QUEUE_LIMIT` places gives it back, even if its save hangs. | Hung saves hold every place and the server sits idle with readings queued (179a031). |
| `NoResendAfterReload` | A reload does not send a reading the server already made back to the server. | Every reading being saved goes back to the server's queue after a reload (86d7c09). |
| `NoRewalk` | No passage already saved on this device is asked for again. | A reload or retry walks every passage again (86d7c09). |
| `ClearedStayCleared` | A reading cleared from the queue does not come back, across syncs and reloads. | Cleared server rows reappear after a reload (847a4bc). |
| `QueuedReachServer` | A reading waiting on this device reaches the server, even if no save ever finishes. | Later readings are never sent. |

Each switch in `PreparationQueue.tla` and `SharedPreparations.tla` (`SavingHoldsSlot`, `ClipWaitsForever`, `RestoreSavingAsQueued`, `WalkSavedPassages`, `HiddenInMemory`) puts one fixed bug back. Its comment names the pre-fix line, for example `git show 179a031^:apps/web/src/state/preparation.ts`.

## Does your change touch it?

Coverage, last confirmed against the code at commit `a8d39c6d7c0977bebc4acc766942388b9c9344d0`:

| Code | Model |
| --- | --- |
| `state/preparation.ts` `drain()` and the `active` map | `Drain`, `Entry`, `HoldsPlace` |
| `state/preparation.ts` `run()`: the cache check, `serverDone`, `prepareInBackground`, `entry.saving` | `CheckCache`, `ServerAnswers`, `ToSaving` |
| `state/preparation.ts` `saveTurn()`, `SAVE_CONCURRENCY`, the save loop over `missing` | `TakeTurn`, `ClipArrives`, `EndRun` |
| `state/preparation.ts` `run()`'s catch for transient errors | `ClipTimesOut` |
| `state/preparation.ts` persist `partialize`, `merge`, `onRehydrateStorage` | `Reload` in both specs |
| `state/preparation.ts` `refreshShared`, `dismissFinished`, the linger timer, `hiddenShared` | `Fetch`, `Apply`, `Dismiss`, `Linger` |
| `engine/preparation.ts` `preparedAudio` (`CLIP_TIMEOUT_MS`), `submit()` reuse of a finished job | `ClipTimesOut`, `CheckCache` |
| `lib/sharedPreparations.ts` `sharedPreparationJobs` (one reading per document and voice) | `Picked` |
| `vite.prepare.ts` `submit()` dedupe of running jobs, `restore()` retention by file age | `CheckCache`, `Expire` |

If your diff touches a row, run the check. Then compare the changed code with the model's action. Every action's comment names the lines it stands for.

## Read a result

Read every result with the pstack `/statechart` skill. Give it the spec and the config, and give it the view module beside the spec (`PreparationQueue.view.mjs` or `SharedPreparations.view.mjs`) as the view. It tells a broken property as the shortest path of steps in the reader's words. Set `TLA2TOOLS` to the cached jar so it does not install its own.

- **A past-bug config passes.** The model no longer sees that bug. If your change was meant to make the bug impossible some other way, move the switch so it still reverts the new code. Never delete a past-bug config.
- **`PreparationQueue.cfg` or `SharedPreparations.cfg` fails.** Replay the path against the real code before you trust it. Use a Vitest case on the real store and `fake-indexeddb`, as in `apps/web/src/state/preparation.shared.test.ts`, one call per step. If the real code does the same, your change has a bug. If it does not, the model is wrong. Fix the action whose comment no longer matches the code.
- **A finding config passes.** Your change fixed the finding. Do what the `FAIL` line says, which is to move the property into the current config.

## Update the model for an intended change

1. Change the action that stands for the code you changed, and its line references.
2. Run `pnpm verify:preparation`. Every row of the table above must match.
3. Replay any new failure path against the real code, as above.
4. Move the commit in the coverage record forward only after you confirm that every row still describes the code at the new commit.

## Bounds and what it leaves out

The queue model has 3 readings of 2 passages, 1 place (`PREPARATION_QUEUE_LIMIT` is 20), 1 save turn (`SAVE_CONCURRENCY` is 2) and 2 reloads. The shared model has 2 readings of one document in one voice and 2 reloads. A pass covers these bounds only.

Left out: cancel, prioritize, non-transient errors, cloud voices that this device prepares itself, Patois, code and image descriptions, the server's machine scheduling, and the wake-up order inside `saveTurn`. Every reading is server-prepared. The server's own queue is unbounded.

Two assumptions keep the current configs passing, and each has a finding config that turns it off. `UnloadFailsClips` is FALSE: a reload changes nothing the old page persists. `TextChanges` is FALSE: the document's text stays the same.

`ClearedStayCleared` holds only because the server drops ended readings oldest first. If a newer reading of the same document leaves the catalogue before an older cleared one, the older one comes back.

## Findings on the current code

- **Starvation** (`PreparationQueue.starvation.cfg`). A reading whose clip times out goes back to "queued" at its old place in the list (`run()`'s catch), and `drain()` hands places out in list order. When every clip times out, two readings can trade the one place forever while a third is never sent. The model needs no timing for this. In the app, it takes more readings timing out than there are places, so it is unlikely but possible on a weak connection.
- **Reload mid-clip** (`PreparationQueue.reload-mid-clip.cfg`). A reload fails the clip download in flight. `run()`'s catch on the old page treats it as a lost connection and persists the reading as "queued" before the page unloads. The reloaded page then sends the reading back to the server, which is the symptom 86d7c09 fixed. Readings are downloading clips for most of the time they are saving, so this is the common case. Replayed in Chromium: the reloaded page restored the reading as "queued" with "Waiting for the speech server to reconnect…" and submitted it a second time.
- **Edit and undo** (`SharedPreparations.text-changes.cfg`). `refreshShared` forgets a cleared reading as soon as `sharedPreparationJobs` stops listing it. Editing the document's text stops the listing. After the edit is undone, the cleared reading's row comes back.
