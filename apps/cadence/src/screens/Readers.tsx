import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { dayOf } from "@readaloud/practice/score";
import { NAME_MAX, currentStreak, readerList } from "@readaloud/practice/store";
import { usePractice } from "../store";
import { plural, tap } from "../text";
import { CloseButton, Sheet } from "../ui";

/** Switch, add, rename or remove the readers sharing this device. */
export function Readers({ onClose }: { onClose: () => void }) {
  const state = usePractice();
  const readers = readerList(state);
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const today = dayOf(Date.now());

  return <Sheet label="Readers" onClose={onClose}>
    <div className="sheet-head"><h1 className="sheet-title">Readers</h1><CloseButton onClick={onClose} /></div>
    <p className="sheet-text">Each reader keeps their own level, streak, points and words on this device.</p>
    <div role="radiogroup" aria-label="Reader" className="readers">
      {readers.map((r) => {
        const current = r.id === state.readerId;
        const days = currentStreak({ streak: r.streak }, today);
        return <div key={r.id} className="reader">
          <button type="button" role="radio" aria-checked={current} className="reader-pick" onClick={() => { state.switchReader(r.id); onClose(); }}>
            <span className="radio">{current && <Check size={13} aria-hidden />}</span>
            <span className="list-main">
              <span className="reader-name">{r.name}</span>
              <span className="list-sub">{days ? `${days}-day streak · ` : ""}{plural(r.points, "point")}</span>
            </span>
          </button>
          {current
            ? <button type="button" className="reader-action" onClick={() => setRenaming(renaming === null ? r.name : null)}>Rename</button>
            : <button type="button" className={confirming === r.id ? "reader-action danger" : "reader-action"}
                onClick={() => { if (confirming === r.id) { state.removeReader(r.id); setConfirming(null); } else setConfirming(r.id); }}>
                {confirming === r.id ? "Remove?" : "Remove"}
              </button>}
        </div>;
      })}
    </div>
    {confirming && <p role="status" className="small">Removing a reader deletes their progress on this device. {tap()} “Remove?” to confirm.</p>}
    {renaming !== null && <form className="field-row" onSubmit={(e) => { e.preventDefault(); if (!renaming.trim()) return; state.renameReader(renaming); setRenaming(null); }}>
      <label className="sr-only" htmlFor="reader-rename">Reader's name</label>
      <input id="reader-rename" className="field" type="text" maxLength={NAME_MAX} value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
      <button type="submit" className="btn btn-soft" disabled={!renaming.trim()}>Save</button>
    </form>}
    <form className="field-row" onSubmit={(e) => { e.preventDefault(); if (!adding.trim()) return; state.addReader(adding); onClose(); }}>
      <label className="sr-only" htmlFor="reader-add">New reader's name</label>
      <input id="reader-add" className="field" type="text" placeholder="Add a reader" maxLength={NAME_MAX} value={adding} onChange={(e) => setAdding(e.target.value)} />
      <button type="submit" className="btn btn-soft" disabled={!adding.trim()}><Plus size={18} aria-hidden /><span>Add</span></button>
    </form>
  </Sheet>;
}
