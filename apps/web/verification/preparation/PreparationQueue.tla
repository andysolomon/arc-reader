--------------------------- MODULE PreparationQueue ---------------------------
(***************************************************************************)
(* This device's queue of readings that the web server prepares            *)
(* (VoiceStudio and Phonon voices), as apps/web/src/state/preparation.ts   *)
(* runs it: drain() hands out the PREPARATION_QUEUE_LIMIT places, run()    *)
(* sends a reading to the server and then saves its passages here, and a   *)
(* reload keeps only what zustand persisted and what audioCache holds.     *)
(* Line numbers are for apps/web/src/state/preparation.ts unless named.    *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    NumJobs,          \* readings in the queue, in list order
    NumPassages,      \* passages in each reading
    QueueLimit,       \* PREPARATION_QUEUE_LIMIT (20 in the code)
    SaveConcurrency,  \* SAVE_CONCURRENCY (2 in the code)
    MaxReloads,       \* page reloads in one behavior
    UnloadFailsClips, \* a reload fails the clip downloads in flight, and the old page persists what run() does about it
    \* Each switch below puts one fixed bug back when TRUE. All are FALSE for the current code.
    SavingHoldsSlot,       \* 179a031^ :209 drain counted every active entry, so a saving reading kept its place
    ClipWaitsForever,      \* 179a031^ engine/preparation.ts:333 the clip fetch in preparedAudio had no time limit
    RestoreSavingAsQueued, \* 86d7c09^ :180 merge put a saving reading back to "queued"
    WalkSavedPassages      \* 86d7c09^ :314 run() asked for every passage, saved on this device or not

ASSUME QueueLimit >= 1 /\ SaveConcurrency >= 1

Jobs == 1..NumJobs
Passages == 1..NumPassages

VARIABLES
    \* Kept across a reload.
    status,     \* job.status as persisted: "queued" ("preparing" is read as "queued" everywhere), "saving", "ready"
    stored,     \* the reading's passages in audioCache (IndexedDB)
    server,     \* the server's job for the reading: "none", "queued" (waiting or being made), "made"
    \* Lost on a reload.
    active,     \* the reading's entry in `active` (:59): "none", "slot", or "saving" (entry.saving)
    pc,         \* where run() is: "idle", "start", "sending", "turn" (saveTurn), "walking" (a clip in flight)
    todo,       \* passages run() has still to ask for (`missing`, :299)
    savingNow,  \* savingNow (:60), readings holding a save turn
    reloads,
    \* History for the properties.
    rewalked,   \* a passage already in audioCache was asked for again
    restored    \* the reading was "saving" when the page reloaded, and the run the reload started has not ended

vars == <<status, stored, server, active, pc, todo, savingNow, reloads, rewalked, restored>>

Min(S) == CHOOSE p \in S : \A q \in S : p <= q

(***************************************************************************)
(* drain(), :215-243. It counts the places taken, then walks the jobs in   *)
(* list order: a restored "saving" reading starts without a place, and a   *)
(* "queued" one starts if a place is free. It returns the new entries and  *)
(* the new run positions, from the entries `act` and statuses `st` it     *)
(* reads and the positions `pcs` the caller has already set.               *)
(***************************************************************************)
HoldsPlace(a) == a = "slot" \/ (SavingHoldsSlot /\ a = "saving")
Taken(act) == Cardinality({k \in Jobs : HoldsPlace(act[k])})
Waits(act, st, k) == act[k] = "none" /\ st[k] = "queued"
Ahead(act, st, j) == Cardinality({k \in Jobs : k < j /\ Waits(act, st, k)})
Entry(act, st, j) ==
    CASE act[j] # "none" -> act[j]
      [] st[j] = "saving" -> "saving"
      [] Waits(act, st, j) /\ Taken(act) + Ahead(act, st, j) < QueueLimit -> "slot"
      [] OTHER -> "none"
Drain(act, st, pcs) ==
    LET next == [j \in Jobs |-> Entry(act, st, j)]
    IN  <<next, [j \in Jobs |-> IF act[j] = "none" /\ next[j] # "none" THEN "start" ELSE pcs[j]]>>

\* The status, entries and positions after `st`, `act` and `pcs`, then drain().
Settle(st, act, pcs) ==
    LET d == Drain(act, st, pcs)
    IN  /\ status' = st
        /\ active' = d[1]
        /\ pc' = d[2]

\* run() returns and drain()'s .finally (:237-241, :228) deletes the entry and drains again.
EndRun(j, st) ==
    /\ Settle([status EXCEPT ![j] = st], [active EXCEPT ![j] = "none"], [pc EXCEPT ![j] = "idle"])
    /\ todo' = [todo EXCEPT ![j] = {}]
    /\ restored' = [restored EXCEPT ![j] = FALSE]

\* :327-331 the server has made it: the reading gives up its place, drain() runs, the row says saving.
ToSaving(j) ==
    Settle([status EXCEPT ![j] = "saving"], [active EXCEPT ![j] = "saving"], [pc EXCEPT ![j] = "turn"])

(***************************************************************************)
(* enqueue() (:125-138) has put every reading in the queue and drained.    *)
(***************************************************************************)
Init ==
    LET d == Drain([j \in Jobs |-> "none"], [j \in Jobs |-> "queued"], [j \in Jobs |-> "idle"])
    IN  /\ status = [j \in Jobs |-> "queued"]
        /\ stored = [j \in Jobs |-> {}]
        /\ server = [j \in Jobs |-> "none"]
        /\ active = d[1]
        /\ pc = d[2]
        /\ todo = [j \in Jobs |-> {}]
        /\ savingNow = 0
        /\ reloads = 0
        /\ rewalked = FALSE
        /\ restored = [j \in Jobs |-> FALSE]

(***************************************************************************)
(* run() reads audioCache (:296-299), then finishes at once (:301-304),    *)
(* goes straight to saving when it was restored as "saving" (:307), or     *)
(* sends the reading to the server (:309). A reading the server already    *)
(* made is reused when the last catalogue lists it with every passage      *)
(* (engine/preparation.ts:199); otherwise the server, which keeps one job  *)
(* per running reading only (vite.prepare.ts:279), queues it again.        *)
(***************************************************************************)
CheckCache(j) ==
    /\ pc[j] = "start"
    /\ LET missing == Passages \ stored[j]
           walk == IF WalkSavedPassages THEN Passages ELSE missing
       IN  \/ /\ walk = {}
              /\ EndRun(j, "ready")
              /\ UNCHANGED <<stored, server, savingNow, reloads, rewalked>>
           \/ /\ walk # {}
              /\ status[j] = "saving"
              /\ todo' = [todo EXCEPT ![j] = walk]
              /\ pc' = [pc EXCEPT ![j] = "turn"]
              /\ UNCHANGED <<status, stored, server, active, savingNow, reloads, rewalked, restored>>
           \/ /\ walk # {}
              /\ status[j] # "saving"
              /\ missing = {}
              \* Only with WalkSavedPassages: prepareInBackground finds every passage cached and returns.
              /\ todo' = [todo EXCEPT ![j] = walk]
              /\ ToSaving(j)
              /\ UNCHANGED <<stored, server, savingNow, reloads, rewalked, restored>>
           \/ /\ missing # {}
              /\ status[j] # "saving"
              /\ todo' = [todo EXCEPT ![j] = walk]
              /\ pc' = [pc EXCEPT ![j] = "sending"]
              /\ \E s \in IF server[j] = "made" THEN {"made", "queued"} ELSE {"queued"} :
                    server' = [server EXCEPT ![j] = s]
              /\ UNCHANGED <<status, stored, active, savingNow, reloads, rewalked, restored>>

\* The server's machine makes a reading it holds. It goes on with the page closed.
ServerMakes(j) ==
    /\ server[j] = "queued"
    /\ server' = [server EXCEPT ![j] = "made"]
    /\ UNCHANGED <<status, stored, active, pc, todo, savingNow, reloads, rewalked, restored>>

\* prepareInBackground's poll sees the reading done (engine/preparation.ts:307-311).
ServerAnswers(j) ==
    /\ pc[j] = "sending"
    /\ server[j] = "made"
    /\ ToSaving(j)
    /\ UNCHANGED <<stored, server, todo, savingNow, reloads, rewalked, restored>>

\* saveTurn (:246-263) gives the reading one of the SAVE_CONCURRENCY turns.
TakeTurn(j) ==
    /\ pc[j] = "turn"
    /\ savingNow < SaveConcurrency
    /\ savingNow' = savingNow + 1
    /\ pc' = [pc EXCEPT ![j] = "walking"]
    /\ UNCHANGED <<status, stored, server, active, todo, reloads, rewalked, restored>>

(***************************************************************************)
(* One passage of the save loop (:337-353): synthesize() fetches the       *)
(* server's clip through preparedAudio and audioCache keeps it. After the  *)
(* last one the turn is released (:355) and the reading is ready (:358).   *)
(* Nothing makes a clip arrive: a phone that sleeps can hold it forever.   *)
(***************************************************************************)
ClipArrives(j) ==
    /\ pc[j] = "walking"
    /\ LET p == Min(todo[j])
           left == todo[j] \ {p}
       IN  /\ stored' = [stored EXCEPT ![j] = @ \cup {p}]
           /\ rewalked' = (rewalked \/ p \in stored[j])
           /\ IF left = {}
                 THEN /\ savingNow' = savingNow - 1
                      /\ EndRun(j, "ready")
                 ELSE /\ todo' = [todo EXCEPT ![j] = left]
                      /\ UNCHANGED <<status, active, pc, savingNow, restored>>
    /\ UNCHANGED <<server, reloads>>

(***************************************************************************)
(* The clip has not arrived within CLIP_TIMEOUT_MS (engine/preparation.ts: *)
(* 341). run() releases the turn, treats the timeout as a lost connection  *)
(* (:359-368) and puts the reading back to "queued"; drain() runs again.   *)
(***************************************************************************)
ClipTimesOut(j) ==
    /\ ~ClipWaitsForever
    /\ pc[j] = "walking"
    /\ savingNow' = savingNow - 1
    /\ EndRun(j, "queued")
    /\ UNCHANGED <<stored, server, reloads, rewalked>>

(***************************************************************************)
(* The page reloads. merge (:178-183) restores the persisted statuses, and *)
(* onRehydrateStorage (:186) drains. In-memory state is gone; audioCache   *)
(* and the server's jobs stay. With UnloadFailsClips, the browser fails    *)
(* the clip downloads in flight first, and run()'s catch on the old page   *)
(* may persist those readings as "queued" (:360-361) before it unloads.    *)
(***************************************************************************)
Reload ==
    /\ reloads < MaxReloads
    /\ \E failed \in SUBSET {j \in Jobs : UnloadFailsClips /\ pc[j] = "walking"} :
          LET left == [j \in Jobs |-> IF j \in failed THEN "queued" ELSE status[j]]
              st == [j \in Jobs |-> IF left[j] = "saving" /\ RestoreSavingAsQueued THEN "queued" ELSE left[j]]
          IN  Settle(st, [j \in Jobs |-> "none"], [j \in Jobs |-> "idle"])
    /\ todo' = [j \in Jobs |-> {}]
    /\ savingNow' = 0
    /\ reloads' = reloads + 1
    /\ restored' = [j \in Jobs |-> status[j] = "saving"]
    /\ UNCHANGED <<stored, server, rewalked>>

\* Every reading is ready; nothing is left to do.
Done ==
    /\ \A j \in Jobs : status[j] = "ready"
    /\ UNCHANGED vars

Next ==
    \/ \E j \in Jobs :
        \/ CheckCache(j)
        \/ ServerMakes(j)
        \/ ServerAnswers(j)
        \/ TakeTurn(j)
        \/ ClipArrives(j)
        \/ ClipTimesOut(j)
    \/ Reload
    \/ Done

\* run()'s next step for the reading. Each needs its own pc[j], so at most one is enabled at a time,
\* and fairness on the disjunction is fairness on each.
RunStep(j) == CheckCache(j) \/ ServerAnswers(j) \/ TakeTurn(j) \/ ClipTimesOut(j)

\* Timers fire and the server answers. A clip may never arrive, and nobody has to reload.
Fairness == \A j \in Jobs : WF_vars(RunStep(j)) /\ WF_vars(ServerMakes(j))

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
TypeOK ==
    /\ status \in [Jobs -> {"queued", "saving", "ready"}]
    /\ stored \in [Jobs -> SUBSET Passages]
    /\ server \in [Jobs -> {"none", "queued", "made"}]
    /\ active \in [Jobs -> {"none", "slot", "saving"}]
    /\ pc \in [Jobs -> {"idle", "start", "sending", "turn", "walking"}]
    /\ todo \in [Jobs -> SUBSET Passages]
    /\ savingNow \in 0..SaveConcurrency
    /\ savingNow = Cardinality({j \in Jobs : pc[j] = "walking"})

\* A reading that takes one of the PREPARATION_QUEUE_LIMIT places gives it back, even if its save hangs.
PlacesComeBack ==
    \A j \in Jobs : HoldsPlace(active[j]) ~> ~HoldsPlace(active[j])

\* A reading waiting on this device reaches the server, even if no save ever finishes.
QueuedReachServer ==
    \A j \in Jobs : (status[j] = "queued" /\ server[j] = "none") ~> (server[j] # "none")

\* No passage already saved on this device is asked for again.
NoRewalk == ~rewalked

\* A reload does not send a reading the server already made back to the server.
NoResendAfterReload == \A j \in Jobs : restored[j] => pc[j] # "sending"
=============================================================================
