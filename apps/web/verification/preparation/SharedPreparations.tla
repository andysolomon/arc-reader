-------------------------- MODULE SharedPreparations --------------------------
(***************************************************************************)
(* The queue's rows for readings the server lists (GET /api/preparations), *)
(* as apps/web/src/state/preparation.ts keeps them. refreshShared          *)
(* (:97-124) turns the catalogue into rows through sharedPreparationJobs   *)
(* (apps/web/src/lib/sharedPreparations.ts). dismissFinished (:171-174)    *)
(* and the linger timer (:190-205) clear finished rows, and hiddenShared   *)
(* remembers what was cleared. Every reading here is of one document in    *)
(* one voice, so sharedPreparationJobs lists at most one of them: a        *)
(* running one first, then the newest.                                     *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS
    NumReadings,    \* readings of the document, numbered in the order the server created them
    MaxReloads,     \* page reloads in one behavior
    TextChanges,    \* the document's text can change and change back, so its readings stop and start matching
    HiddenInMemory  \* 847a4bc^ :53 the cleared readings were a module-level Set, so a reload emptied it

Readings == 1..NumReadings
\* What the server says about a reading that has ended: "done" with every passage on the server,
\* "noted" when some audio is only on the device that asked, "failed" for an error or a cancel.
Finished == {"done", "noted", "failed"}
Listed == {"running"} \cup Finished

VARIABLES
    \* The server.
    catalogue,    \* each reading: "new" (not created yet), "running", a Finished value, or "gone"
    finishOrder,  \* readings in the order they ended; the server drops old job files by age (vite.prepare.ts:78)
    \* This device.
    matching,     \* the document's passages in the library match the readings' passage keys
    refreshing,   \* refreshShared has fetched the catalogue and not yet applied it (:100-103)
    fetched,      \* the catalogue it fetched
    rows,         \* the queue's row for each reading: "none", or the status it shows
    hidden,       \* hiddenShared
    reloads,
    cleared       \* history: readings cleared from the queue, by the reader or by themselves

server == <<catalogue, finishOrder>>
device == <<matching, refreshing, fetched, rows, hidden, reloads, cleared>>
vars == <<server, device>>

\* The reading sharedPreparationJobs lists for the document, or 0 when none is listed.
\* It matches readings to the document by every passage key (sharedPreparations.ts:25).
Picked(cat) ==
    LET running == {r \in Readings : cat[r] = "running"}
        ended == {r \in Readings : cat[r] \in Finished}
        newest(S) == CHOOSE r \in S : \A q \in S : q <= r
    IN  IF ~matching THEN 0
        ELSE IF running # {} THEN newest(running)
        ELSE IF ended # {} THEN newest(ended)
        ELSE 0

Init ==
    /\ catalogue = [r \in Readings |-> "new"]
    /\ finishOrder = <<>>
    /\ matching = TRUE
    /\ refreshing = FALSE
    /\ fetched = [r \in Readings |-> "new"]
    /\ rows = [r \in Readings |-> "none"]
    /\ hidden = {}
    /\ reloads = 0
    /\ cleared = {}

-----------------------------------------------------------------------------
(* The server. *)

\* A device asks for the reading. Readings are created in order.
Create(r) ==
    /\ catalogue[r] = "new"
    /\ \A q \in Readings : q < r => catalogue[q] # "new"
    /\ catalogue' = [catalogue EXCEPT ![r] = "running"]
    /\ UNCHANGED <<finishOrder, device>>

\* The reading ends.
End(r) ==
    /\ catalogue[r] = "running"
    /\ \E s \in Finished : catalogue' = [catalogue EXCEPT ![r] = s]
    /\ finishOrder' = Append(finishOrder, r)
    /\ UNCHANGED device

\* The device that asked shares the audio only it had (engine/preparation.ts:64-90).
Upload(r) ==
    /\ catalogue[r] = "noted"
    /\ catalogue' = [catalogue EXCEPT ![r] = "done"]
    /\ UNCHANGED <<finishOrder, device>>

\* A restart drops job files past RETENTION_MS by their last write, so the oldest ended reading goes first.
Expire ==
    /\ finishOrder # <<>>
    /\ catalogue' = [catalogue EXCEPT ![Head(finishOrder)] = "gone"]
    /\ finishOrder' = Tail(finishOrder)
    /\ UNCHANGED device

-----------------------------------------------------------------------------
(* This device. *)

\* The reader edits the document, or undoes the edit, so its passage keys change.
ChangeText ==
    /\ TextChanges
    /\ matching' = ~matching
    /\ UNCHANGED <<server, refreshing, fetched, rows, hidden, reloads, cleared>>

\* refreshShared fetches the catalogue (:102). Only one refresh runs at a time (:99).
Fetch ==
    /\ ~refreshing
    /\ refreshing' = TRUE
    /\ fetched' = catalogue
    /\ UNCHANGED <<server, matching, rows, hidden, reloads, cleared>>

(***************************************************************************)
(* refreshShared applies what it fetched, against the library it reads     *)
(* then (:103-118). It drops every server row and shows the listed reading *)
(* unless it was cleared and has ended (:108), or it ended clean before    *)
(* this device saw it (:110). hiddenShared then keeps only the readings    *)
(* still listed (:117).                                                    *)
(***************************************************************************)
Apply ==
    /\ refreshing
    /\ LET p == Picked(fetched)
           s == IF p = 0 THEN "none" ELSE fetched[p]
           seen == {r \in Readings : rows[r] # "none"}
           skip == p # 0 /\ p \in hidden /\ s # "running"
           unseen == p # 0 /\ ~skip /\ s = "done" /\ p \notin seen
           kept == IF unseen THEN hidden \cup {p} ELSE hidden
       IN  /\ rows' = [r \in Readings |-> IF r = p /\ ~skip /\ ~unseen THEN s ELSE "none"]
           /\ hidden' = IF p # 0 /\ p \in kept THEN {p} ELSE {}
    /\ refreshing' = FALSE
    /\ UNCHANGED <<server, matching, fetched, reloads, cleared>>

\* "Clear finished" (:171-174) removes every ended row and remembers them as cleared.
Dismiss ==
    LET ended == {r \in Readings : rows[r] \in Finished}
    IN  /\ ended # {}
        /\ rows' = [r \in Readings |-> IF r \in ended THEN "none" ELSE rows[r]]
        /\ hidden' = hidden \cup ended
        /\ cleared' = cleared \cup ended
        /\ UNCHANGED <<server, matching, refreshing, fetched, reloads>>

\* A clean finished row clears itself after READY_LINGER_MS (:190-205).
Linger(r) ==
    /\ rows[r] = "done"
    /\ rows' = [rows EXCEPT ![r] = "none"]
    /\ hidden' = hidden \cup {r}
    /\ cleared' = cleared \cup {r}
    /\ UNCHANGED <<server, matching, refreshing, fetched, reloads>>

\* The page reloads. Server rows are not persisted (:177); hiddenShared is, unless HiddenInMemory.
Reload ==
    /\ reloads < MaxReloads
    /\ reloads' = reloads + 1
    /\ rows' = [r \in Readings |-> "none"]
    /\ refreshing' = FALSE
    /\ hidden' = IF HiddenInMemory THEN {} ELSE hidden
    /\ UNCHANGED <<server, matching, fetched, cleared>>

Next ==
    \/ \E r \in Readings : Create(r) \/ End(r) \/ Upload(r) \/ Linger(r)
    \/ Expire
    \/ ChangeText
    \/ Fetch
    \/ Apply
    \/ Dismiss
    \/ Reload

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
    /\ catalogue \in [Readings -> {"new", "gone"} \cup Listed]
    /\ rows \in [Readings -> {"none"} \cup Listed]
    /\ hidden \subseteq Readings
    /\ cleared \subseteq Readings

\* A reading cleared from the queue does not come back, across syncs and reloads.
ClearedStayCleared == \A r \in cleared : rows[r] = "none"
=============================================================================
